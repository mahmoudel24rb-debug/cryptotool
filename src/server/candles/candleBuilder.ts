import { EventEmitter } from 'events';
import { NormalizedTrade } from '../exchanges/types';

export interface Candle {
  time: number;          // start of the candle (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;        // total USD volume
  buyVolume: number;     // taker buy USD volume
  sellVolume: number;    // taker sell USD volume
  delta: number;         // buyVolume - sellVolume
  trades: number;        // number of trades
}

export interface CandleBuilderConfig {
  maxCandles: number;    // max candles per timeframe in memory (default: 1500)
}

// Supported timeframes in seconds
export const TIMEFRAMES: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
};

// Precomputed entries — avoids allocating a new array from Object.entries()
// on every single trade in the per-trade hot loop.
const TIMEFRAME_ENTRIES: [string, number][] = Object.entries(TIMEFRAMES);

/**
 * Multi-timeframe candle builder.
 * Builds candles from normalized trades and emits 'candle:close' events.
 * Also supports seeding from historical 1m kline data.
 */
export class CandleBuilder extends EventEmitter {
  private candles = new Map<string, Map<number, Candle>>(); // tf -> (time -> Candle)
  private maxCandles: number;

  constructor(config: CandleBuilderConfig = { maxCandles: 1500 }) {
    super();
    this.maxCandles = config.maxCandles;
    for (const tf of Object.keys(TIMEFRAMES)) {
      this.candles.set(tf, new Map());
    }
  }

  /** Process a single trade — updates all timeframes */
  onTrade(trade: NormalizedTrade): void {
    for (const [tf, intervalSec] of TIMEFRAME_ENTRIES) {
      const intervalMs = intervalSec * 1000;
      const candleTime = Math.floor(trade.timestamp / intervalMs) * intervalSec;
      const candles = this.candles.get(tf)!;
      let candle = candles.get(candleTime);

      if (!candle) {
        // Check if a previous candle just closed
        const prevTime = candleTime - intervalSec;
        const prevCandle = candles.get(prevTime);
        if (prevCandle) {
          this.emit('candle:close', tf, prevCandle);
        }

        candle = {
          time: candleTime,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.usdValue,
          buyVolume: trade.side === 'BUY' ? trade.usdValue : 0,
          sellVolume: trade.side === 'SELL' ? trade.usdValue : 0,
          delta: trade.side === 'BUY' ? trade.usdValue : -trade.usdValue,
          trades: 1,
        };
        candles.set(candleTime, candle);
        this.pruneCandles(tf);
      } else {
        candle.high = Math.max(candle.high, trade.price);
        candle.low = Math.min(candle.low, trade.price);
        candle.close = trade.price;
        candle.volume += trade.usdValue;
        if (trade.side === 'BUY') {
          candle.buyVolume += trade.usdValue;
        } else {
          candle.sellVolume += trade.usdValue;
        }
        candle.delta = candle.buyVolume - candle.sellVolume;
        candle.trades += 1;
      }
    }
  }

  /**
   * Seed historical 1m candles (from REST API fetch).
   * Automatically builds higher timeframes from the 1m data.
   */
  seedHistorical(candles1m: Candle[]): void {
    const sorted = [...candles1m].sort((a, b) => a.time - b.time);

    // Store 1m candles directly
    const map1m = this.candles.get('1m')!;
    for (const c of sorted) {
      map1m.set(c.time, c);
    }
    this.pruneCandles('1m');

    // Build higher timeframes from 1m
    for (const [tf, intervalSec] of Object.entries(TIMEFRAMES)) {
      if (tf === '1m') continue;
      const tfMap = this.candles.get(tf)!;

      for (const c of sorted) {
        const candleTime = Math.floor(c.time / intervalSec) * intervalSec;
        let existing = tfMap.get(candleTime);
        if (!existing) {
          existing = {
            time: candleTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            buyVolume: c.buyVolume,
            sellVolume: c.sellVolume,
            delta: c.delta,
            trades: c.trades,
          };
          tfMap.set(candleTime, existing);
        } else {
          existing.high = Math.max(existing.high, c.high);
          existing.low = Math.min(existing.low, c.low);
          existing.close = c.close;
          existing.volume += c.volume;
          existing.buyVolume += c.buyVolume;
          existing.sellVolume += c.sellVolume;
          existing.delta += c.delta;
          existing.trades += c.trades;
        }
      }
      this.pruneCandles(tf);
    }

    // Emit candle:close for all historical candles except the very last one (it's still open)
    for (const [tf, tfMap] of this.candles.entries()) {
      const times = Array.from(tfMap.keys()).sort((a, b) => a - b);
      // Emit for all but the last candle (still forming)
      for (let i = 0; i < times.length - 1; i++) {
        this.emit('candle:close', tf, tfMap.get(times[i])!);
      }
    }
  }

  /** Get all candles for a timeframe, sorted by time */
  getCandles(tf: string): Candle[] {
    const map = this.candles.get(tf);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  }

  /** Get the latest N candles for a timeframe */
  getRecentCandles(tf: string, n: number): Candle[] {
    const all = this.getCandles(tf);
    return all.slice(-n);
  }

  /** Get a single candle at a specific time for a timeframe */
  getCandle(tf: string, time: number): Candle | undefined {
    return this.candles.get(tf)?.get(time);
  }

  /** Get count of candles for a timeframe */
  getCandleCount(tf: string): number {
    return this.candles.get(tf)?.size || 0;
  }

  private pruneCandles(tf: string): void {
    const map = this.candles.get(tf)!;
    if (map.size > this.maxCandles) {
      const times = Array.from(map.keys()).sort((a, b) => a - b);
      const excess = times.length - this.maxCandles;
      for (let i = 0; i < excess; i++) {
        map.delete(times[i]);
      }
    }
  }
}
