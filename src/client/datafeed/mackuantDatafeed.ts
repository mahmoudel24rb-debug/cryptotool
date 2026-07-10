/**
 * Custom TradingView Datafeed bridging our WebSocket candle data
 * to the TradingView Charting Library's IBasicDataFeed interface.
 */

// Resolution string → seconds mapping
const RESOLUTION_MAP: Record<string, number> = {
  '1': 60,
  '5': 300,
  '15': 900,
  '60': 3600,
  '240': 14400,
};

interface Candle {
  time: number;  // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Aggregate 1m candles into higher timeframes
function aggregateCandles(candles: Candle[], tfSeconds: number): Candle[] {
  if (tfSeconds <= 60 || candles.length === 0) return candles;
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const bucketTime = Math.floor(c.time / tfSeconds) * tfSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime, open: c.open, high: c.high,
        low: c.low, close: c.close, volume: c.volume,
      });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

interface Subscriber {
  resolution: string;
  onTick: (bar: any) => void;
  onResetCache: () => void;
  symbolName: string;
}

export interface CandleDataStore {
  candlesByExchange: Record<string, Candle[]>;
  htfCandles: Record<string, Record<string, Candle[]>>;
}

// Cache entry for pre-computed bars
interface BarCache {
  bars: Candle[];
  cacheKey: string;  // composite key: "length:firstTime:lastTime"
}

export class MackuantDatafeed {
  private store: CandleDataStore;
  private subscribers = new Map<string, Subscriber>();
  private lastBarBySubscriber = new Map<string, any>();
  private initialDataLoaded = false;
  private lastBarCountBySymbol = new Map<string, number>();

  // Cache: "symbol:resolution" → pre-computed sorted bar array
  private barCache = new Map<string, BarCache>();

  constructor(store: CandleDataStore) {
    this.store = store;
  }

  /** Update the data store reference (called from React) */
  updateStore(store: CandleDataStore) {
    this.store = store;
  }

  /** Reset state when switching symbol — clears cache and forces TradingView to re-fetch */
  resetForSymbolSwitch() {
    this.barCache.clear();
    this.lastBarBySubscriber.clear();
    this.lastBarCountBySymbol.clear();
    this.initialDataLoaded = false;
  }

  /** Called externally on each candle update to push real-time updates */
  onRealtimeUpdate() {
    // CHART-FIX-2+3: Detect full history arrival PER SUBSCRIBER, no early return
    const resetGuids = new Set<string>();
    for (const [guid, sub] of this.subscribers) {
      const currentCount = this.store.candlesByExchange[sub.symbolName]?.length || 0;
      const lastCount = this.lastBarCountBySymbol.get(sub.symbolName) || 0;

      if (!this.initialDataLoaded && lastCount < 100 && currentCount >= 100) {
        this.initialDataLoaded = true;
        this.barCache.clear();
        sub.onResetCache();
        resetGuids.add(guid);
      }

      // Store replaced with shorter history (reconnect after server restart):
      // reset instead of streaming bars that go back in time
      if (currentCount > 0 && currentCount < lastCount - 10) {
        this.barCache.clear();
        this.lastBarBySubscriber.delete(guid);
        sub.onResetCache();
        resetGuids.add(guid);
      }

      this.lastBarCountBySymbol.set(sub.symbolName, currentCount);
    }

    // Real-time tick updates — detect gaps and send missing bars
    for (const [guid, sub] of this.subscribers) {
      if (resetGuids.has(guid)) continue; // skip subscribers that just got reset
      const bars = this.getBarsForSymbol(sub.symbolName, sub.resolution);
      if (bars.length === 0) continue;

      const prevBar = this.lastBarBySubscriber.get(guid);
      const lastBar = bars[bars.length - 1];

      // Detect gap: if last sent bar is >=1 period behind, we missed candles
      if (prevBar) {
        const tfMs = (RESOLUTION_MAP[sub.resolution] || 60) * 1000;
        const timeDiff = lastBar.time * 1000 - prevBar.time;
        if (timeDiff >= tfMs * 2) {
          // Gap detected — binary search for the first bar after prevBar
          const targetTime = prevBar.time / 1000; // convert to seconds
          let lo = 0, hi = bars.length - 1, startIdx = bars.length;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (bars[mid].time > targetTime) {
              startIdx = mid;
              hi = mid - 1;
            } else {
              lo = mid + 1;
            }
          }
          if (startIdx < bars.length) {
            for (let i = startIdx; i < bars.length; i++) {
              const b = bars[i];
              sub.onTick({
                time: b.time * 1000,
                open: b.open, high: b.high,
                low: b.low, close: b.close,
                volume: b.volume,
              });
            }
            this.lastBarBySubscriber.set(guid, {
              time: lastBar.time * 1000,
              open: lastBar.open, high: lastBar.high,
              low: lastBar.low, close: lastBar.close,
              volume: lastBar.volume,
            });
            continue;
          }
        }
      }

      // Normal update: send last bar
      const tvBar = {
        time: lastBar.time * 1000,
        open: lastBar.open,
        high: lastBar.high,
        low: lastBar.low,
        close: lastBar.close,
        volume: lastBar.volume,
      };

      // TradingView hard rule: a tick older than the last sent bar throws a
      // time-order violation and freezes the chart. If data went back in time
      // (stall, reconnect, store swap), reset the series instead of ticking.
      if (prevBar && tvBar.time < prevBar.time) {
        this.lastBarBySubscriber.delete(guid);
        sub.onResetCache();
        continue;
      }

      if (!prevBar || prevBar.time !== tvBar.time ||
          prevBar.close !== tvBar.close || prevBar.high !== tvBar.high ||
          prevBar.low !== tvBar.low || prevBar.volume !== tvBar.volume) {
        this.lastBarBySubscriber.set(guid, { ...tvBar });
        sub.onTick(tvBar);
      }
    }
  }

  /** Get the primary exchange key (first available, prefer Binance Futures) */
  getPrimaryKey(): string | null {
    const keys = Object.keys(this.store.candlesByExchange);
    const preferred = keys.find(k => k.includes('BINANCE_FUTURES'));
    return preferred || keys[0] || null;
  }

  /** Get all exchange keys for symbol listing */
  getExchangeKeys(): string[] {
    return Object.keys(this.store.candlesByExchange);
  }

  private getBarsForSymbol(symbolName: string, resolution: string): Candle[] {
    const tfSec = RESOLUTION_MAP[resolution] || 60;
    const rawCandles = this.store.candlesByExchange[symbolName];
    if (!rawCandles || rawCandles.length === 0) return [];

    const mapKey = `${symbolName}:${resolution}`;
    const cached = this.barCache.get(mapKey);
    const lastCandle = rawCandles[rawCandles.length - 1];
    const firstCandle = rawCandles[0];

    // CHART-FIX-4: Extended key includes price data to invalidate on any change
    const compositeKey = `${rawCandles.length}:${firstCandle?.time ?? 0}:${lastCandle.time}:${lastCandle.close}:${lastCandle.high}:${lastCandle.low}`;

    if (cached && cached.cacheKey === compositeKey) {
      return cached.bars;
    }

    // Recompute
    let bars: Candle[];
    const tfLabel = tfSec === 3600 ? '1h' : tfSec === 14400 ? '4h' : null;
    if (tfLabel && this.store.htfCandles[tfLabel]?.[symbolName]?.length > 0) {
      const historicalHTF = this.store.htfCandles[tfLabel][symbolName];
      const recentAgg = aggregateCandles(rawCandles, tfSec);
      const merged = new Map<number, Candle>();
      for (const c of historicalHTF) merged.set(c.time, c);
      for (const c of recentAgg) merged.set(c.time, c);
      bars = Array.from(merged.values()).sort((a, b) => a.time - b.time);
    } else {
      bars = aggregateCandles(rawCandles, tfSec);
    }

    this.barCache.set(mapKey, { bars, cacheKey: compositeKey });
    return bars;
  }

  // ── IBasicDataFeed implementation ──

  onReady(callback: (config: any) => void) {
    setTimeout(() => {
      callback({
        supported_resolutions: ['1', '5', '15', '60', '240'],
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
      });
    }, 0);
  }

  searchSymbols(
    userInput: string,
    _exchange: string,
    _symbolType: string,
    onResult: (items: any[]) => void
  ) {
    const keys = this.getExchangeKeys();
    const results = keys
      .filter(k => k.toLowerCase().includes(userInput.toLowerCase()))
      .map(k => ({
        symbol: k,
        full_name: k,
        description: `BTC ${k}`,
        exchange: k.split(':')[0],
        ticker: k,
        type: 'crypto',
      }));
    onResult(results);
  }

  resolveSymbol(
    symbolName: string,
    onResolve: (info: any) => void,
    onError: (reason: string) => void,
  ) {
    setTimeout(() => {
      const keys = this.getExchangeKeys();
      const matchedKey = keys.find(k => k === symbolName) || this.getPrimaryKey();
      if (!matchedKey) {
        onError('No data available');
        return;
      }
      onResolve({
        name: matchedKey,
        ticker: matchedKey,
        description: `BTC ${matchedKey}`,
        type: 'crypto',
        session: '24x7',
        timezone: 'Etc/UTC',
        exchange: matchedKey.split(':')[0],
        minmov: 1,
        pricescale: 100,
        has_intraday: true,
        has_weekly_and_monthly: false,
        supported_resolutions: ['1', '5', '15', '60', '240'],
        volume_precision: 2,
        data_status: 'streaming',
      });
    }, 0);
  }

  getBars(
    symbolInfo: any,
    resolution: string,
    periodParams: any,
    onResult: (bars: any[], meta: any) => void,
    onError: (reason: string) => void,
  ) {
    try {
      const symbolName = symbolInfo.ticker || symbolInfo.name;
      const allBars = this.getBarsForSymbol(symbolName, resolution);

      const from = periodParams.from;
      const to = periodParams.to;

      // Use binary search for fast range filtering on sorted array
      let startIdx = 0;
      let endIdx = allBars.length;

      // Find start index (first bar >= from)
      let lo = 0, hi = allBars.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (allBars[mid].time < from) lo = mid + 1;
        else hi = mid;
      }
      startIdx = lo;

      // Find end index (first bar >= to)
      lo = startIdx;
      hi = allBars.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (allBars[mid].time < to) lo = mid + 1;
        else hi = mid;
      }
      endIdx = lo;

      // Slice and convert to TV format
      const countBack = periodParams.countBack;
      if (countBack && (endIdx - startIdx) > countBack) {
        startIdx = endIdx - countBack;
      }

      const result: any[] = [];
      for (let i = startIdx; i < endIdx; i++) {
        const b = allBars[i];
        result.push({
          time: b.time * 1000,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        });
      }

      onResult(result, { noData: result.length === 0 });
    } catch (err) {
      onError(String(err));
    }
  }

  subscribeBars(
    symbolInfo: any,
    resolution: string,
    onTick: (bar: any) => void,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void,
  ) {
    this.subscribers.set(listenerGuid, {
      resolution,
      onTick,
      onResetCache: onResetCacheNeededCallback,
      symbolName: symbolInfo.ticker || symbolInfo.name,
    });
  }

  unsubscribeBars(listenerGuid: string) {
    this.subscribers.delete(listenerGuid);
    this.lastBarBySubscriber.delete(listenerGuid);
  }

  getServerTime(callback: (time: number) => void) {
    callback(Math.floor(Date.now() / 1000));
  }
}
