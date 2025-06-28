import cv2
from ultralytics import YOLO
from .track import SimpleTracker
import logging
import torch
import os, sys, requests
# Desactivar la salida de logs de la librería ultralytics
logging.getLogger('ultralytics').setLevel(logging.WARNING)
device = 'cpu'

def set_gpu_usage(use_gpu) -> bool:
    global device, model
    if use_gpu and torch.cuda.is_available():
        device = 'cuda'
        model.to(device)
        print(f"Se está usando {torch.cuda.get_device_name(0)}")
        return True
    else:
        device = 'cpu'
        model.to(device)
        print("Se utilizará CPU, la GPU no está disponible o no es compatible.")
        return False


confidence_threshold = 0.5
#con esta funcion se setea con la confianza que quiere el usuario
def set_confidence(confidence):
    global confidence_threshold  
    confidence_threshold = confidence
#con esta funcion se vuelve a setear la confianza por default si el usuario no quiere filtrar mas
def set_default_confidence():
    global confidence_threshold  
    confidence_threshold = 0.5

# Modelo y tracker | descomentar abajo para version normal
def get_model():
    # Detecta si estás corriendo desde el ejecutable (.exe)
    if getattr(sys, 'frozen', False):
        # Estás en una versión "bundleada" con PyInstaller
        BASE = sys._MEIPASS  # Carpeta temporal creada por PyInstaller
        bundled_path = os.path.join(BASE, "tracker", "yolov8n.pt")

        # Si no está incluido en el bundle, usa AppData
        if not os.path.isfile(bundled_path):
            print("[INFO] Modelo no está bundleado, intentando AppData...")
            data_dir = os.path.join(os.getenv("APPDATA"), "PeopleTracking", "tracker")
            os.makedirs(data_dir, exist_ok=True)
            model_path = os.path.join(data_dir, "yolov8n.pt")

            if not os.path.isfile(model_path):
                print("[INFO] Descargando modelo YOLO a AppData...")
                url = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt"
                resp = requests.get(url, stream=True)
                resp.raise_for_status()
                with open(model_path, "wb") as f:
                    for chunk in resp.iter_content(8192):
                        f.write(chunk)
            return YOLO(model_path)
        else:
            return YOLO(bundled_path)
    else:
        # Estás corriendo desde código fuente (modo desarrollo)
        return YOLO("yolov8n.pt")  # El modelo debe estar en el mismo directorio

# Usá la función
model = get_model()

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
    try:
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
    except Exception as e:
        import traceback; traceback.print_exc()
        print("[ERROR get_predict]", e, flush=True)
        return frame, [], None

# Función para resetear el trackeo ante cambio de camara
def reset():
    global tracker
    tracker = SimpleTracker()
