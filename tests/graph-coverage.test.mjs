import assert from 'node:assert/strict';
import test from 'node:test';

import {
  combinedNetworkGossipHealth,
  gossipBadgeState,
  gossipQualityForCoverage,
  graphCoverageSnapshot,
  graphPeerSummary,
} from '../examples/vue3/src/graph-coverage.js';

test('gossip badge is derived independently from signaling or generic UI status', () => {
  assert.deepEqual(
    gossipBadgeState({
      running: true,
      connectedPeerCount: 2,
      coverageSnapshot: { reachablePeers: 3, knownPeers: 4 },
    }),
    {
      label: 'Good',
      statusType: 'success',
      state: 'green',
      reachablePeers: 3,
      knownPeers: 4,
      coverage: 3 / 4,
    },
  );
});

test('gossip badge reports actual suspended and offline states', () => {
  const coverageSnapshot = { reachablePeers: 0, knownPeers: 4 };
  assert.equal(gossipBadgeState({
    running: true,
    suspended: true,
    connectedPeerCount: 0,
    coverageSnapshot,
  }).label, 'Suspended');
  assert.deepEqual(gossipBadgeState({
    running: true,
    connectedPeerCount: 0,
    coverageSnapshot,
  }), {
    label: 'Offline',
    state: 'red',
    statusType: 'connecting',
    reachablePeers: 0,
    knownPeers: 4,
    coverage: 0,
  });
});

test('gossip coverage traverses the exact CECR nodes and lines shown by the graph', () => {
  const graph = {
    nodes: [
      { id: 'self', isSelf: true },
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
    ],
    links: [
      { source: 'self', target: 'a' },
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ],
  };

  assert.deepEqual(graphCoverageSnapshot(graph, 'self'), {
    reachablePeers: 2,
    knownPeers: 4,
    coverage: 0.5,
  });
});

test('coverage ignores an edge unless both endpoints are visible CECR nodes', () => {
  const graph = {
    nodes: [{ id: 'self', isSelf: true }, { id: 'a' }, { id: 'b' }],
    links: [
      { source: 'self', target: 'retired' },
      { source: 'a', target: 'b' },
    ],
  };

  assert.deepEqual(graphCoverageSnapshot(graph), {
    reachablePeers: 0,
    knownPeers: 2,
    coverage: 0,
  });
});

test('an isolated CECR peer is excluded from both gossip counts', () => {
  const graph = {
    nodes: [{ id: 'self', isSelf: true }],
    links: [],
  };

  assert.deepEqual(graphCoverageSnapshot(graph), {
    reachablePeers: 0,
    knownPeers: 0,
    coverage: 0,
  });
});

test('gossip saturation uses the whole known network, not only the reachable component', () => {
  const graph = {
    nodes: [
      { id: 'self', isSelf: true },
      { id: 'a' },
      { id: 'b' },
    ],
    links: [
      { source: 'self', target: 'a' },
      { source: 'a', target: 'b' },
    ],
  };

  const snapshot = graphCoverageSnapshot(graph, 'self', 7);
  assert.deepEqual(snapshot, {
    reachablePeers: 2,
    knownPeers: 7,
    coverage: 2 / 7,
  });
  assert.deepEqual(gossipQualityForCoverage(snapshot.coverage), {
    label: 'Fair',
    statusType: 'info',
  });
});

test('a five-peer CECR token ring has five lines and four reachable remote peers', () => {
  const graph = {
    nodes: ['self', 'a', 'b', 'c', 'd'].map((id) => ({ id, isSelf: id === 'self' })),
    links: [
      { source: 'self', target: 'a' },
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
      { source: 'd', target: 'self' },
    ],
  };

  assert.equal(graph.links.length, 5);
  assert.deepEqual(graphCoverageSnapshot(graph, 'self'), {
    reachablePeers: 4,
    knownPeers: 4,
    coverage: 1,
  });
});

test('a healthy four-peer CECR token ring reports three of three gossip peers', () => {
  const graph = {
    nodes: [
      { id: 'self', isSelf: true },
      { id: 'a', isDirect: true },
      { id: 'b', isDirect: false },
      { id: 'c', isDirect: true },
    ],
    links: [
      { source: 'self', target: 'a' },
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'self' },
    ],
  };

  assert.deepEqual(graphCoverageSnapshot(graph, 'self'), {
    reachablePeers: 3,
    knownPeers: 3,
    coverage: 1,
  });
  assert.deepEqual(graphPeerSummary(graph), {
    indirect: 1,
    direct: 2,
    total: 4,
  });
});

test('gossip quality uses the exact quarter-scale health labels', () => {
  assert.deepEqual(gossipQualityForCoverage(0), { label: 'Poor', statusType: 'connecting' });
  assert.deepEqual(gossipQualityForCoverage(1 / 4), { label: 'Fair', statusType: 'info' });
  assert.deepEqual(gossipQualityForCoverage(2 / 4), { label: 'OK', statusType: 'success' });
  assert.deepEqual(gossipQualityForCoverage(3 / 4), { label: 'Good', statusType: 'success' });
  assert.deepEqual(gossipQualityForCoverage(4 / 4), { label: 'Excellent', statusType: 'success' });
});

test('combined health uses gossip as the bottleneck when network membership is complete', () => {
  assert.deepEqual(
    combinedNetworkGossipHealth(
      { direct: 2, indirect: 5, total: 8 },
      { reachablePeers: 6, knownPeers: 7 },
    ),
    {
      label: 'Good',
      statusType: 'success',
      state: 'good',
      bars: 3,
      fillPercent: 75,
      coverage: 6 / 7,
      networkCoverage: 1,
      gossipCoverage: 6 / 7,
      networkReachablePeers: 7,
      networkKnownPeers: 7,
      gossipReachablePeers: 6,
      gossipKnownPeers: 7,
      title: 'Network 7/7 · Gossip 6/7 · Combined: Good',
    },
  );
});

test('one direct plus one indirect peer and two-of-two gossip is fully healthy', () => {
  const health = combinedNetworkGossipHealth(
    { direct: 1, indirect: 1, total: 3 },
    { reachablePeers: 2, knownPeers: 2 },
  );

  assert.equal(health.networkCoverage, 1);
  assert.equal(health.gossipCoverage, 1);
  assert.equal(health.label, 'Excellent');
  assert.equal(health.bars, 4);
  assert.equal(health.fillPercent, 100);
  assert.equal(health.title, 'Network 2/2 · Gossip 2/2 · Combined: Excellent');
});

test('combined health uses incomplete CECR membership as the bottleneck', () => {
  const health = combinedNetworkGossipHealth(
    { direct: 2, indirect: 2, total: 5 },
    { reachablePeers: 7, knownPeers: 7 },
  );

  assert.equal(health.networkReachablePeers, 4);
  assert.equal(health.networkKnownPeers, 7);
  assert.equal(health.gossipReachablePeers, 7);
  assert.equal(health.coverage, 4 / 7);
  assert.equal(health.label, 'OK');
  assert.equal(health.bars, 2);
});

test('combined health explicitly shows suspended and empty states', () => {
  const suspended = combinedNetworkGossipHealth(
    { direct: 1, indirect: 2, total: 4 },
    { reachablePeers: 3, knownPeers: 3 },
    true,
  );
  assert.equal(suspended.label, 'Suspended');
  assert.equal(suspended.state, 'suspended');
  assert.equal(suspended.bars, 0);
  assert.match(suspended.title, /Combined: Suspended$/);

  const empty = combinedNetworkGossipHealth(
    { direct: 0, indirect: 0, total: 1 },
    { reachablePeers: 0, knownPeers: 0 },
  );
  assert.equal(empty.label, 'Poor');
  assert.equal(empty.bars, 0);
  assert.equal(empty.title, 'Network 0/0 · Gossip 0/0 · Combined: Poor');
});
