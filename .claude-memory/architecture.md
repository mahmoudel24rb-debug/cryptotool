# MACKUANT Architecture Details

## Backend Broadcast Schedule
| Interval | Type | Content |
|---|---|---|
| 500ms | `candle_tick` | Current candle per exchange |
| 500ms | `cvd_tick` | Latest CVD point |
| 1s | `metrics` | TPM, volume/min, delta, liqs |
| 1s | `vwap` | VWAP + sigma bands |
| 2s | `trend` | Score + factors |
| 2s | `structure` | Per-TF swings, breaks, OBs, FVGs, pools |
| 3s | `volumeProfile` | POC, VAH, VAL, bins |
| 5s | `scenarios` | Active trade scenarios |
| 10s | `derivatives` | OI, funding, basis |
| 30s | `candles` | Full 1500 1m candles per exchange |
| 30s | `cvd` | Full CVD series |
| 30s | `candles_htf` | 1h (500) + 4h (500) candles |
| event | `alert` | Detector alerts |
| event | `scenario:new/update/invalidated` | Scenario lifecycle |

## Chart Architecture
- Custom Canvas 2D, no libraries
- rAF loop at 60fps, reads from refs (decoupled from React)
- Data refs updated on React render, rAF picks up next frame
- Candle data: mutation-based updates from WS ticks, throttled React sync
- aggregateCandles() cached per frame (key = length + lastTime + tfSec)
- Overlay lookups: time→index Map (O(1))
- HTF (1h/4h): backend historical merged with frontend 1m aggregation

## Frontend State Management
- GlobalContext with state + actions
- candleStoreRef: mutable ref for zero-copy candle updates
- cvdStoreRef: mutable ref for zero-copy CVD updates
- React state synced at max 2/sec via throttle refs

## Exchange Connectors
- Base class with auto-reconnect (exponential backoff 1s→30s)
- 30s ping/pong keepalive
- All trades normalized to NormalizedTrade (taker side corrected per exchange)

## Confluence Engine
- 16 weighted signal types (max weight: ORDER_BLOCK=20, LIQUIDITY_SWEEP=20)
- Zone grouping: signals within 0.3% of each other
- Min score for scenario: 30
- Scenario lifecycle: PENDING→ACTIVE→TRIGGERED, or INVALIDATED/EXPIRED
- Max 5 active scenarios, 30min TTL
- 10 templates (OB retest, liq sweep, FVG fill, cascade, squeeze, VWAP reversion, etc.)
