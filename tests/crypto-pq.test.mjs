import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptMessageWithMeta, generateRandomPair } from 'unsea';
import { PeerPigeonCryptoProtocol } from '../dist/index.js';

// Direct messages are post-quantum hybrid encrypted (unsea 3: ECDH + ML-KEM-768)
// when the recipient announced an ML-KEM key, and ECDH alone otherwise.
function makeMesh(id) {
  const listeners = new Map();
  return {
    on(event, cb) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(cb); },
    off(event, cb) { listeners.get(event)?.delete(cb); },
    getClientId() { return id; },
    getConnectedPeers() { return []; },
  };
}

function makeGossip(id) {
  const listeners = new Map();
  const g = {
    other: null,
    sent: [],
    on(event, cb) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(cb); },
    off(event, cb) { listeners.get(event)?.delete(cb); },
    emit(event, data) { for (const cb of listeners.get(event) ?? []) cb(data); },
    broadcast(data) {
      queueMicrotask(() => g.other?.emit('messageReceived', { message: { data, id: 'b', sender: id }, local: false, fromPeer: id }));
      return 'b';
    },
    sendDirect(to, data) {
      g.sent.push(data);
      queueMicrotask(() => g.other?.emit('directMessageReceived', { message: { data, from: id, to } }));
      return 'd';
    },
  };
  return g;
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function pair(options = {}) {
  const meshA = makeMesh('peer-a');
  const meshB = makeMesh('peer-b');
  const gossipA = makeGossip('peer-a');
  const gossipB = makeGossip('peer-b');
  gossipA.other = gossipB;
  gossipB.other = gossipA;
  const a = new PeerPigeonCryptoProtocol(meshA, gossipA, { roomId: 'r', persistKeyPair: false, announceIntervalMs: 0, ...options.a });
  const b = new PeerPigeonCryptoProtocol(meshB, gossipB, { roomId: 'r', persistKeyPair: false, announceIntervalMs: 0, ...options.b });
  return { a, b, gossipA };
}

test('direct messages between post-quantum peers are hybrid encrypted', async () => {
  const { a, b, gossipA } = pair();
  await a.init();
  await b.init();
  try {
    await settle();
    assert.ok(a.getPublicKey('peer-b')?.kpub, 'b announced its ML-KEM key');
    const got = [];
    b.on('encryptedDirectReceived', (data) => got.push(data.plaintext));
    await a.sendEncryptedDirect('peer-b', 'secret move');
    await settle();
    assert.deepEqual(got, ['secret move']);
    const sent = gossipA.sent.find((p) => p.__ppType === 'pp-encrypted-direct-v1');
    assert.equal(sent.cipher.v, 3);
    assert.ok(sent.cipher.kem);
  } finally {
    a.destroy();
    b.destroy();
  }
});

test('an older key pair is given post-quantum keys; a peer without a kpub still gets ECDH', async () => {
  const old = await generateRandomPair({ postQuantum: false });
  const { a, b } = pair({ b: { keyPair: old } });
  await a.init();
  await b.init();
  try {
    assert.equal(b.getKeyPair().pub, old.pub, 'same identity');
    assert.ok(b.getKeyPair().kpub, 'upgraded');
    // A peer from before (no kpub announced): what a sends it is version 2.
    const legacy = await generateRandomPair({ postQuantum: false });
    const payload = await (async () => {
      a['upsertPublicKey']('peer-old', { __ppType: 'pp-crypto-public-info-v1', from: 'peer-old', pub: legacy.pub, epub: legacy.epub, timestamp: Date.now() });
      return a.createEncryptedDirect('peer-old', 'hello');
    })();
    assert.equal(payload.cipher.v, 2);
    assert.equal(await decryptMessageWithMeta(payload.cipher, legacy.epriv), 'hello');
  } finally {
    a.destroy();
    b.destroy();
  }
});
