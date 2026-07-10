// Sonde de connectivitÃ© â€” vÃ©rifie que chaque flux exchange livre des trades
import WebSocket from 'ws';

const DURATION_MS = 25_000;
const results = {};

function probe(name, url, onOpen, classify) {
  results[name] = { trades: 0, other: 0, errors: [], lastPrice: null };
  const ws = new WebSocket(url);
  ws.on('open', () => onOpen(ws));
  ws.on('message', (raw) => {
    const str = raw.toString();
    if (str === 'pong' || str === 'ping') { results[name].other++; return; }
    try {
      const data = JSON.parse(str);
      const r = classify(data);
      if (r && r.trade) { results[name].trades++; results[name].lastPrice = r.price ?? results[name].lastPrice; }
      else results[name].other++;
      if (data.type === 'error' || data.event === 'error' || (data.success === false)) {
        results[name].errors.push(JSON.stringify(data).slice(0, 160));
      }
    } catch { results[name].other++; }
  });
  ws.on('error', (e) => results[name].errors.push(e.message));
  setTimeout(() => { try { ws.close(); } catch {} }, DURATION_MS);
}

probe('BINANCE spot', 'wss://stream.binance.com:9443/ws/btcusdt@trade', () => {},
  (d) => d.e === 'trade' ? { trade: true, price: +d.p } : null);

probe('BINANCE futures', 'wss://fstream.binance.com/ws/btcusdt@aggTrade', () => {},
  (d) => d.e === 'aggTrade' ? { trade: true, price: +d.p } : null);

probe('BYBIT spot', 'wss://stream.bybit.com/v5/public/spot',
  (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: ['publicTrade.BTCUSDT'] })),
  (d) => d.topic?.startsWith('publicTrade') ? { trade: true, price: +d.data?.[0]?.p } : null);

probe('BYBIT perp', 'wss://stream.bybit.com/v5/public/linear',
  (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: ['publicTrade.BTCUSDT', 'allLiquidation.BTCUSDT'] })),
  (d) => d.topic?.startsWith('publicTrade') ? { trade: true, price: +d.data?.[0]?.p } : null);

probe('COINBASE spot', 'wss://ws-feed.exchange.coinbase.com',
  (ws) => ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['matches', 'heartbeat'] })),
  (d) => (d.type === 'match' || d.type === 'last_match') ? { trade: true, price: +d.price } : null);

probe('OKX', 'wss://ws.okx.com:8443/ws/v5/public',
  (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: [
    { channel: 'trades', instId: 'BTC-USDT' }, { channel: 'trades', instId: 'BTC-USDT-SWAP' }] })),
  (d) => d.arg?.channel === 'trades' && d.data ? { trade: true, price: +d.data[0]?.px } : null);

probe('HYPERLIQUID', 'wss://api.hyperliquid.xyz/ws',
  (ws) => ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' } })),
  (d) => d.channel === 'trades' && d.data ? { trade: true, price: +(Array.isArray(d.data) ? d.data[0]?.px : d.data?.px) } : null);

// REST history probes
async function restProbes() {
  try {
    const end = Math.floor(Date.now() / 1000);
    const r = await fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${end - 300 * 60}&end=${end}`);
    const j = await r.json();
    console.log(`REST Coinbase candles : HTTP ${r.status}, ${Array.isArray(j) ? j.length : 0} bougies`);
  } catch (e) { console.log(`REST Coinbase candles : Ã‰CHEC ${e.message}`); }
  try {
    const r = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1m', startTime: Date.now() - 4500 * 60_000, endTime: Date.now() } }),
    });
    const j = await r.json();
    console.log(`REST Hyperliquid candles : HTTP ${r.status}, ${Array.isArray(j) ? j.length : 0} bougies`);
  } catch (e) { console.log(`REST Hyperliquid candles : Ã‰CHEC ${e.message}`); }
}

setTimeout(async () => {
  console.log(`\nâ€” RÃ©sultats aprÃ¨s ${DURATION_MS / 1000}s â€”`);
  for (const [name, r] of Object.entries(results)) {
    const status = r.trades > 0 ? 'OK ' : 'MORT';
    console.log(`${status} ${name.padEnd(16)} trades=${String(r.trades).padEnd(6)} autres=${String(r.other).padEnd(5)} prix=${r.lastPrice ?? '-'}${r.errors.length ? ' | ERREURS: ' + r.errors.slice(0, 2).join(' ; ') : ''}`);
  }
  await restProbes();
  process.exit(0);
}, DURATION_MS + 2000);

