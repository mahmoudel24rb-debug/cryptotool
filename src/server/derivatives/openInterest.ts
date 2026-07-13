import { LongShortData, OIAlert, OIConfig } from './types';

interface OISnapshot {
  exchange: string;
  oi: number;       // USD
  price: number;
  timestamp: number;
}

const MAX_SNAPSHOTS = 200;

// Le buffer mémoire ne retient que ~30 min (200 snaps × 10 s). Le Δ 24h et le
// long/short ratio bougent lentement : on les rafraîchit via les endpoints
// historiques REST à une cadence bien plus lente.
const HISTORY_POLL_MS = 5 * 60 * 1000; // 5 min
// Garde-fou anti-valeur aberrante : on n'accepte une OI « il y a 24h » que si
// elle reste dans une fourchette plausible de l'OI actuelle (évite qu'une
// réponse malformée ou une mauvaise unité corrompe le delta).
const SANE_LO = 0.2;
const SANE_HI = 5;

/**
 * Open Interest Tracker.
 * Polls OI from exchange REST APIs and detects surges/flushes/divergences.
 */
export class OpenInterestTracker {
  private config: OIConfig;
  private snapshots = new Map<string, OISnapshot[]>(); // exchange -> history
  private latestOI = new Map<string, number>();
  private latestPrice = new Map<string, number>();
  private oi24hAgo = new Map<string, number>();        // exchange -> OI (USD) ~24h ago
  private longShort: LongShortData[] = [];             // positionnement des comptes
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private historyTimer: ReturnType<typeof setInterval> | null = null;
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

  /** Get best available price (fallback across exchanges) */
  private getPrice(exchange: string): number {
    const direct = this.latestPrice.get(exchange);
    if (direct && direct > 0) return direct;
    // Fallback: use any available price (all are BTC, close enough)
    for (const [, p] of this.latestPrice) {
      if (p > 0) return p;
    }
    return 0;
  }

  /** Start polling all exchanges */
  start(): void {
    this.poll(); // immediate first poll
    this.pollTimer = setInterval(() => this.poll(), this.config.pollIntervalMs);

    this.pollHistory(); // 24h OI baseline + long/short, immédiat puis lent
    this.historyTimer = setInterval(() => this.pollHistory(), HISTORY_POLL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.historyTimer) clearInterval(this.historyTimer);
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
      const price = this.getPrice('BINANCE_FUTURES');
      const oiCoins = parseFloat(data.openInterest);
      const oiUsd = oiCoins * price;
      if (oiUsd > 0) {
        this.recordSnapshot('BINANCE_FUTURES', oiUsd, price);
      }
    } catch (err) {
      console.warn('[OI] Binance fetch failed:', (err as Error).message);
    }
  }

  private async fetchBybit(): Promise<void> {
    try {
      const res = await fetch('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min&limit=1');
      if (!res.ok) return;
      const data = await res.json();
      const list = data?.result?.list;
      if (Array.isArray(list) && list.length > 0) {
        // Bybit returns OI in coins (BTC), must multiply by price
        const oiCoins = parseFloat(list[0].openInterest);
        const price = this.getPrice('BYBIT');
        const oiUsd = oiCoins * price;
        if (oiUsd > 0) {
          this.recordSnapshot('BYBIT', oiUsd, price);
        }
      }
    } catch (err) {
      console.warn('[OI] Bybit fetch failed:', (err as Error).message);
    }
  }

  private async fetchOkx(): Promise<void> {
    try {
      // Real-time OI endpoint (not the historical stats one)
      const res = await fetch('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP');
      if (!res.ok) return;
      const data = await res.json();
      const list = data?.data;
      if (Array.isArray(list) && list.length > 0) {
        // { instId, oi (contracts!), oiCcy (coins in BTC), ts }
        // Must use oiCcy (BTC amount), NOT oi (contract count)
        const entry = list[0];
        const oiCoins = parseFloat(entry.oiCcy || '0');
        const price = this.getPrice('OKX');
        const oiUsd = oiCoins * price;
        if (oiUsd > 0) {
          this.recordSnapshot('OKX', oiUsd, price);
        }
      }
    } catch (err) {
      console.warn('[OI] OKX fetch failed:', (err as Error).message);
    }
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
    } catch (err) {
      console.warn('[OI] Hyperliquid fetch failed:', (err as Error).message);
    }
  }

  // ── 24h OI baseline + long/short ratio (cadence lente) ──

  private async pollHistory(): Promise<void> {
    // OKX est volontairement exclu de la baseline 24h : son OI temps réel ne
    // couvre que BTC-USDT-SWAP, alors que l'historique rubik agrège TOUS les
    // contrats BTC (USDT/USDC/coin-margined). Comparer les deux fabriquerait un
    // faux delta. Binance et Bybit comparent bien contrat identique à contrat
    // identique. OKX reste présent pour l'OI affiché et le long/short.
    await Promise.allSettled([
      this.fetchBinanceOI24h(),
      this.fetchBybitOI24h(),
      this.fetchBinanceLongShort('globalLongShortAccountRatio', 'BINANCE_GLOBAL', 'Retail Binance'),
      this.fetchBinanceLongShort('topLongShortPositionRatio', 'BINANCE_TOP', 'Top traders'),
      this.fetchOkxLongShort(),
    ]).then(() => this.rebuildLongShort());
  }

  /** N'accepte une OI historique que si elle est plausible vs l'OI actuelle. */
  private setOi24hAgo(exchange: string, oi24h: number): void {
    if (!(oi24h > 0)) return;
    const now = this.latestOI.get(exchange);
    if (now && now > 0) {
      const ratio = oi24h / now;
      if (ratio < SANE_LO || ratio > SANE_HI) return; // aberrant → on ignore
    }
    this.oi24hAgo.set(exchange, oi24h);
  }

  private async fetchBinanceOI24h(): Promise<void> {
    try {
      // sumOpenInterestValue est déjà en USD → pas besoin de prix.
      const res = await fetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const oldest = data[0]; // ~24h en arrière (série croissante dans le temps)
        this.setOi24hAgo('BINANCE_FUTURES', parseFloat(oldest.sumOpenInterestValue || '0'));
      }
    } catch (err) {
      console.warn('[OI] Binance 24h hist failed:', (err as Error).message);
    }
  }

  private async fetchBybitOI24h(): Promise<void> {
    try {
      const res = await fetch('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=25');
      if (!res.ok) return;
      const data = await res.json();
      const list = data?.result?.list;
      if (Array.isArray(list) && list.length > 0) {
        // Bybit renvoie du plus récent au plus ancien → dernier = ~24h ago, en BTC.
        const oldest = list[list.length - 1];
        const oiCoins = parseFloat(oldest.openInterest || '0');
        const price = this.getPrice('BYBIT');
        if (price > 0) this.setOi24hAgo('BYBIT', oiCoins * price);
      }
    } catch (err) {
      console.warn('[OI] Bybit 24h hist failed:', (err as Error).message);
    }
  }

  private lsRaw = new Map<string, { long: number; short: number; ratio: number; label: string }>();

  private async fetchBinanceLongShort(endpoint: string, source: string, label: string): Promise<void> {
    try {
      const res = await fetch(`https://fapi.binance.com/futures/data/${endpoint}?symbol=BTCUSDT&period=5m&limit=1`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const r = data[data.length - 1];
        const long = parseFloat(r.longAccount ?? r.longPosition ?? '0');
        const short = parseFloat(r.shortAccount ?? r.shortPosition ?? '0');
        const ratio = parseFloat(r.longShortRatio ?? '0');
        if (ratio > 0) this.lsRaw.set(source, { long, short, ratio, label });
      }
    } catch (err) {
      console.warn(`[OI] Binance ${source} L/S failed:`, (err as Error).message);
    }
  }

  private async fetchOkxLongShort(): Promise<void> {
    try {
      const res = await fetch('https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=5m');
      if (!res.ok) return;
      const data = await res.json();
      const rows = data?.data;
      if (Array.isArray(rows) && rows.length > 0) {
        // [ts, ratio], du plus récent au plus ancien → premier = le plus frais.
        const ratio = parseFloat(rows[0]?.[1] || '0');
        if (ratio > 0) {
          const long = ratio / (1 + ratio);
          this.lsRaw.set('OKX', { long, short: 1 - long, ratio, label: 'Comptes OKX' });
        }
      }
    } catch (err) {
      console.warn('[OI] OKX L/S failed:', (err as Error).message);
    }
  }

  private rebuildLongShort(): void {
    const order = ['BINANCE_GLOBAL', 'BINANCE_TOP', 'OKX'];
    const out: LongShortData[] = [];
    for (const src of order) {
      const raw = this.lsRaw.get(src);
      if (!raw) continue;
      // long/short sont soit des fractions (0..1), soit déjà des %. On normalise.
      const total = raw.long + raw.short;
      const longPct = total > 0 ? (raw.long / total) * 100 : (raw.ratio / (1 + raw.ratio)) * 100;
      out.push({
        source: src,
        label: raw.label,
        ratio: raw.ratio,
        longPct,
        shortPct: 100 - longPct,
        timestamp: Date.now(),
      });
    }
    this.longShort = out;
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

      // Guard: skip if comparison is too recent (< 50% of window)
      const timeDiff = current.timestamp - comparison.timestamp;
      if (timeDiff < windowMs * 0.5) continue;

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
        interpretation = 'Aggressive longs — healthy bullish trend';
      } else if (oiChangePct < 0 && pricePct > 0) {
        type = 'OI_FLUSH';
        interpretation = 'Short squeeze — shorts closing, fragile move';
      } else if (oiChangePct > 0 && pricePct < 0) {
        type = 'OI_SURGE';
        interpretation = 'Aggressive shorts — selling pressure, cascade risk';
      } else {
        type = 'OI_FLUSH';
        interpretation = 'Long squeeze / capitulation — longs liquidated';
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

  /**
   * Δ OI sur 24h glissantes. Le % agrégé est pondéré par l'OI actuel des
   * exchanges qui disposent d'une baseline (et non un ratio de deux sommes sur
   * des ensembles d'exchanges différents, qui serait biaisé). Fournit aussi le
   * delta par exchange pour les badges du panneau.
   */
  getOI24hDelta(): {
    deltaUsd: number;
    deltaPct: number | null;
    coverage: string[];
    perExchangePct: Map<string, number>;
  } {
    let deltaUsd = 0;
    let weightedPctNum = 0; // Σ(oiNow · pct)
    let weightSum = 0;      // Σ(oiNow)
    const coverage: string[] = [];
    const perExchangePct = new Map<string, number>();

    for (const [ex, then] of this.oi24hAgo) {
      const now = this.latestOI.get(ex);
      if (!now || now <= 0 || then <= 0) continue;
      const pct = ((now - then) / then) * 100;
      perExchangePct.set(ex, pct);
      deltaUsd += now - then;
      weightedPctNum += now * pct;
      weightSum += now;
      coverage.push(ex);
    }

    return {
      deltaUsd,
      deltaPct: weightSum > 0 ? weightedPctNum / weightSum : null,
      coverage,
      perExchangePct,
    };
  }

  /** Ratios long/short des comptes (retail, top traders, OKX). */
  getLongShort(): LongShortData[] {
    return this.longShort.map(l => ({ ...l }));
  }

  /** Moyenne des ratios long/short disponibles (0 si aucun). */
  getAvgLongShortRatio(): number {
    if (this.longShort.length === 0) return 0;
    return this.longShort.reduce((s, l) => s + l.ratio, 0) / this.longShort.length;
  }
}
