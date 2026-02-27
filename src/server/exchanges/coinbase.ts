import WebSocket from 'ws';
import { BaseExchangeConnector } from './base';
import { ExchangeConfig, NormalizedTrade, OrderBook } from './types';

export class CoinbaseConnector extends BaseExchangeConnector {
  constructor(config: ExchangeConfig) {
    super('COINBASE', config);
  }

  connect() {
    if (this.config.spot) this.connectSpot();
    if (this.config.perp) this.connectPerp();
  }

  private connectSpot() {
    const url = 'wss://ws-feed.exchange.coinbase.com';

    this.createWebSocket(url, 'spot', (ws) => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        product_ids: ['BTC-USD'],
        channels: ['matches', 'level2_batch'],
      }));
    }, (data) => {
      if (data.type === 'match' || data.type === 'last_match') {
        this.handleMatch(data, 'SPOT');
      } else if (data.type === 'l2update') {
        this.handleL2Update(data, 'SPOT');
      } else if (data.type === 'snapshot') {
        this.handleSnapshot(data, 'SPOT');
      }
    });
  }

  private connectPerp() {
    // Coinbase Advanced Trade / International perps
    const url = 'wss://ws-feed.exchange.coinbase.com';

    this.createWebSocket(url, 'perp', (ws) => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        product_ids: ['BTC-PERP-INTX'],
        channels: ['matches', 'level2_batch'],
      }));
    }, (data) => {
      if (data.type === 'match' || data.type === 'last_match') {
        this.handleMatch(data, 'PERP');
      } else if (data.type === 'l2update') {
        this.handleL2Update(data, 'PERP');
      } else if (data.type === 'snapshot') {
        this.handleSnapshot(data, 'PERP');
      }
    });
  }

  private handleMatch(data: any, market: string) {
    const price = parseFloat(data.price);
    const quantity = parseFloat(data.size);
    const trade: NormalizedTrade = {
      exchange: 'COINBASE',
      market,
      symbol: data.product_id || 'BTC-USD',
      price,
      quantity,
      side: data.side === 'sell' ? 'SELL' : 'BUY', // Coinbase side = maker side; taker is opposite
      timestamp: new Date(data.time).getTime(),
      usdValue: price * quantity,
    };
    this.emitTrade(trade);
  }

  private handleSnapshot(data: any, market: string) {
    const book: OrderBook = {
      exchange: 'COINBASE',
      market,
      symbol: data.product_id || 'BTC-USD',
      bids: new Map((data.bids || []).slice(0, 25).map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])])),
      asks: new Map((data.asks || []).slice(0, 25).map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])])),
      lastUpdate: Date.now(),
    };
    this.orderBooks.set(`COINBASE:${market}`, book);
    this.emitOrderBook(book);
  }

  private handleL2Update(data: any, market: string) {
    const key = `COINBASE:${market}`;
    let book = this.orderBooks.get(key);
    if (!book) {
      book = {
        exchange: 'COINBASE',
        market,
        symbol: data.product_id || 'BTC-USD',
        bids: new Map(),
        asks: new Map(),
        lastUpdate: Date.now(),
      };
      this.orderBooks.set(key, book);
    }

    for (const change of data.changes || []) {
      const [side, priceStr, sizeStr] = change;
      const price = parseFloat(priceStr);
      const size = parseFloat(sizeStr);
      const map = side === 'buy' ? book.bids : book.asks;
      if (size === 0) {
        map.delete(price);
      } else {
        map.set(price, size);
      }
    }
    book.lastUpdate = Date.now();
    this.emitOrderBook(book);
  }
}
