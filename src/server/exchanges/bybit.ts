import WebSocket from 'ws';
import { BaseExchangeConnector } from './base';
import { ExchangeConfig, NormalizedTrade, OrderBook, Liquidation } from './types';

export class BybitConnector extends BaseExchangeConnector {
  constructor(config: ExchangeConfig) {
    super('BYBIT', config);
  }

  connect() {
    if (this.config.spot) this.connectSpot();
    if (this.config.perp) this.connectPerp();
  }

  private connectSpot() {
    const url = 'wss://stream.bybit.com/v5/public/spot';

    this.createWebSocket(url, 'spot', (ws) => {
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: ['publicTrade.BTCUSDT', 'orderbook.25.BTCUSDT'],
      }));
      this.startBybitHeartbeat(ws, 'spot');
    }, (data) => {
      if (data.op === 'ping') {
        const ws = this.connections.get('spot');
        if (ws?.readyState === 1) ws.send(JSON.stringify({ op: 'pong' }));
        return;
      }
      if (data.op === 'pong' || data.op === 'subscribe') return;
      if (data.topic?.startsWith('publicTrade')) {
        this.handleTrades(data, 'SPOT');
      } else if (data.topic?.startsWith('orderbook')) {
        this.handleOrderBook(data, 'SPOT');
      }
    });
  }

  private connectPerp() {
    const url = 'wss://stream.bybit.com/v5/public/linear';

    this.createWebSocket(url, 'perp', (ws) => {
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: ['publicTrade.BTCUSDT', 'orderbook.25.BTCUSDT', 'liquidation.BTCUSDT'],
      }));
      this.startBybitHeartbeat(ws, 'perp');
    }, (data) => {
      if (data.op === 'ping') {
        const ws = this.connections.get('perp');
        if (ws?.readyState === 1) ws.send(JSON.stringify({ op: 'pong' }));
        return;
      }
      if (data.op === 'pong' || data.op === 'subscribe') return;
      if (data.topic?.startsWith('publicTrade')) {
        this.handleTrades(data, 'PERP');
      } else if (data.topic?.startsWith('orderbook')) {
        this.handleOrderBook(data, 'PERP');
      } else if (data.topic?.startsWith('liquidation')) {
        this.handleLiquidation(data);
      }
    });
  }

  /** Send application-level pings to Bybit every 20s (Bybit requires this to keep alive) */
  private startBybitHeartbeat(ws: WebSocket, id: string) {
    const interval = setInterval(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ op: 'ping' }));
      } else {
        clearInterval(interval);
      }
    }, 20000);
    ws.on('close', () => clearInterval(interval));
  }

  private handleTrades(data: any, market: string) {
    if (!data.data) return;
    for (const t of data.data) {
      const trade: NormalizedTrade = {
        exchange: 'BYBIT',
        market,
        symbol: 'BTCUSDT',
        price: parseFloat(t.p),
        quantity: parseFloat(t.v),
        side: t.S === 'Buy' ? 'BUY' : 'SELL',
        timestamp: parseInt(t.T),
        usdValue: parseFloat(t.p) * parseFloat(t.v),
      };
      this.emitTrade(trade);
    }
  }

  private handleOrderBook(data: any, market: string) {
    if (!data.data) return;
    const d = data.data;
    const book: OrderBook = {
      exchange: 'BYBIT',
      market,
      symbol: 'BTCUSDT',
      bids: new Map((d.b || []).map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])])),
      asks: new Map((d.a || []).map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])])),
      lastUpdate: parseInt(d.ts) || Date.now(),
    };
    this.emitOrderBook(book);
  }

  private handleLiquidation(data: any) {
    if (!data.data) return;
    const d = data.data;
    const liq: Liquidation = {
      exchange: 'BYBIT',
      symbol: 'BTCUSDT',
      side: d.side === 'Sell' ? 'LONG' : 'SHORT',
      price: parseFloat(d.price),
      quantity: parseFloat(d.size),
      usdValue: parseFloat(d.price) * parseFloat(d.size),
      timestamp: parseInt(d.updatedTime) || Date.now(),
    };
    this.emitLiquidation(liq);
  }
}
