import cv2, asyncio, numpy as np
from fastapi import FastAPI, WebSocket , WebSocketDisconnect
from fastapi.responses import HTMLResponse
from tracker.tracker import get_predict, draw
from ultralytics import YOLO
import time
app = FastAPI()
model = YOLO("yolov8n.pt")

HTML = """
<!DOCTYPE html>
<html>
  <body>
    <video id="video" autoplay muted playsinline></video>
    <canvas id="canvas"></canvas>

    <script>
      const ws = new WebSocket("ws://localhost:8000/ws/track/");
      const video = document.getElementById("video");
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");

      // Mostrar respuesta del backend
      ws.onmessage = evt => {
        const blob = new Blob([evt.data], { type: "image/jpeg" });
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
        };
        img.src = URL.createObjectURL(blob);
      };

      // Capturar cámara
      navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
        video.srcObject = stream;

        const sendFrame = () => {
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const tempCanvas = document.createElement("canvas");
            const tempCtx = tempCanvas.getContext("2d");
            tempCanvas.width = video.videoWidth;
            tempCanvas.height = video.videoHeight;
            tempCtx.drawImage(video, 0, 0);
            tempCanvas.toBlob(blob => {
              if (blob && ws.readyState === WebSocket.OPEN) {
                ws.send(blob);
              }
            }, "image/jpeg");
          }
          requestAnimationFrame(sendFrame);
        };

        sendFrame();
      });
    </script>
  </body>
</html>
"""

@app.get("/")
async def index():
    return HTMLResponse(HTML)

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