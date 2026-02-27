export interface DerivativesSnapshot {
  exchange: string;
  symbol: string;
  timestamp: number;
  openInterest: number;         // USD
  openInterestChange: number;   // change since last snapshot
  openInterestChangePct: number;
  fundingRate: number;          // current funding rate (per 8h)
  nextFundingTime: number;      // timestamp of next funding
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
  avgFundingRate: number;
  maxFundingRate: number;
  minFundingRate: number;
  cascadeRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  basisData: BasisData[];
  avgBasisPercent: number;
  lastUpdate: number;
}
