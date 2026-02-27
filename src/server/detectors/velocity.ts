import { NormalizedTrade } from '../exchanges/types';
import { Alert, createAlert, formatUsd } from './types';

interface VelocityConfig {
  windowSeconds: number;
  minCvdShiftUsd: number;
  clusterWindowSeconds: number;
  minClusterCount: number;
}

interface VelocityEvent {
  timestamp: number;
  cvdShift: number;
  exchange: string;
  symbol: string;
}

export class VelocityDetector {
  private config: VelocityConfig;
  private recentEvents: VelocityEvent[] = [];
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs = 3000;

  constructor(config: VelocityConfig) {
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

    // CVD shift in the short window
    let cvdShift = 0;
    for (const t of windowTrades) {
      cvdShift += t.side === 'BUY' ? t.usdValue : -t.usdValue;
    }

    if (Math.abs(cvdShift) < this.config.minCvdShiftUsd) return null;

    // Record this velocity event
    const event: VelocityEvent = {
      timestamp: Date.now(),
      cvdShift,
      exchange: latestTrade.exchange,
      symbol: latestTrade.symbol,
    };
    this.recentEvents.push(event);

    // Clean old events
    const clusterCutoff = Date.now() - this.config.clusterWindowSeconds * 1000;
    this.recentEvents = this.recentEvents.filter(e => e.timestamp >= clusterCutoff);

    // Check for cluster
    const keyEvents = this.recentEvents.filter(
      e => e.exchange === latestTrade.exchange && e.symbol === latestTrade.symbol
    );

    this.lastAlertTime.set(key, Date.now());

    if (keyEvents.length >= this.config.minClusterCount) {
      const direction = cvdShift > 0 ? 'Buy' : 'Sell';
      return createAlert(
        'VELOCITY',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `[VELOCITY] Flash ${direction} Cluster! ${key} CVD shifted ${formatUsd(Math.abs(cvdShift))} in under ${this.config.windowSeconds}s.`,
        { cvdShift, clusterCount: keyEvents.length },
      );
    }

    const direction = cvdShift > 0 ? 'Pump' : 'Dump';
    return createAlert(
      'VELOCITY',
      latestTrade.exchange,
      latestTrade.market,
      latestTrade.symbol,
      `[VELOCITY] Flash ${direction}! ${key} CVD shifted ${formatUsd(Math.abs(cvdShift))} in under ${this.config.windowSeconds}s.`,
      { cvdShift },
    );
  }
}
