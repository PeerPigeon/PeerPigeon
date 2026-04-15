<template>
  <div>
    <h2 class="section-title">🌐 Connection Management</h2>

    <!-- Network & Signaling Server -->
    <div class="card">
      <h3>🌐 Network & Signaling Server</h3>
      <div class="input-group">
        <label>Network Name:</label>
        <input v-model="store.networkName" :disabled="store.isConnected" type="text"
               placeholder="global (e.g. gaming, work, family)" />
        <small>Create isolated networks or use 'global' for the default mesh</small>
      </div>
      <div class="input-group">
        <label>Server URL:</label>
        <input v-model="store.signalingUrl" :disabled="store.isConnected" type="text"
               placeholder="wss://peer.ooo/ws" />
      </div>
      <div class="checkbox-group">
        <label>
          <input v-model="store.allowGlobalFallback" type="checkbox" />
          Allow Global Fallback
        </label>
        <small style="width:100%;color:#718096;font-size:11px;">
          Automatically fallback to global network when current network is empty
        </small>
      </div>
      <div class="button-group">
        <button class="btn primary" :disabled="store.isConnected" @click="handleConnect">Connect</button>
        <button class="btn secondary" :disabled="!store.isConnected" @click="handleDisconnect">Disconnect</button>
        <button class="btn tertiary" :disabled="!store.isConnected" @click="handleCleanup">Cleanup Stale Data</button>
      </div>

      <div v-if="store.isConnected" class="network-info">
        <strong>Current Network:</strong> {{ store.networkName }}
        <span v-if="isInFallback" class="fallback-badge">Fallback Mode</span>
      </div>
    </div>

    <!-- Quick Network Switch -->
    <div class="card">
      <h3>🎯 Quick Network Switch</h3>
      <p class="description">Quickly switch between common networks (only when disconnected)</p>
      <div class="quick-networks">
        <button
          v-for="net in quickNetworks"
          :key="net"
          :class="['btn', 'tertiary', store.networkName === net ? 'active' : '']"
          :disabled="store.isConnected"
          @click="store.networkName = net"
        >{{ net }}</button>
      </div>
    </div>

    <!-- Mesh Configuration -->
    <div class="card">
      <h3>⚙️ Mesh Configuration</h3>
      <div class="config-grid">
        <div class="input-group">
          <label>Max Peers:</label>
          <input v-model.number="config.maxPeers" type="number" min="1" max="20" />
        </div>
        <div class="input-group">
          <label>Min Peers:</label>
          <input v-model.number="config.minPeers" type="number" min="1" max="10" />
        </div>
      </div>
      <div class="checkbox-group">
        <label><input v-model="config.autoConnect" type="checkbox" /> Auto Connect</label>
        <label><input v-model="config.autoDiscovery" type="checkbox" /> Auto Discovery</label>
        <label><input v-model="config.evictionStrategy" type="checkbox" /> Eviction Strategy</label>
        <label><input v-model="config.xorRouting" type="checkbox" /> XOR Routing</label>
        <label><input v-model="config.enableCrypto" type="checkbox" /> Enable Crypto</label>
        <label><input v-model="config.enableWebDHT" type="checkbox" /> Enable WebDHT</label>
        <label><input v-model="config.enableStorage" type="checkbox" /> Enable Distributed Storage</label>
      </div>
      <button class="btn tertiary" @click="applyConfig">Apply Configuration</button>
    </div>

    <!-- Connected Peers -->
    <div class="card">
      <h3>Connected Peers ({{ store.networkStatus.connectedCount }})</h3>
      <div class="peers-list">
        <p v-if="connectedList.length === 0" class="empty-state">No peers connected</p>
        <div v-for="peer in connectedList" :key="peer.id" class="peer-item">
          <span class="peer-id-mono">{{ peer.id.substring(0,8) }}...{{ peer.id.substring(peer.id.length - 8) }}</span>
          <span :class="['peer-badge', peer.connected ? 'connected' : 'disconnected']">
            {{ peer.connected ? 'connected' : 'disconnected' }}
          </span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <input v-model="manualPeerId" type="text" placeholder="Enter peer ID to connect" style="flex:1;min-width:200px;" />
        <button class="btn tertiary" @click="connectToPeer">Connect to Peer</button>
        <button class="btn tertiary" @click="forceConnectAll">Force Connect All</button>
      </div>
    </div>

    <!-- Connection Error -->
    <div v-if="errorMsg" class="card" style="border-left:3px solid #fc8181;">
      <p style="color:#c53030;font-size:13px;">❌ {{ errorMsg }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();
const errorMsg = ref('');
const manualPeerId = ref('');
const isInFallback = ref(false);

const quickNetworks = ['global', 'gaming', 'work', 'family', 'test'];

const config = reactive({
  maxPeers: 6,
  minPeers: 1,
  autoConnect: true,
  autoDiscovery: true,
  evictionStrategy: true,
  xorRouting: true,
  enableCrypto: true,
  enableWebDHT: true,
  enableStorage: true,
});

const connectedList = computed(() => Array.from(store.peers.values()));

const handleConnect = async () => {
  errorMsg.value = '';
  try {
    await store.connect();
  } catch (e) {
    errorMsg.value = e.message;
  }
};

const handleDisconnect = () => {
  store.disconnect();
};

const handleCleanup = async () => {
  try {
    await store.mesh?.cleanupStaleSignalingData?.();
    store.addDebugLog('Stale signaling data cleaned up', 'info');
  } catch (e) {
    store.addDebugLog(`Cleanup error: ${e.message}`, 'error');
  }
};

const applyConfig = () => {
  const m = store.mesh;
  if (!m) return;
  m.setMaxPeers?.(config.maxPeers);
  m.setMinPeers?.(config.minPeers);
  m.setAutoConnect?.(config.autoConnect);
  m.setAutoDiscovery?.(config.autoDiscovery);
  m.setEvictionStrategy?.(config.evictionStrategy);
  m.setXorRouting?.(config.xorRouting);
  store.addDebugLog('Configuration applied', 'success');
};

const connectToPeer = async () => {
  const id = manualPeerId.value.trim();
  if (!id) return;
  try {
    const started = await store.mesh?.connectToPeer?.(id);
    if (started) {
      store.addDebugLog(`Attempting to connect to peer: ${id.substring(0,8)}...`, 'info');
    } else {
      store.addDebugLog(`Peer already connected: ${id.substring(0,8)}...`, 'warning');
    }
  } catch (e) {
    store.addDebugLog(`Manual connect failed: ${e.message}`, 'error');
    errorMsg.value = e.message;
  }
  manualPeerId.value = '';
};

const forceConnectAll = () => {
  const count = store.mesh?.forceConnectToAllPeers?.() ?? 0;
  store.addDebugLog(`Forced ${count} connection attempts`, 'info');
};
</script>

<style scoped>
.network-info { 
  font-size: 13px; 
  color: #4a5568; 
  background: #f7fafc; 
  padding: 10px 14px; 
  border-radius: 8px; 
  margin-top: 8px; 
}
.peer-id-mono { font-family: monospace; font-size: 12px; }
</style>
