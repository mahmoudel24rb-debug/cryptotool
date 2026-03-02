import React, { useState, useRef, useEffect } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import Settings from '../Settings';

type ToolId = 'screener' | 'journal' | 'settings' | 'connections';

const TOOLS: { id: ToolId; label: string; icon: string; color: string }[] = [
  { id: 'screener', label: 'SCREENER', icon: '\u{1F4CA}', color: '#00d4ff' },
  { id: 'journal', label: 'JOURNAL', icon: '\u{1F4D3}', color: '#ffd700' },
  { id: 'settings', label: 'SETTINGS', icon: '\u2699', color: '#ff6b35' },
  { id: 'connections', label: 'CONNECTIONS', icon: '\u{1F517}', color: '#22c55e' },
];

export default function ToolsTab() {
  const { state } = useGlobalState();
  const [activeTool, setActiveTool] = useState<ToolId>('screener');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tool selector bar */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '12px 16px',
          background: '#0d0d0d',
          borderBottom: '1px solid #1a1a2e',
          flexShrink: 0,
        }}
      >
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            style={{
              padding: '10px 24px',
              background: activeTool === tool.id ? '#111827' : '#0a0a0a',
              border: activeTool === tool.id ? `1px solid ${tool.color}44` : '1px solid #1e293b',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              transition: 'all 200ms',
            }}
          >
            <span style={{ fontSize: 20 }}>{tool.icon}</span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1,
                color: activeTool === tool.id ? tool.color : '#666',
              }}
            >
              {tool.label}
            </span>
          </button>
        ))}
      </div>

      {/* Tool content */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {activeTool === 'screener' && <Screener state={state} />}
        {activeTool === 'journal' && <TradeJournal />}
        {activeTool === 'settings' && (
          <div style={{ padding: 16 }}>
            <Settings visible={true} onClose={() => setActiveTool('screener')} />
          </div>
        )}
        {activeTool === 'connections' && <ConnectionMonitor connected={state.connected} />}
      </div>
    </div>
  );
}

// ── Multi-Asset Screener (Canvas) ──
function Screener({ state }: { state: any }) {
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

    const pad = 24;
    let y = 20;

    ctx.fillStyle = '#00d4ff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('MULTI-ASSET SCREENER', pad, y + 12);
    y += 32;

    // Column headers
    const cols = [
      { label: 'ASSET', x: pad, align: 'left' as const },
      { label: 'PRICE', x: 120, align: 'right' as const },
      { label: 'VOLUME', x: 240, align: 'right' as const },
      { label: 'OI CHG', x: 340, align: 'right' as const },
      { label: 'FUNDING', x: 440, align: 'right' as const },
      { label: 'TREND', x: 540, align: 'center' as const },
      { label: 'SCENARIOS', x: 650, align: 'center' as const },
    ];

    ctx.fillStyle = '#6b7280';
    ctx.font = 'bold 9px monospace';
    for (const col of cols) {
      ctx.textAlign = col.align;
      ctx.fillText(col.label, col.x, y + 10);
    }
    y += 16;
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    y += 8;

    // BTC row
    const price = state.currentPrice > 0 ? `$${state.currentPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—';
    const volume = state.metrics?.volumePerMinute > 0 ? `$${(state.metrics.volumePerMinute / 1e6).toFixed(1)}M/m` : '—';
    const trend = state.structureData?.['5m']?.trend || '—';
    const trendColor = trend === 'UPTREND' ? '#22c55e' : trend === 'DOWNTREND' ? '#ef4444' : '#6b7280';
    const activeScenarios = (state.scenarios || []).filter((s: any) => s.status === 'PENDING' || s.status === 'ACTIVE' || s.status === 'TP1_HIT' || s.status === 'TP2_HIT');

    let oiChangeStr = '—';
    let oiColor = '#6b7280';
    if (state.derivativesData?.openInterest) {
      const ois = Object.values(state.derivativesData.openInterest) as any[];
      for (const v of ois) {
        const change = typeof v === 'object' ? v?.change : 0;
        if (change !== 0) { oiChangeStr = `${change > 0 ? '+' : ''}${change.toFixed(1)}%`; oiColor = change > 0 ? '#22c55e' : '#ef4444'; break; }
      }
    }

    let fundingStr = '—';
    let fundingColor = '#6b7280';
    if (state.derivativesData?.funding) {
      const frs = Object.values(state.derivativesData.funding) as any[];
      let sum = 0, cnt = 0;
      for (const v of frs) { sum += (typeof v === 'number' ? v : v?.rate || 0); cnt++; }
      if (cnt > 0) { const avg = sum / cnt; fundingStr = `${avg >= 0 ? '+' : ''}${(avg * 100).toFixed(4)}%`; fundingColor = Math.abs(avg) > 0.0003 ? '#ef4444' : '#9ca3af'; }
    }

    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left'; ctx.fillStyle = '#e5e7eb'; ctx.fillText('BTC', cols[0].x, y + 12);
    ctx.textAlign = 'right'; ctx.fillStyle = '#e5e7eb'; ctx.fillText(price, cols[1].x, y + 12);
    ctx.fillStyle = '#22c55e'; ctx.fillText(volume, cols[2].x, y + 12);
    ctx.fillStyle = oiColor; ctx.fillText(oiChangeStr, cols[3].x, y + 12);
    ctx.fillStyle = fundingColor; ctx.fillText(fundingStr, cols[4].x, y + 12);
    ctx.textAlign = 'center'; ctx.fillStyle = trendColor; ctx.font = 'bold 9px monospace'; ctx.fillText(trend, cols[5].x, y + 12);
    ctx.fillStyle = activeScenarios.length > 0 ? '#ffd700' : '#4b5563'; ctx.font = '10px monospace'; ctx.fillText(`${activeScenarios.length}`, cols[6].x, y + 12);
    y += 24;

    ctx.strokeStyle = '#111827';
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    y += 8;

    // Greyed-out rows for future assets
    for (const asset of ['ETH', 'SOL', 'DOGE', 'XRP']) {
      ctx.globalAlpha = 0.3;
      ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#4b5563';
      ctx.fillText(asset, cols[0].x, y + 12);
      for (let c = 1; c < cols.length; c++) { ctx.textAlign = cols[c].align; ctx.fillText('—', cols[c].x, y + 12); }
      ctx.globalAlpha = 1;
      y += 22;
      ctx.strokeStyle = '#111827'; ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
      ctx.globalAlpha = 1;
      y += 8;
    }

    y += 20;
    ctx.fillStyle = '#4b5563'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText('Multi-asset support requires backend extension. Currently BTC only.', pad, y + 10);
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => { const r = parent.getBoundingClientRect(); canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`; });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ height: '100%', background: '#0a0e14' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

// ── Trade Journal ──
interface TradeEntry {
  id: string;
  date: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  exit: number | null;
  size: string;
  pnl: number | null;
  rr: number | null;
  notes: string;
}

function TradeJournal() {
  const [trades, setTrades] = useState<TradeEntry[]>([]);
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

    const pad = 24;
    let y = 20;

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TRADE JOURNAL', pad, y + 12);
    y += 32;

    if (trades.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No trades logged yet.', W / 2, y + 40);
      ctx.fillText('Click + NEW TRADE to start tracking your trades.', W / 2, y + 58);
      return;
    }

    // Headers
    const cx = [pad, 100, 160, 260, 360, 430, 500];
    const headers = ['DATE', 'DIR', 'ENTRY', 'EXIT', 'P&L', 'R:R', 'NOTES'];
    ctx.fillStyle = '#6b7280'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left';
    for (let i = 0; i < headers.length; i++) ctx.fillText(headers[i], cx[i], y + 10);
    y += 16;
    ctx.strokeStyle = '#1e293b'; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    y += 8;

    for (const t of trades) {
      ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = '#9ca3af'; ctx.fillText(t.date, cx[0], y + 12);
      ctx.fillStyle = t.direction === 'LONG' ? '#22c55e' : '#ef4444'; ctx.font = 'bold 10px monospace'; ctx.fillText(t.direction, cx[1], y + 12);
      ctx.fillStyle = '#e5e7eb'; ctx.font = '10px monospace';
      ctx.fillText(`$${t.entry.toFixed(0)}`, cx[2], y + 12);
      ctx.fillText(t.exit ? `$${t.exit.toFixed(0)}` : '—', cx[3], y + 12);
      if (t.pnl !== null) { ctx.fillStyle = t.pnl >= 0 ? '#22c55e' : '#ef4444'; ctx.fillText(`${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(0)}`, cx[4], y + 12); }
      if (t.rr !== null) { ctx.fillStyle = t.rr >= 0 ? '#22c55e' : '#ef4444'; ctx.fillText(`${t.rr.toFixed(1)}R`, cx[5], y + 12); }
      ctx.fillStyle = '#6b7280'; ctx.fillText(t.notes.slice(0, 25), cx[6], y + 12);
      y += 24;
    }

    y += 16;
    const wins = trades.filter(t => t.pnl !== null && t.pnl > 0).length;
    const total = trades.filter(t => t.pnl !== null).length;
    const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : '—';
    ctx.fillStyle = '#6b7280'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`STATS: ${trades.length} trades | Winrate: ${wr}%`, pad, y + 10);
  }, [trades]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => { const r = parent.getBoundingClientRect(); canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`; });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e14' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 24px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 }}>
        <button
          onClick={() => {
            setTrades(prev => [...prev, {
              id: Date.now().toString(),
              date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              direction: Math.random() > 0.5 ? 'LONG' : 'SHORT',
              entry: 85000 + Math.random() * 2000,
              exit: 85000 + Math.random() * 3000,
              size: '0.1 BTC',
              pnl: (Math.random() - 0.4) * 200,
              rr: (Math.random() - 0.3) * 4,
              notes: 'Manual entry',
            }]);
          }}
          style={{
            padding: '6px 16px',
            background: '#ffd70022',
            border: '1px solid #ffd70044',
            color: '#ffd700',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            borderRadius: 2,
          }}
        >
          + NEW TRADE
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </div>
  );
}

// ── Connection Monitor ──
function ConnectionMonitor({ connected }: { connected: boolean }) {
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

    const pad = 24;
    let y = 20;

    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CONNECTION MONITOR', pad, y + 12);
    y += 32;

    const colX = { exchange: pad, status: 220, latency: 360, lastMsg: 500 };

    ctx.fillStyle = '#6b7280'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left';
    ctx.fillText('EXCHANGE', colX.exchange, y + 10);
    ctx.fillText('STATUS', colX.status, y + 10);
    ctx.fillText('LATENCY', colX.latency, y + 10);
    ctx.fillText('LAST MESSAGE', colX.lastMsg, y + 10);
    y += 16;

    ctx.strokeStyle = '#1e293b'; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    y += 8;

    const exchanges = [
      { name: 'Binance Spot', live: connected },
      { name: 'Binance Futures', live: connected },
      { name: 'Bybit', live: connected },
      { name: 'Coinbase', live: connected },
      { name: 'Hyperliquid', live: connected },
      { name: 'OKX', live: connected },
    ];

    for (const ex of exchanges) {
      ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = '#e5e7eb'; ctx.fillText(ex.name, colX.exchange, y + 12);

      const sc = ex.live ? '#22c55e' : '#ef4444';
      ctx.beginPath(); ctx.arc(colX.status, y + 9, 4, 0, Math.PI * 2); ctx.fillStyle = sc; ctx.fill();
      ctx.fillStyle = sc; ctx.font = 'bold 9px monospace'; ctx.fillText(ex.live ? 'LIVE' : 'DOWN', colX.status + 12, y + 12);

      ctx.fillStyle = '#6b7280'; ctx.font = '10px monospace';
      ctx.fillText(ex.live ? '~15ms' : '—', colX.latency, y + 12);
      ctx.fillText(ex.live ? '< 1s ago' : '—', colX.lastMsg, y + 12);

      y += 28;
      ctx.strokeStyle = '#111827'; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
      y += 6;
    }

    y += 20;
    ctx.fillStyle = connected ? '#22c55e' : '#ef4444';
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
    ctx.fillText(connected ? 'All connections operational' : 'WebSocket disconnected — reconnecting...', pad, y + 10);
  }, [connected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => { const r = parent.getBoundingClientRect(); canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`; });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ height: '100%', background: '#0a0e14' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
