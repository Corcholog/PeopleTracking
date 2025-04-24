# PeopleTracking

Este repositorio contiene la aplicación distribuida en tres áreas principales: **frontend**, **backend**, y **tracking**, cada una dockerizada dentro de la carpeta `docker/`.

## 📁 Estructura del Proyecto

```
/project-root
│
├── backend/        # Código fuente del backend
├── frontend/       # Aplicación frontend
├── tracking/       # Módulo de procesamiento de datos o IA
├── docker/         # Dockerfiles organizados por módulo
│   ├── backend/
│   ├── frontend/
│   └── tracking/
├── docker-compose.yml
└── README.md
```

---

## 🚀 Cómo levantar el proyecto

1. **Construir los contenedores** (solo la primera vez o cuando cambian los Dockerfiles):
```bash
docker compose build
```

2. **Levantar los servicios:**
```bash
docker compose up
```

3. Acceder al frontend:
- http://localhost:3000

---

## 🔀 Flujo de trabajo en Git

### Ramas principales
- `main`: rama estable para producción
- `develop`: rama de integración para features

### Ramas de trabajo
Cada funcionalidad se desarrolla en una rama `feature/`:

```
feature/frontend-login
feature/backend-auth
feature/tracking-algoritmo
feature/docker-mejora-x
```

> Las ramas deben partir de `develop` y se hacen **Pull Requests a `develop`**, no a `main`.

---

## 📌 Buenas prácticas

- Hacer commits pequeños y descriptivos
- Crear un `Pull Request` por cada feature
- Revisar el código de compañeros antes de aprobar un PR
- Evitar mezclar funcionalidades distintas en un mismo PR

---

## 🛠️ Contribución

1. Crear una rama desde `develop`:
```bash
git checkout develop
git pull origin develop
git checkout -b feature/frontend-login
```
2. Hacer cambios y commits
3. Subir la rama:
```bash
git push origin feature/frontend-login
```
4. Crear un Pull Request a `develop` y pedir revisión
