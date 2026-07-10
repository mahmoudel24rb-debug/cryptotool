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
import { appendFile, mkdirSync, existsSync, writeFileSync, readFileSync, promises as fsp } from 'fs';
import { dirname } from 'path';
import { clock } from '../clock';

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
  DECAY_RATE: 0.5,
  TF_MULTIPLIERS: { '1m': 0.6, '5m': 1.0, '15m': 1.4, '1h': 1.6 } as Record<string, number>,
  PROXIMITY_MAX_DISTANCE: 0.025,     // 2.5% max distance for proximity factor

  // Phase 3.2 — Clustering temporel
  CLUSTER_WINDOW_MS: 30_000,         // 30 secondes
  CLUSTER_BONUS_HIGH: 10,            // 3+ paires dans la fenêtre
  CLUSTER_BONUS_LOW: 5,              // 1-2 paires

  // Phase 3.3 — Signal anchor minimum
  MINIMUM_ANCHOR_WEIGHT: 10,         // au moins 1 signal structurel poids >= 10 (OB, SWEEP, STRUCTURE, FVG)
  // L'ancre doit venir d'un TF >= 5m : une zone 1m est du bruit de
  // microstructure (et les frais mangent le R serré des trades 1m).
  // Les signaux 1m restent des supports de confluence, jamais le porteur.
  ANCHOR_MIN_TF_MINUTES: 5,

  // ── Régime de volatilité (audit 2026-07-11 : 300 évaluations → 0 émission) ──
  // En range mort (ATR/prix < seuil QUIET), la structure 5m/15m ne se met plus à
  // jour : exiger une ancre >= 5m revient à tout rejeter (noAnchor dominait les
  // logs). En QUIET, la structure 1m EST la structure tradeable — le plancher SL
  // (MIN_SL_BUFFER_PCT) et le check R:R continuent de protéger contre les micro-
  // trades mangés par les frais. Les seuils redeviennent stricts hors QUIET.
  VOL_REGIME_QUIET_ATR_PCT: 0.0008,   // ATR/prix < 0.08 % → régime QUIET
  VOL_REGIME_HOT_ATR_PCT: 0.0025,     // ATR/prix > 0.25 % → régime HOT
  ANCHOR_MIN_TF_MINUTES_QUIET: 1,     // ancre 1m acceptée uniquement en QUIET
  MIN_SCORE_QUIET_FACTOR: 0.85,       // scores structurellement plus bas en QUIET
                                      // (peu de signaux à gros poids disponibles)

  // Refonte v2 — retest scoring
  // Un retest de zone tenue EST la confluence recherchée : sans ce boost,
  // les multiplicateurs TF/force écrasaient le score sous le seuil d'émission
  RETEST_SCORE_MULTIPLIER: 1.3,
  RETEST_TYPES: new Set(['OB_RETEST', 'FVG_FILL']),

  // Refonte v2 — TP structurels
  // Le pré-check de place ne rejette que l'absurde (< 0.3R) — c'est le check
  // minRiskReward sur TP2 CAPPÉ qui arbitre la qualité réelle du trade
  MIN_ROOM_TO_FIRST_LEVEL_R: 0.3,
  TP_LEVEL_PADDING_ATR: 0.3,         // TP posé juste devant le niveau, pas dessus

  // Counter-trend blocking
  TREND_HARD_BLOCK_THRESHOLD: 40,    // |trendScore| above → block ALL counter-trend
  TREND_SOFT_BLOCK_THRESHOLD: 25,    // |trendScore| above → require high rawScore for counter-trend
  COUNTER_TREND_MIN_RAW_SCORE: 55,   // minimum rawScore for counter-trend in moderate trend

  // Momentum regime filter: when price displaced > N×ATR over the window,
  // the market is in a directional impulse — block all counter-move scenarios
  REGIME_WINDOW_MS: 300_000,         // 5 min displacement window
  REGIME_SAMPLE_INTERVAL_MS: 5_000,  // price sampling cadence
  REGIME_DISPLACEMENT_ATR: 4,        // |move| > 4×ATR(1m) over window → momentum regime

  // Cross-template deduplication
  DEDUP_OVERLAP_THRESHOLD: 0.5,      // 50% entry zone overlap = same trade

  // SL cooldown after stop-loss hit
  SL_COOLDOWN_MS: 300_000,           // 5 min cooldown after SL
  SL_COOLDOWN_OVERRIDE_SCORE: 65,    // only very high scores can bypass cooldown

  // ATR-based stop loss
  SL_MODE: 'ATR' as 'ATR' | 'FIXED',
  ATR_SL_MULTIPLIER: 2.0,            // 1×ATR(1m) was pure noise — stops swept constantly
  MIN_SL_BUFFER_PCT: 0.0025,         // 0.25% floor

  // Entry & TP — entry zone comes from the anchor signal's structural zone
  // (OB/FVG bounds, sweep level), NOT stretched to current price.
  ENTRY_BUFFER_PCT: 0.0005,          // 0.05% pad around the structural zone
  MAX_ENTRY_ZONE_PCT: 0.006,         // clamp zones wider than 0.6% of price
  TP1_MULTIPLIER: 1.0,               // R-multiples measured from entryMid vs TRUE risk
  TP2_MULTIPLIER: 2.0,
  TP3_MULTIPLIER: 3.0,
  MISSED_ENTRY_R: 1.5,               // PENDING cancelled if price runs 1.5R toward TP without retest
  ACTIVE_TIME_STOP_MS: 45 * 60 * 1000, // ACTIVE without TP1 after 45 min → time stop

  // Evaluation throttle: alert storms used to trigger a full evaluate() per signal
  EVAL_MIN_INTERVAL_MS: 1_000,

  // Template auto-calibration from data/scenario_outcomes.jsonl
  TEMPLATE_STATS_MIN_N: 8,           // need ≥8 resolved outcomes before adjusting
  TEMPLATE_MODIFIER_MIN: 0.75,
  TEMPLATE_MODIFIER_MAX: 1.15,
  TEMPLATE_BASELINE_WINRATE: 0.45,

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

  // Absolute max TTL for any scenario (even high-score ones)
  MAX_SCENARIO_TTL_MS: 2 * 60 * 60 * 1000, // 2h absolute max

  // Phase 4 — Logging
  SCENARIO_LOG_PATH: './data/scenario_outcomes.jsonl',
  ACTIVE_SCENARIOS_PATH: './data/active_scenarios.json',
  STATE_SAVE_INTERVAL_MS: 30_000, // save active scenarios every 30s
};

// Defaults mirror config.json — config values win at runtime
const DEFAULT_CONFIG: ConfluenceConfig = {
  weights: {
    structure: 15,
    orderBlock: 20,
    fairValueGap: 10,
    liquiditySweep: 20,
    absorption: 10,
    divergence: 8,
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
  minScoreForScenario: 25,   // recalibré : les forces de signaux sont clampées à [0,1] désormais
  highPriorityThreshold: 55,
  extremePriorityThreshold: 75,
  scenarioExpirationMs: 1800000,
  maxActiveScenarios: 4,
  minRiskReward: 1.2,
  slBufferPercent: 0.25,            // fallback si ATR indisponible
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
// Anchors must be STRUCTURAL — a trade needs a level to lean on.
// Context/momentum signals (VWAP, POC, spike…) can support, never anchor.
// ═══════════════════════════════════════════════════════════════

const ANCHOR_SIGNAL_TYPES = new Set([
  'ORDER_BLOCK', 'OB_RETEST', 'OB',
  'LIQUIDITY_SWEEP', 'SWEEP',
  'STRUCTURE', 'BOS', 'CHoCH',
  'FVG', 'FVG_FILL', // un FVG actif est un niveau structurel tradeable
]);

const TF_MINUTES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };

function isAnchorSignal(
  s: ConfluenceSignal,
  direction: ScenarioDirection,
  weights: ConfluenceConfig['weights'],
  anchorMinTf: number = SCENARIO_CONFIG.ANCHOR_MIN_TF_MINUTES,
): boolean {
  if (s.direction !== direction) return false;
  if (!ANCHOR_SIGNAL_TYPES.has(s.type)) return false;
  if ((TF_MINUTES[s.timeframe || '1m'] ?? 1) < anchorMinTf) return false;
  const weightKey = SIGNAL_WEIGHT_MAP[s.type];
  const weight = weightKey ? weights[weightKey] : 5;
  return weight >= SCENARIO_CONFIG.MINIMUM_ANCHOR_WEIGHT;
}

function hasAnchorSignal(
  signals: ConfluenceSignal[],
  direction: ScenarioDirection,
  weights: ConfluenceConfig['weights'],
  anchorMinTf: number = SCENARIO_CONFIG.ANCHOR_MIN_TF_MINUTES,
): boolean {
  return signals.some(s => isAnchorSignal(s, direction, weights, anchorMinTf));
}

/** Pick the best anchor: highest weight, then freshest */
function pickAnchorSignal(
  signals: ConfluenceSignal[],
  direction: ScenarioDirection,
  weights: ConfluenceConfig['weights'],
  anchorMinTf: number = SCENARIO_CONFIG.ANCHOR_MIN_TF_MINUTES,
): ConfluenceSignal | null {
  let best: ConfluenceSignal | null = null;
  let bestWeight = -1;
  for (const s of signals) {
    if (!isAnchorSignal(s, direction, weights, anchorMinTf)) continue;
    const weightKey = SIGNAL_WEIGHT_MAP[s.type];
    const weight = weightKey ? weights[weightKey] : 5;
    if (weight > bestWeight || (weight === bestWeight && best && s.timestamp > best.timestamp)) {
      best = s;
      bestWeight = weight;
    }
  }
  return best;
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

  // Momentum regime: rolling price samples over the displacement window
  private priceSamples: { t: number; p: number }[] = [];
  private lastPriceSampleAt = 0;

  // Refonte v2: niveaux structurels (pools, POC/VAH/VAL, swings) pour capper les TP
  private marketLevels: number[] = [];

  // Evaluation throttle (alert storms used to run a full evaluate() per signal)
  private lastEvalAt = 0;
  private evalScheduled = false;

  // Template auto-calibration from historical outcomes
  private templateStats = new Map<number, { wins: number; losses: number }>();

  // Persistence dirty flag — written by the periodic saver instead of per-event sync writes
  private stateDirty = false;

  // Mode backtest : évaluation synchrone (pas de setTimeout), outcomes envoyés
  // à un sink au lieu du JSONL, logs console coupés, stats live non chargées
  private quiet = false;
  private syncEvaluation = false;
  private outcomeSink: ((outcome: Record<string, unknown>) => void) | null = null;

  constructor(
    config: Partial<ConfluenceConfig> = {},
    opts: {
      loadTemplateStats?: boolean;
      quiet?: boolean;
      syncEvaluation?: boolean;
      outcomeSink?: (outcome: Record<string, unknown>) => void;
    } = {},
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      weights: { ...DEFAULT_CONFIG.weights, ...(config.weights || {}) },
    };
    this.quiet = opts.quiet ?? false;
    this.syncEvaluation = opts.syncEvaluation ?? false;
    this.outcomeSink = opts.outcomeSink ?? null;
    if (opts.loadTemplateStats ?? true) this.loadTemplateStats();
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

    // Sample price for the momentum regime filter
    const now = clock.now();
    if (now - this.lastPriceSampleAt >= SCENARIO_CONFIG.REGIME_SAMPLE_INTERVAL_MS) {
      this.lastPriceSampleAt = now;
      this.priceSamples.push({ t: now, p: price });
      const cutoff = now - SCENARIO_CONFIG.REGIME_WINDOW_MS - 30_000;
      while (this.priceSamples.length > 0 && this.priceSamples[0].t < cutoff) {
        this.priceSamples.shift();
      }
    }
  }

  getCurrentPrice(): number {
    return this.currentPrice;
  }

  /** Refonte v2 : niveaux opposés (liquidité, POC/VAH/VAL, swings) fournis par l'engine */
  updateMarketLevels(levels: number[]): void {
    this.marketLevels = levels;
  }

  updateATR(atr: number): void {
    if (atr > 0) this.currentATR = atr;
  }

  /**
   * Momentum regime: price displaced > N×ATR over the window means a directional
   * impulse is in progress. Returns the impulse direction, or null if ranging.
   * During an impulse, knife-catching counter-move scenarios are blocked.
   */
  private getMomentumRegime(): ScenarioDirection | null {
    if (this.currentATR <= 0 || this.priceSamples.length === 0) return null;
    const windowStart = clock.now() - SCENARIO_CONFIG.REGIME_WINDOW_MS;
    // Oldest sample within the window
    let ref: { t: number; p: number } | null = null;
    for (const s of this.priceSamples) {
      if (s.t >= windowStart) { ref = s; break; }
    }
    if (!ref) ref = this.priceSamples[this.priceSamples.length - 1];
    const displacement = this.currentPrice - ref.p;
    if (Math.abs(displacement) > SCENARIO_CONFIG.REGIME_DISPLACEMENT_ATR * this.currentATR) {
      return displacement > 0 ? 'LONG' : 'SHORT';
    }
    return null;
  }

  /** Feed a new signal into the engine — schedules a throttled evaluation */
  addSignal(signal: ConfluenceSignal): void {
    // Dedup: if same type + direction exists within 30s, keep strongest only
    const DEDUP_WINDOW_MS = 30_000;
    const now = clock.now();
    const dupIndex = this.signals.findIndex(s =>
      s.type === signal.type &&
      s.direction === signal.direction &&
      (now - s.timestamp) < DEDUP_WINDOW_MS
    );

    if (dupIndex !== -1) {
      const existing = this.signals[dupIndex];
      if ((signal.strength ?? 0) > (existing.strength ?? 0)) {
        this.signals[dupIndex] = signal;
      }
      return; // no re-evaluate on duplicate
    }

    this.signals.push(signal);
    this.pruneOldSignals();
    this.scheduleEvaluate();
  }

  /** Throttle: at most one evaluate() per EVAL_MIN_INTERVAL_MS, even during alert storms */
  private scheduleEvaluate(): void {
    if (this.syncEvaluation) { this.evaluate(); return; } // backtest : pas de timers réels
    const now = clock.now();
    const elapsed = now - this.lastEvalAt;
    if (elapsed >= SCENARIO_CONFIG.EVAL_MIN_INTERVAL_MS) {
      this.lastEvalAt = now;
      this.evaluate();
      return;
    }
    if (this.evalScheduled) return;
    this.evalScheduled = true;
    setTimeout(() => {
      this.evalScheduled = false;
      this.lastEvalAt = clock.now();
      this.evaluate();
    }, SCENARIO_CONFIG.EVAL_MIN_INTERVAL_MS - elapsed);
  }

  private lastDiagnosticLog = 0;
  private evalStats = {
    calls: 0, noAnchor: 0, anchorTfBlocked: 0, lowScore: 0, counterBlocked: 0, regimeBlocked: 0,
    noTemplate: 0, duplicate: 0, lowRR: 0, badZone: 0, zoneBroken: 0, noRoom: 0, emitted: 0,
    // Near-miss : à quelle distance des seuils meurent les rejets (pour régler au scalpel)
    nearMissScores: [] as number[], nearMissRR: [] as number[],
  };
  /** Raison précise du dernier échec de buildScenario (diagnostic badZone) */
  private lastBuildFail: 'zoneBroken' | 'noRoom' | 'other' | null = null;

  /** Régime de volatilité courant (ATR en % du prix) */
  volRegime(): 'QUIET' | 'NORMAL' | 'HOT' {
    if (this.currentPrice <= 0 || this.currentATR <= 0) return 'NORMAL';
    const atrPct = this.currentATR / this.currentPrice;
    if (atrPct < SCENARIO_CONFIG.VOL_REGIME_QUIET_ATR_PCT) return 'QUIET';
    if (atrPct > SCENARIO_CONFIG.VOL_REGIME_HOT_ATR_PCT) return 'HOT';
    return 'NORMAL';
  }

  /** TF minimum d'ancrage effectif selon le régime */
  private anchorMinTfEff(): number {
    return this.volRegime() === 'QUIET'
      ? SCENARIO_CONFIG.ANCHOR_MIN_TF_MINUTES_QUIET
      : SCENARIO_CONFIG.ANCHOR_MIN_TF_MINUTES;
  }

  /** Seuil de score effectif selon le régime */
  private minScoreEff(): number {
    return this.volRegime() === 'QUIET'
      ? Math.round(this.config.minScoreForScenario * SCENARIO_CONFIG.MIN_SCORE_QUIET_FACTOR)
      : this.config.minScoreForScenario;
  }

  /** Periodic tick — check expirations and lifecycle */
  tick(): void {
    this.pruneOldSignals();
    this.updateScenarioLifecycle();

    // Diagnostic log every 5 minutes
    const now = clock.now();
    if (!this.quiet && now - this.lastDiagnosticLog >= 300_000) {
      this.lastDiagnosticLog = now;
      const signalTypes = new Map<string, number>();
      for (const s of this.signals) signalTypes.set(s.type, (signalTypes.get(s.type) || 0) + 1);
      const typeSummary = Array.from(signalTypes.entries()).map(([t, n]) => `${t}:${n}`).join(', ');
      const trendInfo = this.trendProvider ? this.trendProvider.analyze() : { score: 0, trend: 'N/A' };
      const atrPct = this.currentPrice > 0 ? (this.currentATR / this.currentPrice) * 100 : 0;
      const nearScores = this.evalStats.nearMissScores.length ? ` nearScore=[${this.evalStats.nearMissScores.join(',')}]` : '';
      const nearRR = this.evalStats.nearMissRR.length ? ` nearRR=[${this.evalStats.nearMissRR.join(',')}]` : '';
      console.log(`[CONFLUENCE] signals=${this.signals.length} [${typeSummary}] | price=$${this.currentPrice.toFixed(0)} atr=${this.currentATR.toFixed(1)} (${atrPct.toFixed(3)}%) regime=${this.volRegime()} anchorTf>=${this.anchorMinTfEff()}m minScore=${this.minScoreEff()} | trend=${trendInfo.trend}(${trendInfo.score}) | active=${this.getActiveScenarios().length} | eval: ${this.evalStats.calls} calls, noAnchor=${this.evalStats.noAnchor} anchorTfBlock=${this.evalStats.anchorTfBlocked} lowScore=${this.evalStats.lowScore} counterBlock=${this.evalStats.counterBlocked} regimeBlock=${this.evalStats.regimeBlocked} noTemplate=${this.evalStats.noTemplate} dup=${this.evalStats.duplicate} lowRR=${this.evalStats.lowRR} badZone=${this.evalStats.badZone}(broken=${this.evalStats.zoneBroken},noRoom=${this.evalStats.noRoom}) emitted=${this.evalStats.emitted}${nearScores}${nearRR}`);
      this.evalStats = {
        calls: 0, noAnchor: 0, anchorTfBlocked: 0, lowScore: 0, counterBlocked: 0, regimeBlocked: 0,
        noTemplate: 0, duplicate: 0, lowRR: 0, badZone: 0, zoneBroken: 0, noRoom: 0, emitted: 0,
        nearMissScores: [], nearMissRR: [],
      };
    }
  }

  /** Stats de calibration d'un template (pour le dossier Risk Desk) */
  getTemplateStatsFor(templateId: number): { wins: number; losses: number } | null {
    return this.templateStats.get(templateId) ?? null;
  }

  /** Compteurs d'évaluation (cumulés en mode quiet — diagnostic backtest) */
  getEvalStats() {
    return { ...this.evalStats };
  }

  /**
   * Applique le verdict du LLM Risk Desk à un scénario encore vivant.
   * APPROVE : inchangé. REDUCE : score -15%. REJECT : priorité LOW,
   * et invalidation si le veto est activé. Tout est loggé pour mesure.
   */
  applyLlmVerdict(
    scenarioId: string,
    verdict: NonNullable<TradeScenario['llmVerdict']>,
    vetoOnReject: boolean,
    observerMode = false,
  ): void {
    const sc = this.activeScenarios.find(s => s.id === scenarioId);
    if (!sc) return; // déjà sorti (SL/expiré) pendant la review
    if (sc.status !== 'PENDING' && sc.status !== 'ACTIVE') return;

    sc.llmVerdict = verdict;
    sc.updatedAt = clock.now();

    // Mode observateur (audit 2026-07-11 : sur 14 verdicts, APPROVE = -2.01R cumulé
    // vs REJECT = +0.52R — l'inverse de l'objectif). Le verdict est attaché, affiché
    // et loggé pour mesurer son edge réel SANS contaminer la sélection : zéro
    // modulation de score/priorité tant qu'un edge n'est pas prouvé sur n>=30.
    if (observerMode) {
      this.emit('scenario:update', sc);
      return;
    }

    if (verdict.verdict === 'REDUCE') {
      sc.score = Math.round(sc.score * 0.85);
      if (sc.priority === 'EXTREME') sc.priority = 'HIGH';
      else if (sc.priority === 'HIGH') sc.priority = 'MEDIUM';
    } else if (verdict.verdict === 'REJECT') {
      sc.priority = 'LOW';
      if (vetoOnReject) {
        sc.status = 'INVALIDATED';
        sc.invalidationReason = `Risk Desk REJECT (${verdict.confidence}%): ${verdict.riskNotes}`;
        sc.exitTime = clock.now();
        sc.exitReason = sc.invalidationReason;
        this.emit('scenario:invalidated', sc);
        this.logOutcome(sc);
        this.activeScenarios = this.activeScenarios.filter(s => s.id !== sc.id);
        return;
      }
    }

    this.emit('scenario:update', sc);
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
    const now = clock.now();
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
    this.evalStats.calls++;

    // Momentum regime: during a directional impulse, no counter-move scenarios
    const momentumDirection = this.getMomentumRegime();

    // Group signals by price zone (within 0.3% of each other)
    const zones = this.groupSignalsByZone();
    // Seuils effectifs selon le régime de volatilité (constants pour toute la passe)
    const anchorMinTf = this.anchorMinTfEff();
    const minScore = this.minScoreEff();

    for (const zone of zones) {
      // Determine direction
      const direction = this.determineDirection(zone);
      if (!direction) continue;

      // Phase 3.3: Require at least one STRUCTURAL anchor signal
      if (!hasAnchorSignal(zone, direction, this.config.weights, anchorMinTf)) {
        // Diagnostic : l'ancre existait-elle sur un TF plus bas ? (mesure l'impact réel du gate TF)
        if (anchorMinTf > 1 && hasAnchorSignal(zone, direction, this.config.weights, 1)) this.evalStats.anchorTfBlocked++;
        else this.evalStats.noAnchor++;
        continue;
      }

      // Regime block: don't catch knives during impulses (the #1 source of instant SLs)
      if (momentumDirection && direction !== momentumDirection) { this.evalStats.regimeBlocked++; continue; }

      // Calculate score (Phase 1.2 strength + Phase 1.5 contra + Phase 3.1 decay/proximity)
      const { score: rawScore, maxScore, contributions } = this.calculateScore(zone, direction);

      // Phase 3.2: Temporal cluster bonus
      const clusterBonus = computeTemporalClusterBonus(zone);
      const scoreWithCluster = rawScore + clusterBonus;

      // Phase 1.1: Apply trend multiplier
      const { adjustedScore: trendAdjusted, trendScore, trendMultiplier } = this.applyTrendMultiplier(
        scoreWithCluster, direction,
      );

      // Counter-trend blocking (TIER 1.2)
      const isCounter = (direction === 'LONG' && trendScore < 0) || (direction === 'SHORT' && trendScore > 0);
      if (isCounter) {
        const absTrend = Math.abs(trendScore);
        // Hard block: strong trend → no counter-trend at all
        if (absTrend > SCENARIO_CONFIG.TREND_HARD_BLOCK_THRESHOLD) { this.evalStats.counterBlocked++; continue; }
        // Soft block: moderate trend → require high raw confluence
        if (absTrend > SCENARIO_CONFIG.TREND_SOFT_BLOCK_THRESHOLD && rawScore < SCENARIO_CONFIG.COUNTER_TREND_MIN_RAW_SCORE) { this.evalStats.counterBlocked++; continue; }
      }

      // Try to match a template (before scoring gate — its historical winrate adjusts the score)
      const template = matchTemplate(zone, direction, contributions);
      if (!template) { this.evalStats.noTemplate++; continue; }

      // Template auto-calibration: templates that historically stop out get penalized
      const templateModifier = this.getTemplateModifier(template.id);
      const adjustedScore = Math.round(trendAdjusted * templateModifier);

      if (adjustedScore < minScore) {
        this.evalStats.lowScore++;
        // Near-miss : rejets à moins de 10 points du seuil (règle le seuil sur données)
        if (adjustedScore >= minScore - 10 && this.evalStats.nearMissScores.length < 8) this.evalStats.nearMissScores.push(adjustedScore);
        continue;
      }

      // SL cooldown check (TIER 3.2)
      const timeSinceLastSL = clock.now() - (this.lastSLTimestamp[direction] || 0);
      if (timeSinceLastSL < SCENARIO_CONFIG.SL_COOLDOWN_MS && adjustedScore < SCENARIO_CONFIG.SL_COOLDOWN_OVERRIDE_SCORE) continue;

      // Check if we already have a similar scenario (same template)
      if (this.isDuplicate(template, direction)) { this.evalStats.duplicate++; continue; }

      // Build the scenario
      const scenario = this.buildScenario(
        template, direction, adjustedScore, maxScore, contributions, zone,
      );
      if (!scenario) {
        this.evalStats.badZone++;
        if (this.lastBuildFail === 'zoneBroken') this.evalStats.zoneBroken++;
        else if (this.lastBuildFail === 'noRoom') this.evalStats.noRoom++;
        continue;
      }

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
        templateModifier,
      };

      // Check R:R
      if (scenario.riskReward < this.config.minRiskReward) {
        this.evalStats.lowRR++;
        if (this.evalStats.nearMissRR.length < 8) this.evalStats.nearMissRR.push(Math.round(scenario.riskReward * 100) / 100);
        continue;
      }

      // Check max active
      const active = this.getActiveScenarios();
      if (active.length >= this.config.maxActiveScenarios) {
        // Remplacement uniquement parmi les PENDING/ACTIVE : un scénario qui a
        // déjà touché TP1/TP2 est un gagnant en cours de gestion — l'éjecter
        // pour faire de la place détruisait des trades gagnants (vu en prod)
        const replaceable = active.filter(s => s.status === 'PENDING' || s.status === 'ACTIVE');
        if (replaceable.length === 0) continue;
        const lowest = replaceable.reduce((min, s) => s.score < min.score ? s : min, replaceable[0]);
        if (adjustedScore <= lowest.score) continue;
        lowest.status = 'INVALIDATED';
        lowest.invalidationReason = 'Replaced by higher-score scenario';
        this.emit('scenario:invalidated', lowest);
        this.logOutcome(lowest);
        this.activeScenarios = this.activeScenarios.filter(s => s.id !== lowest.id);
      }

      this.activeScenarios.push(scenario);
      this.evalStats.emitted++;
      if (!this.quiet) console.log(`[SCENARIO] NEW ${scenario.direction} "${scenario.templateName}" | raw=${rawScore} trend=${trendScore} mult=${trendMultiplier.toFixed(2)} adj=${adjustedScore} cluster=${clusterBonus} | R:R=${scenario.riskReward} | signals: ${contributions.map(c => c.name).join(', ')}`);
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
      // Check if this group overlaps significantly with existing zones
      const nearPriceSet = new Set(nearPrice);
      const isRedundant = zones.some(z => {
        const overlap = z.filter(s => nearPriceSet.has(s)).length;
        return overlap >= Math.min(z.length, nearPrice.length) * 0.5;
      });
      if (!isRedundant) zones.push(nearPrice);
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
    // Contra dédupliqués par catégorie EUX AUSSI — avant, chaque signal
    // contraire soustrayait individuellement : en live, la douzaine
    // d'absorptions/vélocités qui traînent en permanence autour du prix
    // enterrait tout retest sous -20 de pénalités (0 émission en 3 jours),
    // alors que le côté favorable, lui, était plafonné à 1 signal/catégorie.
    const worstContraByKey = new Map<string, number>(); // weightKey → pénalité max
    let score = 0;
    let maxScore = 0;
    const now = clock.now();

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
        // Contra signal — Phase 1.5: progressive penalty (strength clampée aussi)
        const strength = Math.min(1, Math.max(SCENARIO_CONFIG.MIN_STRENGTH_FLOOR, sig.strength ?? 1.0));
        const penaltyRatio = getContraPenaltyRatio(weight);
        const penalty = Math.floor(weight * strength * penaltyRatio);
        if (penalty > (worstContraByKey.get(weightKey) ?? 0)) {
          worstContraByKey.set(weightKey, penalty);
        }
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

    // Subtract worst contra per category (symétrique du côté favorable)
    for (const [, penalty] of worstContraByKey) {
      score -= penalty;
    }

    return { score: Math.max(0, score), maxScore, contributions };
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3.1: Continuous signal score (strength * decay * proximity * TF)
  // ═══════════════════════════════════════════════════════════

  private computeSignalScore(signal: ConfluenceSignal, baseWeight: number, now: number): number {
    // 1. Strength (Phase 1.2) — clampée dans [floor, 1] : certains émetteurs
    // envoyaient des forces > 1 (OB strength 0-100 divisé par 5 → jusqu'à 20),
    // ce qui faisait exploser le score d'un seul signal
    const strength = Math.min(1, Math.max(SCENARIO_CONFIG.MIN_STRENGTH_FLOOR, signal.strength ?? 1.0));

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

    // 5. Retest bonus (refonte v2) — une zone tenue puis retestée vaut plus
    // que sa création : c'est l'entrée en pullback qu'on cherche
    const retestMult = SCENARIO_CONFIG.RETEST_TYPES.has(signal.type)
      ? SCENARIO_CONFIG.RETEST_SCORE_MULTIPLIER : 1.0;

    return Math.round(baseWeight * strength * decay * proximity * tfMultiplier * retestMult);
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
      clock.now() - s.createdAt < 120000
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
        // Never replace ACTIVE scenarios (already in entry zone)
        if (existing.status === 'ACTIVE') {
          return true; // skip the new one, existing is live
        }
        // Only replace PENDING if new score is better
        if (existing.status === 'PENDING' && adjustedScore > existing.score) {
          existing.status = 'INVALIDATED';
          existing.invalidationReason = 'Replaced by higher-score scenario in same zone';
          this.emit('scenario:invalidated', existing);
          this.logOutcome(existing);
          this.activeScenarios = this.activeScenarios.filter(s => s.id !== existing.id);
          return false; // allow the new one
        }
        return true; // existing is better or active, skip new
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2.1 (refonte): structural entry zone + honest risk
  //
  // The old logic stretched the entry zone to the CURRENT price
  // (instant market entry), put the SL 1×ATR(1m) behind it (noise),
  // and measured "risk" across the whole zone width — inflating the
  // TPs to unreachable levels. Net effect: stops swept, targets never
  // hit. Now: entry = the anchor's structural zone (pullback entry),
  // SL = 2×ATR behind the zone, TPs = true R-multiples from entryMid.
  // ═══════════════════════════════════════════════════════════

  private buildScenario(
    template: ScenarioTemplate,
    direction: ScenarioDirection,
    score: number,
    maxScore: number,
    contributions: SignalContribution[],
    signals: ConfluenceSignal[],
  ): TradeScenario | null {
    this.lastBuildFail = null;
    const price = this.currentPrice;
    if (price <= 0) { this.lastBuildFail = 'other'; return null; }

    // Entry zone = the structural anchor's zone (OB/FVG bounds, sweep level)
    const anchor = pickAnchorSignal(signals, direction, this.config.weights, this.anchorMinTfEff());
    if (!anchor) { this.lastBuildFail = 'other'; return null; }

    // ATR-based SL, scaled to the anchor's timeframe: a 15m zone breathes more
    // than a 1m one — same 2×ATR(1m) stop for both was noise-tight on higher TFs
    const tfMinutes: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60 };
    const tfScale = Math.sqrt(tfMinutes[anchor.timeframe || '1m'] ?? 1);
    let slBuffer: number;
    if (SCENARIO_CONFIG.SL_MODE === 'ATR' && this.currentATR > 0) {
      slBuffer = Math.max(
        price * SCENARIO_CONFIG.MIN_SL_BUFFER_PCT,
        this.currentATR * SCENARIO_CONFIG.ATR_SL_MULTIPLIER * tfScale,
      );
    } else {
      slBuffer = price * (this.config.slBufferPercent / 100) * tfScale;
    }
    const entryBuffer = price * SCENARIO_CONFIG.ENTRY_BUFFER_PCT;

    let zoneLow = anchor.zoneLow ?? anchor.price;
    let zoneHigh = anchor.zoneHigh ?? anchor.price;
    // Degenerate zone (single level): pad to a tradeable band
    if (zoneHigh - zoneLow < price * 0.0005) {
      const pad = price * 0.0005;
      zoneLow -= pad;
      zoneHigh += pad;
    }
    // Clamp zones wider than MAX_ENTRY_ZONE_PCT (keeps risk meaningful)
    const maxWidth = price * SCENARIO_CONFIG.MAX_ENTRY_ZONE_PCT;
    if (zoneHigh - zoneLow > maxWidth) {
      const mid = (zoneLow + zoneHigh) / 2;
      zoneLow = mid - maxWidth / 2;
      zoneHigh = mid + maxWidth / 2;
    }

    const entryLow = zoneLow - entryBuffer;
    const entryHigh = zoneHigh + entryBuffer;
    const entryMid = (entryLow + entryHigh) / 2;

    let stopLoss: number;
    let invalidationPrice: number;

    if (direction === 'LONG') {
      // Zone already broken below → setup is dead, don't emit
      if (price < entryLow) { this.lastBuildFail = 'zoneBroken'; return null; }
      stopLoss = entryLow - slBuffer;
    } else {
      // Zone already broken above → setup is dead
      if (price > entryHigh) { this.lastBuildFail = 'zoneBroken'; return null; }
      stopLoss = entryHigh + slBuffer;
    }
    invalidationPrice = stopLoss;
    const risk = Math.abs(entryMid - stopLoss);

    // ── TP structurels (refonte v2) ──
    // Les R-multiples aveugles visaient À TRAVERS le premier niveau opposé
    // (pool de liquidité, POC, swing) — là où le trade meurt à 0.9R. On cappe
    // chaque TP juste devant les niveaux, et on rejette s'il n'y a pas de place.
    const sign = direction === 'LONG' ? 1 : -1;
    const pad = Math.max(price * 0.0002, this.currentATR * SCENARIO_CONFIG.TP_LEVEL_PADDING_ATR);
    const opposing = this.marketLevels
      .filter(l => sign * (l - entryMid) > 0 && (direction === 'LONG' ? l > entryHigh : l < entryLow))
      .sort((a, b) => sign * (a - b));

    // Pas de place jusqu'au premier niveau opposé → pas de trade
    if (opposing.length > 0 && sign * (opposing[0] - entryMid) - pad < risk * SCENARIO_CONFIG.MIN_ROOM_TO_FIRST_LEVEL_R) {
      this.lastBuildFail = 'noRoom';
      return null;
    }

    const tpMultipliers = [
      SCENARIO_CONFIG.TP1_MULTIPLIER,
      SCENARIO_CONFIG.TP2_MULTIPLIER,
      SCENARIO_CONFIG.TP3_MULTIPLIER,
    ];
    const tps: number[] = [];
    let levelIdx = 0;
    for (const mult of tpMultipliers) {
      let target = entryMid + sign * risk * mult;
      // Avance jusqu'au prochain niveau strictement au-delà du TP précédent
      const prevTp = tps.length > 0 ? tps[tps.length - 1] : entryMid;
      while (levelIdx < opposing.length && sign * (opposing[levelIdx] - prevTp) <= pad) levelIdx++;
      if (levelIdx < opposing.length && sign * (opposing[levelIdx] - entryMid) - pad < sign * (target - entryMid)) {
        target = opposing[levelIdx] - sign * pad;
        levelIdx++;
      }
      // Garantit une progression strictement croissante des cibles
      if (tps.length > 0 && sign * (target - tps[tps.length - 1]) <= 0) {
        target = tps[tps.length - 1] + sign * risk * 0.5;
      }
      tps.push(target);
    }
    const [tp1, tp2, tp3] = tps;

    // R:R réel vers TP2 — de nouveau significatif maintenant que TP2 est cappé
    const riskAmt = risk;
    const rewardAmt = Math.abs(tp2 - entryMid);
    const rr = riskAmt > 0 ? rewardAmt / riskAmt : 0;

    // Priorité : LOW par défaut, MEDIUM≥50, HIGH≥highPriorityThreshold, EXTREME≥extremePriorityThreshold
    let priority: ScenarioPriority = 'LOW';
    if (score >= this.config.extremePriorityThreshold) priority = 'EXTREME';
    else if (score >= this.config.highPriorityThreshold) priority = 'HIGH';
    else if (score >= 50) priority = 'MEDIUM';

    // Le timeframe du scénario est celui de l'ANCRE (avant : premier signal
    // venu, ce qui étiquetait "1m" des trades ancrés sur des zones 15m)
    const timeframe = anchor.timeframe || signals.find(s => s.timeframe)?.timeframe || '1m';

    const now = clock.now();
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
      initialStopLoss: stopLoss, // le SL traîne (breakeven/TP1) — le risque initial sert au calcul du R
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
    const now = clock.now();
    const price = this.currentPrice;

    for (const sc of this.activeScenarios) {
      if (sc.status === 'INVALIDATED' || sc.status === 'EXPIRED' || sc.status === 'TP3_HIT') continue;

      // Expiration: PENDING expires at expiresAt (no score exemption — stale
      // setups used to linger 2h), everything dies at the absolute max TTL
      const age = now - sc.createdAt;
      const normalExpiry = sc.status === 'PENDING' && now >= sc.expiresAt;
      const absoluteExpiry = age >= SCENARIO_CONFIG.MAX_SCENARIO_TTL_MS;

      if ((sc.status === 'PENDING' || sc.status === 'ACTIVE') && (normalExpiry || absoluteExpiry)) {
        sc.status = 'EXPIRED';
        sc.exitTime = now;
        sc.exitReason = absoluteExpiry ? 'Max TTL reached' : 'Expired';
        this.emit('scenario:expired', sc);
        this.logOutcome(sc);
        continue;
      }

      // Time stop: ACTIVE without TP1 for too long → dead trade, free the slot
      if (sc.status === 'ACTIVE' && sc.activatedAt && now - sc.activatedAt >= SCENARIO_CONFIG.ACTIVE_TIME_STOP_MS) {
        sc.status = 'EXPIRED';
        sc.exitPrice = price;
        sc.exitTime = now;
        sc.exitReason = 'Time stop — no TP1 within window';
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

        // Missed entry: price ran toward the targets without ever retesting
        // the zone — the setup played out without us, cancel it cleanly
        const risk = Math.abs((sc.entryLow + sc.entryHigh) / 2 - sc.stopLoss);
        const missedLevel = sc.direction === 'LONG'
          ? sc.entryHigh + risk * SCENARIO_CONFIG.MISSED_ENTRY_R
          : sc.entryLow - risk * SCENARIO_CONFIG.MISSED_ENTRY_R;
        const missed = sc.direction === 'LONG' ? price >= missedLevel : price <= missedLevel;
        if (missed) {
          sc.status = 'EXPIRED';
          sc.exitPrice = price;
          sc.exitTime = now;
          sc.exitReason = 'Missed entry — price ran without retest';
          this.emit('scenario:expired', sc);
          this.logOutcome(sc);
          continue;
        }
      }

      // PENDING → ACTIVE: price enters entry zone
      if (sc.status === 'PENDING') {
        if (price >= sc.entryLow && price <= sc.entryHigh) {
          sc.status = 'ACTIVE';
          sc.activatedAt = now;
          // Le fill réel : le prix peut entrer par n'importe quel bord de la
          // zone (ou être déjà dedans à la création) — mesurer les TP/R depuis
          // le milieu théorique gonflait les résultats (« TP1 touché » alors
          // que l'entrée réelle était déjà à 100 pts du TP)
          sc.activationPrice = price;
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
            // Trailing SL: move SL to worst-case breakeven
            if (SCENARIO_CONFIG.TRAILING_SL_ENABLED) {
              sc.stopLoss = isLong ? sc.entryLow : sc.entryHigh;
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
  // Template auto-calibration: learn from logged outcomes.
  // Templates whose entries historically stop out before TP1 get
  // their score penalized; consistent winners get a small boost.
  // ═══════════════════════════════════════════════════════════

  private loadTemplateStats(): void {
    try {
      const logPath = SCENARIO_CONFIG.SCENARIO_LOG_PATH;
      if (!existsSync(logPath)) return;
      const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const o = JSON.parse(line);
          this.recordTemplateOutcome(o.templateId, o.tp1Hit === true, String(o.exitReason || ''));
        } catch { /* skip malformed lines */ }
      }
      const summary = Array.from(this.templateStats.entries())
        .map(([id, s]) => `T${id}:${s.wins}W/${s.losses}L(x${this.getTemplateModifier(id).toFixed(2)})`)
        .join(' ');
      if (summary) console.log(`[SCENARIO] Template calibration loaded: ${summary}`);
    } catch (err) {
      console.warn('[SCENARIO] Failed to load template stats:', (err as Error).message);
    }
  }

  /** Count only decisive outcomes: TP1 reached = win, stop-loss = loss */
  private recordTemplateOutcome(templateId: number, tp1Hit: boolean, exitReason: string): void {
    if (typeof templateId !== 'number') return;
    const isLoss = !tp1Hit && exitReason.includes('Stop-loss');
    if (!tp1Hit && !isLoss) return; // expired/missed/replaced = no information
    const stats = this.templateStats.get(templateId) ?? { wins: 0, losses: 0 };
    if (tp1Hit) stats.wins++;
    else stats.losses++;
    this.templateStats.set(templateId, stats);
  }

  private getTemplateModifier(templateId: number): number {
    const stats = this.templateStats.get(templateId);
    if (!stats) return 1.0;
    const n = stats.wins + stats.losses;
    if (n < SCENARIO_CONFIG.TEMPLATE_STATS_MIN_N) return 1.0;
    const winrate = stats.wins / n;
    const modifier = 1 + (winrate - SCENARIO_CONFIG.TEMPLATE_BASELINE_WINRATE) * 0.8;
    return Math.min(SCENARIO_CONFIG.TEMPLATE_MODIFIER_MAX,
      Math.max(SCENARIO_CONFIG.TEMPLATE_MODIFIER_MIN, modifier));
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
        activationPrice: scenario.activationPrice ?? null,
        sl: scenario.stopLoss,
        initialSl: scenario.initialStopLoss ?? scenario.stopLoss,
        // Risque mesuré depuis le fill réel quand il existe (comptabilité honnête)
        initialRisk: Math.abs((scenario.activationPrice ?? (scenario.entryLow + scenario.entryHigh) / 2) - (scenario.initialStopLoss ?? scenario.stopLoss)),
        wasActive: scenario.activatedAt != null,
        tp1: scenario.tp1,
        tp2: scenario.tp2,
        tp3: scenario.tp3,
        finalStatus: scenario.status,
        exitPrice: scenario.exitPrice ?? null,
        exitTime: scenario.exitTime ?? null,
        exitReason: scenario.exitReason ?? scenario.invalidationReason ?? '',
        durationMs: (scenario.exitTime ?? clock.now()) - scenario.createdAt,
        maxFavorableExcursion: scenario.maxFavorableExcursion ?? null,
        maxAdverseExcursion: scenario.maxAdverseExcursion ?? null,
        tp1Hit: scenario.tp1HitTime != null,
        tp2Hit: scenario.tp2HitTime != null,
        tp3Hit: scenario.tp3HitTime != null,
        hourOfDay: new Date(scenario.createdAt).getUTCHours(),
        dayOfWeek: new Date(scenario.createdAt).getUTCDay(),
        timeframe: scenario.timeframe,
        // Verdict Risk Desk (si review LLM) — permet de mesurer son apport
        llmVerdict: scenario.llmVerdict?.verdict ?? null,
        llmConfidence: scenario.llmVerdict?.confidence ?? null,
      };

      // Feed the calibration loop, then write asynchronously — synchronous
      // writes here used to stall the event loop during scenario churn
      this.recordTemplateOutcome(outcome.templateId, outcome.tp1Hit, outcome.exitReason);
      if (this.outcomeSink) {
        this.outcomeSink(outcome); // backtest : collecte en mémoire, pas de fichier
        return;
      }
      appendFile(logPath, JSON.stringify(outcome) + '\n', (err) => {
        if (err) console.warn('[SCENARIO_LOG] Failed to write outcome:', err.message);
      });
    } catch (err) {
      console.warn('[SCENARIO_LOG] Failed to write outcome:', (err as Error).message);
    }
  }

  private emit(event: string, scenario: TradeScenario): void {
    this.stateDirty = true; // any scenario event implies state changed
    if (this.scenarioCallback) {
      this.scenarioCallback(event, scenario);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 5: Active scenario persistence (survive restarts)
  // ═══════════════════════════════════════════════════════════

  private buildStatePayload(): string {
    const active = this.activeScenarios.filter(s =>
      s.status === 'PENDING' || s.status === 'ACTIVE' ||
      s.status === 'TRIGGERED' || s.status === 'TP1_HIT' ||
      s.status === 'TP2_HIT'
    );
    return JSON.stringify({ savedAt: clock.now(), scenarios: active }, null, 2);
  }

  /** Synchronous save — ONLY for shutdown (blocks the event loop) */
  saveState(): void {
    try {
      const filePath = SCENARIO_CONFIG.ACTIVE_SCENARIOS_PATH;
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, this.buildStatePayload());
      this.stateDirty = false;
    } catch (err) {
      console.warn('[SCENARIO] Failed to save active state:', (err as Error).message);
    }
  }

  /** Async save used by the periodic saver — never blocks trade processing */
  private async saveStateAsync(): Promise<void> {
    try {
      const filePath = SCENARIO_CONFIG.ACTIVE_SCENARIOS_PATH;
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const payload = this.buildStatePayload();
      this.stateDirty = false;
      await fsp.writeFile(filePath, payload);
    } catch (err) {
      this.stateDirty = true;
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

      const now = clock.now();
      let restored = 0;

      for (const sc of data.scenarios) {
        // Skip if already expired (expiresAt passed or max TTL reached while server was down)
        const age = now - sc.createdAt;
        const normalExpiry = sc.status === 'PENDING' && sc.expiresAt && now >= sc.expiresAt;
        const absoluteExpiry = age >= SCENARIO_CONFIG.MAX_SCENARIO_TTL_MS;
        if ((sc.status === 'PENDING' || sc.status === 'ACTIVE') && (normalExpiry || absoluteExpiry)) {
          sc.status = 'EXPIRED';
          sc.exitTime = now;
          sc.exitReason = absoluteExpiry ? 'Max TTL reached during restart' : 'Expired during server restart';
          this.logOutcome(sc);
          continue;
        }

        // Restored ACTIVE scenarios need activatedAt or the time stop never fires
        if (sc.status === 'ACTIVE' && !sc.activatedAt) sc.activatedAt = sc.createdAt;

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

  /** Start periodic state saving (async, only when something changed) */
  startStatePersistence(): void {
    setInterval(() => {
      if (this.stateDirty) void this.saveStateAsync();
    }, SCENARIO_CONFIG.STATE_SAVE_INTERVAL_MS);
    console.log(`[SCENARIO] State persistence active (every ${SCENARIO_CONFIG.STATE_SAVE_INTERVAL_MS / 1000}s, dirty-flag)`);
  }
}
