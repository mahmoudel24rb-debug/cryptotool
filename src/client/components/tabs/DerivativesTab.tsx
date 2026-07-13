import React, { useRef, useEffect } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import Chart from '../Chart';
import ActivityLog from '../ActivityLog';

const EXCHANGE_SHORT: Record<string, string> = {
  BINANCE_FUTURES: 'BIN',
  BYBIT: 'BYB',
  OKX: 'OKX',
  HYPERLIQUID: 'HYP',
};

export default function DerivativesTab() {
  const { state } = useGlobalState();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Compact chart (context) */}
      <div style={{ height: 200, flexShrink: 0, overflow: 'hidden' }}>
        <Chart
          candlesByExchange={state.candlesByExchange}
          htfCandles={state.htfCandles}
          title="BTC — PRICE CONTEXT"
          vwapData={state.vwapData}
          structureData={state.structureData}
        />
      </div>

      {/* Derivatives panels grid */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, gap: 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <OIPanel data={state.derivativesData} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FundingPanel data={state.derivativesData} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <BasisPanel data={state.derivativesData} />
        </div>
      </div>

      {/* Bottom: Derivatives Activity Log */}
      <div style={{ height: 160, flexShrink: 0, borderTop: '1px solid #1e293b' }}>
        <ActivityLog alerts={state.alerts} />
      </div>
    </div>
  );
}

// ── Open Interest Panel ──
// Backend DerivativesState: { snapshots: [{exchange, openInterest, ...}], aggregateOI, aggregateOIChange, aggregateOIChangePct, ... }
function OIPanel({ data }: { data: any }) {
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

    const pad = 10;
    let y = 8;

    // Header
    ctx.fillStyle = '#ff6b35';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('OPEN INTEREST', pad, y + 12);
    y += 24;

    const snapshots = data?.snapshots;
    if (!snapshots || snapshots.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText('Waiting for OI data...', pad, y + 10);
      return;
    }

    // Filter snapshots with OI > 0
    const oiSnapshots = snapshots.filter((s: any) => s.openInterest > 0);
    if (oiSnapshots.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText('No OI data yet...', pad, y + 10);
      return;
    }

    // Find max for bar scaling
    let maxOI = 0;
    for (const snap of oiSnapshots) {
      if (snap.openInterest > maxOI) maxOI = snap.openInterest;
    }

    // Bars laissent de la place à droite pour le badge Δ 24h.
    const barMaxW = (W - pad * 2) * 0.58;

    // Per-exchange rows
    for (const snap of oiSnapshots) {
      const v = snap.openInterest || 0;
      const d24 = snap.oiDelta24hPct; // % sur 24h glissantes, ou null si pas de baseline

      // Exchange name
      ctx.fillStyle = '#9ca3af';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(snap.exchange.toUpperCase(), pad, y + 10);

      // Value
      ctx.fillStyle = '#e5e7eb';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(formatBigNumber(v), W - pad, y + 10);
      y += 14;

      // Bar
      const barW = maxOI > 0 ? ((v / maxOI) * barMaxW) : 0;
      ctx.fillStyle = '#ff6b3530';
      ctx.fillRect(pad, y, barMaxW, 8);
      ctx.fillStyle = '#ff6b35';
      ctx.fillRect(pad, y, barW, 8);

      // Δ 24h badge, aligné à droite (positions qui se construisent/dénouent)
      if (d24 !== null && d24 !== undefined) {
        ctx.fillStyle = d24 > 0.05 ? '#22c55e' : d24 < -0.05 ? '#ef4444' : '#9ca3af';
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${d24 > 0 ? '+' : ''}${d24.toFixed(1)}% 24h`, W - pad, y + 7);
      }
      y += 16;
    }

    y += 6;

    // Total from aggregate
    const totalOI = data.aggregateOI || 0;
    const totalChange = data.aggregateOIChangePct || 0;
    ctx.fillStyle = '#ff6b35';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL:', pad, y + 10);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(formatBigNumber(totalOI), W - pad, y + 10);
    y += 15;

    // Δ court terme (~1 min) — repère instantané, volontairement discret
    ctx.fillStyle = '#6b7280';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Δ 1m:', pad, y + 8);
    const stColor = totalChange > 0 ? '#4b8f5f' : totalChange < 0 ? '#9f5757' : '#6b7280';
    ctx.fillStyle = stColor;
    ctx.textAlign = 'right';
    ctx.fillText(`${totalChange > 0 ? '+' : ''}${totalChange.toFixed(2)}%`, W - pad, y + 8);
    y += 16;

    // Δ 24h — la vraie lecture : construction vs débouclage
    const d24Agg = data.oiDelta24hPct; // number | null
    const d24Usd = data.oiDelta24h || 0;
    ctx.fillStyle = '#e5e7eb';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Δ 24h:', pad, y + 9);
    if (d24Agg === null || d24Agg === undefined) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('baseline…', W - pad, y + 9);
      y += 15;
    } else {
      const dColor = d24Agg > 0.1 ? '#22c55e' : d24Agg < -0.1 ? '#ef4444' : '#9ca3af';
      ctx.fillStyle = dColor;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'right';
      const usdStr = `${d24Usd >= 0 ? '+' : '-'}${formatBigNumber(Math.abs(d24Usd))}`;
      ctx.fillText(`${d24Agg > 0 ? '+' : ''}${d24Agg.toFixed(2)}%  ${usdStr}`, W - pad, y + 9);
      y += 14;

      // Verdict + couverture
      const verdict = d24Agg > 0.3 ? '» positions se construisent'
        : d24Agg < -0.3 ? '» positions se dénouent'
        : '» positions stables';
      ctx.fillStyle = dColor;
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(verdict, pad, y + 8);
      const cov = Array.isArray(data.oiDelta24hCoverage) ? data.oiDelta24hCoverage : [];
      if (cov.length > 0) {
        ctx.fillStyle = '#4b5563';
        ctx.textAlign = 'right';
        ctx.fillText(cov.map((c: string) => (EXCHANGE_SHORT[c] || c.slice(0, 3))).join('·'), W - pad, y + 8);
      }
      y += 14;
    }

    // ── POSITIONING — Long/Short ratio ──
    const ls = Array.isArray(data.longShort) ? data.longShort : [];
    if (ls.length > 0) {
      y += 4;
      ctx.strokeStyle = '#1f2937';
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();
      y += 8;

      ctx.fillStyle = '#ff6b35';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('POSITIONING — LONG/SHORT', pad, y + 8);
      y += 16;

      for (const l of ls) {
        const ratio = l.ratio || 0;
        const longPct = Math.max(0, Math.min(100, l.longPct || 0));
        // Libellé + ratio
        ctx.fillStyle = '#9ca3af';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(l.label, pad, y + 8);
        ctx.fillStyle = ratio > 1 ? '#22c55e' : ratio < 1 ? '#ef4444' : '#9ca3af';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(ratio.toFixed(2), W - pad, y + 8);
        y += 11;
        // Barre long (vert) / short (rouge)
        const fullW = W - pad * 2;
        const longW = (longPct / 100) * fullW;
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(pad, y, longW, 5);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(pad + longW, y, fullW - longW, 5);
        // Repère 50%
        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(pad + fullW / 2 - 0.5, y, 1, 5);
        y += 12;
      }
    }

  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      const r = parent.getBoundingClientRect();
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ height: '100%', width: '100%', background: '#0a0e14', borderRight: '1px solid #1a1a2e' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

// ── Funding Rate Panel ──
// Backend DerivativesState: { snapshots: [{exchange, fundingRate, nextFundingTime, ...}], avgFundingRate, cascadeRisk, ... }
function FundingPanel({ data }: { data: any }) {
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

    const pad = 10;
    let y = 8;

    ctx.fillStyle = '#ff6b35';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('FUNDING RATE', pad, y + 12);
    y += 24;

    const snapshots = data?.snapshots;
    if (!snapshots || snapshots.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText('Waiting for funding data...', pad, y + 10);
      return;
    }

    // Filter snapshots that have funding rate data
    const fundingSnapshots = snapshots.filter((s: any) => s.fundingRate !== undefined && s.fundingRate !== null);
    if (fundingSnapshots.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText('No funding data yet...', pad, y + 10);
      return;
    }

    const centerX = W / 2;

    // Find max absolute rate for bar scaling
    let maxAbs = 0;
    for (const snap of fundingSnapshots) {
      const rate = snap.fundingRate || 0;
      if (Math.abs(rate) > maxAbs) maxAbs = Math.abs(rate);
    }

    // Per-exchange rows
    for (const snap of fundingSnapshots) {
      const rate = snap.fundingRate || 0;
      const rateColor = rate > 0.0003 ? '#ef4444' : rate > 0.0001 ? '#eab308' : rate < -0.0001 ? '#22c55e' : '#9ca3af';

      ctx.fillStyle = '#9ca3af';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(snap.exchange.toUpperCase(), pad, y + 10);

      ctx.fillStyle = rateColor;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(4)}%`, W - pad, y + 10);
      y += 14;

      // Center-based bar
      const maxBarW = (W - pad * 2) / 2;
      const barW = maxAbs > 0 ? (Math.abs(rate) / maxAbs) * maxBarW : 0;

      ctx.fillStyle = '#1f2937';
      ctx.fillRect(pad, y, W - pad * 2, 6);

      // Center line
      ctx.fillStyle = '#374151';
      ctx.fillRect(centerX - 0.5, y, 1, 6);

      if (rate >= 0) {
        ctx.fillStyle = rateColor;
        ctx.fillRect(centerX, y, barW, 6);
      } else {
        ctx.fillStyle = rateColor;
        ctx.fillRect(centerX - barW, y, barW, 6);
      }
      y += 14;
    }

    y += 8;

    // Average from backend
    const avgRate = data.avgFundingRate || 0;
    const avgColor = avgRate > 0.0003 ? '#ef4444' : avgRate > 0.0001 ? '#eab308' : avgRate < -0.0001 ? '#22c55e' : '#9ca3af';
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Average:', pad, y + 10);
    ctx.fillStyle = avgColor;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${avgRate >= 0 ? '+' : ''}${(avgRate * 100).toFixed(4)}%`, W - pad, y + 10);
    y += 20;

    // Cascade risk level from backend
    const riskLevel = data.cascadeRisk || 'LOW';
    const riskColors: Record<string, string> = {
      LOW: '#22c55e', MEDIUM: '#eab308', HIGH: '#f97316', CRITICAL: '#ef4444',
    };

    ctx.fillStyle = '#9ca3af';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Cascade Risk:', pad, y + 10);

    // Risk bar (4 segments)
    const segW = (W - pad * 2 - 40) / 4;
    const riskIdx = riskLevel === 'LOW' ? 0 : riskLevel === 'MEDIUM' ? 1 : riskLevel === 'HIGH' ? 2 : 3;
    let sx = pad + 90;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i <= riskIdx ? riskColors[['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][i]] : '#1f2937';
      ctx.fillRect(sx, y + 3, segW - 2, 8);
      sx += segW;
    }

    ctx.fillStyle = riskColors[riskLevel] || '#6b7280';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(riskLevel, W - pad, y + 10);

  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      const r = parent.getBoundingClientRect();
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ height: '100%', width: '100%', background: '#0a0e14', borderRight: '1px solid #1a1a2e' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

// ── Basis / Premium Panel ──
// Backend DerivativesState: { basisData: [{exchange, perpPrice, spotPrice, basis, basisPercent, ...}], avgBasisPercent, ... }
function BasisPanel({ data }: { data: any }) {
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

    const pad = 10;
    let y = 8;

    ctx.fillStyle = '#ff6b35';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('BASIS / PREMIUM', pad, y + 12);
    y += 24;

    const basisArr = data?.basisData;
    if (!basisArr || basisArr.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText('Waiting for basis data...', pad, y + 10);
      return;
    }

    let maxAbs = 0;
    for (const bd of basisArr) {
      const bp = bd.basisPercent || 0;
      if (Math.abs(bp) > maxAbs) maxAbs = Math.abs(bp);
    }

    const centerX = W / 2;

    for (const bd of basisArr) {
      const b = bd.basisPercent || 0;
      const bColor = b > 0 ? '#22c55e' : b < 0 ? '#ef4444' : '#6b7280';

      ctx.fillStyle = '#9ca3af';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(bd.exchange.toUpperCase(), pad, y + 10);

      ctx.fillStyle = bColor;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${b >= 0 ? '+' : ''}${b.toFixed(4)}%`, W - pad, y + 10);
      y += 14;

      // Bar
      const maxBarW = (W - pad * 2) / 2;
      const barW = maxAbs > 0 ? (Math.abs(b) / maxAbs) * maxBarW : 0;

      ctx.fillStyle = '#1f2937';
      ctx.fillRect(pad, y, W - pad * 2, 6);
      ctx.fillStyle = '#374151';
      ctx.fillRect(centerX - 0.5, y, 1, 6);

      if (b >= 0) {
        ctx.fillStyle = bColor;
        ctx.fillRect(centerX, y, barW, 6);
      } else {
        ctx.fillStyle = bColor;
        ctx.fillRect(centerX - barW, y, barW, 6);
      }
      y += 14;
    }

    y += 8;

    // Average from backend
    const avgBasis = data.avgBasisPercent || 0;
    const isContango = avgBasis > 0;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Average:', pad, y + 10);
    ctx.fillStyle = isContango ? '#22c55e' : '#ef4444';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${avgBasis >= 0 ? '+' : ''}${avgBasis.toFixed(4)}%`, W - pad, y + 10);
    y += 20;

    // Market state
    ctx.fillStyle = isContango ? '#22c55e' : '#ef4444';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isContango ? 'CONTANGO' : 'BACKWARDATION', W / 2, y + 10);
    y += 14;

    ctx.fillStyle = '#4b5563';
    ctx.font = '8px monospace';
    ctx.fillText(
      isContango ? 'Futures premium (normal)' : 'Futures discount (bearish)',
      W / 2,
      y + 10
    );

  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      const r = parent.getBoundingClientRect();
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ height: '100%', width: '100%', background: '#0a0e14' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

function formatBigNumber(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
