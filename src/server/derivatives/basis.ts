import { BasisData, BasisAlert, BasisConfig } from './types';

/**
 * Basis / Premium Tracker.
 * Calculates the spread between perp and spot prices per exchange.
 * Uses live trade data (no polling needed — prices come from WebSocket).
 */
export class BasisTracker {
  private config: BasisConfig;
  private perpPrices = new Map<string, number>();  // exchange -> latest perp price
  private spotPrices = new Map<string, number>();  // exchange -> latest spot price
  private basisHistory: BasisData[] = [];
  private previousAvgSign = 0;
  private alertCallback: ((alert: BasisAlert) => void) | null = null;

  constructor(config: BasisConfig = {
    updateIntervalMs: 1000,
    extremeThresholdPercent: 0.1,
    crossExchangeDivergencePercent: 0.05,
  }) {
    this.config = config;
  }

  onAlert(cb: (alert: BasisAlert) => void): void {
    this.alertCallback = cb;
  }

  /** Update price from a trade — call on every trade */
  updatePrice(exchange: string, market: 'SPOT' | 'PERP', price: number): void {
    if (market === 'PERP') {
      this.perpPrices.set(exchange, price);
    } else {
      this.spotPrices.set(exchange, price);
    }
  }

  /** Compute current basis for all exchanges that have both spot and perp */
  compute(): BasisData[] {
    const results: BasisData[] = [];

    // Map exchange keys to their base names
    const exchangeMap: Record<string, { perp?: string; spot?: string }> = {};

    for (const key of this.perpPrices.keys()) {
      // key like "BINANCE_FUTURES", "BYBIT", "OKX", "HYPERLIQUID"
      const base = key.replace('_FUTURES', '');
      if (!exchangeMap[base]) exchangeMap[base] = {};
      exchangeMap[base].perp = key;
    }
    for (const key of this.spotPrices.keys()) {
      const base = key;
      if (!exchangeMap[base]) exchangeMap[base] = {};
      exchangeMap[base].spot = key;
    }

    for (const [base, keys] of Object.entries(exchangeMap)) {
      const perpPrice = keys.perp ? this.perpPrices.get(keys.perp) : undefined;
      const spotPrice = keys.spot ? this.spotPrices.get(keys.spot) : undefined;

      if (perpPrice && spotPrice && spotPrice > 0) {
        const basis = perpPrice - spotPrice;
        const basisPercent = (basis / spotPrice) * 100;
        results.push({
          exchange: base,
          perpPrice,
          spotPrice,
          basis,
          basisPercent,
          timestamp: Date.now(),
        });
      }
    }

    // Also compute cross-exchange basis if we have a global spot and perp
    // e.g., Binance Futures perp vs Coinbase spot
    const anyPerp = this.perpPrices.values().next().value;
    const coinbaseSpot = this.spotPrices.get('COINBASE');
    if (anyPerp && coinbaseSpot && coinbaseSpot > 0 && results.length === 0) {
      const basis = anyPerp - coinbaseSpot;
      results.push({
        exchange: 'AGGREGATE',
        perpPrice: anyPerp,
        spotPrice: coinbaseSpot,
        basis,
        basisPercent: (basis / coinbaseSpot) * 100,
        timestamp: Date.now(),
      });
    }

    this.basisHistory = results;
    return results;
  }

  /** Check and emit alerts based on current basis data */
  checkAlerts(): void {
    if (!this.alertCallback || this.basisHistory.length === 0) return;

    const data = this.basisHistory;

    // Check extreme basis
    for (const d of data) {
      if (Math.abs(d.basisPercent) > this.config.extremeThresholdPercent) {
        this.alertCallback({
          type: 'BASIS_EXTREME',
          description: d.basisPercent > 0
            ? `${d.exchange}: Premium +${d.basisPercent.toFixed(3)}% — perp traders bullish`
            : `${d.exchange}: Discount ${d.basisPercent.toFixed(3)}% — deleveraging/panic`,
          exchanges: [d],
          timestamp: Date.now(),
        });
      }
    }

    // Check cross-exchange divergence
    if (data.length >= 2) {
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          const diff = Math.abs(data[i].basisPercent - data[j].basisPercent);
          if (diff > this.config.crossExchangeDivergencePercent) {
            this.alertCallback({
              type: 'BASIS_DIVERGENCE',
              description: `Basis divergence: ${data[i].exchange} ${data[i].basisPercent > 0 ? '+' : ''}${data[i].basisPercent.toFixed(3)}% vs ${data[j].exchange} ${data[j].basisPercent > 0 ? '+' : ''}${data[j].basisPercent.toFixed(3)}%`,
              exchanges: [data[i], data[j]],
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    // Check basis flip
    const avgBasis = data.reduce((s, d) => s + d.basisPercent, 0) / data.length;
    const currentSign = Math.sign(avgBasis);
    if (this.previousAvgSign !== 0 && currentSign !== 0 && this.previousAvgSign !== currentSign) {
      this.alertCallback({
        type: 'BASIS_FLIP',
        description: `Basis flip: ${this.previousAvgSign > 0 ? 'premium→discount' : 'discount→premium'} (avg: ${avgBasis.toFixed(3)}%)`,
        exchanges: data,
        timestamp: Date.now(),
      });
    }
    this.previousAvgSign = currentSign;
  }

  getBasisData(): BasisData[] {
    return this.basisHistory;
  }

  getAvgBasisPercent(): number {
    if (this.basisHistory.length === 0) return 0;
    return this.basisHistory.reduce((s, d) => s + d.basisPercent, 0) / this.basisHistory.length;
  }
}
