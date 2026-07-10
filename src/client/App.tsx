import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useActiveTab, type TabId } from './hooks/useActiveTab';
import { GlobalContext, type Alert, type MetricsData, type GlobalState, type GlobalActions, type GlobalContextValue } from './hooks/useGlobalState';
import GlobalStatusBar from './components/platform/GlobalStatusBar';
import TabNavigation from './components/platform/TabNavigation';
import GlobalAlertToast, { pushToast } from './components/platform/GlobalAlertToast';
import OrderFlowTab from './components/tabs/OrderFlowTab';
import StructureTab from './components/tabs/StructureTab';
import DerivativesTab from './components/tabs/DerivativesTab';
import VolumeProfileTab from './components/tabs/VolumeProfileTab';
import ToolsTab from './components/tabs/ToolsTab';

// Prod : même origine que la page (Railway = HTTPS sans port → wss://host/ws).
// L'ancien code forçait ws:// et le port 3000 — connexion impossible derrière
// un proxy HTTPS. Dev : Vite sur :5173, serveur WS sur :4242.
const WS_URL = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
  : `ws://${window.location.hostname}:4242/ws`;

export default function App() {
  const { connected, subscribe } = useWebSocket(WS_URL);
  const { activeTab, setActiveTab, tabThemeColor } = useActiveTab();

  // ── Global state (always updated, regardless of active tab) ──
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [metrics, setMetrics] = useState<MetricsData>({
    tradesPerMinute: 0,
    volumePerMinute: 0,
    tradesDelta: 0,
    liquidationsPerMinute: 0,
  });
  const [candlesByExchange, setCandlesByExchange] = useState<Record<string, any[]>>({});
  const [orderBooks, setOrderBooks] = useState<Record<string, any>>({});
  const [trend, setTrend] = useState<'BULL' | 'BEAR' | 'NEUTRAL'>('NEUTRAL');
  const [trendScore, setTrendScore] = useState(0);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [lastSpike, setLastSpike] = useState<string | null>(null);
  const [cvdData, setCvdData] = useState<{ time: number; value: number }[]>([]);
  const [vwapData, setVwapData] = useState<any>(null);
  const [structureData, setStructureData] = useState<Record<string, any>>({});
  const [volumeProfileData, setVolumeProfileData] = useState<any>(null);
  const [derivativesData, setDerivativesData] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [htfCandles, setHtfCandles] = useState<Record<string, Record<string, any[]>>>({});
  const [candleTickVersion, setCandleTickVersion] = useState(0);
  const candleTickVersionRef = useRef(0);

  // Mutable stores for high-frequency data (avoid array copies on every tick)
  const candleStoreRef = useRef<Record<string, any[]>>({});
  const candleSyncRef = useRef(0);
  const cvdStoreRef = useRef<{ time: number; value: number }[]>([]);
  const cvdSyncRef = useRef(0);
  const [unreadAlerts, setUnreadAlerts] = useState<Record<TabId, number>>({
    orderflow: 0, structure: 0, derivatives: 0, volume: 0, tools: 0,
  });

  const clearUnread = useCallback((tab: TabId) => {
    setUnreadAlerts(prev => ({ ...prev, [tab]: 0 }));
  }, []);

  const incrementUnread = useCallback((tab: TabId) => {
    setUnreadAlerts(prev => ({ ...prev, [tab]: (prev[tab] || 0) + 1 }));
  }, []);

  // Clear unread when switching to a tab
  useEffect(() => {
    clearUnread(activeTab);
  }, [activeTab, clearUnread]);

  // ── WebSocket subscriptions (always active) ──

  // Alerts — the server sends batches ('alert_batch', one WS frame per 200ms).
  // Alerts are buffered in a ref and flushed to React at 2 Hz: during big moves
  // the old per-alert setState caused a re-render storm of the whole app.
  const pendingAlertsRef = useRef<Alert[]>([]);
  const pendingUnreadRef = useRef({ orderflow: 0, structure: 0, derivatives: 0 });

  useEffect(() => {
    const MAX_TOASTS_PER_BATCH = 3;

    const processIncoming = (incoming: Alert[]) => {
      let toastCount = 0;
      for (const alert of incoming) {
        pendingAlertsRef.current.push(alert);
        pendingUnreadRef.current.orderflow++;

        if (alert.type === 'SPIKE') {
          setLastSpike(`[${alert.exchange}:${alert.symbol}] ${alert.message}`);
        }

        // Cross-tab toasts for critical events (capped per batch to avoid spam)
        if (alert.type === 'LIQUIDATION' && alert.details?.volumeUsd > 1_000_000 && toastCount < MAX_TOASTS_PER_BATCH) {
          toastCount++;
          pushToast({
            type: 'LIQUIDATION',
            message: `$${(alert.details.volumeUsd / 1e6).toFixed(1)}M on ${alert.exchange}`,
            color: '#ef4444',
            targetTab: 'orderflow',
          });
        }
        // Structure alerts (CHoCH)
        if (alert.message?.includes('CHoCH')) {
          if (toastCount < MAX_TOASTS_PER_BATCH) {
            toastCount++;
            pushToast({ type: 'CHoCH', message: alert.message, color: '#22d3ee', targetTab: 'structure' });
          }
          pendingUnreadRef.current.structure++;
        }
        // Derivatives alerts
        if (alert.type === 'OI_SURGE' || alert.type === 'FUNDING_EXTREME' || alert.type === 'BASIS_FLIP') {
          if (toastCount < MAX_TOASTS_PER_BATCH) {
            toastCount++;
            pushToast({ type: alert.type, message: alert.message, color: '#ff6b35', targetTab: 'derivatives' });
          }
          pendingUnreadRef.current.derivatives++;
        }
      }
    };

    const unsubBatch = subscribe('alert_batch', (msg) => processIncoming(msg.data as Alert[]));
    const unsubSingle = subscribe('alert', (msg) => processIncoming([msg.data as Alert])); // legacy/compat

    // Flush buffered alerts to React state at most 2x/sec
    const flushTimer = setInterval(() => {
      const pending = pendingAlertsRef.current;
      if (pending.length > 0) {
        pendingAlertsRef.current = [];
        const newestFirst = pending.slice().reverse();
        setAlerts(prev => [...newestFirst, ...prev].slice(0, 200));
      }
      const unread = pendingUnreadRef.current;
      if (unread.orderflow || unread.structure || unread.derivatives) {
        pendingUnreadRef.current = { orderflow: 0, structure: 0, derivatives: 0 };
        setUnreadAlerts(prev => ({
          ...prev,
          orderflow: prev.orderflow + unread.orderflow,
          structure: prev.structure + unread.structure,
          derivatives: prev.derivatives + unread.derivatives,
        }));
      }
    }, 500);

    return () => { unsubBatch(); unsubSingle(); clearInterval(flushTimer); };
  }, [subscribe]);

  // Metrics
  useEffect(() => {
    const unsub = subscribe('metrics', (msg) => {
      setMetrics(msg.data as MetricsData);
    });
    return unsub;
  }, [subscribe]);

  // Candles full history (sent once on connect — immediate React sync)
  useEffect(() => {
    const unsub = subscribe('candles', (msg) => {
      const data = msg.data as Record<string, any[]>;
      candleStoreRef.current = data;
      setCandlesByExchange(data);
      // CHART-FIX-1: Force Chart.tsx to pick up the new store reference
      setCandleTickVersion(prev => prev + 1);
      // CHART-FIX-5: Force next candle_tick to bypass throttle
      candleSyncRef.current = 0;
    });
    return unsub;
  }, [subscribe]);

  // Header price: use same priority as Chart.tsx to avoid exchange mismatch
  const PRICE_PRIORITY_KEYS = ['BYBIT:PERP', 'BINANCE_FUTURES:PERP', 'BINANCE:SPOT', 'OKX:PERP', 'COINBASE:SPOT', 'HYPERLIQUID:PERP'];

  // Candle ticks (every 500ms — mutate in place, throttle React to 2/sec)
  // Server may send Candle or Candle[] (when minute just changed, [prev, current])
  useEffect(() => {
    const unsub = subscribe('candle_tick', (msg) => {
      const ticks = msg.data as Record<string, any>;
      const store = candleStoreRef.current;

      for (const [key, payload] of Object.entries(ticks)) {
        const arr = store[key];
        if (!arr || arr.length === 0) {
          store[key] = Array.isArray(payload) ? payload : [payload];
          continue;
        }

        // Normalize: always process an array
        const candles = Array.isArray(payload) ? payload : [payload];
        for (const candle of candles) {
          const last = arr[arr.length - 1];
          if (!last) { arr.push(candle); continue; }
          if (candle.time === last.time) {
            arr[arr.length - 1] = candle; // in-place update
          } else if (candle.time > last.time) {
            arr.push(candle); // new minute
          }
        }

        // Prune oldest candles to prevent unbounded memory growth
        if (arr.length > 5000) arr.splice(0, arr.length - 4500);
      }

      // Track current price — use same priority as Chart.tsx (Bug #5)
      const priceKey = PRICE_PRIORITY_KEYS.find(k => store[k]?.length > 0)
        ?? Object.keys(store)[0];
      if (priceKey && store[priceKey]?.length > 0) {
        setCurrentPrice(store[priceKey][store[priceKey].length - 1].close ?? 0);
      }

      // Throttle React state sync to max 2x per second
      candleTickVersionRef.current++;
      const now = Date.now();
      if (now - candleSyncRef.current >= 500) {
        candleSyncRef.current = now;
        setCandlesByExchange({ ...store });
        setCandleTickVersion(candleTickVersionRef.current);
      }
    });
    return unsub;
  }, [subscribe]);

  // HTF candles (1h, 4h — from backend every 30s)
  useEffect(() => {
    const unsub = subscribe('candles_htf', (msg) => {
      setHtfCandles(msg.data as Record<string, Record<string, any[]>>);
    });
    return unsub;
  }, [subscribe]);

  // Orderbooks
  useEffect(() => {
    const unsub = subscribe('orderbooks', (msg) => {
      setOrderBooks(msg.data);
    });
    return unsub;
  }, [subscribe]);

  // CVD full history (every 30s — immediate sync)
  useEffect(() => {
    const unsub = subscribe('cvd', (msg) => {
      const data = msg.data as { time: number; value: number }[];
      cvdStoreRef.current = data;
      setCvdData(data);
    });
    return unsub;
  }, [subscribe]);

  // CVD ticks (every 500ms — mutate in place, throttle React)
  useEffect(() => {
    const unsub = subscribe('cvd_tick', (msg) => {
      const tick = msg.data as { time: number; value: number };
      const arr = cvdStoreRef.current;

      if (arr.length === 0) {
        arr.push(tick);
      } else {
        const last = arr[arr.length - 1];
        if (last.time === tick.time) {
          arr[arr.length - 1] = tick;
        } else if (tick.time > last.time) {
          arr.push(tick);
        }
      }

      const now = Date.now();
      if (now - cvdSyncRef.current >= 500) {
        cvdSyncRef.current = now;
        setCvdData([...arr]);
      }
    });
    return unsub;
  }, [subscribe]);

  // Trend
  useEffect(() => {
    const unsub = subscribe('trend', (msg) => {
      const data = msg.data as { trend: string; score: number; factors: Record<string, number> };
      setTrend(data.trend as 'BULL' | 'BEAR' | 'NEUTRAL');
      setTrendScore(data.score);
    });
    return unsub;
  }, [subscribe]);

  // VWAP
  useEffect(() => {
    const unsub = subscribe('vwap', (msg) => {
      setVwapData(msg.data);
    });
    return unsub;
  }, [subscribe]);

  // Structure
  useEffect(() => {
    const unsub = subscribe('structure', (msg) => {
      setStructureData(msg.data as Record<string, any>);
    });
    return unsub;
  }, [subscribe]);

  // Volume Profile
  useEffect(() => {
    const unsub = subscribe('volumeProfile', (msg) => {
      setVolumeProfileData(msg.data);
    });
    return unsub;
  }, [subscribe]);

  // Derivatives
  useEffect(() => {
    const unsub = subscribe('derivatives', (msg) => {
      setDerivativesData(msg.data);
    });
    return unsub;
  }, [subscribe]);

  // Scenarios
  useEffect(() => {
    const unsub = subscribe('scenarios', (msg) => {
      setScenarios(msg.data as any[]);
    });
    return unsub;
  }, [subscribe]);

  useEffect(() => {
    const unsub = subscribe('scenario:new', (msg) => {
      const sc = msg.data as any;
      setScenarios(prev => [sc, ...prev].slice(0, 10));

      // Toast for HIGH/EXTREME scenarios
      if (sc.priority === 'HIGH' || sc.priority === 'EXTREME') {
        pushToast({
          type: `${sc.direction} SCENARIO`,
          message: `${sc.templateName} — Score ${sc.score}/${sc.maxScore}`,
          color: sc.direction === 'LONG' ? '#22c55e' : '#ef4444',
          targetTab: 'structure',
        });
      }
      incrementUnread('structure');
    });
    return unsub;
  }, [subscribe, incrementUnread]);

  useEffect(() => {
    const unsub = subscribe('scenario:update', (msg) => {
      const updated = msg.data as any;
      setScenarios(prev => prev.map(s => s.id === updated.id ? updated : s));
    });
    return unsub;
  }, [subscribe]);

  useEffect(() => {
    const unsub = subscribe('scenario:invalidated', (msg) => {
      const inv = msg.data as any;
      setScenarios(prev => prev.map(s => s.id === inv.id ? inv : s));
    });
    return unsub;
  }, [subscribe]);

  // Expiration (missed entry, time stop, TTL) — jamais écouté auparavant :
  // les cartes disparaissaient sans montrer leur raison de sortie
  useEffect(() => {
    const unsub = subscribe('scenario:expired', (msg) => {
      const exp = msg.data as any;
      setScenarios(prev => prev.map(s => s.id === exp.id ? exp : s));
    });
    return unsub;
  }, [subscribe]);

  // ── Build GlobalContext value (memoized — a new object identity on every
  // render forced every context consumer to re-render on unrelated updates) ──
  const globalState: GlobalState = useMemo(() => ({
    connected,
    currentPrice,
    trend,
    trendScore,
    alerts,
    metrics,
    candlesByExchange,
    orderBooks,
    cvdData,
    vwapData,
    structureData,
    volumeProfileData,
    derivativesData,
    scenarios,
    unreadAlerts,
    lastSpike,
    htfCandles,
    candleTickVersion,
  }), [
    connected, currentPrice, trend, trendScore, alerts, metrics,
    candlesByExchange, orderBooks, cvdData, vwapData, structureData,
    volumeProfileData, derivativesData, scenarios, unreadAlerts,
    lastSpike, htfCandles, candleTickVersion,
  ]);

  const globalActions: GlobalActions = useMemo(() => ({
    setAlerts, setMetrics, setCandlesByExchange, setOrderBooks,
    setCvdData, setVwapData, setStructureData, setVolumeProfileData,
    setDerivativesData, setScenarios, setTrend, setTrendScore,
    setCurrentPrice, setLastSpike, setHtfCandles,
    setConnected: () => {},
    clearUnread,
    incrementUnread,
  }), [clearUnread, incrementUnread]);

  const ctxValue: GlobalContextValue = useMemo(
    () => ({ state: globalState, actions: globalActions, candleStoreRef }),
    [globalState, globalActions],
  );

  return (
    <GlobalContext.Provider value={ctxValue}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: '100vw',
          overflow: 'hidden',
          background: '#0a0a0a',
          color: '#e0e0e0',
          fontFamily: "'JetBrains Mono', 'Source Code Pro', monospace",
        }}
      >
        {/* Always visible: Global Status Bar */}
        <GlobalStatusBar
          connected={connected}
          trend={trend}
          trendScore={trendScore}
          currentPrice={currentPrice}
          tradesPerMinute={metrics.tradesPerMinute}
          volumePerMinute={metrics.volumePerMinute}
        />

        {/* Always visible: Tab Navigation */}
        <TabNavigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          unreadAlerts={unreadAlerts}
        />

        {/* Tab content — only active tab rendered */}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
          <div style={{ height: '100%', animation: 'tabFadeIn 150ms ease-out' }} key={activeTab}>
            {activeTab === 'orderflow' && <OrderFlowTab />}
            {activeTab === 'structure' && <StructureTab />}
            {activeTab === 'derivatives' && <DerivativesTab />}
            {activeTab === 'volume' && <VolumeProfileTab />}
            {activeTab === 'tools' && <ToolsTab />}
          </div>
        </main>

        {/* Always visible: Toast overlay */}
        <GlobalAlertToast onTabSwitch={setActiveTab} />
      </div>
    </GlobalContext.Provider>
  );
}
