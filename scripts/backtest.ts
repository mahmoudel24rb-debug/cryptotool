/**
 * Backtest niveau 1 — rejoue l'historique 1m à travers les VRAIS modules du
 * serveur (structure, OB/FVG/liquidité, VWAP, volume profile, feeder de
 * retest, moteur de confluence) avec une horloge virtuelle.
 *
 * Ce qui N'EST PAS rejoué (données tick/carnet absentes) : les détecteurs de
 * microstructure (absorption, spike, velocity, twap, divergence, exhaustion),
 * les dérivés (funding/OI/basis) et le Risk Desk LLM. On teste le squelette
 * structurel du système — celui qui décide des entrées.
 *
 * Fills conservateurs : chemin OHLC intra-bougie (haussière: O→L→H→C,
 * baissière: O→H→L→C), le SL est toujours testé avant les TP à prix égal.
 *
 * Usage : node --import tsx scripts/backtest.ts [--data data/backtest/BTCUSDT-1m.jsonl] [--split 0.67]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { clock } from '../src/server/clock';
import { ConfluenceEngine } from '../src/server/scenarios/confluenceEngine';
import { ZoneRetestFeeder, collectMarketLevels } from '../src/server/scenarios/zoneFeeder';
import { MarketStructureAnalyzer } from '../src/server/structure/marketStructure';
import { OrderBlockDetector } from '../src/server/structure/orderBlocks';
import { FairValueGapDetector } from '../src/server/structure/fairValueGaps';
import { LiquidityDetector } from '../src/server/structure/liquidity';
import { VWAPCalculator } from '../src/server/profile/vwap';
import { VolumeProfileCalculator } from '../src/server/profile/volumeProfile';
import type { Candle as BuilderCandle } from '../src/server/candles/candleBuilder';
import type { NormalizedTrade } from '../src/server/exchanges/types';
import type { HistCandle } from './fetch-history';

// ── Args ──
function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : dflt;
}
const DATA_PATH = arg('data', './data/backtest/BTCUSDT-1m.jsonl');
const SPLIT_RATIO = Number(arg('split', '0.67')); // optimisation | validation

// ── Config (la même que le live) ──
const config = JSON.parse(readFileSync('./config.json', 'utf-8'));

// ── Horloge virtuelle ──
let vnow = 0;
clock.set(() => vnow);

// ── Données ──
if (!existsSync(DATA_PATH)) {
  console.error(`Données introuvables : ${DATA_PATH} — lance d'abord "npm run fetch:history"`);
  process.exit(1);
}
console.log(`Chargement de ${DATA_PATH}...`);
const candles: HistCandle[] = readFileSync(DATA_PATH, 'utf-8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));
console.log(`${candles.length} bougies 1m (${new Date(candles[0].time * 1000).toISOString().slice(0, 10)} → ${new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10)})`);

// ── Modules (construction identique à engine.ts) ──
const structureConfig = config.structure || {};
const obConfig = config.orderBlocks || {};
const fvgConfig = config.fvg || {};
const liqConfig = config.liquidity || {};
const vpConfig = config.volumeProfile || {};
const conflConfig = config.confluence || {};

const TFS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900 };
const structureAnalyzers = new Map<string, MarketStructureAnalyzer>();
const obDetectors = new Map<string, OrderBlockDetector>();
const fvgDetectors = new Map<string, FairValueGapDetector>();
const liqDetectors = new Map<string, LiquidityDetector>();
const lookbacks: Record<string, number> = {
  '1m': structureConfig.lookback1m ?? 3,
  '5m': structureConfig.lookback5m ?? 5,
  '15m': structureConfig.lookback15m ?? 5,
};
for (const tf of Object.keys(TFS)) {
  structureAnalyzers.set(tf, new MarketStructureAnalyzer(
    { lookback: lookbacks[tf] },
    { minDisplacementATR: structureConfig.minDisplacementATR ?? 1.5, atrPeriod: structureConfig.atrPeriod ?? 14 },
    tf,
  ));
  obDetectors.set(tf, new OrderBlockDetector({
    minDisplacementATR: obConfig.minDisplacementATR ?? 1.5,
    requireFVG: obConfig.requireFVG ?? false,
    maxActiveOBs: obConfig.maxActiveOBs ?? 50,
    autoRemoveMitigated: obConfig.autoRemoveMitigated ?? true,
  }, tf));
  fvgDetectors.set(tf, new FairValueGapDetector({
    minSizeATR: fvgConfig.minSizeATR ?? 0.3,
    trackFilling: fvgConfig.trackFilling ?? true,
    maxActiveFVGs: fvgConfig.maxActiveFVGs ?? 60,
  }, tf));
  liqDetectors.set(tf, new LiquidityDetector({
    equalLevelThreshold: liqConfig.equalLevelThreshold ?? 0.05,
    minTouches: liqConfig.minTouches ?? 2,
    sweepConfirmationCandles: liqConfig.sweepConfirmationCandles ?? 3,
  }, tf));
}
const vwapCalculator = new VWAPCalculator({ sessionResetHour: config.vwap?.sessionResetHour ?? 0, showBands: true });
const volumeProfile = new VolumeProfileCalculator({
  numBins: vpConfig.numBins ?? 50,
  valueAreaPercent: vpConfig.valueAreaPercent ?? 70,
  sessionResetHour: vpConfig.sessionResetHour ?? 0,
});

// ── Trend provider simplifié (pas de trades/carnet en backtest) ──
// EMA 20/100 sur closes 1m + biais de delta sur 30 bougies → score -100..100
let ema20 = 0, ema100 = 0;
const deltaWin: number[] = [];
const volWin: number[] = [];
let trendScore = 0;
function updateTrend(c: HistCandle) {
  ema20 = ema20 === 0 ? c.close : ema20 + (c.close - ema20) * (2 / 21);
  ema100 = ema100 === 0 ? c.close : ema100 + (c.close - ema100) * (2 / 101);
  deltaWin.push(c.delta); volWin.push(c.volume);
  if (deltaWin.length > 30) { deltaWin.shift(); volWin.shift(); }
  const emaPct = ema100 > 0 ? ((ema20 - ema100) / ema100) * 100 : 0;
  const sumVol = volWin.reduce((a, b) => a + b, 0);
  const deltaRatio = sumVol > 0 ? deltaWin.reduce((a, b) => a + b, 0) / sumVol : 0;
  trendScore = Math.max(-100, Math.min(100, Math.round(emaPct * 350 + deltaRatio * 60)));
}
const trendProvider = {
  analyze: () => ({
    trend: trendScore > 15 ? 'BULL' : trendScore < -15 ? 'BEAR' : 'NEUTRAL',
    score: trendScore,
  }),
};

// ── Moteur de confluence en mode backtest ──
const outcomes: any[] = [];
const confluence = new ConfluenceEngine({
  weights: conflConfig.weights || undefined,
  minScoreForScenario: conflConfig.minScoreForScenario ?? 35,
  highPriorityThreshold: conflConfig.highPriorityThreshold ?? 55,
  extremePriorityThreshold: conflConfig.extremePriorityThreshold ?? 75,
  scenarioExpirationMs: conflConfig.scenarioExpirationMs ?? 1800000,
  maxActiveScenarios: conflConfig.maxActiveScenarios ?? 4,
  minRiskReward: conflConfig.minRiskReward ?? 1.2,
  slBufferPercent: conflConfig.slBufferPercent ?? 0.25,
}, {
  loadTemplateStats: false,
  quiet: true,
  syncEvaluation: true,
  outcomeSink: (o) => outcomes.push(o),
});
confluence.setTrendProvider(trendProvider);

// Tally des signaux par type (diagnostic) — toutes les alimentations passent par là
const signalTally = new Map<string, number>();
function feedSignal(s: Parameters<typeof confluence.addSignal>[0]) {
  signalTally.set(s.type, (signalTally.get(s.type) ?? 0) + 1);
  confluence.addSignal(s);
}
const feeder = new ZoneRetestFeeder(obDetectors, fvgDetectors, feedSignal);

// ── Pipeline par clôture de bougie TF (miroir du handler candle:close d'engine.ts) ──
function toBuilderCandle(c: HistCandle): BuilderCandle {
  return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    volume: c.volume, buyVolume: c.buyVolume, sellVolume: c.sellVolume, delta: c.delta, trades: c.trades };
}

const tfArrays: Record<string, BuilderCandle[]> = { '1m': [], '5m': [], '15m': [] };
const tfPartial: Record<string, BuilderCandle | null> = { '5m': null, '15m': null };

function onTfClose(tf: string) {
  const arr = tfArrays[tf];
  const last = arr[arr.length - 1];
  const analyzer = structureAnalyzers.get(tf)!;
  const fvgDetector = fvgDetectors.get(tf)!;
  const liqDetector = liqDetectors.get(tf)!;
  const obDetector = obDetectors.get(tf)!;

  const breaks = analyzer.onCandleClose(arr);
  if (tf === '1m') {
    const atr = analyzer.getATR();
    if (atr > 0) confluence.updateATR(atr);
  }

  const fvg = fvgDetector.onCandleClose(arr);
  if (fvg) {
    feedSignal({
      type: 'FVG', direction: fvg.type === 'BULLISH' ? 'LONG' : 'SHORT',
      price: (fvg.low + fvg.high) / 2, zoneLow: fvg.low, zoneHigh: fvg.high,
      timeframe: tf, timestamp: clock.now(),
      details: { description: `${fvg.type} FVG` },
    });
  }
  fvgDetector.updateFilling(last.high, last.low);

  const state = analyzer.getState();
  liqDetector.updatePools(state.swingHighs, state.swingLows);
  const sweep = liqDetector.checkSweeps(arr);
  if (sweep) {
    feedSignal({
      type: 'LIQUIDITY_SWEEP', direction: sweep.type === 'BUYSIDE_SWEEP' ? 'SHORT' : 'LONG',
      price: sweep.pool.level, timeframe: tf, timestamp: clock.now(),
      details: { description: sweep.type },
    });
  }

  for (const brk of breaks) {
    feedSignal({
      type: brk.type, direction: brk.direction === 'BULLISH' ? 'LONG' : 'SHORT',
      price: brk.breakPrice, timeframe: tf, timestamp: clock.now(),
      details: { description: `${brk.type} ${brk.direction} ${tf}` },
    });
    const ob = obDetector.onStructureBreak(brk, arr, fvgDetector.getActiveFVGs());
    if (ob) {
      feedSignal({
        type: 'ORDER_BLOCK', direction: ob.type === 'BULLISH' ? 'LONG' : 'SHORT',
        price: (ob.low + ob.high) / 2, zoneLow: ob.low, zoneHigh: ob.high,
        strength: Math.min(1, ob.strength / 100), timeframe: tf, timestamp: clock.now(),
        details: { description: `${ob.type} OB` },
      });
    }
  }
  obDetector.updateLifecycle(last.close, last.close);

  if (arr.length > 2000) arr.splice(0, arr.length - 1600); // même horizon borné qu'en live
}

// ── Signaux de contexte (VWAP ±2σ, POC) avec le même cooldown 2 min qu'en live ──
const CONTEXT_COOLDOWN = 120_000;
let lastVwapSig = 0, lastPocSig = 0;
let lastVp: { poc: number; vah: number; val: number } | null = null;

function contextSignals(price: number) {
  const vwapData = vwapCalculator.getData();
  if (vwapData.vwap > 0 && vwapData.lowerBand2 > 0 && clock.now() - lastVwapSig >= CONTEXT_COOLDOWN) {
    if (price <= vwapData.lowerBand2) {
      lastVwapSig = clock.now();
      feedSignal({ type: 'VWAP_POSITION', direction: 'LONG', price, timestamp: clock.now(), details: { description: 'VWAP -2σ' } });
    } else if (price >= vwapData.upperBand2) {
      lastVwapSig = clock.now();
      feedSignal({ type: 'VWAP_POSITION', direction: 'SHORT', price, timestamp: clock.now(), details: { description: 'VWAP +2σ' } });
    }
  }
  if (lastVp && lastVp.poc > 0 && clock.now() - lastPocSig >= CONTEXT_COOLDOWN) {
    if (Math.abs(price - lastVp.poc) / lastVp.poc < 0.001) {
      lastPocSig = clock.now();
      feedSignal({ type: 'VOLUME_PROFILE', direction: price > lastVp.poc ? 'SHORT' : 'LONG', price, timestamp: clock.now(), details: { description: 'POC' } });
    }
  }
}

// ── Replay ──
console.log('Replay en cours...');
const t0 = Date.now();
let processed = 0;

for (const c of candles) {
  const baseMs = c.time * 1000;

  // Chemin de prix intra-bougie (conservateur : le pire extrême est visité)
  const bullish = c.close >= c.open;
  const path = bullish ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
  const offsets = [1_000, 20_000, 40_000, 59_000];
  for (let i = 0; i < 4; i++) {
    vnow = baseMs + offsets[i];
    confluence.updatePrice(path[i]);
    confluence.tick();
  }

  // Alimentation VWAP / volume profile (pseudo-trades au prix typique, volumes réels par côté)
  const typical = (c.high + c.low + c.close) / 3;
  const buyTrade: NormalizedTrade = { exchange: 'BT', market: 'PERP', symbol: 'BTCUSDT', price: typical, quantity: 0, side: 'BUY', timestamp: vnow, usdValue: c.buyVolume };
  const sellTrade: NormalizedTrade = { ...buyTrade, side: 'SELL', usdValue: c.sellVolume };
  vwapCalculator.onTrade(buyTrade);
  vwapCalculator.onTrade(sellTrade);
  volumeProfile.onTrade(buyTrade);
  volumeProfile.onTrade(sellTrade);

  // Agrégation multi-TF + pipelines de clôture
  tfArrays['1m'].push(toBuilderCandle(c));
  onTfClose('1m');
  for (const tf of ['5m', '15m'] as const) {
    const sec = TFS[tf];
    const bucket = Math.floor(c.time / sec) * sec;
    let p = tfPartial[tf];
    if (!p || p.time !== bucket) {
      if (p) { tfArrays[tf].push(p); onTfClose(tf); }
      p = { ...toBuilderCandle(c), time: bucket };
      tfPartial[tf] = p;
    } else {
      p.high = Math.max(p.high, c.high); p.low = Math.min(p.low, c.low);
      p.close = c.close; p.volume += c.volume; p.buyVolume += c.buyVolume;
      p.sellVolume += c.sellVolume; p.delta += c.delta; p.trades += c.trades;
    }
  }

  // Trend, contexte, retests, niveaux
  updateTrend(c);
  contextSignals(c.close);
  feeder.check(c.close);
  if (processed % 5 === 0) {
    lastVp = volumeProfile.getData();
    confluence.updateMarketLevels(collectMarketLevels(structureAnalyzers, liqDetectors, lastVp));
  }

  processed++;
  if (processed % 50_000 === 0) console.log(`  ${processed}/${candles.length} bougies...`);
}

console.log(`Replay terminé en ${((Date.now() - t0) / 1000).toFixed(1)}s — ${outcomes.length} scénarios clôturés`);
const es = confluence.getEvalStats();
console.log(`Éval: ${es.calls} appels | noAnchor=${es.noAnchor} lowScore=${es.lowScore} counterBlock=${es.counterBlocked} regimeBlock=${es.regimeBlocked} noTemplate=${es.noTemplate} dup=${es.duplicate} lowRR=${es.lowRR} badZone=${es.badZone} émis=${es.emitted}`);
console.log('Signaux: ' + [...signalTally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
const reasons = new Map<string, number>();
for (const o of outcomes) {
  const r = o.tp3Hit ? 'TP3' : o.tp2Hit ? 'TP2 puis sortie' : o.tp1Hit ? 'TP1 puis sortie'
    : String(o.exitReason).includes('Stop-loss') ? 'SL sec' : String(o.exitReason).slice(0, 30);
  reasons.set(r, (reasons.get(r) ?? 0) + 1);
}
console.log('Sorties: ' + [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' | ') + '\n');

// ── Rapport ──
interface Row { n: number; wins: number; sumR: number; }
function newRow(): Row { return { n: 0, wins: 0, sumR: 0 }; }

// Frais aller-retour en % (défaut 0.05% : entrée limit maker + sorties mixtes).
// Exprimés en R via entryMid/risk — les trades au risque serré payent plus cher.
const FEES_PCT = Number(arg('fees', '0.05')) / 100;

function realizedR(o: any): number {
  const dir = o.direction === 'LONG' ? 1 : -1;
  const risk = o.initialRisk;
  if (!risk || risk <= 0) return 0;
  // R mesuré depuis le fill réel (prix d'activation), pas le milieu de zone
  const fill = o.activationPrice ?? o.entryMid;
  const rOf = (px: number) => dir * (px - fill) / risk;
  const exit = o.exitPrice ?? fill;
  const feesR = FEES_PCT * fill / risk;
  let gross: number;
  if (o.tp3Hit) gross = (rOf(o.tp1) + rOf(o.tp2) + rOf(o.tp3)) / 3;
  else if (o.tp2Hit) gross = (rOf(o.tp1) + rOf(o.tp2) + rOf(exit)) / 3;
  else if (o.tp1Hit) gross = (rOf(o.tp1) + 2 * rOf(exit)) / 3;
  else gross = rOf(exit);
  return gross - feesR;
}

const trades = outcomes.filter(o => o.wasActive);
const neverFilled = outcomes.length - trades.length;
const splitIdx = Math.floor(candles.length * SPLIT_RATIO);
const splitTs = candles[Math.min(splitIdx, candles.length - 1)].time * 1000;

function bucketize(rows: any[], keyFn: (o: any) => string): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const o of rows) {
    const k = keyFn(o);
    let r = m.get(k); if (!r) { r = newRow(); m.set(k, r); }
    r.n++; if (o.tp1Hit) r.wins++; r.sumR += realizedR(o);
  }
  return m;
}
function fmtRow(label: string, r: Row): string {
  const wr = r.n > 0 ? (r.wins / r.n * 100).toFixed(0) : '—';
  const exp = r.n > 0 ? (r.sumR / r.n).toFixed(2) : '—';
  return `${label.padEnd(34)} n=${String(r.n).padStart(4)}  WR=${String(wr).padStart(3)}%  E[R]=${String(exp).padStart(6)}  ΣR=${r.sumR.toFixed(1)}`;
}
function report(title: string, rows: any[]) {
  console.log(`\n═══ ${title} — ${rows.length} trades ═══`);
  const all = newRow();
  for (const o of rows) { all.n++; if (o.tp1Hit) all.wins++; all.sumR += realizedR(o); }
  console.log(fmtRow('GLOBAL', all));
  console.log('— par template —');
  for (const [k, r] of [...bucketize(rows, o => o.template)].sort((a, b) => b[1].n - a[1].n)) console.log(fmtRow(k, r));
  console.log('— par timeframe —');
  for (const [k, r] of bucketize(rows, o => o.timeframe)) console.log(fmtRow(k, r));
  console.log('— par direction —');
  for (const [k, r] of bucketize(rows, o => o.direction)) console.log(fmtRow(k, r));
  console.log('— par régime de trend à la création —');
  for (const [k, r] of bucketize(rows, o => Math.abs(o.trendScore) < 15 ? 'NEUTRAL' : (o.trendScore > 0 ? 'BULL' : 'BEAR'))) console.log(fmtRow(k, r));
}

console.log(`Scénarios émis: ${outcomes.length} | jamais remplis (entrée manquée/expirée): ${neverFilled} | trades réels: ${trades.length}`);
report(`OPTIMISATION (jusqu'au ${new Date(splitTs).toISOString().slice(0, 10)})`, trades.filter(o => o.createdAt < splitTs));
report(`VALIDATION (après ${new Date(splitTs).toISOString().slice(0, 10)})`, trades.filter(o => o.createdAt >= splitTs));

// Drawdown global en R (ordre chronologique)
const sorted = [...trades].sort((a, b) => a.createdAt - b.createdAt);
let cum = 0, peak = 0, maxDd = 0;
for (const o of sorted) { cum += realizedR(o); peak = Math.max(peak, cum); maxDd = Math.min(maxDd, cum - peak); }
console.log(`\nΣR total: ${cum.toFixed(1)}R | max drawdown: ${maxDd.toFixed(1)}R`);

writeFileSync('./data/backtest/report.json', JSON.stringify({ generatedAt: Date.now(), trades: trades.length, neverFilled, outcomes }, null, 1));
console.log('Détail complet → data/backtest/report.json');

clock.reset();
