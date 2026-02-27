import { NormalizedTrade } from '../exchanges/types';
import { Alert, createAlert, formatUsd } from './types';

interface DivergenceConfig {
  windowSeconds: number;
  minCvdChangeUsd: number;
  minPriceChangePct: number;
  micro?: {
    enabled: boolean;
    windowSeconds: number;
    minCvdChangeUsd: number;
    minPriceChangePct: number;
  };
}

export class DivergenceDetector {
  private config: DivergenceConfig;
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs = 8000;

  constructor(config: DivergenceConfig) {
    this.config = config;
  }

  detect(trades: NormalizedTrade[], latestTrade: NormalizedTrade): Alert[] {
    const alerts: Alert[] = [];
    const key = `${latestTrade.exchange}:${latestTrade.symbol}`;

    // Normal divergence
    const normalAlert = this.checkDivergence(
      trades, latestTrade, key,
      this.config.windowSeconds,
      this.config.minCvdChangeUsd,
      this.config.minPriceChangePct,
      false,
    );
    if (normalAlert) alerts.push(normalAlert);

    // Micro divergence
    if (this.config.micro?.enabled) {
      const microAlert = this.checkDivergence(
        trades, latestTrade, `${key}:micro`,
        this.config.micro.windowSeconds,
        this.config.micro.minCvdChangeUsd,
        this.config.micro.minPriceChangePct,
        true,
      );
      if (microAlert) alerts.push(microAlert);
    }

    return alerts;
  }

  private checkDivergence(
    trades: NormalizedTrade[],
    latestTrade: NormalizedTrade,
    alertKey: string,
    windowSeconds: number,
    minCvdChange: number,
    minPriceChange: number,
    isMicro: boolean,
  ): Alert | null {
    const lastAlert = this.lastAlertTime.get(alertKey) || 0;
    if (Date.now() - lastAlert < this.cooldownMs) return null;

    const windowMs = windowSeconds * 1000;
    const cutoff = Date.now() - windowMs;
    const windowTrades = trades.filter(
      t => t.exchange === latestTrade.exchange &&
           t.symbol === latestTrade.symbol &&
           t.timestamp >= cutoff
    );

    if (windowTrades.length < 10) return null;

    // Calculate CVD (cumulative volume delta)
    let cvd = 0;
    for (const t of windowTrades) {
      cvd += t.side === 'BUY' ? t.usdValue : -t.usdValue;
    }

    // Calculate price change
    const firstPrice = windowTrades[0].price;
    const lastPrice = windowTrades[windowTrades.length - 1].price;
    const priceChangePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

    const prefix = isMicro ? '[MICRO] ' : '';
    const key = `${latestTrade.exchange}:${latestTrade.symbol}`;

    // Bullish Divergence: price falling but CVD rising
    if (priceChangePct < -minPriceChange && cvd > minCvdChange) {
      this.lastAlertTime.set(alertKey, Date.now());
      return createAlert(
        'DIVERGENCE',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `${prefix}Bullish Divergence! Price falling but ${key} CVD rising (+${formatUsd(cvd)}).`,
        { cvd, priceChangePct, isMicro },
      );
    }

    // Bearish Divergence: price rising but CVD falling
    if (priceChangePct > minPriceChange && cvd < -minCvdChange) {
      this.lastAlertTime.set(alertKey, Date.now());
      return createAlert(
        'DIVERGENCE',
        latestTrade.exchange,
        latestTrade.market,
        latestTrade.symbol,
        `${prefix}Bearish Divergence! Price rising but ${key} CVD dropping (-${formatUsd(Math.abs(cvd))}).`,
        { cvd, priceChangePct, isMicro },
      );
    }

    return null;
  }
}
