# MACKUANT Project Memory

## Project: crypto-orderflow-monitor
- Location: `c:\Users\dglco\Documents\code\cryptotool`
- Stack: TypeScript, Node.js backend, React frontend, WebSocket, TradingView Charting Library (price chart) + Canvas 2D (panels annexes)
- User language: French
- NB: les sections ci-dessous datent de fev 2026 — voir ALGORITHME_SCENARIOS.md (refontes juin/juillet 2026) pour l'etat actuel

## Architecture
- 5 exchanges (Binance spot+futures, Bybit, Coinbase, OKX, Hyperliquid) via WebSocket
- 7 signal detectors (spike, absorption, divergence, exhaustion, velocity, TWAP, liquidation)
- Multi-TF structure analysis (1m/5m/15m): BOS/CHoCH, OBs, FVGs, liquidity pools
- Derivatives tracking: OI (10s polling), funding (30s polling), basis (real-time)
- VWAP + volume profile
- Confluence engine → scored trade scenarios (10 templates)
- Trend analyzer: 6-factor composite score (-100 to +100)
- See [architecture.md](architecture.md) for details

## Key Files
- `src/server/engine.ts` — Central coordinator, all broadcast intervals
- `src/client/App.tsx` — WS subscriptions, GlobalContext, tab routing
- `src/client/components/Chart.tsx` — Custom Canvas 2D candlestick chart
- `src/client/hooks/useGlobalState.ts` — GlobalState/GlobalActions types
- `src/client/components/tabs/` — 5 tab components

## Recent Changes (Session Feb 2026)
- Fixed: Settings close button, Derivatives data mismatch, ScenarioPanel scroll, multi-TF selector
- Performance fix: candles broadcast 5s→30s, candle_tick 100ms→500ms
- Performance fix: mutation-based candle_tick handler (zero array copies) + throttled React sync (2/sec)
- Performance fix: aggregateCandles cache + O(1) overlay lookup via Map
- Added: HTF candles (1h: 500, 4h: 500) fetched from Binance REST API at startup
- Added: `candles_htf` broadcast, `htfCandles` in GlobalState
- Chart merges HTF historical with recent 1m aggregation for 1h/4h views
- Wrote TECHNICAL_OVERVIEW.md for sharing with friends

## Known Behaviors
- Structure analyzer has inherent lag (lookback candles needed to confirm pivots)
- Trend analyzer (BEAR/BULL) reacts in seconds, structure takes minutes to flip — divergence during big moves is expected
- Pre-existing TS error: `import.meta.env` in tsconfig.server.json (CommonJS mode) — doesn't affect runtime (tsx handles it)

## User Preferences
- Communicates in French
- Wants concise, natural messages (not over-detailed/robotic)
- Prefers fixes applied directly, not long explanations before action
