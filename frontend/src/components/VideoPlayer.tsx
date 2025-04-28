"use client";

import React from "react";

interface VideoPlayerProps {
  src: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src }) => {
  return (
    <div className="flex justify-center p-4">
      <video
        src={src}
        controls
        autoPlay
        className="rounded-lg shadow-lg max-w-full h-auto"
      >
        Tu navegador no soporta el elemento de video.
      </video>
    </div>
  );
};

export default VideoPlayer;
