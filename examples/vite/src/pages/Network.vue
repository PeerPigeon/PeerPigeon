<template>
  <div class="grid" style="grid-template-columns: 1fr;">
    <section class="card">
      <h3>🌐 Network Overview</h3>
      <p class="small">WebDHT P2P Mesh Network using PartialMesh</p>

      <div class="kv" style="margin-top: 12px;">
        <div>Signaling Server (use /ws path)</div>
        <div class="row">
          <input v-model="signalingServer" placeholder="wss://peer.ooo/ws" class="input" style="flex:1;" />
        </div>

        <div>TURN Server (optional, for NAT)</div>
        <div class="row">
          <input v-model="turnUrl" placeholder="turn:your-server:3478" class="input" style="flex:1;" />
          <input v-model="turnUser" placeholder="user" class="input" style="width:80px;" />
          <input v-model="turnPass" placeholder="pass" type="password" class="input" style="width:80px;" />
        </div>

        <div>Signaling Session</div>
        <div class="row">
          <input v-model="signalingRoom" placeholder="Auto-generated room" class="input" style="flex:1;" readonly />
          <button class="btn" @click="reconnect">Reconnect</button>
        </div>

        <div>ROOM ID (30 min)</div>
        <div class="row">
          <input :value="globalRoomId" class="input" style="flex:1;" readonly />
        </div>

        <div>Your Node ID</div>
        <div class="code small">{{ nodeId || customPeerId || 'Generating...' }}</div>

        <div>Status</div>
        <div :class="connected ? 'online' : 'offline'">
          {{ connected ? '🟢 Online' : '🔴 Offline' }}
        </div>
      </div>
    </section>

    <section class="grid" style="grid-template-columns: repeat(3, 1fr);">
      <div class="card">
        <h3>👥 Connected Peers</h3>
        <p><strong>{{ connectedPeers.length }}</strong></p>
        <ul v-if="connectedPeers.length > 0" style="list-style: none; padding: 0;">
          <li v-for="p in connectedPeers" :key="p" class="code small">{{ p.substring(0, 12) }}...</li>
        </ul>
      </div>
      <div class="card">
        <h3>🔍 Discovered Peers</h3>
        <p><strong>{{ discoveredPeers.length }}</strong></p>
        <ul v-if="discoveredPeers.length > 0" style="list-style: none; padding: 0;">
          <li v-for="p in discoveredPeers" :key="p" class="code small">{{ p.substring(0, 12) }}...</li>
        </ul>
      </div>
      <div class="card">
        <h3>Network Health</h3>
        <p>{{ connectedPeers.length > 0 ? '🟢 Healthy' : '🔴 Isolated' }}</p>
        <button class="btn primary" @click="openNewWindow" style="margin-top: 8px;">
          🚀 Open 2nd Window
        </button>
      </div>
    </section>

    <section class="card">
      <h3>📜 Network Log</h3>
      <div class="log-container">
        <div v-for="(msg, i) in messages" :key="i" class="log-entry">
          <span class="time">{{ msg.time }}</span>
          <span>{{ msg.text }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PartialMesh, GossipProtocol } from 'gossip-protocol'
import { dht, gossip, connected, nodeId, peerList, initRoomKey, roomId as globalRoomId, customPeerId } from '../dhtStore.js'

const signalingServer = ref('wss://peer.ooo/ws')
const signalingRoom = ref('')
const turnUrl = ref('')
const turnUser = ref('')
const turnPass = ref('')
const messages = ref([])
const discoveredPeers = ref([])
const connectedPeers = computed(() => peerList.value)
const verboseNetworkLogs = import.meta.env.DEV

let mesh = null
let gossipInstance = null
let eventBindings = []
let roomCheckInterval = null

const buildIceServers = () => {
  // Always include reliable STUN servers
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ]
  if (turnUrl.value) {
    const entry = { urls: turnUrl.value }
    if (turnUser.value) entry.username = turnUser.value
    if (turnPass.value) entry.credential = turnPass.value
    servers.push(entry)
  }
  return servers
}

const detachMeshEvents = () => {
  if (mesh && eventBindings.length) {
    eventBindings.forEach(([event, handler]) => mesh.off(event, handler))
  }
  eventBindings = []
}

const attachMeshEvents = () => {
  if (!mesh) return
  detachMeshEvents()

  const bindings = [
    ['signaling:connected', (data) => {
      nodeId.value = mesh.getClientId() || data?.clientId || ''
      connected.value = true
      addMessage('✅ Connected to signaling server')
      addMessage(`🆔 Node ID: ${(nodeId.value || '').substring(0, 16)}...`)
    }],
    ['signaling:disconnected', () => {
      connected.value = false
      addMessage('⚠️ Signaling disconnected (peers may stay connected)')
    }],
    ['signaling:error', (err) => {
      addMessage(`❌ Signaling error: ${err?.message || err}`)
      console.error('Signaling error:', err)
    }],
    ['peer:connected', (peerId) => {
      addMessage(`✅ Peer connected: ${peerId.substring(0, 16)}...`)
      peerList.value = mesh.getConnectedPeers()
    }],
    ['peer:discovered', (peerId) => {
      const id = String(peerId || '')
      const hadPeer = discoveredPeers.value.includes(id)
      discoveredPeers.value = mesh.getDiscoveredPeers()
      if (!hadPeer) {
        addMessage(`🔍 Discovered peer, connecting: ${id.substring(0, 16)}...`)
      }
    }],
    ['peer:disconnected', (peerId) => {
      addMessage(`❌ Peer disconnected: ${peerId.substring(0, 16)}...`)
      peerList.value = mesh.getConnectedPeers()
      discoveredPeers.value = mesh.getDiscoveredPeers()
    }],
    ['peer:error', (payload) => {
      const errMsg = payload?.error?.message || String(payload?.error || 'unknown')
      addMessage(`❌ Peer error [${payload?.peerId?.substring(0, 16) || 'unknown'}]: ${errMsg}`)
      console.error('Peer error:', payload)
    }],
    ['mesh:reset', (data) => {
      addMessage(`⚠️ Mesh reset: ${data?.reason || 'unknown'}`)
      peerList.value = mesh.getConnectedPeers()
      discoveredPeers.value = mesh.getDiscoveredPeers()
    }],
  ]

  bindings.forEach(([event, handler]) => mesh.on(event, handler))
  eventBindings = bindings
}

const setupMesh = async () => {
  try {
    if (verboseNetworkLogs) {
      console.log('[Network] setupMesh called')
    }

    addMessage('🚀 Initializing PartialMesh...')

    // Reuse existing mesh if present to keep peers alive across pages
    if (dht.value) {
      mesh = dht.value
      gossipInstance = gossip.value
      attachMeshEvents()
      peerList.value = mesh.getConnectedPeers()
      discoveredPeers.value = mesh.getDiscoveredPeers()
      addMessage('♻️ Reusing existing mesh instance')
      return
    }

    // Wait for SHA-1 peer ID to be ready
    if (!customPeerId.value) {
      await new Promise(resolve => {
        const stop = watch(customPeerId, id => { if (id) { stop(); resolve(); } })
      })
    }

    mesh = new PartialMesh({
      signalingServer: signalingServer.value,
      sessionId: signalingRoom.value,
      peerId: customPeerId.value,
      minPeers: 1,
      maxPeers: 10,
      connectionTimeoutMs: 30000,
      iceServers: buildIceServers(),
    })

    gossipInstance = new GossipProtocol(mesh, { maxHops: 10 })

    dht.value = mesh
    gossip.value = gossipInstance
    attachMeshEvents()

    await mesh.init()
    peerList.value = mesh.getConnectedPeers()
    discoveredPeers.value = mesh.getDiscoveredPeers()
    addMessage('✅ Mesh initialized successfully')
  } catch (err) {
    addMessage(`❌ Mesh initialization error: ${err.message || err}`)
    console.error('Mesh setup error:', err)
  }
}

const reconnect = async () => {
  addMessage('🔄 Reconnecting...')
  detachMeshEvents()
  if (mesh) {
    try {
      mesh.destroy()
    } catch (err) {
      console.warn('Mesh destroy failed', err)
    }
  }
  mesh = null
  gossipInstance = null
  dht.value = null
  gossip.value = null
  connected.value = false
  nodeId.value = ''
  peerList.value = []
  discoveredPeers.value = []
  await setupMesh()
}

const openNewWindow = () => {
  window.open(window.location.href, '_blank')
  addMessage('🚀 Opened new window for testing')
}

const addMessage = (text) => {
  messages.value.push({
    text,
    time: new Date().toLocaleTimeString()
  })
  if (messages.value.length > 200) {
    messages.value.shift()
  }
}

let _origConsoleLog = null
const startLogIntercept = () => {
  _origConsoleLog = console.log
  console.log = (...args) => {
    _origConsoleLog(...args)
    const msg = args.map(a => String(a)).join(' ')
    if (
      msg.includes('[signal] sending offer') ||
      msg.includes('[signal] incoming offer') ||
      msg.includes('[signal] incoming answer') ||
      msg.includes('[signal] sending answer') ||
      msg.includes('[signal] registered') ||
      msg.includes('[signal] error') ||
      msg.includes('[signal] not registered') ||
      msg.includes('[signal] received') ||
      msg.includes('[signal] status') ||
      msg.includes('[webrtc] connection to') ||
      msg.includes('[webrtc] ice to') ||
      msg.includes('[webrtc] ice gathering') ||
      msg.includes('[webrtc] local candidate') ||
      msg.includes('[webrtc] data channel open') ||
      msg.includes('[webrtc] no local ICE') ||
      msg.includes('[webrtc] ice candidate error') ||
      msg.includes('[mesh]')
    ) {
      addMessage(`🔧 ${msg.substring(0, 120)}`)
    }
  }
}
const stopLogIntercept = () => {
  if (_origConsoleLog) { console.log = _origConsoleLog; _origConsoleLog = null }
}

const generateRoom = () => {
  const now = Date.now()
  const thirtyMinMs = 30 * 60 * 1000
  const bucket = Math.floor(now / thirtyMinMs)
  // Always use same deterministic bucket room across all tabs
  return {
    room: `room-${bucket.toString(36)}`,
    expiresAt: (bucket + 1) * thirtyMinMs,
    bucket
  }
}

// No automatic reconnect on expiry; session stays stable.

onMounted(async () => {
  startLogIntercept()
  // ALWAYS generate deterministic room based on 30-minute UTC time bucket
  // NO URL params - every browser computes the same room independently
  const { room, expiresAt } = generateRoom()
  const now = Date.now()
  const remainingMin = Math.ceil((expiresAt - now) / 60000)
  
  signalingRoom.value = room
  // DON'T set globalRoomId here; it will be set by dhtStore on first peer join
  // This ensures ROOM ID field shows the active room with suffix, not the signaling room
  await initRoomKey(room)
  
  addMessage(`📍 Signaling Session: ${room} (expires in ${remainingMin}min)`)
  addMessage(`⏳ Waiting for 1st peer to set active ROOM ID...`)

  await setupMesh()
  
  // No forced reconnects; keep session stable for testing
  
  // Listen for global room-switch events (broadcasted from dhtStore)
  const onRoomSwitch = (e) => {
    const next = e?.detail?.room
    if (next && next !== signalingRoom.value) {
      // Update crypto room/key only; do NOT reconnect signaling session
      globalRoomId.value = next
      initRoomKey(next)
      addMessage(`🔐 Active ROOM ID: ${next}`)
    }
  }
  window.addEventListener('room-switch', onRoomSwitch)
  
  // Also react to globalRoomId changes
  watch(() => globalRoomId.value, (next) => {
    if (next && next !== signalingRoom.value) {
      initRoomKey(next)
      addMessage(`🔐 ROOM ID updated: ${next}`)
    }
  })
})

onBeforeUnmount(() => {
  stopLogIntercept()
  // Keep mesh running so other pages (Messaging) stay connected; just drop UI listeners.
  detachMeshEvents()
  if (roomCheckInterval) {
    clearInterval(roomCheckInterval)
    roomCheckInterval = null
  }
  try { window.removeEventListener('room-switch', () => {}) } catch (e) {}
})
</script>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px;
  align-items: center;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.online {
  color: #4ade80;
  font-weight: bold;
}

.offline {
  color: #f87171;
  font-weight: bold;
}

.log-container {
  max-height: 300px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  padding: 8px;
}

.log-entry {
  font-size: 0.85rem;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.log-entry:last-child {
  border-bottom: none;
}

.time {
  color: #94a3b8;
  margin-right: 8px;
  font-family: monospace;
}

ul {
  margin: 8px 0 0 0;
  padding: 0;
}

li {
  padding: 2px 0;
}
</style>
