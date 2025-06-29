"use client";
import { useWebSocket } from "@/hooks/useWebSocket"; // ajustá path según tu estructura
import { useEffect, useMemo, useRef, useState, useCallback  } from "react";
import styles from "./page.module.css";
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile  } from '@tauri-apps/plugin-fs';
import { message } from "@tauri-apps/plugin-dialog";


export default function DashboardPage() {
  interface NavigatorWithMemory extends Navigator {
    deviceMemory?: number;
  }

  interface PerformanceMemory {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  }

  interface TrackingData {
    id_persona: number;
    centro: [number, number];
    bbox: [number, number, number, number];
  }
  
  interface GroupBack {
    id_grupo: number[];
    grupo_ids: number[];
  }

  //interfaces
  interface Metrics {
    frame_number: number;
    total_tracked: number;
    tracking_data: TrackingData[];
    directions: Record<string, string[]>;
    groups?: GroupBack[];
  }

  


  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [processingUnit, setProcessingUnit] = useState("gpu");
  const [fpsLimit, setFpsLimit] = useState(24);
  const [confidenceThreshold, setConfidenceThreshold] = useState(50);
  const [zoomConfig, setZoomConfig] = useState<{ x: number; y: number; scale: number } | null>(null);

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

  const [, setMetrics] = useState<Metrics | null>(null);

  const [, setGroupDetections] = useState<Array<{ id_grupo: number; grupo_ids: number[] }>>([]);

  const [, setHistorialMetricasGenerales] = useState<Metrics[]>([]);

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
    metrics?: Metrics ; // Las métricas asociadas a este frame
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
    setIdsSeleccionados(prev => {
      const newIds = prev.includes(id)
        ? prev.filter(i => i !== id)
        : [...prev, id];
      
      // Forzar actualización inmediata
      setTrayectorias(prevTray => {
        const newTray = new Map(prevTray);
        if (newIds.includes(id)) {
          newTray.set(id, construirTrayectoria(id));
        } else {
          newTray.delete(id);
        }
        return newTray;
      });
      
      return newIds;
    });
  };

  const toggleSeleccionGrupo = (idGrupo: number) => {
    setGruposSeleccionados((prev) => {
      const isCurrentlySelected = prev.includes(idGrupo);
      
      if (isCurrentlySelected) {
        // Remover grupo y su trayectoria
        setTrayectoriasGrupos(prevTray => {
          const newTray = new Map(prevTray);
          newTray.delete(idGrupo);
          return newTray;
        });
        return prev.filter((i) => i !== idGrupo);
      } else {
        // Agregar grupo y construir su trayectoria
        const nuevaTrayectoria = construirTrayectoriaGrupo(idGrupo);
        setTrayectoriasGrupos(prevTray => {
          const newTray = new Map(prevTray);
          newTray.set(idGrupo, nuevaTrayectoria);
          return newTray;
        });
        return [...prev, idGrupo];
      }
    });
  };

  const [grupoSeleccionado, setGrupoSeleccionado] = useState<number | null>(null);

  // Estado para trayectorias de grupos
  const [trayectoriasGrupos, setTrayectoriasGrupos] = useState<Map<number, Array<{x: number, y: number, frameIndex: number}>>>(new Map());
  // Estado para grupos seleccionados
  const [gruposSeleccionados, setGruposSeleccionados] = useState<number[]>([]);

  // Estado temporal para almacenar las últimas métricas recibidas
  const [, setLatestMetrics] = useState<Metrics | null>(null);
  const [, setLatestDetections] = useState<Array<{ id: number; bbox: number[] }>>([]);

  // Estados para trayectorias
  const [trayectorias, setTrayectorias] = useState<Map<number, Array<{x: number, y: number, frameIndex: number}>>>(new Map());
  const [mostrarTrayectorias, setMostrarTrayectorias] = useState(true);

  // 1) Define un estado para el live frame:
  const [liveFrame, setLiveFrame] = useState<{ bitmap: ImageBitmap; time: number } | null>(null);

  const currentFrame = currentIndex >= 0 && currentIndex < frameBuffer.length 
    ? frameBuffer[currentIndex]
    : undefined;

  const trackingData = currentFrame?.metrics?.tracking_data;
  const groups = currentFrame?.metrics?.groups;

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

     // 3. Ahora ya puedes castearlo de forma segura:
    const nav = navigator as NavigatorWithMemory;
    const reportedGB: number = nav.deviceMemory ?? 4;
    // % de esa RAM que queremos dedicar al buffer
    const fraction = 0.5;  // 50%
    const budgetMB = reportedGB * 1024 * fraction;    // MB disponibles
    const budgetKB = budgetMB * 1024;                 // KB disponibles
    const theoreticalFrames = Math.floor(budgetKB / avgBlobKB);

    // 3. Si la API performance.memory existe, comprobamos el heap libre
    let safeFrames = theoreticalFrames;
    const perfNav = performance as Performance & { memory?: PerformanceMemory };
    const perf: PerformanceMemory | undefined = perfNav.memory;
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
    setTrayectorias(new Map());
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
          

          if (msg.metrics?.groups) {
            const grupos = msg.metrics.groups.map((g: GroupBack) => ({
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
  if (!annotatedCanvasRef.current) return;
  
  const canvas = annotatedCanvasRef.current;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (!frame || !canvas) return;

  if (frame.metrics) {
    setMetrics(frame.metrics);
  }
  if (frame.detections) {
    setDetections(frame.detections);
  }
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
      if (zoomConfig) {
          applyZoom(ctx, bitmap, zoomConfig);
        } else {
            ctx.drawImage(bitmap, 0, 0);
        }
      dibujarTrayectorias(canvas);

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
}, [currentIndex, frameBuffer, trayectorias, trayectoriasGrupos]);

// Añade esto para que en cuanto cambie liveFrame, si estamos en live, se pinte:
useEffect(() => {
  if (!liveFrame) return;
  if (!wasLiveRef.current) return;

  const canvas = annotatedCanvasRef.current;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const [w, h] = resolutionStreaming.split("x").map(Number);
  canvas.width = w;
  canvas.height = h;
  if (zoomConfig ) {
    applyZoom(ctx, liveFrame.bitmap, zoomConfig);
  } else {
    ctx.drawImage(liveFrame.bitmap, 0, 0, w, h);
  }

  dibujarTrayectorias(canvas);
}, [liveFrame, resolutionStreaming, wasLiveRef.current]);

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
      clearZoom();
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
        await downloadRecording(); //  usamos la función aparte
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
      clearZoom();
      setStream(false);

    }
    resetPlaybackState();
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
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
      now.getSeconds()
    )}`;
    const defaultFilename = `grabacion-${timestamp}.mp4`;

    const filePath = await save({
      defaultPath: defaultFilename,
      filters: [{ name: "Video", extensions: ["mp4"] }],
    });

    if (!filePath) {
      console.log("El usuario canceló el guardado.");
      return;
    }

    await writeFile(filePath, uint8Array);


    console.log("Archivo guardado exitosamente:", filePath);

  } catch (err) {
    console.error('Error al descargar grabación:', err);
  }
};




  const handleResolutionChange = async (
    e: React.ChangeEvent<HTMLSelectElement>
  ): Promise<void> => {

    let newRes = e.target.value;
    if (newRes === "4k") newRes = "3840x2160";
    if (newRes === "2k") newRes = "2560x1440";

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

const applyZoom = useCallback((
    ctx: CanvasRenderingContext2D,
    img: ImageBitmap,
    cfg: { x: number; y: number; scale: number },
  ) => {
    const { x, y, scale } = cfg;
    const sw = img.width / scale;
    const sh = img.height / scale;

    const sx = Math.max(0, Math.min(img.width - sw, x - sw / 2));
    const sy = Math.max(0, Math.min(img.height - sh, y - sh / 2));

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ctx.canvas.width, ctx.canvas.height);

  }, []);

  const handleZoom = useCallback((id: number) => {
    const dets = wasLiveRef.current ? detections : frameBuffer[currentIndex]?.detections || [];
    const det = dets.find(d => d.id === id);
    console.log("detecciones", det);
    if (!det) {
      message(`El ID ${id} ya no está en el frame actual`, {
      title: "Error de Zoom",
    });
      setZoomConfig(null);
      return;
    }
    setSelectedId(id.toString());
    setZoomConfig({ 
      x: det.bbox[0] + (det.bbox[2]-det.bbox[0])/2,
      y: det.bbox[1] + (det.bbox[3]-det.bbox[1])/2,
      scale: 2 
    });
  }, [detections]);

  const clearZoom = useCallback(() => {
    setSelectedId("");
    setZoomConfig(null);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    console.log(frameBuffer[currentIndex]?.detections);
    const ids = (wasLiveRef.current ? detections : frameBuffer[currentIndex]?.detections)?.map(d => d.id.toString()) || [];
    console.log("se va a salir",!ids.includes(selectedId));
    if (!ids.includes(selectedId)) {
      message(`El ID ${selectedId} ya no está en el frame actual`, {
      title: "Error de Zoom",
    });
      clearZoom();
    }
  }, [currentIndex, frameBuffer, detections, selectedId]);


  useEffect(() => {
    if (!selectedId || !zoomConfig) return;

    const deteccionesActuales = wasLiveRef.current
      ? detections
      : frameBuffer[currentIndex]?.detections;

    const bbox = deteccionesActuales?.find(d => d.id.toString() === selectedId)?.bbox;

    if (!bbox) return;

    const [x1, y1, x2, y2] = bbox;
    const centroX = x1 + (x2 - x1) / 2;
    const centroY = y1 + (y2 - y1) / 2;

    if (zoomConfig.x !== centroX || zoomConfig.y !== centroY) {
      setZoomConfig((prev) => prev ? { ...prev, x: centroX, y: centroY } : null);
    }
  }, [detections, frameBuffer, currentIndex, selectedId, zoomConfig]);

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
      while (!isFirstReady) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await fetch("http://localhost:8000/config/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
    } catch (err) {
      console.error("Error al enviar configuración:", err);
    }
  };

  sendTrackingConfig();
}, [processingUnit, confidenceThreshold, fpsLimit, isFirstReady, isTracking]);


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


  // Mapa de colores por dirección (evitando verde)
  const directionColorMap: { [key: string]: string } = {
    P: "hsl(0, 70%, 50%)",   // Stopped: Rojo
    D: "hsl(60, 70%, 50%)",  // East: Amarillo
    Q: "hsl(45, 70%, 50%)",  // Northeast: Amarillo-naranja
    W: "hsl(90, 70%, 50%)",  // North: Verde claro (ligeramente diferente al verde de tracking)
    E: "hsl(135, 70%, 50%)", // Northwest: Cian-verde
    A: "hsl(180, 70%, 50%)", // West: Cian
    Z: "hsl(225, 70%, 50%)", // Southwest: Azul
    S: "hsl(270, 70%, 50%)", // South: Púrpura
    C: "hsl(315, 70%, 50%)", // Southeast: Magenta
  };

  // Función para obtener color según la dirección
  const getColorForDirection = (direction: string): string => {
    return directionColorMap[direction] || "hsl(0, 0%, 50%)"; // Gris por defecto si no hay dirección
  };

  // Función para construir trayectoria de un ID específico
  const construirTrayectoria = (idPersona: number) => {
    return frameBuffer.reduce((puntos, frame, frameIndex) => {
      if (frame.metrics?.tracking_data) {
        const personData = frame.metrics.tracking_data.find(
          (p: TrackingData) => p.id_persona === idPersona
        );
        if (personData?.centro) {
          puntos.push({
            x: personData.centro[0],
            y: personData.centro[1],
            frameIndex
          });
        }
      }
      return puntos;
    }, [] as Array<{x: number, y: number, frameIndex: number}>);
  };

  // Función para renderizar trayectorias en el canvas
  const dibujarTrayectorias = (canvas: HTMLCanvasElement) => {
    if (!mostrarTrayectorias || (trayectorias.size === 0 && trayectoriasGrupos.size === 0)) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Obtener dimensiones del canvas
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Obtener dimensiones originales de la resolución seleccionada
    const [originalWidth, originalHeight] = selectedResolution.split("x").map(Number);

    // Calcular factores de escala
    const scaleX = canvasWidth / originalWidth;
    const scaleY = canvasHeight / originalHeight;

    // Dibujar trayectorias de personas
    trayectorias.forEach((puntos, idPersona) => {
      if (puntos.length < 2) return;

      // Filtrar puntos hasta el frame actual
      const puntosHastaActual = puntos.filter(p => p.frameIndex <= currentIndex);
      if (puntosHastaActual.length < 2) return;

      // Dibujar segmentos de trayectoria
      ctx.lineWidth = 2;
      ctx.setLineDash([]);

      for (let i = 1; i < puntosHastaActual.length; i++) {
        const puntoActual = puntosHastaActual[i];
        const puntoAnterior = puntosHastaActual[i - 1];

        // Obtener la dirección del frame actual
        const frameMetrics = frameBuffer[puntoActual.frameIndex]?.metrics;
        const direction = frameMetrics?.directions?.[idPersona.toString()]?.[0] || "P";
        ctx.strokeStyle = getColorForDirection(direction);

        // Dibujar segmento
        ctx.beginPath();
        ctx.moveTo(puntoAnterior.x * scaleX, puntoAnterior.y * scaleY);
        ctx.lineTo(puntoActual.x * scaleX, puntoActual.y * scaleY);
        ctx.stroke();
      }

      // Dibujar puntos clave cada 10 frames
      puntosHastaActual.forEach((punto, index) => {
        if (index % 10 === 0 || index === puntosHastaActual.length - 1) {
          const frameMetrics = frameBuffer[punto.frameIndex]?.metrics;
          const direction = frameMetrics?.directions?.[idPersona.toString()]?.[0] || "P";
          ctx.fillStyle = getColorForDirection(direction);
          ctx.beginPath();
          ctx.arc(punto.x * scaleX, punto.y * scaleY, 3, 0, 2 * Math.PI);
          ctx.fill();
        }
      });

      // Dibujar punto actual más grande
      const ultimoPunto = puntosHastaActual[puntosHastaActual.length - 1];
      const frameMetrics = frameBuffer[ultimoPunto.frameIndex]?.metrics;
      const direction = frameMetrics?.directions?.[idPersona.toString()]?.[0] || "P";
      ctx.fillStyle = getColorForDirection(direction);
      ctx.beginPath();
      ctx.arc(ultimoPunto.x * scaleX, ultimoPunto.y * scaleY, 5, 0, 2 * Math.PI);
      ctx.fill();

      // Etiqueta con ID
      ctx.fillStyle = "white";
      ctx.strokeStyle = "black";
      ctx.lineWidth = 1;
      ctx.font = "12px Arial";
      const texto = `ID ${idPersona}`;
      const textX = ultimoPunto.x * scaleX + 8;
      const textY = ultimoPunto.y * scaleY - 8;
      ctx.strokeText(texto, textX, textY);
      ctx.fillText(texto, textX, textY);
    });

    // Dibujar trayectorias y cajas de grupos
    trayectoriasGrupos.forEach((puntos, idGrupo) => {
      if (puntos.length < 2) return;

      // Filtrar puntos hasta el frame actual
      const puntosHastaActual = puntos.filter(p => p.frameIndex <= currentIndex);
      if (puntosHastaActual.length < 2) return;

      // Dibujar trayectoria del grupo
      ctx.lineWidth = 3; // Línea más gruesa para grupos
      ctx.setLineDash([5, 5]); // Línea discontinua para diferenciar

      for (let i = 1; i < puntosHastaActual.length; i++) {
        const puntoActual = puntosHastaActual[i];
        const puntoAnterior = puntosHastaActual[i - 1];

        // Obtener la dirección del grupo para el frame actual
        const direction = getGrupoDirection(idGrupo, puntoActual.frameIndex);
        ctx.strokeStyle = getColorForDirection(direction);

        // Dibujar segmento
        ctx.beginPath();
        ctx.moveTo(puntoAnterior.x * scaleX, puntoAnterior.y * scaleY);
        ctx.lineTo(puntoActual.x * scaleX, puntoActual.y * scaleY);
        ctx.stroke();
      }

      // Dibujar puntos clave cada 10 frames
      puntosHastaActual.forEach((punto, index) => {
        if (index % 10 === 0 || index === puntosHastaActual.length - 1) {
          const direction = getGrupoDirection(idGrupo, punto.frameIndex);
          ctx.fillStyle = getColorForDirection(direction);
          ctx.beginPath();
          ctx.arc(punto.x * scaleX, punto.y * scaleY, 4, 0, 2 * Math.PI);
          ctx.fill();
        }
      });

      // Dibujar punto actual más grande
      const ultimoPunto = puntosHastaActual[puntosHastaActual.length - 1];
      const direction = getGrupoDirection(idGrupo, ultimoPunto.frameIndex);
      ctx.fillStyle = getColorForDirection(direction);
      ctx.beginPath();
      ctx.arc(ultimoPunto.x * scaleX, ultimoPunto.y * scaleY, 6, 0, 2 * Math.PI);
      ctx.fill();

      // Etiqueta con ID del grupo
      ctx.fillStyle = "white";
      ctx.strokeStyle = "black";
      ctx.lineWidth = 1;
      ctx.font = "14px Arial"; // Fuente un poco más grande para grupos
      const texto = `Grupo ${idGrupo}`;
      const textX = ultimoPunto.x * scaleX + 10;
      const textY = ultimoPunto.y * scaleY - 10;
      ctx.strokeText(texto, textX, textY);
      ctx.fillText(texto, textX, textY);

      // Dibujar caja del grupo en el frame actual
      const frameMetrics = frameBuffer[currentIndex]?.metrics;
      if (frameMetrics?.groups) {
        const grupo = frameMetrics.groups.find((g: GroupBack) => g.id_grupo[0] === idGrupo);
        if (grupo && grupo.grupo_ids.length > 0) {
          const personas = frameMetrics.tracking_data.filter((p: TrackingData) =>
            grupo.grupo_ids.includes(p.id_persona)
          );
          if (personas.length > 0) {
            // Calcular los límites de la caja
            const x1 = Math.min(...personas.map((p: TrackingData) => p.bbox[0]));
            const y1 = Math.min(...personas.map((p: TrackingData) => p.bbox[1]));
            const x2 = Math.max(...personas.map((p: TrackingData) => p.bbox[2]));
            const y2 = Math.max(...personas.map((p: TrackingData) => p.bbox[3]));

            // Dibujar la caja
            ctx.strokeStyle = "#0066ff";
            ctx.lineWidth = 2;
            ctx.setLineDash([]); // Línea continua
            ctx.beginPath();
            ctx.rect(x1 * scaleX, y1 * scaleY, (x2 - x1) * scaleX, (y2 - y1) * scaleY);
            ctx.stroke();
          }
        }
      }
    });
  };

  // Nuevo efecto para actualizar trayectorias en tiempo real
  useEffect(() => {
    if (!wasLiveRef.current || !isTracking) return;
    
    // Actualizar trayectorias para IDs seleccionados
    setTrayectorias(prev => {
      const newMap = new Map(prev);
      idsSeleccionados.forEach(id => {
        const puntos = construirTrayectoria(id);
        newMap.set(id, puntos);
      });
      return newMap;
    });

    // Actualizar trayectorias para grupos seleccionados
    setTrayectoriasGrupos(prev => {
      const newMap = new Map(prev);
      gruposSeleccionados.forEach(idGrupo => {
        const puntos = construirTrayectoriaGrupo(idGrupo);
        newMap.set(idGrupo, puntos);
      });
      return newMap;
    });
  }, [frameBuffer, isTracking]); // Se activa con cada nuevo frame

  const getGrupoDirection = (idGrupo: number, frameIndex: number): string => {
    const frameMetrics = frameBuffer[frameIndex]?.metrics;
    if (!frameMetrics?.groups || !frameMetrics?.directions) return "P";

    const grupo = frameMetrics.groups.find((g: GroupBack) => g.id_grupo[0] === idGrupo);
    if (!grupo || grupo.grupo_ids.length === 0) return "P";

    // Obtener direcciones de los miembros
    const direcciones = grupo.grupo_ids
      .map((id: number) => frameMetrics.directions[id.toString()]?.[0])
      .filter(Boolean);

    if (direcciones.length === 0) return "P";

    // Calcular moda (dirección más común)
    const conteo: { [key: string]: number } = {};
    direcciones.forEach((dir: string) => {
      conteo[dir] = (conteo[dir] || 0) + 1;
    });

    return Object.keys(conteo).reduce((a, b) => 
      conteo[a] > conteo[b] ? a : b, "P");
  };

  const construirTrayectoriaGrupo = (idGrupo: number): Array<{x: number, y: number, frameIndex: number}> => {
    return frameBuffer.reduce((puntos, frame, frameIndex) => {
      if (frame.metrics?.groups) {
        const grupo = frame.metrics.groups.find((g: GroupBack) => g.id_grupo[0] === idGrupo);
        if (grupo && grupo.grupo_ids.length > 0) {
          const personas = frame.metrics.tracking_data.filter((p: TrackingData) =>
            grupo.grupo_ids.includes(p.id_persona)
          );
          if (personas.length > 0) {
            // Calcular centroide (promedio de centros)
            const centroX = personas.reduce((sum: number, p: TrackingData) => 
              sum + p.centro[0], 0) / personas.length;
            const centroY = personas.reduce((sum: number, p: TrackingData) => 
              sum + p.centro[1], 0) / personas.length;
            
            puntos.push({ x: centroX, y: centroY, frameIndex });
          }
        }
      }
      return puntos;
    }, [] as Array<{x: number, y: number, frameIndex: number}>);
  };
  
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
              {selectedId && (
                <>
                  <button onClick={clearZoom}>Quitar Zoom</button>
                  <label>
                    Zoom: {zoomConfig?.scale.toFixed(1)}×
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={0.1}
                      value={zoomConfig?.scale || 1}
                      onChange={(e) => {
                        const scale = parseFloat(e.target.value);
                        setZoomConfig((cfg) => cfg ? { ...cfg, scale } : null);
                      }}
                    />
                  </label>
                </>
              )}
              {(wasLiveRef.current ? detections : frameBuffer[currentIndex]?.detections || []) // fallback
                .filter(det => det && typeof det.id !== "undefined")
                .map(det => (
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
              {!isTracking && !isStopping && hasGPU === true && (
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
                  disabled={isTracking || isStopping}
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
              ) : wasLiveRef.current ? ( // Cambiado wasLiveRef por wasLiveRef.current
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
            {/* Navegación de secciones */}
            <div className={styles.metricNavigation}>
              <button
                onClick={() => toggleSection("generales")}
                className={`${styles.navButton} ${activeSection === "generales" ? styles.activeNavButton : ""}`}
              >
                Métricas Generales
              </button>
              <button
                onClick={() => toggleSection("individuales")}
                className={`${styles.navButton} ${activeSection === "individuales" ? styles.activeNavButton : ""}`}
              >
                Métricas Individuales
              </button>
              <button
                onClick={() => toggleSection("grupales")}
                className={`${styles.navButton} ${activeSection === "grupales" ? styles.activeNavButton : ""}`}
              >
                Métricas Grupales
              </button>
            </div>

            {/* Contenido de la sección activa */}
            <div className={styles.metricMainContent}>
              {/* Métricas generales */}
              {activeSection === "generales" && (
                <div className={styles.fullWidthMetricSection}>
                  <div className={styles.metricContentFull}>
                    {!isStopping && Array.isArray(trackingData) && trackingData.length > 0 ? (
                      <div className={styles.tableContainer}>
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
                            {frameBuffer[currentIndex]?.metrics?.tracking_data?.map((person: TrackingData, i: number) => (
                              <tr key={`${frameBuffer[currentIndex]?.metrics?.frame_number}-${i}`}>
                                <td>{person.id_persona}</td>
                                <td>{frameBuffer[currentIndex]?.metrics?.frame_number}</td>
                                <td>{person.bbox[0]}</td>
                                <td>{person.bbox[2]}</td>
                                <td>{person.bbox[1]}</td>
                                <td>{person.bbox[3]}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className={styles.noDataMessage}>
                        <p>No hay métricas disponibles</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Métricas individuales */}
              {activeSection === "individuales" && (
                <div className={styles.fullWidthMetricSection}>
                  <div className={styles.metricContentFull}>
                    {!isStopping && isTracking && Array.isArray(trackingData) && trackingData.length > 0 ? (
                      <div className={styles.individualMetricsGrid}>
                        {frameBuffer[currentIndex]?.metrics?.tracking_data?.map((personData: TrackingData) => {
                          // Función para obtener el símbolo de dirección
                          const getDirectionSymbol = (directionCode: string) => {
                            const directionMap: { [key: string]: string } = {
                              "P": "⏸️", // Stopped
                              "D": "➡️", // East
                              "Q": "↗️", // Northeast
                              "W": "⬆️", // North
                              "E": "↖️", // Northwest
                              "A": "⬅️", // West
                              "Z": "↙️", // Southwest
                              "S": "⬇️", // South
                              "C": "↘️"  // Southeast
                            };
                            return directionMap[directionCode] || "❓";
                          };

                          // Obtener la dirección de la persona actual
                          const personDirection = frameBuffer[currentIndex]?.metrics?.directions?.[personData.id_persona.toString()];
                          const directionSymbol = personDirection ? getDirectionSymbol(personDirection[0]) : "❓";

                          return (
                            <div 
                              key={personData.id_persona} 
                              className={`${styles.metricCard} ${idsSeleccionados.includes(personData.id_persona) ? styles.selectedCard : ""}`}
                              onClick={() => toggleSeleccionId(personData.id_persona)}
                            >
                              <div className={styles.cardHeader}>
                                <h4>ID {personData.id_persona}</h4>
                                <span className={styles.cardStatus}>
                                  {idsSeleccionados.includes(personData.id_persona) ? "Seleccionado" : "Click para seleccionar"}
                                </span>
                              </div>
                              <div className={styles.cardContent}>
                                <div className={styles.metricRow}>
                                  <span className={styles.metricLabel}>Posición:</span>
                                  <span className={styles.metricValue}>
                                    ({personData.centro[0]}, {personData.centro[1]})
                                  </span>
                                </div>
                                <div className={styles.metricRow}>
                                  <span className={styles.metricLabel}>Dirección:</span>
                                  <span className={styles.metricValue} style={{ fontSize: '1.2em' }}>
                                    {directionSymbol}
                                  </span>
                                </div>
                                <div className={styles.metricRow}>
                                  <span className={styles.metricLabel}>Bbox:</span>
                                  <span className={styles.metricValue}>
                                    [{personData.bbox.join(', ')}]
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={styles.noDataMessage}>
                        <p>No hay datos de tracking disponibles</p>
                      </div>
                    )}
                  </div>
                  {/* Controles de trayectorias */}
                  <div className={styles.trajectoryControls}>
                    <div className={styles.controlRow}>
                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={mostrarTrayectorias}
                          onChange={(e) => setMostrarTrayectorias(e.target.checked)}
                        />
                        Mostrar trayectorias
                      </label>
                      <button
                        onClick={() => {
                          setTrayectorias(new Map());
                          setIdsSeleccionados([]);
                        }}
                        className={styles.clearButton}
                        disabled={trayectorias.size === 0}
                      >
                        Limpiar todas las trayectorias
                      </button>
                    </div>
                    {trayectorias.size > 0 && (
                    <div className={styles.activeTrajectories}>
                      <span>Trayectorias activas: </span>
                      {Array.from(trayectorias.keys()).map(id => {
                        // Obtener la dirección del frame actual para esta persona
                        const direction = frameBuffer[currentIndex]?.metrics?.directions?.[id.toString()]?.[0] || "P";
                        return (
                          <span
                            key={id}
                            className={styles.trajectoryTag}
                            style={{ color: getColorForDirection(direction) }}
                          >
                            ID {id} ({trayectorias.get(id)!.length} puntos) {/* se puede sacar*/}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  </div>

                </div>
              )}

              {/* Métricas grupales */}
              {activeSection === "grupales" && (
                <div className={styles.fullWidthMetricSection}>
                  <div className={styles.metricContentFull}>
                    {!isStopping && isTracking && Array.isArray(groups) && groups.length > 0 ? (
                      <div className={styles.groupMetricsGrid}>
                        {frameBuffer[currentIndex]?.metrics?.groups?.map((grupo: GroupBack, index: number) => (
                          <div 
                            key={`grupo-${index}`}
                            className={`${styles.metricCard} ${grupoSeleccionado === index ? styles.selectedCard : ""}`}
                            onClick={() => {
                              setGrupoSeleccionado(grupoSeleccionado === index ? null : index);
                              toggleSeleccionGrupo(grupo.id_grupo[0]);
                            }}
                          >
                            <div className={styles.cardHeader}>
                              <h4>Grupo {grupo.id_grupo[0]}</h4>
                              <span className={styles.cardStatus}>
                                {gruposSeleccionados.includes(grupo.id_grupo[0]) 
                                  ? "Trayectoria activa" 
                                  : "Click para activar trayectoria"}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSeleccionGrupo(grupo.id_grupo[0]);
                                }}
                                className={styles.toggleButton}
                              >
                                {gruposSeleccionados.includes(grupo.id_grupo[0]) ? "Ocultar Trayectoria" : "Mostrar Trayectoria"}
                              </button>
                            </div>
                            <div className={styles.cardContent}>
                              <div className={styles.metricRow}>
                                <span className={styles.metricLabel}>Total Personas:</span>
                                <span className={styles.metricValue}>{grupo.grupo_ids.length}</span>
                              </div>
                              <div className={styles.metricRow}>
                                <span className={styles.metricLabel}>IDs del Grupo:</span>
                                <span className={styles.metricValue}>
                                  {grupo.grupo_ids.join(", ")}
                                </span>
                              </div>
                              {grupoSeleccionado === index && (
                                <div className={styles.expandedGroupDetails}>
                                  {grupo.grupo_ids.map((personId: number) => {
                                    const personData = frameBuffer[currentIndex]?.metrics?.tracking_data?.find(
                                      (p: TrackingData) => p.id_persona === personId
                                    );
                                    const getDirectionSymbol = (directionCode: string) => {
                                      const directionMap: { [key: string]: string } = {
                                        "P": "⏸️", // Stopped
                                        "D": "➡️", // East
                                        "Q": "↗️", // Northeast
                                        "W": "⬆️", // North
                                        "E": "↖️", // Northwest
                                        "A": "⬅️", // West
                                        "Z": "↙️", // Southwest
                                        "S": "⬇️", // South
                                        "C": "↘️"  // Southeast
                                      };
                                      return directionMap[directionCode] || "❓";
                                    };
                                    const personDirection = frameBuffer[currentIndex]?.metrics?.directions?.[personId.toString()];
                                    const directionSymbol = personDirection ? getDirectionSymbol(personDirection[0]) : "❓";
                                    return (
                                      <div key={personId} className={styles.memberDetail}>
                                        <div className={styles.memberInfo}>
                                          <span className={styles.memberId}>{personId}</span>
                                          {personData && (
                                            <span className={styles.memberPosition}>
                                              Pos: ({personData.centro[0]}, {personData.centro[1]})
                                            </span>
                                          )}
                                          <span className={styles.memberDirection}>
                                            Dir: {directionSymbol}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.noDataMessage}>
                        <p>No hay grupos disponibles</p>
                      </div>
                    )}
                  </div>
                  {/* Controles de trayectorias de grupos */}
                  <div className={styles.trajectoryControls}>
                    <div className={styles.controlRow}>
                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={mostrarTrayectorias}
                          onChange={(e) => setMostrarTrayectorias(e.target.checked)}
                        />
                        Mostrar trayectorias
                      </label>
                      <button
                        onClick={() => {
                          setTrayectoriasGrupos(new Map());
                          setGruposSeleccionados([]);
                        }}
                        className={styles.clearButton}
                        disabled={trayectoriasGrupos.size === 0}
                      >
                        Limpiar trayectorias de grupos
                      </button>
                    </div>
                    {trayectoriasGrupos.size > 0 && (
                      <div className={styles.activeTrajectories}>
                        <span>Trayectorias de grupos activas: </span>
                        {Array.from(trayectoriasGrupos.keys()).map(id => {
                          // Obtener la dirección del grupo en el frame actual
                          const direction = getGrupoDirection(id, currentIndex);
                          return (
                            <span
                              key={id}
                              className={styles.trajectoryTag}
                              style={{ color: getColorForDirection(direction) }}
                            >
                              Grupo {id} ({trayectoriasGrupos.get(id)!.length} puntos)
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
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