Microsoft Windows [version 10.0.26200.8655]
(c) Microsoft Corporation. Tous droits réservés.

C:\Windows\System32>cd c:\Users\dglco\Documents\code\cryptotool && npm run dev

> crypto-orderflow-monitor@1.0.0 dev
> concurrently "npm run dev:server" "npm run dev:client"

(node:17092) [DEP0060] DeprecationWarning: The `util._extend` API is deprecated. Please use Object.assign() instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
[0]
[0] > crypto-orderflow-monitor@1.0.0 dev:server
[0] > node --use-system-ca --watch --import tsx src/server/index.ts
[0]
[1]
[1] > crypto-orderflow-monitor@1.0.0 dev:client
[1] > vite
[1]
[1]
[1]   VITE v5.4.21  ready in 425 ms
[1]
[1]   ➜  Local:   http://localhost:5173/
[1]   ➜  Network: use --host to expose
[0]
[0] ========================================
[0]   MACKUANT — Trading Intelligence Platform
[0]   Server running on port 4242
[0]   WebSocket on ws://localhost:4242/ws
[0] ========================================
[0]
[0] [ENGINE] Starting order flow engine...
[0] [SCENARIO] State persistence active (every 30s, dirty-flag)
[0] [RISK-DESK] Active — model=claude-opus-4-8, minScore=45, veto=false
[0] [BINANCE] Connecting to spot...
[0] [BINANCE] Connecting to futures...
[0] [BYBIT] Connecting to spot...
[0] [BYBIT] Connecting to perp...
[0] [COINBASE] Connecting to spot...
[0] [HYPERLIQUID] Connecting to perp...
[0] [OKX] Connecting to main...
[0] [ENGINE] Started with 5 exchange connector(s)
[0] [ENGINE] Phase A active: Structure analysis (1m, 5m, 15m) + VWAP
[0] [ENGINE] Phase B active: Order Blocks, FVGs, Liquidity, Volume Profile
[0] [ENGINE] Phase C active: Open Interest, Funding Rate, Basis/Premium
[0] [ENGINE] Phase D active: Confluence Engine (10 templates, max 0/4 scenarios)
[0] [HTF] Loaded 500 historical 1h candles for BINANCE_FUTURES:PERP
[0] [CANDLES] BINANCE_FUTURES:PERP page 1: fetched 1500 candles (total: 1500)
[0] [COINBASE] Connected to spot
[0] [BYBIT] Connected to perp
[0] [BYBIT] Connected to spot
[0] [CANDLES] BINANCE_FUTURES:PERP page 2: fetched 1500 candles (total: 3000)
[0] [BINANCE] Connected to futures
[0] [OKX] Connected to main
[0] [HTF] Loaded 500 historical 4h candles for BINANCE_FUTURES:PERP
[0] [CANDLES] BINANCE_FUTURES:PERP page 3: fetched 1500 candles (total: 4500)
[0] [CANDLES] Loaded 4500 historical candles for BINANCE_FUTURES:PERP
[0] [BINANCE] Connected to spot
[0] [CONFLUENCE] signals=0 [] | price=$64229 atr=0.0 | trend=NEUTRAL(7) | active=0 | eval: 0 calls, noAnchor=0 lowScore=0 counterBlock=0 regimeBlock=0 noTemplate=0 dup=0 lowRR=0 badZone=0 emitted=0
[0] [CANDLES] BINANCE:SPOT page 1: fetched 1000 candles (total: 1000)
[0] [HYPERLIQUID] Connected to perp
[0] [CANDLES] BINANCE:SPOT page 2: fetched 1000 candles (total: 2000)
[0] [CANDLES] BINANCE:SPOT page 3: fetched 1000 candles (total: 3000)
[0] [CANDLES] Loaded 3000 historical candles for BINANCE:SPOT
[0] [CANDLES] BYBIT:PERP page 1: fetched 1000 candles (total: 1000)
[0] [CANDLES] BYBIT:PERP page 2: fetched 1000 candles (total: 2000)
[0] [CANDLES] BYBIT:PERP page 3: fetched 1000 candles (total: 3000)
[0] [CANDLES] Loaded 3000 historical candles for BYBIT:PERP
[0] [CANDLES] Loaded 1500 historical candles for COINBASE:SPOT
[0] [CANDLES] Loaded 4501 historical candles for HYPERLIQUID:PERP
[0] [CANDLES] Loaded 300 historical candles for OKX:PERP
[0] [PHASE-A] Seeded CandleBuilder with 4500 historical 1m candles
[0] [PHASE-A] 1m structure: DOWNTREND | 50 swing highs, 50 swing lows, 13 breaks
[0] [PHASE-A] 5m structure: DOWNTREND | 50 swing highs, 50 swing lows, 7 breaks
[0] [PHASE-A] 15m structure: DOWNTREND | 20 swing highs, 19 swing lows, 5 breaks
[0] [PHASE-A] VWAP seeded: $63546 | +1σ: $63889 | -1σ: $63204
[0] [PHASE-B] 1m FVGs: 0 active
[0] [PHASE-B] 5m FVGs: 0 active
[0] [PHASE-B] 15m FVGs: 0 active
[0] [PHASE-B] 1m Liquidity: 23 pools
[0] [PHASE-B] 5m Liquidity: 24 pools
[0] [PHASE-B] 15m Liquidity: 6 pools
[0] [PHASE-B] Volume Profile: POC $63409 | VAH $63894 | VAL $63206
[0] [PERF] 233 trades/sec | batches: 86 (max size: 292, max time: 2ms) | detect: 1ms | loop lag: 2ms | heap: 30MB | window: 2327 | pending: 14
[0] [FEEDS] COINBASE:SPOT 554 (0s) | BYBIT:PERP 316 (0s) | BYBIT:SPOT 171 (0s) | OKX:PERP 267 (0s) | OKX:SPOT 55 (0s) | BINANCE:SPOT 841 (0s) | HYPERLIQUID:PERP 123 (2s)
[0] [WS] Client connected (1 total)
[0] [WS] Client disconnected (0 total)
[0] [WS] Client connected (1 total)
[0] [WS] Sent full sync to 1 new client(s)
[0] [PERF] 286 trades/sec | batches: 95 (max size: 877, max time: 4ms) | detect: 3ms | loop lag: 0ms | heap: 41MB | window: 5183 | pending: 2
[0] [FEEDS] COINBASE:SPOT 110 (0s) | BYBIT:PERP 1041 (0s) | BYBIT:SPOT 283 (0s) | OKX:PERP 314 (0s) | OKX:SPOT 81 (0s) | BINANCE:SPOT 915 (0s) | HYPERLIQUID:PERP 112 (1s)
[0] [BINANCE] Futures WS silent — polling /fapi/v1/aggTrades as fallback
[0] [PERF] 276 trades/sec | batches: 93 (max size: 1003, max time: 6ms) | detect: 2ms | loop lag: 2ms | heap: 28MB | window: 7943 | pending: 3
[0] [FEEDS] COINBASE:SPOT 114 (1s) | BYBIT:PERP 350 (0s) | BYBIT:SPOT 79 (0s) | OKX:PERP 370 (0s) | OKX:SPOT 62 (1s) | BINANCE:SPOT 505 (1s) | HYPERLIQUID:PERP 115 (1s) | BINANCE_FUTURES:PERP 1165 (2s)
[0] [PERF] 319 trades/sec | batches: 97 (max size: 279, max time: 2ms) | detect: 4ms | loop lag: 4ms | heap: 31MB | window: 11130 | pending: 2
[0] [FEEDS] COINBASE:SPOT 131 (0s) | BYBIT:PERP 445 (0s) | BYBIT:SPOT 226 (1s) | OKX:PERP 436 (0s) | OKX:SPOT 80 (1s) | BINANCE:SPOT 1229 (1s) | HYPERLIQUID:PERP 132 (2s) | BINANCE_FUTURES:PERP 508 (2s)
[0] [PERF] 245 trades/sec | batches: 96 (max size: 175, max time: 2ms) | detect: 2ms | loop lag: 12ms | heap: 31MB | window: 13575 | pending: 2
[0] [FEEDS] COINBASE:SPOT 160 (0s) | BYBIT:PERP 395 (0s) | BYBIT:SPOT 107 (0s) | OKX:PERP 451 (0s) | OKX:SPOT 74 (0s) | BINANCE:SPOT 672 (0s) | HYPERLIQUID:PERP 53 (2s) | BINANCE_FUTURES:PERP 533 (2s)
[0] [PERF] 470 trades/sec | batches: 96 (max size: 1220, max time: 5ms) | detect: 7ms | loop lag: 11ms | heap: 31MB | window: 18272 | pending: 1
[0] [FEEDS] COINBASE:SPOT 335 (1s) | BYBIT:PERP 912 (1s) | BYBIT:SPOT 219 (0s) | OKX:PERP 614 (0s) | OKX:SPOT 149 (0s) | BINANCE:SPOT 1549 (0s) | HYPERLIQUID:PERP 118 (2s) | BINANCE_FUTURES:PERP 801 (2s)
[0] [PERF] 302 trades/sec | batches: 92 (max size: 513, max time: 2ms) | detect: 30ms | loop lag: 0ms | heap: 38MB | window: 21293 | pending: 5
[0] [FEEDS] COINBASE:SPOT 130 (0s) | BYBIT:PERP 398 (0s) | BYBIT:SPOT 129 (2s) | OKX:PERP 488 (0s) | OKX:SPOT 81 (0s) | BINANCE:SPOT 1235 (1s) | HYPERLIQUID:PERP 84 (2s) | BINANCE_FUTURES:PERP 476 (2s)
[0] [PERF] 268 trades/sec | batches: 93 (max size: 286, max time: 2ms) | detect: 3ms | loop lag: 1ms | heap: 34MB | window: 23969 | pending: 0
[0] [FEEDS] COINBASE:SPOT 100 (1s) | BYBIT:PERP 701 (0s) | BYBIT:SPOT 143 (0s) | OKX:PERP 365 (0s) | OKX:SPOT 53 (1s) | BINANCE:SPOT 951 (0s) | HYPERLIQUID:PERP 77 (1s) | BINANCE_FUTURES:PERP 286 (2s)
[0] [PERF] 150 trades/sec | batches: 93 (max size: 330, max time: 1ms) | detect: 5ms | loop lag: 6ms | heap: 34MB | window: 25472 | pending: 2
[0] [FEEDS] COINBASE:SPOT 119 (0s) | BYBIT:PERP 337 (1s) | BYBIT:SPOT 53 (2s) | OKX:PERP 220 (0s) | OKX:SPOT 26 (0s) | BINANCE:SPOT 377 (0s) | HYPERLIQUID:PERP 64 (1s) | BINANCE_FUTURES:PERP 307 (2s)
[0] [PERF] 149 trades/sec | batches: 89 (max size: 190, max time: 1ms) | detect: 5ms | loop lag: 3ms | heap: 40MB | window: 26965 | pending: 12
[0] [FEEDS] COINBASE:SPOT 177 (0s) | BYBIT:PERP 113 (0s) | BYBIT:SPOT 60 (0s) | OKX:PERP 227 (0s) | OKX:SPOT 56 (0s) | BINANCE:SPOT 657 (0s) | HYPERLIQUID:PERP 32 (2s) | BINANCE_FUTURES:PERP 171 (2s)
[0] [PERF] 203 trades/sec | batches: 89 (max size: 339, max time: 2ms) | detect: 3ms | loop lag: 0ms | heap: 45MB | window: 28993 | pending: 223
[0] [FEEDS] COINBASE:SPOT 221 (0s) | BYBIT:PERP 312 (0s) | BYBIT:SPOT 186 (0s) | OKX:PERP 347 (0s) | OKX:SPOT 59 (0s) | BINANCE:SPOT 587 (0s) | HYPERLIQUID:PERP 60 (1s) | BINANCE_FUTURES:PERP 256 (2s)
[0] [PERF] 340 trades/sec | batches: 87 (max size: 706, max time: 2ms) | detect: 4ms | loop lag: 0ms | heap: 35MB | window: 32394 | pending: 1
[0] [FEEDS] COINBASE:SPOT 103 (0s) | BYBIT:PERP 501 (0s) | BYBIT:SPOT 298 (0s) | OKX:PERP 454 (0s) | OKX:SPOT 130 (0s) | BINANCE:SPOT 1320 (0s) | HYPERLIQUID:PERP 96 (1s) | BINANCE_FUTURES:PERP 499 (2s)
[0] [PERF] 288 trades/sec | batches: 94 (max size: 253, max time: 2ms) | detect: 4ms | loop lag: 1ms | heap: 38MB | window: 35269 | pending: 1
[0] [FEEDS] COINBASE:SPOT 130 (1s) | BYBIT:PERP 579 (0s) | BYBIT:SPOT 132 (0s) | OKX:PERP 338 (0s) | OKX:SPOT 155 (0s) | BINANCE:SPOT 1152 (1s) | HYPERLIQUID:PERP 65 (1s) | BINANCE_FUTURES:PERP 324 (2s)
[0] [PERF] 294 trades/sec | batches: 97 (max size: 530, max time: 1ms) | detect: 5ms | loop lag: 4ms | heap: 37MB | window: 38213 | pending: 1
[0] [FEEDS] COINBASE:SPOT 160 (0s) | BYBIT:PERP 300 (0s) | BYBIT:SPOT 268 (0s) | OKX:PERP 463 (0s) | OKX:SPOT 118 (0s) | BINANCE:SPOT 1007 (0s) | HYPERLIQUID:PERP 145 (1s) | BINANCE_FUTURES:PERP 483 (2s)
[0] [PERF] 190 trades/sec | batches: 91 (max size: 297, max time: 2ms) | detect: 6ms | loop lag: 5ms | heap: 44MB | window: 40114 | pending: 0
[0] [FEEDS] COINBASE:SPOT 84 (0s) | BYBIT:PERP 261 (0s) | BYBIT:SPOT 118 (1s) | OKX:PERP 524 (0s) | OKX:SPOT 51 (1s) | BINANCE:SPOT 626 (0s) | HYPERLIQUID:PERP 20 (3s) | BINANCE_FUTURES:PERP 217 (2s)
[0] [PERF] 157 trades/sec | batches: 91 (max size: 251, max time: 1ms) | detect: 4ms | loop lag: 4ms | heap: 39MB | window: 41682 | pending: 0
[0] [FEEDS] COINBASE:SPOT 95 (0s) | BYBIT:PERP 298 (0s) | BYBIT:SPOT 126 (1s) | OKX:PERP 159 (0s) | OKX:SPOT 56 (1s) | BINANCE:SPOT 690 (0s) | HYPERLIQUID:PERP 27 (2s) | BINANCE_FUTURES:PERP 117 (2s)
[0] [PERF] 130 trades/sec | batches: 88 (max size: 154, max time: 1ms) | detect: 2ms | loop lag: 1ms | heap: 40MB | window: 42980 | pending: 0
[0] [FEEDS] COINBASE:SPOT 79 (0s) | BYBIT:PERP 257 (0s) | BYBIT:SPOT 80 (0s) | OKX:PERP 247 (0s) | OKX:SPOT 53 (1s) | BINANCE:SPOT 316 (0s) | HYPERLIQUID:PERP 65 (1s) | BINANCE_FUTURES:PERP 201 (2s)
[0] [PERF] 156 trades/sec | batches: 85 (max size: 437, max time: 1ms) | detect: 14ms | loop lag: 14ms | heap: 39MB | window: 43037 | pending: 10
[0] [FEEDS] COINBASE:SPOT 168 (0s) | BYBIT:PERP 321 (1s) | BYBIT:SPOT 70 (1s) | OKX:PERP 220 (1s) | OKX:SPOT 69 (1s) | BINANCE:SPOT 427 (1s) | HYPERLIQUID:PERP 54 (2s) | BINANCE_FUTURES:PERP 228 (2s)
[0] [PERF] 283 trades/sec | batches: 84 (max size: 546, max time: 3ms) | detect: 4ms | loop lag: 1ms | heap: 46MB | window: 45868 | pending: 0
[0] [FEEDS] COINBASE:SPOT 207 (0s) | BYBIT:PERP 794 (1s) | BYBIT:SPOT 126 (1s) | OKX:PERP 286 (0s) | OKX:SPOT 68 (3s) | BINANCE:SPOT 897 (0s) | HYPERLIQUID:PERP 103 (2s) | BINANCE_FUTURES:PERP 350 (2s)
[0] [PERF] 110 trades/sec | batches: 92 (max size: 116, max time: 1ms) | detect: 3ms | loop lag: 1ms | heap: 44MB | window: 46963 | pending: 0
[0] [FEEDS] COINBASE:SPOT 106 (0s) | BYBIT:PERP 163 (1s) | BYBIT:SPOT 82 (1s) | OKX:PERP 189 (0s) | OKX:SPOT 46 (2s) | BINANCE:SPOT 345 (1s) | HYPERLIQUID:PERP 43 (1s) | BINANCE_FUTURES:PERP 121 (2s)
[0] [PERF] 271 trades/sec | batches: 88 (max size: 362, max time: 1ms) | detect: 4ms | loop lag: 2ms | heap: 53MB | window: 48169 | pending: 0
[0] [FEEDS] COINBASE:SPOT 229 (1s) | BYBIT:PERP 422 (0s) | BYBIT:SPOT 174 (1s) | OKX:PERP 351 (0s) | OKX:SPOT 63 (1s) | BINANCE:SPOT 1077 (1s) | HYPERLIQUID:PERP 106 (2s) | BINANCE_FUTURES:PERP 284 (2s)
[0] [PERF] 286 trades/sec | batches: 87 (max size: 370, max time: 1ms) | detect: 5ms | loop lag: 1ms | heap: 50MB | window: 49524 | pending: 23
[0] [FEEDS] COINBASE:SPOT 197 (0s) | BYBIT:PERP 457 (0s) | BYBIT:SPOT 167 (0s) | OKX:PERP 391 (0s) | OKX:SPOT 89 (0s) | BINANCE:SPOT 1153 (0s) | HYPERLIQUID:PERP 71 (2s) | BINANCE_FUTURES:PERP 330 (2s)
[0] [PERF] 292 trades/sec | batches: 84 (max size: 466, max time: 2ms) | detect: 4ms | loop lag: 3ms | heap: 46MB | window: 50943 | pending: 0
[0] [FEEDS] COINBASE:SPOT 259 (0s) | BYBIT:PERP 513 (0s) | BYBIT:SPOT 227 (0s) | OKX:PERP 375 (0s) | OKX:SPOT 80 (1s) | BINANCE:SPOT 1020 (0s) | HYPERLIQUID:PERP 91 (2s) | BINANCE_FUTURES:PERP 354 (2s)
[0] [PERF] 114 trades/sec | batches: 84 (max size: 171, max time: 1ms) | detect: 5ms | loop lag: 1ms | heap: 49MB | window: 52085 | pending: 0
[0] [FEEDS] COINBASE:SPOT 85 (0s) | BYBIT:PERP 219 (2s) | BYBIT:SPOT 69 (2s) | OKX:PERP 238 (0s) | OKX:SPOT 36 (2s) | BINANCE:SPOT 189 (1s) | HYPERLIQUID:PERP 43 (2s) | BINANCE_FUTURES:PERP 263 (2s)
[0] [PERF] 69 trades/sec | batches: 90 (max size: 190, max time: 1ms) | detect: 3ms | loop lag: 2ms | heap: 52MB | window: 52775 | pending: 1
[0] [FEEDS] COINBASE:SPOT 70 (0s) | BYBIT:PERP 167 (0s) | BYBIT:SPOT 53 (0s) | OKX:PERP 120 (0s) | OKX:SPOT 11 (0s) | BINANCE:SPOT 150 (0s) | HYPERLIQUID:PERP 18 (1s) | BINANCE_FUTURES:PERP 101 (2s)
[0] [PERF] 255 trades/sec | batches: 90 (max size: 332, max time: 2ms) | detect: 3ms | loop lag: 0ms | heap: 57MB | window: 55323 | pending: 2
[0] [FEEDS] COINBASE:SPOT 352 (0s) | BYBIT:PERP 367 (1s) | BYBIT:SPOT 315 (1s) | OKX:PERP 193 (0s) | OKX:SPOT 82 (3s) | BINANCE:SPOT 765 (1s) | HYPERLIQUID:PERP 135 (2s) | BINANCE_FUTURES:PERP 339 (2s)
[0] [PERF] 143 trades/sec | batches: 85 (max size: 191, max time: 1ms) | detect: 3ms | loop lag: 1ms | heap: 54MB | window: 55257 | pending: 0
[0] [FEEDS] COINBASE:SPOT 104 (0s) | BYBIT:PERP 252 (0s) | BYBIT:SPOT 102 (0s) | OKX:PERP 218 (0s) | OKX:SPOT 51 (0s) | BINANCE:SPOT 428 (0s) | HYPERLIQUID:PERP 37 (1s) | BINANCE_FUTURES:PERP 242 (2s)
[0] [PERF] 126 trades/sec | batches: 92 (max size: 227, max time: 1ms) | detect: 3ms | loop lag: 0ms | heap: 52MB | window: 56514 | pending: 2
[0] [FEEDS] COINBASE:SPOT 73 (0s) | BYBIT:PERP 266 (0s) | BYBIT:SPOT 73 (1s) | OKX:PERP 237 (0s) | OKX:SPOT 27 (1s) | BINANCE:SPOT 366 (0s) | HYPERLIQUID:PERP 36 (3s) | BINANCE_FUTURES:PERP 179 (2s)
[0] [PERF] 140 trades/sec | batches: 86 (max size: 293, max time: 2ms) | detect: 4ms | loop lag: 0ms | heap: 50MB | window: 57909 | pending: 1
[0] [FEEDS] COINBASE:SPOT 98 (0s) | BYBIT:PERP 172 (0s) | BYBIT:SPOT 67 (1s) | OKX:PERP 150 (0s) | OKX:SPOT 317 (1s) | BINANCE:SPOT 362 (1s) | HYPERLIQUID:PERP 19 (2s) | BINANCE_FUTURES:PERP 210 (2s)
[0] [PERF] 166 trades/sec | batches: 94 (max size: 170, max time: 2ms) | detect: 3ms | loop lag: 0ms | heap: 47MB | window: 59569 | pending: 2
[0] [FEEDS] COINBASE:SPOT 117 (1s) | BYBIT:PERP 388 (0s) | BYBIT:SPOT 120 (2s) | OKX:PERP 267 (0s) | OKX:SPOT 37 (2s) | BINANCE:SPOT 365 (0s) | HYPERLIQUID:PERP 57 (2s) | BINANCE_FUTURES:PERP 309 (2s)
[0] [CONFLUENCE] signals=40 [VWAP_POSITION:1, VOLUME_PROFILE:3, FVG:1, DIVERGENCE:11, BASIS_EXTREME:3, ABSORPTION:9, SPIKE:4, VELOCITY:7, TWAP:1] | price=$64243 atr=56.9 | trend=BEAR(-34) | active=0 | eval: 57 calls, noAnchor=54 lowScore=0 counterBlock=0 regimeBlock=0 noTemplate=0 dup=0 lowRR=0 badZone=0 emitted=0
[0] [PERF] 130 trades/sec | batches: 90 (max size: 126, max time: 1ms) | detect: 2ms | loop lag: 2ms | heap: 43MB | window: 60873 | pending: 3
[0] [FEEDS] COINBASE:SPOT 244 (0s) | BYBIT:PERP 226 (0s) | BYBIT:SPOT 86 (0s) | OKX:PERP 180 (1s) | OKX:SPOT 34 (0s) | BINANCE:SPOT 236 (0s) | HYPERLIQUID:PERP 40 (2s) | BINANCE_FUTURES:PERP 258 (2s)
[0] [PERF] 64 trades/sec | batches: 85 (max size: 185, max time: 1ms) | detect: 4ms | loop lag: 1ms | heap: 59MB | window: 60012 | pending: 1
[0] [FEEDS] COINBASE:SPOT 67 (0s) | BYBIT:PERP 79 (0s) | BYBIT:SPOT 27 (0s) | OKX:PERP 138 (0s) | OKX:SPOT 22 (1s) | BINANCE:SPOT 162 (0s) | HYPERLIQUID:PERP 22 (3s) | BINANCE_FUTURES:PERP 122 (2s)
[0] [PERF] 271 trades/sec | batches: 84 (max size: 602, max time: 2ms) | detect: 3ms | loop lag: 4ms | heap: 58MB | window: 62720 | pending: 1
[0] [FEEDS] COINBASE:SPOT 341 (0s) | BYBIT:PERP 440 (0s) | BYBIT:SPOT 181 (3s) | OKX:PERP 371 (0s) | OKX:SPOT 75 (0s) | BINANCE:SPOT 856 (1s) | HYPERLIQUID:PERP 37 (2s) | BINANCE_FUTURES:PERP 407 (2s)
[0] [PERF] 308 trades/sec | batches: 82 (max size: 1008, max time: 3ms) | detect: 2ms | loop lag: 4ms | heap: 59MB | window: 64297 | pending: 2
[0] [FEEDS] COINBASE:SPOT 406 (0s) | BYBIT:PERP 680 (0s) | BYBIT:SPOT 190 (2s) | OKX:PERP 588 (1s) | OKX:SPOT 85 (1s) | BINANCE:SPOT 840 (1s) | HYPERLIQUID:PERP 57 (3s) | BINANCE_FUTURES:PERP 231 (2s)
[0] [PERF] 248 trades/sec | batches: 93 (max size: 322, max time: 1ms) | detect: 3ms | loop lag: 1ms | heap: 63MB | window: 66780 | pending: 76
[0] [FEEDS] COINBASE:SPOT 134 (0s) | BYBIT:PERP 430 (0s) | BYBIT:SPOT 158 (0s) | OKX:PERP 437 (0s) | OKX:SPOT 57 (0s) | BINANCE:SPOT 993 (0s) | HYPERLIQUID:PERP 65 (2s) | BINANCE_FUTURES:PERP 209 (2s)
[0] [PERF] 240 trades/sec | batches: 87 (max size: 331, max time: 1ms) | detect: 3ms | loop lag: 4ms | heap: 68MB | window: 67676 | pending: 6
[0] [FEEDS] COINBASE:SPOT 101 (0s) | BYBIT:PERP 452 (1s) | BYBIT:SPOT 113 (0s) | OKX:PERP 405 (0s) | OKX:SPOT 61 (2s) | BINANCE:SPOT 789 (1s) | HYPERLIQUID:PERP 113 (2s) | BINANCE_FUTURES:PERP 362 (2s)
[0] [PERF] 240 trades/sec | batches: 94 (max size: 355, max time: 1ms) | detect: 3ms | loop lag: 7ms | heap: 48MB | window: 70079 | pending: 0
[0] [FEEDS] COINBASE:SPOT 72 (0s) | BYBIT:PERP 427 (0s) | BYBIT:SPOT 226 (0s) | OKX:PERP 381 (0s) | OKX:SPOT 71 (0s) | BINANCE:SPOT 906 (0s) | HYPERLIQUID:PERP 111 (3s) | BINANCE_FUTURES:PERP 209 (2s)
[0] [PERF] 217 trades/sec | batches: 88 (max size: 266, max time: 1ms) | detect: 3ms | loop lag: 12ms | heap: 53MB | window: 69252 | pending: 3
[0] [FEEDS] COINBASE:SPOT 86 (0s) | BYBIT:PERP 422 (0s) | BYBIT:SPOT 141 (1s) | OKX:PERP 411 (0s) | OKX:SPOT 40 (2s) | BINANCE:SPOT 608 (0s) | HYPERLIQUID:PERP 78 (2s) | BINANCE_FUTURES:PERP 387 (2s)
[0] [PERF] 183 trades/sec | batches: 81 (max size: 282, max time: 2ms) | detect: 3ms | loop lag: 5ms | heap: 54MB | window: 71080 | pending: 0
[0] [FEEDS] COINBASE:SPOT 82 (0s) | BYBIT:PERP 281 (0s) | BYBIT:SPOT 173 (0s) | OKX:PERP 239 (0s) | OKX:SPOT 56 (1s) | BINANCE:SPOT 716 (0s) | HYPERLIQUID:PERP 53 (2s) | BINANCE_FUTURES:PERP 228 (2s)
[0] [PERF] 99 trades/sec | batches: 91 (max size: 144, max time: 1ms) | detect: 7ms | loop lag: 7ms | heap: 55MB | window: 70569 | pending: 0
[0] [FEEDS] COINBASE:SPOT 46 (0s) | BYBIT:PERP 203 (0s) | BYBIT:SPOT 64 (1s) | OKX:PERP 105 (0s) | OKX:SPOT 18 (1s) | BINANCE:SPOT 417 (1s) | HYPERLIQUID:PERP 19 (2s) | BINANCE_FUTURES:PERP 117 (2s)
[0] [PERF] 133 trades/sec | batches: 82 (max size: 158, max time: 1ms) | detect: 3ms | loop lag: 0ms | heap: 53MB | window: 71902 | pending: 1
[0] [FEEDS] COINBASE:SPOT 90 (0s) | BYBIT:PERP 243 (1s) | BYBIT:SPOT 106 (1s) | OKX:PERP 149 (0s) | OKX:SPOT 40 (1s) | BINANCE:SPOT 494 (0s) | HYPERLIQUID:PERP 31 (2s) | BINANCE_FUTURES:PERP 180 (2s)
[0] [PERF] 227 trades/sec | batches: 88 (max size: 258, max time: 1ms) | detect: 3ms | loop lag: 0ms | heap: 54MB | window: 72672 | pending: 1
[0] [FEEDS] COINBASE:SPOT 77 (0s) | BYBIT:PERP 346 (1s) | BYBIT:SPOT 153 (0s) | OKX:PERP 315 (0s) | OKX:SPOT 55 (1s) | BINANCE:SPOT 948 (1s) | HYPERLIQUID:PERP 27 (2s) | BINANCE_FUTURES:PERP 349 (2s)
[0] [PERF] 123 trades/sec | batches: 89 (max size: 270, max time: 1ms) | detect: 3ms | loop lag: 0ms | heap: 52MB | window: 73899 | pending: 0
[0] [FEEDS] COINBASE:SPOT 82 (0s) | BYBIT:PERP 208 (0s) | BYBIT:SPOT 59 (1s) | OKX:PERP 168 (0s) | OKX:SPOT 38 (1s) | BINANCE:SPOT 461 (0s) | HYPERLIQUID:PERP 22 (2s) | BINANCE_FUTURES:PERP 189 (2s)
[0] [PERF] 165 trades/sec | batches: 78 (max size: 313, max time: 1ms) | detect: 5ms | loop lag: 1ms | heap: 52MB | window: 74052 | pending: 0
[0] [FEEDS] COINBASE:SPOT 93 (0s) | BYBIT:PERP 340 (0s) | BYBIT:SPOT 92 (1s) | OKX:PERP 186 (1s) | OKX:SPOT 55 (1s) | BINANCE:SPOT 620 (1s) | HYPERLIQUID:PERP 39 (2s) | BINANCE_FUTURES:PERP 228 (2s)
[0] [PERF] 159 trades/sec | batches: 82 (max size: 489, max time: 3ms) | detect: 2ms | loop lag: 8ms | heap: 47MB | window: 74143 | pending: 0
[0] [FEEDS] COINBASE:SPOT 89 (0s) | BYBIT:PERP 249 (0s) | BYBIT:SPOT 129 (1s) | OKX:PERP 193 (0s) | OKX:SPOT 43 (0s) | BINANCE:SPOT 730 (1s) | HYPERLIQUID:PERP 20 (2s) | BINANCE_FUTURES:PERP 138 (2s)
[0] [PERF] 109 trades/sec | batches: 85 (max size: 264, max time: 1ms) | detect: 4ms | loop lag: 0ms | heap: 44MB | window: 75228 | pending: 2
[0] [FEEDS] COINBASE:SPOT 137 (0s) | BYBIT:PERP 154 (0s) | BYBIT:SPOT 106 (0s) | OKX:PERP 129 (0s) | OKX:SPOT 28 (2s) | BINANCE:SPOT 293 (1s) | HYPERLIQUID:PERP 95 (2s) | BINANCE_FUTURES:PERP 143 (2s)
[0] [PERF] 148 trades/sec | batches: 87 (max size: 605, max time: 2ms) | detect: 5ms | loop lag: 3ms | heap: 65MB | window: 76711 | pending: 2
[0] [FEEDS] COINBASE:SPOT 130 (0s) | BYBIT:PERP 245 (0s) | BYBIT:SPOT 96 (0s) | OKX:PERP 200 (0s) | OKX:SPOT 52 (1s) | BINANCE:SPOT 665 (0s) | HYPERLIQUID:PERP 17 (2s) | BINANCE_FUTURES:PERP 78 (2s)
[0] [PERF] 181 trades/sec | batches: 82 (max size: 275, max time: 2ms) | detect: 3ms | loop lag: 6ms | heap: 63MB | window: 77020 | pending: 2
[0] [FEEDS] COINBASE:SPOT 108 (0s) | BYBIT:PERP 407 (0s) | BYBIT:SPOT 135 (0s) | OKX:PERP 295 (0s) | OKX:SPOT 53 (1s) | BINANCE:SPOT 400 (0s) | HYPERLIQUID:PERP 62 (1s) | BINANCE_FUTURES:PERP 349 (1s)
[0] [PERF] 296 trades/sec | batches: 90 (max size: 315, max time: 2ms) | detect: 4ms | loop lag: 9ms | heap: 66MB | window: 76978 | pending: 0
[0] [FEEDS] COINBASE:SPOT 96 (0s) | BYBIT:PERP 461 (0s) | BYBIT:SPOT 257 (1s) | OKX:PERP 389 (0s) | OKX:SPOT 73 (1s) | BINANCE:SPOT 1256 (0s) | HYPERLIQUID:PERP 93 (1s) | BINANCE_FUTURES:PERP 333 (2s)
[0] [PERF] 192 trades/sec | batches: 87 (max size: 219, max time: 1ms) | detect: 4ms | loop lag: 1ms | heap: 67MB | window: 77395 | pending: 4
[0] [FEEDS] COINBASE:SPOT 89 (0s) | BYBIT:PERP 375 (1s) | BYBIT:SPOT 168 (1s) | OKX:PERP 272 (0s) | OKX:SPOT 56 (1s) | BINANCE:SPOT 620 (0s) | HYPERLIQUID:PERP 76 (1s) | BINANCE_FUTURES:PERP 261 (1s)
[0] [PERF] 271 trades/sec | batches: 92 (max size: 202, max time: 1ms) | detect: 4ms | loop lag: 1ms | heap: 51MB | window: 78600 | pending: 0
[0] [FEEDS] COINBASE:SPOT 90 (1s) | BYBIT:PERP 498 (0s) | BYBIT:SPOT 170 (0s) | OKX:PERP 362 (0s) | OKX:SPOT 76 (0s) | BINANCE:SPOT 1137 (0s) | HYPERLIQUID:PERP 86 (2s) | BINANCE_FUTURES:PERP 286 (2s)
[0] [PERF] 255 trades/sec | batches: 95 (max size: 271, max time: 1ms) | detect: 3ms | loop lag: 2ms | heap: 53MB | window: 78149 | pending: 0
[0] [FEEDS] COINBASE:SPOT 109 (0s) | BYBIT:PERP 587 (1s) | BYBIT:SPOT 263 (0s) | OKX:PERP 339 (0s) | OKX:SPOT 82 (0s) | BINANCE:SPOT 776 (1s) | HYPERLIQUID:PERP 107 (2s) | BINANCE_FUTURES:PERP 286 (1s)
[0] [PERF] 202 trades/sec | batches: 92 (max size: 217, max time: 1ms) | detect: 4ms | loop lag: 0ms | heap: 61MB | window: 78669 | pending: 0
[0] [FEEDS] COINBASE:SPOT 231 (0s) | BYBIT:PERP 332 (1s) | BYBIT:SPOT 182 (1s) | OKX:PERP 254 (0s) | OKX:SPOT 59 (0s) | BINANCE:SPOT 542 (0s) | HYPERLIQUID:PERP 98 (2s) | BINANCE_FUTURES:PERP 322 (1s)
[0] [PERF] 317 trades/sec | batches: 90 (max size: 603, max time: 5ms) | detect: 4ms | loop lag: 1ms | heap: 70MB | window: 81837 | pending: 3
[0] [FEEDS] COINBASE:SPOT 237 (0s) | BYBIT:PERP 631 (0s) | BYBIT:SPOT 207 (2s) | OKX:PERP 388 (0s) | OKX:SPOT 76 (1s) | BINANCE:SPOT 1064 (1s) | HYPERLIQUID:PERP 78 (2s) | BINANCE_FUTURES:PERP 487 (2s)
[0] [PERF] 118 trades/sec | batches: 92 (max size: 208, max time: 1ms) | detect: 4ms | loop lag: 0ms | heap: 69MB | window: 80015 | pending: 1
[0] [FEEDS] COINBASE:SPOT 99 (0s) | BYBIT:PERP 160 (0s) | BYBIT:SPOT 107 (1s) | OKX:PERP 251 (0s) | OKX:SPOT 46 (1s) | BINANCE:SPOT 310 (1s) | HYPERLIQUID:PERP 47 (2s) | BINANCE_FUTURES:PERP 158 (2s)
[0] [PERF] 187 trades/sec | batches: 84 (max size: 495, max time: 2ms) | detect: 3ms | loop lag: 0ms | heap: 68MB | window: 80382 | pending: 3
[0] [FEEDS] COINBASE:SPOT 176 (0s) | BYBIT:PERP 347 (0s) | BYBIT:SPOT 163 (0s) | OKX:PERP 293 (0s) | OKX:SPOT 45 (1s) | BINANCE:SPOT 464 (0s) | HYPERLIQUID:PERP 38 (1s) | BINANCE_FUTURES:PERP 341 (2s)
[0] [PERF] 372 trades/sec | batches: 89 (max size: 325, max time: 4ms) | detect: 4ms | loop lag: 1ms | heap: 56MB | window: 81105 | pending: 0
[0] [FEEDS] COINBASE:SPOT 116 (0s) | BYBIT:PERP 631 (0s) | BYBIT:SPOT 261 (0s) | OKX:PERP 624 (0s) | OKX:SPOT 170 (0s) | BINANCE:SPOT 1285 (0s) | HYPERLIQUID:PERP 92 (2s) | BINANCE_FUTURES:PERP 544 (1s)
[0] [PERF] 449 trades/sec | batches: 95 (max size: 351, max time: 5ms) | detect: 4ms | loop lag: 1ms | heap: 53MB | window: 81095 | pending: 1
[0] [FEEDS] COINBASE:SPOT 143 (0s) | BYBIT:PERP 897 (0s) | BYBIT:SPOT 294 (0s) | OKX:PERP 487 (0s) | OKX:SPOT 131 (0s) | BINANCE:SPOT 1451 (0s) | HYPERLIQUID:PERP 195 (2s) | BINANCE_FUTURES:PERP 892 (1s)
[0] [PERF] 277 trades/sec | batches: 96 (max size: 318, max time: 2ms) | detect: 6ms | loop lag: 0ms | heap: 46MB | window: 82368 | pending: 2
[0] [FEEDS] COINBASE:SPOT 141 (1s) | BYBIT:PERP 501 (0s) | BYBIT:SPOT 167 (0s) | OKX:PERP 542 (0s) | OKX:SPOT 119 (0s) | BINANCE:SPOT 741 (0s) | HYPERLIQUID:PERP 92 (1s) | BINANCE_FUTURES:PERP 470 (2s)
[0] [WS] Client disconnected (0 total)
[0] [ENGINE] Saving scenario state before shutdown...
Terminer le programme de commandes (O/N) ? [0] Terminer le programme de commandes (O/N)�? Terminer le programme de commandes (O/N)�? npm run dev:server exited with code 1
[1] npm run dev:client exited with code 1

^C
c:\Users\dglco\Documents\code\cryptotool>