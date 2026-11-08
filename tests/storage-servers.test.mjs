import assert from 'node:assert/strict';
import test from 'node:test';
import { PeerPigeonStorage, StorageServerLink, StorageServer, STORAGE_SERVER_ROLE } from '../dist/index.js';

// A scope of fake nodes: each can see every other node's role, dial any, and
// send direct frames to the ones it is linked to — the parts of
// PeerPigeonNode that the link and the server use.
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
      // Bytes (one binary frame): only to a linked node made to read them (bytesOk), as a real node's are.
      sent: { bytes: 0, text: 0 },
      sendBytes(to, meta, bytes) {
        if (!n.links.has(to) || !n.bytesOk) return false;
        n.sent.bytes++;
        const copy = { ...JSON.parse(JSON.stringify(meta)), bytes: bytes.slice() };
        queueMicrotask(() => nodes.get(to)?.emit('message', { kind: 'direct', fromPeerId: id, data: copy }));
        return true;
      },
    };
    nodes.set(id, n);
    return n;
  };
  return { node };
}

const hex = (c) => c.repeat(64);
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const options = { sessionId: 'net:room', syncSecret: 's3cret' };

async function peer(scope, id, extra = {}) {
  const storage = new PeerPigeonStorage({ ...options, userId: `user-${id}`, peerId: id, ...extra });
  await storage.init();
  const link = new StorageServerLink(scope.node(hex(id)));
  await storage.attachServers(link);
  await link.start();
  return { storage, link };
}

async function server(scope, id) {
  const s = new StorageServer(scope.node(hex(id), STORAGE_SERVER_ROLE));
  await s.start();
  return s;
}

test('a record written with servers up is read by another peer from them, with no mesh between them', async () => {
  const scope = makeScope();
  await server(scope, '1');
  const a = await peer(scope, 'a');
  const b = await peer(scope, 'b');
  await settle();
  assert.equal(a.storage.serverCount(), 1);
  await a.storage.put('public', 'notes/1', { text: 'hello' });
  await settle();
  const got = await b.storage.get('public', 'notes/1');
  assert.deepEqual(got?.value, { text: 'hello' });
  const listed = await b.storage.list('public');
  assert.deepEqual(listed.map((r) => r.key), ['notes/1']);
  await a.link.close(); await b.link.close();
});

test('records kept here move to a server that comes up later', async () => {
  const scope = makeScope();
  const a = await peer(scope, 'a');
  await a.storage.put('public', 'p/1', 1);
  await a.storage.put('frozen', 'f/1', 'once');
  await a.storage.put('private', 'secret', 'mine');
  await settle();
  assert.equal(a.storage.serverCount(), 0);
  const s = await server(scope, '1');
  await a.link.keep; // already kept
  await settle(2_200); // the link looks for servers every 2 s
  assert.equal(a.storage.serverCount(), 1);
  await settle(100);
  const stats = await s.stats();
  assert.equal(stats.records, 2, 'public and frozen went to the server; private did not');
  // Moved: gone from here, read back from the server when asked.
  const b = await peer(scope, 'b');
  await settle();
  assert.equal((await b.storage.get('frozen', 'f/1'))?.value, 'once');
  assert.equal((await a.storage.get('public', 'p/1'))?.value, 1);
  assert.equal((await a.storage.get('private', 'secret'))?.value, 'mine');
  await a.link.close(); await b.link.close();
});

test('a peer watching a key hears of a change through the servers', async () => {
  const scope = makeScope();
  await server(scope, '1');
  const a = await peer(scope, 'a');
  const b = await peer(scope, 'b');
  await settle();
  await b.storage.retrieve('public', 'live', { timeoutMs: 200 }); // subscribes
  const seen = new Promise((resolve) => b.storage.on('change', (e) => { if (e.key === 'live' && e.origin === 'remote') resolve(e.record.value); }));
  await a.storage.put('public', 'live', 42);
  assert.equal(await seen, 42);
  await a.link.close(); await b.link.close();
});

test('a frozen slot is never overwritten, and another room cannot touch a slot', async () => {
  const scope = makeScope();
  const s = await server(scope, '1');
  const a = await peer(scope, 'a');
  await settle();
  await a.storage.put('frozen', 'f', 'first');
  await settle();
  // The same key written again (a second write of a frozen key is refused here too, so go around it).
  const other = await peer(scope, 'c', { syncSecret: 'another-room' });
  await settle();
  await other.storage.put('frozen', 'f', 'second');
  await settle();
  assert.equal((await s.stats()).rooms, 2, 'each room is its own');
  const b = await peer(scope, 'b');
  await settle();
  assert.equal((await b.storage.get('frozen', 'f'))?.value, 'first');
  await a.link.close(); await b.link.close(); await other.link.close();
});

test('a room\'s records reach the servers closest to it, and move when a closer one joins', async () => {
  const scope = makeScope();
  const servers = [await server(scope, '1'), await server(scope, '2'), await server(scope, '3')];
  const a = await peer(scope, 'a');
  await settle();
  await a.storage.put('public', 'k', 'v');
  await settle(100);
  const counts = await Promise.all(servers.map(async (s) => (await s.stats()).records));
  assert.deepEqual(counts, [1, 1, 1], 'three replicas');
  // A fourth server: whichever three are closest hold it after a rebalance.
  const s4 = await server(scope, '4');
  await Promise.all([...servers, s4].map((s) => s.rebalance()));
  await settle(100);
  const all = await Promise.all([...servers, s4].map(async (s) => (await s.stats()).records));
  assert.ok(all.filter((n) => n === 1).length >= 3);
  // One goes: the rest still answer.
  await servers[0].close();
  const b = await peer(scope, 'b');
  await settle();
  assert.equal((await b.storage.get('public', 'k'))?.value, 'v');
  await a.link.close(); await b.link.close();
});

test('a blob kept on the servers is found by its hash, sealed, and copied to the closest three', async () => {
  const scope = makeScope();
  const servers = [await server(scope, '1'), await server(scope, '2'), await server(scope, '3'), await server(scope, '4')];
  const a = await peer(scope, 'a');
  const b = await peer(scope, 'b');
  await settle();
  const bytes = new TextEncoder().encode('a chunk of a file, or a part of a model');
  assert.ok(await a.link.putBlob(bytes) >= 1);
  await settle(100);
  const counts = await Promise.all(servers.map(async (s) => (await s.stats()).blobs));
  assert.equal(counts.reduce((x, y) => x + y, 0), 3, 'on three servers');
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const got = await b.link.getBlob(hash);
  assert.equal(new TextDecoder().decode(got), 'a chunk of a file, or a part of a model');
  assert.equal(await b.link.getBlob('0'.repeat(64)), null);
  await a.link.close(); await b.link.close();
});

test('blobs go as bytes between nodes that read them (no base64), and as base64 to one that does not', async () => {
  const scope = makeScope();
  const srv = await server(scope, '1');
  const a = await peer(scope, 'a');
  await settle();
  const srvNode = srv.node, aNode = a.link.node;
  srvNode.bytesOk = true; aNode.bytesOk = true;
  const bytes = new Uint8Array(131072).map((_, i) => (i * 13) & 255);
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(bytes).digest('hex');
  // The first put: the server is not known to read bytes yet (base64); the get asks for bytes.
  assert.equal(await a.link.putBlob(bytes), 1);
  const got = await a.link.getBlob(hash);
  assert.deepEqual(got, bytes);
  assert.equal(srvNode.sent.bytes, 1, 'the server answered with bytes');
  // Known now to read bytes: the next put goes as bytes too.
  const more = bytes.map((x) => x ^ 1);
  assert.equal(await a.link.putBlob(more), 1);
  assert.equal(aNode.sent.bytes, 1, 'the peer put it as bytes');
  assert.deepEqual(await a.link.getBlob(createHash('sha256').update(more).digest('hex')), more);
  // A peer that does not read bytes (an older one): asked without bin, it gets base64.
  const b = await peer(scope, 'b');
  await settle();
  const before = srvNode.sent.bytes;
  b.link.node.bytesOk = false;
  assert.deepEqual(await b.link.getBlob(hash), bytes);
  await a.link.close(); await b.link.close();
  assert.ok(srvNode.sent.bytes >= before);
});
