import cv2
from ultralytics import YOLO
from .track import SimpleTracker
import logging
import torch

# Desactivar la salida de logs de la librería ultralytics
logging.getLogger('ultralytics').setLevel(logging.WARNING)
device = 'cpu'

def set_gpu_usage(use_gpu):
    global device, model
    if use_gpu and torch.cuda.is_available():
        device = 'cuda'
        model.to(device)
        print(f"Se está usando {torch.cuda.get_device_name(0)}")
    else:
        device = 'cpu'
        model.to(device)
        print("Se utilizará CPU, la GPU no está disponible o no es compatible.")


confidence_threshold = 0.5
#con esta funcion se setea con la confianza que quiere el usuario
def set_confidence(confidence):
    global confidence_threshold  
    confidence_threshold = confidence
#con esta funcion se vuelve a setear la confianza por default si el usuario no quiere filtrar mas
def set_default_confidence():
    global confidence_threshold  
    confidence_threshold = 0.5

# Modelo y tracker
model = YOLO("yolov8n.pt")
model.to(device)
# Inicializa el tracker
tracker = SimpleTracker()

# Regalito para el back, frame tiene el mismo formato en el que me lo tienen que mandar, asi que esperan el predict, dibujan y dsp mandan al front
def draw(frame, tracks):
    for track in tracks:
        x1, y1, x2, y2 = track.bbox
        track_id = track.track_id
        label = f"ID {track_id}"
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 100), 2)
        cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 100), 2)
    return frame

# Función principal de predicción
def get_predict(frame, id=None):
    results = model.predict(frame)[0]

    detections = []
    for result in results.boxes:
        cls_id = int(result.cls[0])
        conf = float(result.conf[0])
        if cls_id == 0 and conf > confidence_threshold:
            x1, y1, x2, y2 = map(int, result.xyxy[0])
            cropped = frame[y1:y2, x1:x2]
            if cropped.size == 0:
                continue
            detections.append(([x1, y1, x2, y2]))

    tracks = tracker.update(detections)
    center = None

    for track in tracks:
        if id == track.track_id:
            x1, y1, x2, y2 = track.bbox
            cx = int((x1 + x2) / 2)
            cy = int((y1 + y2) / 2)
            center = (cx, cy)
            break

    return frame, tracks, center

# Función para resetear el trackeo ante cambio de camara
def reset():
    global tracker
    tracker = SimpleTracker()
