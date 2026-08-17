function normalizePeerId(value) {
  if (value && typeof value === 'object') return String(value.id ?? value.peerId ?? '').trim();
  return String(value ?? '').trim();
}

/**
 * Calculate local reachability from the exact CECR graph rendered by the UI.
 * Visible lines determine traversal. The denominator is the larger of visible
 * CECR nodes and the fresh whole-network CECR size estimate. Gossip counts
 * exclude the local peer; network totals are separate.
 */
export function graphCoverageSnapshot(graph, requestedLocalPeerId = '', requestedKnownPeerCount = 0) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph?.links) ? graph.links : [];
  const peerIds = new Set();
  let localPeerId = normalizePeerId(requestedLocalPeerId);

  for (const node of nodes) {
    const peerId = normalizePeerId(node);
    if (!peerId) continue;
    peerIds.add(peerId);
    if (!localPeerId && (node?.isSelf || node?.local)) localPeerId = peerId;
  }

  const adjacency = new Map(Array.from(peerIds, (peerId) => [peerId, new Set()]));
  for (const link of links) {
    const source = normalizePeerId(link?.source);
    const target = normalizePeerId(link?.target);
    if (!source || !target || source === target) continue;
    if (!peerIds.has(source) || !peerIds.has(target)) continue;
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  }

  const hasLocalPeer = Boolean(localPeerId && peerIds.has(localPeerId));
  // Saturation is measured against the entire fresh CECR network estimate,
  // never only the component currently reachable from this peer.
  const knownPeers = Math.max(
    0,
    peerIds.size - (hasLocalPeer ? 1 : 0),
    Math.floor(Number(requestedKnownPeerCount) || 0),
  );
  if (!hasLocalPeer) return { reachablePeers: 0, knownPeers, coverage: 0 };

  const visited = new Set([localPeerId]);
  const queue = [localPeerId];
  for (let index = 0; index < queue.length; index += 1) {
    const peerId = queue[index];
    for (const neighbor of adjacency.get(peerId) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  // Self is never a gossip target and is excluded from both gossip counts.
  const reachablePeers = Math.max(0, visited.size - 1);
  return {
    reachablePeers,
    knownPeers,
    coverage: knownPeers > 0 ? reachablePeers / knownPeers : 0,
  };
}

/** Count CECR peers by their relationship to the local peer. */
export function graphPeerSummary(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const peers = new Map();
  for (const node of nodes) {
    const peerId = normalizePeerId(node);
    if (!peerId) continue;
    peers.set(peerId, {
      isSelf: Boolean(node?.isSelf || node?.local),
      isDirect: Boolean(node?.isDirect || node?.directlyConnected),
    });
  }

  let direct = 0;
  let indirect = 0;
  for (const peer of peers.values()) {
    if (peer.isSelf) continue;
    if (peer.isDirect) direct += 1;
    else indirect += 1;
  }
  return { indirect, direct, total: peers.size };
}

/** Map remote gossip coverage onto the UI's quarter-scale health labels. */
export function gossipQualityForCoverage(value) {
  const coverage = Math.max(0, Math.min(1, Number(value) || 0));
  if (coverage >= 1) return { label: 'Excellent', statusType: 'success' };
  if (coverage >= 0.75) return { label: 'Good', statusType: 'success' };
  if (coverage >= 0.5) return { label: 'OK', statusType: 'success' };
  if (coverage >= 0.25) return { label: 'Fair', statusType: 'info' };
  return { label: 'Poor', statusType: 'connecting' };
}

/**
 * Derive the Gossip badge from Gossip itself. Signaling and generic UI status
 * are deliberately absent: network transport and gossip saturation are
 * separate states and must not overwrite one another.
 */
export function gossipBadgeState({
  running = false,
  suspended = false,
  connectedPeerCount = 0,
  coverageSnapshot = {},
} = {}) {
  const reachablePeers = Math.max(0, Math.floor(Number(coverageSnapshot?.reachablePeers) || 0));
  const knownPeers = Math.max(0, Math.floor(Number(coverageSnapshot?.knownPeers) || 0));
  const coverage = knownPeers > 0
    ? Math.min(1, reachablePeers / knownPeers)
    : 0;

  if (!running) {
    return { label: 'Idle', state: 'grey', statusType: 'info', reachablePeers, knownPeers, coverage };
  }
  if (suspended) {
    return { label: 'Suspended', state: 'grey', statusType: 'info', reachablePeers, knownPeers, coverage };
  }
  if (Math.max(0, Math.floor(Number(connectedPeerCount) || 0)) === 0) {
    return { label: 'Offline', state: 'red', statusType: 'connecting', reachablePeers, knownPeers, coverage };
  }

  const quality = gossipQualityForCoverage(coverage);
  const state = quality.label === 'Poor'
    ? 'red'
    : quality.label === 'Fair'
      ? 'yellow'
      : 'green';
  return { ...quality, state, reachablePeers, knownPeers, coverage };
}

/**
 * Combine visible CECR membership and gossip saturation into one bottleneck
 * indicator. Network totals include self; both health ratios exclude self.
 */
export function combinedNetworkGossipHealth(networkSummary = {}, gossipSnapshot = {}, suspended = false) {
  const directPeers = Math.max(0, Math.floor(Number(networkSummary?.direct) || 0));
  const indirectPeers = Math.max(0, Math.floor(Number(networkSummary?.indirect) || 0));
  const visibleRemotePeers = directPeers + indirectPeers;
  const gossipKnownPeers = Math.max(0, Math.floor(Number(gossipSnapshot?.knownPeers) || 0));
  const networkKnownPeers = Math.max(
    visibleRemotePeers,
    Math.max(0, Math.floor(Number(networkSummary?.total) || 0) - 1),
    gossipKnownPeers,
  );
  const networkReachablePeers = Math.min(networkKnownPeers, visibleRemotePeers);
  const gossipReachablePeers = Math.min(
    gossipKnownPeers,
    Math.max(0, Math.floor(Number(gossipSnapshot?.reachablePeers) || 0)),
  );
  const networkCoverage = networkKnownPeers > 0
    ? networkReachablePeers / networkKnownPeers
    : 0;
  const gossipCoverage = gossipKnownPeers > 0
    ? gossipReachablePeers / gossipKnownPeers
    : 0;
  const coverage = Math.min(networkCoverage, gossipCoverage);

  if (suspended) {
    return {
      label: 'Suspended',
      state: 'suspended',
      bars: 0,
      fillPercent: 0,
      coverage,
      networkCoverage,
      gossipCoverage,
      networkReachablePeers,
      networkKnownPeers,
      gossipReachablePeers,
      gossipKnownPeers,
      title: `Network ${networkReachablePeers}/${networkKnownPeers} · Gossip ${gossipReachablePeers}/${gossipKnownPeers} · Combined: Suspended`,
    };
  }

  const quality = gossipQualityForCoverage(coverage);
  const barsByLabel = {
    Poor: 0,
    Fair: 1,
    OK: 2,
    Good: 3,
    Excellent: 4,
  };
  const bars = barsByLabel[quality.label] ?? 0;
  return {
    ...quality,
    state: quality.label.toLowerCase(),
    bars,
    fillPercent: bars * 25,
    coverage,
    networkCoverage,
    gossipCoverage,
    networkReachablePeers,
    networkKnownPeers,
    gossipReachablePeers,
    gossipKnownPeers,
    title: `Network ${networkReachablePeers}/${networkKnownPeers} · Gossip ${gossipReachablePeers}/${gossipKnownPeers} · Combined: ${quality.label}`,
  };
}
