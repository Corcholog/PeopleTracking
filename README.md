# PeopleTracking

Real-time person detection and tracking over video, split into three parts — a **tracker**, a **backend** and a
**frontend** — each one dockerized on its own.

> University course project (FollowUP). The repository keeps the sample videos and the YOLO weights, which is why a
> full clone is around 190 MB: `git clone --depth 1` is enough to read the code.

## What it does

- **Detection.** Ultralytics YOLOv8n on every frame, keeping the `person` class above a 0.5 confidence threshold.
- **Tracking.** `tracker/track.py` implements the tracker from scratch: an IoU-based multi-object tracker
  (`SimpleTracker`) that matches detections to existing tracks by intersection over union, opens a new track with a
  stable id for every unmatched detection, and drops a track once it has been missed six times.
- **Streaming.** `backend/app.py` is a FastAPI service that runs the model and pushes the annotated frames over a
  WebSocket, so the browser receives the video instead of polling for images.
- **Display.** `frontend/` is a Next.js app (App Router, React 19, Tailwind CSS v4) with a dashboard and a video
  player.

## Layout

```
backend/             FastAPI service: detection and the WebSocket stream of the annotated frames
tracker/             offline mode: reads a video file, tracks people and draws the boxes
  track.py           the tracker itself (IoU matching, track ids, track ageing)
  main.py            the offline loop: detection, tracking and drawing
frontend/            Next.js dashboard
docker/              one Dockerfile per module
docker-compose.yml   backend and frontend
```

## Running it

```bash
docker compose build     # first time, or when a Dockerfile changes
docker compose up
```

- frontend: http://localhost:3000
- backend: http://localhost:8000 — the annotated stream is at `ws://localhost:8000/ws/track/`

The offline mode runs against a local video file instead:

```bash
cd tracker
python main.py            # reads videotracker.mp4
```

## Stack

Python 3 · OpenCV · Ultralytics YOLOv8n · FastAPI · WebSockets · Next.js 15 · React 19 · Tailwind CSS v4 · Docker

## Git workflow

`main` is the stable branch, `develop` is the integration branch, and every feature lives in its own `feature/…`
branch with a pull request into `develop`.

## Notes

- The sample videos (`messi.mp4`, `shopp.mp4`, `videotracker.mp4`) and the `yolov8n.pt` weights are committed, so the
  repository is heavy.
- The offline mode downsamples the video to a target frame rate (20 fps by default) before running the model.
