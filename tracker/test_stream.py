import cv2
import numpy as np
import time
from ultralytics import YOLO
from track import SimpleTracker
import logging

# Desactivar la salida de logs de la librería ultralytics
logging.getLogger('ultralytics').setLevel(logging.WARNING)

# Modelo y tracker
model = YOLO("yolov8n.pt", verbose=False)
tracker = SimpleTracker()
video_path = r'tracker\mall.mp4'

# Función principal de predicción
def get_predict(frame, id=None):
    results = model(frame)[0]

    detections = []
    for result in results.boxes:
        cls_id = int(result.cls[0])
        conf = float(result.conf[0])
        if cls_id == 0 and conf > 0.5:
            x1, y1, x2, y2 = map(int, result.xyxy[0])
            cropped = frame[y1:y2, x1:x2]
            if cropped.size == 0:
                continue
            detections.append(([x1, y1, x2, y2]))

    tracks = tracker.update(detections)
    center = None

    for track in tracks:
        if id is None or track.track_id == id:
            x1, y1, x2, y2 = track.bbox
            track_id = track.track_id
            cx = int((x1 + x2) / 2)
            cy = int((y1 + y2) / 2)
            center = (cx, cy)
            label = f"ID {track_id}"
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 100), 2)
            cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 100), 2)

    return frame, center

# Iniciar video
cap = cv2.VideoCapture(video_path)
start_time = time.time()
show_only_id_3 = False
show_all = True

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    

    id_filter = 3 if show_only_id_3 else None
    frame, center = get_predict(frame, id=id_filter)

    cv2.imshow("Tracker", frame)

    elapsed_time = time.time() - start_time
    if not show_all:
        if elapsed_time > 6.0:
            show_only_id_3 = True

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
