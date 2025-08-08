<template>
  <div class="storage-view">
    <div class="section-header">
      <h2>📦 Distributed Storage Layer</h2>
      <p>Encrypted, access-controlled storage with CRDT support for collaborative editing</p>
    </div>

    <!-- Storage Operations -->
    <div class="storage-operations">
      <h3>💾 Storage Operations</h3>
      
      <div class="operation-tabs">
        <button 
          @click="activeTab = 'store'"
          :class="['tab-btn', { active: activeTab === 'store' }]"
        >
          STORE
        </button>
        <button 
          @click="activeTab = 'retrieve'"
          :class="['tab-btn', { active: activeTab === 'retrieve' }]"
        >
          RETRIEVE
        </button>
        <button 
          @click="activeTab = 'update'"
          :class="['tab-btn', { active: activeTab === 'update' }]"
        >
          UPDATE
        </button>
        <button 
          @click="activeTab = 'access'"
          :class="['tab-btn', { active: activeTab === 'access' }]"
        >
          ACCESS CONTROL
        </button>
      </div>

      <!-- STORE Operation -->
      <div v-if="activeTab === 'store'" class="operation-panel">
        <h4>💾 Store Data</h4>
        <p class="operation-description">
          Store data with encryption, access control, and optional immutability. Data is automatically distributed across the mesh.
        </p>
        
        <div class="form-group">
          <label>Key:</label>
          <input 
            v-model="storeKey" 
            placeholder="e.g., user:profile, doc:shared, config:app"
            class="form-input"
          >
        </div>
        
        <div class="form-group">
          <label>Value (JSON):</label>
          <textarea 
            v-model="storeValue" 
            placeholder='{"name": "Alice", "email": "alice@example.com"}'
            rows="6"
            class="form-textarea"
          ></textarea>
        </div>
        
        <div class="form-group">
          <label>Storage Options:</label>
          <div class="option-checkboxes">
            <label class="checkbox-label">
              <input type="checkbox" v-model="storeOptions.isPublic">
              Public (not encrypted, anyone can read)
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="storeOptions.isImmutable">
              Immutable (cannot be modified after creation)
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="storeOptions.enableCRDT">
              Enable CRDT (collaborative editing support)
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="storeOptions.replicate">
              Replicate across mesh
            </label>
          </div>
        </div>
        
        <div class="form-group" v-if="!storeOptions.isPublic">
          <label>Encryption Level:</label>
          <select v-model="storeOptions.encryptionLevel" class="form-select">
            <option value="standard">Standard Encryption</option>
            <option value="high">High Security</option>
            <option value="group">Group Encryption</option>
          </select>
        </div>
        
        <div class="form-group">
          <label>TTL (seconds, optional):</label>
          <input 
            v-model.number="storeOptions.ttl" 
            type="number"
            placeholder="Leave empty for no expiration"
            class="form-input"
          >
        </div>
        
        <button 
          @click="performStore"
          :disabled="!storeKey || !storeValue || !isConnected"
          class="btn btn-primary"
        >
          <span class="btn-icon">💾</span>
          Store Data
        </button>
      </div>

      <!-- RETRIEVE Operation -->
      <div v-if="activeTab === 'retrieve'" class="operation-panel">
        <h4>📥 Retrieve Data</h4>
        <p class="operation-description">
          Retrieve encrypted data with automatic decryption based on your access permissions.
        </p>
        
        <div class="form-group">
          <label>Key:</label>
          <input 
            v-model="retrieveKey" 
            placeholder="Enter key to retrieve"
            class="form-input"
          >
        </div>
        
        <div class="form-group">
          <label>Retrieve Options:</label>
          <div class="option-checkboxes">
            <label class="checkbox-label">
              <input type="checkbox" v-model="retrieveOptions.forceRefresh">
              Force refresh from network
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="retrieveOptions.includeMetadata">
              Include metadata
            </label>
          </div>
        </div>
        
        <button 
          @click="performRetrieve"
          :disabled="!retrieveKey || !isConnected"
          class="btn btn-primary"
        >
          <span class="btn-icon">🔍</span>
          Retrieve Data
        </button>
        
        <div v-if="retrieveResult" class="result-panel">
          <h5>Retrieved Data:</h5>
          <pre class="result-content">{{ JSON.stringify(retrieveResult, null, 2) }}</pre>
        </div>
      </div>

      <!-- UPDATE Operation -->
      <div v-if="activeTab === 'update'" class="operation-panel">
        <h4>🔄 Update Existing Data</h4>
        <p class="operation-description">
          Update data you own or contribute to CRDT-enabled collaborative documents.
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
            placeholder='{"name": "Alice Smith", "updated": true}'
            rows="6"
            class="form-textarea"
          ></textarea>
        </div>
        
        <div class="form-group">
          <label>Update Options:</label>
          <div class="option-checkboxes">
            <label class="checkbox-label">
              <input type="checkbox" v-model="updateOptions.createIfNotExists">
              Create if doesn't exist
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="updateOptions.mergeData">
              Merge with existing data
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="updateOptions.incrementVersion">
              Increment version
            </label>
          </div>
        </div>
        
        <button 
          @click="performUpdate"
          :disabled="!updateKey || !updateValue || !isConnected"
          class="btn btn-primary"
        >
          <span class="btn-icon">🔄</span>
          Update Data
        </button>
      </div>

      <!-- ACCESS CONTROL Operation -->
      <div v-if="activeTab === 'access'" class="operation-panel">
        <h4>🔐 Access Control</h4>
        <p class="operation-description">
          Grant or revoke access to your private data for specific peers.
        </p>
        
        <div class="access-section">
          <h5>Grant Access</h5>
          <div class="form-group">
            <label>Data Key:</label>
            <input 
              v-model="accessKey" 
              placeholder="Key to grant access to"
              class="form-input"
            >
          </div>
          
          <div class="form-group">
            <label>Peer ID:</label>
            <select v-model="selectedPeer" class="form-select">
              <option value="">Select a peer...</option>
              <option 
                v-for="peer in connectedPeersList" 
                :key="peer.id"
                :value="peer.id"
              >
                {{ peer.id.substring(0, 16) }}... ({{ peer.status }})
              </option>
            </select>
          </div>
          
          <div class="access-controls">
            <button 
              @click="grantAccess"
              :disabled="!accessKey || !selectedPeer || !isConnected"
              class="btn btn-success"
            >
              <span class="btn-icon">✅</span>
              Grant Access
            </button>
            
            <button 
              @click="revokeAccess"
              :disabled="!accessKey || !selectedPeer || !isConnected"
              class="btn btn-danger"
            >
              <span class="btn-icon">❌</span>
              Revoke Access
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Stored Data Display -->
    <div class="stored-data">
      <div class="section-title">
        <h3>📁 Stored Data ({{ storageData.size }})</h3>
        <div class="data-controls">
          <button @click="refreshAllStorageData" class="btn btn-secondary">
            <span class="btn-icon">🔄</span>
            Refresh All
          </button>
          <button @click="exportData" class="btn btn-secondary">
            <span class="btn-icon">📤</span>
            Export
          </button>
          <button @click="clearLocalStorageData" class="btn btn-danger">
            <span class="btn-icon">🗑️</span>
            Clear Local
          </button>
        </div>
      </div>
      
      <div v-if="storageData.size === 0" class="empty-data">
        <div class="empty-icon">📭</div>
        <p>No data stored yet</p>
        <p class="empty-meta">Store some data using the STORE operation above</p>
      </div>
      
      <div v-else class="data-grid">
        <div 
          v-for="[key, data] in Array.from(storageData.entries())" 
          :key="key"
          class="data-item"
        >
          <div class="data-header">
            <h4 class="data-key">{{ key }}</h4>
            <div class="data-badges">
              <span v-if="data.local" class="badge badge-local">Local</span>
              <span v-else class="badge badge-remote">Remote</span>
              <span v-if="data.options?.isPublic" class="badge badge-public">Public</span>
              <span v-else class="badge badge-private">Private</span>
              <span v-if="data.options?.isImmutable" class="badge badge-immutable">Immutable</span>
              <span v-if="data.options?.enableCRDT" class="badge badge-crdt">CRDT</span>
            </div>
          </div>
          
          <div class="data-meta">
            <span class="data-timestamp">{{ formatTime(data.timestamp) }}</span>
            <span v-if="data.version" class="data-version">v{{ data.version }}</span>
            <span v-if="data.options?.ttl" class="data-ttl">TTL: {{ data.options.ttl }}s</span>
          </div>
          
          <div class="data-content">
            <pre>{{ JSON.stringify(data.value, null, 2) }}</pre>
          </div>
          
          <div class="data-actions">
            <button @click="copyStorageKey(key)" class="btn btn-sm btn-secondary">
              <span class="btn-icon">📋</span>
              Copy Key
            </button>
            <button @click="refreshSingleStorageData(key)" class="btn btn-sm btn-secondary">
              <span class="btn-icon">🔄</span>
              Refresh
            </button>
            <button 
              v-if="data.local && !data.options?.isImmutable"
              @click="editData(key, data)" 
              class="btn btn-sm btn-primary"
            >
              <span class="btn-icon">✏️</span>
              Edit
            </button>
            <button 
              v-if="data.local"
              @click="viewAccessControl(key)" 
              class="btn btn-sm btn-info"
            >
              <span class="btn-icon">🔐</span>
              Access
            </button>
            <button 
              v-if="data.local"
              @click="deleteData(key)" 
              class="btn btn-sm btn-danger"
            >
              <span class="btn-icon">🗑️</span>
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Storage Statistics -->
    <div class="stats-section">
      <h3>📊 Storage Statistics</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">💾</div>
          <div class="stat-content">
            <h4>Local Data</h4>
            <div class="stat-value">{{ localStorageCount }}</div>
            <div class="stat-meta">Items stored locally</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🌐</div>
          <div class="stat-content">
            <h4>Remote Data</h4>
            <div class="stat-value">{{ remoteStorageCount }}</div>
            <div class="stat-meta">Items from other peers</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🔐</div>
          <div class="stat-content">
            <h4>Private Items</h4>
            <div class="stat-value">{{ privateDataCount }}</div>
            <div class="stat-meta">Encrypted data</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🌍</div>
          <div class="stat-content">
            <h4>Public Items</h4>
            <div class="stat-value">{{ publicDataCount }}</div>
            <div class="stat-meta">Unencrypted data</div>
          </div>
        </div>
      </div>
      
      <div class="storage-stats-detail" v-if="storageStats">
        <h4>Detailed Storage Statistics:</h4>
        <pre class="stats-json">{{ JSON.stringify(storageStats, null, 2) }}</pre>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions">
      <h3>⚡ Quick Storage Actions</h3>
      <div class="action-buttons">
        <button @click="createUserProfile" class="btn btn-secondary">
          <span class="btn-icon">👤</span>
          Create User Profile
        </button>
        
        <button @click="createSharedDocument" class="btn btn-secondary">
          <span class="btn-icon">📄</span>
          Create Shared Document
        </button>
        
        <button @click="createConfigFile" class="btn btn-secondary">
          <span class="btn-icon">⚙️</span>
          Create Config File
        </button>
        
        <button @click="demonstrateCollaboration" class="btn btn-secondary">
          <span class="btn-icon">👥</span>
          Demo Collaboration
        </button>
        
        <button @click="performEncryptionTest" class="btn btn-secondary">
          <span class="btn-icon">🔒</span>
          Test Encryption
        </button>
        
        <button @click="demonstrateAccessControl" class="btn btn-secondary">
          <span class="btn-icon">🔐</span>
          Demo Access Control
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
const activeTab = ref('store');

// Store form data
const storeKey = ref('');
const storeValue = ref('');
const storeOptions = ref({
  isPublic: false,
  isImmutable: false,
  enableCRDT: false,
  replicate: true,
  encryptionLevel: 'standard',
  ttl: null
});

// Retrieve form data
const retrieveKey = ref('');
const retrieveResult = ref(null);
const retrieveOptions = ref({
  forceRefresh: false,
  includeMetadata: false
});

// Update form data
const updateKey = ref('');
const updateValue = ref('');
const updateOptions = ref({
  createIfNotExists: false,
  mergeData: false,
  incrementVersion: true
});

// Access control form data
const accessKey = ref('');
const selectedPeer = ref('');

// Computed properties
const storageData = computed(() => store.storageData);
const storageStats = computed(() => store.storageStats);
const connectedPeersList = computed(() => store.connectedPeersList);
const isConnected = computed(() => store.isConnected);

const localStorageCount = computed(() => {
  return Array.from(storageData.value.values()).filter(data => data.local).length;
});

const remoteStorageCount = computed(() => {
  return Array.from(storageData.value.values()).filter(data => !data.local).length;
});

const privateDataCount = computed(() => {
  return Array.from(storageData.value.values()).filter(data => !data.options?.isPublic).length;
});

const publicDataCount = computed(() => {
  return Array.from(storageData.value.values()).filter(data => data.options?.isPublic).length;
});

// Methods
const performStore = async () => {
  try {
    let value;
    try {
      value = JSON.parse(storeValue.value);
    } catch (e) {
      value = storeValue.value;
    }
    
    const options = { ...storeOptions.value };
    if (options.ttl && options.ttl <= 0) {
      delete options.ttl;
    }
    
    const success = await store.storageStore(storeKey.value, value, options);
    if (success) {
      store.addDebugLog(`Storage STORE successful: ${storeKey.value}`, 'success');
      storeKey.value = '';
      storeValue.value = '';
      // Reset options to defaults
      storeOptions.value = {
        isPublic: false,
        isImmutable: false,
        enableCRDT: false,
        replicate: true,
        encryptionLevel: 'standard',
        ttl: null
      };
    }
  } catch (error) {
    store.addDebugLog(`Storage STORE failed: ${error.message}`, 'error');
  }
};

const performRetrieve = async () => {
  try {
    const options = { ...retrieveOptions.value };
    const result = await store.storageRetrieve(retrieveKey.value, options);
    retrieveResult.value = result;
    
    if (result !== null) {
      store.addDebugLog(`Storage RETRIEVE successful: ${retrieveKey.value}`, 'success');
    } else {
      store.addDebugLog(`Storage RETRIEVE returned null for key: ${retrieveKey.value}`, 'warning');
    }
  } catch (error) {
    store.addDebugLog(`Storage RETRIEVE failed: ${error.message}`, 'error');
    retrieveResult.value = null;
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
    
    if (store.mesh?.distributedStorage) {
      const success = await store.mesh.distributedStorage.update(updateKey.value, value, updateOptions.value);
      if (success) {
        store.addDebugLog(`Storage UPDATE successful: ${updateKey.value}`, 'success');
        updateKey.value = '';
        updateValue.value = '';
      }
    }
  } catch (error) {
    store.addDebugLog(`Storage UPDATE failed: ${error.message}`, 'error');
  }
};

const grantAccess = async () => {
  try {
    if (store.mesh?.distributedStorage) {
      await store.mesh.distributedStorage.grantAccess(accessKey.value, selectedPeer.value);
      store.addDebugLog(`Access granted to ${selectedPeer.value.substring(0, 8)}... for key: ${accessKey.value}`, 'success');
    }
  } catch (error) {
    store.addDebugLog(`Failed to grant access: ${error.message}`, 'error');
  }
};

const revokeAccess = async () => {
  try {
    if (store.mesh?.distributedStorage) {
      await store.mesh.distributedStorage.revokeAccess(accessKey.value, selectedPeer.value);
      store.addDebugLog(`Access revoked from ${selectedPeer.value.substring(0, 8)}... for key: ${accessKey.value}`, 'success');
    }
  } catch (error) {
    store.addDebugLog(`Failed to revoke access: ${error.message}`, 'error');
  }
};

const refreshAllStorageData = async () => {
  for (const key of storageData.value.keys()) {
    await refreshSingleStorageData(key);
  }
  
  // Also refresh storage stats
  if (store.mesh?.distributedStorage) {
    store.storageStats = await store.getStorageStats();
  }
  
  store.addDebugLog('Refreshed all storage data', 'info');
};

const refreshSingleStorageData = async (key) => {
  try {
    const result = await store.storageRetrieve(key, { forceRefresh: true });
    if (result !== null) {
      store.addDebugLog(`Refreshed storage key: ${key}`, 'success');
    }
  } catch (error) {
    store.addDebugLog(`Failed to refresh storage key ${key}: ${error.message}`, 'error');
  }
};

const clearLocalStorageData = () => {
  store.storageData.clear();
  store.addDebugLog('Cleared local storage data', 'info');
};

const copyStorageKey = async (key) => {
  try {
    await navigator.clipboard.writeText(key);
    store.addDebugLog(`Copied key to clipboard: ${key}`, 'success');
  } catch (error) {
    store.addDebugLog('Failed to copy to clipboard', 'error');
  }
};

const editData = (key, data) => {
  updateKey.value = key;
  updateValue.value = JSON.stringify(data.value, null, 2);
  activeTab.value = 'update';
  store.addDebugLog(`Editing data: ${key}`, 'info');
};

const viewAccessControl = (key) => {
  accessKey.value = key;
  activeTab.value = 'access';
  store.addDebugLog(`Viewing access control for: ${key}`, 'info');
};

const deleteData = async (key) => {
  if (confirm(`Are you sure you want to delete "${key}"?`)) {
    try {
      if (store.mesh?.distributedStorage) {
        await store.mesh.distributedStorage.delete(key);
        store.storageData.delete(key);
        store.addDebugLog(`Deleted storage key: ${key}`, 'success');
      }
    } catch (error) {
      store.addDebugLog(`Failed to delete storage key ${key}: ${error.message}`, 'error');
    }
  }
};

const exportData = () => {
  const dataToExport = {};
  for (const [key, data] of storageData.value) {
    dataToExport[key] = {
      value: data.value,
      timestamp: data.timestamp,
      options: data.options,
      local: data.local
    };
  }
  
  const dataStr = JSON.stringify(dataToExport, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `peerpigeon-storage-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  store.addDebugLog('Storage data exported', 'success');
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString();
};

// Quick Actions
const createUserProfile = async () => {
  const profile = {
    name: 'Alice Smith',
    email: 'alice@example.com',
    avatar: 'https://avatars.dicebear.com/api/avataaars/alice.svg',
    preferences: {
      theme: 'dark',
      notifications: true,
      language: 'en'
    },
    created: Date.now(),
    lastUpdated: Date.now()
  };
  
  await store.storageStore('user:profile', profile, {
    isPublic: false,
    isImmutable: false,
    enableCRDT: false,
    replicate: true
  });
  
  store.addDebugLog('Created user profile in storage', 'success');
};

const createSharedDocument = async () => {
  const document = {
    title: 'Shared Document',
    content: 'This is a shared document that supports collaborative editing.',
    authors: [store.peerId.substring(0, 8) + '...'],
    created: Date.now(),
    lastModified: Date.now(),
    version: 1
  };
  
  await store.storageStore('doc:shared', document, {
    isPublic: true,
    isImmutable: false,
    enableCRDT: true,
    replicate: true
  });
  
  store.addDebugLog('Created shared document in storage', 'success');
};

const createConfigFile = async () => {
  const config = {
    appName: 'PeerPigeon Vue Demo',
    version: '1.0.0',
    features: {
      messaging: true,
      media: true,
      dht: true,
      storage: true,
      crypto: true
    },
    limits: {
      maxPeers: 10,
      maxMessageSize: 1024 * 1024,
      maxStorageSize: 100 * 1024 * 1024
    },
    created: Date.now()
  };
  
  await store.storageStore('config:app', config, {
    isPublic: true,
    isImmutable: true,
    enableCRDT: false,
    replicate: true
  });
  
  store.addDebugLog('Created config file in storage', 'success');
};

const demonstrateCollaboration = async () => {
  const collaboration = {
    document: 'collaborative-demo',
    participants: [store.peerId.substring(0, 8) + '...'],
    content: {
      title: 'Collaborative Demo',
      sections: [
        {
          id: 1,
          author: store.peerId.substring(0, 8) + '...',
          content: 'This section was created by the first participant.',
          timestamp: Date.now()
        }
      ]
    },
    metadata: {
      created: Date.now(),
      lastModified: Date.now(),
      crdtVersion: 1
    }
  };
  
  await store.storageStore('collab:demo', collaboration, {
    isPublic: true,
    isImmutable: false,
    enableCRDT: true,
    replicate: true
  });
  
  store.addDebugLog('Created collaboration demo in storage', 'success');
};

const performEncryptionTest = async () => {
  const sensitiveData = {
    secret: 'This is sensitive information',
    keys: ['key1', 'key2', 'key3'],
    metadata: {
      classification: 'confidential',
      owner: store.peerId.substring(0, 8) + '...',
      created: Date.now()
    }
  };
  
  await store.storageStore('test:encryption', sensitiveData, {
    isPublic: false,
    isImmutable: false,
    enableCRDT: false,
    replicate: true,
    encryptionLevel: 'high'
  });
  
  store.addDebugLog('Created encryption test data in storage', 'success');
};

const demonstrateAccessControl = async () => {
  const restrictedData = {
    message: 'This data requires explicit access permissions',
    level: 'restricted',
    owner: store.peerId.substring(0, 8) + '...',
    created: Date.now(),
    accessLog: []
  };
  
  await store.storageStore('access:restricted', restrictedData, {
    isPublic: false,
    isImmutable: false,
    enableCRDT: false,
    replicate: true
  });
  
  store.addDebugLog('Created access control demo data in storage', 'success');
};

onMounted(async () => {
  // Load storage stats
  try {
    store.storageStats = await store.getStorageStats();
  } catch (error) {
    console.warn('Failed to load storage stats:', error);
  }
});
</script>

<style scoped>
/* Same base styles as DHTView with storage-specific modifications */
.storage-view {
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

.storage-operations {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.storage-operations h3 {
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
.form-textarea,
.form-select {
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
.form-textarea:focus,
.form-select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.option-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
  margin-bottom: 0 !important;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  margin: 0;
}

.access-section {
  border-top: 1px solid #eee;
  padding-top: 16px;
}

.access-section h5 {
  margin: 0 0 16px 0;
  color: #333;
}

.access-controls {
  display: flex;
  gap: 12px;
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

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-info {
  background: #06b6d4;
  color: white;
}

.btn-info:hover:not(:disabled) {
  background: #0891b2;
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
  gap: 4px;
  flex-wrap: wrap;
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

.badge-public {
  background: #3b82f6;
  color: white;
}

.badge-private {
  background: #ef4444;
  color: white;
}

.badge-immutable {
  background: #f59e0b;
  color: white;
}

.badge-crdt {
  background: #8b5cf6;
  color: white;
}

.data-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 12px;
  color: #999;
  flex-wrap: wrap;
  gap: 8px;
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

.storage-stats-detail h4 {
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

/* Responsive design */
@media (max-width: 768px) {
  .operation-tabs {
    flex-wrap: wrap;
  }
  
  .tab-btn {
    flex: 1;
    min-width: 120px;
  }
  
  .access-controls {
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
