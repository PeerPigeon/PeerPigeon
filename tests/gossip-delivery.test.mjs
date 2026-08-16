import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GossipProtocol,
  PartialMesh,
  PeerPigeonCryptoProtocol,
  PeerPigeonNode,
  sha1Hex,
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

test('reverse convergecast confirms a cyclic gossip tree without per-peer receipts', () => {
  const { network, protocols } = makeProtocols(
    ['01', '02', '03', '04'],
    new Map([
      ['01', ['02', '04']],
      ['02', ['01', '03']],
      ['03', ['02', '04']],
      ['04', ['03', '01']],
    ]),
  );
  try {
    const updates = [];
    protocols.get('01').on('aggregateProgress', (status) => updates.push(status));
    const messageId = protocols.get('01').broadcast('aggregate', {}, {
      aggregateDelivery: true,
    });

    const status = protocols.get('01').getAggregateDeliveryStatus(messageId);
    assert.equal(status.confirmedPeerCount, 3);
    assert.equal(status.inferredAudienceCount, 3);
    assert.equal(status.settled, true);
    assert.ok(status.maxConfirmedHops >= 1);
    assert.equal(updates.at(-1)?.confirmedPeerCount, 3);

    const echoes = network.frames.filter((frame) => frame.type === 'gossip-echo');
    const forwarded = network.frames.filter((frame) => frame.type === 'gossip');
    assert.ok(echoes.length > 0);
    assert.ok(echoes.length <= forwarded.length, 'convergecast must not exceed one echo per tree/probe edge');
    for (const { envelope } of echoes) {
      assert.equal(Array.isArray(envelope.peerIds), false);
      assert.equal('bits' in envelope, false);
      assert.equal('receipts' in envelope, false);
      assert.equal(Number.isSafeInteger(envelope.confirmedTotal), true);
    }
    assert.equal(network.frames.some((frame) => frame.type === 'cecr-dr'), false);
  } finally {
    destroyProtocols(protocols);
  }
});

test('reverse aggregate counts recipients missing from the sender membership snapshot', () => {
  const { network, protocols } = makeProtocols(
    ['01', '02', '03', '04'],
    new Map([
      ['01', ['02']],
      ['02', ['01', '03']],
      ['03', ['02', '04']],
      ['04', ['03']],
    ]),
  );
  try {
    // The sender only knows its direct neighbor. The dissemination tree still
    // reaches and aggregates the two peers beyond that incomplete CECR view.
    network.meshes.get('01').global = ['02'];
    const messageId = protocols.get('01').broadcast('unknown audience', {}, {
      aggregateDelivery: true,
    });

    const status = protocols.get('01').getAggregateDeliveryStatus(messageId);
    assert.equal(status.confirmedPeerCount, 3);
    assert.equal(status.inferredAudienceCount, 3);
    assert.equal(status.settled, true);
  } finally {
    destroyProtocols(protocols);
  }
});

test('CECR propagates the confirmed whole-network size beyond the broadcast sender', () => {
  const ids = [1, 2, 3, 4].map((suffix) => `${'0'.repeat(63)}${suffix}`);
  const [first, second, third, fourth] = ids;
  const { network, protocols } = makeProtocols(
    ids,
    new Map([
      [first, [second]],
      [second, [first, third]],
      [third, [second, fourth]],
      [fourth, [third]],
    ]),
  );
  try {
    // No peer begins with a whole-network membership list.
    for (const id of ids) {
      network.meshes.get(id).global = network.meshes.get(id).connected.slice();
    }
    const messageId = protocols.get(first).broadcast('size evidence', {}, {
      aggregateDelivery: true,
    });
    assert.equal(protocols.get(first).getAggregateDeliveryStatus(messageId).confirmedPeerCount, 3);

    publishReceipt(protocols.get(first));
    publishReceipt(protocols.get(second));

    assert.equal(protocols.get(third).getCecrState().size < 4, true);
    assert.equal(protocols.get(third).getCecrState().networkSizeEstimate, 4);
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
    assert.match(messageId, new RegExp(`^${sha1Hex('01')}-[0-9a-f]{32}$`));
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
    assert.equal(received[0].hops, 2);
    assert.deepEqual(received[0].path, ['01', '02', '03'].map(sha1Hex));
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

test('initial epidemic repair has no two-second latency floor', async () => {
  const { network, protocols } = makeProtocols(
    ['01', '02', '03'],
    new Map([
      ['01', ['02']],
      ['02', ['01', '03']],
      ['03', ['02']],
    ]),
  );
  let timeout = null;
  try {
    const startedAt = Date.now();
    const received = new Promise((resolve) => {
      protocols.get('03').on('messageReceived', ({ message, local }) => {
        if (!local && message.data === 'fast-repair') resolve(message);
      });
    });
    const timedOut = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('initial spread repair exceeded one second')), 1_000);
    });

    network.dropNextGossip = { from: '02', to: '03' };
    protocols.get('01').broadcast('fast-repair');
    const message = await Promise.race([received, timedOut]);

    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal(message.hops, 2);
    assert.deepEqual(message.path, ['01', '02', '03'].map(sha1Hex));
  } finally {
    if (timeout) clearTimeout(timeout);
    destroyProtocols(protocols);
  }
});

test('anti-entropy never replays a broadcast into a later membership view', () => {
  const { network, protocols } = makeProtocols(
    ['01', '02', '03'],
    new Map([
      ['01', ['02']],
      ['02', ['01']],
      ['03', []],
    ]),
  );
  try {
    // Peer 03 exists in the harness but is not part of the original CECR view.
    network.meshes.get('01').global = ['02'];
    network.meshes.get('02').global = ['01'];
    network.meshes.get('03').global = [];

    const received = [];
    protocols.get('03').on('messageReceived', ({ message, local }) => {
      if (!local) received.push(message);
    });

    const messageId = protocols.get('01').broadcast('do-not-replay');

    // Joining changes the canonical view. The retained payload must not be
    // advertised or served to the new identity.
    network.meshes.get('01').global = ['02', '03'];
    network.meshes.get('02').global = ['01', '03'];
    network.meshes.get('03').global = ['01', '02'];
    network.meshes.get('02').connected = ['01', '03'];
    network.meshes.get('03').connected = ['02'];
    network.meshes.get('02').emit('peer:connected', '03');

    assert.deepEqual(received, []);
    assert.equal(
      network.frames.some((frame) => frame.to === '03'
        && frame.type === 'gossip'
        && frame.envelope.id === messageId),
      false,
    );
  } finally {
    destroyProtocols(protocols);
  }
});

test('anti-entropy payload eligibility ends with the initial spread deadline', () => {
  const { protocols } = makeProtocols(
    ['01', '02'],
    new Map([
      ['01', ['02']],
      ['02', ['01']],
    ]),
  );
  try {
    const source = protocols.get('01');
    const messageId = source.broadcast('bounded-spread', {}, { deliveryTimeoutMs: 2_000 });
    const sentAt = source.getStats().recentMessages.find((message) => message.id === messageId)?.timestamp;
    assert.equal(Number.isFinite(sentAt), true);
    assert.deepEqual(source.recentRetainedMessageIds('02', sentAt + 1_999), [messageId]);
    assert.deepEqual(source.recentRetainedMessageIds('02', sentAt + 2_001), []);
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
    const repairedDeliveries = [];
    protocols.get(third).on('messageReceived', ({ message, local }) => {
      if (!local && message.data === 'repair-me') repairedDeliveries.push(message);
    });
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
    assert.equal(repairedDeliveries.length, 1);
    assert.equal(repairedDeliveries[0].hops, 2);
    assert.deepEqual(repairedDeliveries[0].path, [first, second, third].map(sha1Hex));
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

test('tolerant overflow retains the degree cap while replacing an old edge', () => {
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
    assert.equal(mesh.getConnectedPeers().includes('newest'), true);
    assert.equal(mesh.getConnectedPeers().includes('old-a'), false);
  } finally {
    mesh.destroy();
  }
});

test('a saturated component preserves a new cross-component bridge and sheds a redundant edge', () => {
  const self = '0'.repeat(64);
  const left = '1'.repeat(64);
  const right = '2'.repeat(64);
  const isolated = 'f'.repeat(64);
  const now = Date.now();
  const closed = [];
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    tolerantPeers: 1,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.mergeMembership(
      [left, right, isolated],
      [],
      {},
      {
        [left]: [[self, right], now],
        [right]: [[self, left], now],
        [isolated]: [[], now],
      },
      left,
    );
    for (const [peerId, connectedAt] of [[left, 1], [right, 2], [isolated, 3]]) {
      mesh.peers.set(peerId, { id: peerId, connected: true, initiator: false });
      mesh.peerConnectedAtMs.set(peerId, connectedAt);
    }
    mesh.signalingClient = {
      closeConnection(peerId) { closed.push(peerId); },
      disconnect() {},
    };

    assert.deepEqual(mesh.localBridgeConnectedPeerIds(), new Set([isolated]));
    mesh.trimExcessPeers();

    assert.equal(mesh.getConnectedPeerCount(), 2);
    assert.equal(mesh.getConnectedPeers().includes(isolated), true);
    assert.equal(closed.includes(isolated), false);
    assert.equal(closed.length, 1);
    assert.equal(mesh.getGraphSnapshot().nodes.every((node) => node.hopDistance != null), true);
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
    const self = '0'.repeat(64);
    const near = `${'0'.repeat(63)}1`;
    const far = `${'0'.repeat(63)}8`;
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.peers.set(near, { id: near, connected: true, initiator: false });
    mesh.discoveredPeers.add(far);
    mesh.mergeMembership(
      [near, far],
      [],
      { [near]: [2, 1, now], [far]: [20, 1, now] },
      { [near]: [[self, far], now], [far]: [[near], now] },
      near,
    );

    assert.equal(mesh.getPeerCapacity(near).availableSlots, 1);
    assert.equal(mesh.getPeerCapacity(far).availableSlots, 19);
    assert.equal(mesh.getPeerCapacity(self).availableSlots, 1);

    const graph = mesh.getGraphSnapshot();
    assert.deepEqual(graph.nodes.map((node) => node.peerId), [self, near, far]);
    assert.deepEqual(graph.edges.map((edge) => [edge.source, edge.target]), [[self, near], [near, far]]);
    assert.equal(graph.complete, true);
    assert.equal(graph.nodes.find((node) => node.peerId === self).hopDistance, 0);
    assert.equal(graph.nodes.find((node) => node.peerId === near).hopDistance, 1);
    assert.equal(graph.nodes.find((node) => node.peerId === far).hopDistance, 2);
    assert.equal(mesh.getHopDistance(far), 2);
    assert.equal(graph.nodes.find((node) => node.peerId === near).xorDistance, '0x1');
    assert.equal(graph.nodes.find((node) => node.peerId === near).xorDistanceRank, 0);
    assert.equal(graph.nodes.find((node) => node.peerId === near).xorDistanceRatio, 0);
    assert.equal(graph.nodes.find((node) => node.peerId === far).xorDistance, '0x8');
    assert.equal(graph.nodes.find((node) => node.peerId === far).xorDistanceRank, 1);
    assert.equal(graph.nodes.find((node) => node.peerId === far).xorDistanceRatio, 1);
    assert.equal(mesh.getXorDistance(far), '0x8');

    const updated = mesh.updateConfig({ maxPeers: 3, tolerantPeers: 2 });
    assert.equal(updated.maxPeers, 3);
    assert.equal(updated.tolerantPeers, 2);
  } finally {
    mesh.destroy();
  }
});

test('live CECR membership retains unchanged topology beyond peer-state cache age', () => {
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    peerStateMaxAgeMs: 1_000,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    const now = Date.now();
    const unchangedSince = now - 10_000;
    const self = '0'.repeat(64);
    const near = `${'0'.repeat(63)}1`;
    const far = `${'0'.repeat(63)}8`;
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.peers.set(near, { id: near, connected: true, initiator: false });
    mesh.mergeMembership(
      [near, far],
      [],
      {},
      {
        [near]: [[self, far], unchangedSince],
        [far]: [[near], unchangedSince],
      },
      near,
    );

    const graph = mesh.getGraphSnapshot();
    assert.deepEqual(graph.nodes.map((node) => node.peerId), [self, near, far]);
    assert.deepEqual(graph.edges.map((edge) => [edge.source, edge.target]), [
      [self, near],
      [near, far],
    ]);
    assert.equal(graph.complete, true);
    assert.equal(graph.nodes.find((node) => node.peerId === far).hopDistance, 2);
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

test('remote CECR topology cannot resurrect a closed edge to the local peer', () => {
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    const now = Date.now();
    const self = '0'.repeat(64);
    const peer = `${'0'.repeat(63)}1`;
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.mergeMembership([peer], [], {}, { [peer]: [[self], now] }, peer);

    const graph = mesh.getGraphSnapshot();
    assert.deepEqual(graph.nodes.map((node) => node.peerId), [self, peer]);
    assert.deepEqual(graph.edges, []);
    assert.equal(graph.nodes.find((node) => node.peerId === peer).hopDistance, null);
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

test('resume clears every recovery backoff without resetting an active negotiation deadline', () => {
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
  const originalStartedAt = Date.now() - 5_000;
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
    mesh.connectionStartedAtMs.set(target, originalStartedAt);
    mesh.dialFailureCount.set(target, 4);
    mesh.dialBackoffUntilMs.set(target, Date.now() + 30_000);
    mesh.rebalanceAttemptAtMs.set(target, Date.now());
    mesh.rebalanceCooldownUntilMs = Date.now() + 30_000;
    mesh.lastUnderConnectedRecoveryAtMs = Date.now();
    mesh.lastDiscoveryRefreshAtMs = Date.now();
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
    assert.equal(mesh.connectionStartedAtMs.get(target), originalStartedAt);
    assert.equal(mesh.dialFailureCount.size, 0);
    assert.equal(mesh.dialBackoffUntilMs.size, 0);
    assert.equal(mesh.rebalanceAttemptAtMs.size, 0);
    assert.equal(mesh.rebalanceCooldownUntilMs, 0);
    assert.equal(mesh.lastUnderConnectedRecoveryAtMs, 0);
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

test('a current relay snapshot replaces a pending dial to a suspended peer', () => {
  const self = '0'.repeat(64);
  const suspended = '1'.repeat(64);
  const active = '2'.repeat(64);
  const connections = new Map([[suspended, {
    state: 'connecting',
    connection: { connectionState: 'connecting', signalingState: 'have-local-offer' },
    channel: { readyState: 'connecting' },
  }]]);
  const closed = [];
  const dials = [];
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    tolerantPeers: 1,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.discoveredPeers.add(suspended);
    mesh.peers.set(suspended, { id: suspended, connected: false, initiator: true });
    mesh.connecting.add(suspended);
    mesh.connectionStartedAtMs.set(suspended, Date.now());
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

    // The grace-preserved list still contains the suspended peer, while the
    // un-graced relay snapshot contains only the peer that is currently alive.
    mesh.reconcileSignalingPeers([suspended, active], [active]);
    assert.deepEqual(closed, [suspended]);
    assert.equal(mesh.peers.has(suspended), false);
    assert.deepEqual(mesh.dialCandidatePeerIds(true), [active]);

    mesh.maintainPeerConnections();
    assert.deepEqual(dials, [active]);
  } finally {
    mesh.destroy();
  }
});

test('relay discovery does not become graph membership until CECR confirms it', () => {
  const self = '0'.repeat(64);
  const ghost = '1'.repeat(64);
  const active = '2'.repeat(64);
  const mesh = new PartialMesh({
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.reconcileSignalingPeers([ghost, active], [active]);

    assert.deepEqual(new Set(mesh.getDiscoveredPeers()), new Set([ghost, active]));
    assert.deepEqual(mesh.getActiveSignalingPeers(), [active]);
    assert.deepEqual(mesh.getGraphSnapshot().nodes.map((node) => node.peerId), [self]);

    mesh.mergeMembership([active], [], {}, active);
    assert.deepEqual(mesh.getGraphSnapshot().nodes.map((node) => node.peerId), [self, active]);

    // A transient empty raw snapshot retains the last non-empty current view
    // while the adapter's discovery grace is still carrying known peers.
    mesh.reconcileSignalingPeers([ghost, active], []);
    assert.deepEqual(mesh.getActiveSignalingPeers(), [active]);
  } finally {
    mesh.destroy();
  }
});

test('signaling absence does not tombstone CECR membership or close a healthy RTC edge', () => {
  const self = '0'.repeat(64);
  const remote = '1'.repeat(64);
  const closed = [];
  const mesh = new PartialMesh({
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.mergeMembership([remote], [], {}, {}, remote);
    mesh.discoveredPeers.add(remote);
    mesh.activeSignalingPeers.add(remote);
    mesh.discoveredAtMs.set(remote, Date.now());
    mesh.peers.set(remote, { id: remote, connected: true, initiator: false });
    mesh.signalingClient = {
      closeConnection(peerId) { closed.push(peerId); },
      disconnect() {},
    };

    mesh.handleSignalingPeerLeft(remote);

    assert.equal(mesh.getDiscoveredPeers().includes(remote), false);
    assert.equal(mesh.getActiveSignalingPeers().includes(remote), false);
    assert.equal(mesh.getGlobalPeers().includes(remote), true);
    assert.equal(mesh.membershipRecordsById.get(remote)?.state, 'alive');
    assert.equal(mesh.getConnectedPeers().includes(remote), true);
    assert.deepEqual(closed, []);
  } finally {
    mesh.destroy();
  }
});

test('isolated recovery uses tolerantPeers as parallel dial headroom', () => {
  const self = '0'.repeat(64);
  const candidates = ['1', '2', '3'].map((digit) => digit.repeat(64));
  const dials = [];
  const mesh = new PartialMesh({
    minPeers: 1,
    maxPeers: 2,
    tolerantPeers: 1,
    autoDiscover: false,
    autoConnect: false,
  });
  try {
    mesh.clientId = self;
    mesh.selfAliases.add(self);
    mesh.reconcileSignalingPeers(candidates, candidates);
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

    mesh.maintainPeerConnections();

    assert.deepEqual(new Set(dials), new Set(candidates));
    assert.equal(mesh.getPendingPeerCount(), 3);
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
