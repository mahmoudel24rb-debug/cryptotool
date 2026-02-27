import { Candle } from '../candles/candleBuilder';
import { NormalizedTrade } from '../exchanges/types';

export interface VolumeProfileConfig {
  numBins: number;         // number of price bins (default: 50)
  valueAreaPercent: number; // value area coverage (default: 70 = 70%)
  sessionResetHour: number; // UTC hour to reset (0 = midnight)
}

export interface ProfileBin {
  price: number;           // center price of the bin
  volume: number;          // total volume
  buyVolume: number;       // taker buy volume
  sellVolume: number;      // taker sell volume
  delta: number;           // buyVolume - sellVolume
}

export interface VolumeProfileData {
  bins: ProfileBin[];
  poc: number;             // Point of Control — price with most volume
  vah: number;             // Value Area High
  val: number;             // Value Area Low
  highPrice: number;       // profile range high
  lowPrice: number;        // profile range low
  totalVolume: number;
  hvn: number[];           // High Volume Nodes (prices)
  lvn: number[];           // Low Volume Nodes (prices)
}

/**
 * Volume Profile calculator.
 * Builds a volume-by-price histogram from trades.
 * Computes POC, Value Area (VAH/VAL), and identifies HVN/LVN.
 */
export class VolumeProfileCalculator {
  private config: VolumeProfileConfig;
  private rawData: Map<number, { volume: number; buyVolume: number; sellVolume: number }> = new Map();
  private highPrice = 0;
  private lowPrice = Infinity;
  private totalVolume = 0;
  private binSize = 0;
  private lastResetDay = -1;
  private anchorTimestamp = 0;

  constructor(config: VolumeProfileConfig = { numBins: 50, valueAreaPercent: 70, sessionResetHour: 0 }) {
    this.config = config;
  }

  /** Process a single trade */
  onTrade(trade: NormalizedTrade): void {
    this.checkReset(trade.timestamp);

    const price = trade.price;
    const volume = trade.usdValue;

    if (price > this.highPrice) this.highPrice = price;
    if (price < this.lowPrice) this.lowPrice = price;
    this.totalVolume += volume;

    // Use rounded price as key (to nearest $1 for BTC)
    const roundedPrice = Math.round(price);
    const existing = this.rawData.get(roundedPrice) || { volume: 0, buyVolume: 0, sellVolume: 0 };
    existing.volume += volume;
    if (trade.side === 'BUY') {
      existing.buyVolume += volume;
    } else {
      existing.sellVolume += volume;
    }
    this.rawData.set(roundedPrice, existing);
  }

  /** Seed from historical candles */
  seedFromCandles(candles: Candle[]): void {
    if (candles.length === 0) return;

    // Find session start
    const now = new Date();
    const resetHour = this.config.sessionResetHour;
    const sessionStart = new Date(now);
    sessionStart.setUTCHours(resetHour, 0, 0, 0);
    if (sessionStart.getTime() > now.getTime()) {
      sessionStart.setUTCDate(sessionStart.getUTCDate() - 1);
    }
    const sessionStartSec = Math.floor(sessionStart.getTime() / 1000);
    this.anchorTimestamp = sessionStartSec;
    this.lastResetDay = sessionStart.getUTCDate();

    this.rawData.clear();
    this.highPrice = 0;
    this.lowPrice = Infinity;
    this.totalVolume = 0;

    for (const c of candles) {
      if (c.time < sessionStartSec || c.volume <= 0) continue;

      // Distribute candle volume across the price range
      const candleHigh = Math.round(c.high);
      const candleLow = Math.round(c.low);
      const priceRange = candleHigh - candleLow;

      if (c.high > this.highPrice) this.highPrice = c.high;
      if (c.low < this.lowPrice) this.lowPrice = c.low;

      if (priceRange <= 1) {
        // Tiny candle — all volume at close
        const key = Math.round(c.close);
        const existing = this.rawData.get(key) || { volume: 0, buyVolume: 0, sellVolume: 0 };
        existing.volume += c.volume;
        existing.buyVolume += c.buyVolume;
        existing.sellVolume += c.sellVolume;
        this.rawData.set(key, existing);
      } else {
        // Distribute volume across the candle range
        // Concentrate more at open/close (typical candle volume distribution)
        const points = [c.open, c.high, c.low, c.close];
        const sharePerPoint = c.volume / points.length;
        const buyShare = c.buyVolume / points.length;
        const sellShare = c.sellVolume / points.length;

        for (const p of points) {
          const key = Math.round(p);
          const existing = this.rawData.get(key) || { volume: 0, buyVolume: 0, sellVolume: 0 };
          existing.volume += sharePerPoint;
          existing.buyVolume += buyShare;
          existing.sellVolume += sellShare;
          this.rawData.set(key, existing);
        }
      }
      this.totalVolume += c.volume;
    }
  }

  /** Get current volume profile data */
  getData(): VolumeProfileData {
    if (this.rawData.size === 0 || this.highPrice <= this.lowPrice) {
      return {
        bins: [],
        poc: 0,
        vah: 0,
        val: 0,
        highPrice: 0,
        lowPrice: 0,
        totalVolume: 0,
        hvn: [],
        lvn: [],
      };
    }

    const numBins = this.config.numBins;
    const range = this.highPrice - this.lowPrice;
    this.binSize = range / numBins;

    // Build bins
    const bins: ProfileBin[] = [];
    for (let i = 0; i < numBins; i++) {
      bins.push({
        price: this.lowPrice + (i + 0.5) * this.binSize,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
      });
    }

    // Fill bins from raw data
    for (const [price, data] of this.rawData) {
      const binIdx = Math.min(numBins - 1, Math.max(0, Math.floor((price - this.lowPrice) / this.binSize)));
      bins[binIdx].volume += data.volume;
      bins[binIdx].buyVolume += data.buyVolume;
      bins[binIdx].sellVolume += data.sellVolume;
      bins[binIdx].delta = bins[binIdx].buyVolume - bins[binIdx].sellVolume;
    }

    // Find POC (highest volume bin)
    let pocIdx = 0;
    let maxVol = 0;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i].volume > maxVol) {
        maxVol = bins[i].volume;
        pocIdx = i;
      }
    }
    const poc = bins[pocIdx].price;

    // Calculate Value Area (70% of volume around POC)
    const targetVolume = this.totalVolume * (this.config.valueAreaPercent / 100);
    let vaVolume = bins[pocIdx].volume;
    let vaLowIdx = pocIdx;
    let vaHighIdx = pocIdx;

    while (vaVolume < targetVolume && (vaLowIdx > 0 || vaHighIdx < bins.length - 1)) {
      const nextLow = vaLowIdx > 0 ? bins[vaLowIdx - 1].volume : 0;
      const nextHigh = vaHighIdx < bins.length - 1 ? bins[vaHighIdx + 1].volume : 0;

      if (nextLow >= nextHigh && vaLowIdx > 0) {
        vaLowIdx--;
        vaVolume += bins[vaLowIdx].volume;
      } else if (vaHighIdx < bins.length - 1) {
        vaHighIdx++;
        vaVolume += bins[vaHighIdx].volume;
      } else {
        vaLowIdx--;
        vaVolume += bins[vaLowIdx].volume;
      }
    }

    const vah = bins[vaHighIdx].price + this.binSize / 2;
    const val = bins[vaLowIdx].price - this.binSize / 2;

    // Identify HVN and LVN
    const avgBinVol = this.totalVolume / numBins;
    const hvn: number[] = [];
    const lvn: number[] = [];

    for (let i = 1; i < bins.length - 1; i++) {
      if (bins[i].volume > avgBinVol * 1.5) {
        hvn.push(bins[i].price);
      }
      if (bins[i].volume < avgBinVol * 0.3 && bins[i].volume > 0) {
        lvn.push(bins[i].price);
      }
    }

    return {
      bins,
      poc,
      vah,
      val,
      highPrice: this.highPrice,
      lowPrice: this.lowPrice,
      totalVolume: this.totalVolume,
      hvn: hvn.slice(0, 5),
      lvn: lvn.slice(0, 5),
    };
  }

  private checkReset(timestampMs: number): void {
    const date = new Date(timestampMs);
    const currentDay = date.getUTCDate();
    const currentHour = date.getUTCHours();

    if (currentDay !== this.lastResetDay && currentHour >= this.config.sessionResetHour) {
      this.reset(timestampMs);
      this.lastResetDay = currentDay;
    }
  }

  private reset(timestampMs: number): void {
    this.rawData.clear();
    this.highPrice = 0;
    this.lowPrice = Infinity;
    this.totalVolume = 0;
    this.anchorTimestamp = Math.floor(timestampMs / 1000);
  }
}
