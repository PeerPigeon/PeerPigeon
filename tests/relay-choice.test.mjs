import assert from 'node:assert/strict';
import test from 'node:test';

import { RelayScoreBook, chooseRelays, discoverClosestSignalingServers } from '../dist/index.js';

const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
const relay = (url, kind = 'cloud', extra = {}) => ({ url, nodeId: hex(), kind, connections: 0, capacity: 10_000, ...extra });
const room = { network: 'network:test', room: 'relay-choice' };

test('a healthy local relay comes before every cloud relay', async () => {
  const relays = [relay('wss://a.example/ws'), relay('wss://b.example/ws'), relay('wss://home.example/t/x/ws', 'local')];
  for (let i = 0; i < 20; i += 1) {
    const [first] = await chooseRelays({ peerId: hex(), ...room, relays });
    assert.equal(first, 'wss://home.example/t/x/ws');
  }
});

test('a local relay that keeps failing, or is nearly full, loses to cloud', async () => {
  const local = relay('wss://home.example/t/x/ws', 'local');
  const cloud = relay('wss://a.example/ws');
  const book = new RelayScoreBook({ storage: null });
  book.recordJoin(local.nodeId, { ok: false });
  book.recordJoin(local.nodeId, { ok: false });
  assert.equal((await chooseRelays({ peerId: hex(), ...room, relays: [local, cloud], measurements: (id) => book.measurement(id) }))[0], cloud.url);
  const full = { ...local, connections: 9_500 };
  assert.equal((await chooseRelays({ peerId: hex(), ...room, relays: [full, cloud] }))[0], cloud.url);
});

test('within a tier the faster relay wins, and a tunnel-only relay pays a penalty', async () => {
  const slow = relay('wss://slow.example/ws');
  const fast = relay('wss://fast.example/ws');
  const book = new RelayScoreBook({ storage: null });
  book.recordJoin(slow.nodeId, { ok: true, joinMs: 900 });
  book.recordJoin(fast.nodeId, { ok: true, joinMs: 120 });
  const order = await chooseRelays({ peerId: hex(), ...room, relays: [slow, fast], measurements: (id) => book.measurement(id) });
  assert.deepEqual(order, [fast.url, slow.url]);
  const punched = relay('wss://home.example/t/p/ws', 'local');
  const tunnelOnly = relay('wss://home.example/t/q/ws', 'local', { tunnelOnly: true });
  const again = await chooseRelays({ peerId: hex(), ...room, relays: [tunnelOnly, punched] });
  assert.equal(again[0], punched.url);
});

test('a peer stays on its previous relay unless another is clearly better', async () => {
  const a = relay('wss://a.example/ws');
  const b = relay('wss://b.example/ws');
  const book = new RelayScoreBook({ storage: null });
  book.recordJoin(a.nodeId, { ok: true, joinMs: 400 });
  book.recordJoin(b.nodeId, { ok: true, joinMs: 340 }); // 15% better: not enough
  const measurements = (id) => book.measurement(id);
  assert.equal((await chooseRelays({ peerId: hex(), ...room, relays: [a, b], measurements, previousUrl: a.url }))[0], a.url);
  const c = relay('wss://c.example/ws');
  book.recordJoin(c.nodeId, { ok: true, joinMs: 100 }); // 75% better: switch
  assert.equal((await chooseRelays({ peerId: hex(), ...room, relays: [a, b, c], measurements, previousUrl: a.url }))[0], c.url);
  const local = relay('wss://home.example/t/l/ws', 'local');
  assert.equal((await chooseRelays({ peerId: hex(), ...room, relays: [a, local], previousUrl: a.url }))[0], local.url, 'a better tier always wins');
});

test('a room\'s peers spread over the room\'s relays, and only those', async () => {
  const relays = Array.from({ length: 12 }, (_, i) => relay(`wss://r${i}.example/ws`));
  const chosen = new Map();
  for (let i = 0; i < 300; i += 1) {
    const [first] = await chooseRelays({ peerId: hex(), ...room, relays });
    chosen.set(first, (chosen.get(first) ?? 0) + 1);
  }
  assert.ok(chosen.size <= 5, `only the room's 5 relays are chosen (got ${chosen.size})`);
  assert.ok(chosen.size >= 3, 'and the peers are spread over them');
  const other = new Set();
  for (let i = 0; i < 100; i += 1) other.add((await chooseRelays({ peerId: hex(), network: 'network:test', room: 'another-room', relays }))[0]);
  const order = await chooseRelays({ peerId: hex(), ...room, relays });
  assert.equal(order.length, 12, 'every relay stays available as failover');
  assert.ok(other.size >= 1);
});

test('the same inputs always give the same order', async () => {
  const relays = Array.from({ length: 6 }, (_, i) => relay(`wss://d${i}.example/ws`, i % 2 ? 'local' : 'cloud'));
  const peerId = hex();
  const first = await chooseRelays({ peerId, ...room, relays });
  for (let i = 0; i < 5; i += 1) assert.deepEqual(await chooseRelays({ peerId, ...room, relays: [...relays].reverse() }), first);
});

test('own measurements outweigh what others share, so a relay others praise but this peer finds broken still loses', () => {
  const book = new RelayScoreBook({ storage: null });
  const id = hex();
  for (let i = 0; i < 3; i += 1) book.recordJoin(id, { ok: false });
  book.mergeShared('liar', [{ nodeId: id, joinMs: 10, attempts: 3, failures: 0, at: Date.now() }]);
  const m = book.measurement(id);
  assert.equal(m.attempts, 3 * 3 + 3);
  assert.equal(m.failures, 9);
  assert.ok(m.failures / m.attempts > 0.5);
});

test('shared scores are bounded, validated, and stale ones ignored', () => {
  let now = 1_000_000_000;
  const book = new RelayScoreBook({ storage: null, now: () => now });
  const id = hex();
  book.mergeShared('p1', [
    { nodeId: id, joinMs: 200, attempts: 2, failures: 9, at: now },
    { nodeId: 'not-an-id', joinMs: 1, attempts: 1, failures: 0, at: now },
  ]);
  const m = book.measurement(id);
  assert.equal(m.failures, 2, 'failures cannot exceed attempts');
  now += 25 * 60 * 60_000;
  assert.equal(book.measurement(id), null, 'a day-old score is forgotten');
});

test('scores persist, so a returning peer starts from what worked', () => {
  const values = new Map();
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const id = hex();
  const first = new RelayScoreBook({ storage });
  first.recordJoin(id, { ok: true, joinMs: 250 });
  first.mergeShared('neighbour', [{ nodeId: id, joinMs: 300, attempts: 1, failures: 0, at: Date.now() }]);
  const second = new RelayScoreBook({ storage });
  const m = second.measurement(id);
  assert.ok(m);
  assert.equal(m.attempts, 1 * 3 + 1);
  assert.deepEqual(second.ownScores().map((s) => s.nodeId), [id]);
  values.set('peerpigeon:relay-scores:v1', '{not json');
  assert.doesNotThrow(() => new RelayScoreBook({ storage }));
});

test('discovery chooses for the room when given one, from the registry\'s kinds and pointers', async () => {
  const localId = hex();
  const relays = await discoverClosestSignalingServers({
    bootstrapServer: 'wss://peer.ooo/ws',
    peerId: hex(),
    fallbackServers: [],
    network: room.network,
    room: room.room,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { relays: [
          { url: 'wss://peer.ooo/ws', node_id: hex(), relay_kind: 'cloud' },
          { url: `wss://peer.ooo/t/${localId}/ws`, node_id: localId, relay_kind: 'local', reach: [{ via: 'punch', url: `https://peer.ooo/t/${localId}/api/v1/punch/offer` }] },
        ] };
      },
    }),
  });
  assert.equal(relays[0], `wss://peer.ooo/t/${localId}/ws`);
});

test('relay scores a neighbour shares go to the score book, never to the application', async () => {
  const { PeerPigeonNode } = await import('../dist/index.js');
  const node = new PeerPigeonNode({ crypto: false, networkId: 'n', sessionId: 's', signalingServer: 'ws://127.0.0.1:9/ws' });
  const seen = [];
  node.on('message', (event) => seen.push(event));
  const id = hex();
  try {
    node.gossip['emit']('directMessageReceived', {
      message: { id: 'm1', from: 'neighbour', to: 'me', hops: 1, data: { __ppType: 'pp-relay-scores', scores: [{ nodeId: id, joinMs: 150, attempts: 2, failures: 0, at: Date.now() }] } },
    });
    assert.equal(seen.length, 0);
    assert.equal(node.mesh.getRelayScores().measurement(id)?.joinMs, 150);
  } finally {
    await node.destroy();
  }
});
