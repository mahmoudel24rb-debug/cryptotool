import WebSocket from 'ws';
import { BaseExchangeConnector } from './base';
import { ExchangeConfig, NormalizedTrade, OrderBook, Liquidation } from './types';

export class BinanceConnector extends BaseExchangeConnector {
  constructor(config: ExchangeConfig) {
    super('BINANCE', config);
  }

  connect() {
    if (this.config.spot) this.connectSpot();
    if (this.config.perp) this.connectFutures();
  }

  private connectSpot() {
    const streams = 'btcusdt@trade/btcusdt@depth20@100ms';
    const url = `wss://stream.binance.com:9443/ws/${streams}`;

    this.createWebSocket(url, 'spot', (_ws) => {
      // streams are in the URL, no subscription message needed
    }, (data) => {
      if (data.e === 'trade') {
        this.handleSpotTrade(data);
      } else if (data.lastUpdateId) {
        this.handleSpotDepth(data);
      }
    });
  }

  private connectFutures() {
    const streams = 'btcusdt@aggTrade/btcusdt@depth20@100ms/btcusdt@forceOrder';
    const url = `wss://fstream.binance.com/ws/${streams}`;

    this.createWebSocket(url, 'futures', (_ws) => {
      // streams are in the URL
    }, (data) => {
      if (data.e === 'aggTrade') {
        this.handleFuturesTrade(data);
      } else if (data.lastUpdateId) {
        this.handleFuturesDepth(data);
      } else if (data.e === 'forceOrder') {
        this.handleLiquidation(data);
      }
    });
  }

  private handleSpotTrade(data: any) {
    const trade: NormalizedTrade = {
      exchange: 'BINANCE',
      market: 'SPOT',
      symbol: 'btcusdt',
      price: parseFloat(data.p),
      quantity: parseFloat(data.q),
      side: data.m ? 'SELL' : 'BUY', // m=true means buyer is market maker → taker is SELL
      timestamp: data.T || data.E,
      usdValue: parseFloat(data.p) * parseFloat(data.q),
    };
    this.emitTrade(trade);
  }

  private handleFuturesTrade(data: any) {
    const trade: NormalizedTrade = {
      exchange: 'BINANCE_FUTURES',
      market: 'PERP',
      symbol: 'btcusdt',
      price: parseFloat(data.p),
      quantity: parseFloat(data.q),
      side: data.m ? 'SELL' : 'BUY',
      timestamp: data.T || data.E,
      usdValue: parseFloat(data.p) * parseFloat(data.q),
    };
    this.emitTrade(trade);
  }

  private handleSpotDepth(data: any) {
    const book: OrderBook = {
      exchange: 'BINANCE',
      market: 'SPOT',
      symbol: 'btcusdt',
      bids: new Map(data.bids.map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])])),
      asks: new Map(data.asks.map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])])),
      lastUpdate: Date.now(),
    };
    this.emitOrderBook(book);
  }

  private handleFuturesDepth(data: any) {
    const book: OrderBook = {
      exchange: 'BINANCE_FUTURES',
      market: 'PERP',
      symbol: 'btcusdt',
      bids: new Map(data.bids.map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])])),
      asks: new Map(data.asks.map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])])),
      lastUpdate: Date.now(),
    };
    this.emitOrderBook(book);
  }

  private handleLiquidation(data: any) {
    const o = data.o;
    const liq: Liquidation = {
      exchange: 'BINANCE_FUTURES',
      symbol: 'btcusdt',
      side: o.S === 'SELL' ? 'LONG' : 'SHORT', // forced sell = long liquidated
      price: parseFloat(o.p),
      quantity: parseFloat(o.q),
      usdValue: parseFloat(o.p) * parseFloat(o.q),
      timestamp: o.T || data.E,
    };
    this.emitLiquidation(liq);
  }
}
