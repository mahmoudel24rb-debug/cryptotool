import { NormalizedTrade } from '../exchanges/types';
import { Alert, createAlert, formatUsd } from './types';

interface SpikeConfig {
  lookbackMinutes: number;
  spikeMultiplier: number;
  minSpikeVolumeUsd: number;
}

export class SpikeDetector {
  private config: SpikeConfig;
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs = 5000;

  constructor(config: SpikeConfig) {
    this.config = config;
  }

  detect(trades: NormalizedTrade[], latestTrade: NormalizedTrade): Alert | null {
    const key = `${latestTrade.exchange}:${latestTrade.symbol}`;
    const lastAlert = this.lastAlertTime.get(key) || 0;
    if (Date.now() - lastAlert < this.cooldownMs) return null;

    const now = Date.now();
    const lookbackMs = this.config.lookbackMinutes * 60 * 1000;
    const spikeWindowMs = 5000; // 5-second spike window

    const exchangeTrades = trades.filter(
      t => t.exchange === latestTrade.exchange && t.symbol === latestTrade.symbol
    );

    // Recent trades (spike window)
    const recentTrades = exchangeTrades.filter(t => t.timestamp >= now - spikeWindowMs);
    // Lookback trades for average
    const lookbackTrades = exchangeTrades.filter(
      t => t.timestamp >= now - lookbackMs && t.timestamp < now - spikeWindowMs
    );

    if (lookbackTrades.length < 10) return null;

    let recentVolume = 0;
    let recentBuyVolume = 0;
    let recentSellVolume = 0;
    for (const t of recentTrades) {
      recentVolume += t.usdValue;
      if (t.side === 'BUY') recentBuyVolume += t.usdValue;
      else recentSellVolume += t.usdValue;
    }

    let lookbackVolume = 0;
    for (const t of lookbackTrades) {
      lookbackVolume += t.usdValue;
    }

    // Average volume per 5s window during the lookback period
    const numWindows = (lookbackMs - spikeWindowMs) / spikeWindowMs;
    const avgVolumePerWindow = lookbackVolume / Math.max(numWindows, 1);

    if (avgVolumePerWindow <= 0) return null;

    const multiplier = recentVolume / avgVolumePerWindow;

    if (multiplier >= this.config.spikeMultiplier && recentVolume >= this.config.minSpikeVolumeUsd) {
      this.lastAlertTime.set(key, Date.now());
      const side = recentBuyVolume > recentSellVolume ? 'Buy' : 'Sell';
      return createAlert(
        'SPIKE',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `Massive ${side} Spike on ${key}. Vol: ${formatUsd(recentVolume)}`,
        { recentVolume, avgVolumePerWindow, multiplier, side },
      );
    }

    return null;
  }
}
