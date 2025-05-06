import cv2
import numpy as np
import time
from ultralytics import YOLO
from track import SimpleTracker
import time
import logging
import torch


# Desactivar la salida de logs de la librería ultralytics
logging.getLogger('ultralytics').setLevel(logging.WARNING)

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
    print(video_fps)


    frame_processor = FrameProcessor(video_fps,target_fps)

    model = YOLO("yolov8n.pt",verbose=False)
    class_names = model.names
    tracker = SimpleTracker()
    cap = cv2.VideoCapture(video_path)
    processed_frames = 0
    start_time = time.time()

    # Métricas de tiempo
    processing_times = []
    detection_times = []
    tracking_times = []
    start_processing_time = time.time()
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
            
        if frame_processor.should_process():
            frame_start_time = time.time()
            processed_frames += 1
            # --- Detección (YOLO) ---
            det_start = time.time()
            results = model.predict(frame, device=device, verbose=False)[0]
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
                    
            det_end = time.time()

            # --- Tracking ---
            track_start = time.time()
            tracks = tracker.update(detections)
            track_end = time.time()

            for track in tracks:
                x1, y1, x2, y2 = track.bbox
                track_id = track.track_id
                cx = int((x1 + x2) / 2)
                cy = int((y1 + y2) / 2)
                center = (cx, cy)
                label = f"ID {track_id}"
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 100), 2)
                cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 100), 2)
            
            frame_end_time = time.time()
            elapsed_frame_time = frame_end_time - frame_start_time

            # Guardar métricas
            processing_times.append(elapsed_frame_time)
            detection_times.append(det_end - det_start)
            tracking_times.append(track_end - track_start)

            cv2.imshow("Tracker", frame)
            
        # Mostrar FPS cada segundo
        elapsed = time.time() - start_time
        if elapsed >= 1.0:  # Cada 1 segundo
            fps = processed_frames / elapsed
            print(f"[INFO] FPS por segundo: {fps:.2f} ")
            processed_frames = 0  # Reseteamos los frames procesados en este segundo
            start_time = time.time()  # Reiniciamos el tiempo

        if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        
    cap.release()
    cv2.destroyAllWindows()

    # --- Resultados ---
    if processing_times:
        avg_time = np.mean(processing_times)
        worst_time = np.max(processing_times)
        best_time = np.min(processing_times)
        total_processing_time = time.time() - start_processing_time

        print(f"FPS originales del video: {video_fps}")
        print(f"\nMétricas de procesamiento por frame ( Limitado a {target_fps} fps):")
        print(f"Tiempo promedio: {avg_time:.4f} segundos ({1/avg_time:.2f} FPS aprox)")
        print(f"Peor caso: {worst_time:.4f} segundos ({1/worst_time:.2f} FPS)")
        print(f"Mejor caso: {best_time:.4f} segundos ({1/best_time:.2f} FPS)\n")

        
        print(f"Duración total del video: {video_length:.2f} segundos ({total_frames} frames)")
        print(f"\nTiempo total de procesamiento: {total_processing_time:.2f} segundos")
        print(f"FPS promedio durante el procesamiento: {total_frames / total_processing_time:.2f} FPS")

        print(f"\nMétricas de tiempo (detectar / seguir):")
        print(f"Tiempo promedio de detección: {np.mean(detection_times):.4f} segundos")
        print(f"Tiempo promedio de seguimiento: {np.mean(tracking_times):.4f} segundos")
    else:
        print("No se procesó ningún frame.")


video_path = r'tracker\shopp.mp4'

main(video_path, 20, use_gpu=True)
