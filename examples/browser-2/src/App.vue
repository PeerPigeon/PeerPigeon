<template>
  <div id="app">
    <!-- Navigation Header -->
    <header class="header">
      <div class="container">
        <div class="header-content">
          <div class="logo">
            <img src="../browser/assets/images/favicon.png" alt="PeerPigeon" class="logo-img">
            <h1>PeerPigeon Vue 3 Demo</h1>
          </div>
          
          <div class="status-bar">
            <div class="status-item" :class="{ connected: isConnected, disconnected: !isConnected }">
              <span class="status-dot"></span>
              {{ isConnected ? 'Connected' : 'Disconnected' }}
            </div>
            <div class="status-item" v-if="peerId">
              <strong>ID:</strong> {{ peerId.substring(0, 8) }}...
            </div>
            <div class="status-item">
              <strong>Peers:</strong> {{ networkStatus.connectedCount }}/{{ networkStatus.maxPeers }}
            </div>
          </div>
          
          <div class="connection-controls">
            <input 
              v-model="signalingUrl" 
              placeholder="ws://localhost:3000"
              class="url-input"
              :disabled="isConnected"
            >
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
const peerId = computed(() => store.peerId);
const networkStatus = computed(() => store.networkStatus);

// Methods
const handleConnect = async () => {
  try {
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
    await store.initMesh();
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

.logo-img {
  width: 32px;
  height: 32px;
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
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.url-input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  min-width: 200px;
}

.url-input:disabled {
  background: #f5f5f5;
  color: #999;
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
  }
  
  .url-input {
    min-width: 150px;
  }
  
  .tabs {
    justify-content: center;
  }
}
</style>
