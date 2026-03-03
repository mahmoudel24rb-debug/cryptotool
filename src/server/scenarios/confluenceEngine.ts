import {
  ConfluenceConfig,
  ConfluenceSignal,
  TradeScenario,
  ScenarioDirection,
  ScenarioPriority,
  ScenarioStatus,
  SignalContribution,
} from './types';
import { matchTemplate, ScenarioTemplate } from './scenarioTemplates';
import { appendFileSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';

// ═══════════════════════════════════════════════════════════════
// Configurable constants — all tunables in one place
// ═══════════════════════════════════════════════════════════════

export const SCENARIO_CONFIG = {
  // Phase 1.1 — Trend integration
  TREND_ALIGNED_MAX_BOOST: 0.25,     // +25% max si parfaitement aligné
  TREND_COUNTER_MAX_PENALTY: 0.40,   // -40% max si fortement contre-tendance

  // Phase 1.2 — Strength weighting
  MIN_STRENGTH_FLOOR: 0.3,           // signal ne peut valoir < 30% de son poids

  // Phase 1.5 — Contra penalty (progressive)
  CONTRA_PENALTY_HIGH: 0.70,         // signaux poids >= 15
  CONTRA_PENALTY_MEDIUM: 0.50,       // signaux poids >= 8
  CONTRA_PENALTY_LOW: 0.30,          // signaux poids < 8

  // Phase 2.3 — Trailing SL
  TRAILING_SL_ENABLED: true,

  // Phase 3.1 — Scoring avancé
  DECAY_RATE: 0.7,
  TF_MULTIPLIERS: { '1m': 0.6, '5m': 1.0, '15m': 1.4, '1h': 1.6 } as Record<string, number>,
  PROXIMITY_MAX_DISTANCE: 0.01,      // 1% max distance for proximity factor

  // Phase 3.2 — Clustering temporel
  CLUSTER_WINDOW_MS: 30_000,         // 30 secondes
  CLUSTER_BONUS_HIGH: 10,            // 3+ paires dans la fenêtre
  CLUSTER_BONUS_LOW: 5,              // 1-2 paires

  // Phase 3.3 — Signal anchor minimum
  MINIMUM_ANCHOR_WEIGHT: 15,         // au moins 1 signal poids >= 15 (OB, SWEEP, STRUCTURE)

  // Counter-trend blocking
  TREND_HARD_BLOCK_THRESHOLD: 60,    // |trendScore| above → block ALL counter-trend
  TREND_SOFT_BLOCK_THRESHOLD: 30,    // |trendScore| above → require high rawScore for counter-trend
  COUNTER_TREND_MIN_RAW_SCORE: 50,   // minimum rawScore for counter-trend in moderate trend

  // Cross-template deduplication
  DEDUP_OVERLAP_THRESHOLD: 0.5,      // 50% entry zone overlap = same trade

  // SL cooldown after stop-loss hit
  SL_COOLDOWN_MS: 300_000,           // 5 min cooldown after SL
  SL_COOLDOWN_OVERRIDE_SCORE: 55,    // HIGH score can bypass cooldown

  // ATR-based stop loss
  SL_MODE: 'ATR' as 'ATR' | 'FIXED',
  ATR_SL_MULTIPLIER: 1.0,
  MIN_SL_BUFFER_PCT: 0.001,          // 0.1% floor

  // Entry & TP
  ENTRY_BUFFER_PCT: 0.0015,          // 0.15% entry buffer
  TP1_MULTIPLIER: 1.0,
  TP2_MULTIPLIER: 2.0,
  TP3_MULTIPLIER: 3.5,

  // Phase 1.4 — TTL par type de signal (ms)
  SIGNAL_TTL_MS: {
    ORDER_BLOCK:      15 * 60 * 1000,
    FVG:              15 * 60 * 1000,
    LIQUIDITY_SWEEP:  10 * 60 * 1000,
    STRUCTURE:        10 * 60 * 1000,
    BOS:              10 * 60 * 1000,
    CHoCH:            10 * 60 * 1000,
    OB_RETEST:        15 * 60 * 1000,
    FVG_FILL:         15 * 60 * 1000,
    SWEEP:            10 * 60 * 1000,
    FUNDING_EXTREME:   8 * 60 * 1000,
    FUNDING:           8 * 60 * 1000,
    OI_SURGE:          8 * 60 * 1000,
    OI_FLUSH:          8 * 60 * 1000,
    OI_DIVERGENCE:     8 * 60 * 1000,
    BASIS_EXTREME:     5 * 60 * 1000,
    BASIS:             5 * 60 * 1000,
    ABSORPTION:        5 * 60 * 1000,
    DIVERGENCE:        5 * 60 * 1000,
    SPIKE:             2 * 60 * 1000,
    VELOCITY:          2 * 60 * 1000,
    EXHAUSTION:        3 * 60 * 1000,
    TWAP:              5 * 60 * 1000,
    LIQUIDATION:       3 * 60 * 1000,
    VWAP_POSITION:     5 * 60 * 1000,
    VWAP:              5 * 60 * 1000,
    VOLUME_PROFILE:    5 * 60 * 1000,
    POC:               5 * 60 * 1000,
  } as Record<string, number>,
  DEFAULT_SIGNAL_TTL_MS: 5 * 60 * 1000,

  // Phase 4 — Logging
  SCENARIO_LOG_PATH: './data/scenario_outcomes.jsonl',
  ACTIVE_SCENARIOS_PATH: './data/active_scenarios.json',
  STATE_SAVE_INTERVAL_MS: 30_000, // save active scenarios every 30s
};

const DEFAULT_CONFIG: ConfluenceConfig = {
  weights: {
    structure: 15,
    orderBlock: 20,
    fairValueGap: 10,
    liquiditySweep: 20,
    absorption: 10,
    divergence: 5,
    spike: 5,
    velocity: 5,
    twap: 5,
    liquidation: 8,
    exhaustion: 5,
    fundingExtreme: 8,
    oiDivergence: 8,
    basisExtreme: 5,
    vwapPosition: 5,
    volumeProfile: 5,
  },
  minScoreForScenario: 40,
  highPriorityThreshold: 60,
  extremePriorityThreshold: 75,
  signalTimeWindowMs: 300000,       // fallback, overridden by per-signal TTL
  scenarioExpirationMs: 1800000,
  maxActiveScenarios: 3,
  minRiskReward: 1.5,
  slBufferPercent: 0.2,             // Phase 2.1: 0.1 → 0.2%
};

// Map signal types to weight keys
const SIGNAL_WEIGHT_MAP: Record<string, keyof ConfluenceConfig['weights']> = {
  'STRUCTURE': 'structure',
  'BOS': 'structure',
  'CHoCH': 'structure',
  'ORDER_BLOCK': 'orderBlock',
  'OB_RETEST': 'orderBlock',
  'FVG': 'fairValueGap',
  'FVG_FILL': 'fairValueGap',
  'LIQUIDITY_SWEEP': 'liquiditySweep',
  'SWEEP': 'liquiditySweep',
  'ABSORPTION': 'absorption',
  'DIVERGENCE': 'divergence',
  'SPIKE': 'spike',
  'VELOCITY': 'velocity',
  'TWAP': 'twap',
  'LIQUIDATION': 'liquidation',
  'EXHAUSTION': 'exhaustion',
  'FUNDING_EXTREME': 'fundingExtreme',
  'FUNDING': 'fundingExtreme',
  'OI_SURGE': 'oiDivergence',
  'OI_FLUSH': 'oiDivergence',
  'OI_DIVERGENCE': 'oiDivergence',
  'OI': 'oiDivergence',
  'BASIS_EXTREME': 'basisExtreme',
  'BASIS': 'basisExtreme',
  'VWAP_POSITION': 'vwapPosition',
  'VWAP': 'vwapPosition',
  'VOLUME_PROFILE': 'volumeProfile',
  'POC': 'volumeProfile',
};

// ═══════════════════════════════════════════════════════════════
// Helper: progressive contra penalty (Phase 1.5)
// ═══════════════════════════════════════════════════════════════

function getContraPenaltyRatio(signalWeight: number): number {
  if (signalWeight >= 15) return SCENARIO_CONFIG.CONTRA_PENALTY_HIGH;
  if (signalWeight >= 8)  return SCENARIO_CONFIG.CONTRA_PENALTY_MEDIUM;
  return SCENARIO_CONFIG.CONTRA_PENALTY_LOW;
}

// ═══════════════════════════════════════════════════════════════
// Helper: temporal cluster bonus (Phase 3.2)
// ═══════════════════════════════════════════════════════════════

function computeTemporalClusterBonus(signals: ConfluenceSignal[]): number {
  if (signals.length < 2) return 0;
  const sorted = [...signals].sort((a, b) => a.timestamp - b.timestamp);
  let clusterPairs = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].timestamp - sorted[i].timestamp <= SCENARIO_CONFIG.CLUSTER_WINDOW_MS) {
        clusterPairs++;
      }
    }
  }
  if (clusterPairs >= 3) return SCENARIO_CONFIG.CLUSTER_BONUS_HIGH;
  if (clusterPairs >= 1) return SCENARIO_CONFIG.CLUSTER_BONUS_LOW;
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// Helper: anchor signal check (Phase 3.3)
// ═══════════════════════════════════════════════════════════════

function hasAnchorSignal(
  signals: ConfluenceSignal[],
  direction: ScenarioDirection,
  weights: ConfluenceConfig['weights'],
): boolean {
  return signals.some(s => {
    if (s.direction !== direction) return false;
    const weightKey = SIGNAL_WEIGHT_MAP[s.type];
    const weight = weightKey ? weights[weightKey] : 5;
    return weight >= SCENARIO_CONFIG.MINIMUM_ANCHOR_WEIGHT;
  });
}

// ═══════════════════════════════════════════════════════════════
// Trend provider interface (injected from engine.ts)
// ═══════════════════════════════════════════════════════════════

export interface TrendProvider {
  analyze(): { trend: string; score: number };
}

/**
 * Confluence Engine — event-driven scoring system.
 * Collects signals, groups them by price zone, matches templates,
 * and emits trade scenarios when confluence is high enough.
 */
export class ConfluenceEngine {
  private config: ConfluenceConfig;
  private signals: ConfluenceSignal[] = [];
  private activeScenarios: TradeScenario[] = [];
  private scenarioCallback: ((event: string, scenario: TradeScenario) => void) | null = null;
  private currentPrice = 0;
  private currentATR = 0;
  private lastSLTimestamp: Record<string, number> = { LONG: 0, SHORT: 0 };
  private trendProvider: TrendProvider | null = null;

  constructor(config: Partial<ConfluenceConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      weights: { ...DEFAULT_CONFIG.weights, ...(config.weights || {}) },
    };
  }

  /** Inject the TrendAnalyzer for trend-aligned scoring (Phase 1.1) */
  setTrendProvider(provider: TrendProvider): void {
    this.trendProvider = provider;
  }

  onScenario(cb: (event: string, scenario: TradeScenario) => void): void {
    this.scenarioCallback = cb;
  }

  updateConfig(config: Partial<ConfluenceConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      weights: { ...this.config.weights, ...(config.weights || {}) },
    };
  }

  updatePrice(price: number): void {
    this.currentPrice = price;
  }

  updateATR(atr: number): void {
    if (atr > 0) this.currentATR = atr;
  }

  /** Feed a new signal into the engine — triggers evaluation */
  addSignal(signal: ConfluenceSignal): void {
    this.signals.push(signal);
    this.pruneOldSignals();
    this.evaluate();
  }

  /** Periodic tick — check expirations and lifecycle */
  tick(): void {
    this.pruneOldSignals();
    this.updateScenarioLifecycle();
  }

  getActiveScenarios(): TradeScenario[] {
    return this.activeScenarios.filter(s =>
      s.status === 'PENDING' || s.status === 'ACTIVE' ||
      s.status === 'TRIGGERED' || s.status === 'TP1_HIT' ||
      s.status === 'TP2_HIT'
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1.4: TTL differentiated by signal type
  // ═══════════════════════════════════════════════════════════

  private pruneOldSignals(): void {
    const now = Date.now();
    this.signals = this.signals.filter(s => {
      const ttl = SCENARIO_CONFIG.SIGNAL_TTL_MS[s.type] ?? SCENARIO_CONFIG.DEFAULT_SIGNAL_TTL_MS;
      return (now - s.timestamp) <= ttl;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Main evaluation pipeline
  // ═══════════════════════════════════════════════════════════

  private evaluate(): void {
    if (this.currentPrice <= 0) return;

    // Group signals by price zone (within 0.3% of each other)
    const zones = this.groupSignalsByZone();

    for (const zone of zones) {
      // Determine direction
      const direction = this.determineDirection(zone);
      if (!direction) continue;

      // Phase 3.3: Require at least one anchor signal (weight >= 10)
      if (!hasAnchorSignal(zone, direction, this.config.weights)) continue;

      // Calculate score (Phase 1.2 strength + Phase 1.5 contra + Phase 3.1 decay/proximity)
      const { score: rawScore, maxScore, contributions } = this.calculateScore(zone, direction);

      // Phase 3.2: Temporal cluster bonus
      const clusterBonus = computeTemporalClusterBonus(zone);
      const scoreWithCluster = rawScore + clusterBonus;

      // Phase 1.1: Apply trend multiplier
      const { adjustedScore, trendScore, trendMultiplier } = this.applyTrendMultiplier(
        scoreWithCluster, direction,
      );

      // Counter-trend blocking (TIER 1.2)
      const isCounter = (direction === 'LONG' && trendScore < 0) || (direction === 'SHORT' && trendScore > 0);
      if (isCounter) {
        const absTrend = Math.abs(trendScore);
        // Hard block: strong trend → no counter-trend at all
        if (absTrend > SCENARIO_CONFIG.TREND_HARD_BLOCK_THRESHOLD) continue;
        // Soft block: moderate trend → require high raw confluence
        if (absTrend > SCENARIO_CONFIG.TREND_SOFT_BLOCK_THRESHOLD && rawScore < SCENARIO_CONFIG.COUNTER_TREND_MIN_RAW_SCORE) continue;
      }

      if (adjustedScore < this.config.minScoreForScenario) continue;

      // SL cooldown check (TIER 3.2)
      const timeSinceLastSL = Date.now() - (this.lastSLTimestamp[direction] || 0);
      if (timeSinceLastSL < SCENARIO_CONFIG.SL_COOLDOWN_MS && adjustedScore < SCENARIO_CONFIG.SL_COOLDOWN_OVERRIDE_SCORE) continue;

      // Try to match a template
      const template = matchTemplate(zone, direction, contributions);
      if (!template) continue;

      // Check if we already have a similar scenario (same template)
      if (this.isDuplicate(template, direction)) continue;

      // Build the scenario
      const scenario = this.buildScenario(
        template, direction, adjustedScore, maxScore, contributions, zone,
      );
      if (!scenario) continue;

      // Cross-template dedup by entry zone overlap (TIER 3.1)
      if (this.isDuplicateByZone(direction, scenario.entryLow, scenario.entryHigh, adjustedScore)) continue;

      // Attach scoring meta
      scenario.meta = {
        rawScore,
        trendScore,
        trendMultiplier,
        adjustedScore,
        hasAnchorSignal: true,
        clusterBonus,
      };

      // Check R:R
      if (scenario.riskReward < this.config.minRiskReward) continue;

      // Check max active
      const active = this.getActiveScenarios();
      if (active.length >= this.config.maxActiveScenarios) {
        // Replace lowest score if new is higher
        const lowest = active.reduce((min, s) => s.score < min.score ? s : min, active[0]);
        if (adjustedScore <= lowest.score) continue;
        lowest.status = 'INVALIDATED';
        lowest.invalidationReason = 'Replaced by higher-score scenario';
        this.emit('scenario:invalidated', lowest);
        this.logOutcome(lowest);
        this.activeScenarios = this.activeScenarios.filter(s => s.id !== lowest.id);
      }

      this.activeScenarios.push(scenario);
      console.log(`[SCENARIO] NEW ${scenario.direction} "${scenario.templateName}" | raw=${rawScore} trend=${trendScore} mult=${trendMultiplier.toFixed(2)} adj=${adjustedScore} cluster=${clusterBonus} | R:R=${scenario.riskReward} | signals: ${contributions.map(c => c.name).join(', ')}`);
      this.emit('scenario:new', scenario);
    }
  }

  private groupSignalsByZone(): ConfluenceSignal[][] {
    if (this.signals.length === 0) return [];

    // Sort by price
    const sorted = [...this.signals].sort((a, b) => a.price - b.price);
    const zones: ConfluenceSignal[][] = [];
    let currentZone: ConfluenceSignal[] = [sorted[0]];
    let zoneCenter = sorted[0].price;

    for (let i = 1; i < sorted.length; i++) {
      const sig = sorted[i];
      const diff = Math.abs(sig.price - zoneCenter) / zoneCenter;
      if (diff < 0.003) { // within 0.3%
        currentZone.push(sig);
        zoneCenter = currentZone.reduce((s, c) => s + c.price, 0) / currentZone.length;
      } else {
        if (currentZone.length >= 2) zones.push(currentZone);
        currentZone = [sig];
        zoneCenter = sig.price;
      }
    }
    if (currentZone.length >= 2) zones.push(currentZone);

    // Also try evaluating ALL signals within 1% of current price
    const nearPrice = this.signals.filter(s =>
      Math.abs(s.price - this.currentPrice) / this.currentPrice < 0.01
    );
    if (nearPrice.length >= 2) {
      const isNew = !zones.some(z =>
        z.length === nearPrice.length && z.every((s, i) => s === nearPrice[i])
      );
      if (isNew) zones.push(nearPrice);
    }

    return zones;
  }

  private determineDirection(signals: ConfluenceSignal[]): ScenarioDirection | null {
    let bullish = 0;
    let bearish = 0;
    for (const sig of signals) {
      const weightKey = SIGNAL_WEIGHT_MAP[sig.type];
      const weight = weightKey ? this.config.weights[weightKey] : 5;
      if (sig.direction === 'LONG') bullish += weight;
      else bearish += weight;
    }
    if (bullish === 0 && bearish === 0) return null;
    if (bullish > bearish) return 'LONG';
    if (bearish > bullish) return 'SHORT';
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1.2 + 1.5 + 3.1: Scoring with strength, decay,
  // proximity, TF multiplier, and progressive contra penalty
  // ═══════════════════════════════════════════════════════════

  private calculateScore(
    signals: ConfluenceSignal[],
    direction: ScenarioDirection,
  ): { score: number; maxScore: number; contributions: SignalContribution[] } {
    const contributions: SignalContribution[] = [];
    // Track best signal per weight key (for deduplication: keep highest strength)
    const bestByWeightKey = new Map<string, { signal: ConfluenceSignal; effectiveScore: number; weight: number }>();
    let score = 0;
    let maxScore = 0;
    const now = Date.now();

    for (const sig of signals) {
      const weightKey = SIGNAL_WEIGHT_MAP[sig.type] || 'spike';
      const weight = this.config.weights[weightKey] || 5;
      maxScore += weight;

      if (sig.direction === direction) {
        // Phase 3.1: Compute continuous score for this signal
        const effectiveScore = this.computeSignalScore(sig, weight, now);

        // Deduplication: keep the best signal per weight key
        const existing = bestByWeightKey.get(weightKey);
        if (!existing || effectiveScore > existing.effectiveScore) {
          bestByWeightKey.set(weightKey, { signal: sig, effectiveScore, weight });
        }
      } else {
        // Contra signal — Phase 1.5: progressive penalty
        const strength = Math.max(SCENARIO_CONFIG.MIN_STRENGTH_FLOOR, sig.strength ?? 1.0);
        const penaltyRatio = getContraPenaltyRatio(weight);
        score -= Math.floor(weight * strength * penaltyRatio);
      }
    }

    // Sum up best signal per category
    for (const [, entry] of bestByWeightKey) {
      score += entry.effectiveScore;
      contributions.push({
        name: entry.signal.type,
        weight: entry.effectiveScore,
        direction: entry.signal.direction,
        timestamp: entry.signal.timestamp,
        details: entry.signal.details?.description || entry.signal.details?.interpretation || undefined,
      });
    }

    return { score: Math.max(0, score), maxScore, contributions };
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3.1: Continuous signal score (strength * decay * proximity * TF)
  // ═══════════════════════════════════════════════════════════

  private computeSignalScore(signal: ConfluenceSignal, baseWeight: number, now: number): number {
    // 1. Strength (Phase 1.2)
    const strength = Math.max(SCENARIO_CONFIG.MIN_STRENGTH_FLOOR, signal.strength ?? 1.0);

    // 2. Temporal decay: signal loses value as it ages
    const ttl = SCENARIO_CONFIG.SIGNAL_TTL_MS[signal.type] ?? SCENARIO_CONFIG.DEFAULT_SIGNAL_TTL_MS;
    const age = now - signal.timestamp;
    const decay = Math.max(0, 1.0 - (age / ttl) * SCENARIO_CONFIG.DECAY_RATE);

    // 3. Proximity to current price
    const distance = this.currentPrice > 0
      ? Math.abs(signal.price - this.currentPrice) / this.currentPrice
      : 0;
    const proximity = Math.max(0, 1.0 - (distance / SCENARIO_CONFIG.PROXIMITY_MAX_DISTANCE));

    // 4. Timeframe multiplier
    const tfMultiplier = SCENARIO_CONFIG.TF_MULTIPLIERS[signal.timeframe || '1m'] ?? 1.0;

    return Math.round(baseWeight * strength * decay * proximity * tfMultiplier);
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1.1: Trend multiplier
  // ═══════════════════════════════════════════════════════════

  private applyTrendMultiplier(
    score: number,
    direction: ScenarioDirection,
  ): { adjustedScore: number; trendScore: number; trendMultiplier: number } {
    if (!this.trendProvider) {
      return { adjustedScore: score, trendScore: 0, trendMultiplier: 1.0 };
    }

    const { score: trendScore } = this.trendProvider.analyze();

    const isAligned = (direction === 'LONG' && trendScore > 0)
                   || (direction === 'SHORT' && trendScore < 0);
    const isCounter = (direction === 'LONG' && trendScore < 0)
                   || (direction === 'SHORT' && trendScore > 0);

    let trendMultiplier = 1.0;
    if (isAligned) {
      trendMultiplier = 1.0 + (Math.abs(trendScore) / 100) * SCENARIO_CONFIG.TREND_ALIGNED_MAX_BOOST;
    } else if (isCounter) {
      trendMultiplier = 1.0 - (Math.abs(trendScore) / 100) * SCENARIO_CONFIG.TREND_COUNTER_MAX_PENALTY;
    }

    const adjustedScore = Math.round(score * trendMultiplier);
    return { adjustedScore, trendScore, trendMultiplier };
  }

  private isDuplicate(template: ScenarioTemplate, direction: ScenarioDirection): boolean {
    return this.activeScenarios.some(s =>
      s.templateId === template.id &&
      s.direction === direction &&
      (s.status === 'PENDING' || s.status === 'ACTIVE') &&
      Date.now() - s.createdAt < 120000
    );
  }

  /** Cross-template dedup: check if entry zone overlaps existing scenario */
  private isDuplicateByZone(
    direction: ScenarioDirection,
    entryLow: number,
    entryHigh: number,
    adjustedScore: number,
  ): boolean {
    for (const existing of this.activeScenarios) {
      if (existing.direction !== direction) continue;
      if (existing.status !== 'PENDING' && existing.status !== 'ACTIVE') continue;

      const overlapLow = Math.max(existing.entryLow, entryLow);
      const overlapHigh = Math.min(existing.entryHigh, entryHigh);
      if (overlapLow >= overlapHigh) continue;

      const overlapSize = overlapHigh - overlapLow;
      const minZoneSize = Math.min(
        existing.entryHigh - existing.entryLow,
        entryHigh - entryLow,
      );
      if (minZoneSize <= 0) continue;

      const overlap = overlapSize / minZoneSize;
      if (overlap >= SCENARIO_CONFIG.DEDUP_OVERLAP_THRESHOLD) {
        // If new score is higher, replace the existing one
        if (adjustedScore > existing.score) {
          existing.status = 'INVALIDATED';
          existing.invalidationReason = 'Replaced by higher-score scenario in same zone';
          this.emit('scenario:invalidated', existing);
          this.logOutcome(existing);
          this.activeScenarios = this.activeScenarios.filter(s => s.id !== existing.id);
          return false; // allow the new one
        }
        return true; // existing is better, skip
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2.1: Wider entry zone / SL
  // ═══════════════════════════════════════════════════════════

  private buildScenario(
    template: ScenarioTemplate,
    direction: ScenarioDirection,
    score: number,
    maxScore: number,
    contributions: SignalContribution[],
    signals: ConfluenceSignal[],
  ): TradeScenario | null {
    const price = this.currentPrice;
    if (price <= 0) return null;

    // ATR-based SL or fixed fallback
    let slBuffer: number;
    if (SCENARIO_CONFIG.SL_MODE === 'ATR' && this.currentATR > 0) {
      slBuffer = Math.max(
        price * SCENARIO_CONFIG.MIN_SL_BUFFER_PCT,
        this.currentATR * SCENARIO_CONFIG.ATR_SL_MULTIPLIER,
      );
    } else {
      slBuffer = price * (this.config.slBufferPercent / 100);
    }
    const entryBuffer = price * SCENARIO_CONFIG.ENTRY_BUFFER_PCT;

    // Find zone bounds from signals
    const zonePrices = signals.map(s => s.price);
    const zoneLow = Math.min(...zonePrices, ...signals.filter(s => s.zoneLow).map(s => s.zoneLow!));
    const zoneHigh = Math.max(...zonePrices, ...signals.filter(s => s.zoneHigh).map(s => s.zoneHigh!));

    let entryLow: number, entryHigh: number, stopLoss: number;
    let tp1: number, tp2: number, tp3: number;
    let invalidationPrice: number;

    if (direction === 'LONG') {
      entryLow = Math.min(zoneLow, price) - entryBuffer;
      entryHigh = Math.max(zoneHigh, price) + entryBuffer;
      stopLoss = entryLow - slBuffer;
      const risk = entryHigh - stopLoss;
      tp1 = entryHigh + risk * SCENARIO_CONFIG.TP1_MULTIPLIER;
      tp2 = entryHigh + risk * SCENARIO_CONFIG.TP2_MULTIPLIER;
      tp3 = entryHigh + risk * SCENARIO_CONFIG.TP3_MULTIPLIER;
      invalidationPrice = stopLoss - slBuffer;
    } else {
      entryLow = Math.min(zoneLow, price) - entryBuffer;
      entryHigh = Math.max(zoneHigh, price) + entryBuffer;
      stopLoss = entryHigh + slBuffer;
      const risk = stopLoss - entryLow;
      tp1 = entryLow - risk * SCENARIO_CONFIG.TP1_MULTIPLIER;
      tp2 = entryLow - risk * SCENARIO_CONFIG.TP2_MULTIPLIER;
      tp3 = entryLow - risk * SCENARIO_CONFIG.TP3_MULTIPLIER;
      invalidationPrice = stopLoss + slBuffer;
    }

    // Calculate R:R to TP2
    const entryMid = (entryLow + entryHigh) / 2;
    const riskAmt = Math.abs(entryMid - stopLoss);
    const rewardAmt = Math.abs(tp2 - entryMid);
    const rr = riskAmt > 0 ? rewardAmt / riskAmt : 0;

    // Determine priority (LOW≥40, MEDIUM≥50, HIGH≥60, EXTREME≥75)
    let priority: ScenarioPriority = 'LOW';
    if (score >= this.config.extremePriorityThreshold) priority = 'EXTREME';
    else if (score >= this.config.highPriorityThreshold) priority = 'HIGH';
    else if (score >= 50) priority = 'MEDIUM';

    // Determine timeframe
    const tfSignal = signals.find(s => s.timeframe);
    const timeframe = tfSignal?.timeframe || '1m';

    const now = Date.now();
    return {
      id: `SC-${now}-${Math.random().toString(36).slice(2, 6)}`,
      templateName: template.name,
      templateId: template.id,
      direction,
      score,
      maxScore,
      priority,
      status: 'PENDING',
      entryLow,
      entryHigh,
      stopLoss,
      tp1,
      tp2,
      tp3,
      riskReward: Math.round(rr * 10) / 10,
      invalidationPrice,
      signals: contributions,
      createdAt: now,
      expiresAt: now + this.config.scenarioExpirationMs,
      updatedAt: now,
      timeframe,
      currentPrice: price,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2.3: TP2/TP3 tracking + trailing SL + excursion tracking
  // ═══════════════════════════════════════════════════════════

  private updateScenarioLifecycle(): void {
    const now = Date.now();
    const price = this.currentPrice;

    for (const sc of this.activeScenarios) {
      if (sc.status === 'INVALIDATED' || sc.status === 'EXPIRED' || sc.status === 'TP3_HIT') continue;

      // Expiration only for PENDING and ACTIVE (TP-hit scenarios keep tracking)
      // High-score scenarios (40+) never expire — they stay until SL or TP
      const adjScore = sc.meta?.adjustedScore ?? sc.score;
      if ((sc.status === 'PENDING' || sc.status === 'ACTIVE') && now >= sc.expiresAt && adjScore < 40) {
        sc.status = 'EXPIRED';
        sc.exitTime = now;
        sc.exitReason = 'Expired';
        this.emit('scenario:expired', sc);
        this.logOutcome(sc);
        continue;
      }

      // Check invalidation (price beyond invalidation level)
      if (sc.status === 'PENDING') {
        if (sc.direction === 'LONG' && price < sc.invalidationPrice) {
          sc.status = 'INVALIDATED';
          sc.invalidationReason = `Price below invalidation $${sc.invalidationPrice.toFixed(0)}`;
          sc.exitPrice = price;
          sc.exitTime = now;
          sc.exitReason = sc.invalidationReason;
          this.emit('scenario:invalidated', sc);
          this.logOutcome(sc);
          continue;
        }
        if (sc.direction === 'SHORT' && price > sc.invalidationPrice) {
          sc.status = 'INVALIDATED';
          sc.invalidationReason = `Price above invalidation $${sc.invalidationPrice.toFixed(0)}`;
          sc.exitPrice = price;
          sc.exitTime = now;
          sc.exitReason = sc.invalidationReason;
          this.emit('scenario:invalidated', sc);
          this.logOutcome(sc);
          continue;
        }
      }

      // PENDING → ACTIVE: price enters entry zone
      if (sc.status === 'PENDING') {
        if (price >= sc.entryLow && price <= sc.entryHigh) {
          sc.status = 'ACTIVE';
          sc.updatedAt = now;
          this.emit('scenario:update', sc);
        }
      }

      // ACTIVE / TP1_HIT / TP2_HIT: check SL then TP progression
      if (sc.status === 'ACTIVE' || sc.status === 'TRIGGERED' ||
          sc.status === 'TP1_HIT' || sc.status === 'TP2_HIT') {
        // Update excursion tracking (Phase 4.2)
        this.updateExcursions(sc, price);

        // Check SL hit
        const slHit = (sc.direction === 'LONG' && price <= sc.stopLoss)
                    || (sc.direction === 'SHORT' && price >= sc.stopLoss);
        if (slHit) {
          const prevStatus = sc.status;
          sc.status = 'INVALIDATED';
          sc.invalidationReason = `Stop-loss hit after ${prevStatus}`;
          sc.exitPrice = price;
          sc.exitTime = now;
          sc.exitReason = sc.invalidationReason;
          // Track SL timestamp for cooldown (TIER 3.2)
          this.lastSLTimestamp[sc.direction] = now;
          this.emit('scenario:invalidated', sc);
          this.logOutcome(sc);
          continue;
        }

        const isLong = sc.direction === 'LONG';

        // TP1
        if (sc.status === 'ACTIVE') {
          const tp1Hit = (isLong && price >= sc.tp1) || (!isLong && price <= sc.tp1);
          if (tp1Hit) {
            sc.status = 'TP1_HIT';
            sc.tp1HitTime = now;
            sc.tp1HitPrice = price;
            sc.updatedAt = now;
            // Trailing SL: move SL to breakeven
            if (SCENARIO_CONFIG.TRAILING_SL_ENABLED) {
              sc.stopLoss = (sc.entryLow + sc.entryHigh) / 2; // breakeven
            }
            this.emit('scenario:update', sc);
          }
        }

        // TP2
        if (sc.status === 'TP1_HIT' || sc.status === 'TRIGGERED') {
          const tp2Hit = (isLong && price >= sc.tp2) || (!isLong && price <= sc.tp2);
          if (tp2Hit) {
            sc.status = 'TP2_HIT';
            sc.tp2HitTime = now;
            sc.tp2HitPrice = price;
            sc.updatedAt = now;
            // Trailing SL: move SL to TP1
            if (SCENARIO_CONFIG.TRAILING_SL_ENABLED) {
              sc.stopLoss = sc.tp1;
            }
            this.emit('scenario:update', sc);
          }
        }

        // TP3
        if (sc.status === 'TP2_HIT') {
          const tp3Hit = (isLong && price >= sc.tp3) || (!isLong && price <= sc.tp3);
          if (tp3Hit) {
            sc.status = 'TP3_HIT';
            sc.tp3HitTime = now;
            sc.tp3HitPrice = price;
            sc.exitPrice = price;
            sc.exitTime = now;
            sc.exitReason = 'TP3 hit — full target reached';
            sc.updatedAt = now;
            this.emit('scenario:update', sc);
            this.logOutcome(sc);
          }
        }
      }

      // Update current price on scenario
      sc.currentPrice = price;
    }

    // Clean up old invalidated/expired/TP3 (keep for 60s for UI display)
    this.activeScenarios = this.activeScenarios.filter(s => {
      if (s.status === 'INVALIDATED' || s.status === 'EXPIRED' || s.status === 'TP3_HIT') {
        return now - s.updatedAt < 60000;
      }
      return true;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 4.2: Excursion tracking
  // ═══════════════════════════════════════════════════════════

  private updateExcursions(scenario: TradeScenario, currentPrice: number): void {
    if (scenario.direction === 'LONG') {
      scenario.maxFavorableExcursion = Math.max(
        scenario.maxFavorableExcursion ?? currentPrice,
        currentPrice,
      );
      scenario.maxAdverseExcursion = Math.min(
        scenario.maxAdverseExcursion ?? currentPrice,
        currentPrice,
      );
    } else {
      scenario.maxFavorableExcursion = Math.min(
        scenario.maxFavorableExcursion ?? currentPrice,
        currentPrice,
      );
      scenario.maxAdverseExcursion = Math.max(
        scenario.maxAdverseExcursion ?? currentPrice,
        currentPrice,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 4.1: Scenario outcome logging
  // ═══════════════════════════════════════════════════════════

  private logOutcome(scenario: TradeScenario): void {
    try {
      const logPath = SCENARIO_CONFIG.SCENARIO_LOG_PATH;
      const dir = dirname(logPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const outcome = {
        id: scenario.id,
        template: scenario.templateName,
        templateId: scenario.templateId,
        direction: scenario.direction,
        createdAt: scenario.createdAt,
        rawScore: scenario.meta?.rawScore ?? scenario.score,
        trendScore: scenario.meta?.trendScore ?? 0,
        trendMultiplier: scenario.meta?.trendMultiplier ?? 1.0,
        adjustedScore: scenario.meta?.adjustedScore ?? scenario.score,
        priority: scenario.priority,
        signalCount: scenario.signals.length,
        signalTypes: scenario.signals.map(s => s.name),
        hasAnchorSignal: scenario.meta?.hasAnchorSignal ?? false,
        clusterBonus: scenario.meta?.clusterBonus ?? 0,
        entryMid: (scenario.entryLow + scenario.entryHigh) / 2,
        sl: scenario.stopLoss,
        tp1: scenario.tp1,
        tp2: scenario.tp2,
        tp3: scenario.tp3,
        finalStatus: scenario.status,
        exitPrice: scenario.exitPrice ?? null,
        exitTime: scenario.exitTime ?? null,
        exitReason: scenario.exitReason ?? scenario.invalidationReason ?? '',
        durationMs: (scenario.exitTime ?? Date.now()) - scenario.createdAt,
        maxFavorableExcursion: scenario.maxFavorableExcursion ?? null,
        maxAdverseExcursion: scenario.maxAdverseExcursion ?? null,
        tp1Hit: scenario.tp1HitTime != null,
        tp2Hit: scenario.tp2HitTime != null,
        tp3Hit: scenario.tp3HitTime != null,
        hourOfDay: new Date(scenario.createdAt).getUTCHours(),
        dayOfWeek: new Date(scenario.createdAt).getUTCDay(),
        timeframe: scenario.timeframe,
      };

      appendFileSync(logPath, JSON.stringify(outcome) + '\n');
    } catch (err) {
      console.warn('[SCENARIO_LOG] Failed to write outcome:', (err as Error).message);
    }
  }

  private emit(event: string, scenario: TradeScenario): void {
    if (this.scenarioCallback) {
      this.scenarioCallback(event, scenario);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 5: Active scenario persistence (survive restarts)
  // ═══════════════════════════════════════════════════════════

  /** Save active scenarios to disk */
  saveState(): void {
    try {
      const filePath = SCENARIO_CONFIG.ACTIVE_SCENARIOS_PATH;
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const active = this.activeScenarios.filter(s =>
        s.status === 'PENDING' || s.status === 'ACTIVE' ||
        s.status === 'TRIGGERED' || s.status === 'TP1_HIT' ||
        s.status === 'TP2_HIT'
      );

      writeFileSync(filePath, JSON.stringify({
        savedAt: Date.now(),
        scenarios: active,
      }, null, 2));
    } catch (err) {
      console.warn('[SCENARIO] Failed to save active state:', (err as Error).message);
    }
  }

  /** Load active scenarios from disk (call once at startup) */
  loadState(): number {
    try {
      const filePath = SCENARIO_CONFIG.ACTIVE_SCENARIOS_PATH;
      if (!existsSync(filePath)) return 0;

      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      if (!data.scenarios || !Array.isArray(data.scenarios)) return 0;

      const now = Date.now();
      let restored = 0;

      for (const sc of data.scenarios) {
        // Skip if already expired (expiresAt passed while server was down)
        // High-score scenarios (40+) never expire
        const adjScore = sc.meta?.adjustedScore ?? sc.score;
        if ((sc.status === 'PENDING' || sc.status === 'ACTIVE') && sc.expiresAt && now >= sc.expiresAt && adjScore < 40) {
          // Log as expired outcome
          sc.status = 'EXPIRED';
          sc.exitTime = sc.expiresAt;
          sc.exitReason = 'Expired during server restart';
          this.logOutcome(sc);
          continue;
        }

        // TP-hit scenarios (TP1_HIT, TP2_HIT) don't expire — always restore
        this.activeScenarios.push(sc);
        restored++;
      }

      if (restored > 0) {
        console.log(`[SCENARIO] Restored ${restored} active scenario(s) from disk`);
      }

      return restored;
    } catch (err) {
      console.warn('[SCENARIO] Failed to load state:', (err as Error).message);
      return 0;
    }
  }

  /** Start periodic state saving */
  startStatePersistence(): void {
    setInterval(() => this.saveState(), SCENARIO_CONFIG.STATE_SAVE_INTERVAL_MS);
    console.log(`[SCENARIO] State persistence active (every ${SCENARIO_CONFIG.STATE_SAVE_INTERVAL_MS / 1000}s)`);
  }
}
