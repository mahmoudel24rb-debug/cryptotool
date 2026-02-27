import { NormalizedTrade, OrderBook } from './exchanges/types';
import { Alert } from './detectors/types';

/**
 * Multi-factor trend analyzer.
 * Produces a composite score from -100 (extreme bear) to +100 (extreme bull).
 *
 * Factors:
 *  1. Price momentum (EMA cross: fast vs slow)
 *  2. CVD trend (net buy vs sell pressure)
 *  3. Order book imbalance (bid wall vs ask wall)
 *  4. Signal bias (absorption/divergence/exhaustion direction)
 *  5. Volume momentum (acceleration or deceleration)
 *  6. Liquidation pressure (longs vs shorts being liquidated)
 */

export type Trend = 'BULL' | 'BEAR' | 'NEUTRAL';

export interface TrendResult {
  trend: Trend;
  score: number;          // -100 to +100
  factors: {
    priceMomentum: number;
    cvdTrend: number;
    orderBookImbalance: number;
    signalBias: number;
    volumeMomentum: number;
    liquidationPressure: number;
  };
}

// Exponential moving average helper
function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let avg = values[0];
  for (let i = 1; i < values.length; i++) {
    avg = values[i] * k + avg * (1 - k);
  }
  return avg;
}

export class TrendAnalyzer {
  // Rolling buffers
  private prices: { ts: number; price: number }[] = [];
  private cvdBuffer: { ts: number; delta: number }[] = [];
  private volumeBuffer: { ts: number; vol: number }[] = [];
  private alerts: Alert[] = [];
  private liqLongs = 0;
  private liqShorts = 0;
  private liqResetTime = Date.now();
  private bidTotal = 0;
  private askTotal = 0;

  private readonly MAX_BUFFER = 600; // ~10 min at 1 sample/sec

  onTrade(trade: NormalizedTrade) {
    const now = Date.now();

    // Price buffer (one per second, using latest)
    const lastPrice = this.prices[this.prices.length - 1];
    if (!lastPrice || now - lastPrice.ts >= 1000) {
      this.prices.push({ ts: now, price: trade.price });
      if (this.prices.length > this.MAX_BUFFER) this.prices.shift();
    } else {
      lastPrice.price = trade.price;
    }

    // CVD: accumulate delta
    const delta = trade.side === 'BUY' ? trade.usdValue : -trade.usdValue;
    const lastCvd = this.cvdBuffer[this.cvdBuffer.length - 1];
    if (!lastCvd || now - lastCvd.ts >= 1000) {
      this.cvdBuffer.push({ ts: now, delta });
      if (this.cvdBuffer.length > this.MAX_BUFFER) this.cvdBuffer.shift();
    } else {
      lastCvd.delta += delta;
    }

    // Volume buffer
    const lastVol = this.volumeBuffer[this.volumeBuffer.length - 1];
    if (!lastVol || now - lastVol.ts >= 1000) {
      this.volumeBuffer.push({ ts: now, vol: trade.usdValue });
      if (this.volumeBuffer.length > this.MAX_BUFFER) this.volumeBuffer.shift();
    } else {
      lastVol.vol += trade.usdValue;
    }
  }

  onAlert(alert: Alert) {
    this.alerts.push(alert);
    // Keep last 50 alerts
    if (this.alerts.length > 50) this.alerts.shift();

    // Track liquidation direction
    if (alert.type === 'LIQUIDATION') {
      if (alert.message.includes('LONG')) this.liqLongs += alert.details?.totalUsd || 0;
      if (alert.message.includes('SHORT')) this.liqShorts += alert.details?.totalUsd || 0;
    }

    // Reset liq counters every 5 min
    if (Date.now() - this.liqResetTime > 300000) {
      this.liqLongs = 0;
      this.liqShorts = 0;
      this.liqResetTime = Date.now();
    }
  }

  onOrderBook(book: OrderBook) {
    // Sum bid and ask volumes
    let bids = 0;
    let asks = 0;
    for (const qty of book.bids.values()) bids += qty;
    for (const qty of book.asks.values()) asks += qty;
    // Smoothed update (moving average)
    this.bidTotal = this.bidTotal * 0.9 + bids * 0.1;
    this.askTotal = this.askTotal * 0.9 + asks * 0.1;
  }

  analyze(): TrendResult {
    const factors = {
      priceMomentum: this.calcPriceMomentum(),
      cvdTrend: this.calcCvdTrend(),
      orderBookImbalance: this.calcOrderBookImbalance(),
      signalBias: this.calcSignalBias(),
      volumeMomentum: this.calcVolumeMomentum(),
      liquidationPressure: this.calcLiquidationPressure(),
    };

    // Weighted composite score
    const weights = {
      priceMomentum: 0.25,
      cvdTrend: 0.25,
      orderBookImbalance: 0.15,
      signalBias: 0.15,
      volumeMomentum: 0.10,
      liquidationPressure: 0.10,
    };

    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      score += (factors as any)[key] * weight;
    }

    // Clamp to -100..+100
    score = Math.max(-100, Math.min(100, score));

    let trend: Trend = 'NEUTRAL';
    if (score > 15) trend = 'BULL';
    else if (score < -15) trend = 'BEAR';

    return { trend, score: Math.round(score), factors };
  }

  // ── Factor 1: Price Momentum (EMA cross) ──
  // Fast EMA(8) vs Slow EMA(21) on 1-second price samples
  // Returns -100 to +100
  private calcPriceMomentum(): number {
    if (this.prices.length < 21) return 0;
    const closePrices = this.prices.map(p => p.price);
    const fastEma = ema(closePrices, 8);
    const slowEma = ema(closePrices, 21);

    if (slowEma === 0) return 0;
    const diff = ((fastEma - slowEma) / slowEma) * 10000; // basis points
    // Scale: +/- 10bps = +/- 100 score
    return Math.max(-100, Math.min(100, diff * 10));
  }

  // ── Factor 2: CVD Trend ──
  // Net buy/sell pressure over the window
  // Rising CVD = bullish, falling = bearish
  private calcCvdTrend(): number {
    if (this.cvdBuffer.length < 10) return 0;

    // CVD = cumulative sum of deltas
    const cvdValues: number[] = [];
    let cumulative = 0;
    for (const entry of this.cvdBuffer) {
      cumulative += entry.delta;
      cvdValues.push(cumulative);
    }

    // Compare recent CVD vs old CVD
    const recentLen = Math.min(30, Math.floor(cvdValues.length / 2));
    const recentAvg = cvdValues.slice(-recentLen).reduce((a, b) => a + b, 0) / recentLen;
    const oldAvg = cvdValues.slice(0, recentLen).reduce((a, b) => a + b, 0) / recentLen;

    const diff = recentAvg - oldAvg;
    // Normalize: $1M CVD shift = 50 score
    const normalized = (diff / 1_000_000) * 50;
    return Math.max(-100, Math.min(100, normalized));
  }

  // ── Factor 3: Order Book Imbalance ──
  // More bids than asks = bullish support
  private calcOrderBookImbalance(): number {
    const total = this.bidTotal + this.askTotal;
    if (total === 0) return 0;
    // ratio: 0.5 = balanced, >0.5 = more bids (bullish), <0.5 = more asks (bearish)
    const bidRatio = this.bidTotal / total;
    return (bidRatio - 0.5) * 200; // scale to -100..+100
  }

  // ── Factor 4: Signal Bias ──
  // Count bullish vs bearish signals in recent alerts
  private calcSignalBias(): number {
    const recent = this.alerts.slice(-30);
    if (recent.length === 0) return 0;

    let bull = 0;
    let bear = 0;
    for (const a of recent) {
      const msg = a.message;
      // Bullish signals
      if (a.type === 'ABSORPTION' && msg.includes('Bullish')) bull += 2;
      if (a.type === 'DIVERGENCE' && msg.includes('Bullish')) bull += 3;
      if (a.type === 'EXHAUSTION' && msg.includes('Bullish')) bull += 2;
      if (a.type === 'SPIKE' && msg.includes('Buy')) bull += 1;
      if (a.type === 'VELOCITY' && msg.includes('Buy')) bull += 1;
      if (a.type === 'TWAP' && msg.includes('buying')) bull += 3;
      if (a.type === 'LIQUIDATION' && msg.includes('SHORT')) bull += 2;

      // Bearish signals
      if (a.type === 'ABSORPTION' && msg.includes('Bearish')) bear += 2;
      if (a.type === 'DIVERGENCE' && msg.includes('Bearish')) bear += 3;
      if (a.type === 'EXHAUSTION' && msg.includes('Bearish')) bear += 2;
      if (a.type === 'SPIKE' && msg.includes('Sell')) bear += 1;
      if (a.type === 'VELOCITY' && msg.includes('Sell')) bear += 1;
      if (a.type === 'TWAP' && msg.includes('selling')) bear += 3;
      if (a.type === 'LIQUIDATION' && msg.includes('LONG')) bear += 2;
    }

    const total = bull + bear;
    if (total === 0) return 0;
    // -100 (all bear) to +100 (all bull)
    return ((bull - bear) / total) * 100;
  }

  // ── Factor 5: Volume Momentum ──
  // Increasing volume during up-move = bullish, during down-move = bearish
  private calcVolumeMomentum(): number {
    if (this.volumeBuffer.length < 20 || this.prices.length < 20) return 0;

    const recentVols = this.volumeBuffer.slice(-10).map(v => v.vol);
    const oldVols = this.volumeBuffer.slice(-20, -10).map(v => v.vol);

    const recentAvg = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    const oldAvg = oldVols.reduce((a, b) => a + b, 0) / oldVols.length;

    const volAccel = oldAvg > 0 ? (recentAvg - oldAvg) / oldAvg : 0;

    // Combine with price direction
    const recentPrice = this.prices[this.prices.length - 1].price;
    const oldPrice = this.prices[Math.max(0, this.prices.length - 20)].price;
    const priceDir = recentPrice > oldPrice ? 1 : -1;

    // High volume + price up = bullish, high volume + price down = bearish
    const score = volAccel * priceDir * 100;
    return Math.max(-100, Math.min(100, score));
  }

  // ── Factor 6: Liquidation Pressure ──
  // More long liqs = bearish cascade, more short liqs = bullish squeeze
  private calcLiquidationPressure(): number {
    const total = this.liqLongs + this.liqShorts;
    if (total < 10000) return 0; // minimum threshold $10K

    // More shorts liquidated = bullish (short squeeze), more longs = bearish
    const ratio = (this.liqShorts - this.liqLongs) / total;
    return ratio * 100;
  }
}
