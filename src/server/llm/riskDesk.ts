/**
 * LLM Risk Desk — second opinion sur les scénarios du moteur de confluence.
 *
 * Pattern inspiré de TradingAgents (TauricResearch) : débat bull/bear puis
 * verdict d'un risk manager — mais en un seul appel structuré, natif TS,
 * branché sur notre vrai contexte orderflow (trend, funding, OI, structure)
 * au lieu de données daily Yahoo Finance.
 *
 * Le verdict ne remplace jamais le moteur : il module (score/priorité) et
 * tout est loggé dans scenario_outcomes.jsonl pour mesurer son apport réel.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { TradeScenario } from '../scenarios/types';

const VerdictSchema = z.object({
  verdict: z.enum(['APPROVE', 'REDUCE', 'REJECT']),
  confidence: z.number().min(0).max(100),
  bullCase: z.string(),
  bearCase: z.string(),
  riskNotes: z.string(),
});

export interface RiskDeskVerdict {
  verdict: 'APPROVE' | 'REDUCE' | 'REJECT';
  confidence: number;
  bullCase: string;
  bearCase: string;
  riskNotes: string;
  model: string;
  latencyMs: number;
  reviewedAt: number;
}

/** Contexte de marché compact fourni par l'engine au moment du scénario */
export interface RiskDeskContext {
  currentPrice: number;
  trend: { trend: string; score: number };
  derivatives?: {
    avgFundingRate: number;
    aggregateOIChangePct: number;
    avgBasisPercent: number;
    cascadeRisk: string | number;
  } | null;
  structure?: Record<string, { trend: string; lastBOS?: unknown; lastCHoCH?: unknown }>;
  vwap?: { vwap: number; upperBand2: number; lowerBand2: number } | null;
  templateStats?: { wins: number; losses: number } | null;
  /** Boucle de feedback : résultats réels des derniers verdicts de l'IA */
  verdictTrackRecord?: Record<string, { n: number; avgR: number; slHits: number; tp1Hits: number }> | null;
}

/**
 * Track record des verdicts : R réalisé moyen par type de verdict sur les
 * derniers trades clôturés. Injecté dans chaque dossier pour que l'IA voie
 * si sa grille de lecture prédit — ou inverse — la réalité.
 */
export function buildVerdictTrackRecord(
  outcomes: Array<Record<string, any>>,
): Record<string, { n: number; avgR: number; slHits: number; tp1Hits: number }> | null {
  const realizedR = (o: any): number | null => {
    const risk = o.initialRisk;
    if (!risk || risk <= 0) return null;
    const dir = o.direction === 'LONG' ? 1 : -1;
    const fill = o.activationPrice ?? o.entryMid;
    const rOf = (px: number) => dir * (px - fill) / risk;
    const exit = o.exitPrice ?? fill;
    if (o.tp3Hit) return (rOf(o.tp1) + rOf(o.tp2) + rOf(o.tp3)) / 3;
    if (o.tp2Hit) return (rOf(o.tp1) + rOf(o.tp2) + rOf(exit)) / 3;
    if (o.tp1Hit) return (rOf(o.tp1) + 2 * rOf(exit)) / 3;
    return rOf(exit);
  };

  const buckets: Record<string, { n: number; sumR: number; slHits: number; tp1Hits: number }> = {};
  for (const o of outcomes) {
    if (!o.llmVerdict || !o.wasActive) continue; // seuls les trades réellement remplis et jugés comptent
    const r = realizedR(o);
    if (r == null) continue;
    const b = buckets[o.llmVerdict] ?? (buckets[o.llmVerdict] = { n: 0, sumR: 0, slHits: 0, tp1Hits: 0 });
    b.n++;
    b.sumR += r;
    if (String(o.exitReason || '').includes('Stop-loss')) b.slHits++;
    if (o.tp1Hit) b.tp1Hits++;
  }

  const entries = Object.entries(buckets);
  if (entries.length === 0) return null;
  const out: Record<string, { n: number; avgR: number; slHits: number; tp1Hits: number }> = {};
  for (const [verdict, b] of entries) {
    out[verdict] = { n: b.n, avgR: Math.round((b.sumR / b.n) * 100) / 100, slHits: b.slHits, tp1Hits: b.tp1Hits };
  }
  return out;
}

export interface RiskDeskConfig {
  enabled?: boolean;
  model?: string;
  minScoreForReview?: number;
  vetoOnReject?: boolean;
  /** Verdict affiché/loggé mais AUCUNE modulation de score/priorité — mesure
   *  propre de l'edge prédictif (audit 2026-07-11 : APPROVE -2.01R vs REJECT +0.52R). */
  observerMode?: boolean;
  timeoutMs?: number;
}

const SYSTEM_PROMPT = `Tu es le risk manager d'un desk de trading crypto intraday (BTC, timeframes 1m-15m).
Un moteur de confluence orderflow te soumet un scénario de trade avec son contexte de marché. Tu rends un second avis structuré, façon firme de trading :
1. bullCase — le meilleur argument POUR prendre ce trade (1-3 phrases).
2. bearCase — le meilleur argument CONTRE (1-3 phrases).
3. riskNotes — le point de vigilance principal du risk manager (1-2 phrases).
4. verdict + confidence (0-100).

Critères d'évaluation :
- Qualité de la zone d'entrée : niveau structurel net (OB/sweep/FVG) ou zone floue ?
- Régime de marché : en TENDANCE établie, privilégie les continuations ; mais méfie-toi des entrées TARDIVES dans le sens d'un mouvement déjà très étendu (prix loin du VWAP, plusieurs heures de directionnel) — c'est souvent le sommet/creux local. En RANGE ou après extension, un setup contre-tendance sur un niveau structurel avec absorption peut être exactement le bon trade.
- Dérivés : le funding, l'open interest et le basis confirment-ils ou contredisent-ils la direction ?
- Risque d'invalidation rapide : le SL survivrait-il au bruit normal du timeframe ?
- Historique du template : un template qui perd historiquement mérite la sévérité.

Règles de verdict :
- Ton objectif n'est PAS d'être prudent — il est d'être PRÉDICTIF : un bon risk manager a des APPROVE qui surperforment ses REJECT en résultat réel. Le champ verdictTrackRecord du dossier contient les résultats réels de tes derniers verdicts : si tes REJECT gagnent plus que tes APPROVE, ta grille de lecture est inversée — recalibre-toi.
- Engage-toi clairement : APPROVE si le setup a un edge identifiable, REJECT si un critère majeur est contre. Réserve REDUCE aux cas où les preuves sont réellement équilibrées — ce n'est pas une échappatoire.
- Fonde chaque conclusion sur un élément PRÉCIS du dossier (un chiffre, un signal, un niveau) — jamais de généralité.
- Si le contexte fourni ne suffit pas à trancher, dis-le dans riskNotes.
Réponds en français.`;

export class RiskDesk {
  private client: Anthropic | null = null;
  private model: string;
  private minScoreForReview: number;
  readonly vetoOnReject: boolean;
  readonly observerMode: boolean;
  private inFlight = new Set<string>();
  private stats = { reviews: 0, approvals: 0, reductions: 0, rejections: 0, errors: 0 };

  constructor(config: RiskDeskConfig = {}) {
    this.model = config.model ?? 'claude-opus-4-8';
    this.minScoreForReview = config.minScoreForReview ?? 45;
    this.vetoOnReject = config.vetoOnReject ?? false;
    this.observerMode = config.observerMode ?? false;

    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    const enabled = (config.enabled ?? true) && hasKey;

    if (enabled) {
      this.client = new Anthropic({
        timeout: config.timeoutMs ?? 90_000,
        maxRetries: 1,
      });
      console.log(`[RISK-DESK] Active — model=${this.model}, minScore=${this.minScoreForReview}, veto=${this.vetoOnReject}, observer=${this.observerMode}`);
    } else if (config.enabled !== false && !hasKey) {
      console.log('[RISK-DESK] Disabled — set ANTHROPIC_API_KEY (in .env) to enable LLM scenario review');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  shouldReview(scenario: TradeScenario): boolean {
    if (!this.client) return false;
    if (scenario.score < this.minScoreForReview) return false;
    if (this.inFlight.has(scenario.id)) return false;
    return true;
  }

  getStats() {
    return { ...this.stats };
  }

  /** Second avis sur un scénario. Retourne null en cas d'échec — le moteur continue sans. */
  async review(scenario: TradeScenario, context: RiskDeskContext): Promise<RiskDeskVerdict | null> {
    if (!this.client) return null;
    this.inFlight.add(scenario.id);
    const t0 = Date.now();

    const dossier = {
      scenario: {
        template: scenario.templateName,
        direction: scenario.direction,
        timeframe: scenario.timeframe,
        score: scenario.score,
        priority: scenario.priority,
        entryZone: [scenario.entryLow, scenario.entryHigh],
        stopLoss: scenario.stopLoss,
        targets: [scenario.tp1, scenario.tp2, scenario.tp3],
        riskReward: scenario.riskReward,
        signals: scenario.signals.map(s => ({ name: s.name, weight: s.weight, details: s.details })),
        scoringMeta: scenario.meta,
      },
      marketContext: context,
    };

    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Dossier du scénario à évaluer :\n${JSON.stringify(dossier, null, 1)}`,
        }],
        output_config: {
          format: zodOutputFormat(VerdictSchema),
        },
      });

      const parsed = response.parsed_output;
      if (!parsed) {
        this.stats.errors++;
        console.warn(`[RISK-DESK] ${scenario.id}: unparseable response (stop_reason=${response.stop_reason})`);
        return null;
      }

      this.stats.reviews++;
      if (parsed.verdict === 'APPROVE') this.stats.approvals++;
      else if (parsed.verdict === 'REDUCE') this.stats.reductions++;
      else this.stats.rejections++;

      const verdict: RiskDeskVerdict = {
        ...parsed,
        confidence: Math.round(parsed.confidence),
        model: this.model,
        latencyMs: Date.now() - t0,
        reviewedAt: Date.now(),
      };
      console.log(`[RISK-DESK] ${scenario.direction} "${scenario.templateName}" → ${verdict.verdict} (${verdict.confidence}%) en ${(verdict.latencyMs / 1000).toFixed(1)}s | ${verdict.riskNotes}`);
      return verdict;
    } catch (err) {
      this.stats.errors++;
      if (err instanceof Anthropic.AuthenticationError) {
        console.error('[RISK-DESK] Invalid ANTHROPIC_API_KEY — disabling reviews');
        this.client = null;
      } else if (err instanceof Anthropic.RateLimitError) {
        console.warn('[RISK-DESK] Rate limited — scenario left unreviewed');
      } else if (err instanceof Anthropic.APIError) {
        console.warn(`[RISK-DESK] API error ${err.status}: ${err.message}`);
      } else {
        console.warn(`[RISK-DESK] Review failed: ${(err as Error).message}`);
      }
      return null;
    } finally {
      this.inFlight.delete(scenario.id);
    }
  }
}
