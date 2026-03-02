import React, { useState, useRef, useEffect } from 'react';

interface Alert {
  id: string;
  type: string;
  market: string;
  exchange: string;
  symbol: string;
  timestamp: number;
  message: string;
  details: Record<string, any>;
}

interface ActivityLogProps {
  alerts: Alert[];
}

const SIGNAL_TYPES = ['SPIKES', 'DIVERGEN', 'ABSORB', 'EXHAUST', 'LIQUIDAT', 'VELOCITY', 'TWAP'] as const;

const SIGNAL_MAP: Record<string, string> = {
  'SPIKES': 'SPIKE',
  'DIVERGEN': 'DIVERGENCE',
  'ABSORB': 'ABSORPTION',
  'EXHAUST': 'EXHAUSTION',
  'LIQUIDAT': 'LIQUIDATION',
  'VELOCITY': 'VELOCITY',
  'TWAP': 'TWAP',
};

const SIGNAL_COLORS: Record<string, string> = {
  ABSORPTION: 'signal-absorption',
  DIVERGENCE: 'signal-divergence',
  EXHAUSTION: 'signal-exhaustion',
  SPIKE: 'signal-spike',
  VELOCITY: 'signal-velocity',
  TWAP: 'signal-twap',
  LIQUIDATION: 'signal-liquidation',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function highlightAmounts(msg: string): React.ReactNode[] {
  // Highlight dollar amounts in the message
  const parts = msg.split(/(\+?\-?\$[\d,.]+[kKmM]?)/g);
  return parts.map((part, i) => {
    if (/^\+?\$/.test(part)) {
      return <span key={i} className="text-green-400 font-semibold">{part}</span>;
    }
    if (/^-\$/.test(part)) {
      return <span key={i} className="text-red-400 font-semibold">{part}</span>;
    }
    if (/^\$/.test(part)) {
      return <span key={i} className="text-yellow-300 font-semibold">{part}</span>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ActivityLog({ alerts }: ActivityLogProps) {
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [showExchangeFilter, setShowExchangeFilter] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll to top (newest alerts first)
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [alerts.length]);

  const toggleFilter = (key: string) => {
    setFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredAlerts = React.useMemo(() => {
    const filtered = alerts.filter(a => {
      if (filters.size === 0) return true;
      for (const f of filters) {
        const signalType = SIGNAL_MAP[f];
        if (signalType && a.type === signalType) return true;
      }
      return false;
    });
    // Only render the most recent 50 for performance (500 DOM nodes = lag)
    return filtered.slice(0, 50);
  }, [alerts, filters]);

  return (
    <div className="flex flex-col h-full panel">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-dark">
        <div className="flex items-center gap-3">
          <span className="text-gray-300 font-bold text-xs tracking-wider">ACTIVITY LOG</span>
          <span className="bg-green-500/20 text-green-400 px-2 py-0.5 text-xs font-bold rounded">
            {alerts.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {SIGNAL_TYPES.map(type => {
            const signalType = SIGNAL_MAP[type];
            const isActive = filters.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleFilter(type)}
                className={`px-2 py-0.5 text-[0.6rem] font-bold tracking-wider border transition-colors ${
                  isActive
                    ? `${SIGNAL_COLORS[signalType]} border-current`
                    : 'text-gray-500 border-gray-700 hover:border-gray-500'
                }`}
              >
                {type}
              </button>
            );
          })}
          <button
            onClick={() => setShowExchangeFilter(!showExchangeFilter)}
            className={`px-2 py-0.5 text-[0.6rem] font-bold tracking-wider border transition-colors ${
              showExchangeFilter
                ? 'text-cyan-400 border-cyan-400 bg-cyan-400/10'
                : 'text-gray-500 border-gray-700 hover:border-gray-500'
            }`}
          >
            EXCHANGES
          </button>
        </div>
      </div>

      {/* Alerts list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onScroll={() => {
          if (scrollRef.current) {
            autoScrollRef.current = scrollRef.current.scrollTop < 10;
          }
        }}
      >
        {filteredAlerts.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs">
            Waiting for signals...
          </div>
        ) : (
          filteredAlerts.map(alert => (
            <div
              key={alert.id}
              className="flex items-start gap-3 px-3 py-1.5 border-b border-border-dark/50 hover:bg-white/[0.02] text-[0.7rem]"
            >
              {/* Market tag */}
              <span className={`shrink-0 ${alert.market === 'SPOT' ? 'tag-spot' : 'tag-perp'}`}>
                {alert.market}
              </span>

              {/* Timestamp */}
              <span className="text-gray-400 tabular-nums shrink-0">
                {formatTime(alert.timestamp)}
              </span>

              {/* Signal type tag */}
              <span className={`shrink-0 px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider ${SIGNAL_COLORS[alert.type]}`}>
                {alert.type}
              </span>

              {/* Exchange:symbol */}
              <span className="text-green-300 font-semibold shrink-0">
                {alert.exchange}:{alert.symbol}
              </span>

              {/* Message */}
              <span className="text-gray-300 truncate">
                {highlightAmounts(alert.message)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
