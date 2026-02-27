import React from 'react';

interface SystemBarProps {
  connected: boolean;
  lastSpike: string | null;
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  trendScore: number;
}

export default function SystemBar({ connected, lastSpike, trend, trendScore }: SystemBarProps) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour12: false });

  // Score bar color: green for positive, red for negative
  const barWidth = Math.min(Math.abs(trendScore), 100);
  const barColor = trendScore > 0 ? '#22c55e' : trendScore < 0 ? '#ef4444' : '#6b7280';

  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-border-dark bg-bg-secondary text-xs">
      <div className="flex items-center gap-3">
        <span className="text-cyan-400 font-bold tracking-wider text-sm">MACKUANT</span>

        {/* Trend badge with score */}
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 font-bold tracking-wide ${
            trend === 'BULL' ? 'text-green-400 bg-green-400/10' :
            trend === 'BEAR' ? 'text-red-400 bg-red-400/10' :
            'text-gray-400 bg-gray-400/10'
          }`}>
            {trend}
          </span>

          {/* Score bar */}
          <div className="flex items-center gap-1.5">
            <div className="w-[60px] h-[6px] bg-gray-800 rounded-full overflow-hidden relative">
              {/* Center line */}
              <div className="absolute left-1/2 top-0 w-px h-full bg-gray-600" />
              {/* Score fill */}
              <div
                className="absolute top-0 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${barWidth / 2}%`,
                  backgroundColor: barColor,
                  left: trendScore >= 0 ? '50%' : undefined,
                  right: trendScore < 0 ? '50%' : undefined,
                }}
              />
            </div>
            <span className={`text-[0.6rem] font-bold tabular-nums ${
              trendScore > 0 ? 'text-green-400' :
              trendScore < 0 ? 'text-red-400' :
              'text-gray-500'
            }`}>
              {trendScore > 0 ? '+' : ''}{trendScore}
            </span>
          </div>
        </div>

        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-gray-500">{connected ? 'LIVE' : 'OFFLINE'}</span>
      </div>

      <div className="flex items-center gap-4 flex-1 mx-8 overflow-hidden">
        {lastSpike && (
          <span className="text-signal-spike truncate text-[0.65rem]">{lastSpike}</span>
        )}
      </div>

      <div className="text-gray-500 tabular-nums">{timeStr}</div>
    </div>
  );
}
