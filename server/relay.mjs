// Tiny WebSocket relay for multiplayer outside claude.ai.
//   node server/relay.mjs            (PORT=8787 by default)
//   open the game with ?relay=ws://localhost:8787   (or build with VITE_RELAY=wss://your.host)
// It only forwards each player's latest state to everyone else; it keeps nothing on disk.
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT) || 8787;
const wss = new WebSocketServer({ port, maxPayload: 4096 });
const last = new Map(); // socket -> { id, s }

const send = (ws, m) => { if (ws.readyState === 1) ws.send(m); };
const all = (from, m) => { for (const c of wss.clients) if (c !== from) send(c, m); };

wss.on('connection', (ws) => {
  const me = { id: randomUUID().slice(0, 12), s: null };
  last.set(ws, me);
  // the newcomer gets everyone who's already here
  for (const [c, o] of last) if (c !== ws && o.s) send(ws, JSON.stringify({ t: 's', id: o.id, s: o.s }));
  let budget = 30;
  const refill = setInterval(() => { budget = 30; }, 1000);
  ws.on('message', (data) => {
    if (--budget < 0) return; // ~10 messages a second is plenty
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || m.t !== 's' || !m.s || typeof m.s !== 'object') return;
    me.s = { ...(me.s || {}), ...m.s }; // keep the look for players who join later
    all(ws, JSON.stringify({ t: 's', id: me.id, s: m.s }));
  });
  ws.on('close', () => {
    clearInterval(refill);
    last.delete(ws);
    all(ws, JSON.stringify({ t: 'l', id: me.id }));
  });
});
console.log(`relay listening on ws://localhost:${port}`);
