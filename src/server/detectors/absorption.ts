import { NormalizedTrade } from '../exchanges/types';
import { Alert, createAlert, formatUsd } from './types';

interface AbsorptionConfig {
  windowSeconds: number;
  minVolumeUsd: number;
  maxPriceMovePct: number;
}

export class AbsorptionDetector {
  private config: AbsorptionConfig;
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs = 5000;

  constructor(config: AbsorptionConfig) {
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

    if (windowTrades.length < 5) return null;

    let buyVolume = 0;
    let sellVolume = 0;
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const t of windowTrades) {
      if (t.side === 'BUY') buyVolume += t.usdValue;
      else sellVolume += t.usdValue;
      if (t.price < minPrice) minPrice = t.price;
      if (t.price > maxPrice) maxPrice = t.price;
    }

    const midPrice = (minPrice + maxPrice) / 2;
    const priceMovePct = midPrice > 0 ? ((maxPrice - minPrice) / midPrice) * 100 : 0;

    // Bearish Absorption: heavy buying but price didn't move up
    if (buyVolume >= this.config.minVolumeUsd && priceMovePct <= this.config.maxPriceMovePct) {
      this.lastAlertTime.set(key, Date.now());
      return createAlert(
        'ABSORPTION',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `Bearish Absorption! Heavy buying (+${formatUsd(buyVolume)}) absorbed by limit sellers on ${key}.`,
        { buyVolume, sellVolume, priceMovePct },
      );
    }

    // Bullish Absorption: heavy selling but price didn't move down
    if (sellVolume >= this.config.minVolumeUsd && priceMovePct <= this.config.maxPriceMovePct) {
      this.lastAlertTime.set(key, Date.now());
      return createAlert(
        'ABSORPTION',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `Bullish Absorption! Heavy selling (-${formatUsd(sellVolume)}) absorbed by limit buyers on ${key}.`,
        { buyVolume, sellVolume, priceMovePct },
      );
    }

    return null;
  }
}
