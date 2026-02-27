/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/client/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Source Code Pro"', 'Consolas', 'monospace'],
      },
      colors: {
        bg: {
          primary: '#0a0a0a',
          secondary: '#111111',
          panel: '#0d1117',
        },
        border: {
          dark: '#1a2332',
          cyan: '#0d3b4f',
        },
        signal: {
          absorption: '#f59e0b',
          divergence: '#06b6d4',
          exhaustion: '#d946ef',
          spike: '#f97316',
          velocity: '#a855f7',
          twap: '#3b82f6',
          liquidation: '#ef4444',
        },
        tag: {
          spot: '#22c55e',
          perp: '#8b5cf6',
        },
        exchange: {
          binancePerp: '#3b82f6',
          hyperliquid: '#22c55e',
          bybit: '#a855f7',
          binanceSpot: '#eab308',
          coinbase: '#06b6d4',
        },
      },
    },
  },
  plugins: [],
};
