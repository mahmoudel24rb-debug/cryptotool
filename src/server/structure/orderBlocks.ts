import { Candle } from '../candles/candleBuilder';
import { OrderBlock, OrderBlockConfig, StructureBreak, FairValueGap } from './types';

const MAX_OBS = 50;

/**
 * Order Block detector.
 * An OB is the last opposite-direction candle before a displacement move
 * that causes a BOS or CHoCH.
 */
export class OrderBlockDetector {
  private config: OrderBlockConfig;
  private activeOBs: OrderBlock[] = [];
  private timeframe: string;
  private atrValues: number[] = [];

  constructor(config: OrderBlockConfig, timeframe: string) {
    this.config = config;
    this.timeframe = timeframe;
  }

  /**
   * Called when a structure break is detected.
   * Searches back through candles to find the Order Block.
   */
  onStructureBreak(
    brk: StructureBreak,
    candles: Candle[],
    activeFVGs: FairValueGap[],
  ): OrderBlock | null {
    if (candles.length < 5) return null;

    this.updateATR(candles);
    const atr = this.getCurrentATR();
    if (atr <= 0) return null;

    const isBullish = brk.direction === 'BULLISH';

    // Find the break candle index
    let breakIdx = -1;
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].time === brk.timestamp) {
        breakIdx = i;
        break;
      }
    }
    if (breakIdx < 2) return null;

    // Search back for the last opposite-direction candle before the displacement
    let obCandle: Candle | null = null;
    let obIdx = -1;

    for (let i = breakIdx - 1; i >= Math.max(0, breakIdx - 15); i--) {
      const c = candles[i];
      if (isBullish) {
        // Looking for last bearish candle (close < open)
        if (c.close < c.open) {
          obCandle = c;
          obIdx = i;
          break;
        }
      } else {
        // Looking for last bullish candle (close > open)
        if (c.close > c.open) {
          obCandle = c;
          obIdx = i;
          break;
        }
      }
    }

    if (!obCandle || obIdx === -1) return null;

    // Validate displacement: check candles between OB and break
    let hasDisplacement = false;
    for (let i = obIdx + 1; i <= breakIdx; i++) {
      const bodySize = Math.abs(candles[i].close - candles[i].open);
      if (bodySize > this.config.minDisplacementATR * atr) {
        hasDisplacement = true;
        break;
      }
    }
    if (!hasDisplacement) return null;

    // Check FVG requirement
    let hasFVG = false;
    if (activeFVGs.length > 0) {
      for (const fvg of activeFVGs) {
        if (fvg.type === (isBullish ? 'BULLISH' : 'BEARISH') && fvg.timeframe === this.timeframe) {
          // FVG should be near the OB area
          if (fvg.timestamp >= obCandle.time && fvg.timestamp <= candles[breakIdx].time) {
            hasFVG = true;
            break;
          }
        }
      }
    }

    if (this.config.requireFVG && !hasFVG) return null;

    // Calculate strength score
    const displacementMax = Math.max(
      ...candles.slice(obIdx + 1, breakIdx + 1)
        .map(c => Math.abs(c.close - c.open))
    );
    const displacementScore = Math.min(40, (displacementMax / atr) * 10);

    // Volume score
    const avgVolume = candles.slice(Math.max(0, obIdx - 20), obIdx)
      .reduce((sum, c) => sum + c.volume, 0) / Math.min(20, obIdx);
    const volumeScore = avgVolume > 0
      ? Math.min(30, (obCandle.volume / avgVolume) * 15)
      : 15;

    const fvgBonus = hasFVG ? 15 : 0;
    const freshnessBonus = 15; // always fresh when first created

    const strength = Math.round(displacementScore + volumeScore + fvgBonus + freshnessBonus);

    const ob: OrderBlock = {
      id: `OB-${this.timeframe}-${obCandle.time}-${Math.random().toString(36).slice(2, 6)}`,
      type: isBullish ? 'BULLISH' : 'BEARISH',
      high: obCandle.high,
      low: obCandle.low,
      midpoint: (obCandle.high + obCandle.low) / 2,
      timestamp: obCandle.time,
      volume: obCandle.volume,
      delta: obCandle.delta,
      structureBreak: brk,
      mitigated: false,
      tested: false,
      strength,
      timeframe: this.timeframe,
      hasFVG,
    };

    this.activeOBs.unshift(ob);
    this.pruneOBs();
    return ob;
  }

  /** Update OB lifecycle based on current price */
  updateLifecycle(currentPrice: number, currentClose: number): void {
    for (const ob of this.activeOBs) {
      if (ob.mitigated) continue;

      if (ob.type === 'BULLISH') {
        // Price touches zone = tested
        if (currentPrice <= ob.high && currentPrice >= ob.low && !ob.tested) {
          ob.tested = true;
          ob.testedAt = Math.floor(Date.now() / 1000);
          ob.strength = Math.max(0, ob.strength - 15); // lose freshness bonus
        }
        // Price closes through entire zone = mitigated
        if (currentClose < ob.low) {
          ob.mitigated = true;
          ob.mitigatedAt = Math.floor(Date.now() / 1000);
        }
      } else {
        if (currentPrice >= ob.low && currentPrice <= ob.high && !ob.tested) {
          ob.tested = true;
          ob.testedAt = Math.floor(Date.now() / 1000);
          ob.strength = Math.max(0, ob.strength - 15);
        }
        if (currentClose > ob.high) {
          ob.mitigated = true;
          ob.mitigatedAt = Math.floor(Date.now() / 1000);
        }
      }
    }
  }

  getActiveOBs(): OrderBlock[] {
    if (this.config.autoRemoveMitigated) {
      return this.activeOBs.filter(ob => !ob.mitigated);
    }
    return this.activeOBs;
  }

  getAllOBs(): OrderBlock[] {
    return this.activeOBs;
  }

  private pruneOBs(): void {
    if (this.activeOBs.length > MAX_OBS) {
      this.activeOBs = this.activeOBs.slice(0, MAX_OBS);
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
