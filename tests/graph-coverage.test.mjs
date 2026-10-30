import assert from 'node:assert/strict';
import test from 'node:test';

import {
  combinedNetworkGossipHealth,
  gossipBadgeState,
  gossipQualityForCoverage,
  graphCoverageSnapshot,
  graphLiveness,
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
    fading: 0,
  });
});

test('a closed peer still on lease does not pull gossip down', () => {
  // d closed its tab. Its lease has not run out, so it is still a node, and its
  // own last report still claims a link to b, but b no longer reports it.
  const graph = {
    nodes: [
      { id: 'self', isSelf: true },
      { id: 'a', isDirect: true },
      { id: 'b' },
      { id: 'd' },
    ],
    links: [
      { source: 'self', target: 'a', direct: true, observedBy: ['self'] },
      { source: 'a', target: 'b', observedBy: ['a', 'b'] },
      { source: 'b', target: 'd', observedBy: ['d'] },
    ],
  };

  assert.deepEqual(graphCoverageSnapshot(graph, 'self'), {
    reachablePeers: 2,
    knownPeers: 2,
    coverage: 1,
  });
  assert.deepEqual(graphPeerSummary(graph), { indirect: 1, direct: 1, total: 3, fading: 1 });
  assert.deepEqual(Array.from(graphLiveness(graph).fading), ['d']);
});

test('a live peer cut off from us still counts against gossip', () => {
  // c and e confirm their link to each other, but nothing links them to us.
  const graph = {
    nodes: ['self', 'a', 'c', 'e'].map((id) => ({ id, isSelf: id === 'self' })),
    links: [
      { source: 'self', target: 'a', direct: true, observedBy: ['self'] },
      { source: 'c', target: 'e', observedBy: ['c', 'e'] },
    ],
  };

  assert.deepEqual(graphCoverageSnapshot(graph, 'self'), {
    reachablePeers: 1,
    knownPeers: 3,
    coverage: 1 / 3,
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

test('peers that all left at once stop counting as soon as the relay no longer lists them', () => {
  // x and y left together. Their last reports still name each other, so
  // without the relay's list they look like a live part cut off from us.
  const graph = {
    nodes: ['self', 'a', 'x', 'y'].map((id) => ({ id, isSelf: id === 'self' })),
    links: [
      { source: 'self', target: 'a', direct: true, observedBy: ['self'] },
      { source: 'x', target: 'y', observedBy: ['x', 'y'] },
    ],
  };
  assert.equal(graphCoverageSnapshot(graph, 'self').knownPeers, 3);
  assert.deepEqual(graphCoverageSnapshot(graph, 'self', 0, { relayListed: ['a'] }), {
    reachablePeers: 1,
    knownPeers: 1,
    coverage: 1,
  });
  // A live cut-off part keeps a peer on the relay, and still counts.
  assert.equal(graphCoverageSnapshot(graph, 'self', 0, { relayListed: ['y'] }).knownPeers, 3);
});

test('a part we cannot reach yet counts against coverage only once it stays cut off', () => {
  const graph = {
    nodes: [{ id: 'me', isSelf: true }, { id: 'a' }, { id: 'x' }, { id: 'y' }],
    links: [
      { source: 'me', target: 'a', direct: true },
      { source: 'a', target: 'me' },
      { source: 'x', target: 'y' },
    ],
  };
  const cutOffSince = new Map();
  const options = { cutOffSince, cutOffGraceMs: 10000 };
  const joining = graphCoverageSnapshot(graph, 'me', 0, { ...options, now: 1000 });
  assert.equal(joining.knownPeers, 1);
  assert.equal(joining.coverage, 1);
  const split = graphCoverageSnapshot(graph, 'me', 0, { ...options, now: 12000 });
  assert.equal(split.knownPeers, 3);
  assert.equal(split.reachablePeers, 1);
  const joined = { ...graph, links: [...graph.links, { source: 'a', target: 'x' }] };
  graphCoverageSnapshot(joined, 'me', 0, { ...options, now: 13000 });
  assert.equal(cutOffSince.size, 0);
});

test('with no current relay list, peers that left together stop counting at once', () => {
  const graph = {
    nodes: [{ id: 'me', isSelf: true }, { id: 'a' }, { id: 'x' }, { id: 'y' }],
    links: [
      { source: 'me', target: 'a', direct: true },
      { source: 'a', target: 'me' },
      { source: 'x', target: 'y' },
    ],
  };
  const snapshot = graphCoverageSnapshot(graph, 'me', 0, { relayListed: [] });
  assert.equal(snapshot.knownPeers, 1);
  assert.equal(snapshot.coverage, 1);
  assert.equal(graphPeerSummary(graph, { relayListed: [] }).fading, 2);
});
