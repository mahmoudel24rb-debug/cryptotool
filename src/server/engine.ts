import { NormalizedTrade, OrderBook, Liquidation } from './exchanges/types';
import { BaseExchangeConnector } from './exchanges/base';
import { BinanceConnector } from './exchanges/binance';
import { BybitConnector } from './exchanges/bybit';
import { CoinbaseConnector } from './exchanges/coinbase';
import { HyperliquidConnector } from './exchanges/hyperliquid';
import { OkxConnector } from './exchanges/okx';
import { Alert } from './detectors/types';
import { AbsorptionDetector } from './detectors/absorption';
import { DivergenceDetector } from './detectors/divergence';
import { ExhaustionDetector } from './detectors/exhaustion';
import { SpikeDetector } from './detectors/spike';
import { VelocityDetector } from './detectors/velocity';
import { TwapDetector } from './detectors/twap';
import { LiquidationDetector } from './detectors/liquidation';
import { MetricsCalculator } from './metrics';
import { TrendAnalyzer } from './trendAnalyzer';
import { CandleBuilder, Candle as CandleBuilderCandle } from './candles/candleBuilder';
import { MarketStructureAnalyzer } from './structure/marketStructure';
import { OrderBlockDetector } from './structure/orderBlocks';
import { FairValueGapDetector } from './structure/fairValueGaps';
import { LiquidityDetector } from './structure/liquidity';
import { VWAPCalculator } from './profile/vwap';
import { VolumeProfileCalculator } from './profile/volumeProfile';
import { OpenInterestTracker } from './derivatives/openInterest';
import { FundingRateMonitor } from './derivatives/fundingRate';
import { BasisTracker } from './derivatives/basis';
import type { DerivativesState } from './derivatives/types';
import { ConfluenceEngine } from './scenarios/confluenceEngine';
import { ZoneRetestFeeder, collectMarketLevels } from './scenarios/zoneFeeder';
import type { ConfluenceSignal } from './scenarios/types';
import { RiskDesk, buildVerdictTrackRecord, type RiskDeskContext } from './llm/riskDesk';
import { readFileSync, existsSync } from 'fs';

type BroadcastFn = (type: string, data: unknown) => void;
type SendToClientFn = (ws: any, type: string, data: unknown) => void;
type GetInitialSyncClientsFn = () => any[];

// Circular buffer for trades — optimized with binary search for getRecent
class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T) {
    this.buffer.push(item);
    if (this.buffer.length > this.maxSize) {
      // Remove oldest 10% in batch to avoid shift() per trade
      const removeCount = Math.floor(this.maxSize * 0.1);
      this.buffer.splice(0, removeCount);
    }
  }

  pushMany(items: T[]) {
    for (const item of items) this.push(item);
  }

  getAll(): T[] {
    return this.buffer;
  }

  /** Optimized: binary search for cutoff timestamp instead of .filter() on all items */
  getRecent(ms: number): T[] {
    const cutoff = Date.now() - ms;
    // Binary search for first item >= cutoff (buffer is chronologically ordered)
    let lo = 0, hi = this.buffer.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.buffer[mid] as any).timestamp < cutoff) lo = mid + 1;
      else hi = mid;
    }
    return this.buffer.slice(lo);
  }

  get length(): number {
    return this.buffer.length;
  }

  clear() {
    this.buffer = [];
  }
}

export function startEngine(
  config: any,
  broadcast: BroadcastFn,
  sendToClient?: SendToClientFn,
  getInitialSyncClients?: GetInitialSyncClientsFn,
) {
  console.log('[ENGINE] Starting order flow engine...');

  // Per-exchange recent-trade buffers feed the detectors. A single combined
  // 100k-trade buffer forced every detector pass to slice + scan ~100k trades
  // (and churned the GC) — the cost scaled with volume until the event loop
  // froze. One bounded buffer per exchange keeps each detector input small.
  const PER_EXCHANGE_BUFFER = 15000;
  const tradeBuffersByExchange = new Map<string, CircularBuffer<NormalizedTrade>>();
  function getTradeBuffer(key: string): CircularBuffer<NormalizedTrade> {
    let b = tradeBuffersByExchange.get(key);
    if (!b) { b = new CircularBuffer<NormalizedTrade>(PER_EXCHANGE_BUFFER); tradeBuffersByExchange.set(key, b); }
    return b;
  }
  function totalBufferedTrades(): number {
    let n = 0;
    for (const b of tradeBuffersByExchange.values()) n += b.length;
    return n;
  }

  const liquidationBuffer = new CircularBuffer<Liquidation>(10000);
  const orderBooks = new Map<string, OrderBook>();

  // Initialize detectors
  const detectors = {
    absorption: new AbsorptionDetector(config.detectors.absorption),
    divergence: new DivergenceDetector(config.detectors.divergence),
    exhaustion: new ExhaustionDetector(config.detectors.exhaustion),
    spike: new SpikeDetector(config.detectors.spike),
    velocity: new VelocityDetector(config.detectors.velocity),
    twap: new TwapDetector(config.detectors.twap),
    liquidation: new LiquidationDetector(config.detectors.liquidation),
  };

  const metrics = new MetricsCalculator();
  const trendAnalyzer = new TrendAnalyzer();

  // ── Phase A: Structure Analysis & VWAP ──
  const structureConfig = config.structure || {};
  const vwapConfig = config.vwap || {};

  // Multi-timeframe candle builder (aggregated across all exchanges)
  const candleBuilder = new CandleBuilder({ maxCandles: 4500 });

  // Market structure analyzers per timeframe
  const structureAnalyzers = new Map<string, MarketStructureAnalyzer>();
  const structureTimeframes: Record<string, { lookback: number }> = {
    '1m':  { lookback: structureConfig.lookback1m  ?? 3 },
    '5m':  { lookback: structureConfig.lookback5m  ?? 5 },
    '15m': { lookback: structureConfig.lookback15m ?? 5 },
  };

  for (const [tf, cfg] of Object.entries(structureTimeframes)) {
    const analyzer = new MarketStructureAnalyzer(
      { lookback: cfg.lookback },
      {
        minDisplacementATR: structureConfig.minDisplacementATR ?? 1.5,
        atrPeriod: structureConfig.atrPeriod ?? 14,
      },
      tf,
    );
    structureAnalyzers.set(tf, analyzer);
  }

  // VWAP calculator
  const vwapCalculator = new VWAPCalculator({
    sessionResetHour: vwapConfig.sessionResetHour ?? 0,
    showBands: vwapConfig.showBands ?? true,
  });

  // ── Phase B: Order Blocks, FVGs, Liquidity, Volume Profile ──
  const obConfig = config.orderBlocks || {};
  const fvgConfig = config.fvg || {};
  const liqConfig = config.liquidity || {};
  const vpConfig = config.volumeProfile || {};

  // Order Block detectors per timeframe
  const obDetectors = new Map<string, OrderBlockDetector>();
  for (const tf of Object.keys(structureTimeframes)) {
    obDetectors.set(tf, new OrderBlockDetector({
      minDisplacementATR: obConfig.minDisplacementATR ?? 1.5,
      requireFVG: obConfig.requireFVG ?? false,
      maxActiveOBs: obConfig.maxActiveOBs ?? 50,
      autoRemoveMitigated: obConfig.autoRemoveMitigated ?? true,
    }, tf));
  }

  // FVG detectors per timeframe
  const fvgDetectors = new Map<string, FairValueGapDetector>();
  for (const tf of Object.keys(structureTimeframes)) {
    fvgDetectors.set(tf, new FairValueGapDetector({
      minSizeATR: fvgConfig.minSizeATR ?? 0.3,
      trackFilling: fvgConfig.trackFilling ?? true,
      maxActiveFVGs: fvgConfig.maxActiveFVGs ?? 60,
    }, tf));
  }

  // Liquidity detectors per timeframe
  const liqDetectors = new Map<string, LiquidityDetector>();
  for (const tf of Object.keys(structureTimeframes)) {
    liqDetectors.set(tf, new LiquidityDetector({
      equalLevelThreshold: liqConfig.equalLevelThreshold ?? 0.05,
      minTouches: liqConfig.minTouches ?? 2,
      sweepConfirmationCandles: liqConfig.sweepConfirmationCandles ?? 3,
    }, tf));
  }

  // Volume Profile calculator
  const volumeProfile = new VolumeProfileCalculator({
    numBins: vpConfig.numBins ?? 50,
    valueAreaPercent: vpConfig.valueAreaPercent ?? 70,
    sessionResetHour: vpConfig.sessionResetHour ?? 0,
  });

  // ── Phase C: Derivatives (OI, Funding, Basis) ──
  const derivConfig = config.derivatives || {};

  const oiTracker = new OpenInterestTracker({
    pollIntervalMs: derivConfig.oiPollIntervalMs ?? 10000,
    alertThresholdPercent: derivConfig.oiAlertThresholdPercent ?? 2,
    windowMinutes: derivConfig.oiWindowMinutes ?? 5,
  });

  const fundingMonitor = new FundingRateMonitor({
    pollIntervalMs: derivConfig.fundingPollIntervalMs ?? 30000,
    extremePositiveThreshold: derivConfig.fundingExtremePositive ?? 0.0005,
    extremeNegativeThreshold: derivConfig.fundingExtremeNegative ?? -0.0003,
    flipDetection: derivConfig.fundingFlipDetection ?? true,
  });

  const basisTracker = new BasisTracker({
    updateIntervalMs: derivConfig.basisUpdateIntervalMs ?? 1000,
    extremeThresholdPercent: derivConfig.basisExtremeThresholdPercent ?? 0.1,
    crossExchangeDivergencePercent: derivConfig.basisDivergencePercent ?? 0.05,
  });

  // Wire derivative alerts (queued — all alerts go out batched in one WS frame)
  const emitDerivAlert = (type: string, msg: string, details: any) => {
    queueAlert({
      id: `DERIV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      market: 'AGGREGATE',
      exchange: details.exchange || 'ALL',
      symbol: config.symbol || 'BTC',
      timestamp: Date.now(),
      message: msg,
      details,
    } as any);
  };

  // Start OI and funding pollers
  oiTracker.start();
  fundingMonitor.start();

  // ── Phase D: Confluence Engine ──
  const conflConfig = config.confluence || {};
  const confluenceEngine = new ConfluenceEngine({
    weights: conflConfig.weights || undefined,
    minScoreForScenario: conflConfig.minScoreForScenario ?? 35,
    highPriorityThreshold: conflConfig.highPriorityThreshold ?? 55,
    extremePriorityThreshold: conflConfig.extremePriorityThreshold ?? 75,
    scenarioExpirationMs: conflConfig.scenarioExpirationMs ?? 1800000,
    maxActiveScenarios: conflConfig.maxActiveScenarios ?? 4,
    minRiskReward: conflConfig.minRiskReward ?? 1.5,
    slBufferPercent: conflConfig.slBufferPercent ?? 0.25,
  });

  // Phase 1.1: Inject TrendAnalyzer into ConfluenceEngine
  confluenceEngine.setTrendProvider(trendAnalyzer);

  // Phase 5: Restore active scenarios from disk (survive restarts)
  confluenceEngine.loadState();
  confluenceEngine.startStatePersistence();

  // Graceful shutdown: save state before exit
  const gracefulShutdown = () => {
    console.log('[ENGINE] Saving scenario state before shutdown...');
    confluenceEngine.saveState();
    process.exit(0);
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // ── LLM Risk Desk: second avis sur les scénarios (pattern TradingAgents) ──
  const riskDesk = new RiskDesk(config.llm || {});
  let lastDerivState: any = null; // capturé par l'intervalle de broadcast dérivés

  function buildRiskDeskContext(): RiskDeskContext {
    const structure: RiskDeskContext['structure'] = {};
    for (const [tf, analyzer] of structureAnalyzers.entries()) {
      const state = analyzer.getState();
      structure[tf] = { trend: state.trend, lastBOS: state.lastBOS, lastCHoCH: state.lastCHoCH };
    }
    const vwapData = vwapCalculator.getData();
    return {
      currentPrice: confluenceEngine.getCurrentPrice(),
      trend: trendAnalyzer.analyze(),
      derivatives: lastDerivState ? {
        avgFundingRate: lastDerivState.avgFundingRate,
        aggregateOIChangePct: lastDerivState.aggregateOIChangePct,
        avgBasisPercent: lastDerivState.avgBasisPercent,
        cascadeRisk: lastDerivState.cascadeRisk,
      } : null,
      structure,
      vwap: vwapData.vwap > 0 ? {
        vwap: vwapData.vwap,
        upperBand2: vwapData.upperBand2,
        lowerBand2: vwapData.lowerBand2,
      } : null,
    };
  }

  confluenceEngine.onScenario((event, scenario) => {
    broadcast(event, scenario);
    // State persistence is handled by the engine's dirty-flag periodic saver —
    // a synchronous write per event used to stall the event loop during big moves

    // Review LLM asynchrone des nouveaux scénarios — n'ajoute aucune latence
    // au moteur : le verdict arrive quelques secondes plus tard via
    // applyLlmVerdict, qui re-broadcaste un scenario:update
    if (event === 'scenario:new' && riskDesk.shouldReview(scenario)) {
      const context = buildRiskDeskContext();
      context.templateStats = confluenceEngine.getTemplateStatsFor(scenario.templateId);
      // Boucle de feedback : l'IA voit les résultats réels de ses derniers
      // verdicts (30 derniers trades clôturés) pour s'auto-calibrer
      try {
        const logPath = './data/scenario_outcomes.jsonl';
        if (existsSync(logPath)) {
          const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).slice(-30);
          context.verdictTrackRecord = buildVerdictTrackRecord(
            lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any[],
          );
        }
      } catch { /* le feedback est optionnel — jamais bloquant */ }
      void riskDesk.review(scenario, context).then(verdict => {
        if (verdict) confluenceEngine.applyLlmVerdict(scenario.id, verdict, riskDesk.vetoOnReject, riskDesk.observerMode);
      });
    }
  });

  // Helper: feed a signal into the confluence engine
  function feedConfluence(signal: ConfluenceSignal) {
    confluenceEngine.addSignal(signal);
  }

  // Wire derivative alerts (after confluence engine so we can feed them)
  oiTracker.onAlert((alert) => {
    emitDerivAlert('OI', `${alert.type} — ${alert.exchange} — OI ${alert.oiChangePercent > 0 ? '+' : ''}${alert.oiChangePercent.toFixed(1)}% | ${alert.interpretation}`, alert);
    feedConfluence({
      type: alert.type,
      direction: alert.oiChangePercent > 0 && alert.priceChangePercent > 0 ? 'LONG'
        : alert.oiChangePercent > 0 && alert.priceChangePercent < 0 ? 'SHORT'
        : alert.oiChangePercent < 0 && alert.priceChangePercent > 0 ? 'LONG' // short squeeze
        : 'SHORT', // long squeeze
      price: confluenceEngine.getCurrentPrice() || 0,
      timestamp: Date.now(),
      details: { description: alert.interpretation },
    });
  });

  fundingMonitor.onAlert((alert) => {
    emitDerivAlert('FUNDING', `${alert.type} — ${alert.exchange} — Rate ${(alert.currentRate * 100).toFixed(4)}% | ${alert.interpretation}`, alert);
    feedConfluence({
      type: 'FUNDING_EXTREME',
      direction: alert.currentRate > 0 ? 'SHORT' : 'LONG', // high funding = bearish, negative = bullish
      price: confluenceEngine.getCurrentPrice() || 0,
      timestamp: Date.now(),
      details: { description: alert.interpretation },
    });
  });

  basisTracker.onAlert((alert) => {
    emitDerivAlert('BASIS', `${alert.type} — ${alert.description}`, alert);
    feedConfluence({
      type: 'BASIS_EXTREME',
      direction: alert.exchanges?.[0]?.basisPercent > 0 ? 'SHORT' : 'LONG',
      price: confluenceEngine.getCurrentPrice() || 0,
      timestamp: Date.now(),
      details: { description: alert.description },
    });
  });

  // ── Deferred candle:close processing ──
  // Instead of processing synchronously inside the candle:close event (which blocks the event loop),
  // we queue candle close events and process them on the next tick via setImmediate
  const candleCloseQueue: Array<{ tf: string; candle: CandleBuilderCandle }> = [];

  candleBuilder.on('candle:close', (tf: string, candle: CandleBuilderCandle) => {
    candleCloseQueue.push({ tf, candle });
  });

  // Process candle close queue every 500ms (not on every close)
  setInterval(() => {
    if (candleCloseQueue.length === 0) return;
    const batch = candleCloseQueue.splice(0, candleCloseQueue.length);

    // Deduplicate: keep only the latest close per timeframe
    const latestPerTf = new Map<string, CandleBuilderCandle>();
    for (const item of batch) {
      latestPerTf.set(item.tf, item.candle);
    }

    for (const [tf, candle] of latestPerTf) {
      const analyzer = structureAnalyzers.get(tf);
      if (!analyzer) continue;

      const candles = candleBuilder.getCandles(tf);
      const breaks = analyzer.onCandleClose(candles);

      // Update confluence engine with ATR from 1m structure (most responsive)
      if (tf === '1m') {
        const atr = analyzer.getATR();
        if (atr > 0) confluenceEngine.updateATR(atr);
      }

      // FVG detection
      const fvgDetector = fvgDetectors.get(tf);
      if (fvgDetector) {
        const fvg = fvgDetector.onCandleClose(candles);
        if (fvg) {
          queueAlert({
            id: `FVG-ALERT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'FVG',
            market: 'AGGREGATE',
            exchange: 'ALL',
            symbol: config.symbol || 'BTC',
            timestamp: Date.now(),
            message: `${fvg.type} FVG — ${tf} — Gap $${fvg.low.toFixed(0)}-$${fvg.high.toFixed(0)} (${fvg.sizePercent.toFixed(3)}%)`,
            details: { fvg },
          } as any);
          feedConfluence({
            type: 'FVG',
            direction: fvg.type === 'BULLISH' ? 'LONG' : 'SHORT',
            price: (fvg.low + fvg.high) / 2,
            zoneLow: fvg.low,
            zoneHigh: fvg.high,
            timeframe: tf,
            timestamp: Date.now(),
            details: { description: `${fvg.type} FVG $${fvg.low.toFixed(0)}-$${fvg.high.toFixed(0)}` },
          });
        }
        fvgDetector.updateFilling(candle.high, candle.low);
      }

      // Liquidity pool updates
      const liqDetector = liqDetectors.get(tf);
      if (liqDetector) {
        const state = analyzer.getState();
        liqDetector.updatePools(state.swingHighs, state.swingLows);
        const sweep = liqDetector.checkSweeps(candles);
        if (sweep) {
          queueAlert({
            id: `SWEEP-ALERT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'LIQUIDITY_SWEEP',
            market: 'AGGREGATE',
            exchange: 'ALL',
            symbol: config.symbol || 'BTC',
            timestamp: Date.now(),
            message: `${sweep.type} — ${tf} — Swept $${sweep.pool.level.toFixed(0)} (depth: $${sweep.sweepDepth.toFixed(0)})`,
            details: { sweep },
          } as any);
          feedConfluence({
            type: 'LIQUIDITY_SWEEP',
            direction: sweep.type === 'BUYSIDE_SWEEP' ? 'SHORT' : 'LONG',
            price: sweep.pool.level,
            timeframe: tf,
            timestamp: Date.now(),
            details: { description: `${sweep.type} — $${sweep.pool.level.toFixed(0)}` },
          });
        }
      }

      // Structure breaks + OB detection
      for (const brk of breaks) {
        const msg = `${brk.type} ${brk.direction} — ${tf} — Price ${brk.type === 'BOS' ? 'broke' : 'reversed'} through $${brk.price.toLocaleString()} (close: $${brk.breakPrice.toLocaleString()})`;
        queueAlert({
          id: `STRUCTURE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'STRUCTURE',
          market: 'AGGREGATE',
          exchange: 'ALL',
          symbol: config.symbol || 'BTC',
          timestamp: Date.now(),
          message: msg,
          details: { structureType: brk.type, direction: brk.direction, timeframe: tf, swingPrice: brk.price, breakPrice: brk.breakPrice },
        } as any);

        const brkDir: 'LONG' | 'SHORT' = brk.direction === 'BULLISH' ? 'LONG' : 'SHORT';
        feedConfluence({
          type: brk.type,
          direction: brkDir,
          price: brk.breakPrice,
          timeframe: tf,
          timestamp: Date.now(),
          details: { description: `${brk.type} ${brk.direction} — ${tf}` },
        });

        const obDetector2 = obDetectors.get(tf);
        if (obDetector2) {
          const activeFVGs = fvgDetector ? fvgDetector.getActiveFVGs() : [];
          const ob = obDetector2.onStructureBreak(brk, candles, activeFVGs);
          if (ob) {
            queueAlert({
              id: `OB-ALERT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'ORDER_BLOCK',
              market: 'AGGREGATE',
              exchange: 'ALL',
              symbol: config.symbol || 'BTC',
              timestamp: Date.now(),
              message: `${ob.type} OB — ${tf} — $${ob.low.toFixed(0)}-$${ob.high.toFixed(0)} (strength: ${ob.strength})`,
              details: { orderBlock: ob },
            } as any);
            feedConfluence({
              type: 'ORDER_BLOCK',
              direction: ob.type === 'BULLISH' ? 'LONG' : 'SHORT',
              price: (ob.low + ob.high) / 2,
              zoneLow: ob.low,
              zoneHigh: ob.high,
              // ob.strength est sur 0-100 — l'ancien /5 envoyait des forces
              // jusqu'à 20 dans un scoring qui attend 0-1
              strength: Math.min(1, ob.strength / 100),
              timeframe: tf,
              timestamp: Date.now(),
              details: { description: `${ob.type} OB $${ob.low.toFixed(0)}-$${ob.high.toFixed(0)}` },
            });
          }
        }
      }

      // Update OB lifecycle
      const obDetector = obDetectors.get(tf);
      if (obDetector) {
        obDetector.updateLifecycle(candle.close, candle.close);
      }
    }
  }, 500);

  // Handle incoming trades
  let lastDetectorRun = 0;
  // 5 Hz is ample for microstructure detectors. At 20 Hz, the full detector
  // sweep (each detector re-scanning the whole trade buffer) ran so often it
  // saturated the event loop during sustained NY-session volume.
  const DETECTOR_MIN_INTERVAL_MS = 200;
  const DETECTOR_WINDOW_MS = 120_000;

  // Robust direction extraction from alert details (not message strings)
  function getAlertDirection(alert: Alert): 'LONG' | 'SHORT' {
    const d = (alert as any).details;
    const type = alert.type || '';
    switch (type) {
      case 'ABSORPTION':
        return d?.dominantSide === 'SELL' ? 'LONG' : 'SHORT';
      case 'SPIKE':
        return d?.side === 'BUY' ? 'LONG' : 'SHORT';
      case 'VELOCITY':
        return d?.cvdShift > 0 ? 'LONG' : 'SHORT';
      case 'EXHAUSTION':
        // Explicit field — the old `priceDropUsd > 0` check only worked by
        // accident (the bearish case has no priceDropUsd → undefined > 0 → SHORT)
        return d?.impliedDirection === 'LONG' ? 'LONG'
          : d?.impliedDirection === 'SHORT' ? 'SHORT'
          : d?.priceDropUsd > 0 ? 'LONG' : 'SHORT';
      case 'DIVERGENCE':
        return d?.cvd > 0 ? 'LONG' : 'SHORT';
      case 'TWAP':
        return d?.side === 'BUY' ? 'LONG' : 'SHORT';
      case 'LIQUIDATION':
        return d?.side === 'LONG' ? 'SHORT' : 'LONG';
      default:
        return 'LONG';
    }
  }

  // Throttle alert broadcasts: batch alerts and send as ONE WS frame max 5x/sec.
  // One frame per alert used to flood every client during big moves (render storms).
  let alertQueue: Alert[] = [];
  let alertFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushAlerts() {
    alertFlushTimer = null;
    if (alertQueue.length === 0) return;
    const batch = alertQueue.splice(0, alertQueue.length);
    broadcast('alert_batch', batch);
  }

  function queueAlert(alert: Alert) {
    alertQueue.push(alert);
    if (!alertFlushTimer) {
      alertFlushTimer = setTimeout(flushAlerts, 200); // flush every 200ms
    }
  }

  // Placeholder — initial connectors bind to this, then get re-wired to onTradeBuffered below
  // Uses a closure so it works before tradeBatch is declared
  let tradeIngestionFn: (trade: NormalizedTrade) => void = () => {};
  function onTrade(trade: NormalizedTrade) {
    tradeIngestionFn(trade);
  }

  // Handle order book updates
  function onOrderBook(book: OrderBook) {
    const key = `${book.exchange}:${book.market}:${book.symbol}`;
    orderBooks.set(key, book);
    trendAnalyzer.onOrderBook(book);
  }

  // Handle liquidations
  function onLiquidation(liq: Liquidation) {
    liquidationBuffer.push(liq);
    metrics.onLiquidation(liq);

    if (config.detectors.liquidation.enabled) {
      const liqs = liquidationBuffer.getRecent(60000);
      const alert = detectors.liquidation.detect(liqs, liq);
      if (alert) {
        trendAnalyzer.onAlert(alert);
        queueAlert(alert);
        // Was never fed to confluence — the "Cascade de Liquidation" template could not match
        feedConfluence({
          type: 'LIQUIDATION',
          direction: getAlertDirection(alert),
          price: liq.price,
          timestamp: Date.now(),
          strength: (alert as any).details?.strength,
          details: { description: (alert as any).message || 'LIQUIDATION' },
        });
      }
    }
  }

  // Initialize exchange connectors
  const connectors: BaseExchangeConnector[] = [];

  if (config.exchanges.binance?.enabled) {
    const c = new BinanceConnector(config.exchanges.binance);
    c.on('trade', onTrade);
    c.on('orderbook', onOrderBook);
    c.on('liquidation', onLiquidation);
    connectors.push(c);
  }
  if (config.exchanges.bybit?.enabled) {
    const c = new BybitConnector(config.exchanges.bybit);
    c.on('trade', onTrade);
    c.on('orderbook', onOrderBook);
    c.on('liquidation', onLiquidation);
    connectors.push(c);
  }
  if (config.exchanges.coinbase?.enabled) {
    const c = new CoinbaseConnector(config.exchanges.coinbase);
    c.on('trade', onTrade);
    c.on('orderbook', onOrderBook);
    connectors.push(c);
  }
  if (config.exchanges.hyperliquid?.enabled) {
    const c = new HyperliquidConnector(config.exchanges.hyperliquid);
    c.on('trade', onTrade);
    c.on('orderbook', onOrderBook);
    connectors.push(c);
  }
  if (config.exchanges.okx?.enabled) {
    const c = new OkxConnector(config.exchanges.okx);
    c.on('trade', onTrade);
    c.on('orderbook', onOrderBook);
    connectors.push(c);
  }

  // Connect all exchanges
  for (const connector of connectors) {
    connector.connect();
  }

  // Broadcast order books every 2 seconds (trades broadcast removed — unused by client)
  setInterval(() => {
    const books: Record<string, any> = {};
    for (const [key, book] of orderBooks) {
      books[key] = {
        exchange: book.exchange,
        market: book.market,
        symbol: book.symbol,
        bids: Array.from(book.bids.entries()).sort((a, b) => b[0] - a[0]).slice(0, 25),
        asks: Array.from(book.asks.entries()).sort((a, b) => a[0] - b[0]).slice(0, 25),
        lastUpdate: book.lastUpdate,
      };
    }
    if (Object.keys(books).length > 0) {
      broadcast('orderbooks', books);
    }
  }, 2000);

  // Broadcast metrics every second
  setInterval(() => {
    broadcast('metrics', metrics.getMetrics());
  }, 1000);

  // Broadcast trend analysis every 2 seconds
  setInterval(() => {
    broadcast('trend', trendAnalyzer.analyze());
  }, 2000);

  // ── OHLC Candle Builder (1-minute candles per exchange) ──
  interface Candle {
    time: number;  // seconds (start of the minute)
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }

  // Store candles per exchange key — keep last 4500 candles (~3 days of 1m)
  const candlesByExchange = new Map<string, Map<number, Candle>>();
  const sortedCandleArrays = new Map<string, Candle[]>(); // parallel sorted arrays (avoid sort on broadcast)
  const MAX_CANDLES = 4500;

  // ── Paginated Binance candle fetcher (up to `pages` x 1500 = 4500 candles) ──
  async function fetchBinancePaginated(
    baseUrl: string, key: string, pages: number = 3,
  ): Promise<Map<number, Candle>> {
    const candles = new Map<number, Candle>();
    let endTime: number | null = null;

    for (let page = 0; page < pages; page++) {
      try {
        let url = `${baseUrl}&limit=1500`;
        if (endTime) url += `&endTime=${endTime}`;
        const res = await fetch(url);
        if (!res.ok) { console.log(`[CANDLES] Binance page ${page} failed for ${key}: ${res.status}`); break; }
        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) break;

        for (const k of json) {
          const time = Math.floor(k[0] / 1000);
          candles.set(time, {
            time,
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[7]), // quoteAssetVolume = USD volume
          });
        }
        // Set endTime to 1ms before the earliest candle to get the previous page
        const earliestOpenTime = json[0][0];
        endTime = earliestOpenTime - 1;
        console.log(`[CANDLES] ${key} page ${page + 1}: fetched ${json.length} candles (total: ${candles.size})`);
      } catch (err: any) {
        console.log(`[CANDLES] Error fetching ${key} page ${page}: ${err.message}`);
        break;
      }
    }
    return candles;
  }

  // ── Fetch historical candles from REST APIs ──
  async function fetchHistoricalCandles() {
    // Binance: paginated fetch for 3 pages = ~4500 candles (~3 days)
    const binanceFutures = await fetchBinancePaginated(
      'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m',
      'BINANCE_FUTURES:PERP', 3,
    );
    if (binanceFutures.size > 0) {
      candlesByExchange.set('BINANCE_FUTURES:PERP', binanceFutures);
      sortedCandleArrays.set('BINANCE_FUTURES:PERP', Array.from(binanceFutures.values()).sort((a, b) => a.time - b.time));
      console.log(`[CANDLES] Loaded ${binanceFutures.size} historical candles for BINANCE_FUTURES:PERP`);
    }

    const binanceSpot = await fetchBinancePaginated(
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m',
      'BINANCE:SPOT', 3,
    );
    if (binanceSpot.size > 0) {
      candlesByExchange.set('BINANCE:SPOT', binanceSpot);
      sortedCandleArrays.set('BINANCE:SPOT', Array.from(binanceSpot.values()).sort((a, b) => a.time - b.time));
      console.log(`[CANDLES] Loaded ${binanceSpot.size} historical candles for BINANCE:SPOT`);
    }

    // Bybit: paginated fetch (3 pages × 1000 = ~3000 candles = ~2 days)
    const bybitCandles = await fetchBybitPaginated(
      'https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=1',
      'BYBIT:PERP', 3,
    );
    if (bybitCandles.size > 0) {
      candlesByExchange.set('BYBIT:PERP', bybitCandles);
      sortedCandleArrays.set('BYBIT:PERP', Array.from(bybitCandles.values()).sort((a, b) => a.time - b.time));
      console.log(`[CANDLES] Loaded ${bybitCandles.size} historical candles for BYBIT:PERP`);
    }

    // Coinbase spot: paginated fetch (API limit 300/page) — without history
    // this chart started empty and looked "lagging" vs the seeded exchanges
    try {
      const cbCandles = new Map<number, Candle>();
      let cbEnd = Math.floor(Date.now() / 1000);
      for (let page = 0; page < 5; page++) {
        const cbStart = cbEnd - 300 * 60;
        const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${cbStart}&end=${cbEnd}`;
        const res = await fetch(url);
        if (!res.ok) { console.log(`[CANDLES] Coinbase page ${page} failed: ${res.status}`); break; }
        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) break;
        // Format: [time, low, high, open, close, volume(BTC)], newest first
        for (const k of json) {
          const time = Number(k[0]);
          const close = Number(k[4]);
          cbCandles.set(time, {
            time,
            open: Number(k[3]),
            high: Number(k[2]),
            low: Number(k[1]),
            close,
            volume: Number(k[5]) * close, // BTC volume → approx USD
          });
        }
        cbEnd = cbStart;
      }
      if (cbCandles.size > 0) {
        candlesByExchange.set('COINBASE:SPOT', cbCandles);
        sortedCandleArrays.set('COINBASE:SPOT', Array.from(cbCandles.values()).sort((a, b) => a.time - b.time));
        console.log(`[CANDLES] Loaded ${cbCandles.size} historical candles for COINBASE:SPOT`);
      }
    } catch (err: any) {
      console.log(`[CANDLES] Error fetching COINBASE:SPOT: ${err.message}`);
    }

    // Hyperliquid perp: candleSnapshot via info API
    try {
      const hlStart = Date.now() - 4500 * 60_000;
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: { coin: 'BTC', interval: '1m', startTime: hlStart, endTime: Date.now() },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const hlCandles = new Map<number, Candle>();
        if (Array.isArray(json)) {
          for (const k of json) {
            const time = Math.floor(Number(k.t) / 1000);
            const close = Number(k.c);
            hlCandles.set(time, {
              time,
              open: Number(k.o),
              high: Number(k.h),
              low: Number(k.l),
              close,
              volume: Number(k.v) * close, // BTC volume → approx USD
            });
          }
        }
        if (hlCandles.size > 0) {
          candlesByExchange.set('HYPERLIQUID:PERP', hlCandles);
          sortedCandleArrays.set('HYPERLIQUID:PERP', Array.from(hlCandles.values()).sort((a, b) => a.time - b.time));
          console.log(`[CANDLES] Loaded ${hlCandles.size} historical candles for HYPERLIQUID:PERP`);
        }
      } else {
        console.log(`[CANDLES] Hyperliquid candleSnapshot failed: ${res.status}`);
      }
    } catch (err: any) {
      console.log(`[CANDLES] Error fetching HYPERLIQUID:PERP: ${err.message}`);
    }

    // OKX: single fetch (API limit 300)
    try {
      const res = await fetch('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1m&limit=300');
      if (res.ok) {
        const json = await res.json();
        const candles = new Map<number, Candle>();
        const data = json?.data;
        if (Array.isArray(data)) {
          for (const k of data) {
            const time = Math.floor(Number(k[0]) / 1000);
            candles.set(time, {
              time,
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[7]) || parseFloat(k[5]),
            });
          }
        }
        if (candles.size > 0) {
          candlesByExchange.set('OKX:PERP', candles);
          sortedCandleArrays.set('OKX:PERP', Array.from(candles.values()).sort((a, b) => a.time - b.time));
          console.log(`[CANDLES] Loaded ${candles.size} historical candles for OKX:PERP`);
        }
      }
    } catch (err: any) {
      console.log(`[CANDLES] Error fetching OKX:PERP: ${err.message}`);
    }
  }

  // Paginated Bybit kline fetch (returns newest-first, we paginate backwards)
  async function fetchBybitPaginated(
    baseUrl: string, key: string, pages: number = 3,
  ): Promise<Map<number, Candle>> {
    const candles = new Map<number, Candle>();
    let endMs: number | null = null;

    for (let page = 0; page < pages; page++) {
      try {
        let url = `${baseUrl}&limit=1000`;
        if (endMs) url += `&end=${endMs}`;
        const res = await fetch(url);
        if (!res.ok) { console.log(`[CANDLES] Bybit page ${page} failed for ${key}: ${res.status}`); break; }
        const json = await res.json();
        const list = json?.result?.list;
        if (!Array.isArray(list) || list.length === 0) break;

        for (const k of list) {
          const time = Math.floor(Number(k[0]) / 1000);
          candles.set(time, {
            time,
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[6]) || parseFloat(k[5]),
          });
        }

        // Bybit returns newest first — last item is the oldest
        const oldestOpenTimeMs = Number(list[list.length - 1][0]);
        endMs = oldestOpenTimeMs - 1;
        console.log(`[CANDLES] ${key} page ${page + 1}: fetched ${list.length} candles (total: ${candles.size})`);
      } catch (err: any) {
        console.log(`[CANDLES] Error fetching ${key} page ${page}: ${err.message}`);
        break;
      }
    }
    return candles;
  }

  // Fetch history and seed Phase A modules
  fetchHistoricalCandles().then(() => {
    // Seed the multi-TF candle builder with historical 1m data from Binance Futures
    const binanceFuturesArr = sortedCandleArrays.get('BINANCE_FUTURES:PERP');
    if (binanceFuturesArr && binanceFuturesArr.length > 0) {
      const sorted = binanceFuturesArr; // already sorted
      // Convert to CandleBuilder format (add missing fields with defaults)
      const enriched: CandleBuilderCandle[] = sorted.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        buyVolume: c.volume * 0.5,   // estimate 50/50 for historical
        sellVolume: c.volume * 0.5,
        delta: 0,
        trades: 0,
      }));
      candleBuilder.seedHistorical(enriched);
      console.log(`[PHASE-A] Seeded CandleBuilder with ${enriched.length} historical 1m candles`);

      // Run structure analysis on historical data
      for (const [tf, analyzer] of structureAnalyzers.entries()) {
        const tfCandles = candleBuilder.getCandles(tf);
        if (tfCandles.length > 0) {
          analyzer.processHistorical(tfCandles);
          const state = analyzer.getState();
          console.log(`[PHASE-A] ${tf} structure: ${state.trend} | ${state.swingHighs.length} swing highs, ${state.swingLows.length} swing lows, ${state.recentBreaks.length} breaks`);
        }
      }

      // Seed VWAP with historical candle data
      vwapCalculator.seedFromCandles(enriched);
      const vwapData = vwapCalculator.getData();
      if (vwapData.vwap > 0) {
        console.log(`[PHASE-A] VWAP seeded: $${vwapData.vwap.toFixed(0)} | +1σ: $${vwapData.upperBand1.toFixed(0)} | -1σ: $${vwapData.lowerBand1.toFixed(0)}`);
      }

      // ── Phase B: Seed FVGs, OBs, Liquidity, Volume Profile from historical data ──
      for (const [tf, fvgDetector] of fvgDetectors.entries()) {
        const tfCandles = candleBuilder.getCandles(tf);
        if (tfCandles.length > 2) {
          fvgDetector.processHistorical(tfCandles);
          console.log(`[PHASE-B] ${tf} FVGs: ${fvgDetector.getActiveFVGs().length} active`);
        }
      }

      // Seed liquidity from swing points
      for (const [tf, liqDetector] of liqDetectors.entries()) {
        const analyzer = structureAnalyzers.get(tf);
        if (analyzer) {
          const state = analyzer.getState();
          liqDetector.updatePools(state.swingHighs, state.swingLows);
          console.log(`[PHASE-B] ${tf} Liquidity: ${liqDetector.getActivePools().length} pools`);
        }
      }

      // Seed Order Blocks depuis les cassures historiques — les FVG et pools
      // étaient reconstruits au boot mais PAS les OB : l'inventaire partait
      // vide à chaque (re)démarrage et le feeder OB_RETEST n'avait rien à
      // surveiller pendant des heures. Rejoue chronologiquement : cassure →
      // création d'OB avec l'historique jusqu'à ce point, puis cycle de vie
      // bougie par bougie (tested/mitigated) avec les bougies suivantes.
      for (const [tf, analyzer] of structureAnalyzers.entries()) {
        const obDetector = obDetectors.get(tf);
        const fvgDetector = fvgDetectors.get(tf);
        if (!obDetector) continue;
        const tfCandles = candleBuilder.getCandles(tf);
        if (tfCandles.length < 10) continue;

        const state = analyzer.getState();
        // recentBreaks est du plus récent au plus ancien → remettre en ordre chronologique
        const breaksAsc = [...state.recentBreaks].sort((a, b) => a.timestamp - b.timestamp);
        let brkIdx = 0;
        for (let i = 0; i < tfCandles.length; i++) {
          const c = tfCandles[i];
          while (brkIdx < breaksAsc.length && breaksAsc[brkIdx].timestamp === c.time) {
            obDetector.onStructureBreak(
              breaksAsc[brkIdx],
              tfCandles.slice(0, i + 1),
              fvgDetector ? fvgDetector.getActiveFVGs() : [],
            );
            brkIdx++;
          }
          obDetector.updateLifecycle(c.close, c.close);
        }
        console.log(`[PHASE-B] ${tf} Order Blocks seedés: ${obDetector.getActiveOBs().length} actifs`);
      }

      // Seed Volume Profile
      volumeProfile.seedFromCandles(enriched);
      const vpData = volumeProfile.getData();
      if (vpData.poc > 0) {
        console.log(`[PHASE-B] Volume Profile: POC $${vpData.poc.toFixed(0)} | VAH $${vpData.vah.toFixed(0)} | VAL $${vpData.val.toFixed(0)}`);
      }
    }
  });

  function updateCandle(trade: NormalizedTrade) {
    const key = `${trade.exchange}:${trade.market}`;
    if (!candlesByExchange.has(key)) {
      candlesByExchange.set(key, new Map());
      sortedCandleArrays.set(key, []);
    }
    const candles = candlesByExchange.get(key)!;
    const sortedArr = sortedCandleArrays.get(key)!;
    const minuteTs = Math.floor(trade.timestamp / 60000) * 60; // seconds

    let candle = candles.get(minuteTs);
    if (!candle) {
      candle = {
        time: minuteTs,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.usdValue,
      };
      candles.set(minuteTs, candle);
      sortedArr.push(candle); // O(1) — trades arrive chronologically

      // Prune old candles
      if (sortedArr.length > MAX_CANDLES) {
        const removed = sortedArr.splice(0, sortedArr.length - MAX_CANDLES);
        for (const r of removed) candles.delete(r.time);
      }
    } else {
      // In-place update — same object referenced by both Map and array
      candle.high = Math.max(candle.high, trade.price);
      candle.low = Math.min(candle.low, trade.price);
      candle.close = trade.price;
      candle.volume += trade.usdValue;
    }
  }

  // ── CVD (Cumulative Volume Delta) per minute ──
  // CVD = cumulative (buyVolume - sellVolume) aligned to 1-minute buckets
  // Maintained incrementally — no sort or reduce needed on broadcast
  const cvdEntries: { time: number; delta: number; cumulative: number }[] = [];
  let cvdCumulative = 0;

  function updateCvd(trade: NormalizedTrade) {
    const minuteTs = Math.floor(trade.timestamp / 60000) * 60;
    const delta = trade.side === 'BUY' ? trade.usdValue : -trade.usdValue;

    const last = cvdEntries[cvdEntries.length - 1];
    if (last && last.time === minuteTs) {
      last.delta += delta;
      last.cumulative = (cvdEntries.length > 1 ? cvdEntries[cvdEntries.length - 2].cumulative : 0) + last.delta;
      cvdCumulative = last.cumulative;
    } else if (last && minuteTs < last.time) {
      // Late trade for an earlier minute (cross-exchange skew, and the Binance
      // REST fallback delivers up to ~2s late at every minute boundary).
      // Blindly pushing created out-of-order entries and corrupted cumulatives.
      // Walk back a few buckets (late trades are never far), add the delta
      // there, and re-accumulate forward from that point.
      for (let i = cvdEntries.length - 1; i >= 0 && i >= cvdEntries.length - 5; i--) {
        if (cvdEntries[i].time === minuteTs) {
          cvdEntries[i].delta += delta;
          let cum = i > 0 ? cvdEntries[i - 1].cumulative : 0;
          for (let j = i; j < cvdEntries.length; j++) {
            cum += cvdEntries[j].delta;
            cvdEntries[j].cumulative = cum;
          }
          cvdCumulative = cum;
          return;
        }
      }
      // Older than our recent window — too stale to matter, drop it
    } else {
      cvdCumulative += delta;
      cvdEntries.push({ time: minuteTs, delta, cumulative: cvdCumulative });
      // Prune old entries (rare)
      if (cvdEntries.length > MAX_CANDLES) {
        cvdEntries.splice(0, cvdEntries.length - MAX_CANDLES);
        // Recalculate cumulative from scratch after prune
        let cum = 0;
        for (const e of cvdEntries) {
          cum += e.delta;
          e.cumulative = cum;
        }
        cvdCumulative = cum;
      }
    }
  }

  /** O(1) tip accessor — getCvdSeries() allocated a 4500-object array every 500ms just for the last point */
  function getCvdTip(): { time: number; value: number } | null {
    const last = cvdEntries[cvdEntries.length - 1];
    return last ? { time: last.time, value: last.cumulative } : null;
  }

  function getCvdSeries(): { time: number; value: number }[] {
    return cvdEntries.map(e => ({ time: e.time, value: e.cumulative }));
  }

  // ── Trade batching: buffer trades and process every 100ms ──
  // This prevents CPU saturation during big moves (5000+ trades/sec across 5 exchanges)
  const tradeBatch: NormalizedTrade[] = [];
  const BATCH_INTERVAL_MS = 100; // 10 Hz processing

  // Backpressure caps so a volume spike (NY open) can never block the event
  // loop for seconds: process at most N trades per 100ms drain (≈15k/s
  // capacity), carry the rest to the next tick; and never let the pending
  // buffer grow unbounded — drop the oldest overflow (degrade, don't freeze).
  const MAX_TRADES_PER_DRAIN = 1500;
  const MAX_PENDING_BATCH = 20000;
  let perfDroppedTrades = 0;
  let perfMaxDetectMs = 0;
  // Per-exchange freshness: trade count this interval + last trade timestamp,
  // so a frozen/stale feed is obvious at a glance in the [FEEDS] line.
  // restCount tracks REST-fallback trades so a dead WS can't masquerade as fresh.
  const feedStats = new Map<string, { count: number; restCount: number; lastTs: number }>();

  // Wire up the ingestion function now that tradeBatch exists
  tradeIngestionFn = (trade: NormalizedTrade) => {
    tradeBatch.push(trade);
    if (tradeBatch.length > MAX_PENDING_BATCH) {
      const overflow = tradeBatch.length - MAX_PENDING_BATCH;
      tradeBatch.splice(0, overflow);
      perfDroppedTrades += overflow;
    }
  };

  // ── Performance monitoring ──
  let perfTradesTotal = 0;
  let perfBatchCount = 0;
  let perfMaxBatchSize = 0;
  let perfMaxBatchMs = 0;
  let perfEventLoopLag = 0;

  // Event loop lag detector: measures how much setInterval drifts from expected
  let lastLoopCheck = Date.now();
  setInterval(() => {
    const now = Date.now();
    perfEventLoopLag = Math.max(0, now - lastLoopCheck - 1000);
    lastLoopCheck = now;
  }, 1000);

  // Log performance stats every 10s
  setInterval(() => {
    const tradesPerSec = Math.round(perfTradesTotal / 10);
    if (tradesPerSec > 0 || perfEventLoopLag > 50) {
      const heapMb = Math.round(process.memoryUsage().heapUsed / 1048576);
      // pending = real backlog of unprocessed trades (the number to watch).
      // window = rolling per-exchange detector input (fills by design, not a backlog).
      console.log(
        `[PERF] ${tradesPerSec} trades/sec | ` +
        `batches: ${perfBatchCount} (max size: ${perfMaxBatchSize}, max time: ${perfMaxBatchMs}ms) | ` +
        `detect: ${perfMaxDetectMs}ms | loop lag: ${perfEventLoopLag}ms | ` +
        `heap: ${heapMb}MB | window: ${totalBufferedTrades()} | pending: ${tradeBatch.length}` +
        (perfDroppedTrades > 0 ? ` | DROPPED: ${perfDroppedTrades}` : '')
      );

      // Per-exchange feed health — a stale feed (no trades, rising age) jumps out
      const nowTs = Date.now();
      const parts: string[] = [];
      for (const [key, fs] of feedStats) {
        const ageS = fs.lastTs > 0 ? Math.round((nowTs - fs.lastTs) / 1000) : 999;
        const stale = ageS > 30 ? ' STALE' : '';
        // Majority REST = the WS is actually dead, don't let the poll fake freshness
        const rest = fs.count > 0 && fs.restCount > fs.count / 2 ? ' REST' : '';
        parts.push(`${key} ${fs.count} (${ageS}s${stale}${rest})`);
        fs.count = 0;
        fs.restCount = 0;
      }
      if (parts.length > 0) console.log(`[FEEDS] ${parts.join(' | ')}`);
    }
    perfTradesTotal = 0;
    perfBatchCount = 0;
    perfMaxBatchSize = 0;
    perfMaxBatchMs = 0;
    perfDroppedTrades = 0;
    perfMaxDetectMs = 0;
  }, 10000);

  // Process batched trades every 100ms — chunked async to yield event loop during big moves
  const CHUNK_SIZE = 200;
  let drainInProgress = false;

  setInterval(async () => {
    if (tradeBatch.length === 0 || drainInProgress) return;
    drainInProgress = true;

    try {
    const batchStart = Date.now();

    // Drain up to the per-tick cap — leftover stays for the next 100ms tick.
    // Bounding the drain keeps each pass short so the 500ms candle_tick and
    // other broadcasts always get a turn, even during a NY-open spike.
    const drainCount = Math.min(tradeBatch.length, MAX_TRADES_PER_DRAIN);
    const batch = tradeBatch.splice(0, drainCount);
    perfTradesTotal += batch.length;
    perfBatchCount++;
    if (batch.length > perfMaxBatchSize) perfMaxBatchSize = batch.length;

    // Process in chunks to yield event loop between them
    for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
      const chunk = batch.slice(i, i + CHUNK_SIZE);

      for (const trade of chunk) {
        updateCandle(trade);
        updateHTFCandle(trade);
        updateCvd(trade);
        const exKey = `${trade.exchange}:${trade.market}`;
        getTradeBuffer(exKey).push(trade);
        metrics.onTrade(trade);
        // Per-exchange freshness tracking (cheap O(1))
        let fs = feedStats.get(exKey);
        if (!fs) { fs = { count: 0, restCount: 0, lastTs: 0 }; feedStats.set(exKey, fs); }
        fs.count++;
        if (trade.source === 'REST') fs.restCount++;
        fs.lastTs = trade.timestamp;
      }

      for (const trade of chunk) {
        candleBuilder.onTrade(trade);
      }

      for (const trade of chunk) {
        vwapCalculator.onTrade(trade);
        volumeProfile.onTrade(trade);
      }

      // Yield to event loop between chunks so broadcasts can run
      if (i + CHUNK_SIZE < batch.length) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }

    // Use the LAST trade as representative for per-batch operations
    const lastTrade = batch[batch.length - 1];

    const batchMs = Date.now() - batchStart;
    if (batchMs > perfMaxBatchMs) perfMaxBatchMs = batchMs;

    // Derivatives & confluence: just update with latest price (once per batch)
    oiTracker.updatePrice(lastTrade.exchange, lastTrade.price);
    const marketType: 'SPOT' | 'PERP' = lastTrade.market === 'SPOT' ? 'SPOT' : 'PERP';
    basisTracker.updatePrice(lastTrade.exchange, marketType, lastTrade.price);
    confluenceEngine.updatePrice(lastTrade.price);

    // Trend analyzer: once per batch
    trendAnalyzer.onTrade(lastTrade);

    // Detectors: run once per batch (not per trade!)
    const now = Date.now();
    if (now - lastDetectorRun >= DETECTOR_MIN_INTERVAL_MS) {
      lastDetectorRun = now;
      const detectStart = Date.now();
      // The per-exchange buffer is already small and scoped to one exchange —
      // no giant slice, no prefilter. getRecent returns ≤15k trades.
      const exKey = `${lastTrade.exchange}:${lastTrade.market}`;
      const recentTrades = getTradeBuffer(exKey).getRecent(DETECTOR_WINDOW_MS);
      const alerts: Alert[] = [];

      if (config.detectors.absorption.enabled) {
        const a = detectors.absorption.detect(recentTrades, lastTrade);
        if (a) alerts.push(a);
      }
      if (config.detectors.divergence.enabled) {
        const a = detectors.divergence.detect(recentTrades, lastTrade);
        if (a) alerts.push(...a);
      }
      if (config.detectors.exhaustion.enabled) {
        const a = detectors.exhaustion.detect(recentTrades, lastTrade);
        if (a) alerts.push(a);
      }
      if (config.detectors.spike.enabled) {
        const a = detectors.spike.detect(recentTrades, lastTrade);
        if (a) alerts.push(a);
      }
      if (config.detectors.velocity.enabled) {
        const a = detectors.velocity.detect(recentTrades, lastTrade);
        if (a) alerts.push(a);
      }
      if (config.detectors.twap.enabled) {
        const a = detectors.twap.detect(recentTrades, lastTrade);
        if (a) alerts.push(a);
      }

      for (const alert of alerts) {
        trendAnalyzer.onAlert(alert);
        queueAlert(alert);
        const dir = getAlertDirection(alert);
        feedConfluence({
          type: alert.type,
          direction: dir,
          price: lastTrade.price,
          timestamp: Date.now(),
          strength: (alert as any).details?.strength,
          details: { description: (alert as any).message || alert.type },
        });
      }

      const detectMs = Date.now() - detectStart;
      if (detectMs > perfMaxDetectMs) perfMaxDetectMs = detectMs;
    }
    } finally {
      drainInProgress = false;
    }
  }, BATCH_INTERVAL_MS);

  // Connectors already bound to onTrade which delegates to tradeBatch via tradeIngestionFn

  // ── Higher Timeframe candles (1h, 4h) for deeper history ──
  const htfCandlesByExchange = new Map<string, Map<number, Candle>>();

  // Keep HTF candles updated from real-time trades
  function updateHTFCandle(trade: NormalizedTrade) {
    const key = `${trade.exchange}:${trade.market}`;
    for (const [tf, intervalSec] of [['1h', 3600], ['4h', 14400]] as [string, number][]) {
      const htfKey = `${key}:${tf}`;
      if (!htfCandlesByExchange.has(htfKey)) {
        htfCandlesByExchange.set(htfKey, new Map());
      }
      const candles = htfCandlesByExchange.get(htfKey)!;
      const bucketTime = Math.floor(trade.timestamp / (intervalSec * 1000)) * intervalSec;

      let candle = candles.get(bucketTime);
      if (!candle) {
        candle = {
          time: bucketTime,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.usdValue,
        };
        candles.set(bucketTime, candle);
        // Prune: these maps grew unbounded (slow leak over long uptimes)
        if (candles.size > 600) {
          const times = Array.from(candles.keys()).sort((a, b) => a - b);
          for (let i = 0; i < times.length - 550; i++) candles.delete(times[i]);
        }
      } else {
        candle.high = Math.max(candle.high, trade.price);
        candle.low = Math.min(candle.low, trade.price);
        candle.close = trade.price;
        candle.volume += trade.usdValue;
      }
    }
  }

  // Fetch historical 1h and 4h candles — Binance Futures ET Bybit (le chart
  // par défaut) : sans ça, le chart Bybit restait coupé à ~3 jours même
  // dézoomé, pendant que Binance affichait des semaines en 1h/4h
  async function fetchHTFHistoricalCandles() {
    const htfSources: Array<{ key: string; tf: string; url: string; kind: 'binance' | 'bybit' }> = [
      { key: 'BINANCE_FUTURES:PERP', tf: '1h', kind: 'binance', url: 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=500' },
      { key: 'BINANCE_FUTURES:PERP', tf: '4h', kind: 'binance', url: 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=500' },
      { key: 'BYBIT:PERP', tf: '1h', kind: 'bybit', url: 'https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=60&limit=1000' },
      { key: 'BYBIT:PERP', tf: '4h', kind: 'bybit', url: 'https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=240&limit=1000' },
    ];

    for (const src of htfSources) {
      try {
        const res = await fetch(src.url);
        if (!res.ok) { console.log(`[HTF] Failed to fetch ${src.key}:${src.tf}: ${res.status}`); continue; }
        const json = await res.json();
        const htfKey = `${src.key}:${src.tf}`;
        const candles = new Map<number, Candle>();

        if (src.kind === 'binance' && Array.isArray(json)) {
          for (const k of json) {
            const time = Math.floor(k[0] / 1000);
            candles.set(time, {
              time,
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[7]), // quote volume (USD)
            });
          }
        } else if (src.kind === 'bybit' && Array.isArray(json?.result?.list)) {
          // Bybit v5 kline : [start(ms), open, high, low, close, volume(base), turnover(quote)]
          for (const k of json.result.list) {
            const time = Math.floor(Number(k[0]) / 1000);
            candles.set(time, {
              time,
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[6]) || parseFloat(k[5]), // turnover USD
            });
          }
        }

        if (candles.size > 0) {
          htfCandlesByExchange.set(htfKey, candles);
          console.log(`[HTF] Loaded ${candles.size} historical ${src.tf} candles for ${src.key}`);
        }
      } catch (err: any) {
        console.log(`[HTF] Error fetching ${src.key}:${src.tf}: ${err.message}`);
      }
    }
  }

  // Fetch HTF candles at startup (after 1m candles are loaded)
  fetchHTFHistoricalCandles();

  // ── Helper: build full candle payload (uses pre-sorted arrays — no sort needed) ──
  function buildFullCandlePayload(): Record<string, Candle[]> {
    const payload: Record<string, Candle[]> = {};
    for (const [key, arr] of sortedCandleArrays) {
      payload[key] = arr;
    }
    return payload;
  }

  function buildHTFPayload(): Record<string, Record<string, Candle[]>> {
    const htfPayload: Record<string, Record<string, Candle[]>> = {};
    for (const [htfKey, candles] of htfCandlesByExchange) {
      const lastColon = htfKey.lastIndexOf(':');
      const tf = htfKey.slice(lastColon + 1);
      const exchangeKey = htfKey.slice(0, lastColon);
      if (!htfPayload[tf]) htfPayload[tf] = {};
      htfPayload[tf][exchangeKey] = Array.from(candles.values()).sort((a, b) => a.time - b.time);
    }
    return htfPayload;
  }

  // Send full candle dump to newly connected clients (every 2s check)
  setInterval(() => {
    if (!sendToClient || !getInitialSyncClients) return;
    const newClients = getInitialSyncClients();
    if (newClients.length === 0) return;

    const candlePayload = buildFullCandlePayload();
    const htfPayload = buildHTFPayload();
    const cvdPayload = getCvdSeries();

    for (const ws of newClients) {
      sendToClient(ws, 'candles', candlePayload);
      sendToClient(ws, 'cvd', cvdPayload);
      sendToClient(ws, 'candles_htf', htfPayload);
    }
    console.log(`[WS] Sent full sync to ${newClients.length} new client(s)`);
  }, 2000);

  // Periodic CVD broadcast every 30s (candles handled via ticks now)
  setInterval(() => {
    broadcast('cvd', getCvdSeries());
  }, 30000);

  // Track last broadcasted candle time per exchange (for detecting minute transitions)
  const lastBroadcastedCandleTime = new Map<string, number>();

  // Broadcast CURRENT candle (+ previous if minute just changed) + CVD tip every 500ms
  setInterval(() => {
    const payload: Record<string, Candle | Candle[]> = {};
    for (const [key, arr] of sortedCandleArrays) {
      if (arr.length === 0) continue;
      // O(1) access to last two candles from sorted array
      const latest = arr[arr.length - 1];
      const secondLatest = arr.length > 1 ? arr[arr.length - 2] : null;

      const lastSent = lastBroadcastedCandleTime.get(key);
      if (secondLatest && lastSent !== undefined && latest.time > lastSent) {
        // Minute changed: send [closed candle, current candle]
        payload[key] = [secondLatest, latest];
      } else {
        payload[key] = latest;
      }
      lastBroadcastedCandleTime.set(key, latest.time);
    }
    broadcast('candle_tick', payload);

    // CVD tip: just the last point (O(1), no full-series allocation)
    const cvdTip = getCvdTip();
    if (cvdTip) {
      broadcast('cvd_tick', cvdTip);
    }
  }, 500);

  // ── Phase A Broadcasts ──

  // Broadcast VWAP every 1 second + feed VWAP context to confluence.
  // Context signals are throttled to one per 2 min — emitting them every second
  // during extended moves created a permanent mean-reversion bias (knife catching).
  const CONTEXT_SIGNAL_COOLDOWN_MS = 120_000;
  let lastVwapSignalAt = 0;
  setInterval(() => {
    const vwapData = vwapCalculator.getData();
    if (vwapData.vwap > 0) {
      broadcast('vwap', vwapData);

      // Phase D: VWAP position context (only emit if price is extended)
      const price = confluenceEngine.getCurrentPrice();
      const now = Date.now();
      if (price > 0 && vwapData.lowerBand2 > 0 && vwapData.upperBand2 > 0 &&
          now - lastVwapSignalAt >= CONTEXT_SIGNAL_COOLDOWN_MS) {
        if (price <= vwapData.lowerBand2) {
          lastVwapSignalAt = now;
          feedConfluence({
            type: 'VWAP_POSITION',
            direction: 'LONG',
            price,
            timestamp: now,
            details: { description: `Price at VWAP -2σ ($${vwapData.lowerBand2.toFixed(0)}) — oversold` },
          });
        } else if (price >= vwapData.upperBand2) {
          lastVwapSignalAt = now;
          feedConfluence({
            type: 'VWAP_POSITION',
            direction: 'SHORT',
            price,
            timestamp: now,
            details: { description: `Price at VWAP +2σ ($${vwapData.upperBand2.toFixed(0)}) — overbought` },
          });
        }
      }
    }
  }, 1000);

  // ── Refonte v2: zone-retest signals + structural TP levels ──
  // Implémentation partagée avec le backtest (src/server/scenarios/zoneFeeder.ts)
  // — ce qui est backtesté est exactement ce qui tourne en live.
  const zoneRetestFeeder = new ZoneRetestFeeder(obDetectors, fvgDetectors, feedConfluence);
  let lastVpData: { poc: number; vah: number; val: number } | null = null;

  // Broadcast market structure state every 2 seconds (includes Phase B zones)
  setInterval(() => {
    const structureState: Record<string, any> = {};
    for (const [tf, analyzer] of structureAnalyzers.entries()) {
      const state = analyzer.getState();
      const obDetector = obDetectors.get(tf);
      const fvgDetector = fvgDetectors.get(tf);
      const liqDetector = liqDetectors.get(tf);

      structureState[tf] = {
        trend: state.trend,
        lastBOS: state.lastBOS,
        lastCHoCH: state.lastCHoCH,
        swingHighs: state.swingHighs.slice(0, 20),
        swingLows: state.swingLows.slice(0, 20),
        recentBreaks: state.recentBreaks.slice(0, 15),
        // Phase B zones
        orderBlocks: obDetector ? obDetector.getActiveOBs().slice(0, 15) : [],
        fvgs: fvgDetector ? fvgDetector.getActiveFVGs().slice(0, 15) : [],
        liquidityPools: liqDetector ? liqDetector.getActivePools().slice(0, 10) : [],
        recentSweeps: liqDetector ? liqDetector.getRecentSweeps() : [],
      };
    }
    broadcast('structure', structureState);

    // Refonte v2: retest signals + structural TP levels
    const price = confluenceEngine.getCurrentPrice();
    if (price > 0) {
      zoneRetestFeeder.check(price);
      confluenceEngine.updateMarketLevels(collectMarketLevels(structureAnalyzers, liqDetectors, lastVpData));
    }
  }, 2000);

  // Broadcast Volume Profile every 3 seconds + POC context for confluence
  let lastPocSignalAt = 0;
  setInterval(() => {
    const vpData = volumeProfile.getData();
    if (vpData.poc > 0) {
      broadcast('volumeProfile', vpData);

      lastVpData = { poc: vpData.poc, vah: vpData.vah, val: vpData.val };

      // Phase D: POC proximity context (throttled like VWAP context)
      const price = confluenceEngine.getCurrentPrice();
      const now = Date.now();
      if (price > 0 && now - lastPocSignalAt >= CONTEXT_SIGNAL_COOLDOWN_MS) {
        const pocDist = Math.abs(price - vpData.poc) / vpData.poc;
        if (pocDist < 0.001) { // within 0.1% of POC
          lastPocSignalAt = now;
          feedConfluence({
            type: 'VOLUME_PROFILE',
            direction: price > vpData.poc ? 'SHORT' : 'LONG', // rejection at POC
            price,
            timestamp: now,
            details: { description: `Price at POC $${vpData.poc.toFixed(0)}` },
          });
        }
      }
    }
  }, 3000);

  // ── Phase C: Broadcast derivatives state every 10 seconds ──
  setInterval(() => {
    // Compute basis from latest prices
    const basisData = basisTracker.compute();
    basisTracker.checkAlerts();

    const oiAgg = oiTracker.getAggregateOI();
    const latestOI = oiTracker.getLatestOI();
    const latestFunding = fundingMonitor.getLatestRates();

    // Build per-exchange snapshots
    const exchangeKeys = new Set([...latestOI.keys(), ...latestFunding.keys()]);
    const snapshots: any[] = [];
    for (const ex of exchangeKeys) {
      const oi = latestOI.get(ex) || 0;
      const fundingSnap = latestFunding.get(ex);
      snapshots.push({
        exchange: ex,
        symbol: config.symbol || 'BTC',
        timestamp: Date.now(),
        openInterest: oi,
        fundingRate: fundingSnap?.rate || 0,
        nextFundingTime: fundingSnap?.nextFundingTime || 0,
      });
    }

    // Funding stats
    let maxFunding = 0, minFunding = 0;
    for (const snap of latestFunding.values()) {
      if (snap.rate > maxFunding) maxFunding = snap.rate;
      if (snap.rate < minFunding) minFunding = snap.rate;
    }

    const derivState: DerivativesState = {
      snapshots,
      aggregateOI: oiAgg.total,
      aggregateOIChange: oiAgg.change,
      aggregateOIChangePct: oiAgg.changePct,
      avgFundingRate: fundingMonitor.getAvgRate(),
      maxFundingRate: maxFunding,
      minFundingRate: minFunding,
      cascadeRisk: fundingMonitor.getCascadeRisk(),
      basisData,
      avgBasisPercent: basisTracker.getAvgBasisPercent(),
      lastUpdate: Date.now(),
    };

    lastDerivState = derivState; // contexte pour le Risk Desk
    broadcast('derivatives', derivState);
  }, 10000);

  // ── Phase D: Scenario lifecycle tick every 1s (SL/TP checks were too
  // coarse at 5s during fast moves), full list broadcast every 5s
  // (individual scenario events are already pushed in real time) ──
  setInterval(() => {
    confluenceEngine.tick();
  }, 1000);

  setInterval(() => {
    broadcast('scenarios', confluenceEngine.getActiveScenarios());
  }, 5000);

  console.log(`[ENGINE] Started with ${connectors.length} exchange connector(s)`);
  console.log(`[ENGINE] Phase A active: Structure analysis (${[...structureAnalyzers.keys()].join(', ')}) + VWAP`);
  console.log(`[ENGINE] Phase B active: Order Blocks, FVGs, Liquidity, Volume Profile`);
  console.log(`[ENGINE] Phase C active: Open Interest, Funding Rate, Basis/Premium`);
  console.log(`[ENGINE] Phase D active: Confluence Engine (12 templates, max ${conflConfig.maxActiveScenarios ?? 4} concurrent scenarios, zone-retest feeder ON)`);
}
