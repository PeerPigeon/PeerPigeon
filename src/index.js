export {
	DistributedStorage,
	STORAGE_SPACES,
	canWriteRecord,
	canReadRecord,
} from './distributed-storage.js'

export {
	getMeshConnectionEntry,
	getPeerDataChannelState,
	isDirectRtcConnected,
	sendRtcData,
	maybeUpgradePeerToRtc,
	collectPeerIds,
} from './p2p-policy.js'