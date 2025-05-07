import cv2, asyncio, numpy as np
from fastapi import FastAPI, WebSocket , WebSocketDisconnect
from ultralytics import YOLO
from tracker.tracker import get_predict, draw
import sys
import os

app = FastAPI()

# Detecta si está en un ejecutable de PyInstaller
if getattr(sys, 'frozen', False):
    bundle_dir = sys._MEIPASS
else:
    bundle_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Añadí el path completo de "tracker" al sys.path
sys.path.insert(0, os.path.join(bundle_dir, 'tracker'))


@app.websocket("/ws/analyze/")
async def analyze(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_bytes()
            
          # Decodificar la imagen recibida
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                continue
          # Procesar con YOLO + tracking
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, get_predict, frame)
            frame_pred, tracks, _ = result
            annotated = draw(frame_pred, tracks)

            # Codificar imagen anotada a JPG para enviar
            _, buf = cv2.imencode(".jpg", annotated)

            await ws.send_bytes(buf.tobytes())
    except WebSocketDisconnect:
        print("Cliente desconectado")