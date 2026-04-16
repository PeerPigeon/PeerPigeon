import {
	decryptMessageWithMeta,
	encryptMessageWithMeta,
	signMessage,
	verifyMessage,
} from 'unsea'

export const STORAGE_SPACES = Object.freeze({
	USER: 'user',
	PUBLIC: 'public',
	FROZEN: 'frozen',
	PRIVATE: 'private',
})

const STORAGE_PROTOCOL = 'pp-storage-v1'
const STORAGE_MESSAGE_KIND = 'storage:mutation'
const STORAGE_SYNC_REQUEST_KIND = 'storage:sync-request'
const STORAGE_SYNC_RESPONSE_KIND = 'storage:sync-response'
const STORAGE_QUERY_REQUEST_KIND = 'storage:query-request'
const STORAGE_QUERY_RESPONSE_KIND = 'storage:query-response'

const WRITEABLE_SPACES = new Set(Object.values(STORAGE_SPACES))
const PRIVATE_SPACE = STORAGE_SPACES.PRIVATE
const FROZEN_SPACE = STORAGE_SPACES.FROZEN
const PUBLIC_SPACE = STORAGE_SPACES.PUBLIC

function createEmitter() {
	const handlers = new Map()

	return {
		on(event, callback) {
			if (!handlers.has(event)) {
				handlers.set(event, new Set())
			}
			handlers.get(event).add(callback)
			return () => {
				handlers.get(event)?.delete(callback)
			}
		},
		emit(event, payload) {
			for (const callback of handlers.get(event) ?? []) {
				callback(payload)
			}
		},
		clear() {
			handlers.clear()
		},
	}
}

function stableStringify(value) {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`
	}

	if (value && typeof value === 'object') {
		const entries = Object.entries(value)
			.filter(([, entryValue]) => entryValue !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
		return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`
	}

	return JSON.stringify(value)
}

function makeRecordId(space, key) {
	return `${space}:${key}`
}

function compareRevision(left, right) {
	if (!left && !right) return 0
	if (!left) return -1
	if (!right) return 1

	if (left.timestamp !== right.timestamp) {
		return left.timestamp > right.timestamp ? 1 : -1
	}

	if (left.counter !== right.counter) {
		return left.counter > right.counter ? 1 : -1
	}

	return String(left.nodeId).localeCompare(String(right.nodeId))
}

function compareFrozenWinner(left, right) {
	if (!left && !right) return 0
	if (!left) return 1
	if (!right) return -1

	if (left.timestamp !== right.timestamp) {
		return left.timestamp < right.timestamp ? -1 : 1
	}

	if (left.counter !== right.counter) {
		return left.counter < right.counter ? -1 : 1
	}

	return String(left.nodeId).localeCompare(String(right.nodeId))
}

function shouldReplaceRecord(existingRecord, nextEnvelope) {
	if (!existingRecord) return true
	if (nextEnvelope.space === FROZEN_SPACE) {
		return compareFrozenWinner(existingRecord.revision, nextEnvelope.revision) > 0
	}
	return compareRevision(nextEnvelope.revision, existingRecord.revision) >= 0
}

function normalizePayloadValue(value) {
	if (typeof value === 'string') return value
	return JSON.stringify(value)
}

function cloneRecord(record) {
	if (!record) return null
	return {
		...record,
		author: record.author ? { ...record.author } : null,
		revision: record.revision ? { ...record.revision } : null,
		encrypted: record.encrypted ? { ...record.encrypted } : null,
	}
}

export function canWriteRecord(space, existingRecord, authorPub) {
	if (!WRITEABLE_SPACES.has(space)) return false
	if (!existingRecord) return true

	if (space === PUBLIC_SPACE) return true
	if (space === FROZEN_SPACE) return false

	return existingRecord.author?.pub === authorPub
}

export function canReadRecord(record, authorPub) {
	if (!record) return false
	if (record.space !== PRIVATE_SPACE) return true
	return record.author?.pub === authorPub
}

function canAcceptEnvelope(space, existingRecord, authorPub) {
	if (!WRITEABLE_SPACES.has(space)) return false
	if (!existingRecord) return true
	if (space === PUBLIC_SPACE || space === FROZEN_SPACE) return true
	return existingRecord.author?.pub === authorPub
}

export class DistributedStorage {
	constructor({ mesh, gossip, authorKeys, getClientId, logger = console }) {
		this.mesh = mesh
		this.gossip = gossip
		this.authorKeys = authorKeys
		this.getClientId = typeof getClientId === 'function' ? getClientId : () => null
		this.logger = logger
		this.records = new Map()
		this.emitter = createEmitter()
		this.meshHandlers = []
		this.gossipHandlers = []
		this.logicalClock = 0
		this.pendingQueries = new Map()
	}

	attach() {
		if (!this.mesh || !this.gossip) {
			throw new Error('DistributedStorage requires mesh and gossip instances')
		}

		this.#registerMeshHandler('peer:connected', (peerId) => {
			this.requestSync(peerId)
		})

		this.#registerGossipHandler('messageReceived', ({ message, local }) => {
			if (local) return
			this.#handleInboundPayload(message.data, { origin: message.sender, transport: 'gossip' })
		})

		this.#registerGossipHandler('directMessageReceived', ({ message }) => {
			this.#handleInboundPayload(message.data, { origin: message.from || message.sender, transport: 'direct' })
		})

		return this
	}

	destroy() {
		for (const [eventName, handler] of this.meshHandlers) {
			this.mesh?.off(eventName, handler)
		}
		for (const [eventName, handler] of this.gossipHandlers) {
			this.gossip?.off(eventName, handler)
		}
		this.meshHandlers = []
		this.gossipHandlers = []
		for (const pendingQuery of this.pendingQueries.values()) {
			clearTimeout(pendingQuery.timeoutId)
			pendingQuery.resolve([])
		}
		this.pendingQueries.clear()
		this.emitter.clear()
	}

	on(eventName, callback) {
		return this.emitter.on(eventName, callback)
	}

	subscribe(filter, callback) {
		return this.on('change', (event) => {
			if (filter?.space && event.record.space !== filter.space) return
			if (filter?.key && event.record.key !== filter.key) return
			callback(event)
		})
	}

	get(space, key, options = {}) {
		const record = this.records.get(makeRecordId(space, key))
		if (!record) return null
		if (!canReadRecord(record, this.authorKeys?.pub)) {
			return options.includeOpaque ? { ...cloneRecord(record), value: undefined } : null
		}
		return cloneRecord(record)
	}

	list(options = {}) {
		const items = []
		for (const record of this.records.values()) {
			if (options.space && record.space !== options.space) continue
			if (!options.includeOpaque && !canReadRecord(record, this.authorKeys?.pub)) continue
			items.push(this.get(record.space, record.key, options))
		}
		return items
			.filter(Boolean)
			.sort((left, right) => compareRevision(right.revision, left.revision))
	}

	async put({ space, key, value }) {
		if (!WRITEABLE_SPACES.has(space)) {
			throw new Error(`Unsupported storage space: ${space}`)
		}
		if (!key || typeof key !== 'string') {
			throw new Error('Storage key must be a non-empty string')
		}
		if (!this.authorKeys?.priv || !this.authorKeys?.pub || !this.authorKeys?.epub || !this.authorKeys?.epriv) {
			throw new Error('Author keypair is required for storage writes')
		}

		const recordId = makeRecordId(space, key)
		const existingRecord = this.records.get(recordId)
		if (!canWriteRecord(space, existingRecord, this.authorKeys.pub)) {
			throw new Error(`Space ${space} is not writable with the active author keypair`)
		}

		const normalizedValue = normalizePayloadValue(value)
		const revision = {
			timestamp: Date.now(),
			counter: ++this.logicalClock,
			nodeId: this.getClientId() ?? this.authorKeys.pub,
		}

		const envelope = {
			protocol: STORAGE_PROTOCOL,
			kind: STORAGE_MESSAGE_KIND,
			space,
			key,
			author: {
				peerId: this.getClientId() ?? null,
				pub: this.authorKeys.pub,
				epub: this.authorKeys.epub,
			},
			revision,
			mutationId: `${revision.nodeId}:${revision.timestamp}:${revision.counter}:${space}:${key}`,
		}

		if (space === PRIVATE_SPACE) {
			envelope.visibility = 'encrypted'
			envelope.encrypted = await encryptMessageWithMeta(normalizedValue, { epub: this.authorKeys.epub })
		} else {
			envelope.visibility = 'plain'
			envelope.value = normalizedValue
		}

		envelope.signature = await signMessage(stableStringify(envelope), this.authorKeys.priv)

		const appliedRecord = await this.#ingestEnvelope(envelope, { origin: this.getClientId(), transport: 'local' })
		this.gossip.broadcast(JSON.stringify(envelope))
		return appliedRecord
	}

	requestSync(peerId) {
		if (!peerId) return
		const payload = {
			protocol: STORAGE_PROTOCOL,
			kind: STORAGE_SYNC_REQUEST_KIND,
			requester: this.getClientId() ?? null,
			knownRecords: Array.from(this.records.keys()),
		}
		this.gossip.sendDirect(peerId, JSON.stringify(payload))
	}

	async query({ space, key = null, peerId = null, timeoutMs = 1500 } = {}) {
		if (!space || !WRITEABLE_SPACES.has(space)) {
			throw new Error('Query requires a valid storage space')
		}

		const peers = peerId ? [peerId] : this.#getQueryablePeers()
		if (peers.length === 0) {
			return []
		}

		const requestId = `${this.getClientId() ?? this.authorKeys?.pub ?? 'peer'}:${Date.now()}:${Math.random().toString(36).slice(2)}`
		const payload = {
			protocol: STORAGE_PROTOCOL,
			kind: STORAGE_QUERY_REQUEST_KIND,
			requestId,
			requester: this.getClientId() ?? null,
			space,
			key,
		}

		const responsePromise = new Promise((resolve) => {
			const timeoutId = setTimeout(() => {
				const pendingQuery = this.pendingQueries.get(requestId)
				if (!pendingQuery) return
				this.pendingQueries.delete(requestId)
				resolve(pendingQuery.responses)
			}, timeoutMs)

			this.pendingQueries.set(requestId, {
				responses: [],
				resolve,
				timeoutId,
				expectedPeers: new Set(peers),
			})
		})

		const encoded = JSON.stringify(payload)
		for (const targetPeerId of peers) {
			this.gossip.sendDirect(targetPeerId, encoded)
		}

		return responsePromise
	}

	#registerMeshHandler(eventName, handler) {
		this.mesh.on(eventName, handler)
		this.meshHandlers.push([eventName, handler])
	}

	#registerGossipHandler(eventName, handler) {
		this.gossip.on(eventName, handler)
		this.gossipHandlers.push([eventName, handler])
	}

	#getQueryablePeers() {
		try {
			return Array.from(new Set(this.mesh?.getConnectedPeers?.() ?? [])).filter(Boolean)
		} catch {
			return []
		}
	}

	async #handleInboundPayload(rawPayload, context) {
		let payload
		try {
			payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload
		} catch {
			return
		}

		if (payload?.protocol !== STORAGE_PROTOCOL) return

		if (payload.kind === STORAGE_MESSAGE_KIND) {
			await this.#ingestEnvelope(payload, context)
			return
		}

		if (payload.kind === STORAGE_SYNC_REQUEST_KIND) {
			this.#sendSyncResponse(context.origin, payload.knownRecords)
			return
		}

		if (payload.kind === STORAGE_SYNC_RESPONSE_KIND) {
			for (const envelope of payload.records ?? []) {
				await this.#ingestEnvelope(envelope, { origin: context.origin, transport: 'sync' })
			}
			this.emitter.emit('sync', {
				peerId: context.origin,
				recordCount: Array.isArray(payload.records) ? payload.records.length : 0,
			})
			return
		}

		if (payload.kind === STORAGE_QUERY_REQUEST_KIND) {
			this.#sendQueryResponse(context.origin, payload)
			return
		}

		if (payload.kind === STORAGE_QUERY_RESPONSE_KIND) {
			await this.#handleQueryResponse(payload, context)
		}
	}

	#sendSyncResponse(peerId, knownRecords = []) {
		if (!peerId) return
		const knownRecordSet = new Set(Array.isArray(knownRecords) ? knownRecords : [])
		const records = Array.from(this.records.values())
			.filter((record) => !knownRecordSet.has(makeRecordId(record.space, record.key)))
			.map((record) => record.envelope)
		const payload = {
			protocol: STORAGE_PROTOCOL,
			kind: STORAGE_SYNC_RESPONSE_KIND,
			records,
		}
		this.gossip.sendDirect(peerId, JSON.stringify(payload))
	}

	#sendQueryResponse(peerId, request) {
		if (!peerId || !request?.requestId || !request?.space) return

		const records = Array.from(this.records.values())
			.filter((record) => record.space === request.space)
			.filter((record) => request.key ? record.key === request.key : true)
			.map((record) => record.envelope)

		const payload = {
			protocol: STORAGE_PROTOCOL,
			kind: STORAGE_QUERY_RESPONSE_KIND,
			requestId: request.requestId,
			space: request.space,
			key: request.key ?? null,
			records,
		}

		this.gossip.sendDirect(peerId, JSON.stringify(payload))
	}

	async #handleQueryResponse(payload, context) {
		const pendingQuery = this.pendingQueries.get(payload?.requestId)
		if (!pendingQuery) {
			for (const envelope of payload?.records ?? []) {
				await this.#ingestEnvelope(envelope, { origin: context.origin, transport: 'query' })
			}
			return
		}

		for (const envelope of payload.records ?? []) {
			await this.#ingestEnvelope(envelope, { origin: context.origin, transport: 'query' })
		}

		pendingQuery.responses.push({
			peerId: context.origin,
			recordCount: Array.isArray(payload.records) ? payload.records.length : 0,
			space: payload.space,
			key: payload.key,
		})
		pendingQuery.expectedPeers.delete(context.origin)

		if (pendingQuery.expectedPeers.size === 0) {
			clearTimeout(pendingQuery.timeoutId)
			this.pendingQueries.delete(payload.requestId)
			pendingQuery.resolve(pendingQuery.responses)
		}

		this.emitter.emit('query', {
			peerId: context.origin,
			space: payload.space,
			key: payload.key,
			recordCount: Array.isArray(payload.records) ? payload.records.length : 0,
		})
	}

	async #ingestEnvelope(envelope, context) {
		if (!envelope?.signature || !envelope?.author?.pub || !envelope?.space || !envelope?.key) {
			return null
		}

		const verified = await verifyMessage(
			stableStringify({ ...envelope, signature: undefined }),
			envelope.signature,
			envelope.author.pub,
		)
		if (!verified) {
			this.logger.warn?.('Dropped storage mutation with invalid signature', envelope)
			return null
		}

		const recordId = makeRecordId(envelope.space, envelope.key)
		const existingRecord = this.records.get(recordId)
		if (!canAcceptEnvelope(envelope.space, existingRecord, envelope.author.pub)) {
			return existingRecord ?? null
		}
		if (!shouldReplaceRecord(existingRecord, envelope)) {
			return existingRecord ?? null
		}

		let value
		if (envelope.visibility === 'encrypted') {
			if (envelope.author.pub === this.authorKeys?.pub && envelope.encrypted) {
				try {
					value = await decryptMessageWithMeta(envelope.encrypted, this.authorKeys.epriv)
				} catch {
					value = undefined
				}
			}
		} else {
			value = envelope.value
		}

		const record = {
			id: recordId,
			space: envelope.space,
			key: envelope.key,
			value,
			author: { ...envelope.author },
			revision: { ...envelope.revision },
			visibility: envelope.visibility,
			encrypted: envelope.encrypted ? { ...envelope.encrypted } : null,
			envelope: {
				...envelope,
				author: { ...envelope.author },
				revision: { ...envelope.revision },
				encrypted: envelope.encrypted ? { ...envelope.encrypted } : undefined,
			},
			updatedAt: Date.now(),
		}

		this.records.set(recordId, record)
		const snapshot = this.get(record.space, record.key, { includeOpaque: true })
		this.emitter.emit('change', {
			record: snapshot,
			origin: context.origin,
			transport: context.transport,
		})
		return snapshot
	}
}