<template>
  <div class="container">
    <!-- App chrome: header + tabs + conn-bar as one unit -->
    <div class="app-chrome">
      <!-- Header -->
      <header>
        <h1>🐦 PeerPigeon</h1>
        <p>Browser P2P networking with gossip-protocol</p>
        <div class="peer-info">
          <span><strong>Peer ID:</strong> <code>{{ clientId ? clientId.slice(0, 16) + '…' : 'Initializing…' }}</code></span>
          <span><strong>Status:</strong>
            <span :class="['status', signalingStatus]">{{ signalingLabel }}</span>
          </span>
        </div>
      </header>

      <!-- Tab nav -->
      <nav class="feature-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab-btn', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>

      <!-- Compact connection bar — always visible -->
      <div class="conn-bar">
        <div class="conn-bar__inputs">
          <input class="conn-bar__input" v-model="config.sessionId" placeholder="Session ID" />
          <input class="conn-bar__input conn-bar__input--wide" v-model="config.signalingServer" placeholder="wss://signaling-url…" />
          <input class="conn-bar__input conn-bar__input--num" type="number" v-model.number="config.minPeers" min="1" max="20" title="Min peers" placeholder="Min" />
          <input class="conn-bar__input conn-bar__input--num" type="number" v-model.number="config.maxPeers" min="1" max="20" title="Max peers" placeholder="Max" />
        </div>
        <div class="conn-bar__actions">
          <label class="conn-bar__check"><input type="checkbox" v-model="config.autoConnect" /> Auto</label>
          <label class="conn-bar__check"><input type="checkbox" v-model="config.autoDiscover" /> Discover</label>
          <div class="conn-bar__sep"></div>
          <div class="conn-bar__peers-wrap" v-if="connected">
            <span class="conn-bar__peers">👥 {{ rtcConnectedPeerIds.length }} peer{{ rtcConnectedPeerIds.length === 1 ? '' : 's' }}</span>
            <div v-if="rtcConnectedPeerIds.length > 0" class="conn-bar__peers-popover">
              <p class="conn-bar__peers-title">Connected peers</p>
              <p v-if="rtcConnectedPeerIds.length === 0" class="empty-state">No peers connected</p>
              <div v-else class="peers-list">
                <div v-for="id in rtcConnectedPeerIds" :key="id" class="peer-item">
                  <code>{{ id.slice(0, 16) }}…</code>
                  <button class="peer-copy-btn" :class="{ copied: copiedPeer === id }" @click.stop="copyPeer(id)" :title="'Copy full ID'">
                    {{ copiedPeer === id ? '✓' : '⎘' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <button class="btn primary" :disabled="connected" @click="doConnect">Connect</button>
          <button class="btn secondary" :disabled="!connected" @click="doDisconnect">Disconnect</button>
        </div>
      </div>
    </div>

    <main>
      <!-- CONNECTION TAB -->
      <section v-show="activeTab === 'connection'">
        <h2>💬 Messaging</h2>

        <div class="card chat-card chat-card--broadcast">
          <h3>📢 Broadcast</h3>
          <p class="description">Messages sent to all peers in the mesh.</p>
          <div class="chat-window">
            <div ref="broadcastHistoryEl" class="chat-messages">
              <p v-if="broadcastMessages.length === 0" class="empty-state">No broadcast messages yet.</p>
              <div
                v-for="(msg, index) in broadcastMessages"
                :key="`broadcast-${index}-${msg.from}-${msg.text}`"
                :class="['chat-message', msg.local ? 'chat-message--local' : 'chat-message--remote']"
              >
                <div class="msg-meta">
                  <span class="msg-route">Route: {{ messageRouteLabel(msg) }}</span>
                  <span>{{ msg.local ? 'You' : (msg.from ? msg.from.slice(0, 16) + '…' : 'Unknown') }}</span>
                  <span v-if="msg.encrypted">🔒</span>
                  <span v-if="!msg.local && Number.isFinite(msg.deliveryMs)">⏱ {{ msg.deliveryMs }} ms</span>
                </div>
                <div class="msg-text"><strong class="route-prefix">[{{ messageRouteLabel(msg).toUpperCase() }}]</strong> {{ msg.text }}</div>
              </div>
            </div>
            <div class="chat-input-row">
              <textarea v-model="broadcastDraft" rows="3" placeholder="Type your broadcast message…" :disabled="!connected" @keydown.enter.exact.prevent="sendBroadcast"></textarea>
              <div class="chat-actions">
                <span class="checkbox-label">🔒 Always encrypted</span>
                <button class="btn primary" :disabled="!connected || !broadcastDraft.trim()" @click="sendBroadcast">📢 Send</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card chat-card chat-card--direct">
          <h3>📧 Direct Message</h3>
          <p class="description">Private chat with a selected peer.</p>
          <div class="chat-window">
            <div class="chat-header">
              <label>Target Peer:</label>
              <select v-model="dmTarget">
                <option value="">Select a peer to chat with…</option>
                <option v-for="id in discoveredPeers" :key="id" :value="id">{{ id.slice(0, 16) }}… {{ rtcConnectedPeerIds.includes(id) ? '' : '(indirect)' }}</option>
              </select>
            </div>
            <div ref="directHistoryEl" class="chat-messages">
              <p v-if="!dmTarget" class="empty-state">Choose a peer to start a direct conversation.</p>
              <p v-else-if="directConversationMessages.length === 0" class="empty-state">No direct messages with this peer yet.</p>
              <div
                v-for="(msg, index) in directConversationMessages"
                :key="`direct-${index}-${msg.from}-${msg.text}`"
                :class="['chat-message', msg.local ? 'chat-message--local' : 'chat-message--remote']"
              >
                <div class="msg-meta">
                  <span class="msg-route">Route: {{ messageRouteLabel(msg) }}</span>
                  <span>{{ msg.local ? 'You' : (msg.from ? msg.from.slice(0, 16) + '…' : 'Unknown') }}</span>
                  <span v-if="msg.to">→ {{ msg.to.slice(0, 16) }}…</span>
                  <span v-if="msg.encrypted">🔒</span>
                  <span v-if="!msg.local && Number.isFinite(msg.deliveryMs)">⏱ {{ msg.deliveryMs }} ms</span>
                </div>
                <div class="msg-text"><strong class="route-prefix">[{{ messageRouteLabel(msg).toUpperCase() }}]</strong> {{ msg.text }}</div>
              </div>
            </div>
            <div class="chat-input-row">
              <textarea v-model="dmDraft" rows="3" placeholder="Type your direct message…" :disabled="!connected || !dmTarget" @keydown.enter.exact.prevent="sendDirect"></textarea>
              <div class="chat-actions">
                <button class="btn primary" :disabled="!connected || !dmTarget || !dmDraft.trim()" @click="sendDirect">📧 Send</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- STUB TABS -->
      <section v-show="activeTab === 'media'">
        <h2>🎥 Media Management</h2>
        <div class="card stub-card">
          <p>🚧 Media features coming soon.</p>
        </div>
      </section>

      <section v-show="activeTab === 'dht'">
        <h2>🗄️ Distributed Storage</h2>
        <div class="storage-grid">
          <div class="card">
            <h3>✍️ Write Record</h3>
            <p class="description">{{ storageSpaceDescription }}</p>

            <div class="input-group">
              <label>Space</label>
              <select v-model="storageDraft.space">
                <option v-for="space in storageSpaceOptions" :key="space.id" :value="space.id">{{ space.label }}</option>
              </select>
            </div>

            <div class="input-group">
              <label>Key</label>
              <input v-model="storageDraft.key" placeholder="profile/display-name" :disabled="!connected" />
            </div>

            <div class="input-group">
              <label>Value</label>
              <textarea v-model="storageDraft.value" rows="6" placeholder="Value to replicate through the mesh" :disabled="!connected"></textarea>
              <small>Private values are replicated encrypted and only readable by the author.</small>
            </div>

            <div class="button-group">
              <button class="btn primary" :disabled="!connected || !storageDraft.key.trim() || !storageDraft.value.trim()" @click="writeStorageRecord">
                {{ storageDraft.space === STORAGE_SPACES.FROZEN ? 'Create Immutable Record' : 'Replicate Record' }}
              </button>
            </div>

            <p v-if="storageNotice" class="storage-notice">{{ storageNotice }}</p>
          </div>

          <div class="card">
            <h3>🔎 Browse Space</h3>
            <p class="description">Records update live from local writes, gossip propagation, and late-join sync.</p>

            <div class="storage-toolbar">
              <select v-model="storageView.space">
                <option v-for="space in storageSpaceOptions" :key="`view-${space.id}`" :value="space.id">{{ space.label }}</option>
              </select>
              <input v-model="storageView.key" placeholder="Optional key lookup" />
              <button class="btn tertiary" :disabled="!connected || storageQuerying" @click="queryStorageRecords">
                {{ storageView.key.trim() ? 'Query Key' : 'Query Space' }}
              </button>
            </div>

            <div class="storage-records">
              <p v-if="storageLookupRecord" class="storage-lookup-label">Selected key</p>
              <div v-if="storageLookupRecord" class="storage-record">
                <div class="storage-record__meta">
                  <strong>{{ storageLookupRecord.key }}</strong>
                  <span>{{ storageLookupRecord.space }}</span>
                  <span>{{ storageLookupRecord.author?.peerId ? storageLookupRecord.author.peerId.slice(0, 16) + '…' : 'offline author' }}</span>
                </div>
                <pre>{{ storageLookupValue }}</pre>
              </div>

              <p v-if="storageRecords.length === 0" class="empty-state">No visible records in this space yet.</p>
              <div v-for="record in storageRecords" :key="record.id" class="storage-record">
                <div class="storage-record__meta">
                  <strong>{{ record.key }}</strong>
                  <span>{{ record.space }}</span>
                  <span>{{ record.author?.peerId ? record.author.peerId.slice(0, 16) + '…' : 'offline author' }}</span>
                </div>
                <pre>{{ formatStorageRecordValue(record) }}</pre>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>📡 Subscriptions</h3>
            <p class="description">Event-driven updates emitted by the storage runtime.</p>

            <div class="storage-events">
              <p v-if="storageEvents.length === 0" class="empty-state">No storage events yet.</p>
              <div v-for="event in storageEvents" :key="event.id" class="storage-event">
                <div class="storage-event__header">
                  <strong>{{ event.label }}</strong>
                  <span>{{ event.transport }}</span>
                </div>
                <p>{{ event.summary }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'crypto'">
        <h2>🔐 Encryption</h2>
        <div class="card stub-card">
          <p>🚧 Crypto features coming soon.</p>
        </div>
      </section>

      <section v-show="activeTab === 'network'">
        <h2>📡 Network Info</h2>
        <div class="network-grid">
          <div class="card">
            <h3>Mesh Snapshot</h3>
            <div class="network-kpis">
              <div class="network-kpi">
                <span class="network-kpi__label">Connected (RTC)</span>
                <strong class="network-kpi__value">{{ networkDirectCount }}</strong>
              </div>
              <div class="network-kpi">
                <span class="network-kpi__label">Discovered</span>
                <strong class="network-kpi__value">{{ discoveredPeers.length }}</strong>
              </div>
              <div class="network-kpi">
                <span class="network-kpi__label">Direct RTC</span>
                <strong class="network-kpi__value">{{ networkDirectCount }}</strong>
              </div>
              <div class="network-kpi">
                <span class="network-kpi__label">Relay Only</span>
                <strong class="network-kpi__value">{{ networkRelayCount }}</strong>
              </div>
            </div>
          </div>

          <div class="card">
            <h3>Peer Table</h3>
            <p v-if="networkPeerRows.length === 0" class="empty-state">No peers discovered yet.</p>
            <div v-else class="network-table-wrap">
              <table class="network-table">
                <thead>
                  <tr>
                    <th>Peer</th>
                    <th>Disc</th>
                    <th>Conn</th>
                    <th>Browser</th>
                    <th>Transport</th>
                    <th title="RTCDataChannel.readyState (open/connecting/closing/closed/no-channel/—)">DC State</th>
                    <th title="peerEntries entry.relayOnly flag">Relay Only</th>
                    <th>Key</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in networkPeerRows" :key="row.peerId">
                    <td><code>{{ row.shortId }}</code></td>
                    <td>{{ row.discovered ? 'yes' : 'no' }}</td>
                    <td>{{ row.connected ? 'yes' : 'no' }}</td>
                    <td>{{ row.browser }}</td>
                    <td>{{ row.transport }}</td>
                    <td>{{ row.dcState }}</td>
                    <td>{{ row.relayOnly }}</td>
                    <td>{{ row.hasEpub ? 'yes' : 'no' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <h3>Recent Signaling Logs</h3>
            <p v-if="networkLogs.length === 0" class="empty-state">No signaling logs yet.</p>
            <div v-else class="network-logs">
              <div v-for="entry in networkLogs" :key="entry.id" class="network-log-entry">
                <span class="network-log-entry__time">{{ entry.time }}</span>
                <code>{{ entry.message }}</code>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'testing'">
        <h2>🧪 API Testing</h2>
        <div class="card stub-card">
          <p>🚧 API testing coming soon.</p>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, reactive, watch } from 'vue'
import { PartialMesh, GossipProtocol } from 'gossip-protocol'
import { generateRandomPair, encryptMessageWithMeta, decryptMessageWithMeta } from 'unsea'
import { DistributedStorage, STORAGE_SPACES, collectPeerIds, getPeerDataChannelState } from '../../src/index.js'

// ── State ────────────────────────────────────────────────────────────────────
const activeTab = ref('connection')
const tabs = [
  { id: 'connection', label: '💬 Messaging' },
  { id: 'media',      label: '🎥 Media' },
  { id: 'dht',        label: '🗄️ DHT & Storage' },
  { id: 'crypto',     label: '🔐 Encryption' },
  { id: 'network',    label: '📡 Network Info' },
  { id: 'testing',    label: '🧪 API Testing' },
]

function getUrlSessionId() {
  try {
    const href = globalThis.location?.href
    if (!href) return ''

    const url = new URL(href)
    const fromQuery = (url.searchParams.get('sessionId') || url.searchParams.get('session') || '').trim()
    if (fromQuery) return fromQuery

    const hash = String(url.hash || '')
    const hashMatch = hash.match(/(?:^#|[?&])(sessionId|session)=([^&]+)/i)
    if (hashMatch?.[2]) {
      return decodeURIComponent(hashMatch[2]).trim()
    }
  } catch {}

  return ''
}

function parseUrlBoolean(raw) {
  if (raw == null) return undefined
  const value = String(raw).trim().toLowerCase()
  if (!value) return undefined
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return undefined
}

function parseUrlInteger(raw, min, max) {
  if (raw == null) return undefined
  const value = Number(String(raw).trim())
  if (!Number.isFinite(value)) return undefined
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function getUrlConfigOverrides() {
  try {
    const href = globalThis.location?.href
    if (!href) return {}

    const url = new URL(href)
    const params = url.searchParams
    const overrides = {}

    const sessionId = (params.get('sessionId') || params.get('session') || '').trim()
    if (sessionId) {
      overrides.sessionId = sessionId
    }

    const signalingServer = (params.get('signalingServer') || params.get('signal') || params.get('ws') || '').trim()
    if (signalingServer) {
      overrides.signalingServer = signalingServer
    }

    const minPeers = parseUrlInteger(params.get('minPeers') || params.get('min'), 1, 20)
    if (minPeers !== undefined) {
      overrides.minPeers = minPeers
    }

    const maxPeers = parseUrlInteger(params.get('maxPeers') || params.get('max'), 1, 20)
    if (maxPeers !== undefined) {
      overrides.maxPeers = maxPeers
    }

    const autoConnect = parseUrlBoolean(params.get('autoConnect') || params.get('auto'))
    if (autoConnect !== undefined) {
      overrides.autoConnect = autoConnect
    }

    const autoDiscover = parseUrlBoolean(params.get('autoDiscover') || params.get('discover'))
    if (autoDiscover !== undefined) {
      overrides.autoDiscover = autoDiscover
    }

    if (overrides.minPeers !== undefined && overrides.maxPeers !== undefined && overrides.minPeers > overrides.maxPeers) {
      const swap = overrides.minPeers
      overrides.minPeers = overrides.maxPeers
      overrides.maxPeers = swap
    }

    return overrides
  } catch {
    return {}
  }
}

function syncUrlWithConfig(currentConfig) {
  try {
    const href = globalThis.location?.href
    if (!href || !globalThis.history?.replaceState) return

    const url = new URL(href)
    const params = url.searchParams

    params.set('sessionId', String(currentConfig?.sessionId ?? ''))
    params.set('signal', String(currentConfig?.signalingServer ?? ''))
    params.set('min', String(Number(currentConfig?.minPeers ?? defaultConfig.minPeers)))
    params.set('max', String(Number(currentConfig?.maxPeers ?? defaultConfig.maxPeers)))
    params.set('auto', currentConfig?.autoConnect ? '1' : '0')
    params.set('discover', currentConfig?.autoDiscover ? '1' : '0')

    const nextUrl = `${url.pathname}?${params.toString()}${url.hash || ''}`
    const currentUrl = `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash || ''}`
    if (nextUrl !== currentUrl) {
      globalThis.history.replaceState(null, '', nextUrl)
    }
  } catch {}
}

function getDefaultSessionId() {
  const fallback = 'peerpigeon-demo'

  try {
    let randomPart = ''
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(6)
      globalThis.crypto.getRandomValues(bytes)
      randomPart = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
    } else {
      randomPart = Math.random().toString(36).slice(2, 14)
    }

    return `peerpigeon-${randomPart}`
  } catch {
    return fallback
  }
}

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

const FIREFOX_ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
]

const DEFAULT_SIGNALING_SERVER = 'wss://peer.ooo/ws'

const defaultConfig = {
  sessionId: getUrlSessionId() || getDefaultSessionId(),
  signalingServer: DEFAULT_SIGNALING_SERVER,
  minPeers: 1,
  maxPeers: 5,
  autoConnect: true,
  autoDiscover: true,
  iceServers: DEFAULT_ICE_SERVERS,
}

const config = ref({
  ...defaultConfig,
  ...getUrlConfigOverrides(),
})

const clientId        = ref(null)
const connected       = ref(false)
const signalingStatus = ref('disconnected')
const connectedPeers  = ref([])
const discoveredPeers = ref([])
const copiedPeer      = ref(null)
const messages             = ref([])
let connectionSyncTimer = null
let keySyncTimer = null
let tableRefreshTimer = null
const tableRefreshTick     = ref(0)
const peerBrowsers         = reactive({})
const broadcastDraft       = ref('')
const dmTarget             = ref('')
const dmDraft              = ref('')
const broadcastHistoryEl   = ref(null)
const directHistoryEl      = ref(null)
const peerEpubs            = reactive({})
const storageDraft         = reactive({ space: STORAGE_SPACES.PUBLIC, key: 'welcome', value: 'Hello from PeerPigeon storage' })
const storageView          = reactive({ space: STORAGE_SPACES.PUBLIC, key: '' })
const storageRecords       = ref([])
const storageEvents        = ref([])
const storageNotice        = ref('')
const storageQuerying      = ref(false)
const networkLogs          = ref([])

const storageSpaceOptions = [
  { id: STORAGE_SPACES.USER, label: 'user' },
  { id: STORAGE_SPACES.PUBLIC, label: 'public' },
  { id: STORAGE_SPACES.FROZEN, label: 'frozen' },
  { id: STORAGE_SPACES.PRIVATE, label: 'private' },
]

const storageSpaceDescriptions = {
  [STORAGE_SPACES.USER]: 'Readable by everyone, but once created only the author keypair can update it.',
  [STORAGE_SPACES.PUBLIC]: 'Readable and writable by any peer in the mesh.',
  [STORAGE_SPACES.FROZEN]: 'First-write-wins and stays immutable after replication converges.',
  [STORAGE_SPACES.PRIVATE]: 'Replicated through the mesh as ciphertext; only the author can read or update it.',
}

const broadcastMessages = computed(() =>
  messages.value.filter(m => m.type === 'broadcast')
)

const directConversationMessages = computed(() =>
  dmTarget.value
    ? messages.value.filter(m =>
        m.type === 'direct' && (m.to === dmTarget.value || m.from === dmTarget.value)
      )
    : []
)

const storageSpaceDescription = computed(() => storageSpaceDescriptions[storageDraft.space] ?? '')

const storageLookupRecord = computed(() => {
  if (!distributedStorage || !storageView.key.trim()) return null
  return distributedStorage.get(storageView.space, storageView.key.trim(), { includeOpaque: true })
})

const storageLookupValue = computed(() => {
  if (!storageLookupRecord.value) return ''
  return formatStorageRecordValue(storageLookupRecord.value)
})

const signalingLabel = computed(() => ({
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
}[signalingStatus.value] ?? 'Disconnected'))

const TRANSPORT_ORDER = {
  'ws-relay': 0,
  'relay-candidate': 1,
  webrtc: 2,
  negotiating: 3,
  discovered: 4,
  unknown: 5,
}

function getNetworkTransport(entry, transportConnected, rtcConnected, discovered) {
  if (rtcConnected) return 'webrtc'
  if (transportConnected && entry?.relayOnly) return 'ws-relay'
  if (entry) return 'negotiating'
  if (discovered) return 'discovered'
  return 'unknown'
}

const networkPeerRows = computed(() => {
  void tableRefreshTick.value // reactive dependency so readyState stays live

  return collectPeerIds({
    connectedPeers: connectedPeers.value,
    discoveredPeers: discoveredPeers.value,
    mesh,
  })
    .filter(Boolean)
    .map((peerId) => {
      const entry = getMeshConnectionEntry(peerId)
      const transportConnected = connectedPeers.value.includes(peerId) || Boolean(entry?.connected)
      const discovered = discoveredPeers.value.includes(peerId)
      // Raw values straight from the library — no formatting
      const dcState = getPeerDataChannelState(mesh, peerId) // RTCDataChannel.readyState or null
      const rtcConnected = dcState === 'open'
      const transport = getNetworkTransport(entry, transportConnected, rtcConnected, discovered)

      return {
        peerId,
        shortId: peerId.length > 16 ? `${peerId.slice(0, 16)}…` : peerId,
        discovered,
        connected: rtcConnected,
        transport,
        // Raw field: RTCDataChannel.readyState, 'no-channel' if entry exists but channel is null, '—' if no entry
        dcState: entry ? (dcState ?? 'no-channel') : '—',
        // Raw field: the relayOnly flag directly from peerEntries
        relayOnly: entry ? (entry.relayOnly ? 'yes' : 'no') : '—',
        hasEpub: Boolean(peerEpubs[peerId]),
        browser: peerBrowsers[peerId] ?? '—',
      }
    })
    .sort((a, b) => {
      const ta = TRANSPORT_ORDER[a.transport] ?? 99
      const tb = TRANSPORT_ORDER[b.transport] ?? 99
      if (ta !== tb) return ta - tb
      return a.peerId.localeCompare(b.peerId)
    })
})

const networkDirectCount = computed(() =>
  networkPeerRows.value.filter((row) => row.transport === 'webrtc').length
)

const networkRelayCount = computed(() =>
  networkPeerRows.value.filter((row) => row.transport === 'ws-relay' || row.transport === 'relay-candidate').length
)

const rtcConnectedPeerIds = computed(() =>
  connectedPeers.value.filter((peerId) => isDirectRtcConnected(peerId))
)

watch(config, (nextConfig) => {
  syncUrlWithConfig(nextConfig)
}, { deep: true })

// ── Mesh / Gossip ────────────────────────────────────────────────────────────
let mesh           = null
let gossip         = null
let myKeys         = null
let distributedStorage = null
let meshEventHandlers = []
let gossipEventHandlers = []
let stopStorageChangeSubscription = null
let stopStorageSyncSubscription = null
let stopStorageQuerySubscription = null
let manuallyDisconnected = false
const DEBUG_SIGNALING_LOGS = false

function detectBrowser() {
  const ua = navigator.userAgent
  if (/firefox/i.test(ua)) return 'Firefox'
  if (/edg\//i.test(ua)) return 'Edge'
  if (/opr\//i.test(ua)) return 'Opera'
  if (/chrome|chromium/i.test(ua)) return 'Chrome'
  if (/safari/i.test(ua)) return 'Safari'
  return 'Unknown'
}

function announceLocalKey(peerId = null) {
  if (!gossip || !myKeys?.epub) return
  const payload = JSON.stringify({ __pp_key: true, epub: myKeys.epub, browser: detectBrowser() })
  if (peerId) {
    gossip.sendDirect(peerId, payload)
    return
  }
  gossip.broadcast(payload)
}

function requestPeerKey(peerId) {
  if (!peerId || !gossip) return
  try {
    gossip.sendDirect(peerId, JSON.stringify({ __pp_key_req: true }))
  } catch {}
}

function ensurePeerKey(peerId) {
  if (!peerId) return
  if (!peerEpubs[peerId]) {
    requestPeerKey(peerId)
  }
  announceLocalKey(peerId)
}

function getMeshConnectionEntry(peerId) {
  return mesh?.signalingClient?.client?.mesh?.connections?.get?.(peerId) ?? null
}

function isDirectRtcConnected(peerId) {
  const entry = getMeshConnectionEntry(peerId)
  return Boolean(entry?.connected && !entry?.relayOnly && entry?.channel?.readyState === 'open')
}

function maybeUpgradePeerToRtc(peerId) {
  if (!peerId || !mesh || isDirectRtcConnected(peerId)) return
  try {
    mesh.connectToPeer?.(peerId)
  } catch {}
}

function getDeliveryMs(sentAt) {
  return Number.isFinite(sentAt) ? Math.max(0, Date.now() - sentAt) : undefined
}

function formatStorageRecordValue(record) {
  if (!record) return ''
  if (record.visibility === 'encrypted' && record.value == null) {
    return '[encrypted payload replicated for author only]'
  }
  return record.value ?? ''
}

function pushStorageEvent(entry) {
  storageEvents.value = [
    { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...entry },
    ...storageEvents.value,
  ].slice(0, 40)
}

function pushNetworkLog(message) {
  networkLogs.value = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: new Date().toLocaleTimeString(),
      message,
    },
    ...networkLogs.value,
  ].slice(0, 80)
}

function refreshStorageRecords() {
  storageRecords.value = distributedStorage
    ? distributedStorage.list({ space: storageView.space, includeOpaque: true })
    : []
}

function attachDistributedStorage() {
  if (!mesh || !gossip || !myKeys) return
  distributedStorage = new DistributedStorage({
    mesh,
    gossip,
    authorKeys: myKeys,
    getClientId: () => clientId.value,
    logger: console,
  }).attach()

  stopStorageChangeSubscription = distributedStorage.subscribe({}, ({ record, transport, origin }) => {
    refreshStorageRecords()
    pushStorageEvent({
      label: `${record.space}:${record.key}`,
      transport,
      summary: `${origin || 'local'} updated ${record.space}/${record.key}`,
    })
  })

  stopStorageSyncSubscription = distributedStorage.on('sync', ({ peerId, recordCount }) => {
    refreshStorageRecords()
    pushStorageEvent({
      label: 'sync',
      transport: 'sync',
      summary: `Received ${recordCount} record${recordCount === 1 ? '' : 's'} from ${peerId ? peerId.slice(0, 16) + '…' : 'peer'}`,
    })
  })

  stopStorageQuerySubscription = distributedStorage.on('query', ({ peerId, space, key, recordCount }) => {
    refreshStorageRecords()
    pushStorageEvent({
      label: key ? `${space}:${key}` : `${space}:*`,
      transport: 'query',
      summary: `${peerId ? peerId.slice(0, 16) + '…' : 'peer'} returned ${recordCount} record${recordCount === 1 ? '' : 's'}`,
    })
  })

  refreshStorageRecords()
}

function teardownDistributedStorage() {
  stopStorageChangeSubscription?.()
  stopStorageSyncSubscription?.()
  stopStorageQuerySubscription?.()
  stopStorageChangeSubscription = null
  stopStorageSyncSubscription = null
  stopStorageQuerySubscription = null
  distributedStorage?.destroy()
  distributedStorage = null
  storageRecords.value = []
  storageEvents.value = []
  storageNotice.value = ''
  storageQuerying.value = false
  networkLogs.value = []
}

async function writeStorageRecord() {
  if (!distributedStorage) return
  storageNotice.value = ''

  try {
    const key = storageDraft.key.trim()
    await distributedStorage.put({
      space: storageDraft.space,
      key,
      value: storageDraft.value,
    })
    storageView.space = storageDraft.space
    storageView.key = key
    storageNotice.value = `Replicated ${storageDraft.space}/${key}`
    if (storageDraft.space !== STORAGE_SPACES.FROZEN) {
      storageDraft.value = ''
    }
    refreshStorageRecords()
  } catch (error) {
    storageNotice.value = error instanceof Error ? error.message : 'Storage write failed'
    pushStorageEvent({
      label: 'error',
      transport: 'local',
      summary: storageNotice.value,
    })
  }
}

async function queryStorageRecords() {
  if (!distributedStorage) return

  storageQuerying.value = true
  storageNotice.value = ''

  try {
    const key = storageView.key.trim() || null
    const responses = await distributedStorage.query({
      space: storageView.space,
      key,
    })
    refreshStorageRecords()

    const totalRecords = responses.reduce((sum, response) => sum + response.recordCount, 0)
    storageNotice.value = totalRecords > 0
      ? `Query returned ${totalRecords} record${totalRecords === 1 ? '' : 's'}`
      : 'No peers returned matching records'
  } catch (error) {
    storageNotice.value = error instanceof Error ? error.message : 'Storage query failed'
  } finally {
    storageQuerying.value = false
  }
}

function messageRouteLabel(msg) {
  if (msg?.route === 'local') return 'Local'
  if (msg?.route === 'direct') return 'Direct'
  if (msg?.route === 'gossip') return 'Gossip'
  return msg?.type === 'direct' ? 'Direct' : 'Gossip'
}

async function doConnect() {
  if (signalingStatus.value === 'connecting' || connected.value) return
  if (mesh) {
    doDisconnect()
  }
  manuallyDisconnected = false

  signalingStatus.value = 'connecting'
  myKeys = await generateRandomPair()

  try {
    const hardMaxPeers = Math.max(1, Number(config.value.maxPeers || 0))
    const effectiveMinPeers = Math.min(Number(config.value.minPeers || 0), hardMaxPeers)
    const isFirefox = /firefox/i.test(navigator.userAgent)
    const isSafari = /safari/i.test(navigator.userAgent) && !/chrome|chromium|edg|opr/i.test(navigator.userAgent)
    const runtimeIceServers = isFirefox
      ? [
          ...config.value.iceServers,
          ...FIREFOX_ICE_SERVERS.filter((server) => {
            const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls]
            return !config.value.iceServers.some((existing) => {
              const existingUrls = Array.isArray(existing?.urls) ? existing.urls : [existing?.urls]
              return urls.some((url) => existingUrls.includes(url))
            })
          }),
        ]
      : config.value.iceServers

    mesh = new PartialMesh({
      sessionId: config.value.sessionId,
      signalingServer: config.value.signalingServer,
      minPeers: effectiveMinPeers,
      maxPeers: hardMaxPeers,
      autoConnect: config.value.autoConnect,
      autoDiscover: config.value.autoDiscover,
      iceServers: runtimeIceServers,
      trickleIce: !isFirefox,
      nonInitiatorFallbackDialMs: 0,
      connectionTimeoutMs: isFirefox ? 60000 : 45000,
      maintenanceIntervalMs: isFirefox ? 2000 : 3000,
      underConnectedResetMs: isFirefox ? 15000 : (isSafari ? 75000 : 30000),
    })

    gossip = new GossipProtocol(mesh)

    const registerMeshHandler = (event, handler) => {
      mesh.on(event, handler)
      meshEventHandlers.push([event, handler])
    }
    const registerGossipHandler = (event, handler) => {
      gossip.on(event, handler)
      gossipEventHandlers.push([event, handler])
    }

    const onSignalingConnected = ({ clientId: id }) => {
      clientId.value        = id
      connected.value       = true
      signalingStatus.value = 'connected'
      syncConnectedPeers()
      startConnectionSyncTimer()
      if (!config.value.autoDiscover) {
        mesh.signalingClient?.joinSession(config.value.sessionId)
      }
    }
    registerMeshHandler('signaling:connected', onSignalingConnected)

    registerMeshHandler('signaling:error', (error) => {
      console.error('Signaling error:', error)
      pushNetworkLog(`[signal:error] ${error instanceof Error ? error.message : String(error)}`)
      connected.value = false
      signalingStatus.value = 'disconnected'
    })

    registerMeshHandler('signaling:log', ({ message }) => {
      pushNetworkLog(message)
      if (DEBUG_SIGNALING_LOGS) {
        console.debug(message)
      }
    })

    registerMeshHandler('peer:error', ({ peerId, error }) => {
      console.error(`Peer error (${peerId}):`, error)
      pushNetworkLog(`[peer:error] ${peerId?.slice(0, 16) ?? 'unknown'} ${error instanceof Error ? error.message : String(error)}`)
    })

    registerMeshHandler('peer:discovered', (peerId) => {
      if (peerId && !discoveredPeers.value.includes(peerId))
        discoveredPeers.value = [...discoveredPeers.value, peerId]
    })

    registerMeshHandler('signaling:disconnected', () => {
      connected.value       = false
      signalingStatus.value = 'disconnected'
      syncConnectedPeers()
    })

    registerMeshHandler('peer:connected', (peerId) => {
      syncConnectedPeers()
      if (!discoveredPeers.value.includes(peerId))
        discoveredPeers.value = [...discoveredPeers.value, peerId]
      startKeySyncTimer()
      ensurePeerKey(peerId)
    })

    const cleanupPeerState = (peerId) => {
      discoveredPeers.value = discoveredPeers.value.filter(id => id !== peerId)
      delete peerBrowsers[peerId]
      if (dmTarget.value === peerId) {
        dmTarget.value = ''
      }
      syncConnectedPeers()
      if (connectedPeers.value.length === 0) {
        stopKeySyncTimer()
      }
    }

    registerMeshHandler('peer:disconnected', cleanupPeerState)

    registerMeshHandler('peer:left', cleanupPeerState)

    // Incoming gossip broadcasts (chat payloads ignored; chat is RTC-only)
    registerGossipHandler('messageReceived', async ({ message, local }) => {
      if (local) return
      const raw = message.data
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : null
        if (parsed?.__pp_key && parsed?.epub && message.sender) {
          peerEpubs[message.sender] = parsed.epub
          if (parsed.browser) peerBrowsers[message.sender] = parsed.browser
          return
        }
      } catch { /* not our format, fall through */ }
    })

    // Incoming direct messages via gossip routing (chat payloads ignored; chat is RTC-only)
    registerGossipHandler('directMessageReceived', async ({ message }) => {
      try {
        const parsed = JSON.parse(message.data)
        if (parsed.__pp_key_req) {
          const sender = message.from || message.sender
          if (sender) announceLocalKey(sender)
          return
        }
        if (parsed.__pp_key && parsed.epub && message.from) {
          peerEpubs[message.from] = parsed.epub
          if (parsed.browser) peerBrowsers[message.from] = parsed.browser
          announceLocalKey(message.from)
          return
        }
      } catch {}
    })

    // Incoming peer:data — direct messages
    registerMeshHandler('peer:data', async ({ peerId, data }) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        if (!parsed) return

        if (parsed.__pp_key_req) {
          announceLocalKey(peerId)
          return
        }

        if (parsed.__pp_key && parsed.epub) {
          peerEpubs[peerId] = parsed.epub
          if (parsed.browser) peerBrowsers[peerId] = parsed.browser
          announceLocalKey(peerId)
          return
        }

        if (parsed.__pp_enc_bc_u && parsed.encrypted && myKeys?.epriv) {
          const deliveryMs = getDeliveryMs(parsed.sentAt)
          const text = await decryptMessageWithMeta(parsed.encrypted, myKeys.epriv)
          pushMessage({ type: 'broadcast', from: parsed.from || peerId, text, local: false, encrypted: true, deliveryMs, route: 'direct' })
          return
        }

        if (parsed.__pp_direct_u && parsed.encrypted && myKeys?.epriv) {
          const deliveryMs = getDeliveryMs(parsed.sentAt)
          const text = await decryptMessageWithMeta(parsed.encrypted, myKeys.epriv)
          if (!dmTarget.value) {
            dmTarget.value = peerId
          }
          pushMessage({ type: 'direct', from: peerId, to: clientId.value, text, local: false, encrypted: true, deliveryMs, route: 'direct' })
          return
        }
      } catch {
        // not our format — ignore
      }
    })

    await mesh.init()
    attachDistributedStorage()
  } catch (err) {
    console.error('Connect failed:', err)
    doDisconnect()
  }
}

function copyPeer(id) {
  navigator.clipboard.writeText(id)
  copiedPeer.value = id
  setTimeout(() => { if (copiedPeer.value === id) copiedPeer.value = null }, 1500)
}

function stopConnectionSyncTimer() {
  if (connectionSyncTimer) {
    clearInterval(connectionSyncTimer)
    connectionSyncTimer = null
  }
}

function stopKeySyncTimer() {
  if (keySyncTimer) {
    clearInterval(keySyncTimer)
    keySyncTimer = null
  }
}

function syncConnectedPeers() {
  if (!mesh) {
    connectedPeers.value = []
    return
  }
  try {
    connectedPeers.value = mesh.getConnectedPeers()
  } catch {
    connectedPeers.value = []
  }
}

function stopTableRefreshTimer() {
  if (tableRefreshTimer) {
    clearInterval(tableRefreshTimer)
    tableRefreshTimer = null
  }
}

function startConnectionSyncTimer() {
  stopConnectionSyncTimer()
  connectionSyncTimer = setInterval(syncConnectedPeers, 3000)
  stopTableRefreshTimer()
  tableRefreshTimer = setInterval(() => { tableRefreshTick.value++ }, 1000)
  // Debug helper: window.__pp.dump() in browser console shows raw peerEntries state
  if (typeof window !== 'undefined') {
    window.__pp = {
      entries: () => mesh?.signalingClient?.client?.mesh?.connections,
      dump() {
        const map = mesh?.signalingClient?.client?.mesh?.connections
        if (!map) return console.log('[__pp] no peerEntries (mesh not ready)')
        console.log(`[__pp] ${map.size} entries in peerEntries:`)
        for (const [id, e] of map.entries()) {
          console.log(
            `  ${id.slice(0, 16)}… relayOnly=${e.relayOnly} channel=${e.channel?.readyState ?? 'null'} connected=${e.connected} state=${e.state}`
          )
        }
      },
    }
  }
}

function syncPeerKeys() {
  for (const peerId of connectedPeers.value) {
    ensurePeerKey(peerId)
  }
}

function startKeySyncTimer() {
  stopKeySyncTimer()
  keySyncTimer = setInterval(syncPeerKeys, 4000)
}

function doDisconnect() {
  manuallyDisconnected = true
  teardownDistributedStorage()
  if (gossip) {
    for (const [event, handler] of gossipEventHandlers) {
      gossip.off(event, handler)
    }
    gossipEventHandlers = []
  }
  if (mesh) {
    for (const [event, handler] of meshEventHandlers) {
      mesh.off(event, handler)
    }
    meshEventHandlers = []
  }
  stopConnectionSyncTimer()
  stopKeySyncTimer()
  stopTableRefreshTimer()
  gossip = null
  mesh?.destroy()
  mesh              = null
  myKeys            = null
  connected.value   = false
  signalingStatus.value = 'disconnected'
  clientId.value    = null
  connectedPeers.value  = []
  discoveredPeers.value = []
}

const unloadHandler = () => {
  doDisconnect()
}

onMounted(() => {
  syncUrlWithConfig(config.value)
  window.addEventListener('beforeunload', unloadHandler)
  window.addEventListener('pagehide', unloadHandler)
  if (config.value.autoConnect) {
    doConnect()
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', unloadHandler)
  window.removeEventListener('pagehide', unloadHandler)
  doDisconnect()
})

// Auto-request epub when selecting a peer we don't have a key for yet
watch(dmTarget, (peerId) => {
  if (peerId && !peerEpubs[peerId]) {
    ensurePeerKey(peerId)
  }
  if (peerId) {
    maybeUpgradePeerToRtc(peerId)
  }
})

watch(() => storageView.space, () => {
  refreshStorageRecords()
})

// ── Messaging ────────────────────────────────────────────────────────────────
async function sendBroadcast() {
  const text = broadcastDraft.value.trim()
  if (!text || !mesh) return
  if (!myKeys?.epub) {
    console.error('Broadcast blocked: local UnSEA key unavailable')
    return
  }

  const recipients = Array.from(new Set(connectedPeers.value.filter(Boolean)))
    .filter((peerId) => peerId && peerId !== clientId.value)
    .filter((peerId) => isDirectRtcConnected(peerId))

  const missingKeyPeers = []
  const sentPeers = []
  for (const peerId of recipients) {
    const epub = peerEpubs[peerId]
    if (!epub) {
      missingKeyPeers.push(peerId)
      continue
    }

    const payload = JSON.stringify({
      __pp_enc_bc_u: true,
      from: clientId.value,
      encrypted: await encryptMessageWithMeta(text, { epub }),
      sentAt: Date.now(),
    })
    mesh.send(peerId, payload)
    sentPeers.push(peerId)
  }

  if (missingKeyPeers.length > 0) {
    console.warn('Broadcast key-missing peers:', missingKeyPeers)
  }

  if (sentPeers.length === 0) {
    console.error('Broadcast blocked: no RTC-open peers with UnSEA keys available')
    announceLocalKey()
    return
  }

  pushMessage({ type: 'broadcast', from: clientId.value, text, local: true, encrypted: true, route: 'local' })
  broadcastDraft.value = ''
}

async function sendDirect() {
  const text = dmDraft.value.trim()
  if (!text || !dmTarget.value || !mesh) return
  const epub = peerEpubs[dmTarget.value]
  if (!epub) {
    console.error('Direct send blocked: recipient UnSEA key unavailable')
    announceLocalKey(dmTarget.value)
    return
  }
  try {
    maybeUpgradePeerToRtc(dmTarget.value)
    const useDirectRtc = isDirectRtcConnected(dmTarget.value)
    if (!useDirectRtc) {
      console.error('Direct send blocked: target peer has no open RTC data channel')
      return
    }
    const payloadObj = { __pp_direct_u: true }
    payloadObj.encrypted = await encryptMessageWithMeta(text, { epub })

    // Stamp as late as possible so deliveryMs reflects network transit, not sender-side processing.
    payloadObj.sentAt = Date.now()

    const payload = JSON.stringify(payloadObj)
    mesh.send(dmTarget.value, payload)
    pushMessage({ type: 'direct', from: clientId.value, text, local: true, to: dmTarget.value, encrypted: true, route: 'direct' })
    dmDraft.value = ''
  } catch (err) {
    console.error('Direct send failed:', err)
  }
}

async function pushMessage(msg) {
  messages.value.push(msg)
  await nextTick()

  if (msg.type === 'broadcast' && broadcastHistoryEl.value) {
    broadcastHistoryEl.value.scrollTop = broadcastHistoryEl.value.scrollHeight
  }

  if (msg.type === 'direct' && directHistoryEl.value) {
    directHistoryEl.value.scrollTop = directHistoryEl.value.scrollHeight
  }
}
</script>

<style>
:root {
  --primary:    #2563eb;
  --secondary:  #64748b;
  --success:    #059669;
  --warning:    #d97706;
  --danger:     #dc2626;
  --bg:         #f8fafc;
  --surface:    #ffffff;
  --border:     #e2e8f0;
  --text:       #1e293b;
  --text-muted: #64748b;
  --radius:     8px;
  --shadow:     0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

.container { max-width: 1200px; margin: 0 auto; padding: 20px; }

/* App chrome wrapper */
.app-chrome {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  margin-bottom: 24px;
  overflow: visible;
}

/* Header */
header {
  background: var(--surface);
  padding: 30px;
  border-radius: 0;
  box-shadow: none;
  margin-bottom: 0;
  text-align: center;
  border-bottom: 1px solid var(--border);
}
header h1 {
  font-size: 2rem;
  margin-bottom: 6px;
  background: linear-gradient(135deg, var(--primary), #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
header p { color: var(--text-muted); margin-bottom: 16px; }
.peer-info { display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; font-size: .9rem; }
.peer-info code { background: var(--bg); padding: 3px 7px; border-radius: 4px; font-size: .85rem; }

.status { padding: 3px 10px; border-radius: 20px; font-weight: 600; font-size: .8rem; text-transform: uppercase; }
.status.connected    { background: #dcfce7; color: var(--success); }
.status.connecting   { background: #fef3c7; color: var(--warning); }
.status.disconnected { background: #fee2e2; color: var(--danger); }

/* Tabs */
.feature-tabs {
  display: flex;
  background: var(--surface);
  border-radius: 0;
  padding: 6px;
  margin-bottom: 0;
  box-shadow: none;
  overflow-x: auto;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.tab-btn {
  background: transparent;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
  transition: all .15s;
}
.tab-btn:hover  { background: var(--bg); color: var(--text); }
.tab-btn.active { background: var(--primary); color: #fff; box-shadow: var(--shadow); }

/* Message history */
.global-message-history { margin-bottom: 24px; }
.message-filters { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.message-filters select { padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius); font-size: .95rem; }
.message-history {
  min-height: 120px;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px;
}
.chat-window {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chat-header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.chat-messages {
  min-height: 220px;
  max-height: 340px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
}
.chat-input-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.chat-message {
  max-width: 82%;
  display: flex;
  flex-direction: column;
}
.chat-message--local {
  align-self: flex-end;
}
.chat-message--remote {
  align-self: flex-start;
}
.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: .9rem;
}
.msg-entry { display: flex; flex-direction: column; max-width: 80%; }
.msg-entry--local  { align-self: flex-end; align-items: flex-end; }
.msg-entry--remote { align-self: flex-start; }
.msg-meta { font-size: .75rem; color: var(--text-muted); margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
.msg-route { color: var(--text); font-weight: 700; font-size: .78rem; }
.route-prefix { display: inline-block; margin-right: 6px; font-size: .72rem; letter-spacing: .04em; }
.msg-text {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: .9rem;
  line-height: 1;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-entry--local .msg-text { background: var(--primary); color: #fff; border-color: var(--primary); }

/* Section headings */
main h2 { font-size: 1.5rem; margin-bottom: 20px; }

/* Cards */
.card {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: var(--shadow);
  border: 1px solid var(--border);
}
.card h3 { font-size: 1.1rem; margin-bottom: 16px; border-bottom: 2px solid var(--bg); padding-bottom: 8px; }
.description { color: var(--text-muted); font-size: .9rem; margin-bottom: 14px; }

/* Forms */
.input-group { margin-bottom: 16px; }
.input-group label { display: block; margin-bottom: 6px; font-weight: 500; }
.input-group input,
.input-group select,
.input-group textarea {
  width: 100%;
  padding: 14px 16px;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  font-size: .95rem;
  font-family: inherit;
  transition: border-color .15s;
}
.input-group input:focus,
.input-group select:focus,
.input-group textarea:focus { outline: none; border-color: var(--primary); }
.input-group input:disabled,
.input-group select:disabled,
.input-group textarea:disabled { background: var(--bg); opacity: .7; }
.input-group small { display: block; margin-top: 4px; font-size: .8rem; color: var(--text-muted); }

.chat-header select,
.chat-input-row textarea {
  width: 100%;
  padding: 12px 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  font-size: .95rem;
  font-family: inherit;
  transition: border-color .15s;
  background: var(--bg);
  color: var(--text);
}
.chat-header select:focus,
.chat-input-row textarea:focus {
  outline: none;
  border-color: var(--primary);
}
.chat-input-row textarea {
  min-height: 80px;
  resize: vertical;
}

.config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.checkbox-group { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 16px; }
.checkbox-group label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.config-note { font-size: .85rem; color: var(--warning); margin-top: 8px; }

/* Peers list */
.peers-list { display: flex; flex-direction: column; gap: 8px; }
.peer-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: var(--bg); border-radius: 6px; border: 1px solid var(--border); font-size: .85rem; }
.peer-copy-btn { flex-shrink: 0; background: none; border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; font-size: .8rem; cursor: pointer; color: var(--text-muted, #888); transition: color .15s, border-color .15s; line-height: 1.4; }
.peer-copy-btn:hover { color: var(--primary, #4f8ef7); border-color: var(--primary, #4f8ef7); }
.peer-copy-btn.copied { color: #22c55e; border-color: #22c55e; }

/* Buttons */
.button-group { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.btn {
  padding: 10px 18px;
  border: none;
  border-radius: var(--radius);
  font-size: .9rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity .15s;
}
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.primary   { background: var(--primary); color: #fff; }
.btn.secondary { background: var(--secondary); color: #fff; }
.btn.tertiary  { background: var(--bg); color: var(--text); border: 1px solid var(--border); }

/* Stub tabs */
.stub-card { text-align: center; padding: 50px 24px; color: var(--text-muted); font-size: 1.1rem; }

/* Compact connection bar */
.conn-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--surface);
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 10px 16px;
  margin-top: 0;
  margin-bottom: 0;
  position: relative;
  z-index: 5;
}
.conn-bar__inputs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.conn-bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.conn-bar__input {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: .85rem;
  font-family: inherit;
  background: var(--bg);
  color: var(--text);
  transition: border-color .15s;
  min-width: 0;
}
.conn-bar__input:focus { outline: none; border-color: var(--primary); background: var(--surface); }
.conn-bar__input:disabled { opacity: .55; cursor: not-allowed; }
.conn-bar__input--wide { flex: 1; min-width: 140px; }
.conn-bar__input--num  { width: 58px; text-align: center; flex-shrink: 0; }
.conn-bar__sep { width: 1px; height: 22px; background: var(--border); flex-shrink: 0; }
.conn-bar__check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: .82rem;
  color: var(--text-muted);
  white-space: nowrap;
  cursor: pointer;
}
.conn-bar__check input { cursor: pointer; }
.conn-bar__peers-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.conn-bar__peers {
  font-size: .85rem;
  font-weight: 600;
  color: var(--success);
  white-space: nowrap;
  cursor: default;
}
.conn-bar__peers-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  min-width: 240px;
  max-width: 320px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 16px 40px rgb(15 23 42 / 0.18);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-4px);
  transition: opacity .15s, transform .15s, visibility .15s;
  z-index: 1000;
}
.conn-bar__peers-popover::before {
  content: '';
  position: absolute;
  top: -6px;
  right: 18px;
  width: 12px;
  height: 12px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
  transform: rotate(45deg);
}
.conn-bar__peers-wrap:hover .conn-bar__peers-popover {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
.conn-bar__peers-title {
  font-size: .8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.storage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}

.network-grid {
  display: grid;
  gap: 20px;
}

.network-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.network-kpi {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  padding: 10px 12px;
}

.network-kpi__label {
  display: block;
  font-size: .78rem;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.network-kpi__value {
  font-size: 1.25rem;
}

.network-table-wrap {
  overflow-x: auto;
}

.network-table {
  width: 100%;
  border-collapse: collapse;
  font-size: .9rem;
}

.network-table th,
.network-table td {
  border-bottom: 1px solid var(--border);
  text-align: left;
  padding: 9px 8px;
  white-space: nowrap;
}

.network-table th {
  color: var(--text-muted);
  font-size: .78rem;
  text-transform: uppercase;
  letter-spacing: .05em;
}

.storage-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.storage-toolbar select,
.storage-toolbar input {
  flex: 1;
  min-width: 160px;
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  font-family: inherit;
}

.storage-records,
.storage-events {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 430px;
  overflow-y: auto;
}

.storage-record,
.storage-event {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  background: var(--bg);
}

.storage-record__meta,
.storage-event__header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: .82rem;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.storage-record pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: .92rem;
}

.storage-event p {
  font-size: .9rem;
}

.storage-notice {
  margin-top: 12px;
  font-size: .9rem;
  color: var(--primary);
}

.storage-lookup-label {
  font-size: .78rem;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--text-muted);
}

/* Utilities */
.empty-state { color: var(--text-muted); font-size: .9rem; text-align: center; padding: 16px 0; }
</style>
