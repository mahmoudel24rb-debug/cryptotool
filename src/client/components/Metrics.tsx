import React from 'react';

interface MetricsData {
  tradesPerMinute: number;
  volumePerMinute: number;
  tradesDelta: number;
  liquidationsPerMinute: number;
}

interface MetricsProps {
  metrics: MetricsData;
}

function formatVolume(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}

export default function Metrics({ metrics }: MetricsProps) {
  return (
    <div className="panel p-3 grid grid-cols-2 gap-3">
      <MetricCard
        label="TRADES/m"
        value={metrics.tradesPerMinute.toLocaleString()}
        color="text-cyan-400"
      />
      <MetricCard
        label="VOLUME/m"
        value={formatVolume(metrics.volumePerMinute)}
        color="text-green-400"
      />
      <MetricCard
        label="TRADES Δ/m"
        value={`${metrics.tradesDelta >= 0 ? '+' : ''}${metrics.tradesDelta.toLocaleString()}`}
        color={metrics.tradesDelta >= 0 ? 'text-green-400' : 'text-red-400'}
      />
      <MetricCard
        label="1m LIQUIDATIONS/m"
        value={formatVolume(metrics.liquidationsPerMinute)}
        color="text-red-400"
      />
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-500 text-[0.55rem] tracking-wider font-bold">{label}</span>
      <span className={`${color} text-sm font-bold tabular-nums`}>{value}</span>
    </div>
  );
}
