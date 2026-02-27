export interface NormalizedTrade {
  exchange: string;        // "BINANCE", "BYBIT", "COINBASE", "HYPERLIQUID", "OKX"
  market: string;          // "SPOT" or "PERP"
  symbol: string;          // "BTCUSDT", "BTC-USD", etc.
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';   // taker side
  timestamp: number;       // ms
  usdValue: number;        // price * quantity (in USD)
}

export interface OrderBook {
  exchange: string;
  market: string;
  symbol: string;
  bids: Map<number, number>;  // price → quantity
  asks: Map<number, number>;
  lastUpdate: number;
}

export interface Liquidation {
  exchange: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  price: number;
  quantity: number;
  usdValue: number;
  timestamp: number;
}

export interface ExchangeConfig {
  enabled: boolean;
  spot: boolean;
  perp: boolean;
}
