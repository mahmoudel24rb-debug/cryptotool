export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  timestamp: number;       // candle time (seconds)
  candleIndex: number;
  strength: number;        // lookback that confirmed the pivot
  broken: boolean;         // true if price broke through this swing
  brokenAt?: number;       // timestamp when broken
}

export type StructureType = 'BOS' | 'CHoCH';
export type StructureDirection = 'BULLISH' | 'BEARISH';
export type TrendState = 'UPTREND' | 'DOWNTREND' | 'RANGING';

export interface StructureBreak {
  type: StructureType;
  direction: StructureDirection;
  price: number;           // price of the swing that was broken
  breakPrice: number;      // close price of the breaking candle
  timestamp: number;       // time of the breaking candle (seconds)
  swingBroken: SwingPoint;
}

export interface MarketStructureState {
  trend: TrendState;
  lastBOS: StructureBreak | null;
  lastCHoCH: StructureBreak | null;
  swingHighs: SwingPoint[];   // most recent first
  swingLows: SwingPoint[];    // most recent first
  recentBreaks: StructureBreak[]; // last N structure breaks for frontend display
}

export interface SwingDetectorConfig {
  lookback: number;  // candles on each side to confirm a pivot
}

export interface MarketStructureConfig {
  minDisplacementATR: number;  // ATR multiplier for CHoCH validation (e.g. 1.5)
  atrPeriod: number;           // ATR calculation period (e.g. 14)
}

export interface VWAPData {
  vwap: number;
  upperBand1: number;   // +1 std dev
  lowerBand1: number;   // -1 std dev
  upperBand2: number;   // +2 std dev
  lowerBand2: number;   // -2 std dev
  anchorTimestamp: number;
  cumulativeVolume: number;
}

// ── Phase B Types ──

export interface OrderBlock {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  midpoint: number;
  timestamp: number;         // candle time (seconds)
  volume: number;
  delta: number;
  structureBreak: StructureBreak;
  mitigated: boolean;
  mitigatedAt?: number;
  tested: boolean;
  testedAt?: number;
  strength: number;          // 0-100
  timeframe: string;
  hasFVG: boolean;
}

export interface OrderBlockConfig {
  minDisplacementATR: number;
  requireFVG: boolean;
  maxActiveOBs: number;
  autoRemoveMitigated: boolean;
}

export interface FairValueGap {
  id: string;
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  size: number;
  sizePercent: number;
  timestamp: number;
  filled: boolean;
  filledPercent: number;
  filledAt?: number;
  timeframe: string;
}

export interface FVGConfig {
  minSizeATR: number;
  trackFilling: boolean;
  maxActiveFVGs: number;
}

export interface LiquidityPool {
  id: string;
  type: 'BUYSIDE' | 'SELLSIDE';
  level: number;
  strength: number;          // number of touches
  levels: number[];
  timestamps: number[];
  swept: boolean;
  sweptAt?: number;
}

export interface LiquiditySweep {
  id: string;
  type: 'BUYSIDE_SWEEP' | 'SELLSIDE_SWEEP';
  pool: LiquidityPool;
  sweepPrice: number;
  sweepDepth: number;
  timestamp: number;
  reversalDetected: boolean;
}

export interface LiquidityConfig {
  equalLevelThreshold: number;   // % tolerance for equal levels
  minTouches: number;
  sweepConfirmationCandles: number;
}
