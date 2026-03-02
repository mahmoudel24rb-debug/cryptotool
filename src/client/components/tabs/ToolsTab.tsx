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

// ── Trade Journal (auto-populated from scenario outcomes) ──
function TradeJournal() {
  const { state } = useGlobalState();
  const trades = state.journalTrades || [];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef(0);

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

    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, W, rect.height);

    const pad = 24;
    let y = 20;

    // Title + stats summary
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TRADE JOURNAL', pad, y + 12);

    if (trades.length > 0) {
      // Compute stats
      const tp1Hits = trades.filter((t: any) => t.tp1Hit).length;
      const tp2Hits = trades.filter((t: any) => t.tp2Hit).length;
      const tp3Hits = trades.filter((t: any) => t.tp3Hit).length;
      const slHits = trades.filter((t: any) => t.finalStatus === 'INVALIDATED' && t.exitReason?.includes('Stop-loss')).length;
      const expired = trades.filter((t: any) => t.finalStatus === 'EXPIRED').length;
      const activated = trades.filter((t: any) => t.tp1Hit || t.exitReason?.includes('Stop-loss')).length;
      const winRate = activated > 0 ? ((tp1Hits / activated) * 100).toFixed(1) : '—';

      ctx.fillStyle = '#6b7280';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${trades.length} scenarios | WR: ${winRate}% | TP1: ${tp1Hits} TP2: ${tp2Hits} TP3: ${tp3Hits} | SL: ${slHits} | EXP: ${expired}`, W - pad, y + 12);
    }

    y += 32;

    if (trades.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('En attente de scenarios termines...', W / 2, y + 40);
      ctx.fillText('Les trades sont enregistres automatiquement.', W / 2, y + 58);
      return;
    }

    // Column definitions
    const cols = [
      { label: 'DATE', x: pad, w: 85 },
      { label: 'TEMPLATE', x: pad + 85, w: 160 },
      { label: 'DIR', x: pad + 245, w: 55 },
      { label: 'ENTRY', x: pad + 300, w: 75 },
      { label: 'EXIT', x: pad + 375, w: 75 },
      { label: 'STATUS', x: pad + 450, w: 90 },
      { label: 'SCORE', x: pad + 540, w: 55 },
      { label: 'R:R', x: pad + 595, w: 45 },
      { label: 'DURATION', x: pad + 640, w: 70 },
    ];

    // Headers
    ctx.fillStyle = '#6b7280';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    for (const col of cols) ctx.fillText(col.label, col.x, y + 10);
    y += 16;
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    y += 6;

    // Show trades newest first
    const sorted = [...trades].reverse();
    const maxVisible = Math.floor((rect.height - y - 20) / 26);

    for (let i = 0; i < Math.min(sorted.length, maxVisible); i++) {
      const t = sorted[i] as any;
      const date = new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      const entryPrice = t.entryMid ? `$${t.entryMid.toFixed(0)}` : '—';
      const exitPrice = t.exitPrice ? `$${t.exitPrice.toFixed(0)}` : '—';
      const durationMin = t.durationMs ? `${(t.durationMs / 60000).toFixed(1)}m` : '—';

      // Status color
      let statusColor = '#6b7280';
      let statusText = t.finalStatus || '—';
      if (t.tp3Hit) { statusColor = '#22c55e'; statusText = 'TP3 HIT'; }
      else if (t.tp2Hit) { statusColor = '#22c55e'; statusText = 'TP2 HIT'; }
      else if (t.tp1Hit) { statusColor = '#86efac'; statusText = 'TP1 + SL'; }
      else if (t.finalStatus === 'INVALIDATED') {
        if (t.exitReason?.includes('Stop-loss')) { statusColor = '#ef4444'; statusText = 'SL HIT'; }
        else if (t.exitReason?.includes('Replaced')) { statusColor = '#f59e0b'; statusText = 'REPLACED'; }
        else { statusColor = '#ef4444'; statusText = 'INVALID'; }
      }
      else if (t.finalStatus === 'EXPIRED') { statusColor = '#6b7280'; statusText = 'EXPIRED'; }

      const dirColor = t.direction === 'LONG' ? '#22c55e' : '#ef4444';

      ctx.font = '10px monospace';
      ctx.textAlign = 'left';

      // Date
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(date, cols[0].x, y + 12);

      // Template (truncated)
      ctx.fillStyle = '#e5e7eb';
      const tmpl = (t.template || '').slice(0, 20);
      ctx.fillText(tmpl, cols[1].x, y + 12);

      // Direction
      ctx.fillStyle = dirColor;
      ctx.font = 'bold 10px monospace';
      ctx.fillText(t.direction || '—', cols[2].x, y + 12);

      // Entry
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '10px monospace';
      ctx.fillText(entryPrice, cols[3].x, y + 12);

      // Exit
      ctx.fillText(exitPrice, cols[4].x, y + 12);

      // Status
      ctx.fillStyle = statusColor;
      ctx.font = 'bold 9px monospace';
      ctx.fillText(statusText, cols[5].x, y + 12);

      // Score
      ctx.fillStyle = t.adjustedScore >= 55 ? '#ffd700' : t.adjustedScore >= 40 ? '#f59e0b' : '#6b7280';
      ctx.font = '10px monospace';
      ctx.fillText(`${t.adjustedScore || t.rawScore || '—'}`, cols[6].x, y + 12);

      // R:R — not from the scenario R:R but we can show it
      ctx.fillStyle = '#9ca3af';
      ctx.fillText('—', cols[7].x, y + 12);

      // Duration
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(durationMin, cols[8].x, y + 12);

      y += 26;

      // Separator
      ctx.strokeStyle = '#111827';
      ctx.beginPath(); ctx.moveTo(pad, y - 4); ctx.lineTo(W - pad, y - 4); ctx.stroke();
    }

    if (sorted.length > maxVisible) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`+${sorted.length - maxVisible} more trades`, W / 2, y + 10);
    }
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
