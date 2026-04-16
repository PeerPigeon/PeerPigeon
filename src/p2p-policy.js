function getMeshConnections(mesh) {
	return mesh?.signalingClient?.client?.mesh?.connections
}

export function getMeshConnectionEntry(mesh, peerId) {
	if (!mesh || !peerId) return null
	return getMeshConnections(mesh)?.get?.(peerId) ?? null
}

export function getPeerDataChannelState(mesh, peerId) {
	const entry = getMeshConnectionEntry(mesh, peerId)
	return entry?.channel?.readyState ?? null
}

export function isDirectRtcConnected(mesh, peerId) {
	const entry = getMeshConnectionEntry(mesh, peerId)
	return Boolean(entry?.connected && !entry?.relayOnly && entry?.channel?.readyState === 'open')
}

export function sendRtcData(mesh, peerId, payload) {
	if (!mesh || !peerId || !isDirectRtcConnected(mesh, peerId)) return false

	try {
		mesh.send?.(peerId, payload)
		return true
	} catch {
		return false
	}
}

export function maybeUpgradePeerToRtc(mesh, peerId) {
	if (!mesh || !peerId || isDirectRtcConnected(mesh, peerId)) return false

	try {
		mesh.connectToPeer?.(peerId)
		return true
	} catch {
		return false
	}
}

export function collectPeerIds({ connectedPeers = [], discoveredPeers = [], mesh } = {}) {
	const ids = new Set()

	for (const peerId of connectedPeers) {
		if (peerId) ids.add(peerId)
	}

	for (const peerId of discoveredPeers) {
		if (peerId) ids.add(peerId)
	}

	for (const peerId of getMeshConnections(mesh)?.keys?.() ?? []) {
		if (peerId) ids.add(peerId)
	}

	for (const peerId of mesh?.getConnectedPeers?.() ?? []) {
		if (peerId) ids.add(peerId)
	}

	return [...ids]
}