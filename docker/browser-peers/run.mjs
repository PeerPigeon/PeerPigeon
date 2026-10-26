#!/usr/bin/env node
// Serve the built vue3 example and open PEERS headless Chromium peers in one
// network and room, then print each peer's connection count until stopped.
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
//   STATUS_EVERY_S    seconds between status lines (default 10)
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
const STATUS_EVERY_MS = Math.max(2, Number(process.env.STATUS_EVERY_S || 10)) * 1000;

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error(`[browser-peers] ${DIST}/index.html is missing; build the example first (cd examples/vue3 && npx vite build)`);
  process.exit(1);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, pathname);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const params = new URLSearchParams({ autostart: '1', networkName: NETWORK, sessionId: ROOM, maxPeers: String(MAX_PEERS) });
if (SIGNALING_SERVER !== 'auto') params.set('signalingServer', SIGNALING_SERVER);
const url = `http://127.0.0.1:${PORT}/?${params}`;
console.log(`[browser-peers] ${PEERS} peer(s) in network "${NETWORK}", room "${ROOM}", signaling ${SIGNALING_SERVER}`);
console.log(`[browser-peers] page: ${url}`);

const browser = await chromium.launch({
  // Real addresses in ICE candidates, so peers in this container reach each
  // other and peers elsewhere without mDNS names that only resolve locally.
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--no-sandbox'],
});

const peers = [];
for (let index = 0; index < PEERS; index += 1) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const label = `peer-${String(index + 1).padStart(String(PEERS).length, '0')}`;
  page.on('pageerror', (error) => console.log(`[${label}] page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[${label}] console error: ${message.text().slice(0, 300)}`);
  });
  await page.goto(url);
  peers.push({ label, page });
}

async function status({ label, page }) {
  try {
    return await page.evaluate((name) => {
      const app = window.__app;
      const connected = document.querySelector('[data-testid="connected-peers"]')?.textContent?.trim() ?? '?';
      const id = String(app?.clientId || app?.mesh?.getClientId?.() || '').slice(0, 12);
      return `${name} ${id || '(no id yet)'} connected ${connected}`;
    }, label);
  } catch (error) {
    return `${label} unavailable: ${error.message.split('\n')[0]}`;
  }
}

const report = async () => {
  const lines = await Promise.all(peers.map(status));
  console.log(`[browser-peers] ${new Date().toISOString()}\n  ${lines.join('\n  ')}`);
};
await report();
const timer = setInterval(report, STATUS_EVERY_MS);

const stop = async () => {
  clearInterval(timer);
  console.log('[browser-peers] closing peers');
  await browser.close().catch(() => {});
  server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
