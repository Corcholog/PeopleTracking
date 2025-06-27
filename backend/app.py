import sys
import os
import cv2
import asyncio
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from ultralytics import YOLO
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from yt_dlp import YoutubeDL
import torch
import json
import math
from yt_dlp import YoutubeDL
from datetime import datetime
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi import BackgroundTasks
from collections import defaultdict, deque
from typing import List, Dict
import base64
import time

# 1) Detecta si está bundlado o en desarrollo
if getattr(sys, 'frozen', False):
    base_dir = sys._MEIPASS
else:
    # Asume que este archivo está en backend/, sube un nivel
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# 2) Inserta la carpeta padre en sys.path (PeopleTracking/)
sys.path.insert(0, base_dir)

# 3) Ahora sí importamos cosas de tracker/
from tracker.tracker import get_predict, draw, reset, set_confidence, set_gpu_usage

# ---------------------------------------------------
# 6) Thread pool para no bloquear el loop de asyncio
# ---------------------------------------------------
cpu_count = os.cpu_count() or 1
executor = ThreadPoolExecutor(max_workers=cpu_count)
warmup_gpu = False
warmup_cpu = False
ready = False
stream_url = False
url = False
fps_default = 24

# --------------------------------------------------
# 7) FastAPI con lifespan para warm‑up
# --------------------------------------------------
hardware_status = {"gpu_available": False}

# Other global variables
is_recording = False
recording_filename = None
recording_ready = False

@asynccontextmanager
async def lifespan(app: FastAPI):
    global warmup_gpu, warmup_cpu, hardware_status, ready
    if torch.cuda.is_available():
        set_gpu_usage(True)
        warmup_gpu = True
        hardware_status["gpu_available"] = True
    else:
        warmup_cpu = True
        hardware_status["gpu_available"] = False
    # Warm-up del modelo
    dummy = np.zeros((480, 640, 3), np.uint8)
    _, _, _ = get_predict(dummy)
    print("✅ Modelo calentado")
    ready = True
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------
# 8) Estado compartido
# ---------------------------------------------------
current_id = None
config_state = {"confidence_threshold": 0.5, "gpu": True, "fps": fps_default, "resolution": (1920, 1080)}

class IDPayload(BaseModel):
    id: int

class ConfigPayload(BaseModel):
    confidence: float = 0.5
    gpu: bool = False
    fps: int = fps_default

class Metrics(BaseModel):
    frame_number: int
    total_tracked: int
    tracking_data: List[Dict[str, any]]  # Datos generales (track_id, centro, bbox)
    directions: Dict[int, List[str]]  # ID de persona -> direcciones
    groups: List[Dict[str, List[int]]]  # ID de grupo y miembros

    class Config:
        arbitrary_types_allowed = True

# ---------------------------------------------------
# 9) Utilidad de zoom (opcional)
# ---------------------------------------------------
def apply_zoom(frame, center, zoom_factor=1.5):
    if center is None or current_id is None:
        return frame
    x, y = center
    h, w = frame.shape[:2]
    new_w, new_h = int(w / zoom_factor), int(h / zoom_factor)
    x1 = max(0, x - new_w // 2); y1 = max(0, y - new_h // 2)
    x2 = min(w, x + new_w // 2); y2 = min(h, y + new_h // 2)
    crop = frame[y1:y2, x1:x2]
    return cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)





# ---------------------------------------------------
# 10) Endpoint WebSocket para análisis
# ---------------------------------------------------

# ---------------------------------------------------
#  escribir en archivo para  metricas generales
# ---------------------------------------------------

tracking_counter = 0  # Contador de trackeos realizados
current_tracking_id = None
current_tracking_filename = None

# Función mejorada para generar nombres de archivo únicos
def generate_tracking_filename():
    global tracking_counter, current_tracking_id
    tracking_counter += 1
    timestamp = datetime.now().strftime("%d-%m-%Y-%H-%M")
    tracking_id = f"Trackeo-{tracking_counter}"
    current_tracking_id = tracking_id
    filename = f"{timestamp}-{tracking_id}.txt"
    return filename

tracking_data_metrics = []
tracking_data_last_frame = []  # Lista de (id_persona, centro) del frame actual

def addTrackingGenericMetrics(frame_number, tracks):
    global tracking_data_metrics, tracking_data_last_frame
    tracking_data_last_frame = []  # Reiniciar para el nuevo frame
    
    for t in tracks:
        x1, y1, x2, y2 = t.bbox
        tracking_data_metrics.append((t.track_id, frame_number, x1, x2, y1, y2))

        centro = get_centre(x1, x2, y1, y2)
        tracking_data_last_frame.append({
            'id_persona': t.track_id,
            'centro': centro
        })
        
previous_directions = {}
history_points = defaultdict(lambda: deque(maxlen=5))
angle_threshold = 90 # Grados para detectar cambio de rumbo
angle_diff_threshold = 20  # Grados para detectar cercanía de dirección entre personas

direction_strings = defaultdict(list) # Array indexed by idPersona, with direction strings

def direction_to_text(vec):
    x, y = vec
    if np.allclose(vec, [0, 0]):
        return "P" # Stopped
    angle = np.degrees(np.arctan2(y, x)) % 360
    if 337.5 <= angle or angle < 22.5:
        return "D" # East
    elif 22.5 <= angle < 67.5:
        return "Q" # Northeast
    elif 67.5 <= angle < 112.5:
        return "W" # North
    elif 112.5 <= angle < 157.5:
        return "E" # Northwest
    elif 157.5 <= angle < 202.5:
        return "A" # West
    elif 202.5 <= angle < 247.5:
        return "Z" # Southwest
    elif 247.5 <= angle < 292.5:
        return "S" # South
    else:
        return "C" # Southeast

def detect_directions(frame_number, tracks):
    """
    Calcula la dirección actual por persona usando su historial y detecta cambios de rumbo.
    """
    global previous_directions, history_points, direction_strings

    direction_strings = defaultdict(list)

    for t in tracks:
        idPersona = t.track_id
        x1, y1, x2, y2 = t.bbox
        centro = get_centre(x1, x2, y1, y2)
        history_points[idPersona].append((frame_number, centro))

        if len(history_points[idPersona]) < 2:
            continue

        frames_arr = np.array([f for f, _ in history_points[idPersona]])
        xs = np.array([p[0] for _, p in history_points[idPersona]])
        ys = np.array([p[1] for _, p in history_points[idPersona]])

        a_x, _ = np.polyfit(frames_arr, xs, 1)
        a_y, _ = np.polyfit(frames_arr, ys, 1)

        vec = np.array([a_x, -a_y])
        norm = np.linalg.norm(vec)
        if norm == 0:
            direction = np.array([0.0, 0.0])
        else:
            direction = vec / norm

        dir_text = direction_to_text(direction)
        
        direction_strings[idPersona].append(dir_text)

        previous_directions[idPersona] = direction


def get_centre(x1, x2, y1, y2):
    return ((x1 + x2) // 2, (y1 + y2) // 2)

def get_distance(p1, p2):
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

def get_nearest_distance(
    group1: list[int],
    person: dict[str, any],
    datos_frame: list[dict[str, any]]
):
    min_distance = float('inf')
    
    for p in group1:
        # Buscar el dato correspondiente a p en datos_frame
        dato_p = next((i for i in datos_frame if i['id_persona'] == p), None)
        
        if dato_p is not None:
            distance = get_distance(dato_p['centro'], person['centro'])
            if distance < min_distance:
                min_distance = distance
    
    return min_distance

grupos_detectados = []

# Historial de grupos detectados
grupos_historicos = {}  # {grupo_id: set(person_ids)}
siguiente_grupo_id = 1
grupos_activos_frame_anterior = set()

def encontrar_grupo_existente(nuevo_grupo_ids, grupos_historicos):
    """
    Busca si ya existe un grupo con al menos el 50% de coincidencia
    """
    nuevo_set = set(nuevo_grupo_ids)
    mejor_coincidencia = None
    mejor_score = 0
    
    for grupo_id, grupo_existente in grupos_historicos.items():
        interseccion = nuevo_set.intersection(grupo_existente)
        if len(interseccion) > 0:
            # Porcentaje de coincidencia basado en el grupo más pequeño
            score = len(interseccion) / min(len(nuevo_set), len(grupo_existente))
            if score > mejor_score and score >= 0.5:  # Al menos 50% de coincidencia
                mejor_score = score
                mejor_coincidencia = grupo_id
    
    return mejor_coincidencia

def have_same_direction(id1, id2, previous_directions, angle_threshold=20):
    """
    Devuelve True si las dos personas tienen direcciones similares
    según el umbral de ángulo (en grados).
    """
    v1 = previous_directions.get(id1)
    v2 = previous_directions.get(id2)
    if v1 is None or v2 is None:
        return False  # No hay datos de dirección suficientes

    dot = np.clip(np.dot(v1, v2), -1.0, 1.0)
    angle = np.degrees(np.arccos(dot))
    
    return angle < angle_threshold

def getGroupsRealTime(distance_threshold=100, angle_threshold=20):
    global grupos_historicos, siguiente_grupo_id, grupos_activos_frame_anterior
    
    grupos_detectados_frame = []
    visitados = set()
    grupos_activos_frame_actual = set()

    personas = tracking_data_last_frame

    for i, p1 in enumerate(personas):
        if p1['id_persona'] in visitados:
            continue
        
        grupo = [p1['id_persona']]
        visitados.add(p1['id_persona'])

        for j, p2 in enumerate(personas):
            if i == j or p2['id_persona'] in visitados:
                continue

            if get_nearest_distance(grupo, p2, personas) <= distance_threshold and \
               have_same_direction(p1['id_persona'], p2['id_persona'], previous_directions, angle_threshold):
                grupo.append(p2['id_persona'])
                visitados.add(p2['id_persona'])

        # Solo procesar si es realmente un grupo (más de 1 persona)
        if len(grupo) > 1:
            # Buscar si ya existe un grupo con estos IDs
            grupo_id_existente = encontrar_grupo_existente(grupo, grupos_historicos)
            
            if grupo_id_existente:
                # Actualizar el grupo existente
                grupos_historicos[grupo_id_existente] = set(grupo)
                grupo_id_final = grupo_id_existente
            else:
                # Crear nuevo grupo
                grupo_id_final = siguiente_grupo_id
                grupos_historicos[siguiente_grupo_id] = set(grupo)
                siguiente_grupo_id += 1
            
            grupos_activos_frame_actual.add(grupo_id_final)
            
            grupos_detectados_frame.append({
                'id_grupo': [grupo_id_final],  # ✅ Mantener como lista
                'grupo_ids': grupo
            })

    # Limpiar grupos que no han sido detectados en varios frames
    # (opcional: puedes ajustar esta lógica según tus necesidades)
    grupos_a_eliminar = []
    for grupo_id in grupos_historicos:
        if grupo_id not in grupos_activos_frame_actual and grupo_id not in grupos_activos_frame_anterior:
            # Si un grupo no aparece en 2 frames consecutivos, lo eliminamos del historial
            grupos_a_eliminar.append(grupo_id)
    
    for grupo_id in grupos_a_eliminar:
        del grupos_historicos[grupo_id]
    
    grupos_activos_frame_anterior = grupos_activos_frame_actual.copy()
    
    return grupos_detectados_frame

            
@app.websocket("/ws/analyze/")
async def analyze(ws: WebSocket):
    def init_video_writer(frame):
        nonlocal video_writer
        global recording_filename, config_state
        height, width = frame.shape[:2]
        default_fps = config_state.get("fps", 20) 
        stream_fps = None
        if cap:
            stream_fps = cap.get(cv2.CAP_PROP_FPS)
            if stream_fps and stream_fps > 1:
                # Se compara si el usuario quiere más fps de los que el stream permite
                if default_fps > stream_fps:
                    default_fps = stream_fps

        timestamp = datetime.now().strftime("%d-%m-%Y-%H-%M-%S")
        filename = f"recording-{timestamp}.mp4"
        recording_filename = filename

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        video_writer = cv2.VideoWriter(filename, fourcc, default_fps, (width, height))
        print(f"🎥 Grabando video en: {filename}")

    await ws.accept()
    await ws.send_json({"type": "ready", "status": True})

    try:
        video_writer = None
        global current_id, video_url, stream_url, is_recording, recording_ready
        cap = None
        frame_number = 1

        while True:
            frame = None

            ## parte agarrar video
            if stream_url and video_url:
                if cap is None:
                    cap = cv2.VideoCapture(video_url)
                    if not cap.isOpened():
                        await ws.send_json({"type": "error", "message": "No se pudo abrir el stream"})
                        print("❌ No se pudo abrir el stream")
                        break

                ret, frame = cap.read()
                if not ret:
                    print("❌ No se pudo leer el frame del stream")
                    await asyncio.sleep(0.1)
                    continue
            else:
                message = await ws.receive()

                if message["type"] == "websocket.disconnect":
                    print("Cliente desconectado")
                    break

                if message["type"] == "websocket.receive":
                    if "text" in message:
                        try:
                            data = message["text"]
                            parsed = json.loads(data)
                            if isinstance(parsed, dict) and parsed.get("type") == "stop":
                                print("🛑 Solicitud de detener recibida (JSON)")
                                break
                        except json.JSONDecodeError:
                            if data.strip().lower() == "stop":
                                print("🛑 Solicitud de detener recibida (texto plano)")
                                break
                    elif "bytes" in message:
                        nparr = np.frombuffer(message["bytes"], np.uint8)
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        if frame is None:
                            continue

            if frame is None:
                continue

            if is_recording and video_writer is None:
                init_video_writer(frame)

            loop = asyncio.get_running_loop()
            try:
                frame_pred, tracks, center = await loop.run_in_executor(
                    executor, get_predict, frame, current_id
                )
            except Exception as e:
                print("❌ Error en get_predict:", e)
                continue

            annotated = draw(frame_pred, tracks)
            if is_recording and video_writer is not None:
                video_writer.write(annotated)
            
            if not is_recording and video_writer is not None:
                video_writer.release()
                recording_ready = True
                video_writer = None
                frame_number = 1
                print("💾 Grabación finalizada sin detener el tracking.")

            if center:
                annotated = apply_zoom(annotated, center)

            await ws.send_json({
                "type": "lista_de_ids",
                "detections": [{"id": t.track_id, "bbox": t.bbox} for t in tracks],
                "selected_id": current_id
            })

            addTrackingGenericMetrics(frame_number, tracks)
            detect_directions(frame_number, tracks)
            #print(f"ultima direccion de todas las personas: {direction_strings}")

            # 🔹 Detectar grupos en el frame actual
            grupos_actuales = getGroupsRealTime(
                distance_threshold=config_state.get("resolution", (1920, 1080))[1] // 10,
                angle_threshold=angle_diff_threshold
            )
            if grupos_actuales:
                print(f"🟢 Grupos detectados en frame {frame_number}:")
                for grupo in grupos_actuales:
                    print(f"   Grupo {grupo['id_grupo']}: {grupo['grupo_ids']}")
                print(f"📊 Historial de grupos: {dict(grupos_historicos)}")
            else:
                print(f"🔹 Sin grupos detectados en frame {frame_number}")

            metrics = Metrics(
                frame_number=frame_number,
                total_tracked=len(tracks),
                tracking_data=[
                    {
                        "id_persona": data["id_persona"],
                        "centro": data["centro"],
                        "bbox": [
                            t.bbox[0],
                            t.bbox[1],
                            t.bbox[2],
                            t.bbox[3]
                        ]
                    }
                    for t, data in zip(tracks, tracking_data_last_frame)
                ],
                directions={person: direction_strings[person] for person in direction_strings},
                groups=grupos_actuales
            )
            print(f"METRICAS: \n{metrics}\n\n")

            # Enviar datos y métricas al frontend
            await ws.send_json({
                "type": "metrics_and_detections",
                "detections": [{"id": t.track_id, "bbox": t.bbox} for t in tracks],
                "metrics": metrics.model_dump(),
                "selected_id": current_id
            })

            frame_number += 1

            _, buf = cv2.imencode(".jpg", annotated)
            combined_data = {
                "type": "frame_with_metrics",
                "frame_number": frame_number,
                "metrics": metrics.model_dump(),
                "detections": [{"id": t.track_id, "bbox": t.bbox} for t in tracks],
                "selected_id": current_id,
                "image": base64.b64encode(buf.tobytes()).decode(),
                "timestamp": time.time() * 1000  # timestamp en milisegundos
            }
            await ws.send_json(combined_data)

            if stream_url and video_url:
                await asyncio.sleep(0.03)

    except WebSocketDisconnect:
        print("Cliente desconectado")
    except Exception:
        import traceback; traceback.print_exc()
    finally:
        try:
            await ws.send_json({"type": "stopped"})
            await ws.close()
        except:
            pass
        print("🛑 Handler WebSocket terminado.")
        if cap:
            cap.release()
# ---------------------------------------------------
# 11) Endpoints REST para control
# ---------------------------------------------------
@app.post("/reset_model/")
async def reset_model(request: Request):
    global current_id
    current_id = None
    reset()
    reset_groups()
    return {"status": "model reset"}

@app.post("/set_id/")
async def set_id(payload: IDPayload):
    global current_id
    current_id = payload.id
    return {"status": "id updated"}

@app.post("/clear_id/")
async def clear_id():
    global current_id
    current_id = None
    reset_groups()
    return {"status": "id cleared"}

@app.post("/config/")
async def update_config(payload: ConfigPayload):
    global warmup_gpu, warmup_cpu
    if payload.confidence is not None:
        set_confidence(payload.confidence)
        config_state["confidence_threshold"] = payload.confidence
    if payload.gpu is not None:
        if set_gpu_usage(payload.gpu):
            if not warmup_gpu:
                dummy = np.zeros((480, 640, 3), np.uint8)
                _, _, _ = get_predict(dummy)
                warmup_gpu = True
                warmup_cpu = False
        else:
            if not warmup_cpu:
                dummy = np.zeros((480, 640, 3), np.uint8)
                _, _, _ = get_predict(dummy)
                warmup_cpu = True
                warmup_gpu = False
        config_state["gpu"] = payload.gpu
    if payload.fps is not None:
        config_state["fps"] = payload.fps
        print(f"[CONFIG] FPS set to: {payload.fps}")
    if payload.res is not None:
        try:
            width, height = map(int, payload.res.split("x"))
            if width > 0 and height > 0:
                config_state["resolution"] = (width, height)
                print(f"[CONFIG] Resolution set to: {width}x{height}")
            else:
                raise ValueError("Invalid resolution values")
        except Exception as e:
            print(f"[CONFIG] Error setting resolution: {e}")
            return JSONResponse(status_code=400, content={"error": "Invalid resolution format"})
    print(f"[CONFIG] {config_state}")
    return {"status": "ok", "new_state": config_state}

@app.get("/hardware_status/")
async def get_hardware_status():
    return hardware_status

@app.get("/status/")
async def get_status():
    global ready
    print(f"estado de ready: {ready}")
    return {"ready": ready}

@app.post("/start_recording/")
async def start_recording():
    global is_recording
    is_recording = True
    return {"status": "recording started"}

@app.post("/stop_recording/")
async def stop_recording(background_tasks: BackgroundTasks):
    global is_recording, recording_filename, recording_ready
    is_recording = False
    global current_tracking_filename


    for _ in range(50):  # Espera máx. ~5 segundos
        if recording_ready:
            break
        await asyncio.sleep(0.1)

    if recording_filename and os.path.exists(recording_filename):
        filename_to_send = recording_filename
        recording_filename = None
        recording_ready = False  # Reset

        background_tasks.add_task(os.remove, filename_to_send)

        for person, directions in direction_strings.items():
            print(f"Persona {person} direcciones: {directions}")
        return FileResponse(
            path=filename_to_send,
            media_type="video/mp4",
            filename=os.path.basename(filename_to_send),
            background=background_tasks
        )


    return JSONResponse(status_code=404, content={"error": "No recording found"})
# ---------------------------------------------------
# Endpoints Stream
stream_url = False
url = None
video_url = None  # Aquí guardaremos la URL real del stream de YouTube

def get_youtube_stream_url(youtube_link, max_height=None):
    ydl_opts = {
        'quiet': True,
        'noplaylist': True,
        'skip_download': True,
    }
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(youtube_link, download=False)
        formats = info.get('formats', [])

        if max_height is not None:
            # Filtrar formatos con video y url donde la altura sea menor o igual a max_height
            filtered_videos = [
                f for f in formats
                if f.get('height') and f['height'] <= max_height
                   and f.get('vcodec') and f['vcodec'] != 'none'
                   and f.get('url')
            ]
            if filtered_videos:
                best_video = max(filtered_videos, key=lambda f: f['height'])
                return best_video['url']
            else:
                # Si no encontró ninguno que cumpla, devolver el mejor formato mp4 sin filtro
                best_video = ydl.prepare_filename(info)
                # Alternativamente, devolver el URL sin filtrar (ejemplo: el mejor disponible)
                return info.get('url')
        else:
            # Si no se especificó max_height, devolvemos la mejor calidad mp4 disponible
            # O fallback a la URL del video directamente
            for f in formats:
                if f.get('ext') == 'mp4' and f.get('vcodec') != 'none':
                    return f['url']
            return info.get('url')




@app.post("/upload-url/")
async def upload_url(request: Request):
    global stream_url, url, video_url
    data = await request.json()

    stream_url = bool(data.get("stream_url"))  # por si viene como string
    url = data.get("imageUrl")
    resolution = data.get("resolution")

    if stream_url and url:
        try:
            max_height = None
            if resolution:
                try:
                    max_height = int(resolution.split("x")[1])
                except Exception:
                    max_height = None

            video_url = get_youtube_stream_url(url, max_height)
            print(f"URL de video obtenida: {video_url}")
        except Exception as e:
            print(f"Error al obtener stream de YouTube: {e}")
            video_url = None
    else:
        video_url = None  # por si estás subiendo una imagen normal, no YouTube

    print(f"Stream URL: {stream_url}")
    return {"status": "ok", "video_url": video_url}

@app.post("/clear-url/")
async def clear_url():
    global stream_url, url
    stream_url = False
    url = False
    reset_groups()
    return {"status": "ok"}

def reset_groups():
    global grupos_historicos, siguiente_grupo_id, grupos_activos_frame_anterior
    grupos_historicos = {}
    siguiente_grupo_id = 1
    grupos_activos_frame_anterior = set()
    return {"status": "groups reset"}