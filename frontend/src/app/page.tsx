"use client";
import { useEffect, useRef, useState } from "react";
import ReconnectingWebSocket from "reconnecting-websocket";
import styles from "./page.module.css";

export default function DashboardPage() {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotatedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<ReconnectingWebSocket | null>(null);

  // Listar cámaras disponibles
  useEffect(() => {
    async function listarCamaras() {
      await navigator.mediaDevices.getUserMedia({ video: true });
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "videoinput"));
    }
    listarCamaras();
  }, []);

  // Cambiar a cámara seleccionada
  useEffect(() => {
    if (!selectedDevice) return;
    let stream: MediaStream;

    const constraints: MediaStreamConstraints = {
      video: { deviceId: { exact: selectedDevice } },
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        console.warn("Error con cámara específica:", err);
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        setSelectedDevice("");
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    })();

    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [selectedDevice]);

  // WebSocket: enviar frames y recibir respuesta
  useEffect(() => {
    if (!isTracking || !videoRef.current || !rawCanvasRef.current || !annotatedCanvasRef.current) return;

    wsRef.current = new ReconnectingWebSocket("ws://localhost:8000/ws/analyze/");
    wsRef.current.binaryType = "arraybuffer";

    wsRef.current.onmessage = (evt) => {
      const bytes = new Uint8Array(evt.data as ArrayBuffer);
      const blob = new Blob([bytes], { type: "image/jpeg" });
      const img = new Image();
      img.onload = () => {
        const ctx = annotatedCanvasRef.current!.getContext("2d");
        annotatedCanvasRef.current!.width = img.width;
        annotatedCanvasRef.current!.height = img.height;
        ctx?.drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(blob);
    };

    const intervalId = window.setInterval(() => {
      const videoEl = videoRef.current!;
      const canvas = rawCanvasRef.current!;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(videoEl, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) wsRef.current?.send(blob);
      }, "image/jpeg", 0.7);
    }, 100);

    return () => {
      window.clearInterval(intervalId);
      wsRef.current?.close();
    };
  }, [isTracking]);

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const videoUrl = URL.createObjectURL(file);
      setVideoSrc(videoUrl);
      setIsCameraActive(false);
      setIsTracking(false);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleStartCamera = () => {
    setVideoSrc(null);
    setIsCameraActive(true);
    setIsTracking(false);
  };

  const handleStopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
    setIsCameraActive(false);
    setIsTracking(false)
    setVideoSrc(null);
    setSelectedDevice("");
  };

  const handleStartTracking = () => {
    setIsTracking(true);
    setVideoSrc(null);
    setIsCameraActive(true);

    if (videoRef.current) {
      videoRef.current.play().catch(error => {
        console.error("Error al intentar reproducir el video:", error);
      });
    }
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className={styles.layoutContainer}>
      {isSidebarOpen && (
        <div className={styles.sidebar}>
          <button onClick={() => setIsSidebarOpen(false)} className={styles.collapseButton}>
            {"<"}
          </button>
          <details className={styles.zoomDropdown}>
            <summary>Seleccion Zoom</summary>
            <div className={styles.zoomScrollContainer}>
              {Array.from({ length: 20 }).map((_, i) => (
                <button key={i}>Zoom Persona {i + 1}</button>
              ))}
            </div>
          </details>
          <details className={styles.trackingDropdown}>
            <summary> Configuración tracking</summary>
            <div className={styles.optionsContainer}>
              {/* Unidad de procesamiento */}
              <div className={styles.trackingOption}>
                <label>Unidad de procesamiento:</label><br></br>
                <select defaultValue="cpu">
                  <option value="cpu">CPU</option>
                  <option value="gpu">GPU</option>
                </select>
              </div>

              {/* FPS */}
              <div className={styles.trackingOption}>
                <label>FPS deseados:</label><br></br>
                <input type="number" min="1" max="60" defaultValue="30"/>
              </div>

              {/* Porcentaje de confianza */}
              <div className={styles.trackingOption}>
                <label>Porcentaje de confianza (%):</label><br></br>
                <input type="number" min="0" max="100" defaultValue="90"/>
              </div>
            </div>
          </details>
        </div>
      )}

      {!isSidebarOpen && (
        <button onClick={() => setIsSidebarOpen(true)} className={styles.expandButton}>
          {">"}
        </button>
      )}

      <main className={styles.main}>
        <div className={styles.header}>
          <h1 className={styles.title}>Seleccionar fuente de imagen</h1>
          <div className={styles.buttonGroup}>
            {!videoSrc && !isCameraActive && (
              <>
                <button onClick={handleStartCamera}>Cámara del dispositivo</button>
                <button onClick={() => fileInputRef.current?.click()}>Subir archivo</button>
              </>
            )}
            {(videoSrc || isCameraActive) && (
              <>
                <button onClick={handleStopCamera}>Eliminar fuente de video</button>
                {!isTracking && (
                  <button onClick={handleStartTracking}>Iniciar Tracking</button>
                )}
              </>
            )}
            {isCameraActive && !videoSrc && !isTracking && (
              <select
                className={styles.selectCamera}
                onChange={(e) => setSelectedDevice(e.target.value)}
                value={selectedDevice}
              >
                <option value="">-- Seleccionar cámara --</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Cámara ${d.deviceId.slice(0, 5)}`}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className={styles.videoContainer}>
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              autoPlay
              muted
              className={styles.videoElement}
            />
          ) : isTracking ? (
            <>
              <video
                ref={videoRef}
                src={videoSrc || undefined}
                autoPlay
                muted
                controls={false}
                style={{ display: "none" }}
              />
              <canvas ref={annotatedCanvasRef} className={styles.videoElement} />
            </>
          ) : isCameraActive ? (
            <video ref={videoRef} autoPlay muted className={styles.videoElement} />
          ) : (
            <p className={styles.textVideoContainer}>Esperando fuente de video</p>
          )}
        </div>

        <input
          type="file"
          accept="video/*"
          onChange={handleVideoChange}
          className={styles.hidden}
          ref={fileInputRef}
        />

        <canvas ref={rawCanvasRef} style={{ display: "none" }} />
      </main>
    </div>
  );

}