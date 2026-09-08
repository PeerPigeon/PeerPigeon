#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PSP_VERSION = '1.0';
const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 120_000;
const MAX_MESSAGE_SIZE = 64 * 1024;
const MAX_BATCH = 50;

const DISCOVERY_TYPES = new Set(['announce', 'withdraw', 'discover', 'peer_list', 'redirect']);
const NEGOTIATION_TYPES = new Set(['connect_request', 'connect_accept', 'connect_reject', 'offer', 'answer', 'ice_candidate', 'ice_end', 'renegotiate']);
const CONTROL_TYPES = new Set(['ping', 'pong', 'bye', 'error', 'ack']);
const EXTENSION_TYPES = new Set(['ext']);
const MESSAGE_TYPES = new Set([...DISCOVERY_TYPES, ...NEGOTIATION_TYPES, ...CONTROL_TYPES, ...EXTENSION_TYPES]);

const RELAY_TYPES = new Set([
  'connect_request', 'connect_accept', 'connect_reject',
  'offer', 'answer', 'ice_candidate', 'ice_end', 'renegotiate',
  'bye', 'error', 'ack', 'ext', 'peer_list', 'redirect'
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8788);
const TLS_PORT = Number(process.env.TLS_PORT || 8789);
const TLS_CERT_DIR = process.env.PEERPIGEON_TLS_DIR || path.join(REPO_ROOT, '.peerpigeon-dev-tls');
const TLS_CERT_PATH = process.env.PEERPIGEON_TLS_CERT || path.join(TLS_CERT_DIR, 'peerpigeon-dev.cert.pem');
const TLS_KEY_PATH = process.env.PEERPIGEON_TLS_KEY || path.join(TLS_CERT_DIR, 'peerpigeon-dev.key.pem');

const livePeers = new Map(); // network:peerId -> { socket, peerId, network, lastSeen }
const networkSubscribers = new Map(); // network -> Set<WebSocket>
const announcements = new Map(); // network:peerId -> { sessionId, expiresAtMs, updatedAtMs }
const relayQueue = new Map(); // network:toPeerId -> [{ id, message, expiresAtMs, createdAtMs }]

let relayMessageId = 1;

function makePeerKey(network, peerId) {
  return `${network}:${peerId}`;
}

function normalizeTtl(ttlMs) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TTL_MS;
  }
  return Math.min(value, MAX_TTL_MS);
}

function getLanIPv4Addresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const item of list || []) {
      if (item && item.family === 'IPv4' && !item.internal) {
        addresses.push({ interface: name, ip: item.address });
      }
    }
  }
  return addresses;
}

function processIsRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getGitPigeonState() {
  const home = process.env.HOME || os.homedir();
  const stateDir = path.join(home, '.config', 'gitpigeon');
  const indexPath = path.join(stateDir, 'index.json');
  const servicePath = path.join(stateDir, 'service.json');
  const logPath = path.join(stateDir, 'service.log');

  let service = null;
  let index = null;
  let recentLogs = [];
  try {
    if (fs.existsSync(servicePath)) {
      service = JSON.parse(fs.readFileSync(servicePath, 'utf8'));
    }
  } catch {}

  try {
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    }
  } catch {}

  try {
    if (fs.existsSync(logPath)) {
      const rawLog = fs.readFileSync(logPath, 'utf8');
      recentLogs = rawLog.trim().split('\n').slice(-50).map((line, idx) => ({ id: idx + 1, text: line }));
    }
  } catch {}

  let pairingCode = '';
  try {
    const doctor = execSync('git pigeon doctor', { timeout: 2000, encoding: 'utf8' });
    const match = doctor.match(/Pairing code:\s*(\d+)/i);
    if (match) pairingCode = match[1];
  } catch {}

  const activeSet = new Set(service?.activeRepositories || []);
  const repositories = [];
  const primaryLanIp = getLanIPv4Addresses()[0]?.ip || '127.0.0.1';
  const signalUrl = `ws://${primaryLanIp}:${PORT}/ws`;

  for (const entry of index?.entries || []) {
    let branch = 'main';
    let lastCommit = '';
    let commitDate = '';
    let author = '';
    let dirtyCount = 0;
    try {
      branch = execSync(`git -C "${entry.repository}" rev-parse --abbrev-ref HEAD`, { timeout: 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      lastCommit = execSync(`git -C "${entry.repository}" log -1 --pretty=format:"%h - %s"`, { timeout: 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      commitDate = execSync(`git -C "${entry.repository}" log -1 --pretty=format:"%cr"`, { timeout: 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      author = execSync(`git -C "${entry.repository}" log -1 --pretty=format:"%an"`, { timeout: 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const dirtyOutput = execSync(`git -C "${entry.repository}" status --porcelain -uno`, { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      dirtyCount = dirtyOutput ? dirtyOutput.split('\n').filter(Boolean).length : 0;
    } catch {}

    const repoName = entry.name || path.basename(entry.repository);
    const inviteUrl = `gitpigeon://sync/${entry.repositoryId}?signal=${encodeURIComponent(signalUrl)}&n=${encodeURIComponent(repoName)}#${entry.secret}`;
    const cloneCmd = `git pigeon init "${inviteUrl}" ${repoName}`;

    repositories.push({
      name: repoName,
      path: entry.repository,
      repositoryId: entry.repositoryId,
      secret: entry.secret,
      active: activeSet.has(entry.repository),
      branch,
      lastCommit,
      commitDate,
      author,
      dirtyCount,
      inviteUrl,
      cloneCmd,
    });
  }

  const watcherRunning = Boolean(service?.pid && processIsRunning(service.pid));

  const peerList = Array.from(livePeers.values()).map(p => ({
    peerId: p.peerId,
    network: p.network,
    lastSeenAgoSec: Math.max(0, Math.floor((Date.now() - p.lastSeen) / 1000)),
  }));

  return {
    service: {
      running: watcherRunning,
      pid: service?.pid || null,
      startedAt: service?.startedAt || null,
      heartbeatAt: service?.heartbeatAt || null,
      activeCount: activeSet.size,
      buildVersion: service?.buildVersion || '0.13.103',
      mesh: service?.mesh || null,
    },
    indexId: index?.indexId || null,
    pairingCode,
    recentLogs,
    livePeers: peerList,
    repositories,
  };
}

function readBodyJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}


function json(res, body, status = 200) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function validEnvelope(msg) {
  return (
    typeof msg === 'object' && msg !== null &&
    msg.psp_version === PSP_VERSION &&
    typeof msg.type === 'string' && MESSAGE_TYPES.has(msg.type) &&
    typeof msg.from === 'string' && msg.from.trim() &&
    typeof msg.network === 'string' && msg.network.trim() &&
    typeof msg.message_id === 'string' &&
    typeof msg.timestamp === 'number'
  );
}

function cleanExpired() {
  const now = Date.now();

  for (const [key, row] of announcements.entries()) {
    if (row.expiresAtMs <= now) {
      announcements.delete(key);
      livePeers.delete(key);
    }
  }

  for (const [queueKey, entries] of relayQueue.entries()) {
    const remaining = entries.filter((item) => item.expiresAtMs > now);
    if (remaining.length === 0) {
      relayQueue.delete(queueKey);
    } else {
      relayQueue.set(queueKey, remaining);
    }
  }
}

function listPeers(network, requesterPeerId = null) {
  const now = Date.now();
  const out = [];
  for (const [key, row] of announcements.entries()) {
    const [rowNetwork, rowPeerId] = key.split(':');
    if (rowNetwork !== network || row.expiresAtMs <= now) {
      continue;
    }
    if (requesterPeerId && rowPeerId === requesterPeerId) {
      continue;
    }
    out.push({
      peer_id: rowPeerId,
      session_id: row.sessionId,
      timestamp: row.updatedAtMs
    });
    if (out.length >= MAX_BATCH) {
      break;
    }
  }
  out.sort((a, b) => a.peer_id.localeCompare(b.peer_id));
  return out;
}

function sendSafe(socket, payloadObj) {
  try {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payloadObj));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function sendPeerList(network) {
  const sockets = networkSubscribers.get(network);
  if (!sockets || sockets.size === 0) {
    return;
  }
  const peers = listPeers(network);
  const message = {
    psp_version: PSP_VERSION,
    type: 'peer_list',
    network,
    from: 'bootstrap-relay',
    to: null,
    message_id: crypto.randomUUID(),
    timestamp: Date.now(),
    ttl_ms: DEFAULT_TTL_MS,
    body: { peers }
  };

  for (const socket of sockets) {
    if (socket.readyState !== socket.OPEN) {
      sockets.delete(socket);
      continue;
    }
    sendSafe(socket, message);
  }
}

function queueRelayMessage(message) {
  const key = makePeerKey(message.network, message.to);
  const now = Date.now();
  const ttl = normalizeTtl(message.ttl_ms);
  const list = relayQueue.get(key) || [];
  list.push({
    id: relayMessageId++,
    message,
    createdAtMs: now,
    expiresAtMs: now + ttl
  });
  relayQueue.set(key, list);
}

function deliverQueued(network, peerId, socket) {
  const key = makePeerKey(network, peerId);
  const queue = relayQueue.get(key) || [];
  if (queue.length === 0) {
    return 0;
  }

  const now = Date.now();
  const fresh = [];
  let delivered = 0;
  for (const item of queue) {
    if (item.expiresAtMs <= now) {
      continue;
    }
    if (delivered < MAX_BATCH && sendSafe(socket, item.message)) {
      delivered += 1;
    } else {
      fresh.push(item);
    }
  }

  if (fresh.length === 0) {
    relayQueue.delete(key);
  } else {
    relayQueue.set(key, fresh);
  }

  return delivered;
}

function upsertAnnouncement(message) {
  const key = makePeerKey(message.network, message.from);
  const now = Date.now();
  const ttl = normalizeTtl(message.ttl_ms);
  announcements.set(key, {
    sessionId: message.session_id || null,
    expiresAtMs: now + ttl,
    updatedAtMs: now
  });
}

function cleanupSocketState(socket) {
  const state = socket.__peerState;
  if (!state?.network || !state.peerId) {
    return;
  }

  const { network, peerId } = state;
  const key = makePeerKey(network, peerId);
  announcements.delete(key);
  livePeers.delete(key);

  const sockets = networkSubscribers.get(network);
  if (sockets) {
    sockets.delete(socket);
    if (sockets.size === 0) {
      networkSubscribers.delete(network);
    }
  }

  socket.__peerState = null;
  sendPeerList(network);
}

function subscribeSocket(socket, network) {
  const previous = socket.__peerState?.network;
  if (previous && previous !== network) {
    const oldSet = networkSubscribers.get(previous);
    if (oldSet) {
      oldSet.delete(socket);
      if (oldSet.size === 0) {
        networkSubscribers.delete(previous);
      }
    }
  }

  if (!networkSubscribers.has(network)) {
    networkSubscribers.set(network, new Set());
  }
  networkSubscribers.get(network).add(socket);
}

function attachSocketHandlers(socket) {
  socket.__peerState = null;

  socket.on('message', (raw) => {
    if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) {
      return;
    }

    if (raw.length > MAX_MESSAGE_SIZE) {
      sendSafe(socket, {
        psp_version: PSP_VERSION,
        type: 'error',
        network: socket.__peerState?.network || 'unknown',
        from: 'relay',
        to: socket.__peerState?.peerId || null,
        message_id: crypto.randomUUID(),
        timestamp: Date.now(),
        ttl_ms: DEFAULT_TTL_MS,
        body: { error: 'Payload too large', max_bytes: MAX_MESSAGE_SIZE }
      });
      return;
    }

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      sendSafe(socket, {
        psp_version: PSP_VERSION,
        type: 'error',
        network: socket.__peerState?.network || 'unknown',
        from: 'relay',
        to: socket.__peerState?.peerId || null,
        message_id: crypto.randomUUID(),
        timestamp: Date.now(),
        ttl_ms: DEFAULT_TTL_MS,
        body: { error: 'Invalid JSON payload' }
      });
      return;
    }

    if (!validEnvelope(message)) {
      sendSafe(socket, {
        psp_version: PSP_VERSION,
        type: 'error',
        network: typeof message?.network === 'string' ? message.network : 'unknown',
        from: 'relay',
        to: typeof message?.from === 'string' ? message.from : null,
        message_id: crypto.randomUUID(),
        timestamp: Date.now(),
        ttl_ms: DEFAULT_TTL_MS,
        body: { error: 'Invalid PSP envelope format or unsupported type' }
      });
      return;
    }

    const { network, from: peerId, type } = message;
    const key = makePeerKey(network, peerId);

    socket.__peerState = { network, peerId, lastSeen: Date.now() };
    livePeers.set(key, { socket, peerId, network, lastSeen: Date.now() });
    subscribeSocket(socket, network);

    if (type === 'announce') {
      const isHeartbeat = announcements.has(key);
      upsertAnnouncement(message);
      deliverQueued(network, peerId, socket);
      if (!isHeartbeat) {
        sendPeerList(network);
      }
      return;
    }

    if (type === 'withdraw' || type === 'bye') {
      announcements.delete(key);
      livePeers.delete(key);
      sendPeerList(network);
      return;
    }

    if (type === 'discover') {
      sendPeerList(network);
      return;
    }

    if (type === 'ping') {
      sendSafe(socket, {
        psp_version: PSP_VERSION,
        type: 'pong',
        network,
        from: 'relay',
        to: peerId,
        message_id: crypto.randomUUID(),
        timestamp: Date.now(),
        ttl_ms: DEFAULT_TTL_MS,
        body: {}
      });
      deliverQueued(network, peerId, socket);
      return;
    }

    if (RELAY_TYPES.has(type) && message.to) {
      const targetKey = makePeerKey(network, message.to);
      const live = livePeers.get(targetKey);
      if (live && live.socket.readyState === live.socket.OPEN && sendSafe(live.socket, message)) {
        return;
      }
      queueRelayMessage(message);
    }
  });

  socket.on('close', () => cleanupSocketState(socket));
  socket.on('error', () => cleanupSocketState(socket));
}

function escapeHtmlServer(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function handleHttpRequest(req, res) {
  cleanExpired();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (reqUrl.pathname === '/health') {
    json(res, {
      ok: true,
      version: PSP_VERSION,
      relay: 'freertc-private-standalone',
      uptimeSeconds: Math.floor(process.uptime()),
      peers: livePeers.size,
      networks: networkSubscribers.size,
      activeAnnouncements: announcements.size,
      queuedRelayMessages: Array.from(relayQueue.values()).reduce((sum, list) => sum + list.length, 0)
    }, 200);
    return;
  }

  if (reqUrl.pathname === '/api/v1/relays') {
    const lanAddrs = getLanIPv4Addresses();
    const primaryLanIp = lanAddrs[0]?.ip || '127.0.0.1';
    json(res, {
      ok: true,
      relays: [
        { url: `ws://${primaryLanIp}:${PORT}/ws` },
        { url: `ws://127.0.0.1:${PORT}/ws` }
      ]
    }, 200);
    return;
  }

  if (reqUrl.pathname === '/api/v1/dashboard') {
    const gitpigeon = getGitPigeonState();
    const lanAddrs = getLanIPv4Addresses();
    const primaryLanIp = lanAddrs[0]?.ip || '127.0.0.1';
    json(res, {
      ok: true,
      timestamp: Date.now(),
      relay: {
        version: PSP_VERSION,
        uptimeSeconds: Math.floor(process.uptime()),
        peers: livePeers.size,
        networks: networkSubscribers.size,
        activeAnnouncements: announcements.size,
        queuedRelayMessages: Array.from(relayQueue.values()).reduce((sum, list) => sum + list.length, 0),
        endpoints: {
          localWs: `ws://127.0.0.1:${PORT}/ws`,
          lanWs: `ws://${primaryLanIp}:${PORT}/ws`,
          localTlsWs: httpsServer ? `wss://127.0.0.1:${TLS_PORT}/ws` : null,
          lanTlsWs: httpsServer ? `wss://${primaryLanIp}:${TLS_PORT}/ws` : null,
        }
      },
      gitpigeon,
      lanIp: primaryLanIp,
      lanAddresses: lanAddrs
    }, 200);
    return;
  }

  if (req.method === 'POST') {
    if (reqUrl.pathname === '/api/v1/action/watch') {
      readBodyJson(req).then(body => {
        const targetPath = body.path?.trim();
        if (!targetPath) return json(res, { ok: false, error: 'Directory path is required' }, 400);
        if (!fs.existsSync(targetPath)) return json(res, { ok: false, error: `Path does not exist: ${targetPath}` }, 400);
        try {
          const out = execSync(`git -C "${targetPath}" pigeon watch`, { timeout: 15000, encoding: 'utf8' }).trim();
          json(res, { ok: true, message: out || `Now watching ${targetPath}` });
        } catch (err) {
          json(res, { ok: false, error: err.stderr || err.message }, 500);
        }
      }).catch(err => json(res, { ok: false, error: err.message }, 400));
      return;
    }

    if (reqUrl.pathname === '/api/v1/action/unwatch') {
      readBodyJson(req).then(body => {
        const name = body.name?.trim();
        const repoId = body.repositoryId?.trim();
        if (!name && !repoId) return json(res, { ok: false, error: 'Repository name or ID is required' }, 400);
        try {
          const cmd = repoId ? `git pigeon unwatch --id "${repoId}"` : `git pigeon unwatch "${name}"`;
          const out = execSync(cmd, { timeout: 15000, encoding: 'utf8' }).trim();
          json(res, { ok: true, message: out || 'Unwatched repository' });
        } catch (err) {
          json(res, { ok: false, error: err.stderr || err.message }, 500);
        }
      }).catch(err => json(res, { ok: false, error: err.message }, 400));
      return;
    }

    if (reqUrl.pathname === '/api/v1/action/restart-watcher') {
      try {
        try { execSync('git pigeon stop', { timeout: 5000, stdio: 'ignore' }); } catch {}
        execSync('git pigeon start', { timeout: 5000, stdio: 'ignore' });
        json(res, { ok: true, message: 'GitPigeon watcher daemon restarted successfully' });
      } catch (err) {
        json(res, { ok: false, error: err.message }, 500);
      }
      return;
    }

    if (reqUrl.pathname === '/api/v1/action/sync') {
      readBodyJson(req).then(body => {
        const repoPath = body.path?.trim() || '/home/team/Programming';
        try {
          const out = execSync(`git -C "${repoPath}" pigeon sync`, { timeout: 10000, encoding: 'utf8' }).trim();
          json(res, { ok: true, message: out || 'Mesh sync triggered' });
        } catch (err) {
          json(res, { ok: false, error: err.stderr || err.message }, 500);
        }
      }).catch(err => json(res, { ok: false, error: err.message }, 400));
      return;
    }
  }

  if (reqUrl.pathname === '/ws') {
    json(res, { ok: false, error: 'Expected WebSocket upgrade on /ws' }, 426);
    return;
  }

  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    const lanAddrs = getLanIPv4Addresses();
    const primaryLanIp = lanAddrs[0]?.ip || '127.0.0.1';
    const state = getGitPigeonState();
    const uptimeSec = Math.floor(process.uptime());

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GitPigeon · Private LAN Codebase Mesh</title>
  <style>
    :root {
      --bg: #070a12;
      --panel: #0d1322;
      --panel-elevated: #131b2e;
      --border: rgba(255, 255, 255, 0.08);
      --border-focus: #38bdf8;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --primary: #38bdf8;
      --primary-rgb: 56, 189, 248;
      --accent: #818cf8;
      --success: #10b981;
      --success-rgb: 16, 185, 129;
      --warning: #f59e0b;
      --danger: #f43f5e;
      --code-bg: #05070d;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Top Navigation Bar */
    .navbar {
      background: rgba(13, 19, 34, 0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
      padding: 0.85rem 1.75rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .brand-group {
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }
    .brand-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #0284c7, #6366f1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      box-shadow: 0 0 16px rgba(56, 189, 248, 0.3);
    }
    .brand-text h1 {
      font-size: 1.2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .brand-badge {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .brand-text .subtitle {
      font-size: 0.75rem;
      color: var(--text-dim);
    }

    .nav-status {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: var(--panel-elevated);
      border: 1px solid var(--border);
      color: var(--text-muted);
    }
    .status-pill .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .dot-success { background: #10b981; box-shadow: 0 0 8px #10b981; }
    .dot-warning { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
    .dot-info { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.45rem 0.9rem;
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      background: var(--panel-elevated);
      color: var(--text);
      text-decoration: none;
    }
    .btn:hover {
      background: #1e293b;
      border-color: rgba(255, 255, 255, 0.15);
    }
    .btn-primary {
      background: linear-gradient(135deg, #0284c7, #2563eb);
      color: #fff;
      box-shadow: 0 2px 10px rgba(2, 132, 199, 0.3);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #0369a1, #1d4ed8);
    }
    .btn-sm {
      padding: 0.3rem 0.65rem;
      font-size: 0.75rem;
    }

    /* Main Container */
    .container {
      max-width: 1180px;
      width: 100%;
      margin: 0 auto;
      padding: 1.75rem 1.5rem 4rem;
      flex: 1;
    }

    /* Hero KPI Cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .kpi-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--primary), var(--accent));
      opacity: 0.8;
    }
    .kpi-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.5rem;
    }
    .kpi-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
    }
    .kpi-value {
      font-size: 1.85rem;
      font-weight: 800;
      color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      line-height: 1.2;
    }
    .kpi-footer {
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-top: 0.4rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    /* Tabs Navigation */
    .tabs-bar {
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.75rem;
      overflow-x: auto;
      padding-bottom: 0.1rem;
    }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 0.7rem 1.1rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .tab-btn:hover {
      color: #fff;
    }
    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    .tab-badge {
      background: var(--panel-elevated);
      color: var(--text-dim);
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.7rem;
    }
    .tab-btn.active .tab-badge {
      background: rgba(56, 189, 248, 0.15);
      color: var(--primary);
    }

    /* Tab Content Panels */
    .tab-pane {
      display: none;
    }
    .tab-pane.active {
      display: block;
    }

    /* Toolbar for Repositories */
    .repo-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }
    .search-box {
      position: relative;
      flex: 1;
      max-width: 400px;
    }
    .search-box input {
      width: 100%;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.55rem 0.85rem 0.55rem 2.2rem;
      color: var(--text);
      font-size: 0.85rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .search-box input:focus {
      border-color: var(--border-focus);
    }
    .search-box svg {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      width: 15px;
      height: 15px;
    }

    /* Repository Cards */
    .repo-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 1.5rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      transition: border-color 0.2s, transform 0.15s;
    }
    .repo-card:hover {
      border-color: rgba(255, 255, 255, 0.15);
    }
    .repo-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .repo-title-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .repo-name {
      font-size: 1.3rem;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.01em;
    }
    .repo-path {
      font-size: 0.8rem;
      color: var(--text-dim);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      margin-bottom: 1rem;
      background: var(--code-bg);
      padding: 0.3rem 0.6rem;
      border-radius: 6px;
      display: inline-block;
    }
    .repo-actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    /* Git Meta Bar */
    .git-strip {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: var(--panel-elevated);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.65rem 1rem;
      font-size: 0.82rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }
    .git-branch {
      color: #a78bfa;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .git-commit {
      color: #e2e8f0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 420px;
    }
    .git-time {
      color: var(--text-dim);
      margin-left: auto;
    }

    /* Code Snippet Box */
    .snippet-section {
      margin-top: 1rem;
    }
    .snippet-label {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 0.35rem;
    }
    .snippet-box {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.6rem 0.85rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.82rem;
      color: #7dd3fc;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.75rem;
    }
    .snippet-box code {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Topology View */
    .topology-container {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 1.5rem;
      margin-bottom: 2rem;
      text-align: center;
    }
    .topology-svg {
      width: 100%;
      max-height: 280px;
    }
    .mesh-node {
      cursor: pointer;
      transition: all 0.2s;
    }
    .mesh-node:hover {
      filter: brightness(1.25);
    }

    /* Peer Table */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
      font-size: 0.85rem;
    }
    .data-table th {
      background: var(--panel-elevated);
      color: var(--text-dim);
      text-transform: uppercase;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    .data-table td {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
    }
    .data-table tr:last-child td {
      border-bottom: none;
    }
    .data-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
      color: #fff;
    }

    /* Terminal Console */
    .terminal-window {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    .terminal-header {
      background: #0f172a;
      border-bottom: 1px solid var(--border);
      padding: 0.6rem 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .traffic-lights {
      display: flex;
      gap: 6px;
    }
    .traffic-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
    }
    .tl-red { background: #ef4444; }
    .tl-yellow { background: #f59e0b; }
    .tl-green { background: #10b981; }
    .terminal-title {
      font-size: 0.75rem;
      color: var(--text-dim);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .terminal-body {
      padding: 1rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.82rem;
      line-height: 1.6;
      max-height: 480px;
      overflow-y: auto;
      color: #cbd5e1;
    }
    .log-line {
      margin-bottom: 0.25rem;
      word-break: break-all;
    }
    .log-info { color: #38bdf8; }
    .log-err { color: #f43f5e; }
    .log-warn { color: #f59e0b; }
    .log-ok { color: #10b981; }

    /* Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 200;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal-box {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      max-width: 520px;
      width: 100%;
      padding: 1.75rem;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    }
    .modal-title {
      font-size: 1.2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      color: #fff;
    }
    .modal-desc {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 1.25rem;
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    .form-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 0.4rem;
    }
    .form-input {
      width: 100%;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.65rem 0.85rem;
      color: #fff;
      font-size: 0.9rem;
      outline: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .form-input:focus {
      border-color: var(--border-focus);
    }
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }

    /* Toast */
    .toast-container {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 300;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      padding: 0.75rem 1.25rem;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      gap: 0.6rem;
      animation: slideIn 0.2s ease forwards;
    }
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <!-- Navbar -->
  <nav class="navbar">
    <div class="brand-group">
      <div class="brand-icon">🕊️</div>
      <div class="brand-text">
        <h1>GitPigeon <span class="brand-badge">Private LAN Mesh</span></h1>
        <div class="subtitle">Peer-to-Peer Codebase Sync &amp; Signaling Relay</div>
      </div>
    </div>

    <div class="nav-status">
      <div class="status-pill" id="relayPill">
        <span class="dot dot-success"></span>
        <span>Relay: Online (${PORT})</span>
      </div>
      <div class="status-pill" id="watcherPill">
        <span class="dot ${state.service.running ? 'dot-success' : 'dot-warning'}"></span>
        <span>Watcher: ${state.service.running ? 'PID ' + state.service.pid : 'Stopped'}</span>
      </div>
      <div class="status-pill">
        <span class="dot dot-info"></span>
        <span>LAN: ${primaryLanIp}</span>
      </div>
    </div>

    <div class="nav-actions">
      <button class="btn btn-primary" onclick="openWatchModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>Watch Repo</span>
      </button>
      <button class="btn" onclick="triggerRestartWatcher()" title="Restart background watcher daemon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        <span>Restart</span>
      </button>
    </div>
  </nav>

  <!-- Container -->
  <div class="container">
    <!-- Top KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Live Peers</span>
          <span class="status-pill"><span class="dot dot-info"></span> WebRTC</span>
        </div>
        <div class="kpi-value" id="kpiPeers">${livePeers.size}</div>
        <div class="kpi-footer">
          <span>Active networks:</span> <strong id="kpiNetworks">${networkSubscribers.size}</strong>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Watched Repos</span>
          <span class="status-pill"><span class="dot dot-success"></span> P2P Sync</span>
        </div>
        <div class="kpi-value" id="kpiRepos">${state.repositories.length}</div>
        <div class="kpi-footer">
          <span id="kpiWatcherStatus">${state.service.running ? 'Watcher active &amp; healthy' : 'Watcher stopped'}</span>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Relay Uptime</span>
          <span class="status-pill">PSP v${PSP_VERSION}</span>
        </div>
        <div class="kpi-value" id="kpiUptime">${uptimeSec}s</div>
        <div class="kpi-footer">
          <span>Queued packets:</span> <strong id="kpiQueued">0</strong>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Pairing Code</span>
          <span class="status-pill">Offline Secret</span>
        </div>
        <div class="kpi-value" id="kpiPairingCode">${state.pairingCode || '—'}</div>
        <div class="kpi-footer">
          <span>Run: <code>git pigeon pair ${state.pairingCode || ''}</code></span>
        </div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-bar">
      <button class="tab-btn active" onclick="switchTab('tab-repos', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span>Watched Repositories</span>
        <span class="tab-badge" id="tabRepoBadge">${state.repositories.length}</span>
      </button>

      <button class="tab-btn" onclick="switchTab('tab-mesh', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M10.5 10.5L6.5 6.5M13.5 10.5l4-4M10.5 13.5l-4 4M13.5 13.5l4 4"/></svg>
        <span>P2P Mesh &amp; Topology</span>
      </button>

      <button class="tab-btn" onclick="switchTab('tab-logs', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        <span>Live Activity Stream</span>
      </button>

      <button class="tab-btn" onclick="switchTab('tab-guide', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <span>LAN Quickstart &amp; CLI</span>
      </button>
    </div>

    <!-- TAB 1: Repositories -->
    <div id="tab-repos" class="tab-pane active">
      <div class="repo-toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="repoSearch" placeholder="Search watched repositories by name or branch..." oninput="filterRepos()" />
        </div>
        <div>
          <button class="btn btn-sm" onclick="triggerManualSync()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>Sync All Repos</span>
          </button>
        </div>
      </div>

      <div id="repoCardsList">
        ${state.repositories.map(repo => `
          <div class="repo-card" data-name="${repo.name.toLowerCase()}" data-branch="${repo.branch.toLowerCase()}">
            <div class="repo-top">
              <div>
                <div class="repo-title-group">
                  <span class="repo-name">${repo.name}</span>
                  <span class="status-pill">
                    <span class="dot ${repo.active ? 'dot-success' : 'dot-warning'}"></span>
                    <span>${repo.active ? 'Syncing Live' : 'Tracked'}</span>
                  </span>
                </div>
                <div class="repo-path">${repo.path}</div>
              </div>
              <div class="repo-actions">
                <button class="btn btn-sm btn-primary" onclick="copyText('${repo.inviteUrl}', 'Sync link copied!')">
                  Copy Invite
                </button>
                <button class="btn btn-sm" onclick="copyText('${repo.cloneCmd}', 'Clone command copied!')">
                  Copy CLI Command
                </button>
                <button class="btn btn-sm" style="color: var(--danger);" onclick="triggerUnwatch('${repo.name}', '${repo.repositoryId}')">
                  Unwatch
                </button>
              </div>
            </div>

            <div class="git-strip">
              <span class="git-branch">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
                ${repo.branch}
              </span>
              <span class="git-commit">${repo.lastCommit || 'Clean git repository initialized'}</span>
              <span class="git-time">${repo.commitDate ? repo.commitDate : ''}</span>
            </div>

            <div class="snippet-section">
              <div class="snippet-label">Sync Invitation URL:</div>
              <div class="snippet-box">
                <code>${repo.inviteUrl}</code>
                <button class="btn btn-sm" onclick="copyText('${repo.inviteUrl}', 'Invite URL copied!')">Copy</button>
              </div>

              <div class="snippet-label">Clone / Join Command:</div>
              <div class="snippet-box">
                <code>${repo.cloneCmd}</code>
                <button class="btn btn-sm" onclick="copyText('${repo.cloneCmd}', 'Init command copied!')">Copy</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- TAB 2: P2P Mesh & Topology -->
    <div id="tab-mesh" class="tab-pane">
      <div class="topology-container">
        <h3 style="margin-bottom: 0.5rem; color: #fff;">Local WebRTC Mesh Topology</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem;">
          Direct peer data channels replicate code changes peer-to-peer with Zero-Knowledge encryption.
        </p>
        
        <svg class="topology-svg" viewBox="0 0 600 240">
          <defs>
            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.8"/>
              <stop offset="100%" stop-color="#818cf8" stop-opacity="0.8"/>
            </linearGradient>
          </defs>

          <!-- Links -->
          <line x1="300" y1="120" x2="150" y2="60" stroke="url(#lineGrad)" stroke-width="2" stroke-dasharray="4 4" />
          <line x1="300" y1="120" x2="450" y2="60" stroke="url(#lineGrad)" stroke-width="2" stroke-dasharray="4 4" />
          <line x1="300" y1="120" x2="300" y2="200" stroke="url(#lineGrad)" stroke-width="2" stroke-dasharray="4 4" />

          <!-- Center Node: Signaling Relay -->
          <g class="mesh-node" transform="translate(300, 120)">
            <circle r="36" fill="#0f172a" stroke="#38bdf8" stroke-width="2.5" />
            <circle r="44" fill="none" stroke="#38bdf8" stroke-width="1" stroke-opacity="0.3" />
            <text text-anchor="middle" y="5" font-size="18">🕊️</text>
            <text text-anchor="middle" y="56" fill="#fff" font-size="12" font-weight="700">Relay Hub</text>
            <text text-anchor="middle" y="70" fill="#94a3b8" font-size="10">${primaryLanIp}:${PORT}</text>
          </g>

          <!-- Node 1: Local Host -->
          <g class="mesh-node" transform="translate(150, 60)">
            <circle r="28" fill="#0f172a" stroke="#10b981" stroke-width="2" />
            <text text-anchor="middle" y="5" font-size="14">💻</text>
            <text text-anchor="middle" y="44" fill="#fff" font-size="11" font-weight="600">Local Watcher</text>
            <text text-anchor="middle" y="56" fill="#94a3b8" font-size="9">PID ${state.service.pid || '—'}</text>
          </g>

          <!-- Node 2: OpenCode / TeamJules -->
          <g class="mesh-node" transform="translate(450, 60)">
            <circle r="28" fill="#0f172a" stroke="#818cf8" stroke-width="2" />
            <text text-anchor="middle" y="5" font-size="14">⚡</text>
            <text text-anchor="middle" y="44" fill="#fff" font-size="11" font-weight="600">OpenCode Instance</text>
            <text text-anchor="middle" y="56" fill="#94a3b8" font-size="9">Redirect Ready</text>
          </g>

          <!-- Node 3: LAN Peers -->
          <g class="mesh-node" transform="translate(300, 200)">
            <circle r="24" fill="#0f172a" stroke="#f59e0b" stroke-width="2" />
            <text text-anchor="middle" y="4" font-size="12">👥</text>
            <text text-anchor="middle" y="38" fill="#fff" font-size="11" font-weight="600">${livePeers.size} Connected Peer(s)</text>
          </g>
        </svg>
      </div>

      <div class="kpi-card" style="margin-bottom: 1.5rem;">
        <h4 style="margin-bottom: 0.5rem; color: #fff;">Quick Pairing Identity</h4>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
          To enroll another computer or phone into this machine's GitPigeon fleet without public internet exposure:
        </p>
        <div class="snippet-box">
          <code>git pigeon pair ${state.pairingCode || '550912'}</code>
          <button class="btn btn-sm" onclick="copyText('git pigeon pair ${state.pairingCode || '550912'}', 'Pair command copied!')">Copy Command</button>
        </div>
      </div>

      <h4 style="margin-bottom: 0.75rem; color: #fff;">Connected Peer Sessions (${livePeers.size})</h4>
      <table class="data-table">
        <thead>
          <tr>
            <th>Peer ID</th>
            <th>Network / Room</th>
            <th>Transport Status</th>
            <th>Last Active</th>
          </tr>
        </thead>
        <tbody id="peerTableBody">
          ${state.livePeers.length === 0 ? `
            <tr>
              <td colspan="4" style="text-align: center; color: var(--text-dim); padding: 2rem;">
                No external peers are currently connected. Watchers dial into this relay as peers appear on the LAN.
              </td>
            </tr>
          ` : state.livePeers.map(p => `
            <tr>
              <td style="font-family: monospace; color: #38bdf8;">${p.peerId}</td>
              <td style="font-family: monospace;">${p.network}</td>
              <td><span class="status-pill"><span class="dot dot-success"></span> Connected</span></td>
              <td>${p.lastSeenAgoSec}s ago</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- TAB 3: Live Activity Stream -->
    <div id="tab-logs" class="tab-pane">
      <div class="terminal-window">
        <div class="terminal-header">
          <div class="traffic-lights">
            <span class="traffic-dot tl-red"></span>
            <span class="traffic-dot tl-yellow"></span>
            <span class="traffic-dot tl-green"></span>
          </div>
          <div class="terminal-title">~/.config/gitpigeon/service.log</div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-sm" id="pauseScrollBtn" onclick="toggleAutoScroll()">Pause Scroll</button>
            <button class="btn btn-sm" onclick="copyTerminalLogs()">Copy Logs</button>
          </div>
        </div>
        <div class="terminal-body" id="terminalBody">
          ${state.recentLogs.map(l => {
            let cls = 'log-info';
            if (l.text.includes('error:')) cls = 'log-err';
            else if (l.text.includes('warning:')) cls = 'log-warn';
            else if (l.text.includes('Published') || l.text.includes('Imported')) cls = 'log-ok';
            return `<div class="log-line ${cls}">${escapeHtmlServer(l.text)}</div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- TAB 4: LAN Quickstart & CLI -->
    <div id="tab-guide" class="tab-pane">
      <div class="kpi-card" style="margin-bottom: 1.5rem;">
        <h3 style="margin-bottom: 0.75rem; color: #fff;">🤝 3-Step Setup for Any Machine on the Local Network</h3>
        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
          <div style="display: flex; gap: 1rem;">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--primary); color: #000; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">1</div>
            <div>
              <div style="font-weight: 700; color: #fff;">Install GitPigeon CLI</div>
              <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.35rem;">On the second computer or teammate laptop:</div>
              <div class="snippet-box"><code>npm install -g git-pigeon</code><button class="btn btn-sm" onclick="copyText('npm install -g git-pigeon')">Copy</button></div>
            </div>
          </div>

          <div style="display: flex; gap: 1rem;">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--primary); color: #000; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">2</div>
            <div>
              <div style="font-weight: 700; color: #fff;">Point Environment to this Private Signaling Server</div>
              <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.35rem;">Add to <code>~/.bashrc</code> or export in the shell:</div>
              <div class="snippet-box"><code>export GIT_PIGEON_SIGNAL="ws://${primaryLanIp}:${PORT}/ws"</code><button class="btn btn-sm" onclick="copyText('export GIT_PIGEON_SIGNAL=\&quot;ws://${primaryLanIp}:${PORT}/ws\&quot;')">Copy</button></div>
            </div>
          </div>

          <div style="display: flex; gap: 1rem;">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--primary); color: #000; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">3</div>
            <div>
              <div style="font-weight: 700; color: #fff;">Clone / Join the Repository Mesh</div>
              <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 0.35rem;">Run the Clone Command from the Repositories tab. GitPigeon will establish an encrypted direct WebRTC data channel and synchronize instantly:</div>
              <div class="snippet-box"><code>git pigeon init "${state.repositories[0]?.inviteUrl || 'gitpigeon://sync/...'}" Programming</code><button class="btn btn-sm" onclick="copyText('git pigeon init \&quot;${state.repositories[0]?.inviteUrl || ''}\&quot; Programming')">Copy</button></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Watch Modal -->
  <div class="modal-backdrop" id="watchModal">
    <div class="modal-box">
      <div class="modal-title">Watch a Local Repository</div>
      <div class="modal-desc">Enter the absolute filesystem path of a Git repository to watch and sync live over the peer mesh.</div>
      <div class="form-group">
        <label class="form-label">Absolute Directory Path:</label>
        <input type="text" class="form-input" id="watchPathInput" placeholder="/home/team/Programming/my-repo" value="/home/team/Programming/" />
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeWatchModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitWatchRepo()">Start Watching</button>
      </div>
    </div>
  </div>

  <!-- Toast Container -->
  <div class="toast-container" id="toastContainer"></div>

  <script>
    let autoScroll = true;

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function showToast(msg) {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = '<span>✓</span> ' + escapeHtml(msg);
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.25s ease';
        setTimeout(() => toast.remove(), 250);
      }, 2500);
    }

    function copyText(text, msg) {
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        showToast(msg || 'Copied to clipboard!');
      }).catch(() => {
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast(msg || 'Copied to clipboard!');
      });
    }

    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const pane = document.getElementById(tabId);
      if (pane) pane.classList.add('active');
      if (btn) btn.classList.add('active');
    }

    function filterRepos() {
      const query = document.getElementById('repoSearch').value.toLowerCase();
      document.querySelectorAll('#repoCardsList .repo-card').forEach(card => {
        const name = card.getAttribute('data-name') || '';
        const branch = card.getAttribute('data-branch') || '';
        const match = name.includes(query) || branch.includes(query);
        card.style.display = match ? 'block' : 'none';
      });
    }

    function openWatchModal() {
      document.getElementById('watchModal').classList.add('open');
      document.getElementById('watchPathInput').focus();
    }

    function closeWatchModal() {
      document.getElementById('watchModal').classList.remove('open');
    }

    async function submitWatchRepo() {
      const path = document.getElementById('watchPathInput').value.trim();
      if (!path) return;
      try {
        const res = await fetch('/api/v1/action/watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        });
        const data = await res.json();
        if (data.ok) {
          showToast(data.message || 'Repository added!');
          closeWatchModal();
          pollDashboard();
        } else {
          alert('Error: ' + (data.error || 'Failed to watch repository'));
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      }
    }

    async function triggerUnwatch(name, repositoryId) {
      if (!confirm('Stop watching and syncing ' + name + '?')) return;
      try {
        const res = await fetch('/api/v1/action/unwatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, repositoryId })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('Unwatched ' + name);
          pollDashboard();
        } else {
          alert('Error: ' + data.error);
        }
      } catch (err) {
        alert('Failed: ' + err.message);
      }
    }

    async function triggerRestartWatcher() {
      showToast('Restarting watcher daemon...');
      try {
        const res = await fetch('/api/v1/action/restart-watcher', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'Restarted!');
        pollDashboard();
      } catch (err) {
        showToast('Restart failed: ' + err.message);
      }
    }

    async function triggerManualSync() {
      showToast('Triggering mesh sync...');
      try {
        const res = await fetch('/api/v1/action/sync', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'Sync completed!');
      } catch (err) {
        showToast('Sync request error: ' + err.message);
      }
    }

    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      document.getElementById('pauseScrollBtn').innerText = autoScroll ? 'Pause Scroll' : 'Resume Scroll';
    }

    function copyTerminalLogs() {
      const logs = Array.from(document.querySelectorAll('#terminalBody .log-line')).map(el => el.innerText).join('\n');
      copyText(logs, 'Terminal logs copied to clipboard!');
    }

    async function pollDashboard() {
      try {
        const res = await fetch('/api/v1/dashboard');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.ok) return;

        document.getElementById('kpiPeers').innerText = data.relay.peers;
        document.getElementById('kpiNetworks').innerText = data.relay.networks;
        document.getElementById('kpiUptime').innerText = data.relay.uptimeSeconds + 's';
        document.getElementById('kpiQueued').innerText = data.relay.queuedRelayMessages;
        document.getElementById('kpiRepos').innerText = data.gitpigeon.repositories.length;
        document.getElementById('tabRepoBadge').innerText = data.gitpigeon.repositories.length;

        if (data.gitpigeon.pairingCode) {
          document.getElementById('kpiPairingCode').innerText = data.gitpigeon.pairingCode;
        }

        const isRunning = data.gitpigeon.service.running;
        document.getElementById('kpiWatcherStatus').innerText = isRunning ? 'Watcher active & healthy' : 'Watcher stopped';
        
        const watcherPill = document.getElementById('watcherPill');
        if (watcherPill) {
          watcherPill.innerHTML = '<span class="dot ' + (isRunning ? 'dot-success' : 'dot-warning') + '"></span><span>Watcher: ' + (isRunning ? 'PID ' + data.gitpigeon.service.pid : 'Stopped') + '</span>';
        }

        // Update Terminal Logs
        if (data.gitpigeon.recentLogs && data.gitpigeon.recentLogs.length > 0) {
          const term = document.getElementById('terminalBody');
          term.innerHTML = data.gitpigeon.recentLogs.map(l => {
            let cls = 'log-info';
            if (l.text.includes('error:')) cls = 'log-err';
            else if (l.text.includes('warning:')) cls = 'log-warn';
            else if (l.text.includes('Published') || l.text.includes('Imported')) cls = 'log-ok';
            return '<div class="log-line ' + cls + '">' + escapeHtml(l.text) + '</div>';
          }).join('');
          if (autoScroll) {
            term.scrollTop = term.scrollHeight;
          }
        }
      } catch (e) {
        console.warn('Dashboard poll error:', e);
      }
    }

    setInterval(pollDashboard, 2500);
  </script>
</body>
</html>`;

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
    return;
  }

  json(res, { ok: false, error: 'Not found' }, 404);
}


// 1. Setup Main HTTP + WS Server
const httpServer = http.createServer(handleHttpRequest);
const wsServer = new WebSocketServer({ noServer: true });
wsServer.on('connection', (socket) => attachSocketHandlers(socket));

httpServer.on('upgrade', (req, socket, head) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (reqUrl.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wsServer.handleUpgrade(req, socket, head, (ws) => {
    wsServer.emit('connection', ws, req);
  });
});

// Periodic maintenance
setInterval(cleanExpired, 5000).unref();

// Start HTTP/WS Listener
httpServer.listen(PORT, HOST, () => {
  const lanAddresses = getLanIPv4Addresses();
  console.log(`[freertc-relay] HTTP/WS signaling server listening on ${HOST}:${PORT}`);
  console.log(`[freertc-relay]   Local endpoint:  ws://127.0.0.1:${PORT}/ws`);
  for (const { interface: iface, ip } of lanAddresses) {
    console.log(`[freertc-relay]   LAN (${iface}):    ws://${ip}:${PORT}/ws`);
    console.log(`[freertc-relay]   Health (${iface}): http://${ip}:${PORT}/health`);
  }
});

// 2. Optional HTTPS + WSS Server if TLS certs are present
let httpsServer = null;
let wssServer = null;
if (fs.existsSync(TLS_CERT_PATH) && fs.existsSync(TLS_KEY_PATH)) {
  try {
    const cert = fs.readFileSync(TLS_CERT_PATH);
    const key = fs.readFileSync(TLS_KEY_PATH);

    httpsServer = https.createServer({ cert, key }, handleHttpRequest);
    wssServer = new WebSocketServer({ noServer: true });
    wssServer.on('connection', (socket) => attachSocketHandlers(socket));

    httpsServer.on('upgrade', (req, socket, head) => {
      const reqUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      if (reqUrl.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      wssServer.handleUpgrade(req, socket, head, (ws) => {
        wssServer.emit('connection', ws, req);
      });
    });

    httpsServer.listen(TLS_PORT, HOST, () => {
      const lanAddresses = getLanIPv4Addresses();
      console.log(`[freertc-relay] HTTPS/WSS signaling server listening on ${HOST}:${TLS_PORT}`);
      console.log(`[freertc-relay]   Local TLS endpoint: wss://127.0.0.1:${TLS_PORT}/ws`);
      for (const { interface: iface, ip } of lanAddresses) {
        console.log(`[freertc-relay]   LAN TLS (${iface}):   wss://${ip}:${TLS_PORT}/ws`);
      }
    });
  } catch (err) {
    console.warn(`[freertc-relay] Failed to start TLS server:`, err.message);
  }
}

// Graceful shutdown
function handleShutdown(signal) {
  console.log(`[freertc-relay] Received ${signal}, closing server...`);
  try {
    for (const peer of livePeers.values()) {
      try { peer.socket.terminate(); } catch {}
    }
    wsServer.close();
    if (wssServer) wssServer.close();
    httpServer.closeAllConnections?.();
    if (httpsServer) httpsServer.closeAllConnections?.();
  } catch {}
  httpServer.close(() => {
    if (httpsServer) {
      httpsServer.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
