<template>
  <div class="grid" style="grid-template-columns: 1fr;">
    <section class="card">
      <h3>🌐 Network Overview</h3>
      <p class="small">WebDHT P2P Mesh Network using PartialMesh</p>

      <div class="kv" style="margin-top: 12px;">
        <div>Signaling Server</div>
        <div class="row">
          <input v-model="signalingServer" placeholder="wss://signal.peer.ooo/ws" class="input" style="flex:1;" />
        </div>

        <div>Room ID</div>
        <div class="row">
          <input v-model="signalingRoom" placeholder="Auto-generated room" class="input" style="flex:1;" />
          <button class="btn" @click="reconnect">Reconnect</button>
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
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { PartialMesh } from '/node_modules/webdht/src/vendor/partialmesh.ts'
import { GossipProtocol } from '/node_modules/webdht/src/vendor/gossip-protocol.ts'

const signalingServer = ref('wss://signal.peer.ooo/ws')
const signalingRoom = ref('')
const messages = ref([])
const connected = ref(false)
const nodeId = ref('')
const connectedPeers = ref([])
const discoveredPeers = ref([])
let mesh = null
let gossip = null

const buildIceServers = () => {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
}

const setupMesh = async () => {
  try {
    addMessage('🚀 Initializing PartialMesh...')
    
    mesh = new PartialMesh({
      signalingServer: signalingServer.value,
      room: signalingRoom.value,
      minPeers: 1,
      maxPeers: 10,
      trickle: true,
      connectionTimeoutMs: 30000,
      bootstrapGraceMs: 12000,
      iceServers: buildIceServers(),
      debug: true,
    })

    mesh.on('signaling:connected', (data) => {
      nodeId.value = data.clientId
      connected.value = true
      addMessage(`✅ Connected to signaling server`)
      addMessage(`🆔 Node ID: ${data.clientId?.substring(0, 16)}...`)
    })

    mesh.on('signaling:disconnected', () => {
      addMessage('⚠️ Signaling disconnected (WebRTC peers stay connected)')
    })

    mesh.on('peer:connected', (peerId) => {
      addMessage(`✅ Peer connected: ${peerId.substring(0, 16)}...`)
      if (!connectedPeers.value.includes(peerId)) {
        connectedPeers.value.push(peerId)
      }
    })

    mesh.on('peer:discovered', (peerId) => {
      addMessage(`🔎 Discovered peer: ${peerId.substring(0, 16)}...`)
      if (!discoveredPeers.value.includes(peerId)) {
        discoveredPeers.value.push(peerId)
      }
    })

    mesh.on('peer:disconnected', (peerId) => {
      addMessage(`❌ Peer disconnected: ${peerId.substring(0, 16)}...`)
      connectedPeers.value = connectedPeers.value.filter(p => p !== peerId)
    })

    mesh.on('peer:error', (payload) => {
      addMessage(`❌ Peer error: ${payload?.peerId?.substring(0, 16) || 'unknown'}`)
      console.error('Peer error:', payload)
    })

    mesh.on('signaling:error', (err) => {
      addMessage(`❌ Signaling error: ${err.message || err}`)
      console.error('Signaling error:', err)
    })

    mesh.on('mesh:reset', (data) => {
      addMessage(`⚠️ Mesh reset: ${data?.reason || 'unknown'}`)
      console.warn('[mesh] reset', data)
    })

    // Initialize gossip protocol for messaging
    gossip = new GossipProtocol(mesh, { maxHops: 10 })
    
    gossip.on('messageReceived', (data) => {
      const { message, local, fromPeer } = data
      if (!local) {
        addMessage(`📨 Message from ${fromPeer?.substring(0, 16) || 'unknown'}: ${String(message.data).substring(0, 50)}`)
      }
    })

    // Initialize and connect to signaling
    await mesh.init()
    addMessage('✅ Mesh initialized successfully')
  } catch (err) {
    addMessage(`❌ Mesh initialization error: ${err.message || err}`)
    console.error('Mesh setup error:', err)
  }
}

const reconnect = async () => {
  addMessage('🔄 Reconnecting...')
  if (mesh) {
    mesh.destroy()
  }
  connectedPeers.value = []
  discoveredPeers.value = []
  connected.value = false
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
  // Keep only last 100 messages
  if (messages.value.length > 100) {
    messages.value.shift()
  }
}

onMounted(async () => {
  // Parse URL params for room
  const params = new URLSearchParams(window.location.search)
  const room = params.get('room')
  if (room) {
    signalingRoom.value = room
    addMessage(`📍 Using room from URL: ${room}`)
  } else {
    // Generate random private room to avoid public peer collisions
    signalingRoom.value = 'peer-' + Math.random().toString(36).substring(2, 10)
    window.history.replaceState({}, '', `?room=${signalingRoom.value}`)
    addMessage(`📍 Generated private room: ${signalingRoom.value}`)
  }
  
  await setupMesh()
})

onBeforeUnmount(() => {
  if (mesh) {
    mesh.destroy()
  }
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
