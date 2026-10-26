#!/usr/bin/env node
// Serve the built vue3 example and open PEERS headless Chromium peers in one
// network and room. Each peer runs in its own browser context (its own storage,
// so its own peer ID).
//
// A control endpoint (CONTROL_PORT) lets check.mjs, running in another
// container on the same Docker network, read each peer's ID and links and
// make peers send test broadcasts and direct messages:
//
//   GET  /state     { container, peers: [{ label, id, links, running, signaling, rx }] }
//   POST /send      { from, kind: 'broadcast' | 'direct', to?, token }
//
// Environment:
//   PEERS             how many browser peers (default 4)
//   NETWORK           network name (default network:test)
//   ROOM              room / session id (default room-vsmtj78m)
//   SIGNALING_SERVER  auto (default: PeerPigeon picks from its federated relays),
//                     or a relay URL such as wss://decentralize.ooo/ws, or a local
//                     relay on the host: ws://host.docker.internal:8788/ws
//   MAX_PEERS         each peer's maxPeers (default 10)
//   PORT              where the example is served inside the container (default 5190)
//   CONTROL_PORT      control endpoint (default 5191)
//   CONTAINER_NAME    shown in reports (default: the hostname)
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'examples/vue3/dist');
const PEERS = Math.max(1, Number(process.env.PEERS || 4));
const NETWORK = process.env.NETWORK || 'network:test';
const ROOM = process.env.ROOM || 'room-vsmtj78m';
const SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'auto';
const MAX_PEERS = Math.max(1, Number(process.env.MAX_PEERS || 10));
const PORT = Number(process.env.PORT || 5190);
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 5191);
const CONTAINER = process.env.CONTAINER_NAME || hostname();

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error(`[browser-peers] ${DIST}/index.html is missing; build the example first (cd examples/vue3 && npx vite build)`);
  process.exit(1);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
const site = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, pathname);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => site.listen(PORT, '127.0.0.1', resolve));

const params = new URLSearchParams({ autostart: '1', networkName: NETWORK, sessionId: ROOM, maxPeers: String(MAX_PEERS) });
if (SIGNALING_SERVER !== 'auto') params.set('signalingServer', SIGNALING_SERVER);
const url = `http://127.0.0.1:${PORT}/?${params}`;
console.log(`[browser-peers] ${CONTAINER}: ${PEERS} peer(s) in network "${NETWORK}", room "${ROOM}", signaling ${SIGNALING_SERVER}`);

const browser = await chromium.launch({
  // Real addresses in ICE candidates, so peers in other containers can reach
  // these without mDNS names that only resolve inside this container.
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--no-sandbox'],
});

// Record test messages a peer receives, whichever gossip instance the app is
// using now (it makes a new one when the mesh restarts).
const hookTestMessages = () => {
  window.__swarm = window.__swarm || { rx: [], hooked: null };
  const take = (data) => {
    const token = data && typeof data === 'object' ? data.__swarmTest : null;
    if (typeof token !== 'string') return;
    window.__swarm.rx.push(token);
    if (window.__swarm.rx.length > 20_000) window.__swarm.rx.splice(0, 5_000);
  };
  const hook = () => {
    const gossip = window.__app?.gossip;
    if (!gossip || window.__swarm.hooked === gossip) return;
    window.__swarm.hooked = gossip;
    gossip.on('messageReceived', ({ message, local }) => { if (!local) take(message?.data); });
    gossip.on('directMessageReceived', ({ message }) => take(message?.data));
  };
  hook();
  setInterval(hook, 500);
};

const peers = [];
for (let index = 0; index < PEERS; index += 1) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const label = String(index + 1);
  page.on('pageerror', (error) => console.log(`[${CONTAINER} peer ${label}] page error: ${error.message}`));
  await page.goto(url);
  await page.evaluate(hookTestMessages);
  peers.push({ label, page });
}

async function peerState({ label, page }) {
  try {
    return await page.evaluate((peerLabel) => {
      const app = window.__app;
      return {
        label: peerLabel,
        id: String(app?.clientId || app?.mesh?.getClientId?.() || ''),
        links: (app?.mesh?.getConnectedPeers?.() || []).map(String),
        running: Boolean(app?.isRunning),
        signaling: Boolean(app?.signalingConnected),
        rx: window.__swarm?.rx ?? [],
      };
    }, label);
  } catch (error) {
    return { label, id: '', links: [], running: false, signaling: false, rx: [], error: error.message.split('\n')[0] };
  }
}

async function send({ from, kind, to, token }) {
  for (const peer of peers) {
    const state = await peerState(peer);
    if (state.id !== from) continue;
    return peer.page.evaluate(({ kind: k, to: target, token: t, from: sender }) => {
      const gossip = window.__app?.gossip;
      if (!gossip) return { ok: false, error: 'no gossip yet' };
      const data = { __swarmTest: t };
      const id = k === 'direct'
        ? gossip.sendDirect(target, data)
        : gossip.broadcast(data, { sender, timestamp: Date.now() });
      return { ok: Boolean(id), id };
    }, { kind, to, token, from });
  }
  return { ok: false, error: `no peer ${from} in ${CONTAINER}` };
}

const control = createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (req.method === 'GET' && pathname === '/state') {
      return reply(200, { container: CONTAINER, peers: await Promise.all(peers.map(peerState)) });
    }
    if (req.method === 'POST' && pathname === '/send') {
      let body = '';
      for await (const chunk of req) body += chunk;
      return reply(200, await send(JSON.parse(body || '{}')));
    }
    return reply(404, { ok: false, error: 'GET /state or POST /send' });
  } catch (error) {
    return reply(500, { ok: false, error: String(error?.message || error) });
  }
});
await new Promise((resolve) => control.listen(CONTROL_PORT, '0.0.0.0', resolve));

// One line a minute for docker logs; check.mjs is the readable report.
const summary = async () => {
  const states = await Promise.all(peers.map(peerState));
  console.log(`[browser-peers] ${new Date().toISOString()} ${CONTAINER}: ${states.map((s) => `${s.label}=${s.links.length}`).join(' ')} links`);
};
await summary();
const timer = setInterval(summary, 60_000);

const stop = async () => {
  clearInterval(timer);
  await browser.close().catch(() => {});
  site.close();
  control.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
