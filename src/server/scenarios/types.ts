// ── Phase D: Confluence Engine & Trade Scenario Types ──

export interface ConfluenceConfig {
  weights: {
    structure: number;        // BOS/CHoCH (default: 15)
    orderBlock: number;       // OB retest (default: 20)
    fairValueGap: number;     // FVG confluence (default: 10)
    liquiditySweep: number;   // Sweep (default: 20)
    absorption: number;       // ABSORPTION detector (default: 10)
    divergence: number;       // DIVERGENCE detector (default: 8)
    spike: number;            // SPIKE detector (default: 5)
    velocity: number;         // VELOCITY detector (default: 5)
    twap: number;             // TWAP detector (default: 5)
    liquidation: number;      // LIQUIDATION detector (default: 8)
    exhaustion: number;       // EXHAUSTION detector (default: 5)
    fundingExtreme: number;   // Funding rate extreme (default: 8)
    oiDivergence: number;     // OI divergence (default: 8)
    basisExtreme: number;     // Basis extreme (default: 5)
    vwapPosition: number;     // Price discount/premium to VWAP (default: 5)
    volumeProfile: number;    // Price at POC/VAH/VAL (default: 5)
  };
  minScoreForScenario: number;    // default: 30
  highPriorityThreshold: number;  // default: 55
  extremePriorityThreshold: number; // default: 75
  signalTimeWindowMs: number;     // default: 300000 (5 min)
  scenarioExpirationMs: number;   // default: 1800000 (30 min)
  maxActiveScenarios: number;     // default: 5
  minRiskReward: number;          // default: 1.5
  slBufferPercent: number;        // default: 0.1
}

export type ScenarioDirection = 'LONG' | 'SHORT';
export type ScenarioPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
export type ScenarioStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'TP1_HIT'        // TP1 atteint, tracking continue
  | 'TP2_HIT'        // TP2 atteint, tracking continue
  | 'TP3_HIT'        // TP3 atteint, scénario complètement réussi
  | 'TRIGGERED'      // legacy alias for TP1_HIT
  | 'INVALIDATED'
  | 'EXPIRED';

export interface SignalContribution {
  name: string;         // e.g. "CHoCH", "OB Retest", "Absorption", "VWAP Discount"
  weight: number;       // points contributed
  direction: ScenarioDirection;
  timestamp: number;
  details?: string;     // short description
}

export interface TradeScenario {
  id: string;
  templateName: string;         // e.g. "OB Retest après CHoCH"
  templateId: number;           // 1-10
  direction: ScenarioDirection;
  score: number;                // total confluence score
  maxScore: number;             // theoretical max from contributing signals
  priority: ScenarioPriority;
  status: ScenarioStatus;

  // Zones
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskReward: number;           // R:R to TP2

  // Invalidation
  invalidationPrice: number;    // close beyond this = invalidated
  invalidationReason?: string;

  // Contributing signals
  signals: SignalContribution[];

  // Timing
  createdAt: number;
  expiresAt: number;
  updatedAt: number;

  // Context
  timeframe: string;            // primary TF of the setup
  currentPrice: number;

  // Scoring meta (Phase 1.1 + 1.2)
  meta?: {
    rawScore: number;
    trendScore: number;
    trendMultiplier: number;
    adjustedScore: number;
    hasAnchorSignal: boolean;
    clusterBonus: number;
  };

  // TP tracking (Phase 2.3)
  tp1HitTime?: number;
  tp1HitPrice?: number;
  tp2HitTime?: number;
  tp2HitPrice?: number;
  tp3HitTime?: number;
  tp3HitPrice?: number;
  exitPrice?: number;
  exitTime?: number;
  exitReason?: string;

  // Excursion tracking (Phase 4)
  maxFavorableExcursion?: number;
  maxAdverseExcursion?: number;
}

// Signal event fed into the confluence engine
export interface ConfluenceSignal {
  type: string;           // 'STRUCTURE', 'ORDER_BLOCK', 'FVG', 'LIQUIDITY_SWEEP', 'ABSORPTION', etc.
  direction: ScenarioDirection;
  price: number;          // reference price
  zoneLow?: number;       // optional zone bounds
  zoneHigh?: number;
  strength?: number;      // 0-1 normalized
  timeframe?: string;
  timestamp: number;
  details?: Record<string, any>;
}
