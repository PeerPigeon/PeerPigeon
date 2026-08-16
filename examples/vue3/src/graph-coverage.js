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
