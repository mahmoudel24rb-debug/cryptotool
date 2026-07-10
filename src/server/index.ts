import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal .env loader (no dependency) — used for ANTHROPIC_API_KEY etc.
// Real environment variables always win over .env values.
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// ── Filets de sécurité process (service 24/7 sans surveillance) ──
// Une rejection non gérée (hoquet réseau d'un connecteur, API down...) ne doit
// pas tuer le collecteur : on logge et on continue. Une exception synchrone
// non rattrapée = état potentiellement corrompu : on logge et on laisse
// Railway redémarrer proprement (restartPolicy ALWAYS).
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL-GUARD] Unhandled rejection (service continue):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL-GUARD] Uncaught exception — redémarrage:', err);
  process.exit(1);
});

// Load config
const configPath = path.resolve(__dirname, '../../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = express();
app.set('trust proxy', 1); // derrière le proxy Railway (x-forwarded-proto)
app.use(cors());
app.use(express.json());

// ── Protection par mot de passe (déploiement public) ──
// APP_PASSWORD non défini = accès libre (usage local inchangé).
// Basic Auth sur tout le HTTP (sauf /api/health pour le healthcheck Railway),
// + cookie signé posé au premier accès pour authentifier le WebSocket
// (les navigateurs n'envoient pas l'en-tête Authorization sur l'upgrade WS,
// mais ils envoient les cookies).
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_TOKEN = APP_PASSWORD
  ? crypto.createHash('sha256').update(`mackuant:${APP_PASSWORD}`).digest('hex')
  : '';

function hasValidCookie(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some(c => {
    const [k, v] = c.trim().split('=');
    return k === 'mk_auth' && v === AUTH_TOKEN;
  });
}

if (APP_PASSWORD) {
  console.log('[AUTH] Protection par mot de passe active');
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (hasValidCookie(req.headers.cookie)) return next();

    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      if (pass === APP_PASSWORD) {
        const secure = req.secure ? '; Secure' : '';
        res.setHeader('Set-Cookie', `mk_auth=${AUTH_TOKEN}; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);
        return next();
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="MACKUANT"');
    res.status(401).send('Authentification requise');
  });
} else if (process.env.NODE_ENV === 'production') {
  console.warn('[AUTH] ⚠ APP_PASSWORD non défini — dashboard et API accessibles sans mot de passe');
}

const server = http.createServer(app);

// WebSocket server for frontend clients — même authentification par cookie
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info: { req: http.IncomingMessage }) =>
    !APP_PASSWORD || hasValidCookie(info.req.headers.cookie),
});

const clients = new Set<WebSocket>();

// Track clients that need full initial sync
const needsInitialSync = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  needsInitialSync.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  ws.on('close', () => {
    clients.delete(ws);
    needsInitialSync.delete(ws);
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });
});

/** Send a message to a single client */
export function sendToClient(ws: WebSocket, type: string, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data, timestamp: Date.now() }));
  }
}

/** Get clients that need initial sync and clear the flag */
export function getAndClearInitialSyncClients(): WebSocket[] {
  const list = Array.from(needsInitialSync);
  needsInitialSync.clear();
  return list;
}

// Broadcast to all connected frontend clients
export function broadcast(type: string, data: unknown) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Config endpoint
app.get('/api/config', (_req, res) => {
  res.json(config);
});

app.post('/api/config', (req, res) => {
  Object.assign(config, req.body);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  broadcast('config', config);
  res.json({ ok: true });
});

// Health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Trade history — read scenario outcomes log (one-time fetch, no WS)
app.get('/api/trade-history', (_req, res) => {
  const logPath = path.resolve(__dirname, '../../data/scenario_outcomes.jsonl');
  if (!fs.existsSync(logPath)) return res.json([]);
  try {
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const trades = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    res.json(trades);
  } catch {
    res.json([]);
  }
});

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  // Prefer dist/client/ (built assets), fallback to ../client (compiled tsc layout)
  const fromDist = path.resolve(__dirname, '../../dist/client');
  const fromCompiled = path.join(__dirname, '../client');
  const clientDir = fs.existsSync(path.join(fromDist, 'assets'))
    ? fromDist
    : fromCompiled;
  app.use(express.static(clientDir));
  // Serve charting_library from public/
  const publicDir = path.resolve(__dirname, '../../public');
  if (fs.existsSync(publicDir)) app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

// 4242 en dev — 3001 entrait en collision avec les serveurs Next.js locaux
const PORT = process.env.PORT || 4242;

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  MACKUANT — Trading Intelligence Platform`);
  console.log(`  Server running on port ${PORT}`);
  console.log(`  WebSocket on ws://localhost:${PORT}/ws`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`  Frontend on http://localhost:${PORT}`);
  }
  console.log(`========================================\n`);

  // Import and start the engine after server is ready
  import('./engine').then(({ startEngine }) => {
    startEngine(config, broadcast, sendToClient, getAndClearInitialSyncClients);
  });
});
