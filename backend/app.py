import sys
import os
import cv2
import asyncio
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ultralytics import YOLO
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
import torch


# 1) Detecta si está bundlado o en desarrollo
if getattr(sys, 'frozen', False):
    base_dir = sys._MEIPASS
else:
    # Asume que este archivo está en backend/, sube un nivel
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# 2) Inserta la carpeta padre en sys.path (PeopleTracking/)
sys.path.insert(0, base_dir)

# 3) Ahora sí importamos cosas de tracker/
from tracker.tracker import get_predict, draw, reset, set_confidence, set_gpu_usage

# ---------------------------------------------------
# 6) Thread pool para no bloquear el loop de asyncio
# ---------------------------------------------------
cpu_count = os.cpu_count() or 1
executor = ThreadPoolExecutor(max_workers=cpu_count)
warmup_gpu = False
warmup_cpu = False


# ---------------------------------------------------
# 7) FastAPI con lifespan para warm‑up
# ---------------------------------------------------
hardware_status = {"gpu_available": False}

#
#
#

frame_counter = 0           # Cuenta frames recibidos
results = {}                # Guarda resultados procesados {frame_id: resultado}
next_frame_to_send = 1      # Próximo frame que debe enviarse en orden
async def process_frame(frame, frame_id, current_id):
    loop = asyncio.get_running_loop()
    try:
        frame_pred, tracks, center = await loop.run_in_executor(
            executor, get_predict, frame, current_id
        )
        annotated = draw(frame_pred, tracks)
        if center:
            annotated = apply_zoom(annotated, center)
        _, buf = cv2.imencode(".jpg", annotated)

        # Guarda resultado
        
        results[frame_id] = {
            "detections": [{"id": t.track_id, "bbox": t.bbox} for t in tracks],
            "image": buf.tobytes()
        }
    except Exception as e:
        print(f"Error en procesar frame {frame_id}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global warmup_gpu, warmup_cpu, hardware_status
    if torch.cuda.is_available():
        set_gpu_usage(True)
        warmup_gpu = True
        hardware_status["gpu_available"] = True
    else:
        warmup_cpu = True
        hardware_status["gpu_available"] = False
    # Warm-up del modelo
    dummy = np.zeros((480, 640, 3), np.uint8)
    _, _, _ = get_predict(dummy)
    print("✅ Modelo calentado")
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------
# 8) Estado compartido
# ---------------------------------------------------
current_id = None
config_state = {"confidence_threshold": 0.5, "gpu": True}

class IDPayload(BaseModel):
    id: int

class ConfigPayload(BaseModel):
    confidence: float = 0.5
    gpu: bool = False

# ---------------------------------------------------
# 9) Utilidad de zoom (opcional)
# ---------------------------------------------------
def apply_zoom(frame, center, zoom_factor=1.5):
    if center is None:
        return frame
    x, y = center
    h, w = frame.shape[:2]
    new_w, new_h = int(w / zoom_factor), int(h / zoom_factor)
    x1 = max(0, x - new_w // 2); y1 = max(0, y - new_h // 2)
    x2 = min(w, x + new_w // 2); y2 = min(h, y + new_h // 2)
    crop = frame[y1:y2, x1:x2]
    return cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)

# ---------------------------------------------------
# 10) Endpoint WebSocket para análisis
# ---------------------------------------------------
@app.websocket("/ws/analyze/")
async def analyze(ws: WebSocket):
    global frame_counter, next_frame_to_send, results
    await ws.accept()
    await ws.send_json({"type": "ready", "status": True})
    frame_counter = 0
    next_frame_to_send = 1
    results = {}
    print("✅ WebSocket aceptado")
    try:
        global current_id
        while True:
            data = await ws.receive_bytes()
            print(f"📦 Bytes recibidos: {len(data)}")
            frame_counter += 1
            current_frame_id = frame_counter

            # Decodifica JPEG
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            asyncio.create_task(process_frame(frame, current_frame_id, current_id))
            
            # Intentar enviar frames en orden
            while next_frame_to_send in results:
                res = results.pop(next_frame_to_send)

                # Envía lista de IDs
                await ws.send_json({
                    "type": "lista_de_ids",
                    "detections": res["detections"],
                    "selected_id": current_id
                })

                # Envía imagen anotada
                await ws.send_bytes(res["image"])

                next_frame_to_send += 1

    except WebSocketDisconnect:
        print("Cliente desconectado")
    except Exception:
        import traceback; traceback.print_exc()
    finally:
        print("🛑 Handler WebSocket terminado.")

# ---------------------------------------------------
# 11) Endpoints REST para control
# ---------------------------------------------------
@app.post("/reset_model/")
async def reset_model(request: Request):
    reset()
    return {"status": "model reset"}

@app.post("/set_id/")
async def set_id(payload: IDPayload):
    global current_id
    current_id = payload.id
    return {"status": "id updated"}

@app.post("/clear_id/")
async def clear_id():
    global id
    id = None
    return {"status": "id cleared"}

@app.post("/config/")
async def update_config(payload: ConfigPayload):
    global warmup_gpu, warmup_cpu
    if payload.confidence is not None:
        set_confidence(payload.confidence)
        config_state["confidence_threshold"] = payload.confidence
    if payload.gpu is not None:
        if set_gpu_usage(payload.gpu):
            if not warmup_gpu:
                dummy = np.zeros((480, 640, 3), np.uint8)
                _, _, _ = get_predict(dummy)
                warmup_gpu = True
                warmup_cpu = False
        else:
            if not warmup_cpu:
                dummy = np.zeros((480, 640, 3), np.uint8)
                _, _, _ = get_predict(dummy)
                warmup_cpu = True
                warmup_gpu = False
        config_state["gpu"] = payload.gpu
    print(f"[CONFIG] {config_state}")
    return {"status": "ok", "new_state": config_state}

@app.get("/hardware_status/")
async def get_hardware_status():
    return hardware_status
