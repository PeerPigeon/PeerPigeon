function normalizePeerId(value) {
  if (value && typeof value === 'object') return String(value.id ?? value.peerId ?? '').trim();
  return String(value ?? '').trim();
}

/**
 * Which peers are alive, judged from the graph itself.
 *
 * Membership is a lease: a closed tab stays a member until its lease runs out
 * (up to about 30 s), and its own last topology report still lists its old
 * links. So membership, and a peer's word about itself, are not evidence of
 * life. A peer is alive when someone else who is alive says so:
 *
 * - We are alive, and so is every peer on one of our own open connections.
 * - A peer is alive when a live peer reports a link to it. This spreads out
 *   from us, and the links it uses are the ones gossip can travel: they make
 *   up our reach.
 * - Two peers that both report a link to each other are alive even when
 *   nothing connects them to us: a live part of the network cut off from us,
 *   which is what gossip health is there to show.
 *
 * A dead peer's neighbours drop their side within a gossip round, so it stops
 * being vouched for long before its lease ends. A link that carries no
 * observedBy list is taken as reported by both ends.
 *
 * Returns the live peers (self included), the reachable peers (self included),
 * the links gossip can use, and the peers still listed but silent ("fading").
 */
export function graphLiveness(graph, requestedLocalPeerId = '') {
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

  const edges = [];
  for (const link of links) {
    const source = normalizePeerId(link?.source);
    const target = normalizePeerId(link?.target);
    if (!source || !target || source === target) continue;
    if (!peerIds.has(source) || !peerIds.has(target)) continue;
    const observedBy = Array.isArray(link?.observedBy)
      ? new Set(link.observedBy.map(normalizePeerId))
      : new Set([source, target]);
    edges.push({ source, target, observedBy, direct: Boolean(link?.direct) });
  }

  // Reach: spread from us over links reported by a peer already known alive.
  const reachable = new Set();
  const usableLinks = [];
  if (localPeerId && peerIds.has(localPeerId)) {
    reachable.add(localPeerId);
    const used = new Set();
    let grew = true;
    while (grew) {
      grew = false;
      edges.forEach((edge, index) => {
        if (used.has(index)) return;
        const { source, target, observedBy, direct } = edge;
        const touchesSelf = source === localPeerId || target === localPeerId;
        const vouched = (direct && touchesSelf)
          || (reachable.has(source) && observedBy.has(source))
          || (reachable.has(target) && observedBy.has(target));
        if (!vouched) return;
        used.add(index);
        usableLinks.push([source, target]);
        for (const peerId of [source, target]) {
          if (!reachable.has(peerId)) {
            reachable.add(peerId);
            grew = true;
          }
        }
      });
    }
  }

  // Alive: everything we reach, plus both ends of any link both ends report.
  const live = new Set(reachable);
  for (const { source, target, observedBy } of edges) {
    if (observedBy.has(source) && observedBy.has(target)) {
      live.add(source);
      live.add(target);
    }
  }

  const fading = new Set(Array.from(peerIds).filter((peerId) => !live.has(peerId)));
  return { localPeerId, live, reachable, fading, usableLinks };
}

/**
 * Local gossip reach over live peers only: of the peers that are alive, how
 * many this peer can reach. Gossip counts exclude the local peer.
 * requestedKnownPeerCount can raise the known count (a caller with fresher
 * evidence of more live peers); the demo passes none.
 */
export function graphCoverageSnapshot(graph, requestedLocalPeerId = '', requestedKnownPeerCount = 0) {
  const { localPeerId, live, reachable } = graphLiveness(graph, requestedLocalPeerId);
  const hasLocalPeer = Boolean(localPeerId && live.has(localPeerId));
  const knownPeers = Math.max(
    0,
    live.size - (hasLocalPeer ? 1 : 0),
    Math.floor(Number(requestedKnownPeerCount) || 0),
  );
  if (!hasLocalPeer) return { reachablePeers: 0, knownPeers, coverage: 0 };
  const reachablePeers = Math.max(0, reachable.size - 1);
  return {
    reachablePeers,
    knownPeers,
    coverage: knownPeers > 0 ? reachablePeers / knownPeers : 0,
  };
}

/** Count live peers by their relationship to the local peer; silent peers are counted apart as fading. */
export function graphPeerSummary(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const { live, fading } = graphLiveness(graph);
  let direct = 0;
  let indirect = 0;
  let total = 0;
  const seen = new Set();
  for (const node of nodes) {
    const peerId = normalizePeerId(node);
    if (!peerId || seen.has(peerId)) continue;
    seen.add(peerId);
    const isSelf = Boolean(node?.isSelf || node?.local);
    if (!isSelf && !live.has(peerId)) continue;
    total += 1;
    if (isSelf) continue;
    if (node?.isDirect || node?.directlyConnected) direct += 1;
    else indirect += 1;
  }
  return { indirect, direct, total, fading: fading.size };
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
