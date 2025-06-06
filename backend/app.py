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
from yt_dlp import YoutubeDL
import torch
import json
from yt_dlp import YoutubeDL
from datetime import datetime


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
ready = False
stream_url = False
url = False

# ---------------------------------------------------
# 7) FastAPI con lifespan para warm‑up
# ---------------------------------------------------
hardware_status = {"gpu_available": False}

# Other global variables
is_recording = False

@asynccontextmanager
async def lifespan(app: FastAPI):
    global warmup_gpu, warmup_cpu, hardware_status, ready
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
    ready = True
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
    if center is None or current_id is None:
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
    def init_video_writer(frame):
        nonlocal video_writer
        height, width = frame.shape[:2]
        fps = 30  # valor por defecto si no viene de stream, tengo que ver la manera que sepa los fps en back
        if cap:
            fps = cap.get(cv2.CAP_PROP_FPS) or 30

        timestamp = datetime.now().strftime("%d-%m-%Y-%H-%M-%S")
        filename = f"recording-{timestamp}.mp4"

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        video_writer = cv2.VideoWriter(filename, fourcc, fps, (width, height))
        print(f"🎥 Grabando video en: {filename}")

    await ws.accept()
    await ws.send_json({"type": "ready", "status": True})
    try:
        video_writer = None
        global current_id, video_url, stream_url, is_recording
        cap = None
        while True:
            frame = None
            ## parte agarrar video
            if stream_url and video_url:
                if cap is None:
                    cap = cv2.VideoCapture(video_url)
                    if not cap.isOpened():
                        await ws.send_json({"type": "error", "message": "No se pudo abrir el stream"})
                        print("❌ No se pudo abrir el stream")
                        break

                ret, frame = cap.read()
                if not ret:
                    print("❌ No se pudo leer el frame del stream")
                    await asyncio.sleep(0.1)
                    continue
            else:
                message = await ws.receive()

                if message["type"] == "websocket.disconnect":
                    print("Cliente desconectado")
                    break

                if message["type"] == "websocket.receive":
                    if "text" in message:
                        try:
                            data = message["text"]
                            parsed = json.loads(data)  # 👈 intentamos decodificar como JSON
                            if isinstance(parsed, dict) and parsed.get("type") == "stop":
                                print("🛑 Solicitud de detener recibida (JSON)")
                                break
                        except json.JSONDecodeError:
                            if data.strip().lower() == "stop":
                                print("🛑 Solicitud de detener recibida (texto plano)")
                                break
                    elif "bytes" in message:
                        nparr = np.frombuffer(message["bytes"], np.uint8)
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        if frame is None:
                            continue
            if frame is None:
                continue
            if is_recording and video_writer is None:
                init_video_writer(frame)
            loop = asyncio.get_running_loop()
            try:
                frame_pred, tracks, center = await loop.run_in_executor(
                    executor, get_predict, frame, current_id
            )
            except Exception as e:
                print("❌ Error en get_predict:", e)
                continue

            annotated = draw(frame_pred, tracks)
            if is_recording and video_writer is not None:
                video_writer.write(annotated)
            if center:
                annotated = apply_zoom(annotated, center)

            await ws.send_json({
                        "type": "lista_de_ids",
                        "detections": [{"id": t.track_id, "bbox": t.bbox} for t in tracks],
                        "selected_id": current_id
            })
            _, buf = cv2.imencode(".jpg", annotated)
            await ws.send_bytes(buf.tobytes())

            # Delay pequeño si es stream
            if stream_url and video_url:
                await asyncio.sleep(0.03)

    except WebSocketDisconnect:
        print("Cliente desconectado")
    except Exception:
        import traceback; traceback.print_exc()
    finally:
        try:
            await ws.send_json({"type": "stopped"})
            # Adaptar lo siguiente también para cuando se haga un botón de dejar de grabar
            if video_writer:
                video_writer.release()
                print("💾 Video guardado correctamente.")
            is_recording = False
            await ws.close()
        except:
            pass
        print("🛑 Handler WebSocket terminado.")
        if cap:
            cap.release()



# ---------------------------------------------------
# 11) Endpoints REST para control
# ---------------------------------------------------
@app.post("/reset_model/")
async def reset_model(request: Request):
    global current_id
    current_id = None
    reset()
    return {"status": "model reset"}

@app.post("/set_id/")
async def set_id(payload: IDPayload):
    global current_id
    current_id = payload.id
    return {"status": "id updated"}

@app.post("/clear_id/")
async def clear_id():
    global current_id
    current_id = None
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

@app.get("/status/")
async def get_status():
    global ready
    return {"ready": ready}

@app.post("/start_recording/")
async def start_recording():
    global is_recording
    is_recording = True
    return {"status": "recording started"}
# ---------------------------------------------------
# Endpoints Stream
stream_url = False
url = None
video_url = None  # Aquí guardaremos la URL real del stream de YouTube

def get_youtube_stream_url(youtube_link):
    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'quiet': True,
        'noplaylist': True,
    }
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(youtube_link, download=False)
        return info['url']


@app.post("/upload-url/")
async def upload_url(request: Request):
    global stream_url, url, video_url
    data = await request.json()

    stream_url = bool(data.get("stream_url"))  # por si viene como string
    url = data.get("imageUrl")

    if stream_url and url:
        try:
            video_url = get_youtube_stream_url(url)
            print(f"URL de video obtenida: {video_url}")
        except Exception as e:
            print(f"Error al obtener stream de YouTube: {e}")
            video_url = None
    else:
        video_url = None  # por si estás subiendo una imagen normal, no YouTube

    print(f"Stream URL: {stream_url}")
    print(f"URL recibida: {url}")
    return {"status": "ok"}



class ResolutionRequest(BaseModel):
    resolution: str  # Ej: "1920x1080"

@app.post("/change_resolution")
async def change_resolution(req: ResolutionRequest):
    try:
        requested_height = int(req.resolution.split("x")[1])
        print(f"Requested max height: {requested_height}")
    except Exception:
        requested_height = None
        print("Error al obtener la resolución solicitada")

    ydl_opts = {
        "quiet": True,
        "skip_download": True,
    }

    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    formats = info.get("formats", [])

    # Filtrar formatos con video y url donde la altura sea menor o igual a la solicitada
    filtered_videos = [
        f for f in formats
        if f.get("height") and f["height"] <= requested_height
           and f.get("vcodec") and f["vcodec"] != "none"
           and f.get("url")
    ]

    if filtered_videos:
        # Elegir el formato con mayor altura que cumpla la condición (más cerca de la solicitada)
        best_video = max(filtered_videos, key=lambda f: f["height"])
        stream_url = best_video["url"]
        print(f"url de antes{stream_url}")
        stream_url = get_youtube_stream_url(stream_url)
        print(f"Stream seleccionado con altura: {best_video['height']}")
        print(stream_url)

    return {
        "message": f"Stream de video para resolución solicitada <= {req.resolution}",
        "stream_url": stream_url,
    }

@app.post("/clear-url/")
async def clear_url():
    global stream_url, url
    stream_url = False
    url = False
    return {"status": "ok"}