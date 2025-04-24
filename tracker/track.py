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
        assigned_tracks = set()
        assigned_detections = set()

        for i, det in enumerate(detections):
            best_iou = self.iou_threshold
            best_track = None

            for track in self.tracks:
                if track in assigned_tracks:
                    continue
                iou_score = self.iou(det, track.bbox)
                if iou_score > best_iou:
                    best_iou = iou_score
                    best_track = track

            if best_track:
                best_track.bbox = det
                best_track.age = 0
                assigned_tracks.add(best_track)
                assigned_detections.add(i)

        for i, det in enumerate(detections):
            if i not in assigned_detections:
                new_track = Track(det, self.next_id)
                self.next_id += 1
                self.tracks.append(new_track)

        for track in self.tracks:
            if track not in assigned_tracks:
                track.age += 1

        self.tracks = [t for t in self.tracks if t.age <= 10]
        return self.tracks
