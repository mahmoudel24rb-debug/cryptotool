import { FundingAlert, FundingConfig } from './types';

interface FundingSnapshot {
  exchange: string;
  rate: number;
  nextFundingTime: number;
  timestamp: number;
}

const MAX_SNAPSHOTS = 100;

/**
 * Funding Rate Monitor.
 * Polls funding rates from exchange REST APIs and detects extremes/flips.
 */
export class FundingRateMonitor {
  private config: FundingConfig;
  private snapshots = new Map<string, FundingSnapshot[]>();
  private latestRates = new Map<string, FundingSnapshot>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private alertCallback: ((alert: FundingAlert) => void) | null = null;
  private previousSign = new Map<string, number>(); // for flip detection

  constructor(config: FundingConfig = {
    pollIntervalMs: 30000,
    extremePositiveThreshold: 0.0005,
    extremeNegativeThreshold: -0.0003,
    flipDetection: true,
  }) {
    this.config = config;
  }

  onAlert(cb: (alert: FundingAlert) => void): void {
    this.alertCallback = cb;
  }

  start(): void {
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async poll(): Promise<void> {
    await Promise.allSettled([
      this.fetchBinance(),
      this.fetchBybit(),
      this.fetchOkx(),
      this.fetchHyperliquid(),
    ]);
    this.checkAlerts();
    this.checkDivergence();
  }

  private async fetchBinance(): Promise<void> {
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        this.record('BINANCE_FUTURES', parseFloat(data[0].fundingRate), data[0].fundingTime || 0);
      }
    } catch { /* silent */ }
  }

  private async fetchBybit(): Promise<void> {
    try {
      const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT');
      if (!res.ok) return;
      const data = await res.json();
      const item = data?.result?.list?.[0];
      if (item) {
        this.record('BYBIT', parseFloat(item.fundingRate || '0'), parseInt(item.nextFundingTime || '0'));
      }
    } catch { /* silent */ }
  }

  private async fetchOkx(): Promise<void> {
    try {
      const res = await fetch('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP');
      if (!res.ok) return;
      const data = await res.json();
      const item = data?.data?.[0];
      if (item) {
        this.record('OKX', parseFloat(item.fundingRate || '0'), parseInt(item.nextFundingTime || '0'));
      }
    } catch { /* silent */ }
  }

  private async fetchHyperliquid(): Promise<void> {
    try {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const assetCtxs = data?.[1];
      if (Array.isArray(assetCtxs)) {
        const btc = assetCtxs.find((a: any) => a.coin === 'BTC') || assetCtxs[0];
        if (btc && btc.funding) {
          this.record('HYPERLIQUID', parseFloat(btc.funding), 0);
        }
      }
    } catch { /* silent */ }
  }

  private record(exchange: string, rate: number, nextFundingTime: number): void {
    const snap: FundingSnapshot = { exchange, rate, nextFundingTime, timestamp: Date.now() };
    this.latestRates.set(exchange, snap);

    if (!this.snapshots.has(exchange)) {
      this.snapshots.set(exchange, []);
    }
    const history = this.snapshots.get(exchange)!;
    history.push(snap);
    if (history.length > MAX_SNAPSHOTS) {
      history.splice(0, history.length - MAX_SNAPSHOTS);
    }
  }

  private checkAlerts(): void {
    if (!this.alertCallback) return;

    for (const [exchange, snap] of this.latestRates) {
      const rate = snap.rate;

      // Check extreme
      if (rate > this.config.extremePositiveThreshold || rate < this.config.extremeNegativeThreshold) {
        const cascadeRisk = this.assessCascadeRisk(rate);
        const annualized = rate * 3 * 365 * 100; // 3 fundings/day * 365 days * 100 for %

        let interpretation: string;
        if (rate > 0.001) {
          interpretation = 'Overheated market — longs paying heavily, dump risk';
        } else if (rate > this.config.extremePositiveThreshold) {
          interpretation = 'High funding — dominant bullish sentiment';
        } else if (rate < -0.0005) {
          interpretation = 'Panic shorting — potential short squeeze';
        } else {
          interpretation = 'Negative funding — bearish sentiment';
        }

        this.alertCallback({
          type: 'FUNDING_EXTREME',
          exchange,
          symbol: 'BTC',
          currentRate: rate,
          rateAnnualized: annualized,
          interpretation,
          cascadeRisk,
          timestamp: Date.now(),
        });
      }

      // Check flip
      if (this.config.flipDetection) {
        const prevSign = this.previousSign.get(exchange);
        const currentSign = Math.sign(rate);
        if (prevSign !== undefined && prevSign !== 0 && currentSign !== 0 && prevSign !== currentSign) {
          this.alertCallback({
            type: 'FUNDING_FLIP',
            exchange,
            symbol: 'BTC',
            currentRate: rate,
            rateAnnualized: rate * 3 * 365 * 100,
            interpretation: `Funding flip ${prevSign > 0 ? 'positive→negative' : 'negative→positive'} — sentiment shift`,
            cascadeRisk: 'MEDIUM',
            timestamp: Date.now(),
          });
        }
        this.previousSign.set(exchange, currentSign);
      }
    }
  }

  private checkDivergence(): void {
    if (!this.alertCallback) return;
    const rates = Array.from(this.latestRates.entries());
    if (rates.length < 2) return;

    for (let i = 0; i < rates.length; i++) {
      for (let j = i + 1; j < rates.length; j++) {
        const [exA, snapA] = rates[i];
        const [exB, snapB] = rates[j];
        // One positive, one negative
        if ((snapA.rate > 0.0001 && snapB.rate < -0.0001) || (snapA.rate < -0.0001 && snapB.rate > 0.0001)) {
          this.alertCallback({
            type: 'FUNDING_DIVERGENCE',
            exchange: `${exA} vs ${exB}`,
            symbol: 'BTC',
            currentRate: (snapA.rate + snapB.rate) / 2,
            rateAnnualized: 0,
            interpretation: `Funding divergence: ${exA} ${(snapA.rate * 100).toFixed(4)}% vs ${exB} ${(snapB.rate * 100).toFixed(4)}%`,
            cascadeRisk: 'MEDIUM',
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  private assessCascadeRisk(rate: number): FundingAlert['cascadeRisk'] {
    const absRate = Math.abs(rate);
    if (absRate > 0.001) return 'CRITICAL';
    if (absRate > 0.0005) return 'HIGH';
    if (absRate > 0.0003) return 'MEDIUM';
    return 'LOW';
  }

  /** Get average funding rate across exchanges */
  getAvgRate(): number {
    if (this.latestRates.size === 0) return 0;
    let sum = 0;
    for (const snap of this.latestRates.values()) sum += snap.rate;
    return sum / this.latestRates.size;
  }

  getLatestRates(): Map<string, FundingSnapshot> {
    return new Map(this.latestRates);
  }

  getCascadeRisk(): FundingAlert['cascadeRisk'] {
    return this.assessCascadeRisk(this.getAvgRate());
  }

  /** Get funding data for a specific exchange */
  getExchangeRate(exchange: string): number {
    return this.latestRates.get(exchange)?.rate || 0;
  }
}
