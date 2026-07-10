// Vérifie la protection par mot de passe : HTTP + WebSocket
import WebSocket from 'ws';

const BASE = 'http://localhost:3000';
const PASS = 'test1234';
let ok = 0, ko = 0;
function check(label, cond) { cond ? ok++ : ko++; console.log(`${cond ? '✅' : '❌'} ${label}`); }

// 1. /api/health sans auth → 200 (healthcheck Railway)
const h = await fetch(`${BASE}/api/health`);
check('health sans mot de passe → 200', h.status === 200);

// 2. Dashboard sans auth → 401
const noAuth = await fetch(`${BASE}/`);
check('dashboard sans mot de passe → 401', noAuth.status === 401);

// 3. API sans auth → 401
const apiNoAuth = await fetch(`${BASE}/api/config`);
check('API config sans mot de passe → 401', apiNoAuth.status === 401);

// 4. Mauvais mot de passe → 401
const bad = await fetch(`${BASE}/`, { headers: { Authorization: 'Basic ' + Buffer.from('x:mauvais').toString('base64') } });
check('mauvais mot de passe → 401', bad.status === 401);

// 5. Bon mot de passe → 200 + cookie
const good = await fetch(`${BASE}/`, { headers: { Authorization: 'Basic ' + Buffer.from('x:' + PASS).toString('base64') } });
const setCookie = good.headers.get('set-cookie') || '';
check('bon mot de passe → 200', good.status === 200);
check('cookie mk_auth posé', setCookie.includes('mk_auth='));
const cookie = setCookie.split(';')[0];

// 6. WebSocket sans cookie → rejeté
await new Promise(resolve => {
  const ws = new WebSocket(`ws://localhost:3000/ws`);
  ws.on('open', () => { check('WS sans cookie → rejeté', false); ws.close(); resolve(); });
  ws.on('error', () => { check('WS sans cookie → rejeté', true); resolve(); });
});

// 7. WebSocket avec cookie → connecté
await new Promise(resolve => {
  const ws = new WebSocket(`ws://localhost:3000/ws`, { headers: { Cookie: cookie } });
  ws.on('open', () => { check('WS avec cookie → connecté', true); ws.close(); resolve(); });
  ws.on('error', (e) => { check(`WS avec cookie → connecté (${e.message})`, false); resolve(); });
});

console.log(`\n${ok}/7 tests passés${ko ? ' — ÉCHECS: ' + ko : ''}`);
process.exit(ko ? 1 : 0);
