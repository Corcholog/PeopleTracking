from scipy.optimize import linear_sum_assignment
import numpy as np
import cv2

class Track:
    def __init__(self, bbox, track_id):
        self.track_id = track_id
        self.bbox = bbox  # [x1, y1, x2, y2]
        self.age = 0
        self.kalman = self.create_kalman_filter(bbox)

    def create_kalman_filter(self, bbox):
        x_center = (bbox[0] + bbox[2]) / 2
        y_center = (bbox[1] + bbox[3]) / 2

        kf = cv2.KalmanFilter(4, 2)
        kf.measurementMatrix = np.array([[1, 0, 0, 0],
                                         [0, 1, 0, 0]], dtype=np.float32)
        kf.transitionMatrix = np.array([[1, 0, 1, 0],
                                        [0, 1, 0, 1],
                                        [0, 0, 1, 0],
                                        [0, 0, 0, 1]], dtype=np.float32)
        kf.processNoiseCov = np.eye(4, dtype=np.float32) * 1e-2
        kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 1e-1
        kf.errorCovPost = np.eye(4, dtype=np.float32)
        kf.statePost = np.array([[x_center],
                                 [y_center],
                                 [0],
                                 [0]], dtype=np.float32)
        return kf

    def predict(self):
        prediction = self.kalman.predict()
        x, y = prediction[0][0], prediction[1][0]
        w = self.bbox[2] - self.bbox[0]
        h = self.bbox[3] - self.bbox[1]
        self.bbox = [int(x - w / 2), int(y - h / 2), int(x + w / 2), int(y + h / 2)]
        return self.bbox

    def correct(self, bbox):
        x_center = (bbox[0] + bbox[2]) / 2
        y_center = (bbox[1] + bbox[3]) / 2
        self.kalman.correct(np.array([[x_center], [y_center]], dtype=np.float32))
        self.bbox = bbox

    def iou(self, box1, box2):
        xA = max(box1[0], box2[0])
        yA = max(box1[1], box2[1])
        xB = min(box1[2], box2[2])
        yB = min(box1[3], box2[3])

        inter_area = max(0, xB - xA) * max(0, yB - yA)
        if inter_area == 0:
            return 0.0

        box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
        box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
        return inter_area / float(box1_area + box2_area - inter_area)

class SimpleTracker:
    def __init__(self, iou_threshold=0.3):
        self.tracks = []
        self.next_id = 0
        self.iou_threshold = iou_threshold

    def update(self, detections):
        # 1. Predicción de todos los tracks existentes
        for track in self.tracks:
            track.predict()

        # 2. Crear matriz de costos usando 1 - IoU
        cost_matrix = []
        for track in self.tracks:
            row = []
            for det in detections:
                row.append(1 - track.iou(track.bbox, det))
            cost_matrix.append(row)

        matched, unmatched_detections, unmatched_tracks = [], set(range(len(detections))), set(range(len(self.tracks)))

        if len(cost_matrix) > 0:
            cost_matrix = np.array(cost_matrix)
            track_indices, detection_indices = linear_sum_assignment(cost_matrix)

            for t, d in zip(track_indices, detection_indices):
                if cost_matrix[t, d] < (1 - self.iou_threshold):
                    self.tracks[t].correct(detections[d])
                    self.tracks[t].age = 0
                    matched.append(t)
                    unmatched_detections.discard(d)
                    unmatched_tracks.discard(t)

        # 3. Crear nuevos tracks para detecciones no asignadas
        for i in unmatched_detections:
            new_track = Track(detections[i], self.next_id)
            self.next_id += 1
            self.tracks.append(new_track)

        # 4. Incrementar edad para tracks no asignados
        for i in unmatched_tracks:
            self.tracks[i].age += 1

        # 5. Eliminar tracks viejos
        self.tracks = [t for t in self.tracks if t.age <= 6]

        return self.tracks
