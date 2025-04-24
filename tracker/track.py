class Track:
    def __init__(self, bbox, track_id):
        self.bbox = bbox  # [x1, y1, x2, y2]
        self.track_id = track_id
        self.age = 0

class SimpleTracker:
    def __init__(self, iou_threshold=0.5):
        self.tracks = []
        self.next_id = 0
        self.iou_threshold = iou_threshold

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

    def update(self, detections):
        updated_tracks = []
        for det in detections:
            matched = False
            for track in self.tracks:
                if self.iou(det, track.bbox) > self.iou_threshold:
                    track.bbox = det
                    track.age = 0
                    updated_tracks.append(track)
                    matched = True
                    break
            if not matched:
                new_track = Track(det, self.next_id)
                self.next_id += 1
                updated_tracks.append(new_track)
        # Aumentar edad y filtrar
        for track in updated_tracks:
            track.age += 1
        self.tracks = [t for t in updated_tracks if t.age <= 5]
        return self.tracks