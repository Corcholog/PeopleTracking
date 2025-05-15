import cv2, asyncio, numpy as np
from fastapi import FastAPI, WebSocket , WebSocketDisconnect, Request
from pydantic import BaseModel
from ultralytics import YOLO
from tracker.tracker import get_predict, draw, reset, set_confidence, set_gpu_usage
import sys
import os
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

cpu_count = os.cpu_count() or 1
executor = ThreadPoolExecutor(max_workers=cpu_count)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 5.1 Warm-up: inferencia dummy
    dummy = np.zeros((480,640,3), np.uint8)
    _ , _, _ = get_predict(dummy)
    print("✅ Modelo calentado", flush=True)
    yield  # aquí arranca FastAPI
    # Aquí irían limpiezas si hicieran falta

app = FastAPI(lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

id = None
config_state = {
    "confidence_threshold": 0.5,
    "gpu": False,
}

class IDPayload(BaseModel):
    id: int

class ConfigPayload(BaseModel):
    confidence: float = 0.5
    gpu: bool = False


# Detecta si está en un ejecutable de PyInstaller
if getattr(sys, 'frozen', False):
    bundle_dir = sys._MEIPASS
else:
    bundle_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Añadí el path completo de "tracker" al sys.path
sys.path.insert(0, os.path.join(bundle_dir, 'tracker'))

def apply_zoom(frame, center, zoom_factor=1.5):

    if center is None:
        return frame

    x, y = center
    height, width = frame.shape[:2]

    # Calcular la región de interés con zoom
    new_width = int(width / zoom_factor)
    new_height = int(height / zoom_factor)

    # Asegurarse de que la región de zoom no exceda los límites de la imagen
    x1 = max(0, x - new_width // 2)
    y1 = max(0, y - new_height // 2)
    x2 = min(width, x + new_width // 2)
    y2 = min(height, y + new_height // 2)

    # Si nos acercamos a los bordes, ajustamos para mantener el tamaño
    if x2 - x1 < new_width:
        if x1 == 0:
            x2 = min(width, x1 + new_width)
        else:
            x1 = max(0, x2 - new_width)

    if y2 - y1 < new_height:
        if y1 == 0:
            y2 = min(height, y1 + new_height)
        else:
            y1 = max(0, y2 - new_height)

    # Recortar la región de interés
    zoomed = frame[y1:y2, x1:x2]

    # Redimensionar al tamaño original para mantener la misma resolución
    zoomed = cv2.resize(zoomed, (width, height), interpolation=cv2.INTER_LINEAR)

    return zoomed


@app.websocket("/ws/analyze/")
async def analyze(ws: WebSocket):
    await ws.accept()

    # 2) Informa al cliente que el servidor está listo
    await ws.send_json({"type": "ready", "status": True})

    try:
        global id
        while True:
            data = await ws.receive_bytes()

          # Decodificar la imagen recibida
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                continue
          # Procesar con YOLO + tracking
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(executor, get_predict, frame, id)
            frame_pred, tracks, center = result
            annotated = draw(frame_pred, tracks)

            if center is not None:
                annotated = apply_zoom(annotated, center, zoom_factor=1.5)

            await ws.send_json({
                "type": "lista_de_ids",
                "detections": [{"id": t.track_id, "bbox": t.bbox} for t in tracks],
                "selected_id": id
            })

            # Codificar imagen anotada a JPG para enviar
            _, buf = cv2.imencode(".jpg", annotated)

            await ws.send_bytes(buf.tobytes())
    except WebSocketDisconnect:
        print("Cliente desconectado")

@app.post("/reset_model/")
async def reset_model(request: Request):
    reset()
    return {"status": "model reset"}

@app.post("/set_id/")
async def set_id(payload: IDPayload):
    global id
    id = payload.id
    return {"status": "model reset"}


@app.post("/config/")
async def update_config(payload: ConfigPayload):
    if payload.confidence is not None:
        set_confidence(payload.confidence)
        config_state["confidence_threshold"] = payload.confidence
    if payload.gpu is not None:
        set_gpu_usage(payload.gpu)
        config_state["gpu"] = payload.gpu

    print(f"[CONFIG] Estado actualizado: {config_state}")
    return {"status": "ok", "new_state": config_state}