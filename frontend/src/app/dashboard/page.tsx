"use client";

import VideoPlayer from "@/components/VideoPlayer";
import { useRef, useState } from "react";

export default function DashboardPage() {
  // Estado para almacenar la URL del video seleccionado o la referencia al stream de la cámara
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false); // Estado para saber si la cámara está activa
  const videoRef = useRef<HTMLVideoElement | null>(null); // Ref para la etiqueta <video>

  // Función para manejar la selección del archivo
  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const videoUrl = URL.createObjectURL(file);
      setVideoSrc(videoUrl);
      setIsCameraActive(false); // Desactivar cámara si se selecciona un archivo
    }
  };

  // Función para activar la cámara del dispositivo
  const handleStartCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream; // Asignamos el stream de la cámara al video
        setVideoSrc(null); // Limpiar el video actual
        setIsCameraActive(true); // Marcar que la cámara está activa
      }
    } catch (error) {
      console.error("Error al acceder a la cámara:", error);
    }
  };

  // Función para detener la cámara
  const handleStopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach((track) => track.stop()); // Detener las pistas de la cámara
    }
    setIsCameraActive(false);
    setVideoSrc(null); // Limpiar video al detener la cámara
  };

  // Función para eliminar el video
  const handleDeleteVideo = () => {
    setVideoSrc(null);
    setIsCameraActive(false);
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-r from-indigo-400 to-purple-500">
      <div className="container flex w-11/12 max-w-6xl h-5/6 bg-white rounded-lg shadow-2xl overflow-hidden">
        
        {/* Sección de la Cámara Original */}
        <div className="left w-1/2 p-6 bg-white flex flex-col items-center justify-between border-r-2 border-gray-200 relative">
          <h2 className="text-xl font-semibold text-purple-600 mb-6">Cámara 1</h2>

          {/* Mostrar el video cargado o de la cámara */}
          {videoSrc ? (
            <div className="video-container w-full h-full flex justify-center items-center mb-6">
              <VideoPlayer src={videoSrc} />
            </div>
          ) : isCameraActive ? (
            <div className="video-container w-full h-full flex justify-center items-center mb-6">
              {/* Video en vivo de la cámara */}
              <video ref={videoRef} autoPlay playsInline className="w-full h-full rounded-lg" />
            </div>
          ) : (
            <div className="upload-area flex flex-col items-center justify-center bg-blue-100 p-4 rounded-lg shadow-md w-full h-full mb-6 border-2 border-blue-300">
              <p className="text-blue-600 font-semibold text-md">
                No se ha seleccionado ningún video ni activado la cámara
              </p>
            </div>
          )}

          {/* Botones debajo del video */}
          <div className="w-full flex flex-col gap-4 mt-4">
            {!isCameraActive && !videoSrc && (
              <>
                <button
                  onClick={handleStartCamera}
                  className="bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-700 w-full"
                >
                  Haz clic para usar la cámara del dispositivo
                </button>
                <button
                  onClick={() => document.getElementById("video-upload")?.click()}
                  className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-700 w-full"
                >
                  Haz clic para seleccionar un video
                </button>
              </>
            )}

            {(videoSrc || isCameraActive) && (
              <button
                onClick={handleDeleteVideo}
                className="bg-red-500 text-white py-2 px-4 rounded-lg hover:bg-red-700 w-full"
              >
                {isCameraActive ? "Detener cámara" : "Eliminar video"}
              </button>
            )}
          </div>

          {/* Input de carga de video (oculto) */}
          <input
            type="file"
            accept="video/*"
            onChange={handleVideoChange}
            className="hidden"
            id="video-upload"
          />
        </div>

        
        {/* Sección de Live Tracking */}
        <div className="right w-1/2 p-6 bg-white flex flex-col items-center justify-between">
          <h2 className="text-xl font-semibold text-purple-600 mb-6">Live Tracking</h2>
          
          {/* Video de tracking (aún no disponible, por ahora estático) */}
          <div className="video-container mb-6">
            <VideoPlayer src="http://localhost:8000/api/tracking" />
          </div>

          {/* Botones de zoom */}
          <div className="scroll-buttons w-full flex flex-col gap-4 overflow-y-auto max-h-60">
            <button className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-700">
              Zoom Persona 1
            </button>
            <button className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-700">
              Zoom Persona 2
            </button>
            <button className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-700">
              Zoom Persona 3
            </button>
            <button className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-700">
              Zoom Persona 4
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
