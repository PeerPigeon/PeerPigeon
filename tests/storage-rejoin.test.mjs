import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRandomPair } from 'unsea';
import { PeerPigeonStorage, PeerPigeonCryptoProtocol, StorageServerLink, StorageServer, STORAGE_SERVER_ROLE } from '../dist/index.js';

// A peer stores in its own space, leaves, and comes back to a room where no
// other peer is online: the storage servers have what it left, it reads it at
// once (not only after the servers are linked), and, with the identity it
// kept, it can still change it.

// A scope of fake nodes, as in storage-servers.test.mjs.
function makeScope() {
  const nodes = new Map();
  const link = (a, b) => {
    if (a.links.has(b.id)) return;
    a.links.add(b.id); b.links.add(a.id);
    queueMicrotask(() => { a.emit('peerConnected', b.id); b.emit('peerConnected', a.id); });
  };
  const node = (id, role = null) => {
    const listeners = new Map();
    const n = {
      id, role, links: new Set(),
      on(event, cb) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(cb); },
      emit(event, data) { for (const cb of listeners.get(event) ?? []) cb(data); },
      async start() {},
      async destroy() { nodes.delete(id); for (const other of n.links) { const o = nodes.get(other); o?.links.delete(id); o?.emit('peerDisconnected', id); } },
      getClientId: () => id,
      getDiscoveredPeers: () => [...nodes.keys()].filter((k) => k !== id),
      getConnectedPeers: () => [...n.links],
      getPeerRole: (peer) => nodes.get(peer)?.role ?? null,
      connectToPeer: (peer) => { const o = nodes.get(peer); if (o) link(n, o); },
      sendDirect(to, data) {
        if (!n.links.has(to)) return null;
        const copy = JSON.parse(JSON.stringify(data));
        queueMicrotask(() => nodes.get(to)?.emit('message', { kind: 'direct', fromPeerId: id, data: copy }));
        return 'ok';
      },
    };
    nodes.set(id, n);
    return n;
  };
  return { node };
}

const hex = (c) => c.repeat(64);
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const options = { sessionId: 'net:rejoin', syncSecret: 's3cret' };

// A peer joining: its storage starts empty here (a new tab, a cleared browser, another device).
async function join(scope, id, keys, extra = {}) {
  const storage = new PeerPigeonStorage({ ...options, userId: keys ? keys.epub : `user-${id}`, peerId: `peer-${id}`, signingKeys: keys, ...extra });
  await storage.init();
  const link = new StorageServerLink(scope.node(hex(id)));
  await storage.attachServers(link);
  return { storage, link };
}
const leave = async (p) => { await p.link.close(); await p.storage.close(); };

test('a peer that comes back to an empty room reads its own records from the servers, right after joining', async () => {
  const scope = makeScope();
  await server(scope, '1');
  const keys = await generateRandomPair();

  const first = await join(scope, 'a', keys);
  await first.link.start();
  await settle();
  assert.equal(first.storage.serverCount(), 1);
  await first.storage.put('user', 'me/profile', { name: 'Dan' });
  await first.storage.put('public', 'notes/1', 'hello');
  await settle();
  await leave(first);

  // Back, alone: the reads are asked for before the servers are linked.
  const again = await join(scope, 'b', keys);
  assert.equal(again.storage.serverCount(), 0, 'not linked yet');
  const reads = Promise.all([again.storage.get('user', 'me/profile'), again.storage.get('public', 'notes/1'), again.storage.list('user')]);
  await again.link.start();
  const [profile, note, mine] = await reads;
  assert.deepEqual(profile?.value, { name: 'Dan' });
  assert.equal(profile?.ownerId, keys.pub);
  assert.equal(note?.value, 'hello');
  assert.deepEqual(mine.map((r) => r.key), ['me/profile']);

  // Same identity: still the owner, and the servers take the change.
  await again.storage.put('user', 'me/profile', { name: 'Dan R' });
  await settle();
  await leave(again);
  const reader = await join(scope, 'c', await generateRandomPair());
  await reader.link.start();
  assert.deepEqual((await reader.storage.get('user', 'me/profile'))?.value, { name: 'Dan R' });
  // Another identity cannot change it.
  await assert.rejects(() => reader.storage.put('user', 'me/profile', { name: 'not Dan' }));
  await leave(reader);
});

test('with no server to be found, a read waits only serverWaitMs, once', async () => {
  const scope = makeScope();
  const p = await join(scope, 'a', null, { serverWaitMs: 300 });
  await p.link.start();
  let t = Date.now();
  assert.equal(await p.storage.get('public', 'nothing'), null);
  const waited = Date.now() - t;
  assert.ok(waited >= 250 && waited < 1500, `waited ${waited} ms`);
  t = Date.now();
  assert.equal(await p.storage.get('public', 'nothing'), null);
  assert.ok(Date.now() - t < 100, 'no second wait');
  await leave(p);
});

test('the identity is kept in the browser between visits, and carried over from a tab that kept it alone', async () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
  const mesh = { on() {}, off() {}, getClientId: () => 'p', getConnectedPeers: () => [] };
  const gossip = { on() {}, off() {}, broadcast() { return 'b'; }, sendDirect() { return null; } };
  const saved = { local: globalThis.localStorage, session: globalThis.sessionStorage };
  const set = (name, v) => Object.defineProperty(globalThis, name, { value: v, configurable: true, writable: true });
  try {
    const local = mem(), session = mem();
    set('localStorage', local); set('sessionStorage', session);
    // An identity a tab kept for itself, from before.
    const old = await generateRandomPair();
    session.setItem('peerpigeon:crypto-keys:v1:net:room', JSON.stringify(old));
    const visit = async (opts = {}) => {
      const c = new PeerPigeonCryptoProtocol(mesh, gossip, { roomId: 'net:room', announceIntervalMs: 0, ...opts });
      await c.init();
      const pair = c.getKeyPair();
      c.destroy();
      return pair;
    };
    const one = await visit();
    assert.equal(one.pub, old.pub, 'carried over from the tab');
    session._m.clear(); // the tab is closed
    const two = await visit();
    assert.equal(two.pub, old.pub, 'the same person on the next visit');
    const tabOnly = await visit({ persistKeyPair: 'session' });
    assert.notEqual(tabOnly.pub, old.pub, "'session' keeps one identity per tab");
  } finally {
    set('localStorage', saved.local); set('sessionStorage', saved.session);
  }
});

test('two tabs of the same person answer each other', async () => {
  // Gossip endpoints wired together, as in storage-signed.test.mjs.
  const peers = new Map();
  const make = (id) => {
    const listeners = new Map();
    const g = {
      on(e, cb) { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(cb); },
      off(e, cb) { listeners.get(e)?.delete(cb); },
      emit(e, d) { for (const cb of listeners.get(e) ?? []) cb(d); },
      broadcast(data) { for (const [pid, o] of peers) if (pid !== id) queueMicrotask(() => o.emit('messageReceived', { message: { data, id: Math.random() }, local: false, fromPeer: id })); return 'm'; },
      sendDirect(to, data) { const o = peers.get(to); if (!o) return null; queueMicrotask(() => o.emit('directMessageReceived', { message: { data, from: id, to } })); return 'd'; },
    };
    peers.set(id, g);
    return g;
  };
  const keys = await generateRandomPair();
  const tab = async (id) => { const s = new PeerPigeonStorage({ ...options, userId: keys.epub, peerId: id, gossip: make(id), signingKeys: keys }); await s.init(); return s; };
  const a = await tab('tab-a');
  await a.put('public', 'shared', 'from a');
  const b = await tab('tab-b');
  const got = await b.retrieve('public', 'shared', { timeoutMs: 1000 });
  assert.equal(got?.value, 'from a');
  await a.close(); await b.close();
});

async function server(scope, id) {
  const s = new StorageServer(scope.node(hex(id), STORAGE_SERVER_ROLE));
  await s.start();
  return s;
}
