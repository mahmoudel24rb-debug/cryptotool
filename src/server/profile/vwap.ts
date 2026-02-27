import { NormalizedTrade } from '../exchanges/types';
import { VWAPData } from '../structure/types';

export interface VWAPConfig {
  sessionResetHour: number;   // UTC hour to reset (0 = midnight UTC)
  showBands: boolean;
}

/**
 * Incremental VWAP calculator with standard deviation bands.
 * VWAP = cumulative(price * volume) / cumulative(volume)
 * Resets daily at the configured UTC hour.
 */
export class VWAPCalculator {
  private config: VWAPConfig;
  private cumulativePV = 0;        // sum of (price * volume)
  private cumulativeVolume = 0;    // sum of volume
  private cumulativeSquaredPV = 0; // sum of (price^2 * volume) for variance
  private anchorTimestamp = 0;     // start of current session (seconds)
  private lastResetDay = -1;

  constructor(config: VWAPConfig = { sessionResetHour: 0, showBands: true }) {
    this.config = config;
  }

  /** Process a single trade */
  onTrade(trade: NormalizedTrade): void {
    // Check for session reset
    this.checkReset(trade.timestamp);

    const price = trade.price;
    const volume = trade.usdValue;

    this.cumulativePV += price * volume;
    this.cumulativeVolume += volume;
    this.cumulativeSquaredPV += price * price * volume;
  }

  /** Seed from historical candles to have VWAP ready at startup */
  seedFromCandles(candles: { time: number; close: number; volume: number }[]): void {
    if (candles.length === 0) return;

    // Find today's session start
    const now = new Date();
    const resetHour = this.config.sessionResetHour;
    const sessionStart = new Date(now);
    sessionStart.setUTCHours(resetHour, 0, 0, 0);
    if (sessionStart.getTime() > now.getTime()) {
      // Reset hour hasn't happened today yet — use yesterday's
      sessionStart.setUTCDate(sessionStart.getUTCDate() - 1);
    }
    const sessionStartSec = Math.floor(sessionStart.getTime() / 1000);

    this.anchorTimestamp = sessionStartSec;
    this.cumulativePV = 0;
    this.cumulativeVolume = 0;
    this.cumulativeSquaredPV = 0;
    this.lastResetDay = sessionStart.getUTCDate();

    // Only use candles from the current session
    for (const c of candles) {
      if (c.time >= sessionStartSec && c.volume > 0) {
        this.cumulativePV += c.close * c.volume;
        this.cumulativeVolume += c.volume;
        this.cumulativeSquaredPV += c.close * c.close * c.volume;
      }
    }
  }

  /** Get current VWAP data */
  getData(): VWAPData {
    if (this.cumulativeVolume === 0) {
      return {
        vwap: 0,
        upperBand1: 0,
        lowerBand1: 0,
        upperBand2: 0,
        lowerBand2: 0,
        anchorTimestamp: this.anchorTimestamp,
        cumulativeVolume: 0,
      };
    }

    const vwap = this.cumulativePV / this.cumulativeVolume;

    // Variance = sum(price^2 * volume) / sum(volume) - vwap^2
    const variance = (this.cumulativeSquaredPV / this.cumulativeVolume) - (vwap * vwap);
    const stdDev = Math.sqrt(Math.max(0, variance));

    return {
      vwap,
      upperBand1: vwap + stdDev,
      lowerBand1: vwap - stdDev,
      upperBand2: vwap + 2 * stdDev,
      lowerBand2: vwap - 2 * stdDev,
      anchorTimestamp: this.anchorTimestamp,
      cumulativeVolume: this.cumulativeVolume,
    };
  }

  private checkReset(timestampMs: number): void {
    const date = new Date(timestampMs);
    const currentDay = date.getUTCDate();
    const currentHour = date.getUTCHours();

    // Reset when we cross the reset hour on a new day
    if (currentDay !== this.lastResetDay && currentHour >= this.config.sessionResetHour) {
      this.reset(timestampMs);
      this.lastResetDay = currentDay;
    }
  }

  private reset(timestampMs: number): void {
    this.cumulativePV = 0;
    this.cumulativeVolume = 0;
    this.cumulativeSquaredPV = 0;
    this.anchorTimestamp = Math.floor(timestampMs / 1000);
  }
}
