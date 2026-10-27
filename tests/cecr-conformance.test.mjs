import assert from 'node:assert/strict';
import test from 'node:test';

import { GossipProtocol, PartialMesh } from '../dist/index.js';

const id = (hex) => String(hex).padStart(64, '0');

class CecrTestMesh {
  constructor(id, connected = [], global = []) {
    this.id = id;
    this.connected = [...connected];
    this.global = [...global];
    this.handlers = new Map();
    this.frames = [];
    this.failFor = new Set();
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
  getCecrMembershipConfig() {
    return { leaseMs: 30_000, gossipIntervalMs: 5_000, tombstoneRetentionMs: 120_000, clockSkewMs: 5_000 };
  }
  getCecrMembershipRecords() { return []; }

  send(peerId, raw) {
    this.frames.push({ peerId, envelope: JSON.parse(String(raw)) });
    if (this.failFor.has(peerId)) throw new Error('simulated send failure');
  }
}

function destroy(protocol) {
  protocol.destroy();
}

test('CECR gossip fan-out is min(connected degree, ceil(log2(live N)))', () => {
  const self = id('01');
  const connected = ['02', '03', '04', '05', '06', '07', '08', '09'].map(id);
  const live = Array.from({ length: 16 }, (_, index) => id((index + 1).toString(16)));
  const mesh = new CecrTestMesh(self, connected, live.filter((peerId) => peerId !== self));
  const protocol = new GossipProtocol(mesh);
  try {
    protocol.broadcast('bounded');
    const gossipFrames = mesh.frames.filter((frame) => frame.envelope.type === 'gossip');
    assert.equal(gossipFrames.length, 4);
    assert.equal(new Set(gossipFrames.map((frame) => frame.peerId)).size, 4);
  } finally {
    destroy(protocol);
  }
});

// A direct message always leaves: at a local minimum of the greedy order,
// or for a target outside the live view, the peer tries its other paths
// (every neighbour not already on the message's path) instead of refusing.
// Each peer forwards a given message at most once, so this cannot loop.
test('CECR routing at a local minimum tries the other neighbours instead of refusing', () => {
  const mesh = new CecrTestMesh(id('08'), [id('0f')], [id('00'), id('0f')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    assert.ok(protocol.sendDirect(id('00'), 'other-path'), 'the message left');
    const directFrames = mesh.frames.filter((frame) => frame.envelope.type === 'direct');
    assert.deepEqual(directFrames.map((frame) => frame.peerId), [id('0f')]);
  } finally {
    destroy(protocol);
  }
});

test('CECR routing still sends a message whose target is not in the local live view', () => {
  const target = id('00');
  const mesh = new CecrTestMesh(id('08'), [target], []);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    assert.ok(protocol.sendDirect(target, 'expired-target'), 'the message left');
    assert.equal(mesh.frames.filter((frame) => frame.envelope.type === 'direct').length, 1);
  } finally {
    destroy(protocol);
  }
});

test('CECR local-minimum fallback requires and selects strict raw-XOR progress', () => {
  const mesh = new CecrTestMesh(id('0f'), [id('08'), id('09'), id('0e')], [id('00'), id('08'), id('09'), id('0e')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    // A relay (a frame that arrived from 0e) forwards one copy, to the
    // strictly better XOR candidate.
    mesh.emit('peer:data', {
      peerId: id('0e'),
      data: JSON.stringify({ id: 'relay-1', type: 'direct', from: id('0e'), to: id('00'), data: 'fallback', hops: 1, maxHops: 16, timestamp: Date.now(), path: [] }),
    });
    const directFrames = mesh.frames.filter((frame) => frame.envelope.type === 'direct');
    assert.equal(directFrames.length, 1);
    assert.equal(directFrames[0].peerId, id('08'));
  } finally {
    destroy(protocol);
  }
});

// CECR v1.3 multipath: a sender takes one path to a neighbour, and for any
// other target at least two, in the routing order, scaling with the estimated
// distance to the target.
test('CECR v1.3 a sender takes one path to a neighbour and at least two to anyone else', () => {
  const mesh = new CecrTestMesh(id('0f'), [id('08'), id('09'), id('0e')], [id('00'), id('08'), id('09'), id('0e')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    protocol.sendDirect(id('08'), 'neighbour');
    assert.deepEqual(mesh.frames.filter((frame) => frame.envelope.type === 'direct').map((frame) => frame.peerId), [id('08')]);
    mesh.frames.length = 0;
    protocol.sendDirect(id('00'), 'far');
    const frames = mesh.frames.filter((frame) => frame.envelope.type === 'direct');
    assert.ok(frames.length >= 2, `at least two paths (got ${frames.length})`);
    assert.equal(frames[0].peerId, id('08'), 'the best candidate first');
    assert.equal(new Set(frames.map((frame) => frame.peerId)).size, frames.length, 'each through a different neighbour');
    assert.equal(new Set(frames.map((frame) => frame.envelope.id)).size, 1, 'copies of one message');
  } finally {
    destroy(protocol);
  }
});

test('CECR v1.3 the number of paths scales with network size and distance to the target', () => {
  const live = Array.from({ length: 200 }, (_, index) => (index + 1).toString(16).padStart(64, '0'));
  const mesh = new CecrTestMesh(live[0], live.slice(1, 9), live.slice(1));
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    // 200 peers: ceil(log2 200) = 8 hops at most. A target sharing no leading
    // bits with us is 8 hops out: 1 + ceil(log2 9) = 5 paths.
    const far = 'f'.repeat(64);
    assert.equal(protocol.directPathCount(far, 8), 5);
    // Our ID is ...01 (255 leading zeros); a target sharing 250 leading bits
    // is still estimated at least 1 hop: 1 + ceil(log2 2) = 2 paths.
    assert.equal(protocol.directPathCount(live[30], 8), 2);
    // Never more than the neighbours there are, and at least two while there are.
    assert.equal(protocol.directPathCount(far, 3), 3);
    assert.equal(protocol.directPathCount(far, 1), 1);
  } finally {
    destroy(protocol);
  }
});

test('CECR retries the next progress candidate after a send failure', () => {
  const mesh = new CecrTestMesh(id('0f'), [id('08'), id('09')], [id('00'), id('08'), id('09')]);
  mesh.failFor.add(id('08'));
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    protocol.sendDirect(id('00'), 'retry');
    const attempts = mesh.frames
      .filter((frame) => frame.envelope.type === 'direct')
      .map((frame) => frame.peerId);
    assert.deepEqual(attempts, [id('08'), id('09')]);
  } finally {
    destroy(protocol);
  }
});

test('CECR routing compares full-width 256-bit IDs exactly', () => {
  const self = 'f'.repeat(64);
  const nearer = `8${'0'.repeat(63)}`;
  const farther = `c${'0'.repeat(63)}`;
  const target = '0'.repeat(64);
  const mesh = new CecrTestMesh(self, [farther, nearer], [target, nearer, farther]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    protocol.sendDirect(target, 'exact');
    const direct = mesh.frames.find((frame) => frame.envelope.type === 'direct');
    assert.equal(direct?.peerId, nearer);
  } finally {
    destroy(protocol);
  }
});

test('CECR state exposes configuration, fan-out, overlay health, and coordinate readiness', () => {
  const mesh = new CecrTestMesh(id('04'), [id('01'), id('08')], [id('01'), id('08')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    const config = protocol.getCecrConfig();
    const state = protocol.getCecrState();
    assert.equal(config.protocol, 'cecr/1');
    assert.equal(config.idWidthBits, 256);
    assert.equal(config.membershipLeaseMs, 30_000);
    assert.equal(state.coordinateReady, true);
    assert.equal(state.overlay.degraded, false);
    assert.equal(state.fanout, 2);
    assert.deepEqual(state.livePeerIds, [id('01'), id('04'), id('08')]);
  } finally {
    destroy(protocol);
  }
});

test('CECR coordinate readiness requires stable matching neighbor state rounds', () => {
  const neighbors = [id('01'), id('08')];
  const mesh = new CecrTestMesh(id('04'), neighbors, neighbors);
  const protocol = new GossipProtocol(mesh, { cecrConvergenceRounds: 2 });
  try {
    const initial = protocol.getCecrState();
    assert.equal(initial.coordinateReady, false);
    protocol.cecrViewChangedAtMs = Date.now() - initial.requiredStableForMs - 1;

    for (let round = 0; round < 2; round += 1) {
      for (const neighbor of neighbors) {
        mesh.emit('peer:data', {
          peerId: neighbor,
          data: JSON.stringify({
            id: `${neighbor}-${round}`,
            type: 'cecr-state',
            protocol: 'cecr/1',
            from: neighbor,
            timestamp: Date.now(),
            configId: initial.configId,
            viewId: initial.viewId,
            setHash: initial.viewId,
            minHex: initial.minHex,
            maxHex: initial.maxHex,
            size: initial.size,
          }),
        });
      }
    }
    assert.equal(protocol.getCecrState().coordinateReady, true);

    mesh.emit('peer:data', {
      peerId: neighbors[0],
      data: JSON.stringify({
        id: 'mismatch',
        type: 'cecr-state',
        protocol: 'cecr/1',
        from: neighbors[0],
        timestamp: Date.now(),
        configId: initial.configId,
        viewId: 'different-view',
        setHash: 'different-view',
        minHex: initial.minHex,
        maxHex: initial.maxHex,
        size: initial.size,
      }),
    });
    assert.equal(protocol.getCecrState().coordinateReady, false);
  } finally {
    destroy(protocol);
  }
});

test('CECR membership honors versioned left records, reincarnation, and lease expiry', async () => {
  const mesh = new PartialMesh({
    autoDiscover: false,
    autoConnect: false,
    membershipLeaseMs: 3_000,
    membershipGossipIntervalMs: 500,
    membershipTombstoneRetentionMs: 3_500,
    membershipClockSkewMs: 0,
  });
  try {
    const now = Date.now();
    const peer08 = id('08');
    const peer09 = id('09');
    const peer0a = id('0a');
    mesh.mergeMembership([], [], {}, {}, peer08, {
      [peer08]: [1, 1, 'alive', now, now + 3_000],
    });
    assert.deepEqual(mesh.getGlobalPeers(), [peer08]);

    mesh.mergeMembership([], [], {}, {}, peer08, {
      [peer08]: [1, 0, 'left', Date.now(), null],
    });
    assert.deepEqual(mesh.getGlobalPeers(), [peer08]);

    mesh.mergeMembership([], [], {}, {}, peer08, {
      [peer08]: [1, 2, 'left', Date.now(), null],
    });
    assert.deepEqual(mesh.getGlobalPeers(), []);

    mesh.mergeMembership([], [], {}, {}, peer08, {
      [peer08]: [2, 0, 'alive', Date.now(), Date.now() + 3_000],
    });
    assert.deepEqual(mesh.getGlobalPeers(), [peer08]);

    const expiryIssuedAt = Date.now();
    mesh.mergeMembership([], [], {}, {}, peer09, {
      [peer09]: [1, 1, 'alive', expiryIssuedAt, expiryIssuedAt + 20],
    });
    assert.equal(mesh.getGlobalPeers().includes(peer09), true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(mesh.getGlobalPeers().includes(peer09), false);
    mesh.mergeMembership([], [], {}, {}, peer09, {
      [peer09]: [1, 0, 'alive', Date.now(), Date.now() + 3_000],
    });
    assert.equal(mesh.getGlobalPeers().includes(peer09), false);

    const equivocationAt = Date.now();
    mesh.mergeMembership([], [], {}, {}, peer0a, {
      [peer0a]: [1, 1, 'alive', equivocationAt, equivocationAt + 3_000],
    });
    mesh.mergeMembership([], [], {}, {}, peer0a, {
      [peer0a]: [1, 1, 'left', equivocationAt, null],
    });
    assert.equal(mesh.getGlobalPeers().includes(peer0a), false);
    assert.deepEqual(mesh.getCecrMembershipEquivocations(), [peer0a]);
  } finally {
    mesh.destroy();
  }
});

// CECR v1.2 learned routes (Section 8.4). A broadcast that arrives proves
// the link it came over leads back to its sender; a route ack sent back up
// the broadcast's path proves the forward links. A direct message tries a
// fresh learned route before the greedy order.
const gossipFrom = (sender, hops = 2) => JSON.stringify({
  id: `learn-${sender}-${hops}`,
  type: 'gossip',
  sender,
  data: 'hello',
  metadata: {},
  timestamp: Date.now(),
  hops,
  maxHops: 16,
  path: [],
});
const directFrames = (mesh) => mesh.frames.filter((frame) => frame.envelope.type === 'direct');

test('CECR v1.2 a broadcast teaches the route back to its sender, tried before the greedy order', () => {
  // Greedy toward 00 would pick 08; the sender's broadcast came in over 09.
  const mesh = new CecrTestMesh(id('0f'), [id('08'), id('09')], [id('00'), id('08'), id('09')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    mesh.emit('peer:data', { peerId: id('09'), data: gossipFrom(id('00')) });
    mesh.frames.length = 0;
    assert.ok(protocol.sendDirect(id('00'), 'learned'));
    // v1.3: two paths, the learned route first, then the greedy choice.
    assert.deepEqual(directFrames(mesh).map((frame) => frame.peerId), [id('09'), id('08')]);
  } finally {
    destroy(protocol);
  }
});

test('CECR v1.2 a learned route is forgotten when its link closes', () => {
  const mesh = new CecrTestMesh(id('0f'), [id('08'), id('09')], [id('00'), id('08'), id('09')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    mesh.emit('peer:data', { peerId: id('09'), data: gossipFrom(id('00')) });
    mesh.emit('peer:disconnected', id('09'));
    mesh.connected = [id('08')];
    mesh.frames.length = 0;
    protocol.sendDirect(id('00'), 'greedy again');
    assert.deepEqual(directFrames(mesh).map((frame) => frame.peerId), [id('08')]);
  } finally {
    destroy(protocol);
  }
});

test('CECR v1.2 a learned route whose send fails falls back to the greedy order', () => {
  const mesh = new CecrTestMesh(id('0f'), [id('08'), id('09')], [id('00'), id('08'), id('09')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    mesh.emit('peer:data', { peerId: id('09'), data: gossipFrom(id('00')) });
    mesh.failFor.add(id('09'));
    mesh.frames.length = 0;
    assert.ok(protocol.sendDirect(id('00'), 'fallback'));
    assert.deepEqual(directFrames(mesh).map((frame) => frame.peerId), [id('09'), id('08')]);
  } finally {
    destroy(protocol);
  }
});

test('CECR v1.2 a receiver acks a broadcast to the neighbour it came from, and acks travel on toward the sender', async () => {
  const mesh = new CecrTestMesh(id('0f'), [id('08'), id('09')], [id('00'), id('08'), id('09')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    mesh.emit('peer:data', { peerId: id('09'), data: gossipFrom(id('00')) });
    // 08 got the broadcast from us and acks a peer two hops below it.
    const below = 'ab'.repeat(20);
    mesh.emit('peer:data', {
      peerId: id('08'),
      data: JSON.stringify({ type: 'route-ack', id: `learn-${id('00')}-2`, reached: [[below, 2]] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const acks = mesh.frames.filter((frame) => frame.envelope.type === 'route-ack');
    assert.equal(acks.length, 1, 'one batched ack frame');
    assert.equal(acks[0].peerId, id('09'), 'sent to the neighbour the broadcast came from');
    const reached = new Map(acks[0].envelope.reached);
    assert.equal(reached.size, 2, 'this peer and the peer below it');
    assert.equal(reached.get(below), 3, 'one hop further from the parent');
    // And the acked peer is now reachable through 08.
    assert.ok(protocol.getLearnedRoutes().some((route) => route.target === below && route.via === id('08') && route.hops === 2));
  } finally {
    destroy(protocol);
  }
});
