<template>
  <div id="app">
    <!-- Navigation Header -->
    <header class="header">
      <div class="container">
        <div class="header-content">
          <div class="logo">
            <span class="logo-icon">🐦</span>
            <h1>PeerPigeon Vue 3 Demo</h1>
          </div>
          
          <div class="status-bar">
            <div class="status-item" :class="{ connected: isConnected, disconnected: !isConnected }">
              <span class="status-dot"></span>
              {{ isConnected ? 'Connected' : 'Disconnected' }}
            </div>
            <div class="status-item" v-if="networkName">
              <strong>Network:</strong> 
              <span class="network-display">{{ networkName }}</span>
              <span v-if="store.isInFallbackMode" class="fallback-indicator">Fallback</span>
            </div>
            <div class="status-item" v-if="peerId">
              <strong>ID:</strong> {{ peerId.substring(0, 8) }}...
            </div>
            <div class="status-item">
              <strong>Peers:</strong> {{ networkStatus.connectedCount }}/{{ networkStatus.maxPeers }}
            </div>
          </div>
          
          <div class="connection-controls">
            <div class="input-group">
              <label for="network-input">Network:</label>
              <input 
                id="network-input"
                v-model="networkName" 
                placeholder="global"
                class="network-input"
                :disabled="isConnected"
                title="Network name (e.g., 'gaming', 'work', 'family')"
              >
            </div>
            <div class="input-group">
              <label for="url-input">Signaling Server:</label>
              <input 
                id="url-input"
                v-model="signalingUrl" 
                placeholder="ws://localhost:3000"
                class="url-input"
                :disabled="isConnected"
              >
            </div>
            <button 
              v-if="!isConnected" 
              @click="handleConnect"
              :disabled="!isInitialized"
              class="btn btn-primary"
            >
              {{ isInitialized ? 'Connect' : 'Initializing...' }}
            </button>
            <button 
              v-else 
              @click="handleDisconnect"
              class="btn btn-secondary"
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="nav-tabs">
      <div class="container">
        <div class="tabs">
          <router-link to="/network" class="tab">
            <span class="tab-icon">🌐</span>
            Network
          </router-link>
          <router-link to="/messaging" class="tab">
            <span class="tab-icon">💬</span>
            Messaging
          </router-link>
          <router-link to="/media" class="tab">
            <span class="tab-icon">🎥</span>
            Media
          </router-link>
          <router-link to="/dht" class="tab">
            <span class="tab-icon">🗄️</span>
            DHT
          </router-link>
          <router-link to="/storage" class="tab">
            <span class="tab-icon">📦</span>
            Storage
          </router-link>
          <router-link to="/crypto" class="tab">
            <span class="tab-icon">🔐</span>
            Crypto
          </router-link>
          <router-link to="/debug" class="tab">
            <span class="tab-icon">🐛</span>
            Debug
          </router-link>
          <router-link to="/testing" class="tab">
            <span class="tab-icon">🧪</span>
            Testing
          </router-link>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="main-content">
      <div class="container">
        <router-view />
      </div>
    </main>

    <!-- Global Notifications/Toasts would go here -->
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue';
import { usePeerPigeonStore } from './stores/peerpigeon.js';

const store = usePeerPigeonStore();

// Computed properties
const isInitialized = computed(() => store.isInitialized);
const isConnected = computed(() => store.isConnected);
const signalingUrl = computed({
  get: () => store.signalingUrl,
  set: (value) => store.signalingUrl = value
});
const networkName = computed({
  get: () => store.networkName,
  set: (value) => store.setNetworkName(value)
});
const peerId = computed(() => store.peerId);
const networkStatus = computed(() => store.networkStatus);

// Methods
const handleConnect = async () => {
  try {
    // Set network name before connecting
    if (networkName.value && networkName.value.trim()) {
      store.setNetworkName(networkName.value.trim());
    }
    await store.connectToSignaling(signalingUrl.value);
  } catch (error) {
    console.error('Connection failed:', error);
    alert(`Connection failed: ${error.message}`);
  }
};

const handleDisconnect = () => {
  store.disconnect();
};

// Initialize on mount
onMounted(async () => {
  try {
    // Initialize with initial network name if provided
    const initialOptions = {};
    if (networkName.value && networkName.value.trim()) {
      initialOptions.networkName = networkName.value.trim();
    }
    await store.initMesh(initialOptions);
  } catch (error) {
    console.error('Failed to initialize mesh:', error);
    alert(`Failed to initialize mesh: ${error.message}`);
  }
});
</script>

<style scoped>
.header {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  position: sticky;
  top: 0;
  z-index: 100;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 0;
  flex-wrap: wrap;
  gap: 20px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  font-size: 32px;
}

.logo h1 {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.status-bar {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #666;
}

.status-item.connected {
  color: #22c55e;
}

.status-item.disconnected {
  color: #ef4444;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.connection-controls {
  display: flex;
  gap: 15px;
  align-items: end;
  flex-wrap: wrap;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-group label {
  font-size: 12px;
  font-weight: 500;
  color: #666;
  margin: 0;
}

.network-input,
.url-input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  min-width: 150px;
}

.network-input {
  min-width: 120px;
}

.url-input {
  min-width: 200px;
}

.network-input:disabled,
.url-input:disabled {
  background: #f5f5f5;
  color: #999;
}

.network-display {
  color: #3b82f6;
  font-weight: 600;
}

.fallback-indicator {
  background: #f59e0b;
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  margin-left: 6px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

.nav-tabs {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  padding: 10px 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  text-decoration: none;
  color: #666;
  border-radius: 8px;
  transition: all 0.2s;
  white-space: nowrap;
  font-weight: 500;
}

.tab:hover {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.tab.router-link-active {
  background: #3b82f6;
  color: white;
}

.tab-icon {
  font-size: 16px;
}

.main-content {
  padding: 30px 0;
  min-height: calc(100vh - 200px);
}

/* Responsive design */
@media (max-width: 768px) {
  .header-content {
    flex-direction: column;
    align-items: stretch;
    gap: 15px;
  }
  
  .logo {
    justify-content: center;
  }
  
  .status-bar {
    justify-content: center;
  }
  
  .connection-controls {
    justify-content: center;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  
  .input-group {
    width: 100%;
    max-width: 250px;
  }
  
  .network-input,
  .url-input {
    width: 100%;
    min-width: auto;
  }
  
  .tabs {
    justify-content: center;
  }
}
</style>
