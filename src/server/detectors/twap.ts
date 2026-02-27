import { NormalizedTrade } from '../exchanges/types';
import { Alert, createAlert } from './types';

interface TwapConfig {
  minOccurrences: number;
  sizeVariationPct: number;
  intervalVariationPct: number;
}

export class TwapDetector {
  private config: TwapConfig;
  private tradeBuffers: Map<string, NormalizedTrade[]> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs = 30000;
  private maxBufferSize = 200;

  constructor(config: TwapConfig) {
    this.config = config;
  }

  detect(trades: NormalizedTrade[], latestTrade: NormalizedTrade): Alert | null {
    const key = `${latestTrade.exchange}:${latestTrade.symbol}`;
    const lastAlert = this.lastAlertTime.get(key) || 0;
    if (Date.now() - lastAlert < this.cooldownMs) return null;

    // Maintain per-exchange trade buffer
    if (!this.tradeBuffers.has(key)) {
      this.tradeBuffers.set(key, []);
    }
    const buffer = this.tradeBuffers.get(key)!;
    buffer.push(latestTrade);
    if (buffer.length > this.maxBufferSize) {
      buffer.splice(0, buffer.length - this.maxBufferSize);
    }

    // Analyze recent trades for TWAP pattern
    // Look at last N trades of the same side
    for (const side of ['BUY', 'SELL'] as const) {
      const sameSideTrades = buffer.filter(t => t.side === side);
      if (sameSideTrades.length < this.config.minOccurrences) continue;

      // Check the last minOccurrences trades
      const recent = sameSideTrades.slice(-this.config.minOccurrences);

      // Check size similarity
      const sizes = recent.map(t => t.usdValue);
      const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const maxSizeDeviation = Math.max(...sizes.map(s => Math.abs(s - avgSize) / avgSize * 100));

      if (maxSizeDeviation > this.config.sizeVariationPct) continue;

      // Check interval regularity
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        intervals.push(recent[i].timestamp - recent[i - 1].timestamp);
      }

      if (intervals.length === 0) continue;

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval <= 0) continue;

      const maxIntervalDeviation = Math.max(
        ...intervals.map(iv => Math.abs(iv - avgInterval) / avgInterval * 100)
      );

      if (maxIntervalDeviation > this.config.intervalVariationPct) continue;

      // TWAP detected!
      this.lastAlertTime.set(key, Date.now());
      const direction = side === 'BUY' ? 'buying' : 'selling';
      return createAlert(
        'TWAP',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `[TWAP] Systematic algorithmic ${direction} detected on ${latestTrade.exchange}:${latestTrade.symbol}.`,
        { side, avgSize, avgInterval, occurrences: recent.length },
      );
    }

    return null;
  }
}
