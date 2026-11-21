import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRandomPair } from 'unsea';
import { PeerPigeonStorage } from '../dist/index.js';

// Gossip endpoints wired together (as in storage-signed.test.mjs), each one able to go away: while
// `away`, nothing it sends or is sent arrives.
function net() {
  const peers = new Map();
  const make = (id) => {
    const listeners = new Map();
    const g = {
      id, away: false,
      on(e, cb) { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(cb); },
      off(e, cb) { listeners.get(e)?.delete(cb); },
      emit(e, d) { for (const cb of listeners.get(e) ?? []) cb(d); },
      broadcast(data) {
        if (g.away) return 'm';
        for (const [pid, other] of peers) if (pid !== id && !other.away) queueMicrotask(() => other.emit('messageReceived', { message: { data, id: Math.random() }, local: false, fromPeer: id }));
        return 'm';
      },
      sendDirect(to, data) {
        const o = peers.get(to);
        if (!o || g.away || o.away) return null;
        queueMicrotask(() => o.emit('directMessageReceived', { message: { data, from: id, to } }));
        return 'd';
      },
    };
    peers.set(id, g);
    return g;
  };
  return { make, peers };
}
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const opts = { sessionId: 'deletes', syncSecret: 'room-secret', replicate: ['pf/'] };

async function node(n, id, keys) {
  const s = new PeerPigeonStorage({ ...opts, userId: `user-${id}`, peerId: id, gossip: n.make(id), signingKeys: keys });
  await s.init();
  return s;
}
/** Two peers link up: both send their digest, as the mesh does. */
function link(n, x, y) {
  n.peers.get(x).emit('peerConnected', { peerId: y });
  n.peers.get(y).emit('peerConnected', { peerId: x });
}

test('a post deleted while a peer was away stays deleted when that peer comes back', async () => {
  const n = net();
  const [ka, kb, kc] = [await generateRandomPair(), await generateRandomPair(), await generateRandomPair()];
  const a = await node(n, 'a', ka);
  const b = await node(n, 'b', kb);
  const c = await node(n, 'c', kc);
  try {
    await a.put('user', 'pf/p/1', { text: 'old post' });
    await settle();
    assert.equal((await b.get('user', 'pf/p/1'))?.value?.text, 'old post');
    assert.equal((await c.get('user', 'pf/p/1'))?.value?.text, 'old post');

    // C goes away; A deletes the post; B hears it.
    n.peers.get('c').away = true;
    await a.delete('user', 'pf/p/1');
    await settle();
    assert.equal(await a.get('user', 'pf/p/1'), null);
    assert.equal(await b.get('user', 'pf/p/1'), null);
    assert.ok(await c.get('user', 'pf/p/1'), 'C, away, still has it');

    // C comes back and links to B (A is gone by then).
    n.peers.get('a').away = true;
    n.peers.get('c').away = false;
    link(n, 'b', 'c');
    await settle(250);
    assert.equal(await b.get('user', 'pf/p/1'), null, 'C did not bring it back to B');
    assert.equal(await c.get('user', 'pf/p/1'), null, 'C was told it was deleted, and deleted it');

    // A later copy of the old post, from anywhere, is refused.
    n.peers.get('a').away = false;
    link(n, 'a', 'c');
    link(n, 'a', 'b');
    await settle(250);
    for (const s of [a, b, c]) assert.equal(await s.get('user', 'pf/p/1'), null);
  } finally {
    await a.close(); await b.close(); await c.close();
  }
});

test('a peer that never had the post still refuses it after the delete', async () => {
  const n = net();
  const [ka, kc, kd] = [await generateRandomPair(), await generateRandomPair(), await generateRandomPair()];
  const a = await node(n, 'a', ka);
  const c = await node(n, 'c', kc);
  try {
    await a.put('user', 'pf/p/2', { text: 'post' });
    await settle();
    n.peers.get('c').away = true;
    await a.delete('user', 'pf/p/2');
    await settle();
    // D joins after the delete: it hears of it from A, without ever holding the post.
    const d = await node(n, 'd', kd);
    try {
      link(n, 'a', 'd');
      await settle();
      n.peers.get('a').away = true;
      n.peers.get('c').away = false;
      link(n, 'c', 'd');
      await settle(250);
      assert.equal(await d.get('user', 'pf/p/2'), null, 'D did not take the old post from C');
    } finally { await d.close(); }
  } finally {
    await a.close(); await c.close();
  }
});

test('only the owner\'s delete counts, and the owner can post again under the key', async () => {
  const n = net();
  const [ka, kb] = [await generateRandomPair(), await generateRandomPair()];
  const a = await node(n, 'a', ka);
  const b = await node(n, 'b', kb);
  try {
    await a.put('user', 'pf/p/3', { text: 'mine' });
    await settle();
    await assert.rejects(b.delete('user', 'pf/p/3'));
    await settle();
    assert.ok(await a.get('user', 'pf/p/3'), 'B cannot delete A\'s post');

    await a.delete('user', 'pf/p/3');
    await settle();
    await a.put('user', 'pf/p/3', { text: 'again' });
    await settle();
    assert.equal((await b.get('user', 'pf/p/3'))?.value?.text, 'again', 'a newer write by the owner is taken');
  } finally {
    await a.close(); await b.close();
  }
});
