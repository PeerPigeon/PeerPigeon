import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gossipQualityForCoverage,
  graphCoverageSnapshot,
  graphPeerSummary,
} from '../examples/vue3/src/graph-coverage.js';

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
