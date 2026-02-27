import React, { useEffect, useRef, useMemo, useState } from 'react';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface VWAPOverlay {
  vwap: number;
  upperBand1: number;
  lowerBand1: number;
  upperBand2: number;
  lowerBand2: number;
}

interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  timestamp: number;
  broken: boolean;
}

interface StructureBreak {
  type: 'BOS' | 'CHoCH';
  direction: 'BULLISH' | 'BEARISH';
  price: number;
  breakPrice: number;
  timestamp: number;
}

interface OrderBlock {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  midpoint: number;
  timestamp: number;
  mitigated: boolean;
  tested: boolean;
  strength: number;
  hasFVG: boolean;
}

interface FairValueGap {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  timestamp: number;
  filled: boolean;
  filledPercent: number;
}

interface LiquidityPool {
  id: string;
  type: 'BUYSIDE' | 'SELLSIDE';
  level: number;
  strength: number;
  swept: boolean;
}

interface StructureState {
  trend: string;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  recentBreaks: StructureBreak[];
  orderBlocks?: OrderBlock[];
  fvgs?: FairValueGap[];
  liquidityPools?: LiquidityPool[];
}

interface ChartProps {
  candlesByExchange: Record<string, Candle[]>;
  htfCandles?: Record<string, Record<string, Candle[]>>;
  title?: string;
  vwapData?: VWAPOverlay | null;
  structureData?: Record<string, StructureState>;
}

const EXCHANGE_COLORS: Record<string, string> = {
  'BINANCE_FUTURES:PERP': '#3b82f6',
  'HYPERLIQUID:PERP': '#22c55e',
  'BYBIT:PERP': '#a855f7',
  'BINANCE:SPOT': '#eab308',
  'COINBASE:SPOT': '#06b6d4',
  'OKX:SPOT': '#f97316',
  'OKX:PERP': '#ef4444',
};

const EXCHANGE_LABELS: Record<string, string> = {
  'BINANCE_FUTURES:PERP': 'BINANCE_P',
  'HYPERLIQUID:PERP': 'HYPERLIQUID',
  'BYBIT:PERP': 'BYBIT',
  'BINANCE:SPOT': 'BINANCE',
  'COINBASE:SPOT': 'COINBASE',
  'OKX:SPOT': 'OKX',
  'OKX:PERP': 'OKX_P',
};

const PRIMARY_KEYS = [
  'BINANCE_FUTURES:PERP',
  'BINANCE:SPOT',
  'BYBIT:PERP',
  'COINBASE:SPOT',
  'OKX:PERP',
  'HYPERLIQUID:PERP',
];

// Layout
const PADDING_RIGHT = 80;
const PADDING_BOTTOM = 26;
const PADDING_LEFT = 10;
const PADDING_TOP = 28;
const VOLUME_HEIGHT_RATIO = 0.15;
const BG_COLOR = '#131722';
const GRID_COLOR = 'rgba(42, 46, 57, 0.5)';
const TEXT_COLOR = '#787b86';
const CROSSHAIR_COLOR = 'rgba(152, 157, 169, 0.25)';
const UP_COLOR = '#26a69a';
const DOWN_COLOR = '#ef5350';
const UP_COLOR_ALPHA = 'rgba(38, 166, 154, 0.35)';
const DOWN_COLOR_ALPHA = 'rgba(239, 83, 80, 0.35)';
const FONT = '"JetBrains Mono", monospace';

// ── Multi-Timeframe Support ──
const TIMEFRAME_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
};

const TIMEFRAME_OPTIONS = ['1m', '5m', '15m', '1h', '4h'];

function aggregateCandles(candles: Candle[], tfSeconds: number): Candle[] {
  if (tfSeconds <= 60 || candles.length === 0) return candles;

  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const bucketTime = Math.floor(c.time / tfSeconds) * tfSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
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

export default function Chart({ candlesByExchange, htfCandles, title, vwapData, structureData }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);
  const dataRef = useRef(candlesByExchange);
  const htfRef = useRef<Record<string, Record<string, Candle[]>>>({});
  const primaryKeyRef = useRef<string | null>(null);
  const vwapRef = useRef<VWAPOverlay | null>(null);
  const structureRef = useRef<Record<string, StructureState>>({});
  const [activeTimeframe, setActiveTimeframe] = useState('1m');
  const timeframeRef = useRef('1m');

  // Cache for aggregateCandles — avoid recomputing every frame
  const aggCacheRef = useRef<{ key: string; result: Candle[] }>({ key: '', result: [] });
  // Cache for overlay aggregations
  const overlayAggCacheRef = useRef<Map<string, { key: string; result: Candle[] }>>(new Map());

  // Scroll state: number of candles scrolled back from the right edge
  // 0 = latest candles visible (auto-scroll mode)
  const scrollOffsetRef = useRef(0);
  const autoScrollRef = useRef(true);

  // Drag state
  const dragRef = useRef<{ active: boolean; startX: number; startOffset: number }>({
    active: false, startX: 0, startOffset: 0,
  });

  const primaryKey = useMemo(() => {
    for (const k of PRIMARY_KEYS) {
      if (candlesByExchange[k]?.length > 0) return k;
    }
    for (const k of Object.keys(candlesByExchange)) {
      if (candlesByExchange[k]?.length > 0) return k;
    }
    return null;
  }, [candlesByExchange]);

  dataRef.current = candlesByExchange;
  htfRef.current = htfCandles || {};
  primaryKeyRef.current = primaryKey;
  vwapRef.current = vwapData || null;
  structureRef.current = structureData || {};
  timeframeRef.current = activeTimeframe;

  // Single rAF draw loop — mounted once
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Computed each frame based on chart width
    let candleSpacing = 10;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;

      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, w, h);

      const cbe = dataRef.current;
      const pk = primaryKeyRef.current;

      const chartW = w - PADDING_LEFT - PADDING_RIGHT;
      const totalChartH = h - PADDING_TOP - PADDING_BOTTOM;
      const volumeH = Math.round(totalChartH * VOLUME_HEIGHT_RATIO);
      const priceChartH = totalChartH - volumeH;
      if (chartW <= 0 || priceChartH <= 0) return;

      // Apply timeframe aggregation (with caching to avoid recomputing every frame)
      const tfLabel = timeframeRef.current;
      const tfSec = TIMEFRAME_SECONDS[tfLabel] || 60;
      const rawCandles = pk ? (cbe[pk] || []) : [];

      // For 1h/4h: use backend HTF candles if available, merge with recent aggregated 1m
      let allCandles: Candle[];
      const htf = htfRef.current;
      if ((tfLabel === '1h' || tfLabel === '4h') && pk && htf[tfLabel]?.[pk]?.length > 0) {
        const historicalHTF = htf[tfLabel][pk];
        // Aggregate recent 1m candles for the latest period
        const recentAgg = aggregateCandles(rawCandles, tfSec);
        // Merge: historical + recent (deduplicate by time, recent wins)
        const merged = new Map<number, Candle>();
        for (const c of historicalHTF) merged.set(c.time, c);
        for (const c of recentAgg) merged.set(c.time, c); // recent overwrites
        allCandles = Array.from(merged.values()).sort((a, b) => a.time - b.time);
      } else {
        // Cache aggregation for 1m/5m/15m
        const cacheKey = `${rawCandles.length}-${rawCandles[rawCandles.length - 1]?.time}-${tfSec}`;
        if (cacheKey === aggCacheRef.current.key) {
          allCandles = aggCacheRef.current.result;
        } else {
          allCandles = aggregateCandles(rawCandles, tfSec);
          aggCacheRef.current = { key: cacheKey, result: allCandles };
        }
      }
      if (allCandles.length === 0) {
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for candle data...', w / 2, h / 2);
        return;
      }

      candleSpacing = Math.max(6, Math.min(14, Math.floor(chartW / 80)));
      const candleWidth = Math.max(3, candleSpacing - 2);
      const maxVisible = Math.max(10, Math.floor(chartW / candleSpacing));

      // Auto-scroll: keep offset at 0 when new candles arrive
      if (autoScrollRef.current) {
        scrollOffsetRef.current = 0;
      }

      // Clamp scroll offset
      const maxOffset = Math.max(0, allCandles.length - maxVisible);
      scrollOffsetRef.current = Math.max(0, Math.min(scrollOffsetRef.current, maxOffset));

      // Slice the visible window
      const endIdx = allCandles.length - scrollOffsetRef.current;
      const startIdx = Math.max(0, endIdx - maxVisible);
      const visibleCandles = allCandles.slice(startIdx, endIdx);

      if (visibleCandles.length === 0) return;

      // Price range from visible candles
      let minPrice = Infinity;
      let maxPrice = -Infinity;
      let maxVolume = 0;
      for (const c of visibleCandles) {
        if (c.low < minPrice) minPrice = c.low;
        if (c.high > maxPrice) maxPrice = c.high;
        if (c.volume > maxVolume) maxVolume = c.volume;
      }

      // Build time→index map for O(1) overlay lookups (replaces O(n) findIndex)
      const timeToIdx = new Map<number, number>();
      for (let i = 0; i < visibleCandles.length; i++) {
        timeToIdx.set(visibleCandles[i].time, i);
      }

      // Include overlays in price range (with cached aggregation)
      const overlayCache = overlayAggCacheRef.current;
      for (const [key, exCandles] of Object.entries(cbe)) {
        if (key === pk || exCandles.length === 0) continue;
        // Cache overlay aggregation per exchange
        const exCacheKey = `${key}-${exCandles.length}-${exCandles[exCandles.length - 1]?.time}-${tfSec}`;
        let aggEx: Candle[];
        const cached = overlayCache.get(key);
        if (cached && cached.key === exCacheKey) {
          aggEx = cached.result;
        } else {
          aggEx = aggregateCandles(exCandles, tfSec);
          overlayCache.set(key, { key: exCacheKey, result: aggEx });
        }
        const visibleEx = sliceByTimeRange(aggEx, visibleCandles[0].time, visibleCandles[visibleCandles.length - 1].time);
        for (const c of visibleEx) {
          if (c.close < minPrice) minPrice = c.close;
          if (c.close > maxPrice) maxPrice = c.close;
        }
      }

      const priceRange = maxPrice - minPrice || 1;
      const margin = priceRange * 0.04;
      minPrice -= margin;
      maxPrice += margin;
      const totalPriceRange = maxPrice - minPrice;

      const priceToY = (price: number) =>
        PADDING_TOP + priceChartH * (1 - (price - minPrice) / totalPriceRange);

      const indexToX = (i: number) =>
        PADDING_LEFT + candleSpacing / 2 + i * candleSpacing;

      const volumeBaseY = PADDING_TOP + totalChartH;

      // ── Clip chart area ──
      ctx.save();
      ctx.beginPath();
      ctx.rect(PADDING_LEFT, 0, chartW, h);
      ctx.clip();

      // ── Horizontal grid + price labels ──
      ctx.font = `10px ${FONT}`;
      const targetHLines = Math.max(4, Math.floor(priceChartH / 60));
      const priceStep = niceStep(totalPriceRange, targetHLines);
      const firstPrice = Math.ceil(minPrice / priceStep) * priceStep;

      for (let p = firstPrice; p <= maxPrice; p += priceStep) {
        const y = Math.round(priceToY(p)) + 0.5;
        if (y < PADDING_TOP || y > PADDING_TOP + priceChartH) continue;

        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, y);
        ctx.lineTo(PADDING_LEFT + chartW, y);
        ctx.stroke();
      }

      // ── Vertical grid + time labels ──
      const timeStep = Math.max(1, Math.floor(visibleCandles.length / 8));
      for (let i = 0; i < visibleCandles.length; i += timeStep) {
        const x = Math.round(indexToX(i)) + 0.5;

        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, PADDING_TOP);
        ctx.lineTo(x, PADDING_TOP + totalChartH);
        ctx.stroke();

        const d = new Date(visibleCandles[i].time * 1000);
        // Show date for 4h+ timeframes, otherwise just time
        const label = tfSec >= 3600
          ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        ctx.fillStyle = TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.fillText(label, x, h - 6);
      }

      // ── Volume bars ──
      if (maxVolume > 0) {
        for (let i = 0; i < visibleCandles.length; i++) {
          const c = visibleCandles[i];
          const x = indexToX(i);
          const isUp = c.close >= c.open;
          const barH = Math.max(1, (c.volume / maxVolume) * volumeH);

          ctx.fillStyle = isUp ? UP_COLOR_ALPHA : DOWN_COLOR_ALPHA;
          ctx.fillRect(
            Math.round(x - candleWidth / 2),
            Math.round(volumeBaseY - barH),
            candleWidth,
            Math.round(barH)
          );
        }
      }

      // ── Overlay lines (other exchanges) — uses cached aggregation + Map lookup ──
      for (const [key, exCandles] of Object.entries(cbe)) {
        if (key === pk || exCandles.length === 0) continue;
        const color = EXCHANGE_COLORS[key] || '#888888';

        // Reuse cached aggregation from price range computation
        const cached = overlayCache.get(key);
        const aggEx = cached ? cached.result : aggregateCandles(exCandles, tfSec);
        const visibleEx = sliceByTimeRange(aggEx, visibleCandles[0].time, visibleCandles[visibleCandles.length - 1].time);

        if (visibleEx.length < 2) continue;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();

        let started = false;
        for (const ec of visibleEx) {
          const idx = timeToIdx.get(ec.time); // O(1) lookup instead of O(n) findIndex
          if (idx === undefined) continue;
          const x = indexToX(idx);
          const y = priceToY(ec.close);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ── Candlesticks ──
      for (let i = 0; i < visibleCandles.length; i++) {
        const c = visibleCandles[i];
        const x = indexToX(i);
        const isUp = c.close >= c.open;
        const color = isUp ? UP_COLOR : DOWN_COLOR;

        const yOpen = priceToY(c.open);
        const yClose = priceToY(c.close);
        const yHigh = priceToY(c.high);
        const yLow = priceToY(c.low);
        const cx = Math.round(x) + 0.5;

        // Wick
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, Math.round(yHigh));
        ctx.lineTo(cx, Math.round(yLow));
        ctx.stroke();

        // Body
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(Math.abs(yClose - yOpen), 1);
        ctx.fillStyle = color;
        ctx.fillRect(
          Math.round(x - candleWidth / 2),
          Math.round(bodyTop),
          candleWidth,
          Math.ceil(bodyH)
        );
      }

      // ── VWAP Overlay ──
      const vwap = vwapRef.current;
      if (vwap && vwap.vwap > 0) {
        const vwapY = priceToY(vwap.vwap);
        const ub1Y = priceToY(vwap.upperBand1);
        const lb1Y = priceToY(vwap.lowerBand1);
        const ub2Y = priceToY(vwap.upperBand2);
        const lb2Y = priceToY(vwap.lowerBand2);

        // +2σ / -2σ bands (very subtle fill)
        if (ub2Y >= PADDING_TOP && lb2Y <= PADDING_TOP + priceChartH) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
          ctx.fillRect(PADDING_LEFT, Math.max(PADDING_TOP, ub2Y), chartW, Math.min(lb2Y - ub2Y, priceChartH));
        }

        // +2σ dashed line
        ctx.strokeStyle = 'rgba(156, 163, 175, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, Math.round(ub2Y) + 0.5);
        ctx.lineTo(PADDING_LEFT + chartW, Math.round(ub2Y) + 0.5);
        ctx.stroke();
        // -2σ dashed line
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, Math.round(lb2Y) + 0.5);
        ctx.lineTo(PADDING_LEFT + chartW, Math.round(lb2Y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        // +1σ / -1σ lines (thin)
        ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, Math.round(ub1Y) + 0.5);
        ctx.lineTo(PADDING_LEFT + chartW, Math.round(ub1Y) + 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, Math.round(lb1Y) + 0.5);
        ctx.lineTo(PADDING_LEFT + chartW, Math.round(lb1Y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        // VWAP main line (white/gray, thick)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, Math.round(vwapY) + 0.5);
        ctx.lineTo(PADDING_LEFT + chartW, Math.round(vwapY) + 0.5);
        ctx.stroke();

        // VWAP label on the right axis
        ctx.font = `9px ${FONT}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.textAlign = 'left';
        ctx.fillText('VWAP', PADDING_LEFT + 4, vwapY - 4);
      }

      // ── Structure Overlay (swing highs/lows + BOS/CHoCH labels) ──
      const struct = structureRef.current;
      // Use 5m structure for display (good balance of signal quality vs responsiveness)
      const displayStruct = struct['5m'] || struct['1m'];
      if (displayStruct && visibleCandles.length > 0) {
        const firstTime = visibleCandles[0].time;
        const lastTime = visibleCandles[visibleCandles.length - 1].time;

        // Draw swing highs (horizontal dashed red lines)
        for (const sh of displayStruct.swingHighs || []) {
          if (sh.price < minPrice || sh.price > maxPrice) continue;
          const y = Math.round(priceToY(sh.price)) + 0.5;
          ctx.strokeStyle = sh.broken ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.4)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(PADDING_LEFT, y);
          ctx.lineTo(PADDING_LEFT + chartW, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Small label
          if (!sh.broken) {
            ctx.font = `8px ${FONT}`;
            ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
            ctx.textAlign = 'right';
            ctx.fillText('SH', PADDING_LEFT + chartW - 4, y - 3);
          }
        }

        // Draw swing lows (horizontal dashed green lines)
        for (const sl of displayStruct.swingLows || []) {
          if (sl.price < minPrice || sl.price > maxPrice) continue;
          const y = Math.round(priceToY(sl.price)) + 0.5;
          ctx.strokeStyle = sl.broken ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.4)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(PADDING_LEFT, y);
          ctx.lineTo(PADDING_LEFT + chartW, y);
          ctx.stroke();
          ctx.setLineDash([]);

          if (!sl.broken) {
            ctx.font = `8px ${FONT}`;
            ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
            ctx.textAlign = 'right';
            ctx.fillText('SL', PADDING_LEFT + chartW - 4, y + 10);
          }
        }

        // Draw BOS/CHoCH labels at their break points
        for (const brk of displayStruct.recentBreaks || []) {
          // Only show breaks within visible time range
          if (brk.timestamp < firstTime || brk.timestamp > lastTime) continue;
          const idx = visibleCandles.findIndex(vc => vc.time === brk.timestamp);
          if (idx === -1) continue;

          const x = indexToX(idx);
          const y = priceToY(brk.price);
          const isBullish = brk.direction === 'BULLISH';
          const isChoch = brk.type === 'CHoCH';

          // Background pill
          const label = `${brk.type}`;
          ctx.font = `bold 8px ${FONT}`;
          const labelW = ctx.measureText(label).width + 8;
          const pillY = isBullish ? y - 18 : y + 6;
          const bgColor = isChoch
            ? (isBullish ? 'rgba(34, 211, 238, 0.7)' : 'rgba(251, 146, 60, 0.7)')
            : (isBullish ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)');
          ctx.fillStyle = bgColor;
          roundRect(ctx, x - labelW / 2, pillY, labelW, 14, 3);
          ctx.fill();

          // Label text
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(label, x, pillY + 10);

          // Direction arrow
          const arrowY = isBullish ? pillY - 4 : pillY + 18;
          ctx.fillStyle = bgColor;
          ctx.font = `10px ${FONT}`;
          ctx.fillText(isBullish ? '\u25B2' : '\u25BC', x, arrowY);
        }

        // ── Phase B: Order Block zones ──
        for (const ob of displayStruct.orderBlocks || []) {
          if (ob.mitigated) continue;
          const yTop = priceToY(ob.high);
          const yBot = priceToY(ob.low);
          if (yTop > PADDING_TOP + priceChartH || yBot < PADDING_TOP) continue;

          const clampTop = Math.max(PADDING_TOP, yTop);
          const clampBot = Math.min(PADDING_TOP + priceChartH, yBot);
          const zoneH = clampBot - clampTop;
          if (zoneH < 1) continue;

          // Fill zone
          const alpha = ob.tested ? 0.08 : 0.15;
          ctx.fillStyle = ob.type === 'BULLISH'
            ? `rgba(34, 197, 94, ${alpha})`   // green
            : `rgba(239, 68, 68, ${alpha})`;   // red
          ctx.fillRect(PADDING_LEFT, clampTop, chartW, zoneH);

          // Border
          ctx.strokeStyle = ob.type === 'BULLISH'
            ? `rgba(34, 197, 94, ${ob.tested ? 0.2 : 0.4})`
            : `rgba(239, 68, 68, ${ob.tested ? 0.2 : 0.4})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.strokeRect(PADDING_LEFT, clampTop, chartW, zoneH);

          // Label
          ctx.font = `bold 8px ${FONT}`;
          const obLabel = `OB ${ob.strength}`;
          ctx.fillStyle = ob.type === 'BULLISH'
            ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)';
          ctx.textAlign = 'left';
          ctx.fillText(obLabel, PADDING_LEFT + 4, clampTop + 10);
        }

        // ── Phase B: FVG zones ──
        for (const fvg of displayStruct.fvgs || []) {
          if (fvg.filled) continue;
          const yTop = priceToY(fvg.high);
          const yBot = priceToY(fvg.low);
          if (yTop > PADDING_TOP + priceChartH || yBot < PADDING_TOP) continue;

          const clampTop = Math.max(PADDING_TOP, yTop);
          const clampBot = Math.min(PADDING_TOP + priceChartH, yBot);
          const zoneH = clampBot - clampTop;
          if (zoneH < 1) continue;

          // Fill — purple/blue tint for FVGs
          const alpha = fvg.filledPercent > 50 ? 0.06 : 0.12;
          ctx.fillStyle = fvg.type === 'BULLISH'
            ? `rgba(96, 165, 250, ${alpha})`   // blue
            : `rgba(192, 132, 252, ${alpha})`;  // purple
          ctx.fillRect(PADDING_LEFT, clampTop, chartW, zoneH);

          // Dashed border
          ctx.strokeStyle = fvg.type === 'BULLISH'
            ? 'rgba(96, 165, 250, 0.3)' : 'rgba(192, 132, 252, 0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.strokeRect(PADDING_LEFT, clampTop, chartW, zoneH);
          ctx.setLineDash([]);

          // Label
          ctx.font = `7px ${FONT}`;
          ctx.fillStyle = fvg.type === 'BULLISH'
            ? 'rgba(96, 165, 250, 0.6)' : 'rgba(192, 132, 252, 0.6)';
          ctx.textAlign = 'left';
          ctx.fillText('FVG', PADDING_LEFT + 4, clampTop + 9);
        }

        // ── Phase B: Liquidity pools ──
        for (const pool of displayStruct.liquidityPools || []) {
          if (pool.swept) continue;
          const y = priceToY(pool.level);
          if (y < PADDING_TOP || y > PADDING_TOP + priceChartH) continue;

          const roundedY = Math.round(y) + 0.5;
          ctx.strokeStyle = pool.type === 'BUYSIDE'
            ? 'rgba(251, 191, 36, 0.5)'   // amber for buyside (above)
            : 'rgba(56, 189, 248, 0.5)';   // sky for sellside (below)
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 3]);
          ctx.beginPath();
          ctx.moveTo(PADDING_LEFT, roundedY);
          ctx.lineTo(PADDING_LEFT + chartW, roundedY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Label with strength
          ctx.font = `7px ${FONT}`;
          ctx.fillStyle = pool.type === 'BUYSIDE'
            ? 'rgba(251, 191, 36, 0.6)' : 'rgba(56, 189, 248, 0.6)';
          ctx.textAlign = 'left';
          const poolLabel = pool.type === 'BUYSIDE' ? `BSL x${pool.strength}` : `SSL x${pool.strength}`;
          ctx.fillText(poolLabel, PADDING_LEFT + 4, roundedY - 3);
        }
      }

      ctx.restore(); // end clip

      // ── Price labels on right axis (drawn outside clip) ──
      ctx.font = `10px ${FONT}`;
      for (let p = firstPrice; p <= maxPrice; p += priceStep) {
        const y = Math.round(priceToY(p)) + 0.5;
        if (y < PADDING_TOP || y > PADDING_TOP + priceChartH) continue;
        ctx.fillStyle = TEXT_COLOR;
        ctx.textAlign = 'left';
        ctx.fillText(formatPriceTv(p), PADDING_LEFT + chartW + 8, y + 4);
      }

      // ── Current price dashed line + label ──
      const lastVisibleCandle = visibleCandles[visibleCandles.length - 1];
      const lastY = priceToY(lastVisibleCandle.close);
      const lastIsUp = lastVisibleCandle.close >= lastVisibleCandle.open;
      const lastColor = lastIsUp ? UP_COLOR : DOWN_COLOR;

      ctx.strokeStyle = lastColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT, Math.round(lastY) + 0.5);
      ctx.lineTo(PADDING_LEFT + chartW, Math.round(lastY) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price tag
      const priceLabel = formatPriceTv(lastVisibleCandle.close);
      ctx.font = `11px ${FONT}`;
      const priceLabelW = ctx.measureText(priceLabel).width + 12;
      const tagX = PADDING_LEFT + chartW + 1;
      const tagY = Math.round(lastY) - 10;
      ctx.fillStyle = lastColor;
      roundRect(ctx, tagX, tagY, priceLabelW, 20, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(priceLabel, tagX + 6, tagY + 14);

      // ── VWAP price label on right axis ──
      if (vwap && vwap.vwap > 0) {
        const vwapY = priceToY(vwap.vwap);
        if (vwapY >= PADDING_TOP && vwapY <= PADDING_TOP + priceChartH) {
          const vLabel = formatPriceTv(vwap.vwap);
          ctx.font = `9px ${FONT}`;
          const vLblW = ctx.measureText(vLabel).width + 10;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          roundRect(ctx, PADDING_LEFT + chartW + 1, vwapY - 8, vLblW, 16, 2);
          ctx.fill();
          ctx.fillStyle = '#e5e7eb';
          ctx.textAlign = 'left';
          ctx.fillText(vLabel, PADDING_LEFT + chartW + 6, vwapY + 3);
        }
      }

      // ── OHLC info bar (top left) ──
      const mouse = mouseRef.current;
      let ohlcCandle = lastVisibleCandle;
      let hoveredIdx = -1;
      if (mouse && mouse.x >= PADDING_LEFT && mouse.x <= PADDING_LEFT + chartW) {
        hoveredIdx = Math.round((mouse.x - PADDING_LEFT - candleSpacing / 2) / candleSpacing);
        if (hoveredIdx >= 0 && hoveredIdx < visibleCandles.length) {
          ohlcCandle = visibleCandles[hoveredIdx];
        }
      }

      const change = ohlcCandle.close - ohlcCandle.open;
      const changePct = ohlcCandle.open !== 0 ? (change / ohlcCandle.open) * 100 : 0;
      const ohlcIsUp = change >= 0;
      const ohlcColor = ohlcIsUp ? UP_COLOR : DOWN_COLOR;

      ctx.font = `11px ${FONT}`;
      ctx.textAlign = 'left';
      let ox = PADDING_LEFT + 6;
      const oy = 18;

      ctx.fillStyle = TEXT_COLOR; ctx.fillText('O', ox, oy);
      ox += ctx.measureText('O').width + 3;
      ctx.fillStyle = ohlcColor; ctx.fillText(formatPriceTv(ohlcCandle.open), ox, oy);
      ox += ctx.measureText(formatPriceTv(ohlcCandle.open)).width + 10;

      ctx.fillStyle = TEXT_COLOR; ctx.fillText('H', ox, oy);
      ox += ctx.measureText('H').width + 3;
      ctx.fillStyle = ohlcColor; ctx.fillText(formatPriceTv(ohlcCandle.high), ox, oy);
      ox += ctx.measureText(formatPriceTv(ohlcCandle.high)).width + 10;

      ctx.fillStyle = TEXT_COLOR; ctx.fillText('L', ox, oy);
      ox += ctx.measureText('L').width + 3;
      ctx.fillStyle = ohlcColor; ctx.fillText(formatPriceTv(ohlcCandle.low), ox, oy);
      ox += ctx.measureText(formatPriceTv(ohlcCandle.low)).width + 10;

      ctx.fillStyle = TEXT_COLOR; ctx.fillText('C', ox, oy);
      ox += ctx.measureText('C').width + 3;
      ctx.fillStyle = ohlcColor; ctx.fillText(formatPriceTv(ohlcCandle.close), ox, oy);
      ox += ctx.measureText(formatPriceTv(ohlcCandle.close)).width + 10;

      const changeStr = `${ohlcIsUp ? '+' : ''}${change.toFixed(0)} (${ohlcIsUp ? '+' : ''}${changePct.toFixed(2)}%)`;
      ctx.fillStyle = ohlcColor;
      ctx.fillText(changeStr, ox, oy);

      // ── Crosshair ──
      if (mouse && mouse.x >= PADDING_LEFT && mouse.x <= PADDING_LEFT + chartW
          && mouse.y >= PADDING_TOP && mouse.y <= PADDING_TOP + totalChartH) {

        ctx.strokeStyle = CROSSHAIR_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        ctx.beginPath();
        ctx.moveTo(Math.round(mouse.x) + 0.5, PADDING_TOP);
        ctx.lineTo(Math.round(mouse.x) + 0.5, PADDING_TOP + totalChartH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, Math.round(mouse.y) + 0.5);
        ctx.lineTo(PADDING_LEFT + chartW, Math.round(mouse.y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        if (mouse.y >= PADDING_TOP && mouse.y <= PADDING_TOP + priceChartH) {
          const cursorPrice = minPrice + totalPriceRange * (1 - (mouse.y - PADDING_TOP) / priceChartH);
          const cpLabel = formatPriceTv(cursorPrice);
          ctx.font = `10px ${FONT}`;
          const cpW = ctx.measureText(cpLabel).width + 12;
          ctx.fillStyle = '#363a45';
          roundRect(ctx, PADDING_LEFT + chartW + 1, mouse.y - 10, cpW, 20, 3);
          ctx.fill();
          ctx.fillStyle = '#d1d4dc';
          ctx.textAlign = 'left';
          ctx.fillText(cpLabel, PADDING_LEFT + chartW + 7, mouse.y + 4);
        }

        if (hoveredIdx >= 0 && hoveredIdx < visibleCandles.length) {
          const d = new Date(visibleCandles[hoveredIdx].time * 1000);
          const tLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          ctx.font = `10px ${FONT}`;
          const tW = ctx.measureText(tLabel).width + 12;
          const tx = Math.round(indexToX(hoveredIdx));
          ctx.fillStyle = '#363a45';
          roundRect(ctx, tx - tW / 2, PADDING_TOP + totalChartH + 2, tW, 18, 3);
          ctx.fill();
          ctx.fillStyle = '#d1d4dc';
          ctx.textAlign = 'center';
          ctx.fillText(tLabel, tx, PADDING_TOP + totalChartH + 15);
        }
      }

      // ── Axis borders ──
      ctx.strokeStyle = '#2a2e39';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT + chartW + 0.5, PADDING_TOP);
      ctx.lineTo(PADDING_LEFT + chartW + 0.5, PADDING_TOP + totalChartH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT, PADDING_TOP + totalChartH + 0.5);
      ctx.lineTo(PADDING_LEFT + chartW, PADDING_TOP + totalChartH + 0.5);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(42, 46, 57, 0.3)';
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT, Math.round(PADDING_TOP + priceChartH) + 0.5);
      ctx.lineTo(PADDING_LEFT + chartW, Math.round(PADDING_TOP + priceChartH) + 0.5);
      ctx.stroke();

      // ── "Go to latest" button when scrolled back ──
      if (!autoScrollRef.current) {
        const btnW = 24;
        const btnH = 20;
        const btnX = PADDING_LEFT + chartW - btnW - 8;
        const btnY = PADDING_TOP + 8;
        ctx.fillStyle = 'rgba(54, 58, 69, 0.85)';
        roundRect(ctx, btnX, btnY, btnW, btnH, 4);
        ctx.fill();
        ctx.fillStyle = '#d1d4dc';
        ctx.font = `14px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('\u00BB', btnX + btnW / 2, btnY + 15); // »
      }
    };

    // rAF loop
    const tick = () => {
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // ── Mouse events ──
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mouseRef.current = { x: mx, y: my };

      // Dragging
      if (dragRef.current.active) {
        const dx = e.clientX - dragRef.current.startX;
        const candlesMoved = Math.round(dx / candleSpacing);
        scrollOffsetRef.current = Math.max(0, dragRef.current.startOffset + candlesMoved);
        if (scrollOffsetRef.current === 0) {
          autoScrollRef.current = true;
        } else {
          autoScrollRef.current = false;
        }
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Check "go to latest" button click
      const chartW = container.clientWidth - PADDING_LEFT - PADDING_RIGHT;
      const btnX = PADDING_LEFT + chartW - 32;
      const btnY = PADDING_TOP + 8;
      if (!autoScrollRef.current && mx >= btnX && mx <= btnX + 24 && my >= btnY && my <= btnY + 20) {
        scrollOffsetRef.current = 0;
        autoScrollRef.current = true;
        return;
      }

      dragRef.current = {
        active: true,
        startX: e.clientX,
        startOffset: scrollOffsetRef.current,
      };
      canvas.style.cursor = 'grabbing';
    };

    const onMouseUp = () => {
      dragRef.current.active = false;
      canvas.style.cursor = 'crosshair';
    };

    const onMouseLeave = () => {
      mouseRef.current = null;
      dragRef.current.active = false;
      canvas.style.cursor = 'crosshair';
    };

    // Scroll wheel = horizontal pan
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * 3; // scroll 3 candles per wheel tick
      scrollOffsetRef.current = Math.max(0, scrollOffsetRef.current + delta);
      if (scrollOffsetRef.current === 0) {
        autoScrollRef.current = true;
      } else {
        autoScrollRef.current = false;
      }
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className="panel flex flex-col h-full" style={{ minHeight: 0 }}>
      {title && (
        <div className="flex items-center justify-between px-3 py-1 border-b border-border-dark shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[0.65rem] text-gray-500 font-bold tracking-wider">{title}</span>
            {structureData?.['5m']?.trend && (
              <span className={`text-[0.55rem] font-bold px-1.5 py-0.5 rounded ${
                structureData['5m'].trend === 'UPTREND' ? 'bg-green-500/20 text-green-400' :
                structureData['5m'].trend === 'DOWNTREND' ? 'bg-red-500/20 text-red-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {structureData['5m'].trend}
              </span>
            )}
            {vwapData && vwapData.vwap > 0 && (
              <span className="text-[0.55rem] text-gray-500">
                VWAP <span className="text-gray-400">{formatPriceTv(vwapData.vwap)}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {TIMEFRAME_OPTIONS.map(tf => (
              <button
                key={tf}
                onClick={() => {
                  setActiveTimeframe(tf);
                  // Reset scroll to latest when switching timeframe
                  scrollOffsetRef.current = 0;
                  autoScrollRef.current = true;
                }}
                style={{
                  padding: '1px 6px',
                  fontSize: '0.55rem',
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: 0.5,
                  border: 'none',
                  borderBottom: tf === activeTimeframe ? '2px solid #3b82f6' : '2px solid transparent',
                  background: 'transparent',
                  color: tf === activeTimeframe ? '#3b82f6' : '#555',
                  cursor: 'pointer',
                  transition: 'all 150ms',
                }}
              >
                {tf}
              </button>
            ))}
          </div>
          {primaryKey && (
            <span className="text-[0.6rem] text-gray-600">
              <span className="text-gray-400">{EXCHANGE_LABELS[primaryKey] || primaryKey}</span>
            </span>
          )}
        </div>
      )}

      <div ref={containerRef} style={{ flex: '1 1 0%', minHeight: 0, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 px-3 py-1 border-t border-border-dark flex-wrap shrink-0">
        {primaryKey && (
          <div className="flex items-center gap-1.5 text-[0.6rem]">
            <span className="w-3 h-2 inline-block rounded-sm" style={{ background: UP_COLOR, border: `1px solid ${UP_COLOR}` }} />
            <span className="text-gray-400">{EXCHANGE_LABELS[primaryKey]} (candles)</span>
          </div>
        )}
        {Object.entries(EXCHANGE_LABELS)
          .filter(([key]) => key !== primaryKey)
          .map(([key, label]) => (
            <div key={key} className="flex items-center gap-1.5 text-[0.6rem]">
              <span
                className="w-3 h-0.5 inline-block rounded"
                style={{ backgroundColor: EXCHANGE_COLORS[key] }}
              />
              <span style={{ color: EXCHANGE_COLORS[key] }}>{label}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Helpers ──

// Slice candles array to a time range (binary search friendly but simple for now)
function sliceByTimeRange(candles: Candle[], startTime: number, endTime: number): Candle[] {
  const result: Candle[] = [];
  for (const c of candles) {
    if (c.time >= startTime && c.time <= endTime) result.push(c);
    if (c.time > endTime) break;
  }
  return result;
}

function niceStep(range: number, targetLines: number): number {
  const rough = range / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let nice: number;
  if (norm <= 1.5) nice = 1;
  else if (norm <= 3) nice = 2;
  else if (norm <= 7) nice = 5;
  else nice = 10;
  return nice * mag;
}

function formatPriceTv(price: number): string {
  if (price >= 10000) {
    const whole = Math.round(price);
    const str = whole.toString();
    return str.slice(0, -3) + ' ' + str.slice(-3);
  }
  if (price >= 1000) return price.toFixed(1);
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
