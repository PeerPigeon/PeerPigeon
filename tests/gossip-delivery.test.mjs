import assert from 'node:assert/strict';
import test from 'node:test';

import { GossipProtocol, PartialMesh } from '../dist/index.js';
import {
  isInternalChatText,
  isInternalMessagePayload,
  normalizeMessagePayload,
} from '../examples/vue3/src/message-payloads.js';

class DeliveryTestNetwork {
  constructor(ids) {
    this.meshes = new Map(ids.map((id) => [id, new DeliveryTestMesh(id, this)]));
    this.frames = [];
    this.dropNextGossip = null;
  }

  deliver(from, to, raw) {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const envelope = JSON.parse(text);
    this.frames.push({ from, to, type: envelope.type, envelope });
    if (
      envelope.type === 'gossip' &&
      this.dropNextGossip?.from === from &&
      this.dropNextGossip?.to === to
    ) {
      this.dropNextGossip = null;
      return;
    }
    this.meshes.get(to)?.emit('peer:data', { peerId: from, data: text });
  }
}

class DeliveryTestMesh {
  constructor(id, network) {
    this.id = id;
    this.network = network;
    this.connected = [];
    this.global = [];
    this.handlers = new Map();
  }

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  emit(event, payload) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  getClientId() { return this.id; }
  getConnectedPeers() { return [...this.connected]; }
  getDiscoveredPeers() { return [...this.global]; }
  getGlobalPeers() { return [...this.global]; }
  send(peerId, data) { this.network.deliver(this.id, peerId, data); }
}

function makeProtocols(ids, edges) {
  const network = new DeliveryTestNetwork(ids);
  for (const id of ids) {
    const mesh = network.meshes.get(id);
    mesh.global = ids.filter((peerId) => peerId !== id);
    mesh.connected = edges.get(id) ?? [];
  }
  const protocols = new Map(ids.map((id) => [
    id,
    new GossipProtocol(network.meshes.get(id), {
      deliveryTimeoutMs: 10_000,
      deliveryRepairDelayMs: 1_000,
      deliveryRepairIntervalMs: 1_000,
    }),
  ]));
  return { network, protocols };
}

function destroyProtocols(protocols) {
  for (const protocol of protocols.values()) protocol.destroy();
}

function publishReceipt(protocol) {
  protocol.publishCecrState();
}

function maintainDeliveries(protocol, now) {
  protocol.maintainTrackedDeliveries(now);
}

test('tracked gossip aggregates receipts in CECR frames without ACK packets', () => {
  const { network, protocols } = makeProtocols(
    ['01', '02', '03'],
    new Map([
      ['01', ['02']],
      ['02', ['01', '03']],
      ['03', ['02']],
    ]),
  );
  try {
    let completion = null;
    protocols.get('01').on('deliveryComplete', (status) => { completion = status; });
    const messageId = protocols.get('01').broadcastReliable('hello');

    publishReceipt(protocols.get('03'));
    publishReceipt(protocols.get('02'));
    publishReceipt(protocols.get('01'));

    const status = protocols.get('01').getDeliveryStatus(messageId);
    assert.equal(status.complete, true);
    assert.equal(status.deliveredCount, 2);
    assert.equal(status.audienceCount, 2);
    assert.equal(completion?.messageId, messageId);
    assert.equal(network.frames.some((frame) => frame.type === 'direct'), false);
    assert.equal(network.frames.every((frame) => frame.type === 'gossip' || frame.type === 'cecr-state'), true);
  } finally {
    destroyProtocols(protocols);
  }
});

test('ordinary broadcast remains untracked', () => {
  const { protocols } = makeProtocols(
    ['01', '02'],
    new Map([
      ['01', ['02']],
      ['02', ['01']],
    ]),
  );
  try {
    const messageId = protocols.get('01').broadcast('untracked');
    assert.equal(protocols.get('01').getDeliveryStatus(messageId), null);
  } finally {
    destroyProtocols(protocols);
  }
});

test('a deterministic holder repairs one missed gossip delivery', () => {
  const { network, protocols } = makeProtocols(
    ['01', '02', '03'],
    new Map([
      ['01', ['02']],
      ['02', ['01', '03']],
      ['03', ['02']],
    ]),
  );
  try {
    network.dropNextGossip = { from: '02', to: '03' };
    const messageId = protocols.get('01').broadcastReliable('repair-me');

    publishReceipt(protocols.get('02'));
    const repairAt = Date.now() + 1_500;
    for (const protocol of protocols.values()) maintainDeliveries(protocol, repairAt);
    publishReceipt(protocols.get('03'));
    publishReceipt(protocols.get('02'));
    publishReceipt(protocols.get('01'));

    const status = protocols.get('01').getDeliveryStatus(messageId);
    assert.equal(status.complete, true);
    assert.deepEqual(status.pendingPeerIds, []);
    assert.equal(network.frames.some((frame) => frame.type === 'direct'), true);
  } finally {
    destroyProtocols(protocols);
  }
});

test('tracked gossip reports timeout for a known offline peer', () => {
  const { protocols } = makeProtocols(
    ['01', '02', '03'],
    new Map([
      ['01', ['02']],
      ['02', ['01']],
      ['03', []],
    ]),
  );
  try {
    let timeout = null;
    protocols.get('01').on('deliveryTimeout', (status) => { timeout = status; });
    const messageId = protocols.get('01').broadcastReliable('timeout', {}, { deliveryTimeoutMs: 2_000 });
    publishReceipt(protocols.get('02'));
    maintainDeliveries(protocols.get('01'), Date.now() + 3_000);

    assert.equal(timeout?.messageId, messageId);
    assert.equal(timeout?.timedOut, true);
    assert.equal(timeout?.complete, false);
    assert.deepEqual(timeout?.pendingPeerIds, ['03']);
  } finally {
    destroyProtocols(protocols);
  }
});

test('receipt control fallback supports non-hex peer IDs', () => {
  const { protocols } = makeProtocols(
    ['node-a', 'node-b'],
    new Map([
      ['node-a', ['node-b']],
      ['node-b', ['node-a']],
    ]),
  );
  try {
    const messageId = protocols.get('node-a').broadcastReliable('hello');
    publishReceipt(protocols.get('node-b'));
    assert.equal(protocols.get('node-a').getDeliveryStatus(messageId)?.complete, true);
  } finally {
    destroyProtocols(protocols);
  }
});

test('repair envelopes never surface as direct messages, including JSON-string payloads', () => {
  const { network, protocols } = makeProtocols(
    ['01', '02'],
    new Map([
      ['01', ['02']],
      ['02', ['01']],
    ]),
  );
  try {
    const messageId = protocols.get('01').broadcastReliable('hello');
    const gossipMessage = network.frames.find((frame) => frame.type === 'gossip')?.envelope;
    assert.ok(gossipMessage);

    let leakedDirectMessages = 0;
    protocols.get('02').on('directMessageReceived', () => { leakedDirectMessages += 1; });
    protocols.get('01').sendDirect('02', JSON.stringify({
      __peerPigeonType: 'pp-gossip-repair-v1',
      message: gossipMessage,
    }));

    assert.equal(protocols.get('02').getDeliveryStatus(messageId)?.complete, true);
    assert.equal(leakedDirectMessages, 0);
  } finally {
    destroyProtocols(protocols);
  }
});

test('the chat boundary hides reserved protocol payloads but keeps user transports', () => {
  const repair = {
    __peerPigeonType: 'pp-gossip-repair-v1',
    message: { type: 'gossip' },
  };
  assert.equal(isInternalMessagePayload(repair), true);
  assert.equal(isInternalMessagePayload(JSON.stringify(repair)), true);
  assert.equal(isInternalMessagePayload({ __ppType: 'pp-storage-sync-v1' }), true);
  assert.equal(isInternalMessagePayload({ __ppType: 'pp-crypto-public-info-v1' }), true);
  assert.equal(isInternalMessagePayload({ __ppType: 'pp-encrypted-direct-v1' }), false);
  assert.equal(isInternalChatText(`[DM] ${JSON.stringify(repair)}`), true);
  assert.deepEqual(normalizeMessagePayload('{"hello":"world"}'), { hello: 'world' });
  assert.equal(isInternalMessagePayload('ordinary chat'), false);
});

test('mixed-capacity dialing prioritizes underfilled low-max peers first', () => {
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 20,
    tolerantPeers: 3,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    const now = Date.now();
    mesh.mergeMembership(
      ['low', 'high', 'full', 'unknown'],
      [],
      {
        low: [2, 1, now],
        high: [20, 1, now],
        full: [2, 2, now],
      },
      'relay',
    );

    const ordered = ['unknown', 'full', 'high', 'low']
      .sort((a, b) => mesh.compareDialCandidates(a, b));
    assert.deepEqual(ordered, ['low', 'high', 'unknown', 'full']);
  } finally {
    mesh.destroy();
  }
});

test('tolerant peers never raises the retained degree above maxPeers', () => {
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    tolerantPeers: 10,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    for (const [peerId, connectedAt] of [['old-a', 1], ['old-b', 2], ['newest', 3]]) {
      mesh.peers.set(peerId, { id: peerId, connected: true, initiator: false });
      mesh.peerConnectedAtMs.set(peerId, connectedAt);
    }

    mesh.trimExcessPeers();

    assert.equal(mesh.getConnectedPeerCount(), 2);
    assert.equal(mesh.getConnectedPeers().includes('newest'), false);
  } finally {
    mesh.destroy();
  }
});
