import { NormalizedTrade } from '../exchanges/types';
import { Alert, createAlert, formatUsd } from './types';

interface TwapConfig {
  minOccurrences: number;
  sizeVariationPct: number;
  intervalVariationPct: number;
}

/**
 * TWAP/iceberg detector — spots algorithmic execution: repeated clips of
 * near-identical size at near-regular intervals on the same side.
 *
 * Rewritten: the previous version ignored the `trades` window entirely and
 * sampled one trade per detector cycle into a private buffer — the "regular
 * intervals" it measured were the engine's own batching cadence, so its
 * alerts were pure noise feeding the confluence engine.
 */
export class TwapDetector {
  private config: TwapConfig;
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs = 30000;

  // Analysis window and floor: algo clips worth flagging are sizeable
  private windowMs = 10 * 60 * 1000;
  private minClipUsd = 5_000;

  constructor(config: TwapConfig) {
    this.config = config;
  }

  detect(trades: NormalizedTrade[], latestTrade: NormalizedTrade): Alert | null {
    const key = `${latestTrade.exchange}:${latestTrade.symbol}`;
    const lastAlert = this.lastAlertTime.get(key) || 0;
    if (Date.now() - lastAlert < this.cooldownMs) return null;

    const cutoff = Date.now() - this.windowMs;

    // Group same-side sizeable trades into size buckets (~2% granularity via log rounding)
    const buckets = new Map<string, number[]>(); // bucketKey -> timestamps
    for (const t of trades) {
      if (t.timestamp < cutoff) continue;
      if (t.usdValue < this.minClipUsd) continue;
      const sizeBucket = Math.round(Math.log(t.usdValue) / Math.log(1 + this.config.sizeVariationPct / 100));
      const bucketKey = `${t.side}:${sizeBucket}`;
      let arr = buckets.get(bucketKey);
      if (!arr) { arr = []; buckets.set(bucketKey, arr); }
      arr.push(t.timestamp);
    }

    for (const [bucketKey, timestamps] of buckets) {
      if (timestamps.length < this.config.minOccurrences) continue;

      // Check interval regularity over the most recent occurrences
      const recent = timestamps.slice(-this.config.minOccurrences);
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        intervals.push(recent[i] - recent[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval < 1000) continue; // sub-second "regularity" is just market noise

      const maxIntervalDeviation = Math.max(
        ...intervals.map(iv => Math.abs(iv - avgInterval) / avgInterval * 100)
      );
      if (maxIntervalDeviation > this.config.intervalVariationPct) continue;

      // TWAP detected
      this.lastAlertTime.set(key, Date.now());
      const side = bucketKey.startsWith('BUY') ? 'BUY' : 'SELL';
      const direction = side === 'BUY' ? 'buying' : 'selling';
      const strength = Math.min(1.0, timestamps.length / (this.config.minOccurrences * 2));
      const approxClip = Math.exp(
        Number(bucketKey.split(':')[1]) * Math.log(1 + this.config.sizeVariationPct / 100)
      );
      return createAlert(
        'TWAP',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `[TWAP] Systematic algorithmic ${direction} on ${key}: ${timestamps.length} clips ~${formatUsd(approxClip)} every ~${Math.round(avgInterval / 1000)}s.`,
        { side, avgInterval, occurrences: timestamps.length, strength },
      );
    }

    return null;
  }
}
