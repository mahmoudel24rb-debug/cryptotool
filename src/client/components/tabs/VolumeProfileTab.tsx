import React, { useRef, useEffect } from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import Chart from '../Chart';
import VolumeProfilePanel from '../VolumeProfilePanel';
import ActivityLog from '../ActivityLog';

export default function VolumeProfileTab() {
  const { state } = useGlobalState();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Chart */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <Chart
            candlesByExchange={state.candlesByExchange}
            htfCandles={state.htfCandles}
            title="BTC — VOLUME PROFILE"
            vwapData={state.vwapData}
            structureData={state.structureData}
          />
        </div>

        {/* Volume Profile (expanded) */}
        <div style={{ width: 250, flexShrink: 0, height: '100%', borderLeft: '1px solid #1e293b' }}>
          <VolumeProfilePanel data={state.volumeProfileData} />
        </div>
      </div>

      {/* Bottom: VWAP details + Volume Activity Log */}
      <div style={{ height: 220, flexShrink: 0, display: 'flex', borderTop: '1px solid #1e293b' }}>
        {/* VWAP Details */}
        <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid #1e293b' }}>
          <VWAPDetails vwapData={state.vwapData} currentPrice={state.currentPrice} />
        </div>

        {/* Profile Stats */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid #1e293b' }}>
          <ProfileStats data={state.volumeProfileData} />
        </div>

        {/* Activity Log */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <ActivityLog alerts={state.alerts} />
        </div>
      </div>
    </div>
  );
}

function VWAPDetails({ vwapData, currentPrice }: { vwapData: any; currentPrice: number }) {
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

    ctx.fillStyle = '#a855f7';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('VWAP DETAILS', pad, y + 12);
    y += 24;

    if (!vwapData || !vwapData.vwap) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText('Waiting for VWAP data...', pad, y + 10);
      return;
    }

    const v = vwapData;
    const lines: [string, number, string][] = [
      ['VWAP', v.vwap, '#ffffff'],
      ['+1\u03C3', v.upperBand1, '#9ca3af'],
      ['-1\u03C3', v.lowerBand1, '#9ca3af'],
      ['+2\u03C3', v.upperBand2, '#6b7280'],
      ['-2\u03C3', v.lowerBand2, '#6b7280'],
    ];

    for (const [label, value, color] of lines) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, pad, y + 10);

      ctx.fillStyle = color;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`$${value.toFixed(1)}`, W - pad, y + 10);
      y += 16;
    }

    y += 8;

    // Position relative to VWAP
    if (currentPrice > 0 && v.vwap > 0) {
      const diff = currentPrice - v.vwap;
      const diffPct = (diff / v.vwap) * 100;
      const isPremium = diff > 0;

      ctx.fillStyle = '#9ca3af';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('Position:', pad, y + 10);

      const posColor = isPremium ? '#ef4444' : '#22c55e';
      const posLabel = isPremium ? 'PREMIUM' : 'DISCOUNT';
      ctx.fillStyle = posColor;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(posLabel, W - pad, y + 10);
      y += 16;

      ctx.fillStyle = posColor;
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${diff >= 0 ? '+' : ''}$${diff.toFixed(1)} (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(3)}%)`, W - pad, y + 10);
    }

  }, [vwapData, currentPrice]);

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
    <div style={{ height: '100%', background: '#0a0e14' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

function ProfileStats({ data }: { data: any }) {
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

    ctx.fillStyle = '#a855f7';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PROFILE STATS', pad, y + 12);
    y += 24;

    if (!data) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText('Waiting for VP data...', pad, y + 10);
      return;
    }

    const stats: [string, string, string][] = [
      ['POC', data.poc ? `$${data.poc.toFixed(0)}` : '—', '#ffd700'],
      ['VAH', data.vah ? `$${data.vah.toFixed(0)}` : '—', '#a855f7'],
      ['VAL', data.val ? `$${data.val.toFixed(0)}` : '—', '#a855f7'],
      ['Delta', data.delta ? (data.delta >= 0 ? `+$${(data.delta / 1e6).toFixed(1)}M` : `-$${(Math.abs(data.delta) / 1e6).toFixed(1)}M`) : '—', data?.delta >= 0 ? '#22c55e' : '#ef4444'],
      ['Volume', data.totalVolume ? `$${(data.totalVolume / 1e6).toFixed(1)}M` : '—', '#e5e7eb'],
    ];

    for (const [label, value, color] of stats) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, pad, y + 10);

      ctx.fillStyle = color;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(value, W - pad, y + 10);
      y += 18;
    }

    y += 8;

    // HVN list
    if (data.hvn && data.hvn.length > 0) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('HVN:', pad, y + 10);
      y += 14;

      for (const h of data.hvn.slice(0, 3)) {
        ctx.fillStyle = '#22c55e';
        ctx.font = '8px monospace';
        ctx.fillText(`  $${h.toFixed(0)}`, pad, y + 9);
        y += 11;
      }
    }

    // LVN list
    if (data.lvn && data.lvn.length > 0) {
      y += 4;
      ctx.fillStyle = '#9ca3af';
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('LVN:', pad, y + 10);
      y += 14;

      for (const l of data.lvn.slice(0, 3)) {
        ctx.fillStyle = '#ef4444';
        ctx.font = '8px monospace';
        ctx.fillText(`  $${l.toFixed(0)}`, pad, y + 9);
        y += 11;
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
    <div style={{ height: '100%', background: '#0a0e14' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
