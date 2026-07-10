/**
 * Test du LLM Risk Desk avec un scénario fictif réaliste.
 * Usage : npm run test:llm  (nécessite ANTHROPIC_API_KEY dans .env)
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Même chargeur .env minimal que le serveur
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const { RiskDesk } = await import('../src/server/llm/riskDesk.js');
import type { TradeScenario } from '../src/server/scenarios/types.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY manquante — copie .env.example en .env et remplis la clé.');
  process.exit(1);
}

const desk = new RiskDesk({ enabled: true });

const scenario: TradeScenario = {
  id: 'TEST-1',
  templateName: 'Liquidity Sweep + Reversal',
  templateId: 2,
  direction: 'LONG',
  score: 52,
  maxScore: 80,
  priority: 'MEDIUM',
  status: 'PENDING',
  entryLow: 62450,
  entryHigh: 62520,
  stopLoss: 62280,
  tp1: 62690,
  tp2: 62895,
  tp3: 63100,
  riskReward: 2.0,
  invalidationPrice: 62280,
  signals: [
    { name: 'LIQUIDITY_SWEEP', weight: 18, direction: 'LONG', timestamp: Date.now() - 60_000, details: 'SELLSIDE_SWEEP — $62460' },
    { name: 'ORDER_BLOCK', weight: 15, direction: 'LONG', timestamp: Date.now() - 120_000, details: 'BULLISH OB $62450-$62520' },
    { name: 'ABSORPTION', weight: 8, direction: 'LONG', timestamp: Date.now() - 30_000, details: 'Forte absorption vendeuse à $62470' },
  ],
  createdAt: Date.now(),
  expiresAt: Date.now() + 1_800_000,
  updatedAt: Date.now(),
  timeframe: '5m',
  currentPrice: 62580,
  meta: { rawScore: 48, trendScore: 22, trendMultiplier: 1.055, adjustedScore: 52, hasAnchorSignal: true, clusterBonus: 5 },
};

console.log('Envoi du scénario de test au Risk Desk…');
const verdict = await desk.review(scenario, {
  currentPrice: 62580,
  trend: { trend: 'BULL', score: 22 },
  derivatives: { avgFundingRate: 0.00012, aggregateOIChangePct: 1.4, avgBasisPercent: 0.04, cascadeRisk: 'LOW' },
  structure: {
    '5m': { trend: 'UPTREND' },
    '15m': { trend: 'RANGE' },
  },
  vwap: { vwap: 62410, upperBand2: 62780, lowerBand2: 62040 },
  templateStats: { wins: 6, losses: 4 },
});

if (!verdict) {
  console.error('Échec de la review — voir les logs ci-dessus.');
  process.exit(1);
}

console.log('\n═══ VERDICT ═══');
console.log(`${verdict.verdict} (confiance ${verdict.confidence}%) — ${(verdict.latencyMs / 1000).toFixed(1)}s, ${verdict.model}`);
console.log(`\nBull : ${verdict.bullCase}`);
console.log(`\nBear : ${verdict.bearCase}`);
console.log(`\nRisk : ${verdict.riskNotes}`);
