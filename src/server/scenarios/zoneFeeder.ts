/**
 * Feeder de retest de zones + collecte des niveaux structurels.
 *
 * Module PARTAGÉ entre le moteur live (engine.ts) et le harnais de backtest
 * (scripts/backtest.ts) — une seule implémentation, zéro divergence entre ce
 * qui est testé et ce qui tourne en production.
 */

import { clock } from '../clock';
import { OrderBlockDetector } from '../structure/orderBlocks';
import { FairValueGapDetector } from '../structure/fairValueGaps';
import { LiquidityDetector } from '../structure/liquidity';
import { MarketStructureAnalyzer } from '../structure/marketStructure';
import type { ConfluenceSignal } from './types';

const ZONE_SIGNAL_COOLDOWN_MS = 10 * 60 * 1000; // un signal par zone par 10 min
const RETEST_MIN_AGE_MS = 3 * 60 * 1000;        // les zones fraîches ont déjà émis leur signal de création

/**
 * Émet OB_RETEST / FVG_FILL quand le prix re-entre dans une zone active.
 * NB : ob.timestamp et fvg.timestamp sont des temps de BOUGIE en SECONDES
 * (l'ancienne comparaison directe avec des millisecondes rendait le filtre
 * d'âge inopérant).
 */
export class ZoneRetestFeeder {
  private lastZoneSignalAt = new Map<string, number>();

  constructor(
    private obDetectors: Map<string, OrderBlockDetector>,
    private fvgDetectors: Map<string, FairValueGapDetector>,
    private feed: (signal: ConfluenceSignal) => void,
  ) {}

  check(price: number): void {
    const nowMs = clock.now();
    if (this.lastZoneSignalAt.size > 500) this.lastZoneSignalAt.clear(); // borne mémoire

    for (const [tf, obDetector] of this.obDetectors.entries()) {
      for (const ob of obDetector.getActiveOBs()) {
        if (ob.mitigated) continue;
        if (nowMs - ob.timestamp * 1000 < RETEST_MIN_AGE_MS) continue;
        if (price < ob.low || price > ob.high) continue;
        const zk = `OB:${ob.id}`;
        if (nowMs - (this.lastZoneSignalAt.get(zk) ?? 0) < ZONE_SIGNAL_COOLDOWN_MS) continue;
        this.lastZoneSignalAt.set(zk, nowMs);
        this.feed({
          type: 'OB_RETEST',
          direction: ob.type === 'BULLISH' ? 'LONG' : 'SHORT',
          price: ob.midpoint,
          zoneLow: ob.low,
          zoneHigh: ob.high,
          strength: 0.5 + Math.min(50, ob.strength) / 100, // 0.5-1.0 — une zone tenue retestée EST le setup
          timeframe: tf,
          timestamp: nowMs,
          details: { description: `Retest ${ob.type} OB ${tf} $${ob.low.toFixed(0)}-$${ob.high.toFixed(0)}` },
        });
      }
    }

    for (const [tf, fvgDetector] of this.fvgDetectors.entries()) {
      for (const fvg of fvgDetector.getActiveFVGs()) {
        if (fvg.filled) continue;
        if (nowMs - fvg.timestamp * 1000 < RETEST_MIN_AGE_MS) continue;
        if (price < fvg.low || price > fvg.high) continue;
        const zk = `FVG:${fvg.id}`;
        if (nowMs - (this.lastZoneSignalAt.get(zk) ?? 0) < ZONE_SIGNAL_COOLDOWN_MS) continue;
        this.lastZoneSignalAt.set(zk, nowMs);
        this.feed({
          type: 'FVG_FILL',
          direction: fvg.type === 'BULLISH' ? 'LONG' : 'SHORT',
          price: (fvg.low + fvg.high) / 2,
          zoneLow: fvg.low,
          zoneHigh: fvg.high,
          strength: Math.max(0.4, 1 - fvg.filledPercent / 100),
          timeframe: tf,
          timestamp: nowMs,
          details: { description: `Fill ${fvg.type} FVG ${tf} $${fvg.low.toFixed(0)}-$${fvg.high.toFixed(0)}` },
        });
      }
    }
  }
}

/** Niveaux opposés pour le cap des TP : swings non cassés, pools actifs, POC/VAH/VAL */
export function collectMarketLevels(
  structureAnalyzers: Map<string, MarketStructureAnalyzer>,
  liqDetectors: Map<string, LiquidityDetector>,
  vpData: { poc: number; vah: number; val: number } | null,
): number[] {
  const levels: number[] = [];
  for (const [, analyzer] of structureAnalyzers.entries()) {
    const state = analyzer.getState();
    for (const sh of state.swingHighs) if (!sh.broken) levels.push(sh.price);
    for (const sl of state.swingLows) if (!sl.broken) levels.push(sl.price);
  }
  for (const [, liqDetector] of liqDetectors.entries()) {
    for (const pool of liqDetector.getActivePools()) {
      if (!pool.swept) levels.push(pool.level);
    }
  }
  if (vpData) {
    if (vpData.poc > 0) levels.push(vpData.poc);
    if (vpData.vah > 0) levels.push(vpData.vah);
    if (vpData.val > 0) levels.push(vpData.val);
  }
  return levels;
}
