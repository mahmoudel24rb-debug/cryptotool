import React, { useState, useEffect, useRef } from 'react';

interface Props {
  connected: boolean;
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  trendScore: number;
  currentPrice: number;
  tradesPerMinute: number;
  volumePerMinute: number;
}

function formatVolume(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

export default function GlobalStatusBar({
  connected,
  trend,
  trendScore,
  currentPrice,
  tradesPerMinute,
  volumePerMinute,
}: Props) {
  const [timeStr, setTimeStr] = useState('');
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef(currentPrice);

  // Clock
  useEffect(() => {
    const tick = () => setTimeStr(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Price flash
  useEffect(() => {
    if (currentPrice > prevPriceRef.current) setPriceFlash('up');
    else if (currentPrice < prevPriceRef.current) setPriceFlash('down');
    prevPriceRef.current = currentPrice;

    const t = setTimeout(() => setPriceFlash(null), 400);
    return () => clearTimeout(t);
  }, [currentPrice]);

  const trendColor = trend === 'BULL' ? '#22c55e' : trend === 'BEAR' ? '#ef4444' : '#6b7280';
  const barWidth = Math.min(Math.abs(trendScore), 100);
  const barColor = trendScore > 0 ? '#22c55e' : trendScore < 0 ? '#ef4444' : '#6b7280';

  return (
    <div
      style={{
        height: 32,
        background: '#080808',
        borderBottom: '1px solid #1a1a2e',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 16,
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', 'Source Code Pro', monospace",
        fontSize: 11,
      }}
    >
      {/* MACKUANT logo */}
      <span style={{ color: '#00d4ff', fontWeight: 700, fontSize: 13, letterSpacing: 2 }}>
        MACKUANT
      </span>

      {/* Trend badge */}
      <span
        style={{
          color: trendColor,
          background: `${trendColor}18`,
          padding: '1px 8px',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: 1,
        }}
      >
        {trend}
      </span>

      {/* Score bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            width: 60,
            height: 6,
            background: '#1f2937',
            borderRadius: 3,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: '#374151' }} />
          <div
            style={{
              position: 'absolute',
              top: 0,
              height: '100%',
              width: `${barWidth / 2}%`,
              background: barColor,
              borderRadius: 3,
              transition: 'all 500ms',
              ...(trendScore >= 0 ? { left: '50%' } : { right: '50%' }),
            }}
          />
        </div>
        <span style={{ color: barColor, fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {trendScore > 0 ? '+' : ''}{trendScore}
        </span>
      </div>

      {/* LIVE indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: connected ? '#22c55e' : '#ef4444',
            animation: connected ? 'livePulse 2s ease-in-out infinite' : undefined,
          }}
        />
        <span style={{ color: connected ? '#22c55e' : '#ef4444', fontSize: 10, fontWeight: 700 }}>
          {connected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      {/* BTC Price */}
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: priceFlash === 'up' ? '#22c55e' : priceFlash === 'down' ? '#ef4444' : '#e5e7eb',
          transition: 'color 150ms',
        }}
      >
        BTC ${currentPrice > 0 ? currentPrice.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
      </span>

      {/* Separator */}
      <div style={{ width: 1, height: 16, background: '#1a1a2e' }} />

      {/* Quick metrics */}
      <div style={{ display: 'flex', gap: 14, color: '#9ca3af', fontSize: 10 }}>
        <span>
          <span style={{ color: '#00d4ff' }}>{tradesPerMinute.toLocaleString()}</span> T/m
        </span>
        <span>
          <span style={{ color: '#22c55e' }}>{formatVolume(volumePerMinute)}</span>/m
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Clock */}
      <span style={{ color: '#6b7280', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
        {timeStr}
      </span>
    </div>
  );
}
