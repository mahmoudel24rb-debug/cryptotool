export interface DerivativesSnapshot {
  exchange: string;
  symbol: string;
  timestamp: number;
  openInterest: number;         // USD
  openInterestChange: number;   // change since last snapshot
  openInterestChangePct: number;
  oiDelta24hPct: number | null; // OI change over trailing 24h (null if no baseline)
  fundingRate: number;          // current funding rate (per 8h)
  nextFundingTime: number;      // timestamp of next funding
}

/** Positionnement des comptes : ratio long/short d'une source donnée. */
export interface LongShortData {
  source: string;   // 'BINANCE_GLOBAL' | 'BINANCE_TOP' | 'OKX'
  label: string;    // libellé lisible (ex. « Retail Binance », « Top traders »)
  ratio: number;    // longs / shorts (>1 = plus de longs)
  longPct: number;  // 0..100
  shortPct: number; // 0..100
  timestamp: number;
}

export interface OIAlert {
  type: 'OI_SURGE' | 'OI_FLUSH' | 'OI_DIVERGENCE';
  exchange: string;
  symbol: string;
  oiChange: number;
  oiChangePercent: number;
  priceChange: number;
  priceChangePercent: number;
  interpretation: string;
  timestamp: number;
}

export interface OIConfig {
  pollIntervalMs: number;          // default: 10000
  alertThresholdPercent: number;   // default: 2%
  windowMinutes: number;           // comparison window (default: 5 min)
}

export interface FundingAlert {
  type: 'FUNDING_EXTREME' | 'FUNDING_FLIP' | 'FUNDING_DIVERGENCE';
  exchange: string;
  symbol: string;
  currentRate: number;
  rateAnnualized: number;
  interpretation: string;
  cascadeRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: number;
}

export interface FundingConfig {
  pollIntervalMs: number;                // default: 30000
  extremePositiveThreshold: number;      // default: 0.0005 (0.05% per 8h)
  extremeNegativeThreshold: number;      // default: -0.0003
  flipDetection: boolean;                // default: true
}

export interface BasisData {
  exchange: string;
  perpPrice: number;
  spotPrice: number;
  basis: number;            // perpPrice - spotPrice (USD)
  basisPercent: number;     // basis / spotPrice * 100
  timestamp: number;
}

export interface BasisAlert {
  type: 'BASIS_EXTREME' | 'BASIS_DIVERGENCE' | 'BASIS_FLIP';
  description: string;
  exchanges: BasisData[];
  timestamp: number;
}

export interface BasisConfig {
  updateIntervalMs: number;                     // default: 1000
  extremeThresholdPercent: number;              // default: 0.1
  crossExchangeDivergencePercent: number;       // default: 0.05
}

// Aggregated state sent to frontend
export interface DerivativesState {
  snapshots: DerivativesSnapshot[];
  aggregateOI: number;
  aggregateOIChange: number;
  aggregateOIChangePct: number;
  // Δ OI sur 24h glissantes — reconstruit depuis l'historique REST des exchanges,
  // pas depuis le buffer mémoire (qui ne couvre que ~30 min).
  oiDelta24h: number;            // USD, somme des exchanges couverts
  oiDelta24hPct: number | null;  // % moyen pondéré par l'OI (null si aucune baseline)
  oiDelta24hCoverage: string[];  // exchanges effectivement inclus dans la baseline 24h
  // Positionnement des comptes (ratios long/short)
  longShort: LongShortData[];
  avgLongShortRatio: number;     // moyenne des sources disponibles (0 si aucune)
  avgFundingRate: number;
  maxFundingRate: number;
  minFundingRate: number;
  cascadeRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  basisData: BasisData[];
  avgBasisPercent: number;
  lastUpdate: number;
}
