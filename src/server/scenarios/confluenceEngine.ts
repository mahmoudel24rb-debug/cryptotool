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
  minScoreForScenario: 30,
  highPriorityThreshold: 55,
  extremePriorityThreshold: 75,
  signalTimeWindowMs: 300000,
  scenarioExpirationMs: 1800000,
  maxActiveScenarios: 5,
  minRiskReward: 1.5,
  slBufferPercent: 0.1,
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

  constructor(config: Partial<ConfluenceConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      weights: { ...DEFAULT_CONFIG.weights, ...(config.weights || {}) },
    };
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
      s.status === 'PENDING' || s.status === 'ACTIVE' || s.status === 'TRIGGERED'
    );
  }

  private pruneOldSignals(): void {
    const cutoff = Date.now() - this.config.signalTimeWindowMs;
    this.signals = this.signals.filter(s => s.timestamp >= cutoff);
  }

  private evaluate(): void {
    if (this.currentPrice <= 0) return;

    // Group signals by price zone (within 0.3% of each other)
    const zones = this.groupSignalsByZone();

    for (const zone of zones) {
      // Determine direction
      const direction = this.determineDirection(zone);
      if (!direction) continue;

      // Calculate score
      const { score, maxScore, contributions } = this.calculateScore(zone, direction);
      if (score < this.config.minScoreForScenario) continue;

      // Try to match a template
      const template = matchTemplate(zone, direction, contributions);
      if (!template) continue;

      // Check if we already have a similar scenario
      if (this.isDuplicate(template, direction)) continue;

      // Build the scenario
      const scenario = this.buildScenario(template, direction, score, maxScore, contributions, zone);
      if (!scenario) continue;

      // Check R:R
      if (scenario.riskReward < this.config.minRiskReward) continue;

      // Check max active
      const active = this.getActiveScenarios();
      if (active.length >= this.config.maxActiveScenarios) {
        // Replace lowest score if new is higher
        const lowest = active.reduce((min, s) => s.score < min.score ? s : min, active[0]);
        if (score <= lowest.score) continue;
        lowest.status = 'INVALIDATED';
        lowest.invalidationReason = 'Replaced by higher-score scenario';
        this.emit('scenario:invalidated', lowest);
        this.activeScenarios = this.activeScenarios.filter(s => s.id !== lowest.id);
      }

      this.activeScenarios.push(scenario);
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
        // Update center as average
        zoneCenter = currentZone.reduce((s, c) => s + c.price, 0) / currentZone.length;
      } else {
        if (currentZone.length >= 2) zones.push(currentZone);
        currentZone = [sig];
        zoneCenter = sig.price;
      }
    }
    if (currentZone.length >= 2) zones.push(currentZone);

    // Also try evaluating ALL signals as one zone if they're within 1% of current price
    const nearPrice = this.signals.filter(s =>
      Math.abs(s.price - this.currentPrice) / this.currentPrice < 0.01
    );
    if (nearPrice.length >= 2) {
      // Avoid adding if it's the same as an existing zone
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

  private calculateScore(
    signals: ConfluenceSignal[],
    direction: ScenarioDirection,
  ): { score: number; maxScore: number; contributions: SignalContribution[] } {
    const contributions: SignalContribution[] = [];
    const usedWeightKeys = new Set<string>();
    let score = 0;
    let maxScore = 0;

    for (const sig of signals) {
      const weightKey = SIGNAL_WEIGHT_MAP[sig.type] || 'spike';
      const weight = this.config.weights[weightKey] || 5;
      maxScore += weight;

      // Only count signals aligned with direction (contra signals reduce score)
      if (sig.direction === direction) {
        // Avoid double-counting same signal type
        if (!usedWeightKeys.has(weightKey)) {
          score += weight;
          usedWeightKeys.add(weightKey);
          contributions.push({
            name: sig.type,
            weight,
            direction: sig.direction,
            timestamp: sig.timestamp,
            details: sig.details?.description || sig.details?.interpretation || undefined,
          });
        }
      } else {
        // Contra signal — reduce score slightly
        score -= Math.floor(weight * 0.3);
      }
    }

    return { score: Math.max(0, score), maxScore, contributions };
  }

  private isDuplicate(template: ScenarioTemplate, direction: ScenarioDirection): boolean {
    return this.activeScenarios.some(s =>
      s.templateId === template.id &&
      s.direction === direction &&
      (s.status === 'PENDING' || s.status === 'ACTIVE') &&
      Date.now() - s.createdAt < 120000 // within 2 min
    );
  }

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

    const buffer = price * (this.config.slBufferPercent / 100);

    // Find zone bounds from signals
    const zonePrices = signals.map(s => s.price);
    const zoneLow = Math.min(...zonePrices, ...signals.filter(s => s.zoneLow).map(s => s.zoneLow!));
    const zoneHigh = Math.max(...zonePrices, ...signals.filter(s => s.zoneHigh).map(s => s.zoneHigh!));

    let entryLow: number, entryHigh: number, stopLoss: number;
    let tp1: number, tp2: number, tp3: number;
    let invalidationPrice: number;

    if (direction === 'LONG') {
      entryLow = Math.min(zoneLow, price * 0.999);
      entryHigh = Math.max(zoneHigh, price * 1.001);
      stopLoss = entryLow - buffer;
      const risk = entryHigh - stopLoss;
      tp1 = entryHigh + risk * 1.5;
      tp2 = entryHigh + risk * 2.5;
      tp3 = entryHigh + risk * 4;
      invalidationPrice = stopLoss - buffer;
    } else {
      entryLow = Math.min(zoneLow, price * 0.999);
      entryHigh = Math.max(zoneHigh, price * 1.001);
      stopLoss = entryHigh + buffer;
      const risk = stopLoss - entryLow;
      tp1 = entryLow - risk * 1.5;
      tp2 = entryLow - risk * 2.5;
      tp3 = entryLow - risk * 4;
      invalidationPrice = stopLoss + buffer;
    }

    // Calculate R:R to TP2
    const entryMid = (entryLow + entryHigh) / 2;
    const riskAmt = Math.abs(entryMid - stopLoss);
    const rewardAmt = Math.abs(tp2 - entryMid);
    const rr = riskAmt > 0 ? rewardAmt / riskAmt : 0;

    // Determine priority
    let priority: ScenarioPriority = 'LOW';
    if (score >= this.config.extremePriorityThreshold) priority = 'EXTREME';
    else if (score >= this.config.highPriorityThreshold) priority = 'HIGH';
    else if (score >= this.config.minScoreForScenario + 10) priority = 'MEDIUM';

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

  private updateScenarioLifecycle(): void {
    const now = Date.now();
    const price = this.currentPrice;

    for (const sc of this.activeScenarios) {
      if (sc.status === 'INVALIDATED' || sc.status === 'EXPIRED') continue;

      // Check expiration
      if (now >= sc.expiresAt) {
        sc.status = 'EXPIRED';
        this.emit('scenario:expired', sc);
        continue;
      }

      // Check invalidation
      if (sc.direction === 'LONG' && price < sc.invalidationPrice) {
        sc.status = 'INVALIDATED';
        sc.invalidationReason = `Price below invalidation $${sc.invalidationPrice.toFixed(0)}`;
        this.emit('scenario:invalidated', sc);
        continue;
      }
      if (sc.direction === 'SHORT' && price > sc.invalidationPrice) {
        sc.status = 'INVALIDATED';
        sc.invalidationReason = `Price above invalidation $${sc.invalidationPrice.toFixed(0)}`;
        this.emit('scenario:invalidated', sc);
        continue;
      }

      // Lifecycle transitions
      if (sc.status === 'PENDING') {
        // Check if price entered entry zone
        if (price >= sc.entryLow && price <= sc.entryHigh) {
          sc.status = 'ACTIVE';
          sc.updatedAt = now;
          this.emit('scenario:update', sc);
        }
      }

      if (sc.status === 'ACTIVE') {
        // Check if SL hit
        if (sc.direction === 'LONG' && price <= sc.stopLoss) {
          sc.status = 'INVALIDATED';
          sc.invalidationReason = 'Stop-loss hit';
          this.emit('scenario:invalidated', sc);
          continue;
        }
        if (sc.direction === 'SHORT' && price >= sc.stopLoss) {
          sc.status = 'INVALIDATED';
          sc.invalidationReason = 'Stop-loss hit';
          this.emit('scenario:invalidated', sc);
          continue;
        }

        // Check if any TP hit
        if (sc.direction === 'LONG' && price >= sc.tp1) {
          sc.status = 'TRIGGERED';
          sc.updatedAt = now;
          this.emit('scenario:update', sc);
        }
        if (sc.direction === 'SHORT' && price <= sc.tp1) {
          sc.status = 'TRIGGERED';
          sc.updatedAt = now;
          this.emit('scenario:update', sc);
        }
      }

      // Update current price on scenario
      sc.currentPrice = price;
    }

    // Clean up old invalidated/expired (keep for 60s for UI display)
    this.activeScenarios = this.activeScenarios.filter(s => {
      if (s.status === 'INVALIDATED' || s.status === 'EXPIRED') {
        return now - s.updatedAt < 60000;
      }
      return true;
    });
  }

  private emit(event: string, scenario: TradeScenario): void {
    if (this.scenarioCallback) {
      this.scenarioCallback(event, scenario);
    }
  }
}
