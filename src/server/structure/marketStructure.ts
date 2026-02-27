import { Candle } from '../candles/candleBuilder';
import { SwingDetector } from './swingDetector';
import {
  SwingPoint,
  StructureBreak,
  StructureType,
  StructureDirection,
  TrendState,
  MarketStructureState,
  MarketStructureConfig,
  SwingDetectorConfig,
} from './types';

const MAX_BREAKS = 50;

/**
 * Market Structure analyzer — detects BOS (Break of Structure) and CHoCH (Change of Character).
 *
 * BOS = continuation (break in the direction of the trend)
 * CHoCH = reversal (break against the trend, with displacement)
 */
export class MarketStructureAnalyzer {
  private swingDetector: SwingDetector;
  private config: MarketStructureConfig;
  private trend: TrendState = 'RANGING';
  private lastBOS: StructureBreak | null = null;
  private lastCHoCH: StructureBreak | null = null;
  private recentBreaks: StructureBreak[] = [];
  private atrValues: number[] = [];  // recent ATR values for displacement check
  private timeframe: string;

  constructor(
    swingConfig: SwingDetectorConfig,
    structureConfig: MarketStructureConfig,
    timeframe: string,
  ) {
    this.swingDetector = new SwingDetector(swingConfig);
    this.config = structureConfig;
    this.timeframe = timeframe;
  }

  /**
   * Process a new closed candle.
   * Pass the full candle array each time a candle closes.
   * Returns any new structure breaks detected.
   */
  onCandleClose(candles: Candle[]): StructureBreak[] {
    if (candles.length < 10) return [];

    // Update ATR
    this.updateATR(candles);

    // Detect new swings
    this.swingDetector.update(candles);

    const breaks: StructureBreak[] = [];
    const currentCandle = candles[candles.length - 1];

    // Get current swing state
    const swingHighs = this.swingDetector.getSwingHighs();
    const swingLows = this.swingDetector.getSwingLows();

    // Determine initial trend from swings if we don't have one yet
    if (this.trend === 'RANGING' && swingHighs.length >= 2 && swingLows.length >= 2) {
      this.trend = this.determineTrend(swingHighs, swingLows);
    }

    // Get the most recent unbroken swing high and low
    const lastSH = swingHighs.find(s => !s.broken);
    const lastSL = swingLows.find(s => !s.broken);

    // Check for BOS and CHoCH based on current trend
    if (this.trend === 'UPTREND') {
      // BOS BULLISH: close above last swing high (continuation)
      if (lastSH && currentCandle.close > lastSH.price && !lastSH.broken) {
        const brk = this.createBreak('BOS', 'BULLISH', lastSH, currentCandle);
        breaks.push(brk);
        this.lastBOS = brk;
        lastSH.broken = true;
        lastSH.brokenAt = currentCandle.time;
      }

      // CHoCH BEARISH: close below last swing low (reversal)
      if (lastSL && currentCandle.close < lastSL.price && !lastSL.broken) {
        const bodySize = Math.abs(currentCandle.close - currentCandle.open);
        const atr = this.getCurrentATR();
        // Validate displacement: body must be > minDisplacementATR * ATR
        if (atr > 0 && bodySize > this.config.minDisplacementATR * atr) {
          const brk = this.createBreak('CHoCH', 'BEARISH', lastSL, currentCandle);
          breaks.push(brk);
          this.lastCHoCH = brk;
          this.trend = 'DOWNTREND';
          lastSL.broken = true;
          lastSL.brokenAt = currentCandle.time;
        }
      }
    } else if (this.trend === 'DOWNTREND') {
      // BOS BEARISH: close below last swing low (continuation)
      if (lastSL && currentCandle.close < lastSL.price && !lastSL.broken) {
        const brk = this.createBreak('BOS', 'BEARISH', lastSL, currentCandle);
        breaks.push(brk);
        this.lastBOS = brk;
        lastSL.broken = true;
        lastSL.brokenAt = currentCandle.time;
      }

      // CHoCH BULLISH: close above last swing high (reversal)
      if (lastSH && currentCandle.close > lastSH.price && !lastSH.broken) {
        const bodySize = Math.abs(currentCandle.close - currentCandle.open);
        const atr = this.getCurrentATR();
        if (atr > 0 && bodySize > this.config.minDisplacementATR * atr) {
          const brk = this.createBreak('CHoCH', 'BULLISH', lastSH, currentCandle);
          breaks.push(brk);
          this.lastCHoCH = brk;
          this.trend = 'UPTREND';
          lastSH.broken = true;
          lastSH.brokenAt = currentCandle.time;
        }
      }
    } else {
      // RANGING — check for any break that establishes a trend
      if (lastSH && currentCandle.close > lastSH.price && !lastSH.broken) {
        const brk = this.createBreak('BOS', 'BULLISH', lastSH, currentCandle);
        breaks.push(brk);
        this.lastBOS = brk;
        this.trend = 'UPTREND';
        lastSH.broken = true;
        lastSH.brokenAt = currentCandle.time;
      }
      if (lastSL && currentCandle.close < lastSL.price && !lastSL.broken) {
        const brk = this.createBreak('BOS', 'BEARISH', lastSL, currentCandle);
        breaks.push(brk);
        this.lastBOS = brk;
        this.trend = 'DOWNTREND';
        lastSL.broken = true;
        lastSL.brokenAt = currentCandle.time;
      }
    }

    // Store breaks
    for (const brk of breaks) {
      this.recentBreaks.unshift(brk);
    }
    if (this.recentBreaks.length > MAX_BREAKS) {
      this.recentBreaks = this.recentBreaks.slice(0, MAX_BREAKS);
    }

    return breaks;
  }

  /** Bulk process historical candles */
  processHistorical(candles: Candle[]): void {
    this.swingDetector.processHistorical(candles);

    // Now re-detect structure breaks on the historical data
    this.atrValues = [];
    this.recentBreaks = [];
    this.lastBOS = null;
    this.lastCHoCH = null;
    this.trend = 'RANGING';

    // Replay candle closes
    for (let end = 10; end <= candles.length; end++) {
      const slice = candles.slice(0, end);
      this.updateATR(slice);

      const swingHighs = this.swingDetector.getSwingHighs();
      const swingLows = this.swingDetector.getSwingLows();

      if (this.trend === 'RANGING' && swingHighs.length >= 2 && swingLows.length >= 2) {
        this.trend = this.determineTrend(swingHighs, swingLows);
      }

      const currentCandle = slice[slice.length - 1];
      const lastSH = swingHighs.find(s => !s.broken);
      const lastSL = swingLows.find(s => !s.broken);

      if (this.trend === 'UPTREND') {
        if (lastSH && currentCandle.close > lastSH.price && !lastSH.broken) {
          const brk = this.createBreak('BOS', 'BULLISH', lastSH, currentCandle);
          this.recentBreaks.unshift(brk);
          this.lastBOS = brk;
          lastSH.broken = true;
          lastSH.brokenAt = currentCandle.time;
        }
        if (lastSL && currentCandle.close < lastSL.price && !lastSL.broken) {
          const bodySize = Math.abs(currentCandle.close - currentCandle.open);
          const atr = this.getCurrentATR();
          if (atr > 0 && bodySize > this.config.minDisplacementATR * atr) {
            const brk = this.createBreak('CHoCH', 'BEARISH', lastSL, currentCandle);
            this.recentBreaks.unshift(brk);
            this.lastCHoCH = brk;
            this.trend = 'DOWNTREND';
            lastSL.broken = true;
            lastSL.brokenAt = currentCandle.time;
          }
        }
      } else if (this.trend === 'DOWNTREND') {
        if (lastSL && currentCandle.close < lastSL.price && !lastSL.broken) {
          const brk = this.createBreak('BOS', 'BEARISH', lastSL, currentCandle);
          this.recentBreaks.unshift(brk);
          this.lastBOS = brk;
          lastSL.broken = true;
          lastSL.brokenAt = currentCandle.time;
        }
        if (lastSH && currentCandle.close > lastSH.price && !lastSH.broken) {
          const bodySize = Math.abs(currentCandle.close - currentCandle.open);
          const atr = this.getCurrentATR();
          if (atr > 0 && bodySize > this.config.minDisplacementATR * atr) {
            const brk = this.createBreak('CHoCH', 'BULLISH', lastSH, currentCandle);
            this.recentBreaks.unshift(brk);
            this.lastCHoCH = brk;
            this.trend = 'UPTREND';
            lastSH.broken = true;
            lastSH.brokenAt = currentCandle.time;
          }
        }
      } else {
        if (lastSH && currentCandle.close > lastSH.price && !lastSH.broken) {
          const brk = this.createBreak('BOS', 'BULLISH', lastSH, currentCandle);
          this.recentBreaks.unshift(brk);
          this.lastBOS = brk;
          this.trend = 'UPTREND';
          lastSH.broken = true;
          lastSH.brokenAt = currentCandle.time;
        }
        if (lastSL && currentCandle.close < lastSL.price && !lastSL.broken) {
          const brk = this.createBreak('BOS', 'BEARISH', lastSL, currentCandle);
          this.recentBreaks.unshift(brk);
          this.lastBOS = brk;
          this.trend = 'DOWNTREND';
          lastSL.broken = true;
          lastSL.brokenAt = currentCandle.time;
        }
      }
    }

    if (this.recentBreaks.length > MAX_BREAKS) {
      this.recentBreaks = this.recentBreaks.slice(0, MAX_BREAKS);
    }
  }

  getState(): MarketStructureState {
    return {
      trend: this.trend,
      lastBOS: this.lastBOS,
      lastCHoCH: this.lastCHoCH,
      swingHighs: this.swingDetector.getSwingHighs(),
      swingLows: this.swingDetector.getSwingLows(),
      recentBreaks: this.recentBreaks,
    };
  }

  getTrend(): TrendState {
    return this.trend;
  }

  getTimeframe(): string {
    return this.timeframe;
  }

  getSwingDetector(): SwingDetector {
    return this.swingDetector;
  }

  private createBreak(
    type: StructureType,
    direction: StructureDirection,
    swing: SwingPoint,
    breakCandle: Candle,
  ): StructureBreak {
    return {
      type,
      direction,
      price: swing.price,
      breakPrice: breakCandle.close,
      timestamp: breakCandle.time,
      swingBroken: { ...swing },
    };
  }

  private determineTrend(highs: SwingPoint[], lows: SwingPoint[]): TrendState {
    // Compare the 2 most recent swing highs and lows
    const [h1, h2] = highs; // h1 = newest
    const [l1, l2] = lows;

    const hh = h1.price > h2.price; // Higher High
    const hl = l1.price > l2.price; // Higher Low
    const lh = h1.price < h2.price; // Lower High
    const ll = l1.price < l2.price; // Lower Low

    if (hh && hl) return 'UPTREND';
    if (lh && ll) return 'DOWNTREND';
    return 'RANGING';
  }

  private updateATR(candles: Candle[]): void {
    const period = this.config.atrPeriod;
    if (candles.length < 2) return;

    // Calculate TR for the last candle
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const tr = Math.max(
      last.high - last.low,
      Math.abs(last.high - prev.close),
      Math.abs(last.low - prev.close),
    );

    this.atrValues.push(tr);
    if (this.atrValues.length > period * 2) {
      this.atrValues = this.atrValues.slice(-period * 2);
    }
  }

  private getCurrentATR(): number {
    const period = this.config.atrPeriod;
    if (this.atrValues.length < period) {
      if (this.atrValues.length === 0) return 0;
      // Use what we have
      return this.atrValues.reduce((a, b) => a + b, 0) / this.atrValues.length;
    }
    const recent = this.atrValues.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / period;
  }
}
