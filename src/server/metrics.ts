import { NormalizedTrade, Liquidation } from './exchanges/types';

export interface RealtimeMetrics {
  tradesPerMinute: number;
  volumePerMinute: number;
  tradesDelta: number;
  liquidationsPerMinute: number;
}

export class MetricsCalculator {
  private tradeTimestamps: number[] = [];
  private tradeVolumes: { timestamp: number; usd: number }[] = [];
  private liquidationVolumes: { timestamp: number; usd: number }[] = [];

  private prevTradesPerMinute = 0;

  onTrade(trade: NormalizedTrade) {
    const now = Date.now();
    this.tradeTimestamps.push(now);
    this.tradeVolumes.push({ timestamp: now, usd: trade.usdValue });

    // Clean old data (keep last 2 minutes)
    const cutoff = now - 120000;
    this.tradeTimestamps = this.tradeTimestamps.filter(t => t >= cutoff);
    this.tradeVolumes = this.tradeVolumes.filter(t => t.timestamp >= cutoff);
  }

  onLiquidation(liq: Liquidation) {
    const now = Date.now();
    this.liquidationVolumes.push({ timestamp: now, usd: liq.usdValue });

    const cutoff = now - 120000;
    this.liquidationVolumes = this.liquidationVolumes.filter(t => t.timestamp >= cutoff);
  }

  getMetrics(): RealtimeMetrics {
    const now = Date.now();
    const oneMinAgo = now - 60000;
    const twoMinAgo = now - 120000;

    // Current minute
    const currentTrades = this.tradeTimestamps.filter(t => t >= oneMinAgo).length;
    const currentVolume = this.tradeVolumes
      .filter(t => t.timestamp >= oneMinAgo)
      .reduce((sum, t) => sum + t.usd, 0);

    // Previous minute
    const prevTrades = this.tradeTimestamps.filter(t => t >= twoMinAgo && t < oneMinAgo).length;

    // Liquidations in last minute
    const liqVolume = this.liquidationVolumes
      .filter(t => t.timestamp >= oneMinAgo)
      .reduce((sum, t) => sum + t.usd, 0);

    const delta = currentTrades - prevTrades;
    this.prevTradesPerMinute = currentTrades;

    return {
      tradesPerMinute: currentTrades,
      volumePerMinute: currentVolume,
      tradesDelta: delta,
      liquidationsPerMinute: liqVolume,
    };
  }
}
