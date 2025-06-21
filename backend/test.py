

from collections import defaultdict
import math

import numpy as np


current_tracking_filename = f"21-06-2025-22-45-Trackeo-1.txt"

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

def write_groups(distance_threshold=100):
    with open(current_tracking_filename, 'r') as file:
        lines = file.readlines()[2:]  # Saltar el header
    datos_por_frame = {}
    
    # Procesar líneas
    for line in lines:
        line = line.strip()
        if line.startswith("#"):
            break
        
        id_persona, id_frame, x1, x2, y1, y2 = list(map(int, line.split(',')))
        centro = get_centre(x1, x2, y1, y2)
        
        if id_frame not in datos_por_frame:
            datos_por_frame[id_frame] = []
        datos_por_frame[id_frame].append({
            'id_persona': id_persona,
            'centro': centro
        })
    
    grupos_detectados = []

    for id_frame, personas in datos_por_frame.items():
        visitados = set()

        for i, p1 in enumerate(personas):
            if p1['id_persona'] in visitados:
                continue
            grupo = [p1['id_persona']]
            visitados.add(p1['id_persona'])
            for j, p2 in enumerate(personas):
                if i != j and p2['id_persona'] not in visitados:
                    print(f"Comparando {p1['id_persona']} con {p2['id_persona']} en frame {id_frame}")
                    print(f"grupo: {grupo}")
                    print(f"datos_frame: {datos_por_frame[id_frame]}")
                    if get_nearest_distance(grupo, p2, datos_por_frame[id_frame]) <= distance_threshold:
                        grupo.append(p2['id_persona'])
                        visitados.add(p2['id_persona'])
            if len(grupo) > 1:
                grupos_detectados.append({
                    'frame': id_frame,
                    'grupo_ids': grupo
                })

    # Guardar resultado
    with open(current_tracking_filename, 'a') as f:
        f.write("# INICIO GRUPOS DE SIMILAR COMPORTAMIENTO\n")
        for grupo in grupos_detectados:
            f.write(f"Frame {grupo['frame']}: IDs {grupo['grupo_ids']}\n")

write_groups(distance_threshold=100)
print("Grupos de personas detectados y escritos en el archivo.")