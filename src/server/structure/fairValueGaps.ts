import { Candle } from '../candles/candleBuilder';
import { FairValueGap, FVGConfig } from './types';

const MAX_FVGS = 60;

/**
 * Fair Value Gap (FVG) detector.
 * An FVG is a 3-candle pattern where the wick of candle 1 doesn't overlap
 * with the wick of candle 3, leaving a gap (imbalance) in price.
 */
export class FairValueGapDetector {
  private config: FVGConfig;
  private activeFVGs: FairValueGap[] = [];
  private timeframe: string;
  private atrValues: number[] = [];

  constructor(config: FVGConfig, timeframe: string) {
    this.config = config;
    this.timeframe = timeframe;
  }

  /**
   * Called on every new candle close.
   * Checks the last 3 candles for FVG pattern.
   */
  onCandleClose(candles: Candle[]): FairValueGap | null {
    if (candles.length < 3) return null;

    this.updateATR(candles);
    const atr = this.getCurrentATR();
    if (atr <= 0) return null;

    const c1 = candles[candles.length - 3]; // first candle
    const c2 = candles[candles.length - 2]; // middle candle (the impulse)
    const c3 = candles[candles.length - 1]; // third candle

    // Bullish FVG: c1.high < c3.low (gap up)
    if (c3.low > c1.high) {
      const gapSize = c3.low - c1.high;
      if (gapSize >= this.config.minSizeATR * atr) {
        const midPrice = (c1.high + c3.low) / 2;
        const fvg: FairValueGap = {
          id: `FVG-${this.timeframe}-${c2.time}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'BULLISH',
          high: c3.low,      // top of the gap
          low: c1.high,      // bottom of the gap
          size: gapSize,
          sizePercent: (gapSize / midPrice) * 100,
          timestamp: c2.time,
          filled: false,
          filledPercent: 0,
          timeframe: this.timeframe,
        };
        this.activeFVGs.unshift(fvg);
        this.prune();
        return fvg;
      }
    }

    // Bearish FVG: c1.low > c3.high (gap down)
    if (c1.low > c3.high) {
      const gapSize = c1.low - c3.high;
      if (gapSize >= this.config.minSizeATR * atr) {
        const midPrice = (c1.low + c3.high) / 2;
        const fvg: FairValueGap = {
          id: `FVG-${this.timeframe}-${c2.time}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'BEARISH',
          high: c1.low,      // top of the gap
          low: c3.high,      // bottom of the gap
          size: gapSize,
          sizePercent: (gapSize / midPrice) * 100,
          timestamp: c2.time,
          filled: false,
          filledPercent: 0,
          timeframe: this.timeframe,
        };
        this.activeFVGs.unshift(fvg);
        this.prune();
        return fvg;
      }
    }

    return null;
  }

  /** Track FVG fill based on current price action */
  updateFilling(currentHigh: number, currentLow: number): void {
    if (!this.config.trackFilling) return;

    for (const fvg of this.activeFVGs) {
      if (fvg.filled) continue;

      if (fvg.type === 'BULLISH') {
        // Price comes back down into the gap
        if (currentLow <= fvg.high) {
          const fillDepth = Math.max(0, fvg.high - Math.max(currentLow, fvg.low));
          fvg.filledPercent = Math.min(100, (fillDepth / fvg.size) * 100);
          if (currentLow <= fvg.low) {
            fvg.filled = true;
            fvg.filledPercent = 100;
            fvg.filledAt = Math.floor(Date.now() / 1000);
          }
        }
      } else {
        // Price comes back up into the gap
        if (currentHigh >= fvg.low) {
          const fillDepth = Math.max(0, Math.min(currentHigh, fvg.high) - fvg.low);
          fvg.filledPercent = Math.min(100, (fillDepth / fvg.size) * 100);
          if (currentHigh >= fvg.high) {
            fvg.filled = true;
            fvg.filledPercent = 100;
            fvg.filledAt = Math.floor(Date.now() / 1000);
          }
        }
      }
    }
  }

  /** Process historical candles to find existing FVGs */
  processHistorical(candles: Candle[]): void {
    for (let i = 2; i < candles.length; i++) {
      this.updateATR(candles.slice(0, i + 1));
      const slice = candles.slice(0, i + 1);
      this.onCandleClose(slice);
    }
    // Run fill tracking on remaining candles
    if (this.config.trackFilling) {
      for (const c of candles) {
        this.updateFilling(c.high, c.low);
      }
    }
  }

  getActiveFVGs(): FairValueGap[] {
    return this.activeFVGs.filter(f => !f.filled);
  }

  getAllFVGs(): FairValueGap[] {
    return this.activeFVGs;
  }

  private prune(): void {
    if (this.activeFVGs.length > MAX_FVGS) {
      this.activeFVGs = this.activeFVGs.slice(0, MAX_FVGS);
    }
  }

  private updateATR(candles: Candle[]): void {
    if (candles.length < 2) return;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const tr = Math.max(
      last.high - last.low,
      Math.abs(last.high - prev.close),
      Math.abs(last.low - prev.close),
    );
    this.atrValues.push(tr);
    if (this.atrValues.length > 28) this.atrValues = this.atrValues.slice(-28);
  }

  private getCurrentATR(): number {
    if (this.atrValues.length === 0) return 0;
    const n = Math.min(14, this.atrValues.length);
    const recent = this.atrValues.slice(-n);
    return recent.reduce((a, b) => a + b, 0) / n;
  }
}
