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
  const [processingUnit, setProcessingUnit] = useState("gpu");
  const [fpsLimit, setFpsLimit] = useState(30);
  const [confidenceThreshold, setConfidenceThreshold] = useState(50);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotatedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<ReconnectingWebSocket | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isFirstReady, setisFirstReady] = useState(false);

  const [detections, setDetections] = useState<Array<{ id: number; bbox: number[] }>>([]);
  const [selectedId, setSelectedId] = useState(null);

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

    // Iniciar WebSocket y esperar el “ready”
  useEffect(() => {
    const ws = new ReconnectingWebSocket("ws://localhost:8000/ws/analyze/");
    ws.binaryType = "arraybuffer";  // recibir binarios :contentReference[oaicite:3]{index=3}
    ws.onmessage = (evt) => {
      if (typeof evt.data === "string") {
        // Mensaje JSON: ready o errores
        const msg = JSON.parse(evt.data);
        if (msg.type === "ready") {
          setIsReady(msg.status);
          setisFirstReady(true);
          if (msg.status) {
            wsRef.current = ws;
          }
        }
      }
    };
    return () => ws.close();
  }, []);

// WebSocket: enviar frames y recibir respuesta
  useEffect(() => {
    if (!isTracking || !videoRef.current || !rawCanvasRef.current || !annotatedCanvasRef.current) return;
    conectionWebSocket();
    const ws = wsRef.current!;

    ws.onmessage = (evt) => {

      if (typeof evt.data === "string") {
        // Mensaje JSON: ready o errores
        const msg = JSON.parse(evt.data);
        if (msg.type === "lista_de_ids") {
          console.log("🔍 Detections recibidas:", msg.detections);
          console.log("🎯 ID seleccionado:", msg.selected_id);

          // Aca estan los datos
          setDetections(msg.detections);
          setSelectedId(msg.selected_id);
        }
      }
      else {
        // Mensaje binario: ArrayBuffer
        const bytes = new Uint8Array(evt.data as ArrayBuffer);
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const img = new Image();
        img.onload = () => {
          if (!annotatedCanvasRef.current) return;
          const ctx = annotatedCanvasRef.current.getContext("2d");
          if (!ctx) return;
          annotatedCanvasRef.current!.width = img.width;
          annotatedCanvasRef.current!.height = img.height;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(blob);
      }
    };

    const intervalId = setInterval(() => {
      const videoEl = videoRef.current!;
      const canvas = rawCanvasRef.current!;
      if (ws.readyState !== WebSocket.OPEN) return;
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(videoEl, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) ws.send(blob);  // envía binario puro :contentReference[oaicite:4]{index=4}
      }, "image/jpeg", 0.7);
    }, 1000 / fpsLimit);

    return () => {
      window.clearInterval(intervalId);
      wsRef.current?.close();
    };
  }, [isTracking, fpsLimit]); // se ejecuta cada vez que cambia isTracking o fpsLimit

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if(isFirstReady)
        fetch("http://localhost:8000/reset_model/", { method: "POST" });
    } catch (err) {
        console.error("Todavia no cargo el backend:", err);
    }
    conectionWebSocket();
    const file = event.target.files?.[0];
    if (file) {
      const videoUrl = URL.createObjectURL(file);
      console.log("direccion:", videoUrl);
      setVideoSrc(videoUrl);
      setIsCameraActive(false);
      setIsTracking(false);
      setDetections([]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    resetId();
  };

  const conectionWebSocket = () => {
    if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
      const ws = new ReconnectingWebSocket("ws://localhost:8000/ws/analyze/");
      ws.binaryType = "arraybuffer";  // recibir binarios :contentReference[oaicite:3]{index=3}
      ws.onmessage = (evt) => {
        if (typeof evt.data === "string") {
          // Mensaje JSON: ready o errores
          const msg = JSON.parse(evt.data);
          if (msg.type === "ready") {
            setIsReady(msg.status);
            if (msg.status) {
              wsRef.current = ws;
            }
          }
        }
      }
    }
  }

  const handleStartCamera = () => {
    try {
      if(isFirstReady)
      fetch("http://localhost:8000/reset_model/", { method: "POST" });
    } catch (err) {
        console.error("Todavia no cargo el backend:", err);
    }
    conectionWebSocket();
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
    setIsReady(false);
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
const handleZoom = async (id: number) => {
  try {
    await fetch("http://localhost:8000/set_id/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
  } catch (error) {
    console.error("Error al enviar ID al backend:", error);
  }
  };

  const resetId = async () => {
  await fetch("http://localhost:8000/clear_id/", {
    method: "POST",
  });
  setSelectedId(null);
  };
  useEffect(() => {
    const sendTrackingConfig = async () => {
      const config = {
        confidence: confidenceThreshold/100,
        gpu: processingUnit === "gpu",
      };

      try {
    // Esperar hasta que isFirstReady sea true
    while (!isFirstReady) {
      await new Promise(resolve => setTimeout(resolve, 100)); // espera 100ms
    }

    // Una vez que isFirstReady es true, se envía la configuración
    const res = await fetch("http://localhost:8000/config/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(config)
    });

    const json = await res.json();
    console.log("Configuración enviada al backend:", json);
  } catch (err) {
    console.error("Error al enviar configuración:", err);
  }
    };

    sendTrackingConfig();
  }, [processingUnit, confidenceThreshold]);

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
              {selectedId !== null && (
                <button onClick={resetId}>
                  Quitar Zoom
                </button>
              )}
              {detections.map((det) => (
                <button key={det.id} onClick={() => handleZoom(det.id)}>
                  Zoom al ID {det.id}
                </button>
              ))}
            </div>
          </details>
          <details className={styles.trackingDropdown}>
            <summary> Configuración tracking</summary>
            <div className={styles.optionsContainer}>
              {/* Unidad de procesamiento */}
              <div className={styles.trackingOption}>
                <label>Unidad de procesamiento:</label><br></br>
                <select value={processingUnit} onChange={(e) => setProcessingUnit(e.target.value)}>
                  <option value="cpu">CPU</option>
                  <option value="gpu">GPU</option>
                </select>
              </div>

              {/* FPS */}
              <div className={styles.trackingOption}>
                <label>FPS deseados:</label><br></br>
                <input type="number" min="1" max="30" value={fpsLimit} onChange={(e) => setFpsLimit(Number(e.target.value))}/>
              </div>

              {/* Porcentaje de confianza */}
              <div className={styles.trackingOption}>
                <label>Porcentaje de confianza (%):</label><br></br>
                <input type="number" min="0" max="100" value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(Number(e.target.value))}/>
              </div>
            </div>
          </details>
        </div>
      )}

      {!isSidebarOpen && (
      <button
        onClick={() => setIsSidebarOpen(true)}
        className={styles.expandButton}
      >
        {">"}
      </button>
    )}

    <main className={styles.main}>
      <div className={styles.header}>
        <h1 className={styles.title}>Seleccionar fuente de imagen</h1>
        <div className={styles.buttonGroup}>
          {!videoSrc && !isCameraActive && (
            <>
              <button onClick={handleStartCamera}>
                Cámara del dispositivo
              </button>
              <button onClick={() => fileInputRef.current?.click()}>
                Subir archivo
              </button>
            </>
          )}

          {(videoSrc || isCameraActive) && (
            <>
              <button onClick={handleStopCamera}>
                Eliminar fuente de video
              </button>
              {!isTracking && (
                <button
                  onClick={handleStartTracking}
                  disabled={!isReady}
                  className={!isReady ? styles.disabledButton : ""}
                >
                  {isReady ? "Iniciar Tracking" : "Cargando tracker…"}
                </button>
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
            <canvas
              ref={annotatedCanvasRef}
              className={styles.videoElement}
            />
          </>
        ) : isCameraActive ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            className={styles.videoElement}
          />
        ) : (
          <p className={styles.textVideoContainer}>
            Esperando fuente de video
          </p>
        )}
      </div>

      <input
        type="file"
        accept="video/*"
        onChange={handleVideoChange}
        className={styles.hidden}
        ref={fileInputRef}
      />

      <canvas
        ref={rawCanvasRef}
        style={{ display: "none" }}
      />
    </main>
  </div>
);
}