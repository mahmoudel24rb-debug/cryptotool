import WebSocket from 'ws';
import { BaseExchangeConnector } from './base';
import { ExchangeConfig, NormalizedTrade, OrderBook } from './types';

export class OkxConnector extends BaseExchangeConnector {
  constructor(config: ExchangeConfig) {
    super('OKX', config);
  }

  connect() {
    // OKX uses a single WebSocket for all public channels
    const url = 'wss://ws.okx.com:8443/ws/v5/public';

    this.createWebSocket(url, 'main', (ws) => {
      const args: any[] = [];

      if (this.config.spot) {
        args.push(
          { channel: 'trades', instId: 'BTC-USDT' },
          { channel: 'books5', instId: 'BTC-USDT' },
        );
      }
      if (this.config.perp) {
        args.push(
          { channel: 'trades', instId: 'BTC-USDT-SWAP' },
          { channel: 'books5', instId: 'BTC-USDT-SWAP' },
        );
      }

      ws.send(JSON.stringify({ op: 'subscribe', args }));

      // OKX kills connections silent for 30s — app-level text ping required
      // (the protocol-level ws.ping() doesn't count for them)
      const okxPing = setInterval(() => {
        if (ws.readyState === 1) {
          ws.send('ping');
        } else {
          clearInterval(okxPing);
        }
      }, 25_000);
      ws.on('close', () => clearInterval(okxPing));
    }, (data) => {
      if (data.arg?.channel === 'trades') {
        this.handleTrades(data);
      } else if (data.arg?.channel === 'books5') {
        this.handleBooks(data);
      }
    });
  }

  private getMarket(instId: string): string {
    return instId.includes('SWAP') ? 'PERP' : 'SPOT';
  }

  private handleTrades(data: any) {
    if (!data.data) return;
    for (const t of data.data) {
      const price = parseFloat(t.px);
      const quantity = parseFloat(t.sz);
      const market = this.getMarket(data.arg.instId);
      const trade: NormalizedTrade = {
        exchange: 'OKX',
        market,
        symbol: data.arg.instId,
        price,
        quantity,
        side: t.side === 'buy' ? 'BUY' : 'SELL',
        timestamp: parseInt(t.ts),
        usdValue: price * quantity,
      };
      this.emitTrade(trade);
    }
  }

  private handleBooks(data: any) {
    if (!data.data?.[0]) return;
    const d = data.data[0];
    const market = this.getMarket(data.arg.instId);
    const book: OrderBook = {
      exchange: 'OKX',
      market,
      symbol: data.arg.instId,
      bids: new Map((d.bids || []).map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])])),
      asks: new Map((d.asks || []).map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])])),
      lastUpdate: parseInt(d.ts) || Date.now(),
    };
    this.emitOrderBook(book);
  }
}
