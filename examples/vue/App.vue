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
            <span class="conn-bar__peers">👥 {{ connectedPeers.length }} peer{{ connectedPeers.length === 1 ? '' : 's' }}</span>
            <div v-if="connectedPeers.length > 0" class="conn-bar__peers-popover">
              <p class="conn-bar__peers-title">Connected peers</p>
              <p v-if="connectedPeers.length === 0" class="empty-state">No peers connected</p>
              <div v-else class="peers-list">
                <div v-for="id in connectedPeers" :key="id" class="peer-item">
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
                  <span class="msg-badge badge--broadcast">Broadcast</span>
                  <span>{{ msg.local ? 'You' : (msg.from ? msg.from.slice(0, 16) + '…' : 'Unknown') }}</span>
                  <span v-if="msg.encrypted">🔒</span>
                </div>
                <div class="msg-text">{{ msg.text }}</div>
              </div>
            </div>
            <div class="chat-input-row">
              <textarea v-model="broadcastDraft" rows="3" placeholder="Type your broadcast message…" :disabled="!connected" @keydown.enter.exact.prevent="sendBroadcast"></textarea>
              <div class="chat-actions">
                <label class="checkbox-label"><input type="checkbox" v-model="encryptBroadcast" /> 🔒 Encrypt</label>
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
                <option v-for="id in discoveredPeers" :key="id" :value="id">{{ id.slice(0, 16) }}… {{ connectedPeers.includes(id) ? '' : '(indirect)' }}</option>
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
                  <span class="msg-badge badge--direct">Direct</span>
                  <span>{{ msg.local ? 'You' : (msg.from ? msg.from.slice(0, 16) + '…' : 'Unknown') }}</span>
                  <span v-if="msg.to">→ {{ msg.to.slice(0, 16) }}…</span>
                  <span v-if="msg.encrypted">🔒</span>
                </div>
                <div class="msg-text">{{ msg.text }}</div>
              </div>
            </div>
            <div class="chat-input-row">
              <textarea v-model="dmDraft" rows="3" placeholder="Type your direct message…" :disabled="!connected || !dmTarget" @keydown.enter.exact.prevent="sendDirect"></textarea>
              <div class="chat-actions">
                <button class="btn primary" :disabled="!connected || !dmTarget || !dmDraft.trim() || (dmTarget && !peerEpubs[dmTarget])" @click="sendDirect">📧 Send</button>
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
        <h2>🗄️ WebDHT &amp; Storage</h2>
        <div class="card stub-card">
          <p>🚧 DHT features coming soon.</p>
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
        <div class="card stub-card">
          <p>🚧 Network info coming soon.</p>
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

const CONFIG_STORAGE_KEY = 'peerpigeon-config'
const EPUBS_STORAGE_KEY  = 'peerpigeon-epubs'

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

const defaultConfig = {
  sessionId: 'peerpigeon-demo',
  signalingServer: 'wss://peer.ooo/ws',
  minPeers: 2,
  maxPeers: 5,
  autoConnect: true,
  autoDiscover: true,
  iceServers: DEFAULT_ICE_SERVERS,
}

const config = ref({ ...defaultConfig })

const clientId        = ref(null)
const connected       = ref(false)
const signalingStatus = ref('disconnected')
const connectedPeers  = ref([])
const discoveredPeers = ref([])
const copiedPeer      = ref(null)
const messages             = ref([])
const broadcastDraft       = ref('')
const dmTarget             = ref('')
const dmDraft              = ref('')
const broadcastHistoryEl   = ref(null)
const directHistoryEl      = ref(null)
const encryptBroadcast     = ref(true)
const encryptDirect        = ref(true)
const peerEpubs            = reactive({}) // peerId → epub JWK

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

const signalingLabel = computed(() => ({
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
}[signalingStatus.value] ?? 'Disconnected'))

function sanitizeStoredConfig(raw) {
  return {
    sessionId: typeof raw?.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId : defaultConfig.sessionId,
    signalingServer: typeof raw?.signalingServer === 'string' && raw.signalingServer.trim() && raw.signalingServer !== 'wss://peer-ooo-worker-devtest.draeder.workers.dev/ws'
      ? raw.signalingServer
      : defaultConfig.signalingServer,
    minPeers: Number.isFinite(Number(raw?.minPeers)) ? Number(raw.minPeers) : defaultConfig.minPeers,
    maxPeers: Number.isFinite(Number(raw?.maxPeers)) ? Number(raw.maxPeers) : defaultConfig.maxPeers,
    autoConnect: typeof raw?.autoConnect === 'boolean' ? raw.autoConnect : defaultConfig.autoConnect,
    autoDiscover: typeof raw?.autoDiscover === 'boolean' ? raw.autoDiscover : defaultConfig.autoDiscover,
    iceServers: Array.isArray(raw?.iceServers) && raw.iceServers.length > 0 ? raw.iceServers : defaultConfig.iceServers,
  }
}

function loadStoredConfig() {
  try {
    const stored = globalThis.localStorage?.getItem(CONFIG_STORAGE_KEY)
    if (!stored) return
    config.value = sanitizeStoredConfig(JSON.parse(stored))
  } catch {
    config.value = { ...defaultConfig }
  }
}

function persistConfig(nextConfig) {
  try {
    globalThis.localStorage?.setItem(CONFIG_STORAGE_KEY, JSON.stringify(nextConfig))
  } catch {}
}

function savePeerEpubs() {
  try { globalThis.localStorage?.setItem(EPUBS_STORAGE_KEY, JSON.stringify({ ...peerEpubs })) } catch {}
}

function loadPeerEpubs() {
  try {
    const stored = globalThis.localStorage?.getItem(EPUBS_STORAGE_KEY)
    if (!stored) return
    const obj = JSON.parse(stored)
    if (obj && typeof obj === 'object') Object.assign(peerEpubs, obj)
  } catch {}
}

watch(config, (nextConfig) => {
  persistConfig(nextConfig)
}, { deep: true })

// ── Mesh / Gossip ────────────────────────────────────────────────────────────
let mesh           = null
let gossip         = null
let myKeys         = null  // { priv, pub, epriv, epub }
let sessionSymKey  = null  // AES-GCM key derived from sessionId for broadcast encryption

async function deriveSessionKey(sessionId) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(sessionId), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('peerpigeon-bc-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function symEncrypt(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  )
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ct)))
  }
}

async function symDecrypt(key, { iv, ct }) {
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0))
  const ctBytes = Uint8Array.from(atob(ct), c => c.charCodeAt(0))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ctBytes)
  return new TextDecoder().decode(pt)
}

async function doConnect() {
  if (mesh || signalingStatus.value === 'connecting' || connected.value) return

  signalingStatus.value = 'connecting'
  myKeys = await generateRandomPair()
  sessionSymKey = await deriveSessionKey(config.value.sessionId)

  try {
    const hardMaxPeers = Math.max(1, Number(config.value.maxPeers || 0))
    const softMaxPeers = Math.max(1, hardMaxPeers - 1)
    const effectiveMinPeers = Math.min(Number(config.value.minPeers || 0), hardMaxPeers)
    const isFirefox = /firefox/i.test(navigator.userAgent)
    const runtimeIceServers = isFirefox ? FIREFOX_ICE_SERVERS : config.value.iceServers

    mesh = new PartialMesh({
      sessionId: config.value.sessionId,
      signalingServer: config.value.signalingServer,
      minPeers: effectiveMinPeers,
      maxPeers: hardMaxPeers,
      softMaxPeers,
      autoConnect: config.value.autoConnect,
      autoDiscover: config.value.autoDiscover,
      iceServers: runtimeIceServers,
      trickleIce: !isFirefox,
      signalRelayFallback: isFirefox,
      maxConcurrentDials: isFirefox ? 1 : 3,
      connectionTimeoutMs: isFirefox ? 60000 : 45000,
      maintenanceIntervalMs: isFirefox ? 4000 : 2000,
      rebalanceCooldownMs: isFirefox ? 90000 : 60000,
      rebalanceRetryMs: isFirefox ? 120000 : 90000,
      rebalanceMinConnectionAgeMs: isFirefox ? 60000 : 45000,
      rebalanceMinCandidateAgeMs: isFirefox ? 20000 : 15000,
    })

    gossip = new GossipProtocol(mesh)

    mesh.on('signaling:connected', ({ clientId: id }) => {
      clientId.value        = id
      connected.value       = true
      signalingStatus.value = 'connected'
      if (!config.value.autoDiscover) {
        mesh.signalingClient?.joinSession(config.value.sessionId)
      }
      // Broadcast our epub so all peers (direct + indirect) can DM us
      setTimeout(() => {
        if (gossip && myKeys) gossip.broadcast(JSON.stringify({ __pp_key: true, epub: myKeys.epub }))
      }, 800)
    })

    mesh.on('signaling:error', (error) => {
      console.error('Signaling error:', error)
      connected.value = false
      signalingStatus.value = 'disconnected'
    })

    mesh.on('signaling:log', ({ message }) => {
      console.debug(message)
    })

    mesh.on('peer:error', ({ peerId, error }) => {
      console.error(`Peer error (${peerId}):`, error)
    })

    mesh.on('peer:discovered', (peerId) => {
      if (peerId && !discoveredPeers.value.includes(peerId))
        discoveredPeers.value = [...discoveredPeers.value, peerId]
      if (!config.value.autoConnect) {
        mesh.maintainPeerConnections?.()
      }
    })

    mesh.on('signaling:disconnected', () => {
      connected.value       = false
      signalingStatus.value = 'disconnected'
      connectedPeers.value  = []
    })

    mesh.on('peer:connected', (peerId) => {
      if (!connectedPeers.value.includes(peerId))
        connectedPeers.value = [...connectedPeers.value, peerId]
      if (!discoveredPeers.value.includes(peerId))
        discoveredPeers.value = [...discoveredPeers.value, peerId]
      // Send our epub directly (fast path for direct peers)
      try {
        mesh.send(peerId, JSON.stringify({ __pp_key: true, epub: myKeys.epub }))
      } catch {}
    })

    mesh.on('peer:disconnected', (peerId) => {
      connectedPeers.value = connectedPeers.value.filter(id => id !== peerId)
      // keep epub cached — peer may reconnect or be reachable indirectly
    })

    // Incoming gossip broadcasts
    gossip.on('messageReceived', async ({ message, local }) => {
      if (local) return
      const raw = message.data
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : null
        if (parsed?.__pp_key) {
          peerEpubs[message.sender] = parsed.epub
          savePeerEpubs()
          return
        }
        if (parsed?.__pp_enc_bc && sessionSymKey) {
          const text = await symDecrypt(sessionSymKey, parsed)
          pushMessage({ type: 'broadcast', from: message.sender, text, local: false, encrypted: true })
          return
        }
      } catch { /* not our format, fall through */ }
      pushMessage({ type: 'broadcast', from: message.sender, text: raw, local: false, encrypted: false })
    })

    // Incoming direct messages and key negotiation via gossip routing
    gossip.on('directMessageReceived', async ({ message }) => {
      try {
        const parsed = JSON.parse(message.data)
        if (parsed.__pp_key) {
          peerEpubs[message.from] = parsed.epub
          savePeerEpubs()
          // respond with our epub
          gossip.sendDirect(message.from, JSON.stringify({ __pp_keyack: true, epub: myKeys.epub }))
          return
        }
        if (parsed.__pp_keyack) {
          peerEpubs[message.from] = parsed.epub
          savePeerEpubs()
          return
        }
        if (parsed.__pp_direct) {
          let text = parsed.text
          let encrypted = false
          if (parsed.encrypted && myKeys) {
            text = await decryptMessageWithMeta(parsed.encrypted, myKeys.epriv)
            encrypted = true
          }
          const sender = message.from || message.sender
          if (!dmTarget.value) {
            dmTarget.value = sender
          }
          pushMessage({ type: 'direct', from: sender, to: clientId.value, text, local: false, encrypted })
        }
      } catch {}
    })

    // Incoming peer:data — key exchange, direct messages, encrypted broadcasts
    mesh.on('peer:data', async ({ peerId, data }) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        if (!parsed) return

        if (parsed.__pp_key) {
          peerEpubs[peerId] = parsed.epub
          savePeerEpubs()
          try { mesh.send(peerId, JSON.stringify({ __pp_keyack: true, epub: myKeys.epub })) } catch {}
          return
        }

        if (parsed.__pp_keyack) {
          peerEpubs[peerId] = parsed.epub
          savePeerEpubs()
          return
        }

        // direct messages and encrypted broadcasts are handled via gossip events
      } catch {
        // not our format — ignore
      }
    })

    await mesh.init()
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

function doDisconnect() {
  gossip = null
  mesh?.destroy()
  mesh              = null
  myKeys            = null
  sessionSymKey     = null
  connected.value   = false
  signalingStatus.value = 'disconnected'
  clientId.value    = null
  connectedPeers.value  = []
  discoveredPeers.value = []
  // peerEpubs intentionally kept — persisted cache for reconnects
}

onUnmounted(doDisconnect)
// Auto-request epub when selecting a peer we don't have a key for yet
watch(dmTarget, (peerId) => {
  if (peerId && !peerEpubs[peerId] && gossip && myKeys) {
    gossip.sendDirect(peerId, JSON.stringify({ __pp_key: true, epub: myKeys.epub }))
  }
})

onMounted(() => {
  loadStoredConfig()
  loadPeerEpubs()
  if (config.value.autoConnect) {
    doConnect()
  }
})

// ── Messaging ────────────────────────────────────────────────────────────────
async function sendBroadcast() {
  const text = broadcastDraft.value.trim()
  if (!text || !gossip) return

  let payload
  let encrypted = false
  if (encryptBroadcast.value && sessionSymKey) {
    const { iv, ct } = await symEncrypt(sessionSymKey, text)
    payload = JSON.stringify({ __pp_enc_bc: true, iv, ct })
    encrypted = true
  } else {
    payload = text
  }

  gossip.broadcast(payload)
  pushMessage({ type: 'broadcast', from: clientId.value, text, local: true, encrypted })
  broadcastDraft.value = ''
}

async function sendDirect() {
  const text = dmDraft.value.trim()
  if (!text || !dmTarget.value || !gossip) return
  const epub = peerEpubs[dmTarget.value]
  if (!epub) return // button is disabled without epub — shouldn't reach here
  try {
    const encrypted = await encryptMessageWithMeta(text, { epub })
    gossip.sendDirect(dmTarget.value, JSON.stringify({ __pp_direct: true, encrypted }))
    pushMessage({ type: 'direct', from: clientId.value, text, local: true, to: dmTarget.value, encrypted: true })
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
.msg-badge { padding: 1px 6px; border-radius: 10px; font-size: .7rem; font-weight: 700; }
.badge--broadcast { background: #dbeafe; color: var(--primary); }
.badge--direct    { background: #fce7f3; color: #be185d; }
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

/* Utilities */
.empty-state { color: var(--text-muted); font-size: .9rem; text-align: center; padding: 16px 0; }
</style>
