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

// ── Trade Journal (fetches from /api/trade-history on mount) ──
interface ScenarioOutcome {
  id: string;
  template: string;
  direction: 'LONG' | 'SHORT';
  createdAt: number;
  adjustedScore: number;
  priority: string;
  signalCount: number;
  signalTypes: string[];
  entryMid: number;
  sl: number;
  tp1: number;
  finalStatus: string;
  exitPrice: number | null;
  exitTime: number;
  exitReason: string;
  durationMs: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  timeframe: string;
  llmVerdict?: 'APPROVE' | 'REDUCE' | 'REJECT' | null;
  llmConfidence?: number | null;
  tp2?: number;
  tp3?: number;
  initialRisk?: number;
  initialSl?: number;
  activationPrice?: number | null;
}

// R réalisé (modèle en tiers : 1/3 à chaque TP, reste au prix de sortie).
// Le label "TP1" seul est trompeur : un trade peut toucher TP1 puis rendre
// le reste au stop suiveur — le R dit la vérité du P&L.
function realizedR(t: ScenarioOutcome): number | null {
  const fill = t.activationPrice ?? t.entryMid; // le R se mesure depuis le fill réel
  const risk = t.initialRisk ?? (t.initialSl != null ? Math.abs(fill - t.initialSl) : null);
  if (!risk || risk <= 0) return null;
  const dir = t.direction === 'LONG' ? 1 : -1;
  const rOf = (px: number) => dir * (px - fill) / risk;
  const exit = t.exitPrice ?? fill;
  if (t.tp3Hit && t.tp2 != null && t.tp3 != null) return (rOf(t.tp1) + rOf(t.tp2) + rOf(t.tp3)) / 3;
  if (t.tp2Hit && t.tp2 != null) return (rOf(t.tp1) + rOf(t.tp2) + rOf(exit)) / 3;
  if (t.tp1Hit) return (rOf(t.tp1) + 2 * rOf(exit)) / 3;
  return rOf(exit);
}

const LLM_VERDICT_COLORS: Record<string, string> = {
  APPROVE: '#22c55e',
  REDUCE: '#eab308',
  REJECT: '#ef4444',
};

const mono = "'JetBrains Mono', monospace";

function TradeJournal() {
  const [trades, setTrades] = useState<ScenarioOutcome[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/trade-history')
      .then(r => r.json())
      .then((data: ScenarioOutcome[]) => {
        setTrades(data.reverse()); // newest first
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const stats = React.useMemo(() => {
    const total = trades.length;
    const slHits = trades.filter(t => t.finalStatus === 'INVALIDATED').length;
    const tp1 = trades.filter(t => t.tp1Hit).length;
    const tp2 = trades.filter(t => t.tp2Hit).length;
    const tp3 = trades.filter(t => t.tp3Hit).length;
    const expired = trades.filter(t => t.finalStatus === 'EXPIRED').length;
    const winrate = total > 0 ? ((tp1 / total) * 100).toFixed(1) : '0';
    const sumR = trades.reduce((s, t) => s + (realizedR(t) ?? 0), 0);
    return { total, slHits, tp1, tp2, tp3, expired, winrate, sumR };
  }, [trades]);

  const statusColor = (t: ScenarioOutcome) => {
    if (t.tp3Hit) return '#22c55e';
    if (t.tp2Hit) return '#22c55e';
    if (t.tp1Hit) return '#86efac';
    if (t.finalStatus === 'EXPIRED') return '#6b7280';
    return '#ef4444';
  };

  const statusLabel = (t: ScenarioOutcome) => {
    if (t.tp3Hit) return 'TP3';
    if (t.tp2Hit) return 'TP2';
    if (t.tp1Hit) return 'TP1';
    if (t.finalStatus === 'EXPIRED') return 'EXP';
    return 'SL';
  };

  const fmtDuration = (ms: number) => {
    const m = Math.floor(ms / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`;
  };

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' +
      d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return <div style={{ padding: 40, color: '#6b7280', fontFamily: mono, fontSize: 12, textAlign: 'center' }}>Chargement...</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e14' }}>
      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: 20, padding: '10px 20px', borderBottom: '1px solid #1a1a2e',
        fontFamily: mono, fontSize: 10, color: '#9ca3af', flexShrink: 0,
      }}>
        <span style={{ color: '#ffd700', fontWeight: 700 }}>TRADE JOURNAL</span>
        <span>{stats.total} trades</span>
        <span>WR: <span style={{ color: parseFloat(stats.winrate) >= 50 ? '#22c55e' : '#ef4444' }}>{stats.winrate}%</span></span>
        <span style={{ color: '#22c55e' }}>TP1: {stats.tp1}</span>
        <span style={{ color: '#22c55e' }}>TP2: {stats.tp2}</span>
        <span style={{ color: '#22c55e' }}>TP3: {stats.tp3}</span>
        <span style={{ color: '#ef4444' }}>SL: {stats.slHits}</span>
        <span style={{ color: '#6b7280' }}>EXP: {stats.expired}</span>
        <span>ΣR: <span style={{ color: stats.sumR >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{stats.sumR >= 0 ? '+' : ''}{stats.sumR.toFixed(2)}R</span></span>
        <button
          onClick={() => {
            setLoading(true);
            fetch('/api/trade-history')
              .then(r => r.json())
              .then((data: ScenarioOutcome[]) => { setTrades(data.reverse()); setLoading(false); })
              .catch(() => setLoading(false));
          }}
          style={{
            marginLeft: 'auto', padding: '2px 10px', background: '#1e293b', border: '1px solid #334155',
            color: '#9ca3af', fontSize: 9, cursor: 'pointer', fontFamily: mono, borderRadius: 2,
          }}
        >REFRESH</button>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '105px 48px 48px 150px 65px 70px 70px 48px 55px 52px 65px 65px',
        padding: '6px 20px', borderBottom: '1px solid #1e293b',
        fontFamily: mono, fontSize: 9, fontWeight: 700, color: '#6b7280', flexShrink: 0,
      }}>
        <span>DATE</span><span>DIR</span><span>SCORE</span><span>TEMPLATE</span>
        <span style={{ textAlign: 'center' }}>IA</span>
        <span style={{ textAlign: 'right' }}>ENTRY</span>
        <span style={{ textAlign: 'right' }}>EXIT</span>
        <span style={{ textAlign: 'center' }}>RESULT</span>
        <span style={{ textAlign: 'right' }}>R</span>
        <span style={{ textAlign: 'center' }}>DUREE</span>
        <span style={{ textAlign: 'right' }}>MFE</span>
        <span style={{ textAlign: 'right' }}>MAE</span>
      </div>

      {/* Trade rows */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {trades.length === 0 ? (
          <div style={{ padding: 40, color: '#4b5563', fontFamily: mono, fontSize: 11, textAlign: 'center' }}>
            Aucun scenario terminé enregistré.
          </div>
        ) : trades.map(t => (
          <div
            key={t.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '105px 48px 48px 150px 65px 70px 70px 48px 55px 52px 65px 65px',
              padding: '5px 20px',
              borderBottom: '1px solid #111827',
              fontFamily: mono, fontSize: 10, color: '#d1d5db',
              alignItems: 'center',
            }}
          >
            <span style={{ color: '#9ca3af' }}>{fmtDate(t.createdAt)}</span>
            <span style={{ color: t.direction === 'LONG' ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{t.direction}</span>
            <span style={{ color: t.adjustedScore >= 40 ? '#ffd700' : '#9ca3af' }}>{t.adjustedScore}</span>
            <span style={{ color: '#8b9dc3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.template}</span>
            <span style={{ textAlign: 'center', color: t.llmVerdict ? LLM_VERDICT_COLORS[t.llmVerdict] ?? '#6b7280' : '#374151', fontWeight: 700 }}>
              {t.llmVerdict ? `${t.llmVerdict.slice(0, 3)} ${t.llmConfidence ?? ''}` : '—'}
            </span>
            <span style={{ textAlign: 'right' }} title={t.activationPrice ? `fill réel (zone mid $${t.entryMid.toFixed(0)})` : 'jamais rempli'}>
              {t.activationPrice ? `$${t.activationPrice.toFixed(0)}` : `($${t.entryMid.toFixed(0)})`}
            </span>
            <span style={{ textAlign: 'right' }}>{t.exitPrice ? `$${t.exitPrice.toFixed(0)}` : '—'}</span>
            <span style={{ textAlign: 'center', color: statusColor(t), fontWeight: 700 }}>{statusLabel(t)}</span>
            <span style={{ textAlign: 'right', fontWeight: 700, color: (realizedR(t) ?? 0) > 0.05 ? '#22c55e' : (realizedR(t) ?? 0) < -0.05 ? '#ef4444' : '#9ca3af' }}>
              {realizedR(t) != null ? `${realizedR(t)! >= 0 ? '+' : ''}${realizedR(t)!.toFixed(2)}` : '—'}
            </span>
            <span style={{ textAlign: 'center', color: '#6b7280' }}>{fmtDuration(t.durationMs)}</span>
            <span style={{ textAlign: 'right', color: '#22c55e' }}>{t.maxFavorableExcursion != null ? `$${t.maxFavorableExcursion.toFixed(0)}` : '—'}</span>
            <span style={{ textAlign: 'right', color: '#ef4444' }}>{t.maxAdverseExcursion != null ? `$${t.maxAdverseExcursion.toFixed(0)}` : '—'}</span>
          </div>
        ))}
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
