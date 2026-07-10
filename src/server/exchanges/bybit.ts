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
      // Depth 25 does not exist in v5 (spot: 1/50/200) — Bybit rejected the
      // ENTIRE subscribe request including trades, silently freezing this feed
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: ['publicTrade.BTCUSDT', 'orderbook.50.BTCUSDT'],
      }));
      this.startBybitHeartbeat(ws, 'spot');
    }, (data) => {
      if (data.op === 'ping') {
        const ws = this.connections.get('spot');
        if (ws?.readyState === 1) ws.send(JSON.stringify({ op: 'pong' }));
        return;
      }
      if (data.op === 'subscribe' && data.success === false) {
        console.error(`[BYBIT] spot subscribe rejected: ${data.ret_msg}`);
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
      // allLiquidation replaced the deprecated liquidation.* topic;
      // depth 50 (25 is invalid in v5 and poisoned the whole subscription)
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: ['publicTrade.BTCUSDT', 'orderbook.50.BTCUSDT', 'allLiquidation.BTCUSDT'],
      }));
      this.startBybitHeartbeat(ws, 'perp');
    }, (data) => {
      if (data.op === 'ping') {
        const ws = this.connections.get('perp');
        if (ws?.readyState === 1) ws.send(JSON.stringify({ op: 'pong' }));
        return;
      }
      if (data.op === 'subscribe' && data.success === false) {
        console.error(`[BYBIT] perp subscribe rejected: ${data.ret_msg}`);
        return;
      }
      if (data.op === 'pong' || data.op === 'subscribe') return;
      if (data.topic?.startsWith('publicTrade')) {
        this.handleTrades(data, 'PERP');
      } else if (data.topic?.startsWith('orderbook')) {
        this.handleOrderBook(data, 'PERP');
      } else if (data.topic?.startsWith('allLiquidation') || data.topic?.startsWith('liquidation')) {
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

  // Bybit v5 sends one 'snapshot' then 'delta' messages containing ONLY the
  // changed levels (size "0" = remove). Treating every message as a full book
  // replaced the order book with 2-3 levels on each delta — garbage data that
  // fed the trend analyzer's imbalance factor and the heatmap.
  private books = new Map<string, OrderBook>();

  private handleOrderBook(data: any, market: string) {
    if (!data.data) return;
    const d = data.data;
    const key = `BYBIT:${market}`;

    let book = this.books.get(key);
    if (data.type === 'snapshot' || !book) {
      book = {
        exchange: 'BYBIT',
        market,
        symbol: 'BTCUSDT',
        bids: new Map(),
        asks: new Map(),
        lastUpdate: 0,
      };
      this.books.set(key, book);
      book.bids.clear();
      book.asks.clear();
    }

    for (const [priceStr, sizeStr] of (d.b || []) as string[][]) {
      const price = parseFloat(priceStr);
      const size = parseFloat(sizeStr);
      if (size === 0) book.bids.delete(price);
      else book.bids.set(price, size);
    }
    for (const [priceStr, sizeStr] of (d.a || []) as string[][]) {
      const price = parseFloat(priceStr);
      const size = parseFloat(sizeStr);
      if (size === 0) book.asks.delete(price);
      else book.asks.set(price, size);
    }
    book.lastUpdate = parseInt(d.ts ?? data.ts) || Date.now();
    this.emitOrderBook(book);
  }

  private handleLiquidation(data: any) {
    if (!data.data) return;
    // allLiquidation pushes an array of {T, s, S, v, p}; the legacy topic
    // pushed a single {updatedTime, side, size, price} object
    const entries = Array.isArray(data.data) ? data.data : [data.data];
    for (const d of entries) {
      const side = d.S ?? d.side;
      const price = parseFloat(d.p ?? d.price);
      const quantity = parseFloat(d.v ?? d.size);
      if (!isFinite(price) || !isFinite(quantity)) continue;
      const liq: Liquidation = {
        exchange: 'BYBIT',
        symbol: 'BTCUSDT',
        side: side === 'Sell' ? 'LONG' : 'SHORT',
        price,
        quantity,
        usdValue: price * quantity,
        timestamp: parseInt(d.T ?? d.updatedTime) || Date.now(),
      };
      this.emitLiquidation(liq);
    }
  }
}
