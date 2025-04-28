import VideoPlayer from "@/components/VideoPlayer";

export default function VideoOriginalPage() {
  const backendVideoUrl = "http://localhost:8000/api/tracking"; // Este lo conectamos después

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4 bg-gradient-to-r from-indigo-400 to-purple-500">
      <h1 className="text-2xl font-bold mb-4 text-white">Video Original</h1>
      
      {/* Video Original */}
      <div className="mb-6">
        <VideoPlayer src="/videos/video-prueba.mp4" /> {/* Video fijo por ahora */}
      </div>

      {/* Sección de Live Tracking */}
      <div className="flex flex-col items-center justify-center w-full max-w-md bg-white rounded-lg p-4 shadow-lg">
        <h2 className="text-xl font-semibold text-purple-600 mb-4">Live Tracking</h2>

        {/* Video de tracking (se mostrará cuando se conecte al backend) */}
        <div className="mb-4">
          <VideoPlayer src={backendVideoUrl} />
        </div>

        {/* Botones de zoom que van a cambiar dinámicamente según el tracking */}
        <div className="scroll-buttons flex flex-col overflow-y-auto max-h-40 w-full gap-4">
          <button className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-700">Zoom Persona 1</button>
          <button className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-700">Zoom Persona 2</button>
          <button className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-700">Zoom Persona 3</button>
          <button className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-700">Zoom Persona 4</button>
        </div>
      </div>
    </main>
  );
}
