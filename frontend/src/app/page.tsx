"use client";
import { useWebSocket } from "@/hooks/useWebSocket"; // ajustá path según tu estructura
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
//import { save } from '@tauri-apps/plugin-dialog';
//import { writeFile  } from '@tauri-apps/plugin-fs';


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
  const [detections, setDetections] = useState<
    Array<{ id: number; bbox: number[] }>
  >([]);
  const [selectedId, setSelectedId] = useState("");
  const [hasGPU, setHasGPU] = useState<boolean>(true);
  const [isStopping, setIsStopping] = useState(false);
  const [isStreaming, setStream] = useState<boolean>(false);
  const [selectedResolution, setSelectedResolution] = useState("1920x1080"); // Estado para resolución

  const [isRecording, setIsRecording] = useState(false);

  const [metrics, setMetrics] = useState<any>(null);

  const [groupDetections, setGroupDetections] = useState<Array<{ id_grupo: number; grupo_ids: number[] }>>([]);

  const [historialMetricasGenerales, setHistorialMetricasGenerales] = useState<any[]>([]);

  // Estados para las barras laterales
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false); // Izquierda
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false); // Derecha

  const [activeSection, setActiveSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setActiveSection((prev) => (prev === section ? null : section));
    setGrupoSeleccionado(null);
    setIdsSeleccionados([]);
  };
  //parte de usar permitir ver frames anteriores:
  // número máximo de frames a guardar
const [maxBuffer, setMaxBuffer] = useState<number>(5000);
type FrameWithMetrics = { 
  blob: Blob; 
  time: number; 
  metrics?: any; // Las métricas asociadas a este frame
  detections?: Array<{ id: number; bbox: number[] }>; // Detecciones asociadas
};
const [frameBuffer, setFrameBuffer] = useState<FrameWithMetrics[]>([]);
const [currentIndex, setCurrentIndex] = useState<number>(-1);
const wasLiveRef = useRef(true);
const [isPlaying, setIsPlaying] = useState(false);
const [playbackSpeed, setPlaybackSpeed] = useState(1); // 1x por defecto
const firstFrameTimeRef = useRef<number | null>(null);
const [isVideoEnded, setIsVideoEnded] = useState(false);

const [idsSeleccionados, setIdsSeleccionados] = useState<number[]>([]);

const toggleSeleccionId = (id: number) => {
  setIdsSeleccionados((prev) =>
    prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
  );
};

const [grupoSeleccionado, setGrupoSeleccionado] = useState<number | null>(null);

// Estado temporal para almacenar las últimas métricas recibidas
const [latestMetrics, setLatestMetrics] = useState<any>(null);
const [latestDetections, setLatestDetections] = useState<Array<{ id: number; bbox: number[] }>>([]);

// 1) Define un estado para el live frame:
const [liveFrame, setLiveFrame] = useState<{ bitmap: ImageBitmap; time: number } | null>(null);


  // resolutionStreaming: límite máximo 1280x720
  // Si el usuario elige menor (p. ej. 854x480), mantén esa
  const resolutionStreaming = useMemo(() => {
    const [w, h] = selectedResolution.split("x").map(Number);
    // ancho máximo 1280, alto máximo 720
    const sw = Math.min(w, 1280);
    const sh = Math.min(h, 720);
    return `${sw}x${sh}`;      // ej: "1280x720" o "854x480"
  }, [selectedResolution]);

useEffect(() => {
  // 1. Mapea cada resolución a un tamaño medio de blob JPEG (en KB)
  const [rw, rh] = resolutionStreaming.split("x").map(Number);
  let avgBlobKB: number;
  if (rw >= 3840 || rh >= 2160) {
    avgBlobKB = 300;   // 4K, cuesta más
  } else if (rw >= 2560 || rh >= 1440) {
    avgBlobKB = 250;   // 2K
  } else if (rw >= 1920 || rh >= 1080) {
    avgBlobKB = 200;   // 1080p
  } else if (rw >= 1280 || rh >= 720) {
    avgBlobKB = 100;   // 720p
  } else if (rw >= 854 || rh >= 480) {
    avgBlobKB = 50;    // 480p
  } else if (rw >= 640 || rh >= 360) {
    avgBlobKB = 30;    // 360p
  } else {
    avgBlobKB = 20;    // resoluciones menores
  }

  // 2. RAM aproximada reportada por el navegador (GB)
  const reportedGB = (navigator as any).deviceMemory || 4;
  // % de esa RAM que queremos dedicar al buffer
  const fraction = 0.5;  // 50%
  const budgetMB = reportedGB * 1024 * fraction;    // MB disponibles
  const budgetKB = budgetMB * 1024;                 // KB disponibles
  const theoreticalFrames = Math.floor(budgetKB / avgBlobKB);

  // 3. Si la API performance.memory existe, comprobamos el heap libre
  let safeFrames = theoreticalFrames;
  const perf = (performance as any).memory;
  if (perf && perf.usedJSHeapSize && perf.jsHeapSizeLimit) {
    const usedMB  = perf.usedJSHeapSize  / 1024 / 1024;
    const limitMB = perf.jsHeapSizeLimit / 1024 / 1024;
    const freeMB  = Math.max(0, limitMB - usedMB);
    // Dedicamos aquí un % adicional, p.ej. 60% del heap libre
    const heapFraction = 0.5;
    const heapBudgetKB = freeMB * 1024 * heapFraction;
    const heapFrames   = Math.floor(heapBudgetKB / avgBlobKB);
    // No queremos pasarnos del heap libre
    safeFrames = Math.min(theoreticalFrames, heapFrames);
  }

  // 4. Establecemos maxBuffer
  setMaxBuffer(safeFrames);

  console.log(
    `▶️ resolutionStreaming=${resolutionStreaming}, avgBlob≈${avgBlobKB}KB/frame\n` +
    `   reportedRAM≈${reportedGB}GB → budget=${budgetMB.toFixed(1)}MB → ` +
    `frames(teórico)=${theoreticalFrames}` +
    (perf && perf.usedJSHeapSize
      ? `, heapLibre=${((perf.jsHeapSizeLimit - perf.usedJSHeapSize)/1024/1024).toFixed(1)}MB → safeFrames=${safeFrames}`
      : "")
  );
}, [resolutionStreaming]);

const registerFrameTime = (time: number) => {
  if (firstFrameTimeRef.current === null) {
    firstFrameTimeRef.current = time;
  }
};

const resetFirstFrameTime = () => {
  if (frameBuffer.length > 0) {
    firstFrameTimeRef.current = frameBuffer[0].time;
  } else {
    firstFrameTimeRef.current = null;
  }
};
const resetPlaybackState = () => {
  setFrameBuffer([]);
  setCurrentIndex(-1);
  firstFrameTimeRef.current = null;
  wasLiveRef.current = true;
  setHistorialMetricasGenerales([]);
  setIdsSeleccionados([]);
  setGrupoSeleccionado(null);
};

  useEffect(() => {
    const checkBackendReady = async () => {
      try {
        const res = await fetch("http://localhost:8000/status/");
        const data = await res.json();
        if (data.ready) {
          setisFirstReady(true);
          clearInterval(interval); // 🧼 Detiene el polling
        }
      } catch {
        console.log("⏳ Backend no disponible todavía");
      }
    };

    const interval = setInterval(checkBackendReady, 1000);
    checkBackendReady(); // 👈 Primer intento inmediato

    return () => clearInterval(interval);
  }, []);

  // Nuevo uso del WebSocket
const { send, waitUntilReady, isConnected, isReady, connect, ws } =
  useWebSocket({
    url: "ws://localhost:8000/ws/analyze/",
    onMessage: async (evt: MessageEvent) => {
      if (typeof evt.data === "string") {
        const msg = JSON.parse(evt.data);

        // Manejar el mensaje de métricas y detecciones
        if (msg.type === "frame_with_metrics") {
          // Actualizar estados existentes
          setDetections(msg.detections);
          setMetrics(msg.metrics);
          
          if (msg.selected_id == null) setSelectedId("");

          if (msg.metrics?.groups) {
            const grupos = msg.metrics.groups.map((g: any) => ({
              id_grupo: g.id_grupo[0],
              grupo_ids: g.grupo_ids
            }));
            setGroupDetections(grupos);
          }

          if (msg.metrics?.tracking_data) {
            setHistorialMetricasGenerales((prev) => {
              const yaExiste = prev.some((m) => m.frame_number === msg.metrics.frame_number);
              if (!yaExiste) {
                return [...prev, msg.metrics];
              }
              return prev;
            });
          }

          // Convertir base64 a blob
          const imageData = atob(msg.image);
          const bytes = new Uint8Array(imageData.length);
          for (let i = 0; i < imageData.length; i++) {
            bytes[i] = imageData.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: "image/jpeg" });
          
          // Crear bitmap para live display
          const fullBmp = await createImageBitmap(blob);
          const now = msg.timestamp || Date.now(); // usar timestamp del backend si está disponible
          setLiveFrame({ bitmap: fullBmp, time: now });

          // Buffer downsample + JPEG para el buffer de reproducción
          const [bw, bh] = resolutionStreaming.split("x").map(Number);
          const off = document.createElement("canvas");
          off.width = bw;
          off.height = bh;
          const octx = off.getContext("2d")!;
          octx.drawImage(fullBmp, 0, 0, bw, bh);
          
          off.toBlob((smallBlob) => {
            if (!smallBlob) return;

            setFrameBuffer((buf) => {
              // Crear el frame con métricas YA sincronizadas
              const newFrame: FrameWithMetrics = { 
                blob: smallBlob, 
                time: now,
                metrics: msg.metrics, // ✅ Métricas ya sincronizadas
                detections: msg.detections // ✅ Detecciones ya sincronizadas
              };
              
              const next = buf.length >= maxBuffer
                ? [...buf.slice(1), newFrame]
                : [...buf, newFrame];
              registerFrameTime(now);
              
              // Si estamos en live, avanza el índice al último
              if (wasLiveRef.current) {
                setCurrentIndex(next.length - 1);
              }
              return next;
            });
          }, "image/jpeg", 0.7);
        }

        // Manejar el mensaje existente "lista_de_ids" 
        if (msg.type === "lista_de_ids") {
          if (msg.selected_id == null) setSelectedId("");
        }
      }
    },
    onStopped: () => {
      setIsStopping(false);
      setIsCameraActive(false);
      setIsTracking(false);
      setVideoSrc(null);
      setSelectedDevice("");
      setStream(false);
      setDetections([]);
      setGroupDetections([]);
      // Limpiar también las métricas temporales
      setLatestMetrics(null);
      setLatestDetections([]);
      resetFirstFrameTime();
      resetPlaybackState();
      setIsVideoEnded(false);
    },
  });

useEffect(() => {
  if (wasLiveRef.current) return;
  // toma el frame actual del buffer, que ahora es { blob, time }
  const frame = frameBuffer[currentIndex];
  const canvas = annotatedCanvasRef.current;
  if (!frame || !canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let didCancel = false;

  // paso asíncrono: blob → ImageBitmap

  createImageBitmap(frame.blob)
    .then((bitmap) => {
      if (didCancel) {
        // el índice cambió antes de terminar de crear el bitmap
        bitmap.close?.();
        return;
      }
      // ajusta tamaño del canvas al del bitmap
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      // dibuja
      ctx.drawImage(bitmap, 0, 0);
      // limpia recursos si es posible
      bitmap.close?.();
    })
    .catch((err) => {
      console.error("Error creando ImageBitmap:", err);
    });

  // cleanup si currentIndex cambia antes de que termine createImageBitmap
  return () => {
    didCancel = true;
  };
}, [currentIndex]);

// Añade esto para que en cuanto cambie liveFrame, si estamos en live, se pinte:
useEffect(() => {
  if (!liveFrame) return;
  // Solo pinta el liveFrame si está activo el modo live
  if (!wasLiveRef.current) return;

  const canvas = annotatedCanvasRef.current;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const [w, h] = resolutionStreaming.split("x").map(Number);
  canvas.width = w;
  canvas.height = h;

  // Dibuja el bitmap completo (full-res se redimensiona al tamaño de canvas)
  ctx.drawImage(liveFrame.bitmap, 0, 0, w, h);
}, [liveFrame, resolutionStreaming]);

useEffect(() => {
  if (!isPlaying) return;
  let rafId: number;
  let lastTime = performance.now();

  const loop = (now: number) => {
    const elapsed = now - lastTime;
    const interval = 1000 / fpsLimit / playbackSpeed;
    if (elapsed >= interval) {
      setCurrentIndex((i) => {
        const next = Math.min(i + 1, frameBuffer.length - 1);
        if (next === frameBuffer.length - 1) {
          setIsPlaying(false);
          wasLiveRef.current = true;
        }
        return next;
      });
      lastTime = now;
    }
    if (isPlaying) rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(rafId);
}, [isPlaying, fpsLimit, playbackSpeed, frameBuffer.length]);

  useEffect(() => {
    const checkHardwareStatus = async () => {
      try {
        while (!isFirstReady) {
          await new Promise((resolve) => setTimeout(resolve, 100)); // espera 100ms
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

    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: { exact: selectedDevice },
        width,
        height,
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
  }, [selectedDevice, selectedResolution]);

  useEffect(() => {
    if (
      !isTracking || 
      !videoRef.current ||
      !rawCanvasRef.current ||
      !annotatedCanvasRef.current
    )
      return;
    if (!isReady || !isConnected || !ws) return;

    const intervalId = setInterval(() => {
      const videoEl = videoRef.current!;

      if (videoEl.ended || videoEl.paused) {
        console.log("🛑 Video finalizado o pausado, deteniendo envío");
        clearInterval(intervalId);
        setIsVideoEnded(true);     // opcional
        return;
      }

      const canvas = rawCanvasRef.current!;
      const [width, height] = selectedResolution.split("x").map(Number);
      if (ws.readyState !== WebSocket.OPEN) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(videoEl, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) send(blob);
        },
        "image/jpeg",
        0.7
      );
    }, 1000 / fpsLimit);

    return () => clearInterval(intervalId);
  }, [isTracking, fpsLimit, isReady, isConnected, ws]);

  const handleVideoChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    try {
      if (isFirstReady) {
        await fetch("http://localhost:8000/reset_model/", { method: "POST" });
      }
    } catch (err) {
      console.error("Todavía no cargó el backend:", err);
    }

    const file = event.target.files?.[0];
    if (file) {
      const videoUrl = URL.createObjectURL(file);
      setVideoSrc(videoUrl);
      setIsCameraActive(false);
      setIsTracking(false);
      setDetections([]);

      if (fileInputRef.current) {
        fileInputRef.current.value = ""; // Clear file input
      }
      resetId();
    }
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
        body: JSON.stringify({ imageUrl: url, stream_url: true, resolution: selectedResolution }),
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
      if (isFirstReady)
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
    setIsVideoEnded(false);
    setDetections([]);
    setIsTracking(false);
  };

const downloadRecording = async () => {
    try {
      const response = await fetch("http://localhost:8000/stop_recording/", {
        method: "POST",
      });

      if (!response.ok) throw new Error("Fallo al detener la grabación");

      setIsRecording(false);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate()
      )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
        now.getSeconds()
      )}`;
      const filename = `grabacion-${timestamp}.mp4`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error("Error al descargar grabación:", error);
    }
  };




  const handleResolutionChange = async (
    e: React.ChangeEvent<HTMLSelectElement>
  ): Promise<void> => {

    const newRes = e.target.value;
    setSelectedResolution(newRes);
    console.log("entro al handle video change", newRes);

  };

  const handleStartTracking = async () => {
    connect(); // abrís el socket acá
    await waitUntilReady(); // esperás a que responda con “ready”
    setIsTracking(true);
    resetPlaybackState();  // 👈 limpiás todo antes de empezar
    resetFirstFrameTime();
    setVideoSrc(null);
    setIsCameraActive(true);
    if (
      videoRef.current &&
      (videoRef.current.srcObject || videoRef.current.src)
    ) {
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
    setSelectedId("");
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
        confidence: confidenceThreshold / 100,
        gpu: processingUnit === "gpu",
        fps: fpsLimit,
      };

      try {
        // Esperar hasta que isFirstReady sea true
        while (!isFirstReady) {
          await new Promise((resolve) => setTimeout(resolve, 100)); // espera 100ms
        }

        // Una vez que isFirstReady es true, se envía la configuración
        const res = await fetch("http://localhost:8000/config/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(config),
        });

      } catch (err) {
        console.error("Error al enviar configuración:", err);
      }
    };

    sendTrackingConfig();
  }, [processingUnit, confidenceThreshold]);

  // Cambio de FPSs
  useEffect(() => {
    const updateFpsSetting = async () => {
      if (isTracking) {
        console.warn("No se puede cambiar FPS mientras se está trackeando");
        return;
      }

      try {
        while (!isFirstReady) {
          await new Promise((resolve) => setTimeout(resolve, 100)); // espera 100ms
        }
        await fetch("http://localhost:8000/config/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fps: fpsLimit }),
        });
      } catch (err) {
        console.error("Error al actualizar FPS:", err);
      }
    };

    updateFpsSetting();
  }, [fpsLimit]);

  // funciones para manejar las barras laterales
  const openLeftSidebar = () => {
    setIsLeftSidebarOpen(true);
    setIsRightSidebarOpen(false); // Cierra la derecha
  };

  const openRightSidebar = () => {
    setIsRightSidebarOpen(true);
    setIsLeftSidebarOpen(false); // Cierra la izquierda
  };


  const elapsedSec =
  currentIndex >= 0 &&
  frameBuffer[currentIndex] &&
  firstFrameTimeRef.current !== null
    ? ((frameBuffer[currentIndex].time - firstFrameTimeRef.current) / 1000).toFixed(1)
    : "0.0";

  return (
    <div className={styles.layoutContainer}>
      {isLeftSidebarOpen && (
        <div className={styles.leftSidebar}>
          <button
            onClick={() => setIsLeftSidebarOpen(false)}
            className={styles.collapseButtonLeft}
          >
            {"<"}
          </button>

              
          
          {/* Nueva sección Selección de Resolución */}
          <details className={styles.trackingDropdown}>
            <summary>Selección de Resolución</summary>
            <div className={styles.optionsContainer}>
              <select
                value={selectedResolution}
                onChange={(e) => handleResolutionChange(e)}
                disabled={isTracking || isStopping} // Opcional: bloquear mientras está tracking
                className={styles.selectCamera}
              >
                <option value="4k">3840 x 2160</option>
                <option value="2k">2560 x 1440 </option>
                <option value="1920x1080">1920 x 1080</option>
                <option value="1280x720">1280 x 720</option>
                <option value="854x480">854 x 480</option>
                <option value="640x360">640 x 360</option>
                <option value="320x240">320 x 240</option>
                <option value="256x144">256 x 144</option>
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
                  onChange={(e) =>
                    setConfidenceThreshold(Number(e.target.value))
                  }
                />
              </div>


            </div>
          </details>
        </div>
      )}

      {/* Botón para expandir sidebar izquierda */}
      {!isLeftSidebarOpen && !isRightSidebarOpen && (
        <button
          onClick={openLeftSidebar}
          className={styles.expandButtonLeft}
        >
          {" Configuración >"}
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
                  <button onClick={handleAddUrl}>Stream de camara en YT</button>
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

                  {isTracking && !isStopping && isRecording && (
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
                  disabled={isStopping} // bloquea cuando estás esperando
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
            ) : (
              <p className={styles.textVideoContainer}>
                Esperando fuente de video
              </p>
            )}
          </div>

            {/* Controles siempre visibles debajo del video */}
            <div className={styles.bottomControls}>
            <div style={{ marginTop: 10 }}>
              {isPlaying ? (
                <span style={{ color: "#0af" }}>🎞️ Reproduciendo ({playbackSpeed}x)</span>
              ) : wasLiveRef && isVideoEnded ? (
                <span style={{ color: "yellow", fontWeight: "bold" }}> FIN De Video</span>
              ): wasLiveRef ? (
                <span style={{ color: "red", fontWeight: "bold" }}>🔴 EN VIVO</span>
              ) : (
                <span style={{ color: "#999" }}>⏸️ Pausado</span>
              )}
            </div>
              <div className={styles.bottomControlsInner}>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, frameBuffer.length - 1)}
                  value={currentIndex}
                  onChange={e => {
                    const v = Number(e.target.value);
                    wasLiveRef.current = false;  // sales de live
                    setIsPlaying(false);         // pausa cualquier playback actual
                    setCurrentIndex(v);
                  }}
                  disabled={frameBuffer.length === 0}
                />
              <span>{elapsedSec} s</span>
              <label>
                Velocidad:
                <select
                  value={playbackSpeed}
                  onChange={e => setPlaybackSpeed(Number(e.target.value))}
                  disabled={!isPlaying}
                >
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                </select>
              </label>
              <button
                onClick={() => {
                  setIsPlaying(!isPlaying);
                  // si arrancas a reproducir desde mid, asegúrate que no vuelvas a live antes
                  wasLiveRef.current = false;
                }}
                disabled={frameBuffer.length === 0}
              >
                {isPlaying ? "⏸️ Pausar" : `▶️ Play (${playbackSpeed}x)`}
              </button>
              <button
                onClick={() => {
                  // Ir en vivo
                  wasLiveRef.current = true;
                  setIsPlaying(false);
                  const last = frameBuffer.length - 1;
                  setCurrentIndex(last);
                }}
                disabled={wasLiveRef.current}
              >
                🔴 Live
              </button>
              {isVideoEnded && <div className={styles.notice}>🎉 El video terminó de analizarse</div>}
              </div>
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
      )}

      {/* Sidebar derecho */}
      {isRightSidebarOpen && (
        <div className={styles.rightSidebar}>
          <button
            onClick={() => setIsRightSidebarOpen(false)}
            className={styles.collapseButtonRight}
          >
            {">"}
          </button>
          <div className={styles.rightSidebarContent}>
            {/* Métricas generales */}
            <div className={styles.metricSection}>
              <button onClick={() => {toggleSection("generales");}}>
                {activeSection === "generales" ? "▼" : "►"} Ver métricas generales
              </button>
              {activeSection === "generales" && (
                <div className={styles.metricContent}>
                  {!isStopping && historialMetricasGenerales.filter(
                        (m) => m.frame_number <= frameBuffer[currentIndex]?.metrics?.frame_number
                      ).length > 0 ? (
                        <table className={styles.tableMetricas}>
                          <thead>
                            <tr>
                              <th>ID Persona</th>
                              <th>ID Frame</th>
                              <th>X1</th>
                              <th>X2</th>
                              <th>Y1</th>
                              <th>Y2</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historialMetricasGenerales
                              .filter((m) => m.frame_number <= frameBuffer[currentIndex]?.metrics?.frame_number)
                              .flatMap((frameData: any) =>
                                frameData.tracking_data.map((p: any, i: number) => (
                                  <tr key={`${frameData.frame_number}-${i}`}>
                                    <td>{p.id_persona}</td>
                                    <td>{frameData.frame_number}</td>
                                    <td>{p.bbox[0]}</td>
                                    <td>{p.bbox[2]}</td>
                                    <td>{p.bbox[1]}</td>
                                    <td>{p.bbox[3]}</td>
                                  </tr>
                                ))
                              )}
                          </tbody>
                        </table>
                      ) : (
                  <p>No hay métricas disponibles</p>
                )}
                </div>
              )}
            </div>

            {/* Métricas individuales */}
            <div className={styles.metricSection}>
              <button onClick={() => toggleSection("individuales")}>
                {activeSection === "individuales" ? "▼" : "►"} Ver métricas individuales
              </button>
              {activeSection === "individuales" && (
                <div className={styles.metricContent}>
                  {!isStopping && isTracking &&
                    frameBuffer[currentIndex]?.detections?.map((det) => (
                      <button
                        key={det.id}
                        onClick={() => toggleSeleccionId(det.id)}
                        className={idsSeleccionados.includes(det.id) ? styles.selectedButton : ""}
                      >
                        Ver métricas del ID {det.id}
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Métricas grupales */}
            <div className={styles.metricSection}>
              <button onClick={() => toggleSection("grupales")}>
                {activeSection === "grupales" ? "▼" : "►"} Ver métricas grupales
              </button>
              {activeSection === "grupales" && (
                <div className={styles.metricContent}>
                  {!isStopping && isTracking &&
                    frameBuffer[currentIndex]?.metrics?.groups?.map((grupo: any) => (
                      <button key={grupo.id_grupo[0]}
                        onClick={() => {setGrupoSeleccionado(grupo.id_grupo[0]);}}
                        className={grupoSeleccionado === grupo.id_grupo[0] ? styles.selectedButton : ""}>
                        Ver métricas del grupo ID {grupo.id_grupo[0]}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>

      )}

      {/* Boton para expandir sidebar derecha */}
      {!isRightSidebarOpen && !isLeftSidebarOpen && (
        <button
          onClick={openRightSidebar}
          className={styles.expandButtonRight}
        >
          {"< Metricas"} 
        </button>
      )}

    </div>
  );
}