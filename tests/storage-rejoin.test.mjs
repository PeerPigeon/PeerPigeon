import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRandomPair, signMessage } from 'unsea';
import { createHash } from 'node:crypto';
import { PeerPigeonStorage, PeerPigeonCryptoProtocol, StorageServerLink, StorageServer, STORAGE_SERVER_ROLE, ownedRoomOf } from '../dist/index.js';
// What an owner signs for a server (storage-servers.ts ownerText).
const ownerText = async (r) => `pp-ss-owner-v1:${r.room}:${r.slot}:${r.at}:${createHash('sha256').update(JSON.stringify(r.blob)).digest('hex')}`;

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

test('a storage made again on a link that has already found the servers reads from them at once', async () => {
  // The demo does this: its storage is made again once the peer's keys arrive, on the link it kept.
  const scope = makeScope();
  await server(scope, '1');
  const writer = await join(scope, 'w', await generateRandomPair());
  await writer.link.start();
  await settle();
  await writer.storage.put('public', 'test', 'saved before leaving');
  await settle();
  await leave(writer);

  const first = await join(scope, 'r', null, { serverWaitMs: 300 });
  await first.link.start();
  await settle();
  assert.equal(first.storage.serverCount(), 1);
  await first.storage.close();
  // Made again, on the same link: no new "servers" event comes.
  const again = new PeerPigeonStorage({ ...options, userId: 'user-r2', peerId: 'peer-r', serverWaitMs: 300 });
  await again.init();
  await again.attachServers(first.link);
  const t = Date.now();
  assert.equal((await again.get('public', 'test'))?.value, 'saved before leaving');
  assert.ok(Date.now() - t < 250, 'read without waiting out serverWaitMs');
  assert.deepEqual((await again.list('public')).map((r) => r.key), ['test']);
  await first.link.close(); await again.close();
});

test('an account signs its frozen records on any device, and nobody can change them', async () => {
  const scope = makeScope();
  await server(scope, '1');
  const account = await generateRandomPair();
  // Device 1: the page's own keys, then the person signs in.
  const one = await join(scope, 'd1', await generateRandomPair());
  await one.link.start();
  await settle();
  one.storage.signAs(account);
  assert.equal(one.storage.signer(), account.pub);
  await one.storage.put('frozen', `game:${account.pub}:g1`, { result: 'win' });
  await assert.rejects(() => one.storage.put('frozen', `game:${account.pub}:g1`, { result: 'loss' }), 'frozen: not even its owner changes it');
  await settle();
  await leave(one);

  // Device 2, alone in the room, signs in too: the record is there, and it is the account's.
  const two = await join(scope, 'd2', await generateRandomPair());
  two.storage.signAs(account);
  const reading = two.storage.get('frozen', `game:${account.pub}:g1`);
  await two.link.start();
  const rec = await reading;
  assert.deepEqual(rec?.value, { result: 'win' });
  assert.equal(rec?.signer, account.pub);
  const mine = (await two.storage.list('frozen')).filter((r) => r.key.startsWith(`game:${account.pub}:`) && r.signer === account.pub);
  assert.deepEqual(mine.map((r) => r.key), [`game:${account.pub}:g1`]);
  // Signing out goes back to the page's own keys.
  two.storage.signAs(null);
  assert.notEqual(two.storage.signer(), account.pub);
  await leave(two);

  // Someone else cannot replace it, here or on the servers.
  const other = await join(scope, 'x', await generateRandomPair());
  await other.link.start();
  await settle();
  await assert.rejects(() => other.storage.put('frozen', `game:${account.pub}:g1`, { result: 'loss' }));
  const again = await other.storage.get('frozen', `game:${account.pub}:g1`);
  assert.deepEqual(again?.value, { result: 'win' });
  await leave(other);
});

test("a person's own room lists only their records, on the same link as the shared room", async () => {
  const scope = makeScope();
  await server(scope, '1');
  const account = await generateRandomPair();
  const p = await join(scope, 'a', account);
  await p.link.start();
  await settle();
  // Lots in the shared room, two in the person's own.
  for (let i = 0; i < 30; i++) await p.storage.put('frozen', `game:other:${i}`, i);
  const own = new PeerPigeonStorage({ ...options, sessionId: `games:${account.pub}`, userId: account.epub, peerId: 'peer-a', signingKeys: account });
  await own.init();
  await own.attachServers(p.link);
  await own.put('frozen', 'g1', { result: 'win' });
  await own.put('frozen', 'g2', { result: 'loss' });
  await settle();
  const mine = await p.link.list((await own.slotOf('frozen', 'g1')) && own.serverIds.room);
  assert.equal(mine.length, 2, 'the server holds two records in that room');
  await own.close();

  // Another device, same account, nobody else online: it reads its two, and nothing of the 30.
  const q = await join(scope, 'b', await generateRandomPair());
  const again = new PeerPigeonStorage({ ...options, sessionId: `games:${account.pub}`, userId: 'other', peerId: 'peer-b', signingKeys: account });
  await again.init();
  await again.attachServers(q.link);
  await q.link.start();
  const games = await again.list('frozen');
  assert.deepEqual(games.map((g) => g.key).sort(), ['g1', 'g2']);
  assert.ok(games.every((g) => g.signer === account.pub));
  await again.close(); await leave(q); await leave(p);
});

test("nobody but its owner puts anything in an owned room, knowing the key or not", async () => {
  const scope = makeScope();
  await server(scope, '1');
  const account = await generateRandomPair(), stranger = await generateRandomPair();
  const room = { ...options, sessionId: `games:${account.pub}`, owner: account.pub };

  const p = await join(scope, 'a', account);
  await p.link.start();
  await settle();
  const own = new PeerPigeonStorage({ ...room, userId: account.epub, peerId: 'peer-a', signingKeys: account });
  await own.init();
  await own.attachServers(p.link);
  await own.put('frozen', 'g1', { result: 'win' });
  await settle();
  assert.equal(own.serverIds.room, await ownedRoomOf(account.pub));
  await own.close();

  // A stranger opens the same room: refused here...
  const q = await join(scope, 'b', stranger);
  await q.link.start();
  await settle();
  const theirs = new PeerPigeonStorage({ ...room, userId: stranger.epub, peerId: 'peer-b', signingKeys: stranger });
  await theirs.init();
  await theirs.attachServers(q.link);
  await assert.rejects(() => theirs.put('frozen', 'g2', { result: 'loss' }), /owner/);
  // ...and by the server, sent straight to it: unsigned, or signed as themselves.
  const ownedRoom = await ownedRoomOf(account.pub);
  const base = { room: ownedRoom, slot: 'a'.repeat(64), tag: 'b'.repeat(16), at: Date.now(), blob: { junk: true }, once: true };
  assert.equal(await q.link.put(base, 'c'.repeat(64)), 0, 'unsigned: refused');
  const signedAsStranger = { ...base, slot: 'd'.repeat(64), owner: stranger.pub };
  signedAsStranger.osig = await signMessage(await ownerText(signedAsStranger), stranger.priv);
  assert.equal(await q.link.put(signedAsStranger, 'e'.repeat(64)), 0, 'signed by someone else: refused');
  const held = await q.link.list(ownedRoom);
  assert.equal(held.length, 1, 'the room holds only the owner\'s record');
  assert.deepEqual((await theirs.list('frozen')).map((r) => r.key), ['g1']);
  await theirs.close(); await leave(q); await leave(p);
});
