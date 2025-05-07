"use client";
import { useState, useEffect, useRef } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';

export default function Home() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotatedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<ReconnectingWebSocket | null>(null);

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
    let stream: MediaStream;

    const constraints: MediaStreamConstraints = {
      video: { deviceId: { exact: selectedDevice } }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        console.warn('Cámara exacta no encontrada, usando por defecto:', err);
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        setSelectedDevice("");
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    })();

    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [selectedDevice]);

  // 3. Inicializar WebSocket y enviar frames
  useEffect(() => {
    const videoEl = videoRef.current;
    const rawCanvas = rawCanvasRef.current;
    const annotatedCanvas = annotatedCanvasRef.current;
    if (!videoEl || !rawCanvas || !annotatedCanvas) return;

    wsRef.current = new ReconnectingWebSocket('ws://localhost:8000/ws/analyze/');
    wsRef.current.binaryType = 'arraybuffer';

    wsRef.current.onmessage = (evt: MessageEvent) => {
      const bytes = new Uint8Array(evt.data as ArrayBuffer);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const img = new Image();
      img.onload = () => {
        annotatedCanvas.width = img.width;
        annotatedCanvas.height = img.height;
        const ctx = annotatedCanvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(blob);
    };

    const intervalId = window.setInterval(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      rawCanvas.width = videoEl.videoWidth;
      rawCanvas.height = videoEl.videoHeight;
      const ctx = rawCanvas.getContext('2d');
      ctx?.drawImage(videoEl, 0, 0);
      rawCanvas.toBlob(blob => {
        if (blob) wsRef.current?.send(blob);
      }, 'image/jpeg', 0.7);
    }, 50);

    return () => {
      window.clearInterval(intervalId);
      wsRef.current?.close();
    };
  }, [selectedDevice]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Selecciona tu cámara</h1>
      <select
        onChange={e => setSelectedDevice(e.target.value)}
        value={selectedDevice}
      >
        <option value="" disabled>
          -- escoge una cámara --
        </option>
        {devices.map(d => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Cámara ${d.deviceId.slice(0, 5)}`}
          </option>
        ))}
      </select>

      <div style={{ marginTop: 20, display: 'flex', gap: 20 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: 320, border: '1px solid #ccc' }}
        />

        <canvas ref={rawCanvasRef} style={{ display: 'none' }} />

        <canvas
          ref={annotatedCanvasRef}
          style={{ width: 320, border: '1px solid #f00' }}
        />
      </div>
    </div>
  );
}
