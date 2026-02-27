import React, { useRef, useEffect } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import Chart from '../Chart';
import ActivityLog from '../ActivityLog';

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

    // Per-exchange rows
    for (const snap of oiSnapshots) {
      const v = snap.openInterest || 0;
      const changePct = snap.openInterestChangePct || 0;

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
      const barW = maxOI > 0 ? ((v / maxOI) * (W - pad * 2)) : 0;
      ctx.fillStyle = '#ff6b3530';
      ctx.fillRect(pad, y, W - pad * 2, 8);
      ctx.fillStyle = '#ff6b35';
      ctx.fillRect(pad, y, barW, 8);

      // Change badge
      if (changePct !== 0) {
        const changeColor = changePct > 0 ? '#22c55e' : '#ef4444';
        const changeStr = `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%`;
        ctx.fillStyle = changeColor;
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(changeStr, pad + barW + 4, y + 7);
      }
      y += 16;
    }

    y += 8;

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

    if (totalChange !== 0) {
      y += 16;
      const changeColor = totalChange > 0 ? '#22c55e' : '#ef4444';
      ctx.fillStyle = changeColor;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${totalChange > 0 ? '+' : ''}${totalChange.toFixed(2)}%`, pad, y + 10);
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
