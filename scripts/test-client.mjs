// Vérifie côté client que chaque exchange a des bougies et qu'elles avancent
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:4242/ws');
const first = {};
const last = {};
let fullSync = null;

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'candles') {
    fullSync = Object.fromEntries(Object.entries(msg.data).map(([k, v]) => [k, v.length]));
  }
  if (msg.type === 'candle_tick') {
    for (const [key, payload] of Object.entries(msg.data)) {
      const candle = Array.isArray(payload) ? payload[payload.length - 1] : payload;
      if (!(key in first)) first[key] = { time: candle.time, close: candle.close };
      last[key] = { time: candle.time, close: candle.close };
    }
  }
});

setTimeout(() => {
  console.log('— Historique reçu au connect —');
  for (const [k, n] of Object.entries(fullSync ?? {})) console.log(`  ${k.padEnd(22)} ${n} bougies`);
  console.log('— Ticks sur 30s —');
  for (const [k, f] of Object.entries(first)) {
    const l = last[k];
    const advanced = l.time > f.time || l.close !== f.close;
    console.log(`  ${advanced ? 'AVANCE' : 'FIGÉ  '} ${k.padEnd(22)} ${f.close} -> ${l.close}`);
  }
  process.exit(0);
}, 30_000);
