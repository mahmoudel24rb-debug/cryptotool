import { OIAlert, OIConfig } from './types';

interface OISnapshot {
  exchange: string;
  oi: number;       // USD
  price: number;
  timestamp: number;
}

const MAX_SNAPSHOTS = 200;

/**
 * Open Interest Tracker.
 * Polls OI from exchange REST APIs and detects surges/flushes/divergences.
 */
export class OpenInterestTracker {
  private config: OIConfig;
  private snapshots = new Map<string, OISnapshot[]>(); // exchange -> history
  private latestOI = new Map<string, number>();
  private latestPrice = new Map<string, number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private alertCallback: ((alert: OIAlert) => void) | null = null;

  constructor(config: OIConfig = { pollIntervalMs: 10000, alertThresholdPercent: 2, windowMinutes: 5 }) {
    this.config = config;
  }

  onAlert(cb: (alert: OIAlert) => void): void {
    this.alertCallback = cb;
  }

  /** Update current price (called from trade stream) */
  updatePrice(exchange: string, price: number): void {
    this.latestPrice.set(exchange, price);
  }

  /** Start polling all exchanges */
  start(): void {
    this.poll(); // immediate first poll
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

    // Check for alerts after each poll
    this.checkAlerts();
    this.checkDivergence();
  }

  private async fetchBinance(): Promise<void> {
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
      if (!res.ok) return;
      const data = await res.json();
      // data: { openInterest: "12345.67", symbol: "BTCUSDT", time: 1234567890 }
      const price = this.latestPrice.get('BINANCE_FUTURES') || this.latestPrice.get('BINANCE') || 0;
      const oiCoins = parseFloat(data.openInterest);
      const oiUsd = oiCoins * price;
      if (oiUsd > 0) {
        this.recordSnapshot('BINANCE_FUTURES', oiUsd, price);
      }
    } catch { /* silent */ }
  }

  private async fetchBybit(): Promise<void> {
    try {
      const res = await fetch('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min&limit=1');
      if (!res.ok) return;
      const data = await res.json();
      const list = data?.result?.list;
      if (Array.isArray(list) && list.length > 0) {
        const oiUsd = parseFloat(list[0].openInterest);
        const price = this.latestPrice.get('BYBIT') || 0;
        if (oiUsd > 0) {
          this.recordSnapshot('BYBIT', oiUsd, price || oiUsd / (parseFloat(list[0].openInterest) || 1));
        }
      }
    } catch { /* silent */ }
  }

  private async fetchOkx(): Promise<void> {
    try {
      const res = await fetch('https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC');
      if (!res.ok) return;
      const data = await res.json();
      const list = data?.data;
      if (Array.isArray(list) && list.length > 0) {
        // [timestamp, oi, vol]
        const latest = list[list.length - 1];
        const oiUsd = parseFloat(latest[1]);
        const price = this.latestPrice.get('OKX') || 0;
        if (oiUsd > 0) {
          this.recordSnapshot('OKX', oiUsd, price);
        }
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
      // data: [meta, assetCtxs[]] — BTC is usually index 0
      const assetCtxs = data?.[1];
      if (Array.isArray(assetCtxs)) {
        const btc = assetCtxs.find((a: any) => a.coin === 'BTC') || assetCtxs[0];
        if (btc) {
          const oiUsd = parseFloat(btc.openInterest || '0') * parseFloat(btc.markPx || '0');
          const price = parseFloat(btc.markPx || '0');
          if (oiUsd > 0) {
            this.recordSnapshot('HYPERLIQUID', oiUsd, price);
          }
        }
      }
    } catch { /* silent */ }
  }

  private recordSnapshot(exchange: string, oi: number, price: number): void {
    if (!this.snapshots.has(exchange)) {
      this.snapshots.set(exchange, []);
    }
    const history = this.snapshots.get(exchange)!;
    history.push({ exchange, oi, price, timestamp: Date.now() });
    if (history.length > MAX_SNAPSHOTS) {
      history.splice(0, history.length - MAX_SNAPSHOTS);
    }
    this.latestOI.set(exchange, oi);
  }

  private checkAlerts(): void {
    if (!this.alertCallback) return;
    const windowMs = this.config.windowMinutes * 60 * 1000;

    for (const [exchange, history] of this.snapshots) {
      if (history.length < 2) continue;
      const current = history[history.length - 1];

      // Find comparison snapshot
      const cutoff = current.timestamp - windowMs;
      let comparison: OISnapshot | null = null;
      for (let i = history.length - 2; i >= 0; i--) {
        if (history[i].timestamp <= cutoff) {
          comparison = history[i];
          break;
        }
      }
      if (!comparison) comparison = history[0]; // use oldest if window is short

      const oiChange = current.oi - comparison.oi;
      const oiChangePct = comparison.oi > 0 ? (oiChange / comparison.oi) * 100 : 0;
      const priceChange = current.price - comparison.price;
      const pricePct = comparison.price > 0 ? (priceChange / comparison.price) * 100 : 0;

      if (Math.abs(oiChangePct) < this.config.alertThresholdPercent) continue;

      // Determine type and interpretation
      let type: OIAlert['type'];
      let interpretation: string;

      if (oiChangePct > 0 && pricePct > 0) {
        type = 'OI_SURGE';
        interpretation = 'Longs agressifs — tendance haussière saine';
      } else if (oiChangePct < 0 && pricePct > 0) {
        type = 'OI_FLUSH';
        interpretation = 'Short squeeze — shorts ferment, mouvement fragile';
      } else if (oiChangePct > 0 && pricePct < 0) {
        type = 'OI_SURGE';
        interpretation = 'Shorts agressifs — pression vendeuse, risque cascade';
      } else {
        type = 'OI_FLUSH';
        interpretation = 'Long squeeze / capitulation — longs liquidés';
      }

      this.alertCallback({
        type,
        exchange,
        symbol: 'BTC',
        oiChange,
        oiChangePercent: oiChangePct,
        priceChange,
        priceChangePercent: pricePct,
        interpretation,
        timestamp: Date.now(),
      });
    }
  }

  private checkDivergence(): void {
    if (!this.alertCallback) return;
    const exchanges = Array.from(this.snapshots.keys());
    if (exchanges.length < 2) return;

    // Compare recent OI changes across exchanges
    const changes: { exchange: string; changePct: number }[] = [];

    for (const ex of exchanges) {
      const history = this.snapshots.get(ex)!;
      if (history.length < 2) continue;
      const current = history[history.length - 1];
      const prev = history[Math.max(0, history.length - 6)]; // ~1min ago
      const changePct = prev.oi > 0 ? ((current.oi - prev.oi) / prev.oi) * 100 : 0;
      changes.push({ exchange: ex, changePct });
    }

    // Check if one is rising while another is falling significantly
    for (let i = 0; i < changes.length; i++) {
      for (let j = i + 1; j < changes.length; j++) {
        const a = changes[i];
        const b = changes[j];
        if ((a.changePct > 1 && b.changePct < -1) || (a.changePct < -1 && b.changePct > 1)) {
          this.alertCallback({
            type: 'OI_DIVERGENCE',
            exchange: `${a.exchange} vs ${b.exchange}`,
            symbol: 'BTC',
            oiChange: 0,
            oiChangePercent: Math.abs(a.changePct - b.changePct),
            priceChange: 0,
            priceChangePercent: 0,
            interpretation: `OI divergence: ${a.exchange} ${a.changePct > 0 ? '↑' : '↓'}${Math.abs(a.changePct).toFixed(1)}% vs ${b.exchange} ${b.changePct > 0 ? '↑' : '↓'}${Math.abs(b.changePct).toFixed(1)}%`,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  /** Get latest OI per exchange */
  getLatestOI(): Map<string, number> {
    return new Map(this.latestOI);
  }

  /** Get aggregated OI and change */
  getAggregateOI(): { total: number; change: number; changePct: number } {
    let total = 0;
    let prevTotal = 0;

    for (const [, history] of this.snapshots) {
      if (history.length > 0) total += history[history.length - 1].oi;
      if (history.length > 5) prevTotal += history[history.length - 6].oi;
      else if (history.length > 0) prevTotal += history[0].oi;
    }

    const change = total - prevTotal;
    const changePct = prevTotal > 0 ? (change / prevTotal) * 100 : 0;
    return { total, change, changePct };
  }
}
