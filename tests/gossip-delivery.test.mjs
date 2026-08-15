import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GossipProtocol,
  PartialMesh,
  PeerPigeonCryptoProtocol,
  PeerPigeonNode,
} from '../dist/index.js';
import { generateRandomPair } from 'unsea';
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

test('tracked gossip aggregates receipts in the CECR-DR extension without ACK packets', () => {
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
    assert.equal(
      network.frames.every((frame) => ['gossip', 'cecr-state', 'cecr-dr'].includes(frame.type)),
      true,
    );
    assert.equal(network.frames.some((frame) => frame.type === 'cecr-dr'), true);
    assert.equal(
      network.frames.some((frame) => frame.type === 'cecr-state' && 'receipts' in frame.envelope),
      false,
    );
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

test('a late or previously inactive peer recovers a recent ordinary broadcast through epidemic anti-entropy', () => {
  const { network, protocols } = makeProtocols(
    ['01', '02', '03'],
    new Map([
      ['01', ['02']],
      ['02', ['01']],
      ['03', []],
    ]),
  );
  try {
    const received = [];
    protocols.get('03').on('messageReceived', ({ message, local }) => {
      if (!local) received.push(message);
    });

    const messageId = protocols.get('01').broadcast('sent-while-03-was-inactive');
    assert.deepEqual(received, []);

    network.meshes.get('02').connected = ['01', '03'];
    network.meshes.get('03').connected = ['02'];
    network.meshes.get('02').emit('peer:connected', '03');

    assert.equal(received.length, 1);
    assert.equal(received[0].id, messageId);
    assert.equal(received[0].data, 'sent-while-03-was-inactive');
    assert.equal(
      network.frames.some((frame) => frame.type === 'gossip-ae' && frame.envelope.mode === 'summary'),
      true,
    );
    assert.equal(
      network.frames.some((frame) => frame.type === 'gossip-ae' && frame.envelope.mode === 'request'),
      true,
    );

    network.meshes.get('02').emit('peer:connected', '03');
    assert.equal(received.length, 1);
  } finally {
    destroyProtocols(protocols);
  }
});

test('a deterministic holder repairs one missed gossip delivery', () => {
  const first = '0'.repeat(63) + '1';
  const second = '0'.repeat(63) + '2';
  const third = '0'.repeat(63) + '3';
  const { network, protocols } = makeProtocols(
    [first, second, third],
    new Map([
      [first, [second]],
      [second, [first, third]],
      [third, [second]],
    ]),
  );
  try {
    network.dropNextGossip = { from: second, to: third };
    const messageId = protocols.get(first).broadcastReliable('repair-me');

    publishReceipt(protocols.get(second));
    const repairAt = Date.now() + 1_500;
    for (const protocol of protocols.values()) maintainDeliveries(protocol, repairAt);
    publishReceipt(protocols.get(third));
    publishReceipt(protocols.get(second));
    publishReceipt(protocols.get(first));

    const status = protocols.get(first).getDeliveryStatus(messageId);
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

test('mesh exposes capacity, slots, graph edges, and runtime configuration', () => {
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    tolerantPeers: 0,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    const now = Date.now();
    mesh.clientId = '00';
    mesh.selfAliases.add('00');
    mesh.peers.set('01', { id: '01', connected: true, initiator: false });
    mesh.discoveredPeers.add('08');
    mesh.mergeMembership(
      ['01', '08'],
      [],
      { '01': [2, 1, now], '08': [20, 1, now] },
      { '01': [['00', '08'], now], '08': [['01'], now] },
      '01',
    );

    assert.equal(mesh.getPeerCapacity('01').availableSlots, 1);
    assert.equal(mesh.getPeerCapacity('08').availableSlots, 19);
    assert.equal(mesh.getPeerCapacity('00').availableSlots, 1);

    const graph = mesh.getGraphSnapshot();
    assert.deepEqual(graph.nodes.map((node) => node.peerId), ['00', '01', '08']);
    assert.deepEqual(graph.edges.map((edge) => [edge.source, edge.target]), [['00', '01'], ['01', '08']]);
    assert.equal(graph.complete, true);
    assert.equal(graph.nodes.find((node) => node.peerId === '00').hopDistance, 0);
    assert.equal(graph.nodes.find((node) => node.peerId === '01').hopDistance, 1);
    assert.equal(graph.nodes.find((node) => node.peerId === '08').hopDistance, 2);
    assert.equal(mesh.getHopDistance('08'), 2);
    assert.equal(graph.nodes.find((node) => node.peerId === '01').xorDistance, '0x1');
    assert.equal(graph.nodes.find((node) => node.peerId === '01').xorDistanceRank, 0);
    assert.equal(graph.nodes.find((node) => node.peerId === '01').xorDistanceRatio, 0);
    assert.equal(graph.nodes.find((node) => node.peerId === '08').xorDistance, '0x8');
    assert.equal(graph.nodes.find((node) => node.peerId === '08').xorDistanceRank, 1);
    assert.equal(graph.nodes.find((node) => node.peerId === '08').xorDistanceRatio, 1);
    assert.equal(mesh.getXorDistance('08'), '0x8');

    const updated = mesh.updateConfig({ maxPeers: 3, tolerantPeers: 2 });
    assert.equal(updated.maxPeers, 3);
    assert.equal(updated.tolerantPeers, 2);
  } finally {
    mesh.destroy();
  }
});

test('stale capacity and topology cannot manufacture a phantom graph peer', () => {
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    const now = Date.now();
    mesh.clientId = '00';
    mesh.selfAliases.add('00');
    mesh.peers.set('01', { id: '01', connected: true, initiator: false });
    mesh.peerCapacityById.set('ghost', { maxPeers: 10, connectedPeers: 1, updatedAt: now });
    mesh.peerTopologyById.set('01', { connectedPeerIds: ['00', 'ghost'], updatedAt: now });
    mesh.peerTopologyById.set('ghost', { connectedPeerIds: ['01'], updatedAt: now });

    const graph = mesh.getGraphSnapshot();
    assert.deepEqual(graph.nodes.map((node) => node.peerId), ['00', '01']);
    assert.deepEqual(graph.edges.map((edge) => [edge.source, edge.target]), [['00', '01']]);
    assert.equal(graph.nodes.some((node) => node.peerId === 'ghost'), false);
  } finally {
    mesh.destroy();
  }
});

test('tolerantPeers is a real temporary connected-plus-pending overflow budget', () => {
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    tolerantPeers: 0,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    mesh.clientId = '00';
    mesh.selfAliases.add('00');
    mesh.discoveredPeers.add('ff');
    mesh.peers.set('01', { id: '01', connected: true, initiator: false });
    mesh.peers.set('02', { id: '02', connected: true, initiator: false });
    mesh.signalingClient = {
      isConnected: () => true,
      nudgeSignaling() {},
      initiateConnection: () => new Promise(() => {}),
      closeConnection() {},
      disconnect() {},
      client: { mesh: { connections: new Map() } },
    };

    mesh.connectToPeerInternal('ff', true);
    assert.equal(mesh.connecting.has('ff'), false);

    mesh.updateConfig({ tolerantPeers: 1 });
    mesh.connectToPeerInternal('ff', true);
    assert.equal(mesh.connecting.has('ff'), true);
  } finally {
    mesh.destroy();
  }
});

test('an isolated mesh redials an orphan only after FreeRTC exhausts offer recovery', () => {
  const self = '0'.repeat(63) + '1';
  const target = '0'.repeat(63) + '2';
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    autoDiscover: false,
    autoConnect: false,
    connectionTimeoutMs: 45_000,
  });
  const connections = new Map([[target, {
    state: 'connected',
    lastSeen: Date.now() - 46_000,
    connection: { connectionState: 'connected', signalingState: 'stable' },
    channel: { readyState: 'connecting' },
  }]]);
  const closed = [];
  const dials = [];
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.discoveredPeers.add(target);
    mesh.discoveredAtMs.set(target, Date.now() - 20_000);
    mesh.signalingClient = {
      isConnected: () => true,
      nudgeSignaling() {},
      initiateConnection(peerId) {
        dials.push(peerId);
        return new Promise(() => {});
      },
      closeConnection(peerId) {
        closed.push(peerId);
        connections.delete(peerId);
      },
      disconnect() {},
      client: { mesh: { connections } },
    };

    mesh.maintainPeerConnections();

    assert.deepEqual(closed, [target]);
    assert.deepEqual(dials, [target]);
    assert.equal(mesh.connecting.has(target), true);
  } finally {
    mesh.destroy();
  }
});

test('repeated signaling cannot keep an isolated orphan negotiation alive forever', () => {
  const self = '0'.repeat(63) + '1';
  const target = '0'.repeat(63) + '2';
  const now = Date.now();
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    autoDiscover: false,
    autoConnect: false,
    connectionTimeoutMs: 45_000,
  });
  const entry = {
    state: 'connecting',
    lastSeen: now,
    connection: { connectionState: 'connecting', signalingState: 'stable' },
    channel: { readyState: 'connecting' },
  };
  const connections = new Map([[target, entry]]);
  const closed = [];
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.discoveredPeers.add(target);
    mesh.signalingClient = {
      closeConnection(peerId) {
        closed.push(peerId);
        connections.delete(peerId);
      },
      disconnect() {},
      client: { mesh: { connections } },
    };

    mesh.recoverOrphanedRtcNegotiations(now);
    // A retry packet refreshes FreeRTC's activity timestamp, but it does not
    // reset the independent deadline for opening a usable data channel.
    entry.lastSeen = now + 46_000;
    mesh.recoverOrphanedRtcNegotiations(now + 46_000);

    assert.deepEqual(closed, [target]);
  } finally {
    mesh.destroy();
  }
});

test('resume gives FreeRTC a restore grace instead of immediately redialing', () => {
  const self = '0'.repeat(63) + '1';
  const target = '0'.repeat(63) + '2';
  const connections = new Map([[target, {
    state: 'connecting',
    lastSeen: Date.now(),
    connection: { connectionState: 'connecting', signalingState: 'stable' },
    channel: { readyState: 'connecting' },
  }]]);
  const closed = [];
  const dials = [];
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    autoDiscover: false,
    autoConnect: true,
  });
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.discoveredPeers.add(target);
    mesh.dialBackoffUntilMs.set(target, Date.now() + 30_000);
    mesh.signalingClient = {
      isConnected: () => true,
      recoverAfterInactivity: () => false,
      nudgeSignaling() {},
      joinSession() {},
      initiateConnection(peerId) {
        dials.push(peerId);
        return new Promise(() => {});
      },
      closeConnection(peerId) {
        closed.push(peerId);
        connections.delete(peerId);
      },
      disconnect() {},
      client: { mesh: { connections } },
    };

    mesh.recoverAfterInactivity('visible');

    assert.deepEqual(closed, []);
    assert.deepEqual(dials, []);
    assert.equal(mesh.connecting.has(target), false);
    assert.ok(mesh.restoreGraceUntilMs > Date.now());
  } finally {
    mesh.destroy();
  }
});

test('maintenance never destroys a failed transport before FreeRTC restore fails', () => {
  const self = '0'.repeat(63) + '1';
  const target = '0'.repeat(63) + '2';
  const connections = new Map([[target, {
    state: 'failed',
    connection: { connectionState: 'failed', signalingState: 'closed' },
    channel: { readyState: 'closed' },
  }]]);
  const closed = [];
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.peers.set(target, { id: target, connected: true, initiator: true });
    mesh.signalingClient = {
      closeConnection(peerId) {
        closed.push(peerId);
        connections.delete(peerId);
      },
      disconnect() {},
      client: { mesh: { connections } },
    };

    mesh.recoverStaleConnectedPeers('maintenance');

    assert.deepEqual(closed, []);
    assert.equal(mesh.getConnectedPeerCount(), 1);
    assert.equal(connections.has(target), true);
  } finally {
    mesh.destroy();
  }
});

test('isolated recovery refreshes discovery without hard-resetting an active offer', () => {
  const self = 'f'.repeat(64);
  const target = '1'.repeat(64);
  const closed = [];
  let refreshes = 0;
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    autoDiscover: false,
    autoConnect: false,
    underConnectedResetMs: 20_000,
  });
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.discoveredPeers.add(target);
    mesh.peers.set(target, { id: target, connected: false, initiator: true });
    mesh.connecting.add(target);
    mesh.connectionStartedAtMs.set(target, Date.now() - 9_000);
    mesh.dialFailureCount.set(target, 3);
    mesh.signalingClient = {
      isConnected: () => true,
      nudgeSignaling() { refreshes += 1; },
      joinSession() { refreshes += 1; },
      closeConnection(peerId) { closed.push(peerId); },
      disconnect() {},
      client: { mesh: { connections: new Map() } },
    };

    mesh.maybeHardResetUnderConnected();

    assert.deepEqual(closed, []);
    assert.equal(refreshes, 2);
    assert.equal(mesh.peers.has(target), true);
    assert.equal(mesh.connecting.has(target), true);
  } finally {
    mesh.destroy();
  }
});

test('an isolated mesh can redial a live CECR member missing from signaling discovery', () => {
  const self = '0'.repeat(63) + '1';
  const target = '0'.repeat(63) + '2';
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    autoDiscover: false,
    autoConnect: false,
  });
  const dials = [];
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.mergeMembership([target], [], {}, 'relay');
    mesh.signalingClient = {
      isConnected: () => true,
      nudgeSignaling() {},
      initiateConnection(peerId) {
        dials.push(peerId);
        return new Promise(() => {});
      },
      closeConnection() {},
      disconnect() {},
      client: { mesh: { connections: new Map() } },
    };

    assert.deepEqual(mesh.getDiscoveredPeers(), []);
    assert.deepEqual(mesh.getGlobalPeers(), [target]);
    mesh.maintainPeerConnections();

    assert.deepEqual(dials, [target]);
    assert.equal(mesh.connecting.has(target), true);
  } finally {
    mesh.destroy();
  }
});

class CryptoTestMesh {
  constructor(id) {
    this.id = id;
    this.connected = [];
    this.handlers = new Map();
  }
  on(event, handler) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }
  off(event, handler) { this.handlers.get(event)?.delete(handler); }
  getClientId() { return this.id; }
  getConnectedPeers() { return [...this.connected]; }
}

class CryptoTestNetwork {
  constructor(ids) {
    this.gossips = new Map(ids.map((id) => [id, new CryptoTestGossip(id, this)]));
  }
}

class CryptoTestGossip {
  constructor(id, network) {
    this.id = id;
    this.network = network;
    this.handlers = new Map();
    this.sequence = 0;
  }
  on(event, handler) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }
  off(event, handler) { this.handlers.get(event)?.delete(handler); }
  emit(event, value) { for (const handler of this.handlers.get(event) ?? []) handler(value); }
  broadcast(data, metadata = {}) {
    const id = `${this.id}-${++this.sequence}`;
    for (const [peerId, gossip] of this.network.gossips) {
      gossip.emit('messageReceived', {
        message: { id, type: 'gossip', sender: this.id, data, metadata, hops: peerId === this.id ? 0 : 1, maxHops: 5, timestamp: Date.now() },
        local: peerId === this.id,
        ...(peerId === this.id ? {} : { fromPeer: this.id }),
      });
    }
    return id;
  }
  broadcastReliable(data, metadata = {}) { return this.broadcast(data, metadata); }
  sendDirect(target, data) {
    const id = `${this.id}-direct-${++this.sequence}`;
    this.network.gossips.get(target)?.emit('directMessageReceived', {
      message: { id, type: 'direct', from: this.id, to: target, data, hops: 1, maxHops: 20, timestamp: Date.now() },
    });
    return id;
  }
}

test('crypto API exposes room/direct encryption and peer key discovery', async () => {
  const ids = ['alice', 'bob'];
  const network = new CryptoTestNetwork(ids);
  const aliceMesh = new CryptoTestMesh('alice');
  const bobMesh = new CryptoTestMesh('bob');
  aliceMesh.connected = ['bob'];
  bobMesh.connected = ['alice'];
  const alice = new PeerPigeonCryptoProtocol(aliceMesh, network.gossips.get('alice'), {
    roomId: 'network:room', keyPair: await generateRandomPair(), persistKeyPair: false, announceIntervalMs: 0,
  });
  const bob = new PeerPigeonCryptoProtocol(bobMesh, network.gossips.get('bob'), {
    roomId: 'network:room', keyPair: await generateRandomPair(), persistKeyPair: false, announceIntervalMs: 0,
  });
  try {
    await alice.init();
    await bob.init();
    alice.announcePublicKey();
    assert.equal(alice.getPublicKey('bob')?.peerId, 'bob');
    assert.equal(bob.getPublicKey('alice')?.peerId, 'alice');

    const roomCipher = await alice.encryptRoom('hello room');
    assert.equal(await bob.decryptRoom(roomCipher), 'hello room');
    const direct = await alice.createEncryptedDirect('bob', 'hello bob');
    assert.equal(await bob.decryptEncryptedDirect(direct), 'hello bob');
  } finally {
    alice.destroy();
    bob.destroy();
  }
});

test('PeerPigeonNode provides the unified JS API', async () => {
  const node = new PeerPigeonNode({
    minPeers: 1,
    maxPeers: 2,
    tolerantPeers: 1,
    autoDiscover: false,
    autoConnect: false,
    crypto: false,
  });
  try {
    assert.equal(node.mesh instanceof PartialMesh, true);
    assert.equal(node.gossip instanceof GossipProtocol, true);
    assert.equal(node.getConfig().tolerantPeers, 1);
    assert.deepEqual(node.getGraphSnapshot().edges, []);
    assert.deepEqual(node.getPeerCapacities(), []);
    assert.equal(node.getHopDistance('missing'), null);
  } finally {
    await node.destroy();
  }
});
