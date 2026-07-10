# MACKUANT — Technical Overview

> ⚠️ **Document de février 2026, antérieur aux refontes de juin/juillet 2026.** Le moteur de scénarios (entrées pullback, feeder de retest de zones, TP structurels, calibration auto, LLM Risk Desk) et le pipeline de perf ont été largement retravaillés depuis — voir `ALGORITHME_SCENARIOS.md` pour l'état actuel. L'architecture générale décrite ici reste valable.

**Real-Time Bitcoin Order Flow Intelligence Platform**

A full-stack trading intelligence system that connects to 5 cryptocurrency exchanges simultaneously over WebSocket, processes raw trade/orderbook data through 7 signal detectors + multi-timeframe market structure analysis + derivatives tracking, and renders everything through a TradingView Charting Library integration with scored trade scenarios.

**Stack**: TypeScript, Node.js backend, React frontend, WebSocket real-time transport, TradingView Charting Library (custom datafeed).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Exchange Connectivity](#2-exchange-connectivity)
3. [Signal Detectors (Phase A)](#3-signal-detectors-phase-a)
4. [Market Structure Analysis (Phase A+B)](#4-market-structure-analysis-phase-ab)
5. [Derivatives Tracking (Phase C)](#5-derivatives-tracking-phase-c)
6. [Profile Modules (VWAP + Volume Profile)](#6-profile-modules-vwap--volume-profile)
7. [Confluence Engine & Scenario Builder (Phase D)](#7-confluence-engine--scenario-builder-phase-d)
8. [Trend Analyzer](#8-trend-analyzer)
9. [Charting System](#9-charting-system)
10. [Data Flow & Broadcast Schedule](#10-data-flow--broadcast-schedule)
11. [Frontend Architecture](#11-frontend-architecture)

---

## 1. Architecture Overview

```
                        +-----------------------+
                        |   React Frontend      |
                        | (5 tabs, TradingView) |
                        +-----------+-----------+
                                    |
                              WebSocket /ws
                                    |
                        +-----------+-----------+
                        |   Node.js Backend     |
                        |   (Express + WS)      |
                        +-----------+-----------+
                                    |
          +--------+--------+-------+-------+--------+
          |        |        |       |       |        |
       Binance  Binance   Bybit  Coinbase  OKX   Hyperliquid
       (Spot)  (Futures)  (Perp)  (Spot)  (Spot+Perp) (Perp)
```

**Build Phases:**
- **Phase A**: Candle building (multi-TF), market structure (BOS/CHoCH, swing detection), VWAP
- **Phase B**: Order blocks, fair value gaps (FVGs), liquidity pools/sweeps, volume profile
- **Phase C**: Open interest tracking, funding rate monitoring, basis/premium tracking
- **Phase D**: Confluence engine aggregates all signals → scored trade scenarios

Trades are processed in **batches** (100ms intervals) to prevent CPU saturation during big moves:
```
Trades buffered (100ms) → Batch processing:
  Cheap ops (every trade): updateCandle() → updateCvd() → candleBuilder.onTrade()
                          → vwapCalculator.onTrade() → volumeProfile.onTrade()
  Expensive ops (once/batch): oiTracker.updatePrice() → basisTracker.updatePrice()
                              → confluenceEngine.updatePrice() → detectors.process()
                              → metrics.onTrade()
```

Candle close events are also **deferred** (500ms queue with per-timeframe deduplication) to avoid blocking the main loop during structure/FVG/OB analysis.

---

## 2. Exchange Connectivity

### Connected Exchanges

| Exchange | Markets | WebSocket Endpoint | Data Streams |
|---|---|---|---|
| **Binance** | Spot + Futures | `wss://stream.binance.com:9443/ws/...` (Spot) / `wss://fstream.binance.com/ws/...` (Futures) | Trades, 20-level orderbook @100ms, liquidations (futures only) |
| **Bybit** | Spot + Perp | `wss://stream.bybit.com/v5/public/spot` / `linear` | Trades, 25-level orderbook, liquidations |
| **Coinbase** | Spot + Perp (INTX) | `wss://ws-feed.exchange.coinbase.com` | Trade matches, L2 orderbook (snapshot + incremental) |
| **OKX** | Spot + Perp | `wss://ws.okx.com:8443/ws/v5/public` | Trades, 5-level orderbook |
| **Hyperliquid** | Perp only | `wss://api.hyperliquid.xyz/ws` | Trades, L2 book |

### REST API Usage (Historical Data & Polling)

**Historical Candles (fetched once at startup):**
| Exchange | Endpoint | Limit |
|---|---|---|
| Binance Futures | `GET /fapi/v1/klines?symbol=BTCUSDT&interval=1m` | **4500 candles** (3 paginated requests of 1500, ~3 days) |
| Binance Spot | `GET /api/v3/klines?symbol=BTCUSDT&interval=1m` | **4500 candles** (3 paginated requests of 1500) |
| Bybit | `GET /v5/market/kline?category=linear&symbol=BTCUSDT&interval=1` | 1000 candles |
| OKX | `GET /api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1m` | 300 candles |

MAX_CANDLES = 4500. Client-side pruning at 5000 (splices to 4500) to prevent memory growth.

**Derivatives Polling (continuous):**
| Data | Exchange | Endpoint | Interval |
|---|---|---|---|
| Open Interest | Binance Futures | `GET /fapi/v1/openInterest?symbol=BTCUSDT` | 10s |
| Open Interest | Bybit | `GET /v5/market/open-interest?category=linear&symbol=BTCUSDT` | 10s |
| Open Interest | OKX | `GET /api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP` | 10s |
| Open Interest | Hyperliquid | `POST /info` (`metaAndAssetCtxs`) | 10s |
| Funding Rate | Binance Futures | `GET /fapi/v1/fundingRate?symbol=BTCUSDT&limit=1` | 30s |
| Funding Rate | Bybit | `GET /v5/market/tickers?category=linear&symbol=BTCUSDT` | 30s |
| Funding Rate | OKX | `GET /api/v5/public/funding-rate?instId=BTC-USDT-SWAP` | 30s |
| Funding Rate | Hyperliquid | `POST /info` (`metaAndAssetCtxs`) | 30s |

### Trade Normalization

All exchanges are normalized to a unified `NormalizedTrade` format:
```typescript
{
  exchange: string,     // 'BINANCE', 'BINANCE_FUTURES', 'BYBIT', etc.
  market: 'SPOT' | 'PERP',
  symbol: string,
  price: number,
  quantity: number,
  side: 'BUY' | 'SELL', // Always the TAKER side
  timestamp: number,     // ms
  usdValue: number       // price * quantity
}
```

**Taker side correction per exchange:**
- Binance: `m === true` (maker is buyer) → taker is SELL
- Coinbase: `side` field is the MAKER side, so it's flipped
- Others: direct mapping from their side fields

### Connection Resilience

All connectors inherit from `BaseExchangeConnector` which provides:
- Automatic WebSocket reconnection with exponential backoff (1s → 30s cap)
- 30-second ping/pong keepalive
- Graceful JSON parse error handling (binary frames silently dropped)

---

## 3. Signal Detectors (Phase A)

Seven independent detectors process the rolling trade buffer (100,000 trades max) and emit typed alerts. Each has a per-key cooldown to prevent duplicate alerts.

### 3.1 Spike Detector

**What it detects**: Sudden volume surges by comparing a 5-second window against a rolling historical baseline.

**Logic**:
1. Takes all trades in the last 5 seconds
2. Computes average volume per 5-second window over the lookback period
3. `multiplier = recentVolume / avgVolumePerWindow`
4. Fires if `multiplier >= spikeMultiplier` AND `recentVolume >= minSpikeVolumeUsd`

**Default thresholds**: lookback = 5 min, multiplier = 3x, min volume = $500K.
**Cooldown**: 5 seconds.

### 3.2 Absorption Detector

**What it detects**: Large directional volume that fails to move price — institutional limit orders absorbing market orders.

**Logic**:
1. Sum buy and sell volume in a time window
2. Compute price movement percentage
3. If `volume >= threshold` AND `priceMove <= maxPriceMovePct` → absorption

**Types**:
- **Bearish Absorption**: Heavy buying, price doesn't rise (limit sellers absorbing)
- **Bullish Absorption**: Heavy selling, price doesn't fall (limit buyers absorbing)

**Default thresholds**: window = 10s, min volume = $2M, max price move = 0.03%.
**Cooldown**: 5 seconds.

### 3.3 Divergence Detector

**What it detects**: Price/CVD divergence — price moves one direction while net taker flow (CVD) moves the opposite.

**Logic**:
1. Compute CVD = sum(buyUSD) - sum(sellUSD) over window
2. Compute price change % (first to last trade)
3. Bullish divergence: price falling + CVD rising (buyers dominating despite price drop)
4. Bearish divergence: price rising + CVD falling

Also supports a "micro divergence" mode with shorter windows.

**Default thresholds**: window = 60s, min CVD change = $500K, min price change = 0.05%.
**Cooldown**: 8 seconds.

### 3.4 Exhaustion Detector

**What it detects**: Price moves on suspiciously low volume — a sign the move is running out of energy.

**Logic**: If price dropped/rose by `>= X dollars` but total volume is `<= Y`, the move lacks conviction.

**Default thresholds**: window = 30s, min price move = $100, max volume = $500K.
**Cooldown**: 10 seconds.

### 3.5 Velocity Detector

**What it detects**: Rapid CVD shifts ("flash pumps/dumps") and clusters of repeated velocity events.

**Logic**:
1. Compute CVD shift over a short window
2. If `|shift| >= threshold`, record event
3. If N events cluster within a longer window → "Flash Cluster" alert

**Default thresholds**: window = 5s, min CVD shift = $300K, cluster window = 30s, min cluster count = 3.
**Cooldown**: 3 seconds.

### 3.6 TWAP Detector

**What it detects**: Algorithmic TWAP execution — repeated same-side trades of similar size at regular intervals.

**Logic**:
1. Buffer last 200 trades per exchange
2. For each side, take the last N same-side trades
3. Check size uniformity (max deviation %) AND interval regularity (max deviation %)
4. Both must pass

**Default thresholds**: min occurrences = 5, size variation = 15%, interval variation = 40%.
**Cooldown**: 30 seconds.

### 3.7 Liquidation Detector

**What it detects**: Liquidation cascades — a surge of forced liquidations in a rolling window.

**Logic**: Sum all liquidation USD value in the window. Fire if above threshold.

**Sources**: Binance Futures (forceOrder stream) and Bybit (liquidation stream). Coinbase, OKX, and Hyperliquid don't provide liquidation feeds.

**Default thresholds**: window = 10s, min liquidation = $500K.
**Cooldown**: 5 seconds.

---

## 4. Market Structure Analysis (Phase A+B)

Multi-timeframe analysis running on 3 timeframes: 1m, 5m, 15m.

### 4.1 Swing Detection

**Pivot identification**: A candle at index `i` is a swing high if `candles[i].high` is strictly greater than all candles from `i - lookback` to `i + lookback` (default lookback = 5 candles per side).

This introduces a confirmation lag of `lookback` candles. Swing highs/lows are marked `broken` when price closes through them.

Stores up to 50 swings per direction.

### 4.2 Market Structure (BOS / CHoCH)

**Trend tracking**: UPTREND / DOWNTREND / RANGING, determined by comparing higher highs/higher lows vs lower highs/lower lows.

**Break of Structure (BOS)** — Continuation:
- In an uptrend: closing above the last swing high → trend continues
- In a downtrend: closing below the last swing low → trend continues

**Change of Character (CHoCH)** — Reversal:
- In an uptrend: closing below the last swing low → potential trend reversal
- In a downtrend: closing above the last swing high → potential trend reversal
- **Requires displacement confirmation**: the breaking candle's body (`|close - open|`) must exceed `minDisplacementATR × ATR(14)` to filter out slow grinds

### 4.3 Order Blocks (Phase B)

**What**: The last opposite-direction candle before a displacement move that caused a BOS or CHoCH. Represents institutional entry zones.

**Detection**:
1. On structure break, search backward up to 15 candles for the last opposite candle
2. Validate displacement: at least one candle between OB and break must have `body > minDisplacementATR × ATR`
3. Optionally validate FVG presence

**Strength scoring (0-100)**:
- Displacement score: up to 40 pts (`maxBody / ATR × 10`)
- Volume score: up to 30 pts (`obVolume / avgVolume(20) × 15`)
- FVG bonus: +15 if co-located FVG exists
- Freshness: +15 on creation

**Lifecycle**: Tested (price touches zone → -15 strength), Mitigated (price closes through → removed).

### 4.4 Fair Value Gaps (Phase B)

**What**: A 3-candle pattern where candle 1's wick doesn't overlap with candle 3's wick, leaving an unfilled imbalance.

**Detection**:
- Bullish FVG: `candle3.low > candle1.high` (gap up)
- Bearish FVG: `candle1.low > candle3.high` (gap down)
- Gap must be `>= minSizeATR × ATR`

**Fill tracking**: Monitors how much of the gap has been retraced. `filledPercent` computed in real-time.

### 4.5 Liquidity Pools & Sweeps (Phase B)

**Pools**: Clusters of equal swing highs (buyside liquidity — stops above) or equal swing lows (sellside liquidity — stops below). "Equal" = within configurable % tolerance.

**Sweep detection**: When price wicks above a buyside pool then closes back below it (or vice versa), it's a liquidity sweep — a stop hunt followed by a reversal.

---

## 5. Derivatives Tracking (Phase C)

### 5.1 Open Interest Tracker

**Data source**: REST API polling from 4 exchanges every 10 seconds. All APIs return OI in **coins (BTC)** or contracts — the tracker converts to USD by multiplying by the latest price (with cross-exchange fallback if a price isn't available yet).

**Alert types**:
- **OI_SURGE**: `|OI change| >= threshold%` in the direction of new positions opening
  - OI↑ + Price↑ → "Aggressive longs opening"
  - OI↑ + Price↓ → "Aggressive shorts opening"
- **OI_FLUSH**: OI decreasing (positions being closed/liquidated)
  - OI↓ + Price↑ → "Short squeeze"
  - OI↓ + Price↓ → "Long squeeze / capitulation"
- **OI_DIVERGENCE**: One exchange shows >1% OI increase while another shows >1% decrease

### 5.2 Funding Rate Monitor

**Data source**: REST API polling from 4 exchanges every 30 seconds.

**Alert types**:
- **FUNDING_EXTREME**: Rate exceeds ±0.05% per period
- **FUNDING_FLIP**: Funding rate changes sign between polls
- **FUNDING_DIVERGENCE**: One exchange positive, another negative

**Cascade risk assessment**: Based on absolute funding rate magnitude (LOW/MEDIUM/HIGH/CRITICAL).

Annualized rate = `rate × 3 × 365 × 100` (3 funding periods per day).

### 5.3 Basis/Premium Tracker

**Data source**: Real-time from the WebSocket trade stream (not REST polling). Compares perp vs spot prices per exchange.

**Formula**: `basis = perpPrice - spotPrice`, `basisPercent = basis / spotPrice × 100`

**Alert types**:
- **BASIS_EXTREME**: `|basisPercent| > 0.1%`
- **BASIS_DIVERGENCE**: Basis differs by >0.05% between two exchanges
- **BASIS_FLIP**: Average basis changes sign

---

## 6. Profile Modules (VWAP + Volume Profile)

### 6.1 VWAP (Volume-Weighted Average Price)

**Session-anchored** VWAP with standard deviation bands, reset daily at midnight UTC.

**Formula**:
```
VWAP = Σ(price × usdValue) / Σ(usdValue)
Variance = Σ(price² × usdValue) / Σ(usdValue) - VWAP²
StdDev = √Variance
Bands: VWAP ± 1σ, VWAP ± 2σ
```

Volume weighting uses USD value (not coin quantity) — standard for BTC VWAP.

**Historical seeding**: Seeds from today's session candles at startup. Uses candle close price as the representative price.

### 6.2 Volume Profile

**What**: Volume-by-price histogram that identifies where the most trading activity occurred.

**Implementation**:
- Prices rounded to nearest dollar, stored in a Map
- Binned into 50 price levels for display
- **POC** (Point of Control): Price level with highest volume
- **Value Area** (70% rule): Expanding outward from POC until 70% of volume is captured
  - **VAH**: Top of value area
  - **VAL**: Bottom of value area
- **HVN** (High Volume Nodes): Bins with `volume > avgBinVol × 1.5`
- **LVN** (Low Volume Nodes): Bins with `volume < avgBinVol × 0.3`

Session resets daily at midnight UTC.

---

## 7. Confluence Engine & Scenario Builder (Phase D)

### Signal Weights

The confluence engine scores signals by type with configurable weights:

| Signal Type | Default Weight |
|---|---|
| ORDER_BLOCK | 20 |
| LIQUIDITY_SWEEP | 20 |
| STRUCTURE (BOS/CHoCH) | 15 |
| ABSORPTION | 10 |
| FVG | 10 |
| DIVERGENCE | 8 |
| LIQUIDATION | 8 |
| FUNDING_EXTREME | 8 |
| OI_DIVERGENCE | 8 |
| TWAP | 5 |
| SPIKE | 5 |
| VELOCITY | 5 |
| EXHAUSTION | 5 |
| BASIS_EXTREME | 5 |
| VWAP_POSITION | 5 |
| VOLUME_PROFILE | 5 |

### Zone Grouping

Signals are grouped by **price proximity** (within 0.3% of each other). Additionally, all signals within 1% of the current price form a zone. Only zones with ≥2 signals are evaluated.

### Direction Determination

Weighted vote — each signal contributes its weight toward LONG or SHORT. Majority wins. Counter-directional signals subtract 30% of their weight from the score.

### Scenario Template Matching

10 predefined trade setup templates, each with required and bonus signals:

| # | Template Name | Required Signals |
|---|---|---|
| 1 | OB Retest after CHoCH | CHoCH + ORDER_BLOCK |
| 2 | Liquidity Sweep + Reversal | LIQUIDITY_SWEEP |
| 3 | FVG Fill + Continuation | BOS + FVG |
| 4 | Liquidation Cascade | LIQUIDATION + FUNDING_EXTREME |
| 5 | Short Squeeze Setup | FUNDING_EXTREME + STRUCTURE (LONG only) |
| 6 | Long Squeeze Setup | FUNDING_EXTREME + STRUCTURE (SHORT only) |
| 7 | VWAP Mean Reversion | VWAP_POSITION + EXHAUSTION |
| 8 | POC Rejection | VOLUME_PROFILE + ABSORPTION |
| 9 | TWAP Accumulation Breakout | TWAP + FVG |
| 10 | Multi-Exchange Divergence | DIVERGENCE |

### Scenario Construction

When a zone scores above `minScore (30)`:
- **Entry zone**: Union of all signal prices in the zone
- **Stop loss**: `entryLow - buffer` (LONG) or `entryHigh + buffer` (SHORT), buffer = `price × 0.1%`
- **Take profit**: TP1 = 1.5R, TP2 = 2.5R, TP3 = 4R from entry midpoint
- **Min R:R**: Must achieve at least 1.5:1 to TP2, otherwise discarded

**Priority levels**: LOW (>=30), MEDIUM (>=40), HIGH (>=55), EXTREME (>=75)

### Scenario Lifecycle

```
PENDING → ACTIVE → TRIGGERED
   ↓         ↓
EXPIRED  INVALIDATED
```

- PENDING → ACTIVE: price enters entry zone
- ACTIVE → TRIGGERED: price hits TP1
- ACTIVE → INVALIDATED: stop loss hit or invalidation price crossed
- Any → EXPIRED: 30 minutes default TTL
- Max 5 active scenarios. If full, lowest-score is evicted for a higher one.

---

## 8. Trend Analyzer

Produces a composite sentiment score from -100 (extreme bearish) to +100 (extreme bullish) by combining 6 independent factors:

| Factor | Weight | Input |
|---|---|---|
| Price Momentum | 25% | EMA(8) vs EMA(21) on 1-second price samples |
| CVD Trend | 25% | Recent 30s CVD avg vs older 30s CVD avg |
| Order Book Imbalance | 15% | Bid/ask volume ratio across all exchanges (EMA smoothed) |
| Signal Bias | 15% | Weighted bullish vs bearish count of last 30 alerts |
| Volume Momentum | 10% | Recent 10s volume vs prior 10s × price direction |
| Liquidation Pressure | 10% | Short liqs vs long liqs over 5 minutes |

**Labels**: `score > 15` → BULL, `score < -15` → BEAR, else NEUTRAL.

---

## 9. Charting System

### Architecture: TradingView Charting Library + Custom Datafeed

The main chart uses the **TradingView Charting Library** (static assets served from `public/charting_library/`) with a custom datafeed class that bridges our WebSocket candle data to TradingView's `IBasicDataFeed` interface.

**Key files:**
- `src/client/components/Chart.tsx` — TradingView widget wrapper + structure overlay shapes
- `src/client/datafeed/mackuantDatafeed.ts` — Custom datafeed (getBars, subscribeBars, etc.)

### Custom Datafeed (`MackuantDatafeed`)

The datafeed holds a reference to a shared candle data store (updated from React) and implements:

- **`onReady(cb)`** — Config: supported resolutions `['1', '5', '15', '60', '240']`, crypto type
- **`resolveSymbol(name, onResolve)`** — Returns `LibrarySymbolInfo` per exchange key (e.g. `BINANCE_FUTURES:PERP`). Session `24x7`, timezone `Etc/UTC`, pricescale `100`
- **`getBars(symbolInfo, resolution, periodParams, onResult)`** — Reads from the candle store, aggregates 1m candles into target timeframe. For 1h/4h, merges HTF historical data. Uses **binary search** for range filtering (not `.filter()`)
- **`subscribeBars(symbolInfo, resolution, onTick, guid)`** — Stores callback. `onRealtimeUpdate()` called externally to push live ticks
- **`searchSymbols()`** — Returns known exchange symbols

**Performance optimizations:**
- **Bar cache**: Keyed by `symbol:resolution`, invalidated only when source data changes (length or lastTime)
- **Binary search** in `getBars()` for O(log n) range filtering on sorted arrays
- **Cache reset** on initial data load (big jump in bar count triggers `onResetCacheNeededCallback`)

### Multi-Timeframe Aggregation

The backend stores 1m candles (up to 4500 per exchange). For **5m and 15m**, candles are aggregated in the datafeed from 1m data. For **1h and 4h**, the backend fetches 500 historical candles each from Binance Futures REST API at startup, then continues building them in real-time. The datafeed merges HTF history with recent 1m aggregation (Map dedup, recent overwrites historical).

### Data Flow to Chart

```
Backend (engine.ts)                    Frontend (App.tsx)                   Chart.tsx
┌─────────────────┐                   ┌────────────────────────┐        ┌──────────────────┐
│ candlesByExchange│── WS initial sync─>│ candleStoreRef (mutable)│──ref─>│ MackuantDatafeed │
│ (4500 × 1m each)│   (on connect only)│ + setCandlesByExch     │        │  .updateStore()  │
│                  │── WS 'candle_tick' │ mutate ref in-place    │        │  .onRealtimeUpdate│
│                  │   (every 500ms)   │ (zero array copies)    │        │      ↓            │
│ htfCandles       │── WS 'candles_htf'│ setHtfCandles          │        │ TradingView Widget│
│ (500×1h + 500×4h)│  (every 30s)     │ (React state)          │        │ (getBars/onTick)  │
└─────────────────┘                   └────────────────────────┘        └──────────────────┘
```

### Structure Overlays

TradingView's `createShape()` and `createMultipointShape()` API is used to draw structure overlays on the chart:

- **Order Blocks**: Rectangles (max 5 displayed) with strength-based opacity
- **FVGs**: Rectangles (max 4) with fill tracking
- **BOS/CHoCH labels**: Text shapes (max 5)
- **Liquidity pools**: Horizontal lines (strength >= 4, max 3)
- **Swing points**: Triangle shapes (4 highs + 4 lows)
- **VWAP bands**: Horizontal lines labeled "VWAP +1", "VWAP -1", "VWAP +2", "VWAP -2"

Overlays are updated when `structureData` or `vwapData` props change, with old shapes removed before redrawing.

### CVD Chart (Custom Canvas)

The CVD (Cumulative Volume Delta) chart remains a **custom Canvas 2D** component (`CvdChart.tsx`) since TradingView doesn't natively support CVD:

- **Zoom**: Mouse wheel zooms in/out (0.3x to 8x multiplier on candle spacing)
- **Time labels**: Smart spacing (min 80px), aligned to round intervals (5min, 15min, 1h...), date shown when span > 1 day
- **Fullscreen mode**: Overlay triggered by button, exit with ESC key

### TradingView Widget Configuration

```typescript
{
  symbol: primaryExchangeKey,  // e.g. 'BINANCE_FUTURES:PERP'
  interval: '1',
  theme: 'dark',
  library_path: '/charting_library/',
  custom_css_url: '/charting_library/custom.css',
  autosize: true,
  disabled_features: [
    'header_symbol_search', 'header_compare',
    'display_market_status', 'timeframes_toolbar',
    'use_localstorage_for_settings',
  ],
  enabled_features: ['hide_left_toolbar_by_default'],
  overrides: {
    'paneProperties.background': '#0a0a0a',
    'paneProperties.backgroundType': 'solid',
    // ... dark theme matching the UI
  },
}
```

---

## 10. Data Flow & Broadcast Schedule

All communication between backend and frontend is over a single WebSocket connection.

| Interval | Message Type | Payload | Purpose |
|---|---|---|---|
| 100ms | `trades` | Last 1s of trades | Tape/flow display |
| 100ms | `orderbooks` | Top bids/asks per exchange | Orderbook heatmap |
| 500ms | `candle_tick` | Current forming candle per exchange | Real-time chart update |
| 500ms | `cvd_tick` | Latest CVD data point | Real-time CVD update |
| 1s | `metrics` | TPM, volume/min, delta, liqs/min | Dashboard KPIs |
| 1s | `vwap` | VWAP + 4 bands | Chart overlay |
| 2s | `trend` | Score (-100 to +100), factors | Status bar |
| 2s | `structure` | Per-TF: swings, breaks, OBs, FVGs, pools | Chart overlays |
| 3s | `volumeProfile` | POC, VAH, VAL, bins, HVN, LVN | Volume profile panel |
| 5s | `scenarios` | Active trade scenarios | Scenario panel |
| 10s | `derivatives` | OI, funding, basis aggregate | Derivatives tab |
| 30s | `candles_htf` | 1h (500) + 4h (500) candles per exchange | HTF chart history |
| On connect | `candles` | Full candle history per exchange (4500 × ~4 exchanges) | Initial chart sync |
| On connect | `cvd` | Full CVD series | Initial CVD sync |
| Event | `alert` | Detector alerts (**batched**, flushed every 200ms) | Alert feed |
| Event | `scenario:new/update/invalidated` | Real-time scenario events | Scenario updates |

**Key change**: Full candle and CVD data is only sent **once on client WebSocket connect** (initial sync), not periodically. After that, only `candle_tick` and `cvd_tick` incremental updates are sent. This reduced memory pressure from ~5MB/cycle to near zero for steady-state operation.

### Message Format

```json
{
  "type": "candle_tick",
  "data": {
    "BINANCE_FUTURES:PERP": { "time": 1709000000, "open": 97000, "high": 97100, ... },
    "BYBIT:PERP": { ... }
  },
  "timestamp": 1709000000500
}
```

### Historical Initialization Sequence (at startup)

1. Fetch 4500 1m candles from Binance (paginated 3×1500), 1000 from Bybit, 300 from OKX
2. Fetch 500 1h + 500 4h candles from Binance Futures REST API (HTF history)
3. Seed `CandleBuilder` with Binance Futures 1m data → emits historical candle:close events
4. Run `processHistorical()` on structure analyzers for each timeframe (1m, 5m, 15m)
5. Seed VWAP from today's session candles
6. Seed FVG detectors with historical candle data
7. Seed liquidity pools from initial swing points
8. Seed volume profile from historical candles
9. Begin real-time processing from WebSocket streams

---

## 11. Frontend Architecture

### Tab-Based UI (5 Tabs)

| Tab | Panels |
|---|---|
| **Order Flow** | Candlestick chart + overlays, Trade tape, Orderbook heatmap |
| **Structure** | Candlestick chart (same component), Scenario panel |
| **Derivatives** | Candlestick chart, OI panel, Funding panel, Basis panel |
| **Volume Profile** | Candlestick chart, Volume profile histogram |
| **Tools** | Screener panel, Settings |

### Global State Management

`GlobalContext` (React Context) holds all state that's always updated regardless of which tab is active:
- Price, trend, metrics
- Candle data for all exchanges
- CVD, VWAP, structure, derivatives, volume profile data
- Active scenarios
- Alerts
- Unread alert counters per tab

WebSocket subscriptions are set up in `App.tsx` and remain active even when switching tabs — no data gaps when changing views.

### Rendering Approach

- **Main chart**: TradingView Charting Library (iframe-based, handles its own rendering)
- **CVD chart**: Custom Canvas 2D with zoom/fullscreen support
- **Other panels** (orderbook heatmap, trade tape, OI/Funding/Basis, volume profile, scenario cards, screener): Canvas 2D rendering

### Activity Log

React DOM component with performance optimizations:
- `React.useMemo` for filtered alerts
- **Only 50 items rendered** in DOM (`.slice(0, 50)`), even if 200 alerts are stored
- Alert cap: 200 max in state (oldest pruned on new alert)
- Filter buttons for 7 signal types + exchange filter

### Performance Optimizations (Implemented)

**Frontend:**
1. **Mutable stores**: `candleStoreRef` and `cvdStoreRef` hold candle/CVD arrays as plain mutable refs. Tick handlers mutate in-place (zero array copies)
2. **Throttled React sync**: React state only updated at max 2x/sec via timestamp gating
3. **Client-side candle pruning**: Arrays pruned at 5000 entries (spliced to 4500) to prevent memory growth
4. **Activity Log DOM limit**: Only 50 items rendered regardless of alert count
5. **Datafeed bar cache**: Pre-computed bar arrays cached by `symbol:resolution`, invalidated on data change

**Backend:**
6. **Trade batch processing** (100ms): Trades buffered and processed in bulk. Cheap ops run for every trade, expensive ops once per batch
7. **Deferred candle:close** (500ms queue): Structure/FVG/OB analysis deferred with per-timeframe deduplication
8. **Alert batching** (200ms flush): Alerts queued and broadcast in batches, not individually
9. **Detector throttling** (20Hz max): `DETECTOR_MIN_INTERVAL_MS = 50` prevents detector spam during big moves
10. **CircularBuffer binary search**: `getRecent(ms)` uses binary search on sorted buffer (O(log n) vs O(n))
11. **Initial sync only**: Full candle/CVD data sent once on client connect, then incremental ticks only
12. **Performance monitoring**: `[PERF]` logs every 10s (trades/sec, batch timing, event loop lag)

---

## Summary

MACKUANT is a comprehensive BTC-focused trading intelligence platform that:

1. **Connects** to 5 exchanges (10 WebSocket streams) for real-time trade, orderbook, and liquidation data
2. **Detects** 7 types of microstructure signals (spikes, absorption, divergence, exhaustion, velocity, TWAP, liquidation cascades)
3. **Analyzes** market structure on 3 timeframes (swing highs/lows, BOS/CHoCH, with displacement validation)
4. **Identifies** key price zones (order blocks, FVGs, liquidity pools) and monitors their lifecycle (tested, mitigated, filled, swept)
5. **Tracks** derivatives data (OI, funding, basis) from 4 exchanges via REST polling
6. **Maintains** VWAP + σ bands and volume profile in real-time
7. **Scores** signal confluence across 16 weighted categories and generates trade scenarios matched against 10 predefined templates
8. **Renders** the main chart via TradingView Charting Library with a custom datafeed, plus Canvas 2D for CVD, orderbook heatmap, and other panels
9. **Optimized** for high-throughput via trade batch processing (100ms), deferred candle:close analysis (500ms), alert batching (200ms), bar caching with binary search, and initial-sync-only candle delivery

All of this runs on a single Node.js process with a React frontend, communicating over a single WebSocket connection.
