import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRandomPair } from 'unsea';
import { PeerPigeonStorage, StorageServer, StorageServerLink, STORAGE_SERVER_ROLE } from '../dist/index.js';

// Gossip endpoints wired together, as in storage-digest.test.mjs; `tamper` rewrites what a peer sends.
function net() {
  const peers = new Map();
  const make = (id) => {
    const listeners = new Map();
    const g = {
      id, tamper: null,
      on(e, cb) { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(cb); },
      off(e, cb) { listeners.get(e)?.delete(cb); },
      emit(e, d) { for (const cb of listeners.get(e) ?? []) cb(d); },
      broadcast(data) {
        for (const [pid, other] of peers) if (pid !== id) queueMicrotask(() => other.emit('messageReceived', { message: { data, id: Math.random() }, local: false, fromPeer: id }));
        return 'm';
      },
      sendDirect(to, data) { const o = peers.get(to); if (!o) return null; queueMicrotask(() => o.emit('directMessageReceived', { message: { data, from: id, to } })); return 'd'; },
    };
    peers.set(id, g);
    return g;
  };
  return { make };
}
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const opts = { sessionId: 'signed', syncSecret: 'room-secret' };

async function node(n, id, keys) {
  const s = new PeerPigeonStorage({ ...opts, userId: `user-${id}`, peerId: id, gossip: n.make(id), signingKeys: keys });
  await s.init();
  return s;
}

test('a user record is owned by its signer\'s key, and nobody else can replace it', async () => {
  const n = net();
  const [ka, kb] = [await generateRandomPair(), await generateRandomPair()];
  const a = await node(n, 'a', ka), b = await node(n, 'b', kb);
  b.subscribeKey('user', 'profile/a');
  const rec = await a.put('user', 'profile/a', { name: 'A' });
  assert.equal(rec.ownerId, ka.pub);
  await settle();
  assert.equal((await b.get('user', 'profile/a'))?.value.name, 'A');
  // B writes the same key: refused locally (it is A's)…
  await assert.rejects(() => b.put('user', 'profile/a', { name: 'not A' }));
  // …and A's own update arrives.
  await a.put('user', 'profile/a', { name: 'A2' });
  await settle();
  assert.equal((await b.get('user', 'profile/a'))?.value.name, 'A2');
});

test('an unsigned or forged change is dropped', async () => {
  const n = net();
  const [ka, kb, kc] = [await generateRandomPair(), await generateRandomPair(), await generateRandomPair()];
  const a = await node(n, 'a', ka), b = await node(n, 'b', kb);
  b.subscribeKey('public', 'x');
  // An unsigned node in the same room (an old peer, or one forging).
  const old = await node(n, 'old', null);
  await old.put('public', 'x', 'unsigned');
  await settle();
  assert.equal(await b.get('public', 'x'), null, 'unsigned change dropped');
  await a.put('public', 'x', 'signed');
  await settle();
  assert.equal((await b.get('public', 'x'))?.value, 'signed');
  // A's signed record with its value changed afterwards, sent by A itself: dropped.
  const stored = await a.requireDriver().get(a.makePk('public', 'x'));
  const t = Date.now() + 1000;
  await a.broadcastSyncPayload({ __ppType: 'pp-storage-op-v1', opId: 'forged', op: 'upsert', space: 'public', key: 'x', actorId: 'user-a', timestamp: t, record: { ...stored, value: 'tampered', updatedAt: t } });
  await settle();
  assert.equal((await b.get('public', 'x'))?.value, 'signed', 'tampered record dropped');
  // Another key claiming A's signature: dropped too.
  const c = await node(n, 'c', kc);
  void c;
  await a.broadcastSyncPayload({ __ppType: 'pp-storage-op-v1', opId: 'moved', op: 'upsert', space: 'public', key: 'x', actorId: 'user-a', timestamp: t, record: { ...stored, signer: kc.pub, updatedAt: t } });
  await settle();
  assert.equal((await b.get('public', 'x'))?.value, 'signed', 'signature under another key dropped');
});

test('a server takes a user record only from its owner', async () => {
  // Fake scope, as in storage-servers.test.mjs.
  const nodes = new Map();
  const mk = (id, role = null) => {
    const ls = new Map();
    const nd = {
      id, role, links: new Set(),
      on(e, cb) { if (!ls.has(e)) ls.set(e, new Set()); ls.get(e).add(cb); },
      emit(e, d) { for (const cb of ls.get(e) ?? []) cb(d); },
      async start() {}, async destroy() {},
      getClientId: () => id,
      getDiscoveredPeers: () => [...nodes.keys()].filter((k) => k !== id),
      getConnectedPeers: () => [...nd.links],
      getPeerRole: (p) => nodes.get(p)?.role ?? null,
      connectToPeer: (p) => { const o = nodes.get(p); if (o && !nd.links.has(p)) { nd.links.add(p); o.links.add(id); queueMicrotask(() => { nd.emit('peerConnected', p); o.emit('peerConnected', id); }); } },
      sendDirect(to, data) { if (!nd.links.has(to)) return null; const c = JSON.parse(JSON.stringify(data)); queueMicrotask(() => nodes.get(to)?.emit('message', { kind: 'direct', fromPeerId: id, data: c })); return 'ok'; },
    };
    nodes.set(id, nd);
    return nd;
  };
  const server = new StorageServer(mk('1'.repeat(64), STORAGE_SERVER_ROLE));
  await server.start();
  const peer = async (c, keys) => {
    const s = new PeerPigeonStorage({ ...opts, userId: `user-${c}`, peerId: c, signingKeys: keys });
    await s.init();
    const link = new StorageServerLink(mk(c.repeat(64)));
    await s.attachServers(link);
    await link.start();
    return s;
  };
  const [ka, kb] = [await generateRandomPair(), await generateRandomPair()];
  const a = await peer('a', ka), b = await peer('b', kb);
  await settle();
  await a.put('user', 'card', 'from A');
  await settle();
  // B (another member of the room) writes the same key from scratch: the server keeps A's.
  const reader = await peer('c', await generateRandomPair());
  await settle();
  // B has no copy, but asks the servers before writing: refused here.
  await assert.rejects(() => b.put('user', 'card', 'from B'));
  // A B that wrote it before it could ask (offline, then linked): the server still keeps A's.
  const offline = new PeerPigeonStorage({ ...opts, userId: 'user-b2', peerId: 'b2', signingKeys: kb });
  await offline.init();
  await offline.put('user', 'card', 'from B');
  const link = new StorageServerLink(mk('d'.repeat(64)));
  await offline.attachServers(link);
  await link.start();
  await settle(200);
  assert.equal((await reader.get('user', 'card'))?.value, 'from A');
});
