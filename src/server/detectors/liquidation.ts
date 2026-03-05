import { Liquidation } from '../exchanges/types';
import { Alert, createAlert, formatUsd } from './types';

interface LiquidationConfig {
  windowSeconds: number;
  minLiquidationUsd: number;
}

export class LiquidationDetector {
  private config: LiquidationConfig;
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs = 5000;

  constructor(config: LiquidationConfig) {
    this.config = config;
  }

  detect(recentLiqs: Liquidation[], latestLiq: Liquidation): Alert | null {
    const key = `${latestLiq.exchange}:${latestLiq.symbol}:${latestLiq.side}`;
    const lastAlert = this.lastAlertTime.get(key) || 0;
    if (Date.now() - lastAlert < this.cooldownMs) return null;

    const windowMs = this.config.windowSeconds * 1000;
    const cutoff = Date.now() - windowMs;

    const windowLiqs = recentLiqs.filter(
      l => l.exchange === latestLiq.exchange &&
           l.side === latestLiq.side &&
           l.timestamp >= cutoff
    );

    let totalUsd = 0;
    for (const l of windowLiqs) {
      totalUsd += l.usdValue;
    }

    if (totalUsd >= this.config.minLiquidationUsd) {
      this.lastAlertTime.set(key, Date.now());
      const strength = Math.min(1.0, totalUsd / (this.config.minLiquidationUsd * 3));
      return createAlert(
        'LIQUIDATION',
        latestLiq.exchange,
        'PERP',
        latestLiq.symbol,
        `Massive ${latestLiq.side} Liquidation: ${formatUsd(totalUsd)} wiped out on ${latestLiq.exchange}:${latestLiq.symbol}.`,
        { totalUsd, side: latestLiq.side, count: windowLiqs.length, strength },
      );
    }

    return null;
  }
}
