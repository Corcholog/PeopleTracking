import cv2
import numpy as np
import time
from ultralytics import YOLO
from track import SimpleTracker
import logging
import torch

# Desactivar logs de ultralytics
logging.getLogger('ultralytics').setLevel(logging.WARNING)

# Variables globales para el zoom
zoom_target_id = None
clicked_point = None



# Manejar clics del mouse
def mouse_callback(event, x, y, flags, param):
    global clicked_point
    if event == cv2.EVENT_LBUTTONDOWN:
        clicked_point = (x, y)

#prueba creo una clase que procesa frames
class FrameProcessor:
    def __init__(self, video_fps, target_fps):
        self.frame_time = 1.0 / video_fps
        self.target_time = 1.0 / target_fps
        self.accumulator = 0.0

    def should_process(self):
        self.accumulator += self.frame_time
        if self.accumulator >= self.target_time:
            self.accumulator -= self.target_time
            return True
        return False

'''
def should_process_frame (frame_index, video_fps, target_fps):
    if video_fps <= target_fps:
        return True
    frame_interval = int(video_fps // target_fps)
    return frame_index % frame_interval == 0
'''

def main(video_path, target_fps=None):
    global zoom_target_id, clicked_point


'''
para probar la confidence tambien lo pruebo aca ya esta en la clase tracker igual
'''

confidence_threshold = 0.5

def set_confidence(confidence):
    global confidence_threshold  
    confidence_threshold = confidence

def set_default_confidence():
    global confidence_threshold  
    confidence_threshold = 0.5

def main (video_path, target_fps=None,use_gpu=False):


    print("GPU disponible:", torch.cuda.is_available())
    print("Nombre de GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "No hay GPU")

    if use_gpu and torch.cuda.is_available():
        device = 'cuda'
        print (f"se esta usando   {torch.cuda.get_device_name(0)}")
    else:
        device = "cpu"
        print (f"se esta usando cpu")
    


    cap = cv2.VideoCapture(video_path)
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if target_fps is None:
        target_fps = video_fps
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_length = total_frames / video_fps
    print(f"FPS del video: {video_fps}")

    frame_processor = FrameProcessor(video_fps, target_fps)

    model = YOLO("yolov8n.pt", verbose=False)
    tracker = SimpleTracker()

    processed_frames = 0
    start_time = time.time()
    #meticas de tiempo
    processing_times = []
    detection_times = []
    tracking_times = []
    start_processing_time = time.time()

    cv2.namedWindow("Tracker")
    cv2.setMouseCallback("Tracker", mouse_callback)

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if frame_processor.should_process():
            frame_start_time = time.time()
            processed_frames += 1

            # Detección
            det_start = time.time()
            results = model.predict(frame, device=device, verbose=False)[0]
            detections = []

            for result in results.boxes:
                cls_id = int(result.cls[0])
                conf = float(result.conf[0])
                if cls_id == 0 and conf > 0.5:
                    x1, y1, x2, y2 = map(int, result.xyxy[0])
                    if (x2 - x1) > 0 and (y2 - y1) > 0:
                        detections.append([x1, y1, x2, y2])
            det_end = time.time()

            # --Tracking--
            track_start = time.time()
            tracks = tracker.update(detections)
            track_end = time.time()

            for track in tracks:
                x1, y1, x2, y2 = track.bbox
                track_id = track.track_id
                cx = int((x1 + x2) / 2)
                cy = int((y1 + y2) / 2)
                label = f"ID {track_id}"

                color = (0, 200, 100) if track_id != zoom_target_id else (0, 0, 255)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

                # Ver si se hizo clic dentro del bounding box y seleccionar la persona clickeada
                if clicked_point is not None:
                    click_x, click_y = clicked_point
                    if x1 <= click_x <= x2 and y1 <= click_y <= y2:
                        zoom_target_id = track_id
                        print(f"[INFO] Zoom en persona con ID: {zoom_target_id}")
                        clicked_point = None

                # Mostrar zoom si es la persona seleccionada
                if track_id == zoom_target_id:
                    margin = 50  # Margen extra alrededor de la persona
                    x1, y1, x2, y2 = track.bbox

                    # Esto es para expandir el área de zoom alrededor de la persona
                    x1 = max(0, x1 - margin)
                    y1 = max(0, y1 - margin)
                    x2 = min(frame.shape[1], x2 + margin)
                    y2 = min(frame.shape[0], y2 + margin)

                    zoomed = frame[y1:y2, x1:x2]
                    if zoomed.size > 0:
                        zoomed = cv2.resize(zoomed, (300, 300))
                        cv2.imshow("Zoom a persona", zoomed)
                        cv2.setWindowProperty("Zoom a persona", cv2.WND_PROP_TOPMOST, 1)


            frame_end_time = time.time()

            # Guardar metricas
            processing_times.append(frame_end_time - frame_start_time)
            detection_times.append(det_end - det_start)
            tracking_times.append(track_end - track_start)

            cv2.imshow("Tracker", frame)

        # Mostrar FPS por segundo
        elapsed = time.time() - start_time
        if elapsed >= 1.0:
            fps = processed_frames / elapsed
            print(f"[INFO] FPS por segundo: {fps:.2f}")
            processed_frames = 0
            start_time = time.time()

        key = cv2.waitKey(1)
        if key & 0xFF == ord("q"): # cerrar todas las ventanas
            break
        elif key & 0xFF == ord("z"):
            zoom_target_id = None  # Cancelar zoom
        elif key & 0xFF == ord("p"): # Cerrar el zoom
            zoom_target_id = None
            cv2.destroyWindow("Zoom a persona")

    cap.release()
    cv2.destroyAllWindows()

    # Resultados
    if processing_times:
        avg_time = np.mean(processing_times)
        print(f"\nTiempo promedio por frame: {avg_time:.4f} seg ({1 / avg_time:.2f} FPS)")
        print(f"Tiempo total de procesamiento: {time.time() - start_processing_time:.2f} seg")
        print(f"FPS promedio general: {total_frames / (time.time() - start_processing_time):.2f}")
        print(f"Tiempo promedio de detección: {np.mean(detection_times):.4f} seg")
        print(f"Tiempo promedio de seguimiento: {np.mean(tracking_times):.4f} seg")
    else:
        print("No se procesó ningún frame.")


video_path = r'tracker\shopp.mp4'
print(f"al inicio por default es{confidence_threshold}")
set_confidence(0.7)
print(f"seteada :  {confidence_threshold}")
set_default_confidence()
print(f"seteada default{confidence_threshold}")
main(video_path, 20, use_gpu=True)

