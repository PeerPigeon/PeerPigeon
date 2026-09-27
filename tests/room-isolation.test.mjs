import assert from 'node:assert/strict';
import test from 'node:test';
import { PeerPigeonCryptoProtocol } from '../dist/index.js';

// Two crypto endpoints on one gossip mesh, exactly as GossipProtocol delivers:
// a broadcast reaches every node, whichever room it was meant for.
function makeMesh(id) {
  const listeners = new Map();
  return {
    id,
    on(event, cb) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(cb); },
    off(event, cb) { listeners.get(event)?.delete(cb); },
    emit(event, data) { for (const cb of listeners.get(event) ?? []) cb(data); },
    getClientId() { return id; },
    getConnectedPeers() { return []; },
  };
}

function makeGossip(id) {
  const listeners = new Map();
  const g = {
    id,
    other: null,
    on(event, cb) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(cb); },
    off(event, cb) { listeners.get(event)?.delete(cb); },
    emit(event, data) { for (const cb of listeners.get(event) ?? []) cb(data); },
    broadcast(data) {
      const id2 = Math.random().toString(36).slice(2);
      queueMicrotask(() => g.other?.emit('messageReceived', {
        message: { data, id: id2, sender: g.id }, local: false, fromPeer: g.id,
      }));
      return id2;
    },
    sendDirect() { return 'direct'; },
  };
  return g;
}

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

test('a broadcast for another room is counted, never reported as an error', async () => {
  const meshA = makeMesh('peer-a');
  const meshB = makeMesh('peer-b');
  const gossipA = makeGossip('peer-a');
  const gossipB = makeGossip('peer-b');
  gossipA.other = gossipB;
  gossipB.other = gossipA;

  const ours = new PeerPigeonCryptoProtocol(meshA, gossipA, { roomId: 'room-one', roomSecret: 'secret-one' });
  const theirs = new PeerPigeonCryptoProtocol(meshB, gossipB, { roomId: 'room-two', roomSecret: 'secret-two' });
  await ours.init();
  await theirs.init();
  try {
    const errors = [];
    const delivered = [];
    theirs.on('error', (error) => errors.push(error));
    theirs.on('encryptedBroadcastReceived', (data) => delivered.push(data.plaintext));

    // Gossip floods every node, so a node in a different room sees this and
    // can make nothing of it. That is the transport working, not a failure:
    // it used to raise one node error per frame, tens of thousands of them,
    // naming neither the sender nor the room.
    await ours.broadcastEncrypted('for room one only');
    await settle();

    assert.deepEqual(errors, [], 'a frame for another room raised no error');
    assert.deepEqual(delivered, [], 'and was not delivered as if it had opened');
    assert.equal(theirs.getForeignBroadcastCount(), 1, 'it was counted instead');

    // The room it IS for still receives it, so quieting the failure did not
    // quiet the success.
    const mine = [];
    ours.on('encryptedBroadcastReceived', (data) => mine.push(data.plaintext));
    await theirs.broadcastEncrypted('for room two only');
    await settle();
    assert.deepEqual(mine, [], 'room one cannot read room two either');
    assert.equal(ours.getForeignBroadcastCount(), 1);
  } finally {
    ours.destroy();
    theirs.destroy();
  }
});

test('a broadcast for this room is delivered and counted against nothing', async () => {
  const meshA = makeMesh('peer-a');
  const meshB = makeMesh('peer-b');
  const gossipA = makeGossip('peer-a');
  const gossipB = makeGossip('peer-b');
  gossipA.other = gossipB;
  gossipB.other = gossipA;

  const options = { roomId: 'shared-room', roomSecret: 'shared-secret' };
  const a = new PeerPigeonCryptoProtocol(meshA, gossipA, options);
  const b = new PeerPigeonCryptoProtocol(meshB, gossipB, options);
  await a.init();
  await b.init();
  try {
    const errors = [];
    const delivered = [];
    b.on('error', (error) => errors.push(error));
    b.on('encryptedBroadcastReceived', (data) => delivered.push(data.plaintext));

    await a.broadcastEncrypted('hello room');
    await settle();

    assert.deepEqual(errors, []);
    assert.deepEqual(delivered, ['hello room']);
    assert.equal(b.getForeignBroadcastCount(), 0);
  } finally {
    a.destroy();
    b.destroy();
  }
});
