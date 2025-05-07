import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

export default function DashboardPage() {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [isTracking, setIsTracking] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Conexión al WebSocket para recibir el video procesado
  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8000/ws/video"); // Cambiá por tu URL real
    socket.binaryType = "blob";

    socket.onopen = () => {
      console.log("WebSocket conectado");
      setSocketConnected(true);
    };

    socket.onmessage = (event) => {
      const blob = event.data;
      const videoURL = URL.createObjectURL(blob);
      if (videoRef.current) {
        videoRef.current.src = videoURL;
        videoRef.current.play();
      }
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    socket.onclose = () => {
      console.log("WebSocket cerrado");
      setSocketConnected(false);
    };

    socketRef.current = socket;

    return () => {
      socket.close();
    };
  }, []);

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const videoUrl = URL.createObjectURL(file);
      setVideoSrc(videoUrl);
      setIsCameraActive(false);
      setIsTracking(false);
    }

    // Limpia el valor del input para permitir volver a subir el mismo archivo
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleStartCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setVideoSrc(null);
        setIsCameraActive(true);
        setIsTracking(false);
      }
    } catch (error) {
      console.error("Error al acceder a la cámara:", error);
    }
  };

  const handleStopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setIsCameraActive(false);
    setVideoSrc(null);
  };

  const handleStartTracking = () => {
    setIsTracking(true);
    setVideoSrc(null);
    setIsCameraActive(false);
  };

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Seleccionar fuente de imagen</h1>

      <div className={styles.buttonGroup}>
        {!videoSrc && !isCameraActive && (
          <>
            <button onClick={handleStartCamera}>Cámara del dispositivo</button>
            <button onClick={() => fileInputRef.current?.click()}>Subir archivo</button>
          </>
        )}
        {(videoSrc || isCameraActive) && (
          <button onClick={handleStopCamera}>Eliminar fuente de video</button>
        )}
      </div>


      <div className={styles.contentRow}>
        <div className={styles.videoContainer}>
          {videoSrc ? (
            <video src={videoSrc} controls className={styles.videoElement} />
          ) : isCameraActive ? (
            <video ref={videoRef} autoPlay muted className={styles.videoElement} />
          ) : isTracking ? (
            <video ref={videoRef} autoPlay muted className={styles.videoElement} />
          ) : (
            <p className={styles.textVideoContainer}>Esperando tracking del video</p>
          )}
        </div>

        <div className={styles.zoomScrollContainer}>
          {Array.from({ length: 20 }).map((_, i) => (
            <button key={i}>Zoom Persona {i + 1}</button>
          ))}
        </div>
      </div>

      <input
        type="file"
        accept="video/*"
        onChange={handleVideoChange}
        className={styles.hidden}
        id="video-upload"
        ref={fileInputRef}
      />
    </main>