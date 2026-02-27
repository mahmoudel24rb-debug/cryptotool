import React, { useState, useRef, useEffect } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import Chart from '../Chart';
import ScenarioPanel from '../ScenarioPanel';
import ActivityLog from '../ActivityLog';

const TIMEFRAMES = ['1m', '5m', '15m'];
const THEME_COLOR = '#ffd700';

export default function StructureTab() {
  const { state } = useGlobalState();
  const [activeTimeframe, setActiveTimeframe] = useState('5m');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: Chart with all structure overlays */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <Chart
            candlesByExchange={state.candlesByExchange}
            htfCandles={state.htfCandles}
            title="BTC — STRUCTURE ANALYSIS"
            vwapData={state.vwapData}
            structureData={state.structureData}
          />
        </div>

        {/* Right sidebar: Structure Info + Scenario Panel */}
        <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #1e293b' }}>
          {/* Timeframe selector */}
          <div style={{
            display: 'flex',
            gap: 4,
            padding: '6px 8px',
            background: '#0d0d0d',
            borderBottom: '1px solid #1a1a2e',
            flexShrink: 0,
          }}>
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setActiveTimeframe(tf)}
                style={{
                  padding: '3px 12px',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: 1,
                  border: 'none',
                  borderBottom: tf === activeTimeframe ? `2px solid ${THEME_COLOR}` : '2px solid transparent',
                  background: 'transparent',
                  color: tf === activeTimeframe ? THEME_COLOR : '#666',
                  cursor: 'pointer',
                  transition: 'all 200ms',
                }}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Structure Info panel */}
          <StructureInfo structureData={state.structureData} activeTimeframe={activeTimeframe} />

          {/* Scenario Panel */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <ScenarioPanel scenarios={state.scenarios} />
          </div>
        </div>
      </div>

      {/* Bottom: Filtered Activity Log */}
      <div style={{ height: 200, flexShrink: 0, borderTop: '1px solid #1e293b' }}>
        <ActivityLog alerts={state.alerts} />
      </div>
    </div>
  );
}

function StructureInfo({ structureData, activeTimeframe }: { structureData: Record<string, any>; activeTimeframe: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, W, H);

    const pad = 8;
    let y = 6;
    const struct = structureData?.[activeTimeframe];

    // Header
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`STRUCTURE (${activeTimeframe})`, pad, y + 10);
    y += 18;

    if (!struct) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText('Waiting for structure data...', pad, y + 10);
      return;
    }

    // Trend
    const trendColor = struct.trend === 'UPTREND' ? '#22c55e' :
                       struct.trend === 'DOWNTREND' ? '#ef4444' : '#6b7280';
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px monospace';
    ctx.fillText('Trend:', pad, y + 10);
    ctx.fillStyle = trendColor;
    ctx.font = 'bold 10px monospace';
    ctx.fillText(struct.trend || '—', pad + 50, y + 10);
    y += 16;

    // Recent BOS/CHoCH
    ctx.fillStyle = '#9ca3af';
    ctx.font = '8px monospace';
    ctx.fillText('Recent Breaks:', pad, y + 10);
    y += 14;

    const breaks = (struct.recentBreaks || []).slice(0, 3);
    for (const brk of breaks) {
      const color = brk.type === 'CHoCH'
        ? (brk.direction === 'BULLISH' ? '#22d3ee' : '#fb923c')
        : (brk.direction === 'BULLISH' ? '#22c55e' : '#ef4444');

      ctx.fillStyle = color;
      ctx.font = 'bold 8px monospace';
      ctx.fillText(brk.type, pad + 4, y + 9);

      ctx.fillStyle = brk.direction === 'BULLISH' ? '#22c55e' : '#ef4444';
      ctx.font = '8px monospace';
      ctx.fillText(brk.direction, pad + 42, y + 9);

      ctx.fillStyle = '#d1d5db';
      ctx.fillText(`$${brk.price?.toFixed(0) || '—'}`, pad + 100, y + 9);

      const d = new Date(brk.timestamp * 1000);
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'right';
      ctx.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, W - pad, y + 9);
      ctx.textAlign = 'left';
      y += 12;
    }

    if (breaks.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '8px monospace';
      ctx.fillText('No breaks detected yet', pad + 4, y + 9);
      y += 12;
    }

    y += 4;

    // Swing points
    ctx.fillStyle = '#9ca3af';
    ctx.font = '8px monospace';
    ctx.fillText('Swing Points:', pad, y + 10);
    y += 14;

    const highs = (struct.swingHighs || []).filter((s: any) => !s.broken).slice(0, 2);
    for (const sh of highs) {
      ctx.fillStyle = '#ef4444';
      ctx.font = '8px monospace';
      ctx.fillText(`SH: $${sh.price?.toFixed(0) || '—'}`, pad + 4, y + 9);
      y += 11;
    }

    const lows = (struct.swingLows || []).filter((s: any) => !s.broken).slice(0, 2);
    for (const sl of lows) {
      ctx.fillStyle = '#22c55e';
      ctx.font = '8px monospace';
      ctx.fillText(`SL: $${sl.price?.toFixed(0) || '—'}`, pad + 4, y + 9);
      y += 11;
    }

    y += 4;

    // Active OBs count
    const obs = (struct.orderBlocks || []).filter((ob: any) => !ob.mitigated);
    const fvgs = (struct.fvgs || []).filter((f: any) => !f.filled);
    const pools = (struct.liquidityPools || []).filter((p: any) => !p.swept);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '8px monospace';
    ctx.fillText('Zones:', pad, y + 10);
    y += 14;

    ctx.font = '8px monospace';
    ctx.fillStyle = '#22c55e';
    ctx.fillText(`OB: ${obs.length}`, pad + 4, y + 9);
    ctx.fillStyle = '#60a5fa';
    ctx.fillText(`FVG: ${fvgs.length}`, pad + 60, y + 9);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`LIQ: ${pools.length}`, pad + 120, y + 9);

  }, [structureData, activeTimeframe]);

  // Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      const rect = parent.getBoundingClientRect();
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ height: 200, flexShrink: 0, background: '#0a0e14', borderBottom: '1px solid #1a1a2e' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
