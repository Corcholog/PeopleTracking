FROM python:3.11-slim
WORKDIR /app

# Reinstala librerías de sistema necesarias para OpenCV en runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
     gcc \
      libglib2.0-0 \
      libsm6 \
      libxrender1 \
      libxext6 \
      libgl1-mesa-glx \
 && rm -rf /var/lib/apt/lists/*

COPY docker/backend/requirements.txt /app/
RUN python -m pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip cache purge \
    && rm -rf /root/.cache


EXPOSE 8000

# Arranca Uvicorn con uvloop + httptools
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--loop", "uvloop", "--http", "httptools", "--workers", "1"]
