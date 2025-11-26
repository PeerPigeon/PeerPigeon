<template>
  <div class="dht-view">
    <div class="section-header">
      <h2>🗄️ Distributed Hash Table (WebDHT)</h2>
      <p>Store and retrieve data across the mesh network with automatic replication and pub/sub</p>
    </div>

    <!-- DHT Operations -->
    <div class="dht-operations">
      <h3>📝 DHT Operations</h3>
      
      <div class="operation-tabs">
        <button 
          @click="activeTab = 'put'"
          :class="['tab-btn', { active: activeTab === 'put' }]"
        >
          PUT (Store)
        </button>
        <button 
          @click="activeTab = 'get'"
          :class="['tab-btn', { active: activeTab === 'get' }]"
        >
          GET (Retrieve)
        </button>
        <button 
          @click="activeTab = 'subscribe'"
          :class="['tab-btn', { active: activeTab === 'subscribe' }]"
        >
          SUBSCRIBE
        </button>
        <button 
          @click="activeTab = 'update'"
          :class="['tab-btn', { active: activeTab === 'update' }]"
        >
          UPDATE
        </button>
      </div>

      <!-- PUT Operation -->
      <div v-if="activeTab === 'put'" class="operation-panel">
        <h4>📤 Store Data in DHT</h4>
        <p class="operation-description">
          Store key-value pairs in the distributed hash table. Data is automatically replicated across peers.
        </p>
        
        <div class="form-group">
          <label>Key:</label>
          <input 
            v-model="putKey" 
            placeholder="e.g., user:settings, app:config, shared:counter"
            class="form-input"
          >
        </div>
        
        <div class="form-group">
          <label>Value (JSON):</label>
          <textarea 
            v-model="putValue" 
            placeholder='{"theme": "dark", "language": "en"}'
            rows="4"
            class="form-textarea"
          ></textarea>
        </div>
        
        <div class="form-group">
          <label>TTL (seconds, optional):</label>
          <input 
            v-model.number="putTTL" 
            type="number"
            placeholder="Leave empty for no expiration"
            class="form-input"
          >
        </div>
        
        <button 
          @click="performPut"
          :disabled="!putKey || !putValue || !isConnected"
          class="btn btn-primary"
        >
          <span class="btn-icon">💾</span>
          Store in DHT
        </button>
      </div>

      <!-- GET Operation -->
      <div v-if="activeTab === 'get'" class="operation-panel">
        <h4>📥 Retrieve Data from DHT</h4>
        <p class="operation-description">
          Retrieve values by key from the distributed hash table. Data is fetched from available peers.
        </p>
        
        <div class="form-group">
          <label>Key:</label>
          <input 
            v-model="getKey" 
            placeholder="Enter key to retrieve"
            class="form-input"
          >
        </div>
        
        <div class="form-group">
          <label>
            <input type="checkbox" v-model="forceRefresh">
            Force refresh from network
          </label>
        </div>
        
        <button 
          @click="performGet"
          :disabled="!getKey || !isConnected"
          class="btn btn-primary"
        >
          <span class="btn-icon">🔍</span>
          Retrieve from DHT
        </button>
        
        <div v-if="getResult" class="result-panel">
          <h5>Result:</h5>
          <pre class="result-content">{{ JSON.stringify(getResult, null, 2) }}</pre>
        </div>
      </div>

      <!-- SUBSCRIBE Operation -->
      <div v-if="activeTab === 'subscribe'" class="operation-panel">
        <h4>🔔 Subscribe to Key Changes</h4>
        <p class="operation-description">
          Subscribe to real-time notifications when a key's value changes in the DHT.
        </p>
        
        <div class="form-group">
          <label>Key to subscribe:</label>
          <input 
            v-model="subscribeKey" 
            placeholder="Enter key to watch for changes"
            class="form-input"
          >
        </div>
        
        <div class="subscription-controls">
          <button 
            @click="performSubscribe"
            :disabled="!subscribeKey || isSubscribed(subscribeKey) || !isConnected"
            class="btn btn-success"
          >
            <span class="btn-icon">🔔</span>
            Subscribe
          </button>
          
          <button 
            @click="performUnsubscribe"
            :disabled="!subscribeKey || !isSubscribed(subscribeKey) || !isConnected"
            class="btn btn-warning"
          >
            <span class="btn-icon">🔕</span>
            Unsubscribe
          </button>
        </div>
        
        <div class="subscriptions-list">
          <h5>Active Subscriptions ({{ subscriptions.size }}):</h5>
          <div v-if="subscriptions.size === 0" class="empty-state">
            No active subscriptions
          </div>
          <div v-else class="subscription-items">
            <div 
              v-for="sub in Array.from(subscriptions)" 
              :key="sub"
              class="subscription-item"
            >
              <span class="subscription-key">{{ sub }}</span>
              <button 
                @click="unsubscribeFromKey(sub)"
                class="btn btn-sm btn-danger"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- UPDATE Operation -->
      <div v-if="activeTab === 'update'" class="operation-panel">
        <h4>🔄 Update Existing Data</h4>
        <p class="operation-description">
          Update existing data in the DHT and notify all subscribers of the change.
        </p>
        
        <div class="form-group">
          <label>Key:</label>
          <input 
            v-model="updateKey" 
            placeholder="Key to update"
            class="form-input"
          >
        </div>
        
        <div class="form-group">
          <label>New Value (JSON):</label>
          <textarea 
            v-model="updateValue" 
            placeholder='{"updated": true, "timestamp": 1234567890}'
            rows="4"
            class="form-textarea"
          ></textarea>
        </div>
        
        <button 
          @click="performUpdate"
          :disabled="!updateKey || !updateValue || !isConnected"
          class="btn btn-primary"
        >
          <span class="btn-icon">🔄</span>
          Update in DHT
        </button>
      </div>
    </div>

    <!-- Stored Data Display -->
    <div class="stored-data">
      <div class="section-title">
        <h3>💾 Stored Data ({{ dhtData.size }})</h3>
        <div class="data-controls">
          <button @click="refreshAllData" class="btn btn-secondary">
            <span class="btn-icon">🔄</span>
            Refresh All
          </button>
          <button @click="clearLocalData" class="btn btn-danger">
            <span class="btn-icon">🗑️</span>
            Clear Local
          </button>
        </div>
      </div>
      
      <div v-if="dhtData.size === 0" class="empty-data">
        <div class="empty-icon">📭</div>
        <p>No data stored yet</p>
        <p class="empty-meta">Store some data using the PUT operation above</p>
      </div>
      
      <div v-else class="data-grid">
        <div 
          v-for="[key, data] in Array.from(dhtData.entries())" 
          :key="key"
          class="data-item"
        >
          <div class="data-header">
            <h4 class="data-key">{{ key }}</h4>
            <div class="data-badges">
              <span v-if="data.local" class="badge badge-local">Local</span>
              <span v-else class="badge badge-remote">Remote</span>
              <span v-if="isSubscribed(key)" class="badge badge-subscribed">Subscribed</span>
            </div>
          </div>
          
          <div class="data-meta">
            <span class="data-timestamp">{{ formatTime(data.timestamp) }}</span>
            <span v-if="data.version" class="data-version">v{{ data.version }}</span>
          </div>
          
          <div class="data-content">
            <pre>{{ JSON.stringify(data.value, null, 2) }}</pre>
          </div>
          
          <div class="data-actions">
            <button @click="copyKey(key)" class="btn btn-sm btn-secondary">
              <span class="btn-icon">📋</span>
              Copy Key
            </button>
            <button @click="refreshSingleData(key)" class="btn btn-sm btn-secondary">
              <span class="btn-icon">🔄</span>
              Refresh
            </button>
            <button 
              v-if="!isSubscribed(key)"
              @click="quickSubscribe(key)" 
              class="btn btn-sm btn-success"
            >
              <span class="btn-icon">🔔</span>
              Subscribe
            </button>
            <button 
              v-else
              @click="quickUnsubscribe(key)" 
              class="btn btn-sm btn-warning"
            >
              <span class="btn-icon">🔕</span>
              Unsubscribe
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Change Notifications -->
    <div class="notifications" v-if="notifications.length > 0">
      <h3>🔔 Recent Change Notifications</h3>
      <div class="notifications-list">
        <div 
          v-for="notification in notifications.slice().reverse()" 
          :key="notification.id"
          class="notification-item"
        >
          <div class="notification-header">
            <span class="notification-key">{{ notification.key }}</span>
            <span class="notification-time">{{ formatTime(notification.timestamp) }}</span>
          </div>
          <div class="notification-content">
            <strong>Old:</strong> <code>{{ JSON.stringify(notification.oldValue) }}</code><br>
            <strong>New:</strong> <code>{{ JSON.stringify(notification.newValue) }}</code>
          </div>
        </div>
      </div>
      <button @click="clearNotifications" class="btn btn-secondary btn-sm">
        Clear Notifications
      </button>
    </div>

    <!-- DHT Statistics -->
    <div class="stats-section">
      <h3>📊 DHT Statistics</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">🗄️</div>
          <div class="stat-content">
            <h4>Local Data</h4>
            <div class="stat-value">{{ localDataCount }}</div>
            <div class="stat-meta">Keys stored locally</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🌐</div>
          <div class="stat-content">
            <h4>Remote Data</h4>
            <div class="stat-value">{{ remoteDataCount }}</div>
            <div class="stat-meta">Keys from other peers</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🔔</div>
          <div class="stat-content">
            <h4>Subscriptions</h4>
            <div class="stat-value">{{ subscriptions.size }}</div>
            <div class="stat-meta">Active key watchers</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">📈</div>
          <div class="stat-content">
            <h4>Notifications</h4>
            <div class="stat-value">{{ notifications.length }}</div>
            <div class="stat-meta">Change notifications received</div>
          </div>
        </div>
      </div>
      
      <div class="dht-stats-detail" v-if="dhtStats">
        <h4>Detailed DHT Statistics:</h4>
        <pre class="stats-json">{{ JSON.stringify(dhtStats, null, 2) }}</pre>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions">
      <h3>⚡ Quick Actions</h3>
      <div class="action-buttons">
        <button @click="storeUserPreferences" class="btn btn-secondary">
          <span class="btn-icon">👤</span>
          Store User Preferences
        </button>
        
        <button @click="storeSharedCounter" class="btn btn-secondary">
          <span class="btn-icon">🔢</span>
          Create Shared Counter
        </button>
        
        <button @click="storeSystemInfo" class="btn btn-secondary">
          <span class="btn-icon">ℹ️</span>
          Store System Info
        </button>
        
        <button @click="performStressTest" class="btn btn-secondary">
          <span class="btn-icon">🧪</span>
          DHT Stress Test
        </button>
        
        <button @click="demonstrateReplication" class="btn btn-secondary">
          <span class="btn-icon">🔄</span>
          Test Replication
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

// Local reactive state
const activeTab = ref('put');
const putKey = ref('');
const putValue = ref('');
const putTTL = ref(null);
const getKey = ref('');
const getResult = ref(null);
const forceRefresh = ref(false);
const subscribeKey = ref('');
const updateKey = ref('');
const updateValue = ref('');
const subscriptions = ref(new Set());
const notifications = ref([]);

// Computed properties
const dhtData = computed(() => store.dhtData);
const dhtStats = computed(() => store.getDHTStats());
const isConnected = computed(() => store.isConnected);

const localDataCount = computed(() => {
  return Array.from(dhtData.value.values()).filter(data => data.local).length;
});

const remoteDataCount = computed(() => {
  return Array.from(dhtData.value.values()).filter(data => !data.local).length;
});

// Methods
const performPut = async () => {
  try {
    let value;
    try {
      value = JSON.parse(putValue.value);
    } catch (e) {
      // If not valid JSON, store as string
      value = putValue.value;
    }
    
    const options = {};
    if (putTTL.value && putTTL.value > 0) {
      options.ttl = putTTL.value;
    }
    
    const success = await store.dhtPut(putKey.value, value, options);
    if (success) {
      store.addDebugLog(`DHT PUT successful: ${putKey.value}`, 'success');
      putKey.value = '';
      putValue.value = '';
      putTTL.value = null;
    }
  } catch (error) {
    store.addDebugLog(`DHT PUT failed: ${error.message}`, 'error');
  }
};

const performGet = async () => {
  try {
    const options = { forceRefresh: forceRefresh.value };
    const result = await store.dhtGet(getKey.value, options);
    getResult.value = result;
    
    if (result !== null) {
      store.addDebugLog(`DHT GET successful: ${getKey.value}`, 'success');
    } else {
      store.addDebugLog(`DHT GET returned null for key: ${getKey.value}`, 'warning');
    }
  } catch (error) {
    store.addDebugLog(`DHT GET failed: ${error.message}`, 'error');
    getResult.value = null;
  }
};

const performSubscribe = async () => {
  try {
    if (store.mesh) {
      await store.dhtSubscribe(subscribeKey.value);
      subscriptions.value.add(subscribeKey.value);
      store.addDebugLog(`Subscribed to DHT key: ${subscribeKey.value}`, 'success');
      subscribeKey.value = '';
    }
  } catch (error) {
    store.addDebugLog(`DHT SUBSCRIBE failed: ${error.message}`, 'error');
  }
};

const performUnsubscribe = async () => {
  try {
    if (store.mesh) {
      await store.dhtUnsubscribe(subscribeKey.value);
      subscriptions.value.delete(subscribeKey.value);
      store.addDebugLog(`Unsubscribed from DHT key: ${subscribeKey.value}`, 'success');
      subscribeKey.value = '';
    }
  } catch (error) {
    store.addDebugLog(`DHT UNSUBSCRIBE failed: ${error.message}`, 'error');
  }
};

const performUpdate = async () => {
  try {
    let value;
    try {
      value = JSON.parse(updateValue.value);
    } catch (e) {
      value = updateValue.value;
    }
    
    if (store.mesh) {
      const success = await store.mesh.dhtUpdate(updateKey.value, value);
      if (success) {
        store.addDebugLog(`DHT UPDATE successful: ${updateKey.value}`, 'success');
        updateKey.value = '';
        updateValue.value = '';
      }
    }
  } catch (error) {
    store.addDebugLog(`DHT UPDATE failed: ${error.message}`, 'error');
  }
};

const isSubscribed = (key) => {
  return subscriptions.value.has(key);
};

const unsubscribeFromKey = async (key) => {
  try {
    if (store.mesh) {
      await store.dhtUnsubscribe(key);
      subscriptions.value.delete(key);
      store.addDebugLog(`Unsubscribed from DHT key: ${key}`, 'success');
    }
  } catch (error) {
    store.addDebugLog(`DHT UNSUBSCRIBE failed: ${error.message}`, 'error');
  }
};

const quickSubscribe = async (key) => {
  try {
    if (store.mesh) {
      await store.dhtSubscribe(key);
      subscriptions.value.add(key);
      store.addDebugLog(`Subscribed to DHT key: ${key}`, 'success');
    }
  } catch (error) {
    store.addDebugLog(`DHT SUBSCRIBE failed: ${error.message}`, 'error');
  }
};

const quickUnsubscribe = async (key) => {
  await unsubscribeFromKey(key);
};

const refreshAllData = async () => {
  for (const key of dhtData.value.keys()) {
    await refreshSingleData(key);
  }
  store.addDebugLog('Refreshed all DHT data', 'info');
};

const refreshSingleData = async (key) => {
  try {
    const result = await store.dhtGet(key, { forceRefresh: true });
    if (result !== null) {
      store.addDebugLog(`Refreshed DHT key: ${key}`, 'success');
    }
  } catch (error) {
    store.addDebugLog(`Failed to refresh DHT key ${key}: ${error.message}`, 'error');
  }
};

const clearLocalData = () => {
  store.dhtData.clear();
  store.addDebugLog('Cleared local DHT data', 'info');
};

const copyKey = async (key) => {
  try {
    await navigator.clipboard.writeText(key);
    store.addDebugLog(`Copied key to clipboard: ${key}`, 'success');
  } catch (error) {
    store.addDebugLog('Failed to copy to clipboard', 'error');
  }
};

const clearNotifications = () => {
  notifications.value = [];
  store.addDebugLog('Cleared DHT notifications', 'info');
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString();
};

// Quick Actions
const storeUserPreferences = async () => {
  const prefs = {
    theme: 'dark',
    language: 'en',
    notifications: true,
    autoConnect: true,
    maxPeers: 5
  };
  
  await store.dhtPut('user:preferences', prefs);
  store.addDebugLog('Stored user preferences in DHT', 'success');
};

const storeSharedCounter = async () => {
  const counter = {
    value: 0,
    lastUpdated: Date.now(),
    updatedBy: store.peerId.substring(0, 8) + '...'
  };
  
  await store.dhtPut('shared:counter', counter);
  
  // Subscribe to counter changes
  if (store.mesh) {
    await store.dhtSubscribe('shared:counter');
    subscriptions.value.add('shared:counter');
  }
  
  store.addDebugLog('Created shared counter in DHT', 'success');
};

const storeSystemInfo = async () => {
  const systemInfo = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    online: navigator.onLine,
    timestamp: Date.now(),
    peerId: store.peerId.substring(0, 8) + '...',
    connectedPeers: store.networkStatus.connectedCount
  };
  
  await store.dhtPut('system:info', systemInfo);
  store.addDebugLog('Stored system info in DHT', 'success');
};

const performStressTest = async () => {
  const testCount = 10;
  const results = [];
  
  store.addDebugLog(`Starting DHT stress test with ${testCount} operations...`, 'info');
  
  for (let i = 0; i < testCount; i++) {
    const key = `test:stress:${i}`;
    const value = {
      index: i,
      data: Array(100).fill(0).map(() => Math.random()),
      timestamp: Date.now()
    };
    
    const start = performance.now();
    try {
      await store.dhtPut(key, value);
      const end = performance.now();
      results.push(end - start);
    } catch (error) {
      store.addDebugLog(`Stress test operation ${i} failed: ${error.message}`, 'error');
    }
  }
  
  const avgTime = results.reduce((a, b) => a + b, 0) / results.length;
  store.addDebugLog(`DHT stress test completed. Average time: ${avgTime.toFixed(2)}ms`, 'success');
};

const demonstrateReplication = async () => {
  const testKey = 'demo:replication';
  const testValue = {
    message: 'This data should be replicated across all peers',
    timestamp: Date.now(),
    source: store.peerId.substring(0, 8) + '...'
  };
  
  // Store the data
  await store.dhtPut(testKey, testValue);
  
  // Subscribe to changes
  if (store.mesh) {
    await store.dhtSubscribe(testKey);
    subscriptions.value.add(testKey);
  }
  
  store.addDebugLog('Stored replication demo data. Other peers should receive this automatically.', 'success');
};

// Listen for DHT value changes
const handleDHTValueChange = (event) => {
  const notification = {
    id: Date.now() + Math.random(),
    key: event.key,
    oldValue: event.oldValue,
    newValue: event.newValue,
    timestamp: new Date()
  };
  
  notifications.value.push(notification);
  
  // Keep only last 20 notifications
  if (notifications.value.length > 20) {
    notifications.value.shift();
  }
  
  store.addDebugLog(`DHT value changed: ${event.key}`, 'info');
};

onMounted(() => {
  // Listen for DHT events
  if (store.mesh) {
    store.mesh.addEventListener('dhtValueChanged', handleDHTValueChange);
  }
});
</script>

<style scoped>
.dht-view {
  max-width: 1200px;
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

.dht-operations {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.dht-operations h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.operation-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 20px;
  border-bottom: 1px solid #eee;
}

.tab-btn {
  padding: 12px 20px;
  border: none;
  background: none;
  color: #666;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
  font-weight: 500;
}

.tab-btn:hover {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.tab-btn.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.operation-panel {
  padding: 20px;
  border: 1px solid #eee;
  border-radius: 8px;
  background: #fafafa;
}

.operation-panel h4 {
  margin: 0 0 8px 0;
  color: #333;
}

.operation-description {
  color: #666;
  font-size: 14px;
  margin-bottom: 20px;
  line-height: 1.5;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #333;
  font-size: 14px;
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

.form-textarea {
  resize: vertical;
  font-family: monospace;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.subscription-controls {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.subscriptions-list h5 {
  margin: 0 0 12px 0;
  color: #333;
}

.subscription-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.subscription-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: white;
  border: 1px solid #eee;
  border-radius: 6px;
}

.subscription-key {
  font-family: monospace;
  font-size: 13px;
  color: #333;
}

.result-panel {
  margin-top: 16px;
  padding: 16px;
  background: white;
  border: 1px solid #eee;
  border-radius: 6px;
}

.result-panel h5 {
  margin: 0 0 12px 0;
  color: #333;
}

.result-content {
  margin: 0;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 4px;
  font-size: 13px;
  overflow-x: auto;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.btn-success {
  background: #10b981;
  color: white;
}

.btn-success:hover:not(:disabled) {
  background: #059669;
}

.btn-warning {
  background: #f59e0b;
  color: white;
}

.btn-warning:hover:not(:disabled) {
  background: #d97706;
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 12px;
}

.btn-icon {
  font-size: 14px;
}

.stored-data {
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

.data-controls {
  display: flex;
  gap: 8px;
}

.empty-data {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-data p {
  margin: 0 0 8px 0;
}

.empty-meta {
  font-size: 14px;
  color: #999;
}

.data-grid {
  display: grid;
  gap: 16px;
}

.data-item {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.data-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.data-key {
  margin: 0;
  font-family: monospace;
  font-size: 14px;
  color: #333;
  word-break: break-all;
}

.data-badges {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 500;
}

.badge-local {
  background: #10b981;
  color: white;
}

.badge-remote {
  background: #6b7280;
  color: white;
}

.badge-subscribed {
  background: #3b82f6;
  color: white;
}

.data-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 12px;
  color: #999;
}

.data-content {
  margin-bottom: 12px;
}

.data-content pre {
  margin: 0;
  padding: 12px;
  background: white;
  border: 1px solid #eee;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

.data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.notifications {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.notifications h3 {
  margin: 0 0 16px 0;
  color: #333;
}

.notifications-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.notification-item {
  padding: 12px;
  background: #f0f9ff;
  border: 1px solid #e0f2fe;
  border-radius: 6px;
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.notification-key {
  font-family: monospace;
  font-weight: 500;
  color: #0369a1;
}

.notification-time {
  font-size: 12px;
  color: #64748b;
}

.notification-content {
  font-size: 13px;
  line-height: 1.4;
}

.notification-content code {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 12px;
}

.stats-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.stats-section h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #eee;
}

.stat-icon {
  font-size: 24px;
  opacity: 0.8;
}

.stat-content h4 {
  margin: 0 0 4px 0;
  font-size: 13px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #333;
  margin-bottom: 2px;
}

.stat-meta {
  font-size: 11px;
  color: #999;
}

.dht-stats-detail h4 {
  margin: 0 0 12px 0;
  color: #333;
}

.stats-json {
  margin: 0;
  padding: 16px;
  background: #f8f9fa;
  border: 1px solid #eee;
  border-radius: 6px;
  font-size: 12px;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
}

.quick-actions {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.quick-actions h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.empty-state {
  color: #999;
  font-style: italic;
  text-align: center;
  padding: 20px;
}

/* Responsive design */
@media (max-width: 768px) {
  .operation-tabs {
    flex-wrap: wrap;
  }
  
  .tab-btn {
    flex: 1;
    min-width: 120px;
  }
  
  .subscription-controls {
    flex-direction: column;
  }
  
  .data-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .data-actions {
    justify-content: center;
  }
  
  .action-buttons {
    flex-direction: column;
  }
}
</style>
