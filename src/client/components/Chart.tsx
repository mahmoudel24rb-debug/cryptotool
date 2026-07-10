import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { MackuantDatafeed, type CandleDataStore } from '../datafeed/mackuantDatafeed';
import { useGlobalState } from '../hooks/useGlobalState';

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
  'BYBIT:PERP',
  'BINANCE_FUTURES:PERP',
  'BINANCE:SPOT',
  'OKX:PERP',
  'COINBASE:SPOT',
  'HYPERLIQUID:PERP',
];

// Short display labels for exchange buttons
const EXCHANGE_LABELS: Record<string, string> = {
  'BYBIT:PERP': 'Bybit',
  'BINANCE_FUTURES:PERP': 'Binance F',
  'BINANCE:SPOT': 'Binance S',
  'OKX:PERP': 'OKX',
  'COINBASE:SPOT': 'Coinbase',
  'HYPERLIQUID:PERP': 'Hyperliquid',
};

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
  const { state, candleStoreRef } = useGlobalState();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const datafeedRef = useRef<MackuantDatafeed | null>(null);
  const readyRef = useRef(false);
  const shapeIdsRef = useRef<string[]>([]);
  const vwapRef = useRef(vwapData);
  const structureRef = useRef(structureData);
  const overlayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drawingRef = useRef(false); // mutex to prevent concurrent draws
  const overlaySigRef = useRef(''); // skip redraw when overlay inputs haven't changed

  // Exchange selector state
  const [selectedExchange, setSelectedExchange] = useState<string | null>(null);
  const activeSymbolRef = useRef<string | null>(null);

  // Keep refs in sync
  vwapRef.current = vwapData;
  structureRef.current = structureData;

  // Available exchanges (those with candle data)
  const availableExchanges = useMemo(() => {
    const available = Object.keys(candlesByExchange).filter(k => candlesByExchange[k]?.length > 0);
    // Sort by PRIMARY_KEYS order
    return PRIMARY_KEYS.filter(k => available.includes(k));
  }, [candlesByExchange]);

  // Effective exchange: user selection or auto-pick
  const effectiveExchange = useMemo(() => {
    if (selectedExchange && candlesByExchange[selectedExchange]?.length > 0) {
      return selectedExchange;
    }
    return availableExchanges[0] ?? null;
  }, [selectedExchange, availableExchanges, candlesByExchange]);

  // Initial exchange for widget creation (stable — only set once)
  const initialExchangeRef = useRef<string | null>(null);
  if (!initialExchangeRef.current && effectiveExchange) {
    initialExchangeRef.current = effectiveExchange;
  }

  // Switch symbol on the existing widget when exchange changes (no widget recreation)
  const switchSymbol = useCallback((newSymbol: string) => {
    if (!widgetRef.current || !readyRef.current) return;
    if (activeSymbolRef.current === newSymbol) return;
    try {
      // Reset datafeed cache before switching — forces TradingView to re-fetch all bars
      if (datafeedRef.current) {
        datafeedRef.current.resetForSymbolSwitch();
      }
      widgetRef.current.activeChart().setSymbol(newSymbol);
      activeSymbolRef.current = newSymbol;
      overlaySigRef.current = ''; // force overlay redraw on the new series
    } catch (_) { /* ignore */ }
  }, []);

  // When effectiveExchange changes, switch symbol (not recreate widget)
  useEffect(() => {
    if (effectiveExchange && effectiveExchange !== activeSymbolRef.current) {
      switchSymbol(effectiveExchange);
    }
  }, [effectiveExchange, switchSymbol]);

  // ── Initialize TradingView widget once ──
  useEffect(() => {
    const initSymbol = initialExchangeRef.current;
    if (!containerRef.current || !initSymbol) return;
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
      symbol: initSymbol,
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
    activeSymbolRef.current = initSymbol;

    widget.onChartReady(() => {
      readyRef.current = true;

      // Add volume as overlay on main pane (forceOverlay = true)
      widget.activeChart().createStudy('Volume', true, false);

      // If effectiveExchange changed while widget was loading, switch now
      if (effectiveExchange && effectiveExchange !== initSymbol) {
        switchSymbol(effectiveExchange);
      }

      // Draw initial overlays after a short delay, then refresh every 15s
      setTimeout(() => drawAllOverlays(), 1500);
      overlayTimerRef.current = setInterval(() => drawAllOverlays(), 15000);
    });

    return () => {
      readyRef.current = false;
      if (overlayTimerRef.current) clearInterval(overlayTimerRef.current);
      if (widgetRef.current) {
        try { widgetRef.current.remove(); } catch (_) { /* ignore */ }
        widgetRef.current = null;
      }
      datafeedRef.current = null;
      activeSymbolRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExchangeRef.current]);

  // ── Push real-time candle updates to datafeed ──
  // Uses candleStoreRef (mutable, always fresh) + candleTickVersion as trigger
  useEffect(() => {
    if (!datafeedRef.current) return;
    const liveStore = candleStoreRef?.current ?? candlesByExchange;
    datafeedRef.current.updateStore({
      candlesByExchange: liveStore,
      htfCandles: htfCandles || {},
    });
    datafeedRef.current.onRealtimeUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.candleTickVersion, htfCandles]);

  // Stable signature of everything that affects overlay rendering — redrawing
  // identical shapes every 15s caused a visible flicker (and shape churn
  // during volatile periods)
  function computeOverlaySignature(): string {
    const vwap = vwapRef.current;
    const structure = structureRef.current;
    const parts: (string | number)[] = [];
    // VWAP rounded to $10 buckets — per-tick precision would invalidate the
    // signature every redraw cycle and defeat the skip
    if (vwap) parts.push(Math.round(vwap.vwap / 10), Math.round(vwap.upperBand2 / 10), Math.round(vwap.lowerBand2 / 10));
    if (structure) {
      const tfKey = Object.keys(structure)[0];
      const s = tfKey ? structure[tfKey] : null;
      if (s) {
        for (const ob of s.orderBlocks || []) parts.push(ob.id, ob.mitigated ? 1 : 0);
        for (const fvg of s.fvgs || []) parts.push(fvg.id, fvg.filled ? 1 : 0, Math.round(fvg.filledPercent));
        for (const brk of (s.recentBreaks || []).slice(-5)) parts.push(brk.timestamp, brk.type);
        for (const pool of s.liquidityPools || []) parts.push(pool.id, pool.swept ? 1 : 0, pool.strength);
        for (const sh of (s.swingHighs || []).slice(-4)) parts.push(sh.timestamp, sh.broken ? 1 : 0);
        for (const sl of (s.swingLows || []).slice(-4)) parts.push(sl.timestamp, sl.broken ? 1 : 0);
      }
    }
    return parts.join('|');
  }

  // ── Draw all overlays (async-safe with mutex) ──
  async function drawAllOverlays() {
    if (!widgetRef.current || !readyRef.current) return;
    if (drawingRef.current) return; // skip if already drawing

    const sig = computeOverlaySignature();
    if (sig === overlaySigRef.current) return; // nothing changed since last draw
    overlaySigRef.current = sig;

    drawingRef.current = true;

    try {
      const chart = widgetRef.current.activeChart();
      if (!chart) return;

      // Remove previously tracked shapes by ID (reliable)
      const oldIds = shapeIdsRef.current;
      shapeIdsRef.current = [];
      for (const id of oldIds) {
        try { chart.removeEntity(id); } catch (_) { /* ignore */ }
      }
      // Safety net: also try removeAllShapes
      try { chart.removeAllShapes(); } catch (_) { /* ignore */ }

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
      {/* Title */}
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

      {/* Exchange selector buttons */}
      {availableExchanges.length > 1 && (
        <div style={{
          position: 'absolute',
          top: 4, right: 8, zIndex: 10,
          display: 'flex',
          gap: 3,
        }}>
          {availableExchanges.map(key => {
            const isActive = effectiveExchange === key;
            return (
              <button
                key={key}
                onClick={() => setSelectedExchange(key)}
                style={{
                  padding: '2px 8px',
                  fontSize: 10,
                  fontFamily: '"JetBrains Mono", monospace',
                  background: isActive ? '#1e3a5f' : '#1a1a2e',
                  color: isActive ? '#60a5fa' : '#787b86',
                  border: `1px solid ${isActive ? '#60a5fa' : '#2a2a3e'}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {EXCHANGE_LABELS[key] || key.split(':')[0]}
              </button>
            );
          })}
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
