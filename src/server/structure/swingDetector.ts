import { Candle } from '../candles/candleBuilder';
import { SwingPoint, SwingDetectorConfig } from './types';

const MAX_SWINGS = 50;

/**
 * Detects swing highs and swing lows from candle data.
 * A swing high at index i requires candle[i].high to be the highest
 * among candles [i-lookback .. i+lookback].
 * This means pivots are confirmed with a delay of `lookback` candles.
 */
export class SwingDetector {
  private config: SwingDetectorConfig;
  private swingHighs: SwingPoint[] = [];
  private swingLows: SwingPoint[] = [];
  private lastProcessedIndex = -1;

  constructor(config: SwingDetectorConfig) {
    this.config = config;
  }

  /**
   * Process a closed candle array and detect new swing points.
   * Call this each time a new candle closes with the full candle array.
   * Returns newly detected swing points (if any).
   */
  update(candles: Candle[], endIndex?: number): SwingPoint[] {
    const { lookback } = this.config;
    const len = endIndex ?? candles.length;
    const newSwings: SwingPoint[] = [];

    if (len < lookback * 2 + 1) return newSwings;

    // We check the candle at position (len - 1 - lookback),
    // because we need `lookback` candles after it to confirm.
    const checkIdx = len - 1 - lookback;

    // Only process each index once
    if (checkIdx <= this.lastProcessedIndex) return newSwings;
    this.lastProcessedIndex = checkIdx;

    const candidate = candles[checkIdx];

    // Check swing high
    let isSwingHigh = true;
    for (let j = checkIdx - lookback; j <= checkIdx + lookback; j++) {
      if (j === checkIdx || j < 0 || j >= len) continue;
      if (candles[j].high >= candidate.high) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      const swing: SwingPoint = {
        type: 'HIGH',
        price: candidate.high,
        timestamp: candidate.time,
        candleIndex: checkIdx,
        strength: lookback,
        broken: false,
      };
      this.swingHighs.unshift(swing); // newest first
      if (this.swingHighs.length > MAX_SWINGS) this.swingHighs.pop();
      newSwings.push(swing);
    }

    // Check swing low
    let isSwingLow = true;
    for (let j = checkIdx - lookback; j <= checkIdx + lookback; j++) {
      if (j === checkIdx || j < 0 || j >= candles.length) continue;
      if (candles[j].low <= candidate.low) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      const swing: SwingPoint = {
        type: 'LOW',
        price: candidate.low,
        timestamp: candidate.time,
        candleIndex: checkIdx,
        strength: lookback,
        broken: false,
      };
      this.swingLows.unshift(swing);
      if (this.swingLows.length > MAX_SWINGS) this.swingLows.pop();
      newSwings.push(swing);
    }

    // Update broken status based on current price
    const currentCandle = candles[len - 1];
    for (const sh of this.swingHighs) {
      if (!sh.broken && currentCandle.close > sh.price) {
        sh.broken = true;
        sh.brokenAt = currentCandle.time;
      }
    }
    for (const sl of this.swingLows) {
      if (!sl.broken && currentCandle.close < sl.price) {
        sl.broken = true;
        sl.brokenAt = currentCandle.time;
      }
    }

    return newSwings;
  }

  /** Bulk process historical candles — runs through all of them (O(n), no slice) */
  processHistorical(candles: Candle[]): void {
    const { lookback } = this.config;
    if (candles.length < lookback * 2 + 1) return;

    // Reset state
    this.swingHighs = [];
    this.swingLows = [];
    this.lastProcessedIndex = -1;

    // Process each "closing" by passing endIndex instead of slicing
    for (let end = lookback * 2 + 1; end <= candles.length; end++) {
      this.update(candles, end);
    }
  }

  getSwingHighs(): SwingPoint[] {
    return this.swingHighs;
  }

  getSwingLows(): SwingPoint[] {
    return this.swingLows;
  }

  getAllSwings(): SwingPoint[] {
    return [...this.swingHighs, ...this.swingLows]
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Get the most recent unbroken swing high */
  getLastSwingHigh(): SwingPoint | null {
    return this.swingHighs.find(s => !s.broken) || this.swingHighs[0] || null;
  }

  /** Get the most recent unbroken swing low */
  getLastSwingLow(): SwingPoint | null {
    return this.swingLows.find(s => !s.broken) || this.swingLows[0] || null;
  }
}
