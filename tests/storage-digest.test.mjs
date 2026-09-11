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
