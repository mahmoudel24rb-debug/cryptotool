import React, { useMemo } from 'react';

interface OrderBookData {
  exchange: string;
  market: string;
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  lastUpdate: number;
}

interface OrderBookHeatmapProps {
  orderBooks: Record<string, OrderBookData>;
  side: 'bids' | 'asks';
}

function formatQty(qty: number): string {
  if (qty >= 1000) return `${(qty / 1000).toFixed(1)}K`;
  if (qty >= 1) return qty.toFixed(3);
  return qty.toFixed(5);
}

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export default function OrderBookHeatmap({ orderBooks, side }: OrderBookHeatmapProps) {
  const levels = useMemo(() => {
    const aggregated = new Map<number, { qty: number; exchanges: string[] }>();

    for (const book of Object.values(orderBooks)) {
      const entries = side === 'bids' ? book.bids : book.asks;
      for (const [price, qty] of entries) {
        const rounded = Math.round(price * 10) / 10;
        const existing = aggregated.get(rounded);
        if (existing) {
          existing.qty += qty;
          if (!existing.exchanges.includes(book.exchange)) {
            existing.exchanges.push(book.exchange);
          }
        } else {
          aggregated.set(rounded, { qty, exchanges: [book.exchange] });
        }
      }
    }

    const sorted = Array.from(aggregated.entries()).map(([price, data]) => ({
      price,
      qty: data.qty,
      usdValue: price * data.qty,
      exchanges: data.exchanges,
    }));

    if (side === 'bids') {
      sorted.sort((a, b) => b.price - a.price);
    } else {
      sorted.sort((a, b) => a.price - b.price);
    }

    return sorted.slice(0, 30);
  }, [orderBooks, side]);

  // Use percentile-based intensity for better gradient distribution
  const sortedByQty = useMemo(() => {
    return [...levels].sort((a, b) => a.qty - b.qty);
  }, [levels]);

  const getIntensity = (qty: number): number => {
    if (sortedByQty.length === 0) return 0;
    const idx = sortedByQty.findIndex(l => l.qty >= qty);
    const rank = idx === -1 ? sortedByQty.length - 1 : idx;
    return rank / (sortedByQty.length - 1 || 1);
  };

  const isBid = side === 'bids';

  return (
    <div className="panel flex flex-col h-full">
      <div className="px-2 py-1 border-b border-border-dark text-[0.6rem] text-gray-500 font-bold tracking-wider">
        {isBid ? 'BIDS' : 'ASKS'}
      </div>
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {levels.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-700 text-[0.6rem]">
            No data
          </div>
        ) : (
          levels.map((level) => {
            const intensity = getIntensity(level.qty);
            // Progressive gradient: low=barely visible, high=very saturated
            const alpha = 0.03 + intensity * intensity * 0.45; // quadratic curve for more contrast
            const isWall = intensity > 0.85;
            const isMedium = intensity > 0.5;

            // Color components
            const r = isBid ? 34 : 239;
            const g = isBid ? 197 : 68;
            const b = isBid ? 94 : 68;

            // Bar width as percentage of max
            const barWidth = 5 + intensity * 95;

            return (
              <div
                key={level.price}
                className="relative flex items-center px-2 py-[3px] text-[0.6rem] border-b border-border-dark/20"
                style={{ minHeight: '20px' }}
              >
                {/* Background gradient bar */}
                <div
                  className="absolute top-0 bottom-0"
                  style={{
                    [isBid ? 'right' : 'left']: 0,
                    width: `${barWidth}%`,
                    background: `rgba(${r}, ${g}, ${b}, ${alpha})`,
                  }}
                />

                {/* Content */}
                <div className="relative flex items-center w-full gap-1 z-10">
                  {isWall && (
                    <span className={`text-[0.5rem] ${isBid ? 'text-green-300' : 'text-red-300'} animate-pulse`}>
                      ◆
                    </span>
                  )}
                  <span
                    className="tabular-nums font-medium"
                    style={{
                      color: isWall
                        ? (isBid ? '#86efac' : '#fca5a5')
                        : isMedium
                          ? (isBid ? 'rgba(134,239,172,0.9)' : 'rgba(252,165,165,0.9)')
                          : (isBid ? 'rgba(134,239,172,0.55)' : 'rgba(252,165,165,0.55)'),
                    }}
                  >
                    {formatPrice(level.price)}
                  </span>
                  <span
                    className="ml-auto tabular-nums"
                    style={{
                      color: isWall
                        ? '#e5e7eb'
                        : isMedium ? '#9ca3af' : '#6b7280',
                      fontWeight: isWall ? 600 : 400,
                    }}
                  >
                    {formatQty(level.qty)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
