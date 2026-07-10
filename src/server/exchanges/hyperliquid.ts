import WebSocket from 'ws';
import { BaseExchangeConnector } from './base';
import { ExchangeConfig, NormalizedTrade, OrderBook } from './types';

export class HyperliquidConnector extends BaseExchangeConnector {
  constructor(config: ExchangeConfig) {
    super('HYPERLIQUID', config);
  }

  connect() {
    if (this.config.perp) this.connectPerp();
  }

  private connectPerp() {
    const url = 'wss://api.hyperliquid.xyz/ws';

    this.createWebSocket(url, 'perp', (ws) => {
      // Subscribe to trades
      ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'trades', coin: 'BTC' },
      }));
      // Subscribe to L2 book
      ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'l2Book', coin: 'BTC' },
      }));
      // Hyperliquid closes any connection whose CLIENT sent nothing for 60s —
      // without this app-level ping the feed died and reconnected in a loop
      const hlPing = setInterval(() => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ method: 'ping' }));
        } else {
          clearInterval(hlPing);
        }
      }, 30_000);
      ws.on('close', () => clearInterval(hlPing));
    }, (data) => {
      if (data.channel === 'trades') {
        this.handleTrades(data);
      } else if (data.channel === 'l2Book') {
        this.handleL2Book(data);
      }
    });
  }

  private handleTrades(data: any) {
    if (!data.data) return;
    const trades = Array.isArray(data.data) ? data.data : [data.data];
    for (const t of trades) {
      const price = parseFloat(t.px);
      const quantity = parseFloat(t.sz);
      const trade: NormalizedTrade = {
        exchange: 'HYPERLIQUID',
        market: 'PERP',
        symbol: 'BTC',
        price,
        quantity,
        side: t.side === 'B' ? 'BUY' : 'SELL',
        timestamp: t.time || Date.now(),
        usdValue: price * quantity,
      };
      this.emitTrade(trade);
    }
  }

  private handleL2Book(data: any) {
    if (!data.data) return;
    const d = data.data;
    const levels = d.levels || [[], []];
    const book: OrderBook = {
      exchange: 'HYPERLIQUID',
      market: 'PERP',
      symbol: 'BTC',
      bids: new Map((levels[0] || []).map((b: any) => [parseFloat(b.px), parseFloat(b.sz)])),
      asks: new Map((levels[1] || []).map((a: any) => [parseFloat(a.px), parseFloat(a.sz)])),
      lastUpdate: d.time || Date.now(),
    };
    this.emitOrderBook(book);
  }
}
