import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config
const configPath = path.resolve(__dirname, '../../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// WebSocket server for frontend clients
const wss = new WebSocketServer({ server, path: '/ws' });

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

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  // Support both tsx (src/server/) and compiled (dist/server/) paths
  const distClient = path.join(__dirname, '../client');
  const clientDir = fs.existsSync(path.join(distClient, 'index.html'))
    ? distClient
    : path.resolve(__dirname, '../../dist/client');
  app.use(express.static(clientDir));
  // Serve charting_library from public/
  const publicDir = path.resolve(__dirname, '../../public');
  if (fs.existsSync(publicDir)) app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;

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
