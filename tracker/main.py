import cv2
import numpy as np
from ultralytics import YOLO
from track import SimpleTracker

model = YOLO("yolov8n.pt")
class_names = model.names
tracker = SimpleTracker()

video_path = "shopp.mp4"
cap = cv2.VideoCapture(video_path)

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

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

    for track in tracks:
        x1, y1, x2, y2 = track.bbox
        track_id = track.track_id
        cx = int((x1 + x2) / 2)
        cy = int((y1 + y2) / 2)
        center = (cx, cy)
        label = f"ID {track_id}"
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 100), 2)
        cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 100), 2)

    cv2.imshow("Tracker", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()