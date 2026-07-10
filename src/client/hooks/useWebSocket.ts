import { useEffect, useRef, useCallback, useState } from 'react';

export interface WSMessage {
  type: string;
  data: any;
  timestamp: number;
}

type MessageHandler = (msg: WSMessage) => void;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const [connected, setConnected] = useState(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const torndownRef = useRef(false); // true once the hook unmounts — suppress all reconnects

  const connect = useCallback(() => {
    if (torndownRef.current) return;

    // Never stack a second socket on top of a live one. The previous version
    // closed-then-reopened on every call, and the closed socket's onclose
    // scheduled ANOTHER reconnect — a self-perpetuating storm (amplified by
    // React StrictMode's mount/unmount/remount in dev). Each reconnect resent
    // a multi-MB full candle sync; during the NY-open volume spike this
    // saturated the server event loop and froze the charts.
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] Connected to server');
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        const handlers = handlersRef.current.get(msg.type);
        if (handlers) {
          for (const handler of handlers) handler(msg);
        }
        const allHandlers = handlersRef.current.get('*');
        if (allHandlers) {
          for (const handler of allHandlers) handler(msg);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      // Ignore the close if this socket was already superseded (replaced by a
      // newer one, or torn down) — only the CURRENT live socket may schedule a
      // reconnect. This is what breaks the infinite reconnect loop.
      if (wsRef.current !== ws) return;
      setConnected(false);
      if (torndownRef.current) return;
      console.log('[WS] Disconnected, reconnecting in 2s...');
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }, [url]);

  // Reconnect when the tab becomes visible again — but only if the socket is
  // actually dead. Forcing a reconnect on every tab switch resent the full sync.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      console.log('[WS] Tab visible and socket dead — reconnecting');
      clearTimeout(reconnectTimerRef.current);
      connect();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [connect]);

  useEffect(() => {
    torndownRef.current = false;
    connect();
    return () => {
      torndownRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      const ws = wsRef.current;
      wsRef.current = null; // detach first so the impending onclose is ignored
      try { ws?.close(); } catch {}
    };
  }, [connect]);

  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  return { connected, subscribe };
}
