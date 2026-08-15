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

test('CECR routing never forwards to a non-improving peer', () => {
  const mesh = new CecrTestMesh(id('08'), [id('0f')], [id('00'), id('0f')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    protocol.sendDirect(id('00'), 'no-loop');
    assert.equal(mesh.frames.filter((frame) => frame.envelope.type === 'direct').length, 0);
  } finally {
    destroy(protocol);
  }
});

test('CECR routing stops when the target is not in the local live view', () => {
  const target = id('00');
  const mesh = new CecrTestMesh(id('08'), [target], []);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    protocol.sendDirect(target, 'expired-target');
    assert.equal(mesh.frames.filter((frame) => frame.envelope.type === 'direct').length, 0);
  } finally {
    destroy(protocol);
  }
});

test('CECR local-minimum fallback requires and selects strict raw-XOR progress', () => {
  const mesh = new CecrTestMesh(id('0f'), [id('08'), id('09')], [id('00'), id('08'), id('09')]);
  const protocol = new GossipProtocol(mesh, { cecrRequireConsensus: false });
  try {
    protocol.sendDirect(id('00'), 'fallback');
    const directFrames = mesh.frames.filter((frame) => frame.envelope.type === 'direct');
    assert.equal(directFrames.length, 1);
    assert.equal(directFrames[0].peerId, id('08'));
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
