import { useEffect, useRef, useState, useCallback } from "react";

interface UseWebSocketOptions {
  url: string;
  onMessage?: (event: MessageEvent) => void;
  onStopped?: () => void;
}

export function useWebSocket({ url, onMessage, onStopped}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const readyPromise = useRef<Promise<void> | null>(null);
  const resolveReady = useRef<(() => void) | null>(null);

  const initReadyPromise = () => {
    readyPromise.current = new Promise((resolve) => {
      resolveReady.current = resolve;
    });
  };

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    initReadyPromise();

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      console.log("🔗 WebSocket conectado");
    };

  ws.onmessage = (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ready" && msg.status === true) {
          setIsReady(true);
          resolveReady.current?.();
        } else if (msg.type === "stopped") {
          onStopped?.();
        }
      } catch {
        console.warn("Mensaje no parseable:", event.data);
      }
    }
    onMessage?.(event);
  };

    ws.onclose = () => {
      console.log("🔒 WebSocket cerrado");
      setIsConnected(false);
      setIsReady(false);
    };

    ws.onerror = (err) => {
      console.error("⚠️ WebSocket error:", err);
      ws.close();
    };
  }, [url, onMessage]);

  // En este caso no queremos conectar automáticamente al montar
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((data: Blob | string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      console.warn("Intento de enviar dato cuando WebSocket no está abierto");
    }
  }, []);

  const waitUntilReady = useCallback(async () => {
    if (isReady) return;
    if (!readyPromise.current) initReadyPromise();
    return readyPromise.current;
  }, [isReady]);

  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsReady(false);
    setIsConnected(false);
    // Reiniciar promise para próxima conexión
    initReadyPromise();
  }, []);

  return {
    send,
    waitUntilReady,
    reset,
    isConnected,
    isReady,
    connect,
    ws: wsRef.current,
  };
}
