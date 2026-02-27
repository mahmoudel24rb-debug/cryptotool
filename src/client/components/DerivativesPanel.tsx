import React, { useRef, useEffect } from 'react';

interface BasisData {
  exchange: string;
  perpPrice: number;
  spotPrice: number;
  basis: number;
  basisPercent: number;
  timestamp: number;
}

interface DerivativesState {
  snapshots: {
    exchange: string;
    symbol: string;
    openInterest: number;
    fundingRate: number;
    nextFundingTime: number;
  }[];
  aggregateOI: number;
  aggregateOIChange: number;
  aggregateOIChangePct: number;
  avgFundingRate: number;
  maxFundingRate: number;
  minFundingRate: number;
  cascadeRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  basisData: BasisData[];
  avgBasisPercent: number;
  lastUpdate: number;
}

interface Props {
  data: DerivativesState | null;
}

const RISK_COLORS: Record<string, string> = {
  LOW: '#22c55e',
  MEDIUM: '#eab308',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
};

const EXCHANGE_SHORT: Record<string, string> = {
  BINANCE_FUTURES: 'BIN',
  BYBIT: 'BYB',
  OKX: 'OKX',
  HYPERLIQUID: 'HYP',
  AGGREGATE: 'AGG',
  BINANCE: 'BIN',
  COINBASE: 'CB',
};

function formatUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

export default function DerivativesPanel({ data }: Props) {
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

    // Background
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, W, H);

    if (!data) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for derivatives data...', W / 2, H / 2);
      return;
    }

    let y = 0;
    const lineH = 14;
    const pad = 6;

    // ── Header: DERIVATIVES ──
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, y, W, lineH + pad);
    ctx.fillStyle = '#818cf8';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DERIVATIVES', W / 2, y + lineH);
    y += lineH + pad + 2;

    // ── Section: OPEN INTEREST ──
    ctx.fillStyle = '#6366f1';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('OPEN INTEREST', pad, y + 10);
    y += lineH + 2;

    // Aggregate OI
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px monospace';
    ctx.fillText('Total:', pad, y + 10);
    ctx.fillStyle = '#e5e7eb';
    ctx.textAlign = 'right';
    ctx.fillText(formatUsd(data.aggregateOI), W - pad, y + 10);
    y += lineH;

    // OI Change
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText('Change:', pad, y + 10);
    const oiChgColor = data.aggregateOIChangePct > 0 ? '#22c55e' : data.aggregateOIChangePct < 0 ? '#ef4444' : '#9ca3af';
    ctx.fillStyle = oiChgColor;
    ctx.textAlign = 'right';
    const oiSign = data.aggregateOIChangePct > 0 ? '+' : '';
    ctx.fillText(`${oiSign}${data.aggregateOIChangePct.toFixed(2)}%`, W - pad, y + 10);
    y += lineH;

    // Per-exchange OI bars
    const oiSnapshots = data.snapshots.filter(s => s.openInterest > 0);
    if (oiSnapshots.length > 0) {
      const maxOI = Math.max(...oiSnapshots.map(s => s.openInterest));
      for (const snap of oiSnapshots) {
        const label = EXCHANGE_SHORT[snap.exchange] || snap.exchange.slice(0, 3);
        const barWidth = maxOI > 0 ? ((snap.openInterest / maxOI) * (W - 60)) : 0;

        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'left';
        ctx.font = '8px monospace';
        ctx.fillText(label, pad, y + 9);

        // Bar
        ctx.fillStyle = '#3b82f6';
        ctx.globalAlpha = 0.5;
        ctx.fillRect(30, y + 2, barWidth, 8);
        ctx.globalAlpha = 1;

        // Value
        ctx.fillStyle = '#d1d5db';
        ctx.textAlign = 'right';
        ctx.fillText(formatUsd(snap.openInterest), W - pad, y + 9);
        y += lineH - 2;
      }
    }
    y += 4;

    // ── Separator ──
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    y += 4;

    // ── Section: FUNDING RATE ──
    ctx.fillStyle = '#a78bfa';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('FUNDING RATE', pad, y + 10);

    // Cascade risk badge
    const riskColor = RISK_COLORS[data.cascadeRisk] || '#9ca3af';
    ctx.fillStyle = riskColor;
    ctx.textAlign = 'right';
    ctx.font = 'bold 8px monospace';
    ctx.fillText(data.cascadeRisk, W - pad, y + 10);
    y += lineH + 2;

    // Average
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Avg:', pad, y + 10);
    const avgFColor = data.avgFundingRate > 0 ? '#22c55e' : data.avgFundingRate < 0 ? '#ef4444' : '#9ca3af';
    ctx.fillStyle = avgFColor;
    ctx.textAlign = 'right';
    ctx.fillText(formatRate(data.avgFundingRate), W - pad, y + 10);
    y += lineH;

    // Annualized
    const annualized = data.avgFundingRate * 3 * 365 * 100;
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'left';
    ctx.fillText('Ann.:', pad, y + 10);
    ctx.fillStyle = avgFColor;
    ctx.textAlign = 'right';
    ctx.fillText(`${annualized > 0 ? '+' : ''}${annualized.toFixed(1)}%`, W - pad, y + 10);
    y += lineH;

    // Per-exchange funding
    const fundingSnapshots = data.snapshots.filter(s => s.fundingRate !== 0);
    for (const snap of fundingSnapshots) {
      const label = EXCHANGE_SHORT[snap.exchange] || snap.exchange.slice(0, 3);
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'left';
      ctx.font = '8px monospace';
      ctx.fillText(label, pad, y + 9);

      const fColor = snap.fundingRate > 0 ? '#22c55e' : '#ef4444';
      ctx.fillStyle = fColor;
      ctx.textAlign = 'right';
      ctx.fillText(formatRate(snap.fundingRate), W - pad, y + 9);

      // Visual bar from center
      const centerX = W / 2;
      const maxBarW = (W / 2) - 40;
      const normRate = Math.min(Math.abs(snap.fundingRate) / 0.001, 1); // normalize to 0.1%
      const barW = normRate * maxBarW;
      ctx.fillStyle = fColor;
      ctx.globalAlpha = 0.3;
      if (snap.fundingRate > 0) {
        ctx.fillRect(centerX, y + 2, barW, 7);
      } else {
        ctx.fillRect(centerX - barW, y + 2, barW, 7);
      }
      ctx.globalAlpha = 1;

      y += lineH - 2;
    }
    y += 4;

    // ── Separator ──
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    y += 4;

    // ── Section: BASIS / PREMIUM ──
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('BASIS / PREMIUM', pad, y + 10);
    y += lineH + 2;

    // Average basis
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px monospace';
    ctx.fillText('Avg:', pad, y + 10);
    const avgBColor = data.avgBasisPercent > 0 ? '#22c55e' : data.avgBasisPercent < 0 ? '#ef4444' : '#9ca3af';
    ctx.fillStyle = avgBColor;
    ctx.textAlign = 'right';
    ctx.fillText(`${data.avgBasisPercent > 0 ? '+' : ''}${data.avgBasisPercent.toFixed(4)}%`, W - pad, y + 10);
    y += lineH;

    // Per-exchange basis
    for (const bd of data.basisData) {
      const label = EXCHANGE_SHORT[bd.exchange] || bd.exchange.slice(0, 3);
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'left';
      ctx.font = '8px monospace';
      ctx.fillText(label, pad, y + 9);

      const bColor = bd.basisPercent > 0 ? '#22c55e' : '#ef4444';
      ctx.fillStyle = bColor;
      ctx.textAlign = 'right';
      ctx.fillText(`${bd.basisPercent > 0 ? '+' : ''}${bd.basisPercent.toFixed(4)}%`, W - pad, y + 9);

      // Basis USD
      ctx.fillStyle = '#6b7280';
      const basisUsd = bd.basis > 0 ? `+$${bd.basis.toFixed(1)}` : `-$${Math.abs(bd.basis).toFixed(1)}`;
      ctx.textAlign = 'right';
      ctx.fillText(basisUsd, W - 55, y + 9);

      y += lineH - 2;
    }

    if (data.basisData.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Need spot+perp data', W / 2, y + 9);
      y += lineH;
    }

    y += 6;

    // ── Interpretation ──
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    y += 6;

    ctx.font = '8px monospace';
    ctx.textAlign = 'center';

    // Market interpretation
    const avgF = data.avgFundingRate;
    const avgB = data.avgBasisPercent;
    let interpretation = '';
    let interpColor = '#9ca3af';

    if (avgF > 0.0005 && avgB > 0.05) {
      interpretation = 'OVERLEVERAGED LONGS';
      interpColor = '#ef4444';
    } else if (avgF < -0.0003 && avgB < -0.03) {
      interpretation = 'PANIC / SHORT SQUEEZE';
      interpColor = '#f97316';
    } else if (avgF > 0.0002 && avgB > 0) {
      interpretation = 'BULLISH SENTIMENT';
      interpColor = '#22c55e';
    } else if (avgF < -0.0001 && avgB < 0) {
      interpretation = 'BEARISH SENTIMENT';
      interpColor = '#ef4444';
    } else if (Math.abs(avgF) < 0.0001) {
      interpretation = 'NEUTRAL / BALANCED';
      interpColor = '#6b7280';
    } else {
      interpretation = 'MIXED SIGNALS';
      interpColor = '#eab308';
    }

    ctx.fillStyle = interpColor;
    ctx.font = 'bold 9px monospace';
    ctx.fillText(interpretation, W / 2, y + 10);

  }, [data]);

  // Resize observer
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
    <div className="h-full w-full overflow-hidden" style={{ background: '#0a0e14' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
