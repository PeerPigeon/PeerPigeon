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

async function peer(scope, id, extra = {}, role = null) {
  const storage = new PeerPigeonStorage({ ...options, userId: `user-${id}`, peerId: id, ...extra });
  await storage.init();
  const link = new StorageServerLink(scope.node(hex(id)));
  link.role = role;
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

test('a peer whose servers link only after its first read gets the records it replicates, as changes', async () => {
  const scope = makeScope();
  await server(scope, '1');
  const a = await peer(scope, 'a');
  await settle();
  await a.storage.put('public', 'feed/1', { text: 'first post' });
  await a.storage.put('public', 'other/1', 'not replicated');
  await settle();
  await a.link.close();
  // A new browser: its node is there, but the servers are not linked to it yet.
  const storage = new PeerPigeonStorage({ ...options, userId: 'user-b', peerId: 'b', replicate: ['feed/'], serverWaitMs: 50 });
  await storage.init();
  const n = scope.node(hex('b'));
  const realConnect = n.connectToPeer;
  n.connectToPeer = () => {}; // slow to reach the servers
  const link = new StorageServerLink(n);
  await storage.attachServers(link);
  await link.start();
  assert.deepEqual((await storage.list('public')).map((r) => r.key), [], 'nothing yet: its first read found no servers');
  let arrived = null;
  storage.on('change', (e) => { if (e.key === 'feed/1') arrived = e.record?.value; });
  n.connectToPeer = realConnect; // the servers link now (the link looks again every 2 s)
  for (let i = 0; i < 60 && !arrived; i++) await settle(100);
  assert.deepEqual(arrived, { text: 'first post' });
  assert.deepEqual((await storage.list('public')).filter((r) => r.key.startsWith('feed/')).map((r) => r.key), ['feed/1']);
  await link.close();
});

test('a blob is found when the reader knows other servers than the writer did', async () => {
  const scope = makeScope();
  await server(scope, '1');
  const a = await peer(scope, 'a');
  await settle();
  const bytes = new TextEncoder().encode('a picture in a post');
  assert.equal(await a.link.putBlob(bytes), 1);
  await a.link.close();
  // More servers join, closer to the blob than the one that has it (not given it yet).
  for (const id of ['2', '3', '4', '5', '6']) await server(scope, id);
  const b = await peer(scope, 'b');
  await settle();
  const { createHash } = await import('node:crypto');
  const got = await b.link.getBlob(createHash('sha256').update(bytes).digest('hex'));
  assert.equal(new TextDecoder().decode(got), 'a picture in a post');
  await b.link.close();
});

test('a blob on a server the reader is slow to reach is found in about one link\'s time, and the next goes straight there', async () => {
  const scope = makeScope();
  await server(scope, '1');
  const a = await peer(scope, 'a');
  await settle();
  const one = new TextEncoder().encode('first piece of a picture');
  const two = new TextEncoder().encode('second piece of a picture');
  assert.equal(await a.link.putBlob(one), 1);
  assert.equal(await a.link.putBlob(two), 1);
  await a.link.close();
  for (const id of ['2', '3', '4', '5', '6', '7']) await server(scope, id);
  // A reader whose every new link takes 700 ms (WebRTC over the internet).
  const storage = new PeerPigeonStorage({ ...options, userId: 'user-r', peerId: 'r' });
  await storage.init();
  const n = scope.node(hex('r'));
  const connect = n.connectToPeer;
  const pending = new Set();
  n.connectToPeer = (id) => { if (pending.has(id) || n.links.has(id)) return; pending.add(id); setTimeout(() => { pending.delete(id); connect(id); }, 700); };
  const link = new StorageServerLink(n);
  await storage.attachServers(link);
  await link.start();
  const { createHash } = await import('node:crypto');
  const h = (b) => createHash('sha256').update(b).digest('hex');
  let t = Date.now();
  assert.equal(new TextDecoder().decode(await link.getBlob(h(one))), 'first piece of a picture');
  const firstMs = Date.now() - t;
  t = Date.now();
  assert.equal(new TextDecoder().decode(await link.getBlob(h(two))), 'second piece of a picture');
  const secondMs = Date.now() - t;
  assert.ok(firstMs < 3_000, `first piece in ${firstMs} ms`);
  assert.ok(secondMs < 300, `second piece in ${secondMs} ms (straight to the server that had the first)`);
  await link.close();
});

test('a list that waits for the servers includes a record that arrived while it waited', async () => {
  const storage = new PeerPigeonStorage({ ...options, userId: 'user-w', peerId: 'w', serverWaitMs: 600 });
  await storage.init();
  storage.expectServers(); // none will come: the list waits serverWaitMs
  const listing = storage.list('public');
  await settle(150);
  await storage.put('public', 'late/1', 'arrived during the wait');
  assert.deepEqual((await listing).map((r) => r.key), ['late/1']);
  await storage.close();
});

test('a server tells anyone its owner, and only its owner its stats', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const { statsText } = await import('../dist/index.js');
  const owner = await generateRandomPair();
  const stranger = await generateRandomPair();
  const scope = makeScope();
  const server = new StorageServer(scope.node(hex('s'), STORAGE_SERVER_ROLE), undefined, { owner: () => owner.pub });
  await server.start();
  const unowned = new StorageServer(scope.node(hex('t'), STORAGE_SERVER_ROLE));
  await unowned.start();
  const { storage, link } = await peer(scope, 'p');
  await storage.put('user', 'k', 'v');
  await settle();

  const anonymous = await link.serverStats(hex('s'));
  assert.equal(anonymous.owner, owner.pub);
  assert.equal(anonymous.stats, undefined, 'no stats without the owner\'s signature');

  const theirs = await link.serverStats(hex('s'), (text) => signMessage(text, stranger.priv));
  assert.equal(theirs.stats, undefined, 'nor with someone else\'s');

  const mine = await link.serverStats(hex('s'), (text) => signMessage(text, owner.priv));
  assert.equal(mine.owner, owner.pub);
  assert.ok(mine.stats.records >= 1 && mine.stats.rooms >= 1, 'it keeps the peer\'s record');
  assert.ok(mine.stats.uptimeMs >= 0);

  // An ask signed for another server, or long ago, gets no stats.
  const elsewhere = await signMessage(statsText(hex('t'), Date.now()), owner.priv);
  assert.equal((await link.serverStats(hex('s'), async () => elsewhere)).stats, undefined);

  assert.equal((await link.serverStats(hex('t'))).owner, null);
  assert.equal(await link.serverStats(hex('x'), undefined, 300), null, 'no such server');
  await link.close(); await server.close(); await unowned.close(); await storage.close();
});

test('someone holding the owner\'s pass gets the stats too, until it runs out', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const { grantText } = await import('../dist/index.js');
  const owner = await generateRandomPair();
  const member = await generateRandomPair();
  const scope = makeScope();
  const server = new StorageServer(scope.node(hex('u'), STORAGE_SERVER_ROLE), undefined, { owner: owner.pub });
  await server.start();
  const { storage, link } = await peer(scope, 'q');
  await settle();
  const until = Date.now() + 86400_000;
  const pass = { by: member.pub, until, gsig: await signMessage(grantText(owner.pub, member.pub, until), owner.priv) };
  const asMember = (text) => signMessage(text, member.priv);
  assert.ok((await link.serverStats(hex('u'), asMember, 6000, pass)).stats, 'with the pass');
  assert.equal((await link.serverStats(hex('u'), asMember)).stats, undefined, 'not without it');
  const forged = { ...pass, gsig: await signMessage(grantText(owner.pub, member.pub, until), member.priv) };
  assert.equal((await link.serverStats(hex('u'), asMember, 6000, forged)).stats, undefined, 'not a pass the member made');
  const past = Date.now() - 1000;
  const expired = { by: member.pub, until: past, gsig: await signMessage(grantText(owner.pub, member.pub, past), owner.priv) };
  assert.equal((await link.serverStats(hex('u'), asMember, 6000, expired)).stats, undefined, 'not after it runs out');
  await link.close(); await server.close(); await storage.close();
});

test('fetch reads the servers\' newer copy where get keeps the one read before', async () => {
  const scope = makeScope();
  const server = new StorageServer(scope.node(hex('v'), STORAGE_SERVER_ROLE));
  await server.start();
  const a = await peer(scope, 'r');
  await a.storage.put('user', 'k', 'one');
  await settle(100);
  const b = await peer(scope, 'w');
  await settle(100);
  assert.equal((await b.storage.get('user', 'k'))?.value, 'one');
  // b's page goes away while a changes the record; b comes back with only its own copy.
  await b.link.close();
  await a.storage.put('user', 'k', 'two');
  await settle(100);
  const link2 = new StorageServerLink(scope.node(hex('x')));
  await b.storage.attachServers(link2);
  await link2.start();
  await settle(100);
  assert.equal((await b.storage.fetch('user', 'k'))?.value, 'two');
  await a.link.close(); await link2.close(); await server.close(); await a.storage.close(); await b.storage.close();
});

test('a pass with no end date holds until the owner takes it back at the server', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const { grantText } = await import('../dist/index.js');
  const owner = await generateRandomPair();
  const member = await generateRandomPair();
  const scope = makeScope();
  const server = new StorageServer(scope.node(hex('y'), STORAGE_SERVER_ROLE), undefined, { owner: owner.pub });
  await server.start();
  const { storage, link } = await peer(scope, 'z');
  await settle();
  const pass = { by: member.pub, until: 0, gsig: await signMessage(grantText(owner.pub, member.pub, 0), owner.priv) };
  const asMember = (text) => signMessage(text, member.priv);
  const asOwner = (text) => signMessage(text, owner.priv);
  assert.ok((await link.serverStats(hex('y'), asMember, 6000, pass)).stats, 'no end date');
  assert.equal(await link.revokePass(hex('y'), member.pub, asMember), false, 'only the owner takes it back');
  assert.ok((await link.serverStats(hex('y'), asMember, 6000, pass)).stats);
  assert.equal(await link.revokePass(hex('y'), member.pub, asOwner), true);
  assert.equal((await link.serverStats(hex('y'), asMember, 6000, pass)).stats, undefined, 'taken back');
  assert.equal(await link.revokePass(hex('y'), member.pub, asOwner, true), true);
  assert.ok((await link.serverStats(hex('y'), asMember, 6000, pass)).stats, 'given back');
  await link.close(); await server.close(); await storage.close();
});

test('a room\'s history: a sample a minute, hours and days summed up, read in steps that fit the range', async () => {
  const { RoomStats, MemoryRoomStatsStore } = await import('../dist/index.js');
  const store = new MemoryRoomStatsStore();
  const stats = new RoomStats(store);
  const room = hex('r');
  const t0 = Date.UTC(2026, 10, 20, 10, 0);
  // 3 hours, a minute at a time: 2 people (one in two tabs) and a bot, then 4 in the second hour (two new
  // each minute), then 1.
  for (let m = 0; m < 180; m++) {
    const people = m < 60 ? ['a', 'b', 'b'] : m < 120 ? ['a', 'b', `c${m}`, `d${m}`] : ['a'];
    await stats.sample(room, people, m < 120 ? 1 : 0, t0 + m * 60_000);
  }
  const hour = await stats.read(room, t0 + 120 * 60_000, t0 + 180 * 60_000);
  assert.equal(hour.step, 60_000);
  assert.ok(hour.points.every((p) => p.people === 1 && p.roles === 0));
  const day = await stats.read(room, t0 - 20 * 3_600_000, t0 + 4 * 3_600_000);
  assert.equal(day.step, 5 * 60_000);
  assert.equal(day.points.length, 36);
  assert.deepEqual(day.points[0], { at: t0, people: 2, peak: 2, roles: 1 });
  const week = await stats.read(room, t0 - 6 * 86_400_000, t0 + 86_400_000);
  assert.equal(week.step, 3_600_000);
  assert.deepEqual(week.points.map((p) => [p.people, p.peak, p.visitors]), [[2, 2, 2], [4, 4, 122], [1, 1, 1]]);
  const year = await stats.read(room, t0 - 300 * 86_400_000, t0 + 86_400_000);
  assert.equal(year.step, 86_400_000);
  assert.equal(year.points.length, 1);
  assert.equal(year.points[0].peak, 4);
  assert.equal(year.points[0].visitors, 122);
  // Kept: a new reader (a restarted server) has it.
  const again = await new RoomStats(store).read(room, t0 - 6 * 86_400_000, t0 + 86_400_000);
  assert.equal(again.points.length, 3);
});

test('a server counts who is in each room it keeps, and tells only its owner (or a pass) the history', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const { grantText } = await import('../dist/index.js');
  const owner = await generateRandomPair();
  const member = await generateRandomPair();
  const stranger = await generateRandomPair();
  const scope = makeScope();
  const s = new StorageServer(scope.node(hex('h'), STORAGE_SERVER_ROLE), undefined, { owner: owner.pub });
  await s.start();
  const a = await peer(scope, 'i');
  const b = await peer(scope, 'j');
  await a.storage.put('user', 'k', 'v');
  await settle(100);
  // b again, from another tab: a new peer id, the same person.
  const b2 = await peer(scope, 'k', { userId: 'user-j' });
  // A bot: its role is in its own network, not the servers' scope, so it says so itself.
  const bot = await peer(scope, 'l', {}, 'bot');
  await settle(100);
  await s.sampleRooms();
  const room = s['history'].rooms()[0];
  assert.equal(s['watchers'].get(room)?.size, 4, 'four peers watch it');
  assert.ok(room, 'the peers\' room is watched');
  const now = Date.now();
  const asOwner = (text) => signMessage(text, owner.priv);
  const got = await a.link.roomStats(hex('h'), room, now - 3_600_000, now + 60_000, asOwner);
  assert.equal(got.step, 60_000);
  assert.equal(got.points.at(-1).people, 2);
  assert.equal(got.points.at(-1).roles, 1, 'the bot, apart');
  const pass = { by: member.pub, until: 0, gsig: await signMessage(grantText(owner.pub, member.pub, 0), owner.priv) };
  assert.ok(await a.link.roomStats(hex('h'), room, now - 3_600_000, now + 60_000, (t) => signMessage(t, member.priv), pass), 'with a pass');
  assert.equal(await a.link.roomStats(hex('h'), room, now - 3_600_000, now + 60_000, (t) => signMessage(t, stranger.priv)), null, 'not to anyone else');
  await a.link.close(); await b.link.close(); await b2.link.close(); await bot.link.close(); await s.close(); await bot.storage.close(); await a.storage.close(); await b.storage.close(); await b2.storage.close();
});

test('a page following a room hears each new count, with no asking, until it stops or its pass is taken back', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const { grantText } = await import('../dist/index.js');
  const owner = await generateRandomPair();
  const member = await generateRandomPair();
  const stranger = await generateRandomPair();
  const scope = makeScope();
  const s = new StorageServer(scope.node(hex('m'), STORAGE_SERVER_ROLE), undefined, { owner: owner.pub });
  await s.start();
  const a = await peer(scope, 'n');
  await a.storage.put('user', 'k', 'v');
  await settle(100);
  await s.sampleRooms();
  const room = s['history'].rooms()[0];
  const heard = [];
  const stop = await a.link.followRoomStats(hex('m'), room, (t) => signMessage(t, owner.priv), (now) => heard.push(now));
  assert.ok(stop, 'the owner may follow it');
  await s.sampleRooms(Date.now() + 60_000);
  await settle();
  assert.equal(heard.length, 1);
  assert.equal(heard[0].minute.people, 1);
  assert.ok(heard[0].five && heard[0].hour && heard[0].day);
  assert.equal(heard[0].hour.visitors, 1);
  stop();
  await settle();
  await s.sampleRooms(Date.now() + 120_000);
  await settle();
  assert.equal(heard.length, 1, 'nothing after it stops');

  assert.equal(await a.link.followRoomStats(hex('m'), room, (t) => signMessage(t, stranger.priv), () => {}), null, 'not for anyone else');
  const pass = { by: member.pub, until: 0, gsig: await signMessage(grantText(owner.pub, member.pub, 0), owner.priv) };
  const theirs = [];
  assert.ok(await a.link.followRoomStats(hex('m'), room, (t) => signMessage(t, member.priv), (now) => theirs.push(now), pass), 'with a pass');
  await s.sampleRooms(Date.now() + 180_000);
  await settle();
  assert.equal(theirs.length, 1);
  assert.equal(await a.link.revokePass(hex('m'), member.pub, (t) => signMessage(t, owner.priv)), true);
  await s.sampleRooms(Date.now() + 240_000);
  await settle();
  assert.equal(theirs.length, 1, 'nothing once the pass is taken back');
  await a.link.close(); await s.close(); await a.storage.close();
});

test('a page following a room hears someone come and go at once, not at the next minute', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const owner = await generateRandomPair();
  const scope = makeScope();
  const s = new StorageServer(scope.node(hex('q'), STORAGE_SERVER_ROLE), undefined, { owner: owner.pub });
  await s.start();
  const a = await peer(scope, 'r');
  await settle(100);
  const room = [...s['watchers'].keys()][0];
  const heard = [];
  assert.ok(await a.link.followRoomStats(hex('q'), room, (t) => signMessage(t, owner.priv), (now) => heard.push(now.minute.people)));
  const b = await peer(scope, 's');
  await settle(150);
  assert.equal(heard.at(-1), 2, 'the second one, as it links');
  await b.link.close();
  await settle(150);
  assert.equal(heard.at(-1), 1, 'and gone, as it leaves');
  await a.link.close(); await s.close(); await a.storage.close(); await b.storage.close();
});

test('a console following a server hears its numbers as they change, and nothing once it stops', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const owner = await generateRandomPair();
  const stranger = await generateRandomPair();
  const scope = makeScope();
  const s = new StorageServer(scope.node(hex('t'), STORAGE_SERVER_ROLE), undefined, { owner: owner.pub });
  await s.start();
  const a = await peer(scope, 'u');
  await settle(100);
  const heard = [];
  let ended = 0;
  const f = await a.link.followServerStats(hex('t'), (t) => signMessage(t, owner.priv), (st) => heard.push(st), undefined, () => ended++);
  assert.ok(f && f.startedAt > 0, 'the owner may follow it');
  await settle(50);
  assert.equal(heard.length, 1, 'its numbers at once');
  const before = heard[0].records;
  await a.storage.put('user', 'k2', 'v2');
  await settle(100);
  await s['sendStats']();
  await settle(50);
  assert.equal(heard.at(-1).records, before + 1, 'and again when they change');
  const n = heard.length;
  await s['sendStats']();
  await settle(50);
  assert.equal(heard.length, n, 'not when nothing changed');
  f.stop();
  await settle(50);
  await a.storage.put('user', 'k3', 'v3');
  await settle(100);
  await s['sendStats']();
  await settle(50);
  assert.equal(heard.length, n, 'nothing after it stops');
  assert.equal(await a.link.followServerStats(hex('t'), (t) => signMessage(t, stranger.priv), () => {}), null, 'not for anyone else');
  await a.link.close(); await s.close(); await a.storage.close();
});

test('a follow ends, and says so, when the link to its server drops', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const owner = await generateRandomPair();
  const scope = makeScope();
  const s = new StorageServer(scope.node(hex('v'), STORAGE_SERVER_ROLE), undefined, { owner: owner.pub });
  await s.start();
  const a = await peer(scope, 'w');
  await settle(100);
  let ended = 0;
  assert.ok(await a.link.followServerStats(hex('v'), (t) => signMessage(t, owner.priv), () => {}, undefined, () => ended++));
  await s.close();
  await s['node'].destroy();
  await settle(150);
  assert.equal(ended, 1);
  await a.link.close(); await a.storage.close();
});

test('the owner clears records off its server: moved aside, old copies not taken again, and peers that trust the owner drop theirs', async () => {
  const { generateRandomPair, signMessage } = await import('unsea');
  const { createHash } = await import('node:crypto');
  const sha = (t) => createHash('sha256').update(t).digest('hex');
  const owner = await generateRandomPair();
  const other = await generateRandomPair();
  const scope = makeScope();
  const s = new StorageServer(scope.node(hex('c'), STORAGE_SERVER_ROLE), undefined, { owner: owner.pub });
  await s.start();
  const a = await peer(scope, 'a', { replicate: ['t/'] });
  const b = await peer(scope, 'b', { replicate: ['t/'], clearers: [owner.pub] });
  await settle();
  await a.storage.put('public', 't/1', 'one');
  await a.storage.put('public', 't/2', 'two');
  await a.storage.put('public', 'keep', 'stays');
  await settle(100);
  assert.equal((await b.storage.get('public', 't/1'))?.value, 'one');
  const seed = `peerpigeon:storage-servers:v1:${options.sessionId}:${options.syncSecret}`;
  const room = sha(`${seed}:room`);
  const slots = ['t/1', 't/2'].map((k) => sha(`${seed}:slot:public:${k}`));
  const listed = await a.link.listAt(hex('c'), room);
  assert.equal(listed.length, 3);

  assert.equal(await a.link.clearAt(hex('c'), room, slots, (t) => signMessage(t, other.priv)), null, 'only the owner clears');
  assert.equal(await a.link.clearAt(hex('c'), room, slots, (t) => signMessage(t, owner.priv)), 2);
  await settle(100);
  assert.deepEqual((await a.link.listAt(hex('c'), room)).map((r) => r.slot), [sha(`${seed}:slot:public:keep`)]);

  // b trusts the owner: its copies went, and a tombstone keeps them from coming back. a does not: it keeps its own.
  assert.equal(await b.storage.get('public', 't/1'), null);
  assert.equal((await b.storage.get('public', 'keep'))?.value, 'stays');
  assert.equal((await a.storage.get('public', 't/1'))?.value, 'one');

  // a still has the old copies: the server does not take them back, but takes a newer write.
  await a.storage.put('public', 't/2', 'two again');
  await settle(100);
  const rec = await s.stats();
  assert.equal(rec.records, 2, 'the newer t/2 and keep');
  const after = (await a.link.listAt(hex('c'), room)).map((r) => r.slot).sort();
  assert.deepEqual(after, [sha(`${seed}:slot:public:keep`), slots[1]].sort());
  await a.link.close(); await b.link.close();
});
