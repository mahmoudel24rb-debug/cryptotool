import React from 'react';
import { useGlobalState } from '../../hooks/useGlobalState';
import Chart from '../Chart';
import CvdChart from '../CvdChart';
import OrderBookHeatmap from '../OrderBookHeatmap';
import ActivityLog from '../ActivityLog';
import Metrics from '../Metrics';
import Settings from '../Settings';

export default function OrderFlowTab() {
  const { state, actions } = useGlobalState();
  const [showSettings, setShowSettings] = React.useState(false);
  const [cvdExpanded, setCvdExpanded] = React.useState(false);

  // ESC key to exit CVD fullscreen
  React.useEffect(() => {
    if (!cvdExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCvdExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cvdExpanded]);

  const activeScenarios = state.scenarios.filter(
    (s: any) => s.status === 'PENDING' || s.status === 'ACTIVE'
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* CVD Fullscreen overlay */}
      {cvdExpanded && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 100, background: '#0a0a0a',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '4px 12px', background: '#0d1117', borderBottom: '1px solid #1e293b',
            flexShrink: 0,
          }}>
            <span style={{
              color: '#787b86', fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              CUMULATIVE VOLUME DELTA
            </span>
            <button
              onClick={() => setCvdExpanded(false)}
              style={{
                background: 'transparent', border: '1px solid #1e293b',
                color: '#9ca3af', cursor: 'pointer', padding: '2px 8px',
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#22d3ee'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#9ca3af'; }}
            >
              ESC — EXIT FULLSCREEN
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <CvdChart cvdData={state.cvdData} title="CVD" />
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: Bids heatmap */}
        <div style={{ width: 160, flexShrink: 0, height: '100%' }}>
          <OrderBookHeatmap orderBooks={state.orderBooks} side="bids" />
        </div>

        {/* Center: Charts */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          {/* Mini indicators bar */}
          <MiniIndicators
            trend={state.structureData?.['5m']?.trend || 'RANGING'}
            scenarioCount={activeScenarios.length}
            derivativesData={state.derivativesData}
          />

          {/* Main chart */}
          <div style={{ flex: '3 1 0%', minHeight: 0, overflow: 'hidden' }}>
            <Chart
              candlesByExchange={state.candlesByExchange}
              htfCandles={state.htfCandles}
              title="BTC — MULTI-EXCHANGE"
              vwapData={state.vwapData}
              structureData={state.structureData}
            />
          </div>

          {/* CVD Chart with expand button */}
          <div style={{ flex: '1.5 1 0%', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
            <CvdChart cvdData={state.cvdData} title="CVD" />
            <button
              onClick={() => setCvdExpanded(true)}
              title="Fullscreen CVD"
              style={{
                position: 'absolute', top: 4, right: 8, zIndex: 10,
                background: 'rgba(13,17,23,0.8)', border: '1px solid #1e293b',
                color: '#787b86', cursor: 'pointer', padding: '2px 6px',
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.color = '#22d3ee';
                (e.target as HTMLElement).style.borderColor = 'rgba(6,182,212,0.3)';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.color = '#787b86';
                (e.target as HTMLElement).style.borderColor = '#1e293b';
              }}
            >
              ⛶
            </button>
          </div>
        </div>

        {/* Right: Asks heatmap */}
        <div style={{ width: 160, flexShrink: 0, height: '100%' }}>
          <OrderBookHeatmap orderBooks={state.orderBooks} side="asks" />
        </div>
      </div>

      {/* Bottom section */}
      <div style={{ display: 'flex', height: 280, flexShrink: 0 }}>
        {/* Activity Log */}
        <div style={{ flex: 1 }}>
          <ActivityLog alerts={state.alerts} />
        </div>

        {/* Right panel: Metrics + Settings button */}
        <div style={{ width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <Metrics metrics={state.metrics} />
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setShowSettings(true)}
            style={{
              margin: 8,
              padding: '6px 0',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              border: '1px solid #1e293b',
              background: 'transparent',
              color: '#9ca3af',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 200ms',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.color = '#22d3ee';
              (e.target as HTMLElement).style.borderColor = 'rgba(6,182,212,0.3)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.color = '#9ca3af';
              (e.target as HTMLElement).style.borderColor = '#1e293b';
            }}
          >
            SHOW SETTINGS
          </button>
        </div>
      </div>

      {/* Settings modal */}
      <Settings visible={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

function MiniIndicators({ trend, scenarioCount, derivativesData }: {
  trend: string;
  scenarioCount: number;
  derivativesData: any;
}) {
  const trendColor = trend === 'UPTREND' ? '#22c55e' : trend === 'DOWNTREND' ? '#ef4444' : '#6b7280';

  // Extract compact OI/funding from derivatives data
  let oiStr = '';
  let frStr = '';
  if (derivativesData) {
    if (derivativesData.openInterest) {
      const entries = Object.values(derivativesData.openInterest) as any[];
      let total = 0;
      for (const v of entries) total += (typeof v === 'number' ? v : v?.value || 0);
      if (total > 0) oiStr = `OI $${(total / 1e9).toFixed(1)}B`;
    }
    if (derivativesData.funding) {
      const entries = Object.values(derivativesData.funding) as any[];
      let sum = 0, cnt = 0;
      for (const v of entries) { sum += (typeof v === 'number' ? v : v?.rate || 0); cnt++; }
      if (cnt > 0) frStr = `FR ${((sum / cnt) * 100).toFixed(4)}%`;
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '3px 12px',
        background: '#0d1117',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      }}
    >
      {/* Trend */}
      <span style={{
        color: trendColor,
        fontWeight: 700,
        fontSize: 9,
        padding: '1px 6px',
        background: `${trendColor}15`,
        letterSpacing: 1,
      }}>
        {trend}
      </span>

      {/* Active scenarios */}
      <span style={{ color: scenarioCount > 0 ? '#ffd700' : '#4b5563', fontSize: 9 }}>
        {scenarioCount > 0 ? `${scenarioCount} scenario${scenarioCount > 1 ? 's' : ''}` : 'No scenarios'}
      </span>

      <span style={{ color: '#1e293b' }}>|</span>

      {/* OI compact */}
      {oiStr && (
        <span style={{ color: '#ff6b35', fontSize: 9 }}>{oiStr}</span>
      )}

      {/* Funding compact */}
      {frStr && (
        <span style={{ color: '#9ca3af', fontSize: 9 }}>{frStr}</span>
      )}
    </div>
  );
}
