# MACKUANT — Technical Overview

**Real-Time Bitcoin Order Flow Intelligence Platform**

A full-stack trading intelligence system that connects to 5 cryptocurrency exchanges simultaneously over WebSocket, processes raw trade/orderbook data through 7 signal detectors + multi-timeframe market structure analysis + derivatives tracking, and renders everything through a custom Canvas-based charting UI with scored trade scenarios.

**Stack**: TypeScript, Node.js backend, React frontend, WebSocket real-time transport, Canvas 2D for all rendering.

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
                        |  (5 tabs, all Canvas) |
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

Every trade from every exchange passes through a unified pipeline:
```
Trade → updateCandle() → updateCvd() → candleBuilder.onTrade() → vwapCalculator.onTrade()
      → volumeProfile.onTrade() → oiTracker.updatePrice() → basisTracker.updatePrice()
      → confluenceEngine.updatePrice() → detectors.process() → metrics.onTrade()
```

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
| Binance Futures | `GET /fapi/v1/klines?symbol=BTCUSDT&interval=1m` | 1500 candles |
| Binance Spot | `GET /api/v3/klines?symbol=BTCUSDT&interval=1m` | 1500 candles |
| Bybit | `GET /v5/market/kline?category=linear&symbol=BTCUSDT&interval=1` | 1000 candles |
| OKX | `GET /api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1m` | 300 candles |

**Derivatives Polling (continuous):**
| Data | Exchange | Endpoint | Interval |
|---|---|---|---|
| Open Interest | Binance Futures | `GET /fapi/v1/openInterest?symbol=BTCUSDT` | 10s |
| Open Interest | Bybit | `GET /v5/market/open-interest?category=linear&symbol=BTCUSDT` | 10s |
| Open Interest | OKX | `GET /api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC` | 10s |
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

**Data source**: REST API polling from 4 exchanges every 10 seconds.

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
- **Stop loss**: `entryLow - buffer` (LONG) or `entryHigh + buffer` (SHORT), buffer = `price × 0.15%`
- **Take profit**: TP1 = 1.5R, TP2 = 2.5R, TP3 = 4R from entry midpoint
- **Min R:R**: Must achieve at least 1.5:1 to TP2, otherwise discarded

**Priority levels**: LOW (<30), MEDIUM (30-55), HIGH (55-75), EXTREME (>75)

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

### Architecture: Fully Custom Canvas 2D

**No charting libraries used.** Everything is rendered directly on HTML5 Canvas via `CanvasRenderingContext2D`. This includes:
- Candlestick OHLC chart (wicks + bodies)
- Volume bars at bottom
- Multi-exchange overlay lines (each exchange's close price as a colored line)
- VWAP + σ bands (horizontal lines)
- Market structure overlays (swing highs/lows, BOS/CHoCH labels, OB zones, FVG zones, liquidity pool lines)
- Crosshair with price/time tooltips
- Y-axis (price labels, auto-scale) and X-axis (time labels)
- OHLC info bar (top-left, follows mouse)
- Current price dashed line + tag
- Horizontal scrolling via mouse drag or scroll wheel
- Auto-scroll mode (follows latest candle)
- "Go to latest" button when scrolled back
- Timeframe selector (1m, 5m, 15m, 1h, 4h)

### Rendering Loop

The chart uses a persistent `requestAnimationFrame` loop (mounted once, never remounted):

```typescript
useEffect(() => {
  // Setup canvas, ctx
  const draw = () => {
    // Read from refs (not React state) — decoupled from render cycle
    const cbe = dataRef.current;        // candle data
    const vwap = vwapRef.current;       // VWAP overlay
    const struct = structureRef.current; // structure data
    const tf = timeframeRef.current;    // active timeframe

    // Full chart rendering: ~60fps
    // 1. Clear canvas
    // 2. Compute visible window from scroll offset
    // 3. Auto-scale Y-axis from visible price range
    // 4. Draw grid, volume bars, overlay lines, candlesticks
    // 5. Draw VWAP bands, structure overlays (OBs, FVGs, liquidity)
    // 6. Draw axes, labels, crosshair, OHLC bar
  };

  const tick = () => { draw(); rafRef.current = requestAnimationFrame(tick); };
  rafRef.current = requestAnimationFrame(tick);

  // Mouse handlers for crosshair, drag-scroll, wheel-scroll
  return () => cancelAnimationFrame(rafRef.current);
}, []); // mounted once
```

**Key design decision**: All data is read from React refs, NOT from state. The rAF loop is completely decoupled from React's render cycle. React state changes only update the refs, and the rAF loop picks them up on the next frame.

### Multi-Timeframe Aggregation

The backend stores 1m candles. Higher timeframes (5m, 15m, 1h, 4h) are aggregated **on the frontend** from 1m data:

```typescript
function aggregateCandles(candles: Candle[], tfSeconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of candles) {
    const bucketTime = Math.floor(c.time / tfSeconds) * tfSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { time: bucketTime, open: c.open, high: c.high,
                                 low: c.low, close: c.close, volume: c.volume });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}
```

### Data Flow to Chart

```
Backend (engine.ts)                    Frontend (App.tsx)                Chart.tsx
┌─────────────────┐                   ┌──────────────────┐           ┌───────────────┐
│ candlesByExchange│─── WS 'candles'──>│ setCandlesByExch │──props──>│ dataRef.current│
│ (Map per exchange│    (every 30s)    │ (React state)    │          │ (read by rAF)  │
│  1500 × 1m each)│                   │                  │          │                │
│                  │─── WS 'candle_tick│ update last candle│          │ draw() at 60fps│
│                  │    (every 500ms)  │ in state         │          │                │
└─────────────────┘                   └──────────────────┘           └───────────────┘
```

### Multi-Exchange Overlay

The primary exchange (Binance Futures by default, or first available) is drawn as candlesticks. All other exchanges are drawn as colored close-price lines overlaid on the same chart:

| Exchange | Color |
|---|---|
| Binance Futures | #3b82f6 (blue) — candlesticks |
| Hyperliquid | #22c55e (green) — line |
| Bybit | #a855f7 (purple) — line |
| Binance Spot | #eab308 (yellow) — line |
| Coinbase | #06b6d4 (cyan) — line |
| OKX Spot | #f97316 (orange) — line |
| OKX Perp | #ef4444 (red) — line |

### Styling

TradingView-inspired dark theme:
- Background: `#131722`
- Grid: `rgba(42, 46, 57, 0.5)`
- Text: `#787b86`
- Bullish candles: `#26a69a` (teal green)
- Bearish candles: `#ef5350` (red)
- Crosshair: `rgba(152, 157, 169, 0.25)`
- Font: JetBrains Mono, monospace

---

## 10. Data Flow & Broadcast Schedule

All communication between backend and frontend is over a single WebSocket connection.

| Interval | Message Type | Payload | Purpose |
|---|---|---|---|
| 100ms | `trades` | Last 1s of trades | Tape/flow display |
| 100ms | `orderbooks` | Top bids/asks per exchange | Orderbook heatmap |
| 500ms | `candle_tick` | Current forming candle per exchange | Real-time chart update |
| 1s | `metrics` | TPM, volume/min, delta, liqs/min | Dashboard KPIs |
| 1s | `vwap` | VWAP + 4 bands | Chart overlay |
| 2s | `trend` | Score (-100 to +100), factors | Status bar |
| 2s | `structure` | Per-TF: swings, breaks, OBs, FVGs, pools | Chart overlays |
| 3s | `volumeProfile` | POC, VAH, VAL, bins, HVN, LVN | Volume profile panel |
| 5s | `scenarios` | Active trade scenarios | Scenario panel |
| 10s | `derivatives` | OI, funding, basis aggregate | Derivatives tab |
| 30s | `candles` | Full candle history per exchange | Chart history sync |
| 30s | `cvd` | Full CVD series | CVD chart |
| Event | `alert` | Detector alerts | Alert feed |
| Event | `scenario:new/update/invalidated` | Real-time scenario events | Scenario updates |

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

1. Fetch 1500 1m candles from 4 exchange REST APIs
2. Seed `CandleBuilder` with Binance Futures 1m data → emits historical candle:close events
3. Run `processHistorical()` on structure analyzers for each timeframe (1m, 5m, 15m)
4. Seed VWAP from today's session candles
5. Seed FVG detectors with historical candle data
6. Seed liquidity pools from initial swing points
7. Seed volume profile from historical candles
8. Begin real-time processing from WebSocket streams

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

### Canvas-Based Panels

**Every data-heavy panel is rendered with Canvas 2D**, not DOM elements:
- Chart (candlesticks, overlays, crosshair)
- Trade tape (scrolling trade list)
- Orderbook heatmap (bid/ask depth visualization)
- OI, Funding, Basis panels (gauges, sparklines, bars)
- Volume profile histogram
- Scenario cards (with scroll support)
- Screener tiles

This eliminates DOM node overhead and allows 60fps rendering of complex financial data.

### Performance Considerations

**Current known issue**: During large price moves, the chart can freeze momentarily because:
1. The full `candles` broadcast (1500 candles × 6 exchanges = ~500KB JSON) is parsed on the main thread every 30s
2. The `candle_tick` handler creates array copies via spread (`[...arr]`) for React state immutability, 10x per second across 6 exchanges
3. React re-renders cascade through the component tree on each state update

**Potential optimizations**:
- Use mutable refs for candle data instead of React state (Chart already reads from refs)
- Throttle React state sync to 1-2x per second instead of every tick
- Cache `aggregateCandles()` results instead of recomputing every frame
- Build time→index lookup maps for overlay line drawing

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
8. **Renders** everything on a custom Canvas 2D chart with candlesticks, multi-exchange overlays, structure annotations, and interactive crosshair

All of this runs on a single Node.js process with a React frontend, communicating over a single WebSocket connection.
