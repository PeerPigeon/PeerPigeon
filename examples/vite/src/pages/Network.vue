<template>
  <div class="grid" style="grid-template-columns: 1fr;">
    <section class="card">
      <h3>🌐 Network Overview</h3>
      <p class="small">WebDHT P2P Mesh Network using PartialMesh</p>

      <div class="kv" style="margin-top: 12px;">
        <div>Signaling Server (use /ws path)</div>
        <div class="row">
          <input v-model="signalingServer" placeholder="wss://signal.peer.ooo/ws" class="input" style="flex:1;" />
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
        <div class="code small">{{ nodeId || 'Not connected' }}</div>

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
import { PartialMesh } from '/node_modules/webdht/src/vendor/partialmesh.ts'
import { dht, connected, nodeId, peerList, initRoomKey, roomId as globalRoomId } from '../dhtStore.js'

const signalingServer = ref('wss://signal.peer.ooo/ws')
const signalingRoom = ref('')
const messages = ref([])
const discoveredPeers = ref([])
const connectedPeers = computed(() => peerList.value)

let mesh = null
let eventBindings = []
let roomCheckInterval = null

const buildIceServers = () => [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

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
      nodeId.value = data.clientId
      connected.value = true
      addMessage('✅ Connected to signaling server')
      addMessage(`🆔 Node ID: ${data.clientId?.substring(0, 16)}...`)
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
    ['peer:discovered', () => {
      discoveredPeers.value = mesh.getDiscoveredPeers()
    }],
    ['peer:disconnected', (peerId) => {
      addMessage(`❌ Peer disconnected: ${peerId.substring(0, 16)}...`)
      peerList.value = mesh.getConnectedPeers()
      discoveredPeers.value = mesh.getDiscoveredPeers()
    }],
    ['peer:error', (payload) => {
      addMessage(`❌ Peer error: ${payload?.peerId?.substring(0, 16) || 'unknown'}`)
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
    addMessage('🚀 Initializing PartialMesh...')

    // Reuse existing mesh if present to keep peers alive across pages
    if (dht.value) {
      mesh = dht.value
      attachMeshEvents()
      peerList.value = mesh.getConnectedPeers()
      discoveredPeers.value = mesh.getDiscoveredPeers()
      addMessage('♻️ Reusing existing mesh instance')
      return
    }

    mesh = new PartialMesh({
      signalingServer: signalingServer.value,
      sessionId: signalingRoom.value,
      minPeers: 1,
      maxPeers: 10,
      trickle: true,
      connectionTimeoutMs: 30000,
      bootstrapGraceMs: 12000,
      iceServers: buildIceServers(),
      debug: true,
    })

    dht.value = mesh
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
  dht.value = null
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
  if (messages.value.length > 100) {
    messages.value.shift()
  }
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
