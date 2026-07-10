/**
 * Télécharge l'historique de bougies 1m Binance Futures (BTCUSDT) pour le backtest.
 *
 * Les klines Binance incluent le volume acheteur taker → on reconstruit le
 * delta acheteur/vendeur par minute (fidèle, pas estimé).
 *
 * Usage : node --use-system-ca --import tsx scripts/fetch-history.ts [--months 6]
 * Sortie : data/backtest/BTCUSDT-1m.jsonl
 */

import { mkdirSync, existsSync, writeFileSync, appendFileSync } from 'fs';

export interface HistCandle {
  time: number;        // secondes (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;      // USD (quote volume)
  buyVolume: number;   // USD taker buy
  sellVolume: number;  // USD taker sell
  delta: number;
  trades: number;
}

const monthsArg = process.argv.indexOf('--months');
const MONTHS = monthsArg !== -1 ? Number(process.argv[monthsArg + 1]) : 6;

const OUT_DIR = './data/backtest';
const OUT_FILE = `${OUT_DIR}/BTCUSDT-1m.jsonl`;

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, ''); // reset

  const endMs = Date.now();
  const startMs = endMs - MONTHS * 30 * 24 * 60 * 60 * 1000;
  let cursor = startMs;
  let total = 0;
  let lastLogged = 0;

  console.log(`Téléchargement de ${MONTHS} mois de bougies 1m BTCUSDT (Binance Futures)...`);

  while (cursor < endMs) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&startTime=${cursor}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429 || res.status === 418) {
        console.warn(`Rate limit (${res.status}) — pause 60s...`);
        await new Promise(r => setTimeout(r, 60_000));
        continue;
      }
      throw new Error(`HTTP ${res.status} sur ${url}`);
    }
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) break;

    const lines: string[] = [];
    for (const k of json) {
      const quoteVol = parseFloat(k[7]);
      const takerBuyQuote = parseFloat(k[10]); // taker buy quote asset volume
      const candle: HistCandle = {
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: quoteVol,
        buyVolume: takerBuyQuote,
        sellVolume: quoteVol - takerBuyQuote,
        delta: 2 * takerBuyQuote - quoteVol,
        trades: Number(k[8]),
      };
      lines.push(JSON.stringify(candle));
    }
    appendFileSync(OUT_FILE, lines.join('\n') + '\n');
    total += json.length;

    cursor = json[json.length - 1][0] + 60_000; // openTime dernière bougie + 1m
    if (total - lastLogged >= 15000) {
      lastLogged = total;
      const pct = Math.min(100, ((cursor - startMs) / (endMs - startMs)) * 100);
      console.log(`  ${total} bougies (${pct.toFixed(0)}%)...`);
    }
    await new Promise(r => setTimeout(r, 200)); // respect des limites de poids API
  }

  console.log(`Terminé : ${total} bougies 1m → ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
