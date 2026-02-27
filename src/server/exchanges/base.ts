import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { ExchangeConfig, NormalizedTrade, OrderBook, Liquidation } from './types';

export abstract class BaseExchangeConnector extends EventEmitter {
  protected name: string;
  protected config: ExchangeConfig;
  protected connections: Map<string, WebSocket> = new Map();
  protected reconnectDelays: Map<string, number> = new Map();
  protected orderBooks: Map<string, OrderBook> = new Map();

  constructor(name: string, config: ExchangeConfig) {
    super();
    this.name = name;
    this.config = config;
  }

  abstract connect(): void;

  protected createWebSocket(
    url: string,
    id: string,
    onOpen: (ws: WebSocket) => void,
    onMessage: (data: any) => void,
  ): WebSocket {
    console.log(`[${this.name}] Connecting to ${id}...`);

    const ws = new WebSocket(url);
    this.connections.set(id, ws);
    this.reconnectDelays.set(id, 1000);

    ws.on('open', () => {
      console.log(`[${this.name}] Connected to ${id}`);
      this.reconnectDelays.set(id, 1000);
      onOpen(ws);
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());
        onMessage(data);
      } catch (err) {
        // Binary or non-JSON messages — ignore
      }
    });

    ws.on('error', (err) => {
      console.error(`[${this.name}] Error on ${id}:`, err.message);
    });

    ws.on('close', () => {
      console.log(`[${this.name}] Disconnected from ${id}`);
      this.connections.delete(id);
      this.scheduleReconnect(url, id, onOpen, onMessage);
    });

    // Ping/pong keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    ws.on('close', () => clearInterval(pingInterval));

    return ws;
  }

  private scheduleReconnect(
    url: string,
    id: string,
    onOpen: (ws: WebSocket) => void,
    onMessage: (data: any) => void,
  ) {
    const delay = this.reconnectDelays.get(id) || 1000;
    const nextDelay = Math.min(delay * 2, 30000); // exponential backoff, max 30s
    this.reconnectDelays.set(id, nextDelay);

    console.log(`[${this.name}] Reconnecting ${id} in ${delay}ms...`);
    setTimeout(() => {
      this.createWebSocket(url, id, onOpen, onMessage);
    }, delay);
  }

  protected emitTrade(trade: NormalizedTrade) {
    this.emit('trade', trade);
  }

  protected emitOrderBook(book: OrderBook) {
    this.emit('orderbook', book);
  }

  protected emitLiquidation(liq: Liquidation) {
    this.emit('liquidation', liq);
  }

  disconnect() {
    for (const [id, ws] of this.connections) {
      console.log(`[${this.name}] Closing ${id}`);
      ws.close();
    }
    this.connections.clear();
  }
}
