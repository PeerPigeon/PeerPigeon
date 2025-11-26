<template>
  <div class="network-view">
    <div class="section-header">
      <h2>🌐 Network Overview</h2>
      <p>Monitor mesh network topology, peer connections, and network health</p>
    </div>

    <!-- Network Namespace Section -->
    <div class="namespace-section">
      <h3>Network Namespace</h3>
      <div class="namespace-info">
        <div class="current-network">
          <div class="network-badge">
            <span class="network-name">{{ store.networkName }}</span>
            <span v-if="store.isInFallbackMode" class="fallback-indicator">Fallback Mode</span>
          </div>
          <div v-if="store.isInFallbackMode" class="original-network">
            Original: {{ store.originalNetworkName }}
          </div>
        </div>
        
        <div class="namespace-controls">
          <div class="network-switch">
            <input 
              v-model="newNetworkName" 
              type="text" 
              placeholder="Enter network name (e.g., 'gaming', 'work')"
              class="network-input"
              :disabled="isConnected"
            />
            <button 
              @click="switchNetwork" 
              :disabled="!newNetworkName.trim() || isConnected"
              class="btn btn-primary btn-sm"
            >
              Switch
            </button>
          </div>
          
          <div class="quick-networks">
            <button 
              v-for="network in quickNetworks" 
              :key="network"
              @click="setQuickNetwork(network)"
              :disabled="isConnected || store.networkName === network"
              :class="['btn', 'btn-outline', 'btn-xs', { active: store.networkName === network }]"
            >
              {{ network }}
            </button>
          </div>
          
          <div class="fallback-setting">
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                v-model="store.allowGlobalFallback"
                @change="updateFallbackSetting"
              />
              Allow global fallback
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Network Status Cards -->
    <div class="status-grid">
      <div class="status-card">
        <div class="status-card-icon">👥</div>
        <div class="status-card-content">
          <h3>Connected Peers</h3>
          <div class="status-value">{{ networkStatus.connectedCount }}/{{ networkStatus.maxPeers }}</div>
          <div class="status-meta">{{ canAcceptMorePeers ? 'Can accept more' : 'At capacity' }}</div>
        </div>
      </div>
      
      <div class="status-card">
        <div class="status-card-icon">🔍</div>
        <div class="status-card-content">
          <h3>Discovered Peers</h3>
          <div class="status-value">{{ discoveredPeers.size }}</div>
          <div class="status-meta">Available to connect</div>
        </div>
      </div>
      
      <div class="status-card">
        <div class="status-card-icon">⚙️</div>
        <div class="status-card-content">
          <h3>Auto Discovery</h3>
          <div class="status-value">{{ networkStatus.autoDiscovery ? 'ON' : 'OFF' }}</div>
          <div class="status-meta">Automatic peer discovery</div>
        </div>
      </div>
      
      <div class="status-card">
        <div class="status-card-icon">🔄</div>
        <div class="status-card-content">
          <h3>XOR Routing</h3>
          <div class="status-value">{{ networkStatus.xorRouting ? 'ON' : 'OFF' }}</div>
          <div class="status-meta">Distance-based routing</div>
        </div>
      </div>
    </div>

    <!-- Network Configuration -->
    <div class="config-section">
      <h3>Network Configuration</h3>
      <div class="config-grid">
        <div class="config-item">
          <label>Max Peers</label>
          <input 
            v-model.number="maxPeers" 
            type="number" 
            min="1" 
            max="50"
            @change="updateMaxPeers"
            class="config-input"
          >
        </div>
        <div class="config-item">
          <label>Min Peers</label>
          <input 
            v-model.number="minPeers" 
            type="number" 
            min="0" 
            :max="maxPeers - 1"
            @change="updateMinPeers"
            class="config-input"
          >
        </div>
        <div class="config-item">
          <label>Auto Discovery</label>
          <button 
            @click="toggleAutoDiscovery"
            :class="['toggle-btn', { active: networkStatus.autoDiscovery }]"
          >
            {{ networkStatus.autoDiscovery ? 'ON' : 'OFF' }}
          </button>
        </div>
        <div class="config-item">
          <label>Eviction Strategy</label>
          <button 
            @click="toggleEvictionStrategy"
            :class="['toggle-btn', { active: networkStatus.evictionStrategy }]"
          >
            {{ networkStatus.evictionStrategy ? 'ON' : 'OFF' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Connected Peers List -->
    <div class="peers-section">
      <div class="section-title">
        <h3>Connected Peers ({{ connectedPeersList.length }})</h3>
        <button @click="refreshPeerList" class="btn btn-secondary">Refresh</button>
      </div>
      
      <div class="peers-list">
        <div v-if="connectedPeersList.length === 0" class="empty-state">
          <div class="empty-icon">😔</div>
          <p>No peers connected yet</p>
          <p class="empty-meta">Connect to the signaling server to discover peers</p>
        </div>
        
        <div 
          v-for="peer in connectedPeersList" 
          :key="peer.id"
          class="peer-card"
        >
          <div class="peer-header">
            <div class="peer-id">
              <span class="peer-icon">👤</span>
              {{ peer.id.substring(0, 16) }}...
            </div>
            <div class="peer-status" :class="peer.status">
              {{ peer.status }}
            </div>
          </div>
          
          <div class="peer-details">
            <div class="peer-detail">
              <strong>Connected:</strong> {{ formatTime(peer.connectionTime) }}
            </div>
            <div class="peer-detail" v-if="peer.disconnectionTime">
              <strong>Disconnected:</strong> {{ formatTime(peer.disconnectionTime) }}
            </div>
            <div class="peer-detail" v-if="peer.disconnectionReason">
              <strong>Reason:</strong> {{ peer.disconnectionReason }}
            </div>
          </div>
          
          <div class="peer-actions">
            <button 
              @click="sendPing(peer.id)"
              class="btn btn-sm btn-primary"
              :disabled="!peer.connected"
            >
              Ping
            </button>
            <button 
              @click="disconnectPeer(peer.id)"
              class="btn btn-sm btn-danger"
              :disabled="!peer.connected"
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Discovered Peers -->
    <div class="peers-section" v-if="discoveredPeers.size > 0">
      <h3>Discovered Peers ({{ discoveredPeers.size }})</h3>
      
      <div class="peers-list">
        <div 
          v-for="peer in Array.from(discoveredPeers.values())" 
          :key="peer.id"
          class="peer-card discovered"
        >
          <div class="peer-header">
            <div class="peer-id">
              <span class="peer-icon">🔍</span>
              {{ peer.id.substring(0, 16) }}...
            </div>
            <div class="peer-status discovered">
              discovered
            </div>
          </div>
          
          <div class="peer-details">
            <div class="peer-detail">
              <strong>Discovered:</strong> {{ formatTime(peer.discoveryTime) }}
            </div>
          </div>
          
          <div class="peer-actions">
            <button 
              @click="connectToPeer(peer.id)"
              class="btn btn-sm btn-primary"
              :disabled="!canAcceptMorePeers"
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Network Statistics -->
    <div class="stats-section">
      <h3>Network Statistics</h3>
      <div class="stats-grid">
        <div class="stat-item">
          <strong>Your Peer ID:</strong>
          <code>{{ peerId }}</code>
        </div>
        <div class="stat-item">
          <strong>Network Health:</strong>
          <span :class="getNetworkHealthClass()">{{ getNetworkHealth() }}</span>
        </div>
        <div class="stat-item">
          <strong>Connection Time:</strong>
          {{ connectionUptime }}
        </div>
        <div class="stat-item">
          <strong>Environment:</strong>
          {{ getEnvironmentInfo() }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

// Local reactive state
const maxPeers = ref(3);
const minPeers = ref(2);
const connectionStartTime = ref(null);
const uptimeInterval = ref(null);
const connectionUptime = ref('00:00:00');

// Network namespace state
const newNetworkName = ref('');
const quickNetworks = ['global', 'gaming', 'work', 'family', 'test'];

// Computed properties
const networkStatus = computed(() => store.networkStatus);
const peers = computed(() => store.peers);
const discoveredPeers = computed(() => store.discoveredPeers);
const connectedPeersList = computed(() => store.connectedPeersList);
const canAcceptMorePeers = computed(() => store.canAcceptMorePeers);
const peerId = computed(() => store.peerId);
const isConnected = computed(() => store.isConnected);

// Network namespace methods
const switchNetwork = () => {
  if (newNetworkName.value.trim()) {
    store.setNetworkName(newNetworkName.value.trim());
    store.addDebugLog(`Network set to: ${newNetworkName.value.trim()}`, 'success');
    newNetworkName.value = '';
  }
};

const setQuickNetwork = (network) => {
  store.setNetworkName(network);
  store.addDebugLog(`Quick switch to network: ${network}`, 'success');
};

const updateFallbackSetting = () => {
  store.setAllowGlobalFallback(store.allowGlobalFallback);
};

// Methods
const updateMaxPeers = () => {
  if (store.mesh) {
    store.mesh.setMaxPeers(maxPeers.value);
    store.addDebugLog(`Max peers updated to ${maxPeers.value}`);
  }
};

const updateMinPeers = () => {
  if (store.mesh) {
    store.mesh.setMinPeers(minPeers.value);
    store.addDebugLog(`Min peers updated to ${minPeers.value}`);
  }
};

const toggleAutoDiscovery = () => {
  if (store.mesh) {
    const newValue = !networkStatus.value.autoDiscovery;
    store.mesh.setAutoDiscovery(newValue);
    store.addDebugLog(`Auto discovery ${newValue ? 'enabled' : 'disabled'}`);
  }
};

const toggleEvictionStrategy = () => {
  if (store.mesh) {
    const newValue = !networkStatus.value.evictionStrategy;
    store.mesh.setEvictionStrategy(newValue);
    store.addDebugLog(`Eviction strategy ${newValue ? 'enabled' : 'disabled'}`);
  }
};

const refreshPeerList = () => {
  store.addDebugLog('Peer list refreshed');
  // The peer list is automatically updated through events
};

const sendPing = (peerId) => {
  store.sendDirectMessage(peerId, { type: 'ping', timestamp: Date.now() });
  store.addDebugLog(`Ping sent to ${peerId.substring(0, 8)}...`);
};

const disconnectPeer = (peerId) => {
  if (store.mesh) {
    // Note: PeerPigeon doesn't have a direct disconnect peer method
    // This would typically be handled by the ConnectionManager
    store.addDebugLog(`Disconnect requested for ${peerId.substring(0, 8)}...`);
  }
};

const connectToPeer = (peerId) => {
  try {
    store.connectToPeer(peerId);
    store.addDebugLog(`Connection attempt to ${peerId.substring(0, 8)}...`);
  } catch (e) {
    store.addDebugLog(`Failed to connect to peer: ${e.message}`, 'error');
  }
};

const formatTime = (date) => {
  if (!date) return 'Unknown';
  return date.toLocaleTimeString();
};

const getNetworkHealth = () => {
  const connected = networkStatus.value.connectedCount;
  const min = networkStatus.value.minPeers;
  const max = networkStatus.value.maxPeers;
  
  if (connected === 0) return 'Isolated';
  if (connected >= max) return 'Excellent';
  if (connected >= min) return 'Good';
  if (connected > 0) return 'Fair';
  return 'Unknown';
};

const getNetworkHealthClass = () => {
  const health = getNetworkHealth();
  return {
    'health-isolated': health === 'Isolated',
    'health-poor': health === 'Poor' || health === 'Fair',
    'health-good': health === 'Good',
    'health-excellent': health === 'Excellent'
  };
};

const getEnvironmentInfo = () => {
  // Check if WebRTC is available
  const hasWebRTC = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection);
  return `Browser (WebRTC: ${hasWebRTC ? 'Yes' : 'No'})`;
};

const updateUptime = () => {
  if (connectionStartTime.value && isConnected.value) {
    const now = new Date();
    const diff = now - connectionStartTime.value;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    
    connectionUptime.value = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
    connectionUptime.value = '00:00:00';
  }
};

// Watch for connection changes
const unwatchConnection = computed(() => isConnected.value, (connected) => {
  if (connected) {
    connectionStartTime.value = new Date();
  } else {
    connectionStartTime.value = null;
  }
});

onMounted(() => {
  // Initialize local state from store
  maxPeers.value = networkStatus.value.maxPeers;
  minPeers.value = networkStatus.value.minPeers;
  
  // Start uptime counter
  uptimeInterval.value = setInterval(updateUptime, 1000);
});

onUnmounted(() => {
  if (uptimeInterval.value) {
    clearInterval(uptimeInterval.value);
  }
});
</script>

<style scoped>
.network-view {
  max-width: 1000px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 30px;
}

.section-header h2 {
  font-size: 28px;
  color: #333;
  margin-bottom: 8px;
}

.section-header p {
  color: #666;
  font-size: 16px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 40px;
}

.status-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-card-icon {
  font-size: 32px;
  opacity: 0.8;
}

.status-card-content h3 {
  font-size: 14px;
  color: #666;
  margin: 0 0 8px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-value {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.status-meta {
  font-size: 12px;
  color: #999;
}

.config-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.config-section h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-item label {
  font-size: 14px;
  font-weight: 500;
  color: #666;
}

.config-input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.toggle-btn {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-btn.active {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

.peers-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-title h3 {
  margin: 0;
  color: #333;
}

.peers-list {
  display: grid;
  gap: 16px;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-meta {
  font-size: 14px;
  color: #999;
}

.peer-card {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.peer-card.discovered {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.peer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.peer-id {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  font-size: 14px;
  color: #333;
}

.peer-icon {
  font-size: 16px;
}

.peer-status {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
}

.peer-status.connected {
  background: #22c55e;
  color: white;
}

.peer-status.disconnected {
  background: #ef4444;
  color: white;
}

.peer-status.discovered {
  background: #3b82f6;
  color: white;
}

.peer-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.peer-detail {
  font-size: 13px;
  color: #666;
}

.peer-actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 11px;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-secondary {
  background: #6b7280;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background: #4b5563;
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.stats-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.stats-section h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.stats-grid {
  display: grid;
  gap: 16px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #eee;
}

.stat-item:last-child {
  border-bottom: none;
}

.stat-item code {
  background: #f5f5f5;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  word-break: break-all;
}

.health-isolated {
  color: #ef4444;
  font-weight: 600;
}

.health-poor {
  color: #f59e0b;
  font-weight: 600;
}

.health-good {
  color: #3b82f6;
  font-weight: 600;
}

.health-excellent {
  color: #22c55e;
  font-weight: 600;
}

/* Network Namespace Styles */
.namespace-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
}

.namespace-section h3 {
  margin: 0 0 16px 0;
  color: #1e293b;
  font-size: 18px;
  font-weight: 600;
}

.namespace-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px;
  align-items: start;
}

.current-network {
  min-width: 200px;
}

.network-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.network-name {
  background: #3b82f6;
  color: white;
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 14px;
}

.fallback-indicator {
  background: #f59e0b;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.original-network {
  color: #64748b;
  font-size: 13px;
}

.namespace-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.network-switch {
  display: flex;
  gap: 8px;
  align-items: center;
}

.network-input {
  flex: 1;
  max-width: 300px;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.network-input:disabled {
  background-color: #f3f4f6;
  opacity: 0.6;
}

.quick-networks {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.fallback-setting {
  display: flex;
  align-items: center;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #374151;
}

.checkbox-label input[type="checkbox"] {
  margin: 0;
}

.btn-xs {
  padding: 4px 8px;
  font-size: 12px;
}

.btn-outline {
  background: transparent;
  border: 1px solid #d1d5db;
  color: #374151;
}

.btn-outline:hover:not(:disabled) {
  background: #f3f4f6;
}

.btn-outline.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

@media (max-width: 768px) {
  .namespace-info {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  
  .network-switch {
    flex-direction: column;
    align-items: stretch;
  }
  
  .network-input {
    max-width: none;
  }
}
</style>
