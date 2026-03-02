import React, { createContext, useContext, useRef, useCallback, useState, useEffect } from 'react';
import type { TabId } from './useActiveTab';

export interface Alert {
  id: string;
  type: string;
  market: string;
  exchange: string;
  symbol: string;
  timestamp: number;
  message: string;
  details: Record<string, any>;
}

export interface MetricsData {
  tradesPerMinute: number;
  volumePerMinute: number;
  tradesDelta: number;
  liquidationsPerMinute: number;
}

export interface GlobalState {
  // Connection
  connected: boolean;

  // Price & trend
  currentPrice: number;
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  trendScore: number;

  // Core data (always updated by WS subscriptions in App.tsx)
  alerts: Alert[];
  metrics: MetricsData;
  candlesByExchange: Record<string, any[]>;
  orderBooks: Record<string, any>;
  cvdData: { time: number; value: number }[];
  vwapData: any;
  structureData: Record<string, any>;
  volumeProfileData: any;
  derivativesData: any;
  scenarios: any[];

  // Unread alert counters per tab
  unreadAlerts: Record<TabId, number>;

  // Last spike for status bar
  lastSpike: string | null;

  // Higher timeframe candles (1h, 4h) — keyed by tf then exchange
  htfCandles: Record<string, Record<string, any[]>>;
}

export interface GlobalActions {
  setAlerts: React.Dispatch<React.SetStateAction<Alert[]>>;
  setMetrics: React.Dispatch<React.SetStateAction<MetricsData>>;
  setCandlesByExchange: React.Dispatch<React.SetStateAction<Record<string, any[]>>>;
  setOrderBooks: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setCvdData: React.Dispatch<React.SetStateAction<{ time: number; value: number }[]>>;
  setVwapData: React.Dispatch<React.SetStateAction<any>>;
  setStructureData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setVolumeProfileData: React.Dispatch<React.SetStateAction<any>>;
  setDerivativesData: React.Dispatch<React.SetStateAction<any>>;
  setScenarios: React.Dispatch<React.SetStateAction<any[]>>;
  setTrend: React.Dispatch<React.SetStateAction<'BULL' | 'BEAR' | 'NEUTRAL'>>;
  setTrendScore: React.Dispatch<React.SetStateAction<number>>;
  setCurrentPrice: React.Dispatch<React.SetStateAction<number>>;
  setLastSpike: React.Dispatch<React.SetStateAction<string | null>>;
  setHtfCandles: React.Dispatch<React.SetStateAction<Record<string, Record<string, any[]>>>>;
  setConnected: (c: boolean) => void;
  clearUnread: (tab: TabId) => void;
  incrementUnread: (tab: TabId) => void;
}

export interface GlobalContextValue {
  state: GlobalState;
  actions: GlobalActions;
}

export const GlobalContext = createContext<GlobalContextValue | null>(null);

export function useGlobalState(): GlobalContextValue {
  const ctx = useContext(GlobalContext);
  if (!ctx) throw new Error('useGlobalState must be used within GlobalStateProvider');
  return ctx;
}
