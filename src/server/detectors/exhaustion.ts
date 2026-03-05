import { NormalizedTrade } from '../exchanges/types';
import { Alert, createAlert, formatUsd } from './types';

interface ExhaustionConfig {
  minPriceMoveUsd: number;  // renamed from minPriceDropUsd — used for both drops and rises
  maxVolumeUsd: number;
  windowSeconds: number;
}

export class ExhaustionDetector {
  private config: ExhaustionConfig;
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs = 10000;

  constructor(config: ExhaustionConfig) {
    this.config = config;
  }

  detect(trades: NormalizedTrade[], latestTrade: NormalizedTrade): Alert | null {
    const key = `${latestTrade.exchange}:${latestTrade.symbol}`;
    const lastAlert = this.lastAlertTime.get(key) || 0;
    if (Date.now() - lastAlert < this.cooldownMs) return null;

    const windowMs = this.config.windowSeconds * 1000;
    const cutoff = Date.now() - windowMs;
    const windowTrades = trades.filter(
      t => t.exchange === latestTrade.exchange &&
           t.symbol === latestTrade.symbol &&
           t.timestamp >= cutoff
    );

    if (windowTrades.length < 3) return null;

    const firstPrice = windowTrades[0].price;
    const lastPrice = windowTrades[windowTrades.length - 1].price;
    const priceDropUsd = firstPrice - lastPrice;
    const priceRiseUsd = lastPrice - firstPrice;

    let totalVolume = 0;
    for (const t of windowTrades) {
      totalVolume += t.usdValue;
    }

    // Bullish Exhaustion: price dropped significantly on low volume → sellers exhausted
    if (priceDropUsd >= this.config.minPriceMoveUsd && totalVolume <= this.config.maxVolumeUsd) {
      this.lastAlertTime.set(key, Date.now());
      const strength = Math.min(1.0, priceDropUsd / (this.config.minPriceMoveUsd * 3));
      return createAlert(
        'EXHAUSTION',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `Bullish Exhaustion! ${key} dropped $${priceDropUsd.toFixed(2)} on mere ${formatUsd(totalVolume)} volume. Sellers exhausted.`,
        { priceDropUsd, totalVolume, strength },
      );
    }

    // Bearish Exhaustion: price rose significantly on low volume → buyers exhausted
    if (priceRiseUsd >= this.config.minPriceMoveUsd && totalVolume <= this.config.maxVolumeUsd) {
      this.lastAlertTime.set(key, Date.now());
      const strength = Math.min(1.0, priceRiseUsd / (this.config.minPriceMoveUsd * 3));
      return createAlert(
        'EXHAUSTION',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `Bearish Exhaustion! ${key} rose $${priceRiseUsd.toFixed(2)} on mere ${formatUsd(totalVolume)} volume. Buyers exhausted.`,
        { priceRiseUsd, totalVolume, strength },
      );
    }

    return null;
  }
}
