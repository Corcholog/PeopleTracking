"use client";
import { useWebSocket } from "@/hooks/useWebSocket"; // ajustá path según tu estructura
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";


export default function DashboardPage() {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [processingUnit, setProcessingUnit] = useState("gpu");
  const [fpsLimit, setFpsLimit] = useState(24);
  const [confidenceThreshold, setConfidenceThreshold] = useState(50);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotatedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isFirstReady, setisFirstReady] = useState(false);
  const [detections, setDetections] = useState<Array<{ id: number; bbox: number[] }>>([]);
  const [selectedId, setSelectedId] = useState("");
  const [hasGPU, setHasGPU] = useState<boolean>(true);
  const [isStopping, setIsStopping] = useState(false);
  const [isStreaming ,setStream]  = useState<boolean>(false);
  const [selectedResolution, setSelectedResolution] = useState("1920x1080"); // Estado para resolución


  const [isRecording, setIsRecording] = useState(false);


useEffect(() => {

  const checkBackendReady = async () => {
    try {
      const res = await fetch("http://localhost:8000/status/");
      const data = await res.json();
      if (data.ready) {
        setisFirstReady(true);
        clearInterval(interval); // 🧼 Detiene el polling
      }
    } catch  {
      console.log("⏳ Backend no disponible todavía");
    }
  };

  const interval = setInterval(checkBackendReady, 1000);
  checkBackendReady(); // 👈 Primer intento inmediato

  return () => clearInterval(interval);
}, []);

  // Nuevo uso del WebSocket
  const {
    send,
    waitUntilReady,
    isConnected,
    isReady,
    connect,
    ws,
  } = useWebSocket({
    url: "ws://localhost:8000/ws/analyze/",
    onMessage: (evt: MessageEvent) => {
      if (typeof evt.data === "string") {
        const msg = JSON.parse(evt.data);
          if (msg.type === "lista_de_ids") {
          console.log("🔍 Detections recibidas:", msg.detections);
          console.log("🎯 ID seleccionado:", msg.selected_id);

          // Aca estan los datos
          setDetections(msg.detections);
          if(msg.selected_id == null)
            setSelectedId("");
        }
      } else {
        const bytes = new Uint8Array(evt.data as ArrayBuffer);
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const img = new Image();
        img.onload = () => {
          const ctx = annotatedCanvasRef.current?.getContext("2d");
          if (ctx && annotatedCanvasRef.current) {
            annotatedCanvasRef.current.width = img.width;
            annotatedCanvasRef.current.height = img.height;
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(img.src);
          }
        };
        img.src = URL.createObjectURL(blob);
      }
    },
    onStopped: () => {
    console.log("✅ Confirmado: análisis detenido");
    setIsStopping(false);
    setIsCameraActive(false);
    setIsTracking(false);
    setVideoSrc(null);
    setSelectedDevice("");
    setStream(false);
    setDetections([]);
  },
  });

    useEffect(() => {
    const checkHardwareStatus = async () => {
      try {
        while (!isFirstReady) {
      await new Promise(resolve => setTimeout(resolve, 100)); // espera 100ms
    } 
        const res = await fetch("http://localhost:8000/hardware_status/");
        const data = await res.json();
        setHasGPU(data.has_gpu);
      } catch (error) {
        console.error("Error al obtener el estado de hardware:", error);
        setHasGPU(false);
      }
    };
    checkHardwareStatus();
  }, []);


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
   
  const [width, height] = selectedResolution.split("x").map(Number);
  console.log("entro aca y con valores de")
  console.log(width)
  console.log(height)

  const constraints: MediaStreamConstraints = {
    video: {
      deviceId: { exact: selectedDevice },
      width: { ideal: width },
      height: { ideal: height },
    },
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
  }, [selectedDevice,selectedResolution]);

useEffect(() => {
  if (!isTracking || !videoRef.current || !rawCanvasRef.current || !annotatedCanvasRef.current) return;
  if (!isReady || !isConnected || !ws) return;

  const intervalId = setInterval(() => {
    const videoEl = videoRef.current!;
    const canvas = rawCanvasRef.current!;
    if (ws.readyState !== WebSocket.OPEN) return;
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(videoEl, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) send(blob);
    }, "image/jpeg", 0.7);
  }, 1000 / fpsLimit);

  return () => clearInterval(intervalId);
}, [isTracking, fpsLimit, isReady, isConnected, ws]);


  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if(isFirstReady)
        fetch("http://localhost:8000/reset_model/", { method: "POST" });
    } catch (err) {
        console.error("Todavia no cargo el backend:", err);
    }
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

   const handleAddUrl = async () => {
    const url = prompt("Ingresa la URL del Streaming:");
    if (!url) return;
    try {
      const response = await fetch("http://localhost:8000/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageUrl: url,stream_url: true }),
      });
      setStream(true);
      if (!response.ok) {
        throw new Error("Error al enviar la URL al backend.");
      }
      handleStartTracking();
    } catch (error) {
      console.error(error);
    }
  };

  const handleStartCamera = () => {
    try {
      if(isFirstReady)
      fetch("http://localhost:8000/reset_model/", { method: "POST" });
    } catch (err) {
        console.error("Todavia no cargo el backend:", err);
    }
    setVideoSrc(null);
    setIsCameraActive(true);
    setIsTracking(false);
  };

const handleStopCamera = async () => {
  if (videoRef.current?.srcObject) {
    const stream = videoRef.current.srcObject as MediaStream;
    stream.getTracks().forEach((track) => track.stop());
  }

  if (isTracking) {
    if (isRecording) {
      await downloadRecording(); // 🧠 usamos la función aparte
    }

    if (isStreaming) {
      try {
        await fetch("http://localhost:8000/clear-url", { method: "POST" });
      } catch (error) {
        console.error(error);
      }
    }

    send(JSON.stringify({ type: "stop" }));
    setIsStopping(true);
  } else {
    setVideoSrc(null);
    setIsCameraActive(false);
    setSelectedDevice("");
    setSelectedId("");
    setStream(false);
  }

  setDetections([]);
  setIsTracking(false);
};


const downloadRecording = async () => {
  try {
    const response = await fetch("http://localhost:8000/stop_recording/", {
      method: "POST",
    });

    if (!response.ok)
      throw new Error("Fallo al detener la grabación");

    setIsRecording(false);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `grabacion-${timestamp}.mp4`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    console.log("🎥 Grabación descargada como:", filename);
  } catch (error) {
    console.error("Error al descargar grabación:", error);
  }
};



const handleResolutionChange = async (e) => {
  const newRes = e.target.value
  setSelectedResolution(newRes)
  if (isStreaming) {
  // Llamada al backend para cambiar resolución
    try {
      const response = await fetch("http://localhost:8000/change_resolution", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ resolution: newRes }),
      });
      const data = await response.json();  
    } catch (error) {
    console.error('Error cambiando resolución:', error);
    }
 }
};

const handleStartTracking = async () => {
  connect(); // abrís el socket acá
  await waitUntilReady(); // esperás a que responda con “ready”
  setIsTracking(true);
  setVideoSrc(null);
  setIsCameraActive(true);
  if (videoRef.current && (videoRef.current.srcObject || videoRef.current.src)) {
  videoRef.current.play().catch(console.error);
}
};

const handleStartRecording = async () => {
  try {
    const response = await fetch("http://localhost:8000/start_recording/", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Fallo en el backend");
    }
    setIsRecording(true);
    console.log("🎥 Grabación iniciada");
  } catch (error) {
    console.error("Error al iniciar la grabación:", error);
  }
};

const handleZoom = async (id: number) => {
  setSelectedId(id.toString());
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
    setSelectedId(null);
    await fetch("http://localhost:8000/clear_id/", {
    method: "POST",
  });
  setSelectedId("");
  };
  useEffect(() => {
    const sendTrackingConfig = async () => {
      if (isTracking) {
        console.warn("No se puede cambiar CPU/GPU mientras se está trackeando");
        return;
      }
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
          <button
            onClick={() => setIsSidebarOpen(false)}
            className={styles.collapseButton}
          >
            {"<"}
          </button>

          {/* Nueva sección Selección de Resolución */}
          <details className={styles.trackingDropdown}>
            <summary>Selección de Resolución</summary>
            <div className={styles.optionsContainer}>
              <select
                value={selectedResolution}
                onChange={(e) =>(handleResolutionChange(e))} 
                disabled={isStopping} // Opcional: bloquear mientras está tracking
                className={styles.selectCamera}
              >
                <option value="1920x1080">1920 x 1080</option>
                <option value="1280x720">1280 x 720</option>
                <option value="640x360">640 x 360</option>
              </select>
            </div>
          </details>

          <details className={styles.zoomDropdown}>
            <summary>Seleccion Zoom</summary>
            <div className={styles.zoomScrollContainer}>
              {!isStopping && selectedId !== "" && (
                <button onClick={resetId}>Quitar Zoom</button>
              )}
              {!isStopping && (
                <>
                  {detections.map((det) => (
                    <button key={det.id} onClick={() => handleZoom(det.id)}>
                      Zoom al ID {det.id}
                    </button>
                  ))}
                </>
              )}
            </div>
          </details>

          <details className={styles.trackingDropdown}>
            <summary> Configuración tracking</summary>
            <div className={styles.optionsContainer}>
              {/* Unidad de procesamiento */}
              {!isTracking && !isStopping && hasGPU && (
                <div className={styles.trackingOption}>
                  <label>Unidad de procesamiento:</label>
                  <br />
                  <select
                    value={processingUnit}
                    onChange={(e) => setProcessingUnit(e.target.value)}
                    disabled={isTracking || isStopping}
                  >
                    <option value="gpu">GPU</option>
                    <option value="cpu">CPU</option>
                  </select>
                </div>
              )}

              {/* FPS */}
              {!isTracking && !isStopping && (
                <div className={styles.trackingOption}>
                  <label>FPS deseados:</label>
                  <br />
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={fpsLimit}
                    onChange={(e) => setFpsLimit(Number(e.target.value))}
                  />
                </div>
              )}

              {/* Porcentaje de confianza */}
              <div className={styles.trackingOption}>
                <label>Porcentaje de confianza (%):</label>
                <br />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                />
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

    {!isFirstReady ? (
      <main className={styles.main}>
      <div className={styles.header}>
      <h1 className={styles.title}>⏳ Cargando el programa…</h1>
      </div>
      </main>
    ) : (
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
              <button onClick={handleAddUrl}>
                Stream de camara en YT
              </button>
            </>
          )}

        {(videoSrc || isCameraActive) && (
            <>
              <button
                onClick={handleStopCamera}
                disabled={isStopping}
                className={styles.trackingButton}
              >
                Eliminar fuente de video
              </button>
              {isTracking && !isStopping && !isRecording && (
                <button
                  onClick={handleStartRecording}
                  disabled={isStopping}
                  className={styles.trackingButton}
                >
                  Iniciar Grabacion
                </button>
              )}

              {isTracking && !isStopping && isRecording &&(
                <button
                  onClick={downloadRecording}
                  disabled={isStopping}
                  className={styles.trackingButton}
                >
                  Detener Grabacion
                </button>
              )}

              {!isTracking && !isStopping && (
                <button
                  onClick={handleStartTracking}
                  className={styles.trackingButton}
                >
                  Iniciar Tracking
                </button>
              )}

              {isStopping && (
                <div className={styles.waitingMessage}>
                  ⏳ Esperando que se detenga el análisis...
                </div>
              )}
            </>
          )}



          {isCameraActive && !videoSrc && !isTracking && (
            <select
              className={styles.selectCamera}
              onChange={(e) => setSelectedDevice(e.target.value)}
              value={selectedDevice}
              disabled={isStopping} // 🔒 bloquea cuando estás esperando
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
        ) : isCameraActive || isStreaming ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            className={styles.videoElement}
          />
        ) :( 
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
    )}
  </div>
);
}