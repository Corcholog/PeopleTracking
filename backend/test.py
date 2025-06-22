

from collections import defaultdict
import math

import numpy as np


current_tracking_filename = f"21-06-2025-23-08-Trackeo-1.txt"

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

def getDireccion(id,id_frame,lines):
    for line in lines:
        line = line.strip()
        idP,idFi,idFf,movX,movY = list(map(int,line.split(',')))
        if (idP == id):
            if (id_frame >= idFi and id_frame <= idFf):
                return movX,movY
    return None

def has_same_direction(p1X,p1Y,p2,id_frame,lines):
    for line in lines:
        line = line.strip()
        idP,idFi,idFf,movX,movY = list(map(int,line.split(',')))
        if (idP == p2):
            if (id_frame >= idFi and id_frame <= idFf):
                if (movX == p1X and movY == p1Y):
                    return True
    return False


def write_groups(distance_threshold=100):
    with open(current_tracking_filename, 'r') as file:
        lines = file.readlines()[2:]  # Saltar el header
    datos_por_frame = {}
    
    indiceDirecciones = 0
    # Procesar líneas
    for i,line in enumerate(lines):
        line = line.strip()
        if line.startswith("#"):
            indiceDirecciones = i
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
            #no detecta grupos al tomar la dirección que tenemos... , sin la dirección si funcionan por proximidad.
            #direccion = getDireccion(p1['id_persona'], id_frame, lines[indiceDirecciones+2:])
            #if direccion is None:
            #    continue
            #p1X, p1Y = direccion
            visitados.add(p1['id_persona'])
            for j, p2 in enumerate(personas):
                if i != j and p2['id_persona'] not in visitados:
                    #if has_same_direction(p1X,p1Y,p2,id_frame,lines[indiceDirecciones+2:]) and (get_nearest_distance(grupo, p2, datos_por_frame[id_frame]) <= distance_threshold):
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