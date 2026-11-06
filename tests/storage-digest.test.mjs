import assert from 'node:assert/strict';
import test from 'node:test';
import { PeerPigeonStorage } from '../dist/index.js';

// Two gossip endpoints wired to each other: broadcasts and direct frames
// land on the other side's events, exactly the events GossipProtocol emits.
function makeGossip(id) {
  const listeners = new Map();
  const g = {
    id,
    other: null,
    broadcastsDelivered: true,
    on(event, cb) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(cb); },
    off(event, cb) { listeners.get(event)?.delete(cb); },
    emit(event, data) { for (const cb of listeners.get(event) ?? []) cb(data); },
    broadcast(data) {
      const messageId = Math.random().toString(36).slice(2);
      if (g.broadcastsDelivered) {
        queueMicrotask(() => g.other?.emit('messageReceived', { message: { data, id: messageId, sender: g.id }, local: false, fromPeer: g.id }));
      }
      return messageId;
    },
    sendDirect(to, data) {
      if (!g.other || to !== g.other.id) return null;
      queueMicrotask(() => g.other.emit('directMessageReceived', { message: { data, from: g.id, to } }));
      return 'direct';
    },
  };
  return g;
}

async function pair() {
  const a = makeGossip('peer-a');
  const b = makeGossip('peer-b');
  a.other = b; b.other = a;
  const options = { sessionId: 'digest-test', syncSecret: 'digest-test-secret' };
  const storageA = new PeerPigeonStorage({ ...options, userId: 'user-a', peerId: 'peer-a', gossip: a });
  const storageB = new PeerPigeonStorage({ ...options, userId: 'user-b', peerId: 'peer-b', gossip: b });
  await storageA.init();
  await storageB.init();
  return { a, b, storageA, storageB, close: async () => { await storageA.close(); await storageB.close(); } };
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

test('a directly addressed retrieve answer reaches the asker', async () => {
  const { storageA, storageB, close } = await pair();
  try {
    await storageB.put('public', 'held-by-b', { n: 1 });
    const startedAt = Date.now();
    const record = await storageA.retrieve('public', 'held-by-b', { timeoutMs: 3_000 });
    assert.equal(record?.value?.n, 1);
    assert.ok(Date.now() - startedAt < 1_500, 'the answer arrived before the timeout');
  } finally {
    await close();
  }
});

test('a connect-time digest pushes what the neighbour lacks and fetches what it holds newer', async () => {
  const { a, b, storageA, storageB, close } = await pair();
  try {
    // Written while the two were apart: no broadcast crosses the link.
    a.broadcastsDelivered = false;
    b.broadcastsDelivered = false;
    await storageA.put('public', 'from-a', { n: 1 });
    await storageB.put('public', 'from-b', { n: 2 });
    await storageA.put('public', 'shared', { n: 1 });
    await storageB.put('public', 'shared', { n: 1 });
    await storageB.put('public', 'shared', { n: 2 });
    storageB.subscribeKey('public', 'from-a');
    storageA.subscribeKey('public', 'from-b');
    storageA.subscribeKey('public', 'shared');
    storageB.subscribeKey('public', 'shared');
    assert.equal(await storageB.get('public', 'from-a'), null);
    assert.equal(await storageA.get('public', 'from-b'), null);

    // The link comes up: both sides send a digest.
    a.emit('peerConnected', { peerId: 'peer-b' });
    b.emit('peerConnected', { peerId: 'peer-a' });
    await settle();

    assert.equal((await storageB.get('public', 'from-a'))?.value?.n, 1, 'B received what A held');
    assert.equal((await storageA.get('public', 'from-b'))?.value?.n, 2, 'A received what B held');
    assert.equal((await storageA.get('public', 'shared'))?.value?.n, 2, 'A took B\'s newer version');
    assert.equal((await storageB.get('public', 'shared'))?.value?.n, 2, 'B kept its newer version');
  } finally {
    await close();
  }
});

test('a digest lists only subscribed mutable keys and pushes nothing the neighbour already has', async () => {
  const { a, b, storageA, storageB, close } = await pair();
  try {
    storageB.subscribeKey('public', 'same');
    await storageA.put('public', 'same', { n: 1 });
    await settle();
    // B took the broadcast, so both hold the same version.
    assert.equal((await storageB.get('public', 'same'))?.value?.n, 1);
    await storageA.put('frozen', 'chunk', { data: 'x' });
    storageB.subscribeKey('frozen', 'chunk');
    const direct = [];
    const originalSendDirect = b.sendDirect;
    b.sendDirect = (to, data) => { direct.push(data); return originalSendDirect(to, data); };
    const pushes = [];
    const originalASendDirect = a.sendDirect;
    a.sendDirect = (to, data) => { pushes.push(data); return originalASendDirect(to, data); };
    b.emit('peerConnected', { peerId: 'peer-a' });
    await settle();
    assert.equal(direct.length, 1, 'B sent one digest');
    assert.equal(pushes.length, 0, 'A had nothing newer to push and asked for nothing');
  } finally {
    await close();
  }
});

test('a node that declares a namespace is pushed its records without subscribing to each key', async () => {
  const a = makeGossip('peer-a');
  const b = makeGossip('peer-b');
  a.other = b; b.other = a;
  const options = { sessionId: 'namespace-test', syncSecret: 'namespace-test-secret' };
  const storageA = new PeerPigeonStorage({ ...options, userId: 'user-a', peerId: 'peer-a', gossip: a });
  // B replicates one namespace and subscribes to nothing inside it, which is
  // every fresh replica: a browser that has just opened, a watcher that has
  // just restarted. It used to drop every mutation it heard for its own
  // namespace, so the room was silent to it and asking was the only way to
  // learn anything at all.
  const storageB = new PeerPigeonStorage({
    ...options,
    userId: 'user-b',
    peerId: 'peer-b',
    gossip: b,
    syncFilter: (_space, key) => String(key).startsWith('fleet/'),
  });
  await storageA.init();
  await storageB.init();
  try {
    await storageA.put('public', 'fleet/publisher/one', { beat: 1 });
    await settle();
    assert.equal((await storageB.get('public', 'fleet/publisher/one'))?.value?.beat, 1,
      'the write arrived without B ever asking for it');

    // And it keeps arriving: this is a heartbeat, not a one-off.
    await storageA.put('public', 'fleet/publisher/one', { beat: 2 });
    await settle();
    assert.equal((await storageB.get('public', 'fleet/publisher/one'))?.value?.beat, 2);

    // What the namespace excludes is still refused, so declaring one narrows
    // what a node takes rather than opening it to the whole room.
    await storageA.put('public', 'elsewhere/publisher/two', { beat: 1 });
    await settle();
    assert.equal(await storageB.get('public', 'elsewhere/publisher/two'), null,
      'a key outside the declared namespace is not accepted');
  } finally {
    await storageA.close();
    await storageB.close();
  }
});

test('a node that replicates a namespace is caught up on link with every record under it, keys it never knew', async () => {
  const a = makeGossip('peer-a');
  const b = makeGossip('peer-b');
  a.other = b; b.other = a;
  const options = { sessionId: 'replicate-test', syncSecret: 'replicate-test-secret' };
  const storageA = new PeerPigeonStorage({ ...options, userId: 'user-a', peerId: 'peer-a', gossip: a, replicate: ['holds/'] });
  const storageB = new PeerPigeonStorage({ ...options, userId: 'user-b', peerId: 'peer-b', gossip: b, replicate: ['holds/'] });
  await storageA.init();
  await storageB.init();
  try {
    // Written while the two were apart (B had not joined): no broadcast crosses.
    a.broadcastsDelivered = false;
    b.broadcastsDelivered = false;
    await storageA.put('user', 'holds/user-a', { files: 3 });
    await storageA.put('public', 'holds/shared-index', { n: 1 });
    await storageA.put('public', 'elsewhere/other', { n: 1 });
    await storageB.put('user', 'holds/user-b', { files: 1 });
    assert.equal(await storageB.get('user', 'holds/user-a'), null);

    // The link comes up: B never subscribed to any of A's keys, and does not know they exist.
    a.emit('peerConnected', { peerId: 'peer-b' });
    b.emit('peerConnected', { peerId: 'peer-a' });
    await settle();
    assert.equal((await storageB.get('user', 'holds/user-a'))?.value?.files, 3, 'A\'s record under the namespace reached B');
    assert.equal((await storageB.get('public', 'holds/shared-index'))?.value?.n, 1);
    assert.equal(await storageB.get('public', 'elsewhere/other'), null, 'nothing outside the namespace is sent');
    assert.equal((await storageA.get('user', 'holds/user-b'))?.value?.files, 1, 'and the other way round');
    assert.equal((await storageB.get('user', 'holds/user-a'))?.ownerId, 'user-a', 'the owner is kept');

    // From then on, changes arrive as they happen.
    a.broadcastsDelivered = true;
    await storageA.put('user', 'holds/user-a', { files: 4 });
    await settle();
    assert.equal((await storageB.get('user', 'holds/user-a'))?.value?.files, 4);
    // Only its owner can change a user record, replicated or not.
    await assert.rejects(storageB.put('user', 'holds/user-a', { files: 0 }), /denied/i);
  } finally {
    await storageA.close();
    await storageB.close();
  }
});

test('a digest that cannot be sent at once (a link just up, no route yet) is sent again', async () => {
  const a = makeGossip('peer-a');
  const b = makeGossip('peer-b');
  a.other = b; b.other = a;
  const options = { sessionId: 'retry-test', syncSecret: 'retry-test-secret' };
  const storageA = new PeerPigeonStorage({ ...options, userId: 'user-a', peerId: 'peer-a', gossip: a });
  const storageB = new PeerPigeonStorage({ ...options, userId: 'user-b', peerId: 'peer-b', gossip: b, replicate: ['holds/'] });
  await storageA.init();
  await storageB.init();
  try {
    a.broadcastsDelivered = false;
    await storageA.put('user', 'holds/user-a', { files: 2 });
    // B's first two sends find no route.
    let refusals = 2;
    const send = b.sendDirect.bind(b);
    b.sendDirect = (to, data) => (refusals-- > 0 ? null : send(to, data));
    b.emit('peerConnected', { peerId: 'peer-a' });
    await settle(1600);
    assert.equal((await storageB.get('user', 'holds/user-a'))?.value?.files, 2, 'the catch-up came after the retries');
  } finally {
    await storageA.close();
    await storageB.close();
  }
});

test('a replicating node is not pushed what it already holds as new', async () => {
  const a = makeGossip('peer-a');
  const b = makeGossip('peer-b');
  a.other = b; b.other = a;
  const options = { sessionId: 'replicate-test-2', syncSecret: 'replicate-test-secret' };
  const storageA = new PeerPigeonStorage({ ...options, userId: 'user-a', peerId: 'peer-a', gossip: a });
  const storageB = new PeerPigeonStorage({ ...options, userId: 'user-b', peerId: 'peer-b', gossip: b, replicate: ['ns/'] });
  await storageA.init();
  await storageB.init();
  try {
    await storageA.put('public', 'ns/k', { n: 1 });
    await settle();
    assert.equal((await storageB.get('public', 'ns/k'))?.value?.n, 1, 'heard as it happened');
    let pushes = 0;
    const send = a.sendDirect.bind(a);
    a.sendDirect = (to, data) => { pushes += 1; return send(to, data); };
    b.emit('peerConnected', { peerId: 'peer-a' });
    await settle();
    assert.equal(pushes, 0, 'B listed its copy, as new as A\'s: nothing to send');
  } finally {
    await storageA.close();
    await storageB.close();
  }
});

test('a node that declares no namespace still takes only what it subscribed to', async () => {
  const { storageA, storageB, close } = await pair();
  try {
    await storageA.put('public', 'unsubscribed-key', { n: 1 });
    await settle();
    assert.equal(await storageB.get('public', 'unsubscribed-key'), null,
      'without a declared namespace, a subscription is still the only way in');

    storageB.subscribeKey('public', 'subscribed-key');
    await storageA.put('public', 'subscribed-key', { n: 2 });
    await settle();
    assert.equal((await storageB.get('public', 'subscribed-key'))?.value?.n, 2);
  } finally {
    await close();
  }
});

test('a silent put is stored and served on request but gossips no mutation', async () => {
  const { a, storageA, storageB, close } = await pair();
  try {
    const broadcasts = [];
    const originalBroadcast = a.broadcast;
    a.broadcast = (data) => { broadcasts.push(data); return originalBroadcast(data); };
    storageB.subscribeKey('frozen', 'chunk-1');
    await storageA.put('frozen', 'chunk-1', { data: 'abc' }, { silent: true });
    await settle();
    assert.equal(broadcasts.length, 0, 'nothing was gossiped');
    assert.equal(await storageB.get('frozen', 'chunk-1'), null, 'B was not pushed the record');
    const fetched = await storageB.retrieve('frozen', 'chunk-1', { timeoutMs: 2_000 });
    assert.equal(fetched?.value?.data, 'abc', 'B gets it on request');
  } finally {
    await close();
  }
});

test('a Get with a local copy answers at once, and a newer value arrives as a change', async () => {
  const { a, storageA, storageB, close } = await pair();
  try {
    await storageA.put('public', 'shared-key', 'v1');
    await settle();
    // B asks once and so subscribes; then the holder stops answering
    // (it answers one asker about one key at most every few seconds).
    const first = await storageB.retrieve('public', 'shared-key', { timeoutMs: 3000 });
    assert.equal(first?.value, 'v1');
    a.broadcastsDelivered = false;
    const started = Date.now();
    const again = await storageB.retrieve('public', 'shared-key', { timeoutMs: 3000 });
    assert.equal(again?.value, 'v1');
    assert.ok(Date.now() - started < 100, `took ${Date.now() - started} ms`);
  } finally {
    await close();
  }
});

test('a Get with no local copy asks again when the first answer is lost', async () => {
  const { b, storageA, storageB, close } = await pair();
  try {
    await storageA.put('public', 'far-key', 'v1', { silent: true });
    const realBroadcast = b.broadcast;
    let dropped = 0;
    b.broadcast = (data) => (dropped++ === 0 ? 'lost' : realBroadcast(data));
    const started = Date.now();
    const got = await storageB.retrieve('public', 'far-key', { timeoutMs: 5000 });
    assert.equal(got?.value, 'v1');
    assert.ok(Date.now() - started < 2500, `took ${Date.now() - started} ms`);
  } finally {
    await close();
  }
});

test('a Get for a key nobody has gives up long before the timeout', async () => {
  const { storageB, close } = await pair();
  try {
    const started = Date.now();
    const got = await storageB.retrieve('public', 'nobody-has-this', { timeoutMs: 10_000 });
    assert.equal(got, null);
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  } finally {
    await close();
  }
});
