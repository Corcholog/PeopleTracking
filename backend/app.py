import cv2, asyncio
from fastapi import FastAPI, WebSocket , WebSocketDisconnect
from fastapi.responses import HTMLResponse
from ultralytics import YOLO
import time
app = FastAPI()
model = YOLO("yolov8n.pt")

HTML = """
<!DOCTYPE html>
<html>
  <body>
    <canvas id="canvas"></canvas>
    <script>
      const ws = new WebSocket("ws://localhost:8000/ws/track/");
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");
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
    </script>
  </body>
</html>
"""

@app.get("/")
async def index():
    return HTMLResponse(HTML)

@app.websocket("/ws/track/")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    send_times = []  # ← aquí creas la lista para medir overhead :contentReference[oaicite:0]{index=0}
    cap = cv2.VideoCapture("video.mp4")
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    declared_fps  = cap.get(cv2.CAP_PROP_FPS)
    print(f"📽 Total frames={total_frames}, FPS declarada={declared_fps}")


    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            loop = asyncio.get_running_loop()  # obtiene el event loop activo
            res_list = await loop.run_in_executor(
                None,           # usa el ThreadPoolExecutor por defecto
                model.predict,  # función bloqueante
                frame           # argumento
            )
            res = res_list[0]
            annotated = res.plot()
            _, buf = cv2.imencode(".jpg", annotated)

            
            try:
                t0 = time.perf_counter()
                await ws.send_bytes(buf.tobytes())
                delta_send = time.perf_counter() - t0
                send_times.append(delta_send)
            except WebSocketDisconnect:
                break
        await asyncio.sleep(0)

    finally:
        cap.release()
        # Cierra la conexión WebSocket de forma limpia:
        if send_times:
            avg_send = sum(send_times) / len(send_times)
            print(f"Send overhead medio: {avg_send*1000:.2f} ms")
        else:
            print("No se enviaron datos por WebSocket.")
        await ws.close(code=1000)  # código 1000 = "normal closure" :contentReference[oaicite:2]{index=2}
