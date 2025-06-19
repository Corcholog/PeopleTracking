

from collections import defaultdict

import numpy as np


tracking_log_path = f"C:\Projects\PeopleTracking\backend\detecciones.txt"

def clean_parentheses(input_path, output_path):
    with open(input_path, 'r') as infile, open(output_path, 'w') as outfile:
        for line in infile:
            # Quitar paréntesis y espacios
            clean_line = line.replace('(', '').replace(')', '').replace(' ', '')
            # Grabar solo si hay algo
            if clean_line.strip():
                outfile.write(clean_line)

    print(f"Archivo limpio guardado en '{output_path}'.")



def getDirections(tracking_log_path, output_path):
    dataset = np.loadtxt(tracking_log_path, delimiter=',', dtype=float, skiprows=1)
    directions = defaultdict(list)  # {idPersona: [ (idFrame, x1, x2, y1, y2), ... ]}

    # Agrupar por idPersona
    for row in dataset:
        idPersona, idFrame, x1, x2, y1, y2 = row
        directions[int(idPersona)].append((int(idFrame), x1, x2, y1, y2))

    # Archivo para output
    with open(output_path, 'w') as f:
        f.write("idPersona,idFrameInicial,idFrameFinal,movX,movY\n")

        for idPersona, frames in directions.items():
            # Ordenar por idFrame por las dudas
            frames.sort(key=lambda x: x[0])

            movement_begin = frames[0][0]
            idFrame, last_x1, last_x2, last_y1, last_y2 = frames[0]
            last_centre = ((last_x1 + last_x2) / 2, (last_y1 + last_y2) / 2)
            last_x_dir, last_y_dir = 0, 0

            for i in range(1, len(frames)):
                idFrame, x1, x2, y1, y2 = frames[i]
                centre = ((x1 + x2) / 2, (y1 + y2) / 2)

                # Calcular dirección entre el último y el actual
                if last_centre[0] - centre[0] > 0:
                    x_dir = 1   # Derecha
                elif last_centre[0] - centre[0] < 0:
                    x_dir = -1  # Izquierda
                else:
                    x_dir = 0

                if last_centre[1] - centre[1] > 0:
                    y_dir = 1   # Abajo
                elif last_centre[1] - centre[1] < 0:
                    y_dir = -1  # Arriba
                else:
                    y_dir = 0

                # Si cambia dirección
                if (x_dir != last_x_dir or y_dir != last_y_dir):
                    movement_end = idFrame
                    # Escribir en el archivo
                    f.write(f"{idPersona},{movement_begin},{movement_end},{last_x_dir},{last_y_dir}\n")
                    movement_begin = idFrame  # Nuevo segmento

                last_x1, last_x2, last_y1, last_y2 = x1, x2, y1, y2
                last_centre = centre
                last_x_dir, last_y_dir = x_dir, y_dir

            # Al final grabar el último segmento
            movement_end = idFrame
            f.write(f"{idPersona},{movement_begin},{movement_end},{last_x_dir},{last_y_dir}\n")

    print(f"Archivo '{output_path}' generado correctamente.")
clean_parentheses('detecciones.txt', 'detecciones_clean.txt')
getDirections('detecciones_clean.txt', 'directions.txt')