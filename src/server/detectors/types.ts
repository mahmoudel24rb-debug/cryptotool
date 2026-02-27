export type SignalType = 'ABSORPTION' | 'DIVERGENCE' | 'EXHAUSTION' | 'SPIKE' | 'VELOCITY' | 'TWAP' | 'LIQUIDATION';

export interface Alert {
  id: string;
  type: SignalType;
  market: string;       // "SPOT" or "PERP"
  exchange: string;
  symbol: string;
  timestamp: number;
  message: string;
  details: Record<string, any>;
}

let alertCounter = 0;

export function createAlert(
  type: SignalType,
  exchange: string,
  market: string,
  symbol: string,
  message: string,
  details: Record<string, any> = {},
): Alert {
  return {
    id: `${type}-${++alertCounter}-${Date.now()}`,
    type,
    market,
    exchange,
    symbol,
    timestamp: Date.now(),
    message,
    details,
  };
}

export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}
