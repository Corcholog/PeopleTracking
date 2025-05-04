// pages/index.js
"use client";
import { useState, useEffect, useRef } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';

export default function Home() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const videoRef = useRef(null);
  const rawCanvasRef = useRef(null); // <-- esta es la línea que faltaba
  const annotatedCanvasRef = useRef(null);
  const wsRef = useRef(null);

  // 1. Enumerar cámaras
  useEffect(() => {
    async function listarCamaras() {
      await navigator.mediaDevices.getUserMedia({ video: true });
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter(d => d.kind === 'videoinput'));
    }
    listarCamaras();
  }, []);

  // 2. Abrir stream de la cámara
  useEffect(() => {
    if (!selectedDevice) return;
    let stream;
    navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: selectedDevice } }
    })
    .then(s => {
      stream = s;
      videoRef.current.srcObject = s;
    })
    .catch(console.error);
    return () => {
      stream && stream.getTracks().forEach(t => t.stop());
    };
  }, [selectedDevice]);

  // 3. Inicializar WebSocket y enviar frames
  useEffect(() => {
    if (!videoRef.current) return;
    wsRef.current = new ReconnectingWebSocket("ws://localhost:8000/ws/track/");
    wsRef.current.binaryType = "arraybuffer";

    // Cuando llega un frame anotado del backend:
    wsRef.current.onmessage = (evt) => {
      const bytes = new Uint8Array(evt.data);
      const blob = new Blob([bytes], { type: "image/jpeg" });
      const img = new Image();
      img.onload = () => {
        const canvas = annotatedCanvasRef.current;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(blob);
    };

    const interval = setInterval(() => {
      const video = videoRef.current;
      const canvas = rawCanvasRef.current;
      if (!(video && canvas && wsRef.current.readyState === WebSocket.OPEN)) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        blob && wsRef.current.send(blob);
      }, "image/jpeg", 0.7);
    }, 50);

    return () => {
      clearInterval(interval);
      wsRef.current.close();
    };
  }, [videoRef.current?.srcObject]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Selecciona tu cámara</h1>
      <select onChange={e => setSelectedDevice(e.target.value)} value={selectedDevice}>

        <option value="" disabled>
          -- escoge una cámara --
        </option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Cámara ${d.deviceId.slice(0, 5)}`}
          </option>
        ))}
      </select>

      <div style={{ marginTop: 20, display: "flex", gap: 20 }}>
        {/* Vídeo en vivo */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: 320, border: "1px solid #ccc" }}
        />

        {/* Canvas oculto para captura raw */}
        <canvas ref={rawCanvasRef} style={{ display: "none" }} />

        {/* Canvas donde dibujamos el frame anotado que viene del backend */}
        <canvas
          ref={annotatedCanvasRef}
          style={{ width: 320, border: "1px solid #f00" }}
        />
      </div>
    </div>
  );
}