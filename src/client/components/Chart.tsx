import React, { useEffect, useRef } from 'react';
import { MackuantDatafeed, type CandleDataStore } from '../datafeed/mackuantDatafeed';

// ── Types ──

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
  candlesByExchange: Record<string, any[]>;
  htfCandles?: Record<string, Record<string, any[]>>;
  title?: string;
  vwapData?: VWAPOverlay | null;
  structureData?: Record<string, StructureState>;
}

const PRIMARY_KEYS = [
  'BINANCE_FUTURES:PERP',
  'BINANCE:SPOT',
  'BYBIT:PERP',
  'COINBASE:SPOT',
  'OKX:PERP',
  'HYPERLIQUID:PERP',
];

declare global {
  interface Window {
    TradingView: any;
  }
}

// ── Shape drawing helpers ──

async function drawHLine(
  chart: any, ids: string[],
  price: number, fromTime: number, toTime: number, color: string, text: string,
) {
  try {
    const id = await chart.createMultipointShape(
      [{ time: fromTime, price }, { time: toTime, price }],
      {
        shape: 'trend_line',
        lock: true, disableSelection: true, disableSave: true, disableUndo: true,
        text,
        overrides: {
          linecolor: color, linewidth: 1, linestyle: 2,
          showLabel: true, textcolor: color, fontsize: 10,
        },
      }
    );
    if (id) ids.push(id);
  } catch (_) { /* ignore */ }
}

async function drawRect(
  chart: any, ids: string[],
  fromTime: number, topPrice: number, toTime: number, bottomPrice: number,
  bgColor: string, borderColor: string, text: string,
) {
  try {
    const id = await chart.createMultipointShape(
      [{ time: fromTime, price: topPrice }, { time: toTime, price: bottomPrice }],
      {
        shape: 'rectangle',
        lock: true, disableSelection: true, disableSave: true, disableUndo: true,
        text,
        overrides: {
          color: bgColor, borderColor, textColor: borderColor, fontSize: 9, transparency: 0,
        },
      }
    );
    if (id) ids.push(id);
  } catch (_) { /* ignore */ }
}

async function drawMarker(
  chart: any, ids: string[],
  timestamp: number, price: number, text: string, color: string,
) {
  try {
    const id = await chart.createShape(
      { time: timestamp, price },
      {
        shape: 'text',
        lock: true, disableSelection: true, disableSave: true, disableUndo: true,
        text,
        overrides: { color, fontsize: 9, bold: true },
      }
    );
    if (id) ids.push(id);
  } catch (_) { /* ignore */ }
}

// ── Chart Component ──

export default function Chart({
  candlesByExchange,
  htfCandles,
  title,
  vwapData,
  structureData,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const datafeedRef = useRef<MackuantDatafeed | null>(null);
  const readyRef = useRef(false);
  const shapeIdsRef = useRef<string[]>([]);
  const vwapRef = useRef(vwapData);
  const structureRef = useRef(structureData);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawingRef = useRef(false); // mutex to prevent concurrent draws

  // Keep refs in sync
  vwapRef.current = vwapData;
  structureRef.current = structureData;

  // Find primary exchange key
  const primaryKey = PRIMARY_KEYS.find(k => candlesByExchange[k]?.length > 0)
    || Object.keys(candlesByExchange)[0]
    || null;

  // ── Initialize TradingView widget once ──
  useEffect(() => {
    if (!containerRef.current || !primaryKey) return;
    if (!window.TradingView) {
      console.error('TradingView library not loaded');
      return;
    }

    const store: CandleDataStore = {
      candlesByExchange,
      htfCandles: htfCandles || {},
    };

    const datafeed = new MackuantDatafeed(store);
    datafeedRef.current = datafeed;

    const widget = new window.TradingView.widget({
      container: containerRef.current,
      datafeed: datafeed as any,
      symbol: primaryKey,
      interval: '1' as any,
      library_path: '/charting_library/',
      locale: 'en',
      autosize: true,
      theme: 'dark',
      timezone: 'Etc/UTC' as any,

      overrides: {
        'paneProperties.background': '#0a0a0a',
        'paneProperties.backgroundType': 'solid',
        'paneProperties.vertGridProperties.color': 'rgba(42, 46, 57, 0.3)',
        'paneProperties.horzGridProperties.color': 'rgba(42, 46, 57, 0.3)',
        'scalesProperties.backgroundColor': '#0a0a0a',
        'scalesProperties.textColor': '#787b86',
        'mainSeriesProperties.candleStyle.upColor': '#26a69a',
        'mainSeriesProperties.candleStyle.downColor': '#ef5350',
        'mainSeriesProperties.candleStyle.borderUpColor': '#26a69a',
        'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
        'mainSeriesProperties.candleStyle.wickUpColor': '#26a69a',
        'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350',
      },

      // Custom time range buttons (bottom-left of chart)
      time_frames: [
        { text: '3d', resolution: '5' as any, description: '3 Days' },
        { text: '1d', resolution: '1' as any, description: '1 Day' },
        { text: '12h', resolution: '1' as any, description: '12 Hours' },
        { text: '6h', resolution: '1' as any, description: '6 Hours' },
        { text: '1h', resolution: '1' as any, description: '1 Hour' },
      ] as any[],

      disabled_features: [
        'header_symbol_search',
        'header_compare',
        'display_market_status',
        'use_localstorage_for_settings',
        'popup_hints',
        'header_saveload',
        'create_volume_indicator_by_default',
        'go_to_date',
        'timeframes_toolbar',
      ] as any[],

      enabled_features: [
        'hide_left_toolbar_by_default',
      ] as any[],

      studies_overrides: {
        'volume.volume.color.0': '#ef535080',
        'volume.volume.color.1': '#26a69a80',
      },
    });

    widgetRef.current = widget;

    widget.onChartReady(() => {
      readyRef.current = true;

      // Add volume as overlay on main pane (forceOverlay = true)
      widget.activeChart().createStudy('Volume', true, false);

      // Draw initial overlays after a short delay (let chart render first)
      setTimeout(() => drawAllOverlays(), 1000);
    });

    return () => {
      readyRef.current = false;
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      if (widgetRef.current) {
        try { widgetRef.current.remove(); } catch (_) { /* ignore */ }
        widgetRef.current = null;
      }
      datafeedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryKey]);

  // ── Push real-time candle updates to datafeed ──
  useEffect(() => {
    if (!datafeedRef.current) return;
    datafeedRef.current.updateStore({
      candlesByExchange,
      htfCandles: htfCandles || {},
    });
    datafeedRef.current.onRealtimeUpdate();
  }, [candlesByExchange, htfCandles]);

  // ── Redraw structure overlays when data changes (throttled to 5s) ──
  useEffect(() => {
    if (!readyRef.current || !widgetRef.current) return;
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => drawAllOverlays(), 5000);
  }, [structureData, vwapData]);

  // ── Draw all overlays (async-safe with mutex) ──
  async function drawAllOverlays() {
    if (!widgetRef.current || !readyRef.current) return;
    if (drawingRef.current) return; // skip if already drawing
    drawingRef.current = true;

    try {
      const chart = widgetRef.current.activeChart();
      if (!chart) return;

      // Clear ALL shapes first
      try { chart.removeAllShapes(); } catch (_) { /* ignore */ }
      shapeIdsRef.current = [];
      const ids = shapeIdsRef.current;

      const vwap = vwapRef.current;
      const structure = structureRef.current;

      // Collect all draw promises
      const draws: Promise<void>[] = [];
      const now = Math.floor(Date.now() / 1000);

      // ── VWAP lines ──
      if (vwap && vwap.vwap > 0) {
        const dayStart = now - 86400;
        draws.push(drawHLine(chart, ids, vwap.vwap, dayStart, now, '#ff9800', 'VWAP'));
        draws.push(drawHLine(chart, ids, vwap.upperBand1, dayStart, now, 'rgba(255,152,0,0.4)', '+1σ'));
        draws.push(drawHLine(chart, ids, vwap.lowerBand1, dayStart, now, 'rgba(255,152,0,0.4)', '-1σ'));
        draws.push(drawHLine(chart, ids, vwap.upperBand2, dayStart, now, 'rgba(255,152,0,0.2)', '+2σ'));
        draws.push(drawHLine(chart, ids, vwap.lowerBand2, dayStart, now, 'rgba(255,152,0,0.2)', '-2σ'));
      }

      // ── Structure overlays ──
      if (structure) {
        const tfKey = Object.keys(structure)[0];
        const s = tfKey ? structure[tfKey] : null;
        if (s) {
          // Order Blocks (limit to 5 most recent unmitigated)
          if (s.orderBlocks) {
            let obCount = 0;
            for (let i = s.orderBlocks.length - 1; i >= 0 && obCount < 5; i--) {
              const ob = s.orderBlocks[i];
              if (ob.mitigated) continue;
              obCount++;
              const bg = ob.type === 'BULLISH' ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)';
              const border = ob.type === 'BULLISH' ? '#26a69a' : '#ef5350';
              draws.push(drawRect(chart, ids, ob.timestamp, ob.high, now, ob.low, bg, border,
                `OB ${ob.type === 'BULLISH' ? '▲' : '▼'} ${ob.strength}`));
            }
          }

          // FVGs (limit to 4 most recent unfilled)
          if (s.fvgs) {
            let fvgCount = 0;
            for (let i = s.fvgs.length - 1; i >= 0 && fvgCount < 4; i--) {
              const fvg = s.fvgs[i];
              if (fvg.filled) continue;
              fvgCount++;
              const bg = fvg.type === 'BULLISH' ? 'rgba(59,130,246,0.1)' : 'rgba(239,83,80,0.1)';
              const border = fvg.type === 'BULLISH' ? '#3b82f660' : '#ef535060';
              draws.push(drawRect(chart, ids, fvg.timestamp, fvg.high, now, fvg.low, bg, border,
                `FVG ${Math.round(fvg.filledPercent)}%`));
            }
          }

          // BOS / CHoCH (limit to 5 most recent)
          if (s.recentBreaks) {
            for (const brk of s.recentBreaks.slice(-5)) {
              const label = `${brk.type} ${brk.direction === 'BULLISH' ? '▲' : '▼'}`;
              const color = brk.direction === 'BULLISH' ? '#26a69a' : '#ef5350';
              draws.push(drawMarker(chart, ids, brk.timestamp, brk.breakPrice, label, color));
            }
          }

          // Liquidity pools (only show strong ones, strength >= 4, limit to 3)
          if (s.liquidityPools) {
            let poolCount = 0;
            for (const pool of s.liquidityPools) {
              if (pool.swept || pool.strength < 4 || poolCount >= 3) continue;
              poolCount++;
              const color = pool.type === 'BUYSIDE' ? '#22d3ee80' : '#f4384880';
              draws.push(drawHLine(chart, ids, pool.level, now - 7200, now, color,
                `${pool.type === 'BUYSIDE' ? 'BSL' : 'SSL'} (${pool.strength})`));
            }
          }

          // Swing highs/lows (limit to 4 each)
          for (const sh of (s.swingHighs || []).slice(-4)) {
            if (!sh.broken) draws.push(drawMarker(chart, ids, sh.timestamp, sh.price, 'SH', '#787b86'));
          }
          for (const sl of (s.swingLows || []).slice(-4)) {
            if (!sl.broken) draws.push(drawMarker(chart, ids, sl.timestamp, sl.price, 'SL', '#787b86'));
          }
        }
      }

      // Wait for all shapes to be created
      await Promise.allSettled(draws);
    } finally {
      drawingRef.current = false;
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {title && (
        <div style={{
          position: 'absolute',
          top: 4, left: 8, zIndex: 10,
          color: '#787b86',
          fontSize: 11,
          fontFamily: '"JetBrains Mono", monospace',
          pointerEvents: 'none',
        }}>
          {title}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
