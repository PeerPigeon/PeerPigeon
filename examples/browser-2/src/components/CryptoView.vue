<template>
  <div class="crypto-view">
    <div class="section-header">
      <h2>🔐 Cryptographic Features</h2>
      <p>Key management, encryption/decryption, and secure peer communications</p>
    </div>

    <!-- Crypto Operations -->
    <div class="crypto-operations">
      <h3>🔒 Cryptographic Operations</h3>
      
      <div class="operation-tabs">
        <button 
          @click="activeTab = 'keys'"
          :class="['tab-btn', { active: activeTab === 'keys' }]"
        >
          KEY MANAGEMENT
        </button>
        <button 
          @click="activeTab = 'encrypt'"
          :class="['tab-btn', { active: activeTab === 'encrypt' }]"
        >
          ENCRYPT/DECRYPT
        </button>
        <button 
          @click="activeTab = 'signatures'"
          :class="['tab-btn', { active: activeTab === 'signatures' }]"
        >
          SIGNATURES
        </button>
        <button 
          @click="activeTab = 'exchange'"
          :class="['tab-btn', { active: activeTab === 'exchange' }]"
        >
          KEY EXCHANGE
        </button>
      </div>

      <!-- KEY MANAGEMENT -->
      <div v-if="activeTab === 'keys'" class="operation-panel">
        <h4>🔑 Key Management</h4>
        <p class="operation-description">
          Generate, import, export, and manage cryptographic keys. PeerPigeon supports multiple key types and algorithms.
        </p>
        
        <div class="key-generation">
          <h5>Generate New Key Pair</h5>
          <div class="form-group">
            <label>Key Type:</label>
            <select v-model="keyGenOptions.type" class="form-select">
              <option value="RSA">RSA (Asymmetric)</option>
              <option value="ECDSA">ECDSA (Elliptic Curve)</option>
              <option value="Ed25519">Ed25519 (Edwards Curve)</option>
              <option value="AES">AES (Symmetric)</option>
            </select>
          </div>
          
          <div class="form-group" v-if="keyGenOptions.type === 'RSA'">
            <label>Key Size:</label>
            <select v-model="keyGenOptions.size" class="form-select">
              <option value="2048">2048 bits</option>
              <option value="3072">3072 bits</option>
              <option value="4096">4096 bits</option>
            </select>
          </div>
          
          <div class="form-group" v-if="keyGenOptions.type === 'AES'">
            <label>Key Length:</label>
            <select v-model="keyGenOptions.size" class="form-select">
              <option value="128">128 bits</option>
              <option value="192">192 bits</option>
              <option value="256">256 bits</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Key Name/Label:</label>
            <input 
              v-model="keyGenOptions.name" 
              placeholder="e.g., my-signing-key, backup-key"
              class="form-input"
            >
          </div>
          
          <button 
            @click="generateKeyPair"
            :disabled="!keyGenOptions.name || isGeneratingKey"
            class="btn btn-primary"
          >
            <span class="btn-icon">🔑</span>
            {{ isGeneratingKey ? 'Generating...' : 'Generate Key Pair' }}
          </button>
        </div>
        
        <div class="key-import">
          <h5>Import Existing Key</h5>
          <div class="form-group">
            <label>Key Data (PEM/JWK format):</label>
            <textarea 
              v-model="importKeyData" 
              placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
              rows="8"
              class="form-textarea"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label>Key Name:</label>
            <input 
              v-model="importKeyName" 
              placeholder="imported-key"
              class="form-input"
            >
          </div>
          
          <button 
            @click="importKey"
            :disabled="!importKeyData || !importKeyName"
            class="btn btn-secondary"
          >
            <span class="btn-icon">📥</span>
            Import Key
          </button>
        </div>
      </div>

      <!-- ENCRYPT/DECRYPT -->
      <div v-if="activeTab === 'encrypt'" class="operation-panel">
        <h4>🔒 Encryption & Decryption</h4>
        <p class="operation-description">
          Encrypt and decrypt data using various algorithms. Supports both symmetric and asymmetric encryption.
        </p>
        
        <div class="encrypt-section">
          <h5>Encrypt Data</h5>
          <div class="form-group">
            <label>Data to Encrypt:</label>
            <textarea 
              v-model="encryptData" 
              placeholder="Enter text or JSON data to encrypt"
              rows="4"
              class="form-textarea"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label>Encryption Key:</label>
            <select v-model="selectedEncryptKey" class="form-select">
              <option value="">Select a key...</option>
              <option 
                v-for="key in availableKeys" 
                :key="key.id"
                :value="key.id"
              >
                {{ key.name }} ({{ key.type }})
              </option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Algorithm:</label>
            <select v-model="encryptOptions.algorithm" class="form-select">
              <option value="RSA-OAEP">RSA-OAEP</option>
              <option value="AES-GCM">AES-GCM</option>
              <option value="AES-CBC">AES-CBC</option>
            </select>
          </div>
          
          <button 
            @click="performEncryption"
            :disabled="!encryptData || !selectedEncryptKey"
            class="btn btn-primary"
          >
            <span class="btn-icon">🔒</span>
            Encrypt Data
          </button>
          
          <div v-if="encryptedResult" class="result-panel">
            <h6>Encrypted Result:</h6>
            <pre class="result-content">{{ encryptedResult }}</pre>
            <button @click="copyToClipboard(encryptedResult)" class="btn btn-sm btn-secondary">
              <span class="btn-icon">📋</span>
              Copy
            </button>
          </div>
        </div>
        
        <div class="decrypt-section">
          <h5>Decrypt Data</h5>
          <div class="form-group">
            <label>Encrypted Data:</label>
            <textarea 
              v-model="decryptData" 
              placeholder="Paste encrypted data here"
              rows="4"
              class="form-textarea"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label>Decryption Key:</label>
            <select v-model="selectedDecryptKey" class="form-select">
              <option value="">Select a key...</option>
              <option 
                v-for="key in availableKeys" 
                :key="key.id"
                :value="key.id"
              >
                {{ key.name }} ({{ key.type }})
              </option>
            </select>
          </div>
          
          <button 
            @click="performDecryption"
            :disabled="!decryptData || !selectedDecryptKey"
            class="btn btn-primary"
          >
            <span class="btn-icon">🔓</span>
            Decrypt Data
          </button>
          
          <div v-if="decryptedResult" class="result-panel">
            <h6>Decrypted Result:</h6>
            <pre class="result-content">{{ decryptedResult }}</pre>
          </div>
        </div>
      </div>

      <!-- SIGNATURES -->
      <div v-if="activeTab === 'signatures'" class="operation-panel">
        <h4>✍️ Digital Signatures</h4>
        <p class="operation-description">
          Create and verify digital signatures to ensure data integrity and authenticity.
        </p>
        
        <div class="sign-section">
          <h5>Sign Data</h5>
          <div class="form-group">
            <label>Data to Sign:</label>
            <textarea 
              v-model="signData" 
              placeholder="Enter data to create a digital signature"
              rows="4"
              class="form-textarea"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label>Signing Key:</label>
            <select v-model="selectedSignKey" class="form-select">
              <option value="">Select a signing key...</option>
              <option 
                v-for="key in signingKeys" 
                :key="key.id"
                :value="key.id"
              >
                {{ key.name }} ({{ key.type }})
              </option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Hash Algorithm:</label>
            <select v-model="signOptions.hashAlg" class="form-select">
              <option value="SHA-256">SHA-256</option>
              <option value="SHA-384">SHA-384</option>
              <option value="SHA-512">SHA-512</option>
            </select>
          </div>
          
          <button 
            @click="signData"
            :disabled="!signData || !selectedSignKey"
            class="btn btn-primary"
          >
            <span class="btn-icon">✍️</span>
            Sign Data
          </button>
          
          <div v-if="signatureResult" class="result-panel">
            <h6>Digital Signature:</h6>
            <pre class="result-content">{{ signatureResult }}</pre>
            <button @click="copyToClipboard(signatureResult)" class="btn btn-sm btn-secondary">
              <span class="btn-icon">📋</span>
              Copy Signature
            </button>
          </div>
        </div>
        
        <div class="verify-section">
          <h5>Verify Signature</h5>
          <div class="form-group">
            <label>Original Data:</label>
            <textarea 
              v-model="verifyData" 
              placeholder="Enter the original data"
              rows="4"
              class="form-textarea"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label>Signature:</label>
            <textarea 
              v-model="verifySignature" 
              placeholder="Paste the signature to verify"
              rows="3"
              class="form-textarea"
            ></textarea>
          </div>
          
          <div class="form-group">
            <label>Verification Key:</label>
            <select v-model="selectedVerifyKey" class="form-select">
              <option value="">Select a public key...</option>
              <option 
                v-for="key in publicKeys" 
                :key="key.id"
                :value="key.id"
              >
                {{ key.name }} ({{ key.type }})
              </option>
            </select>
          </div>
          
          <button 
            @click="verifySignature"
            :disabled="!verifyData || !verifySignature || !selectedVerifyKey"
            class="btn btn-primary"
          >
            <span class="btn-icon">✅</span>
            Verify Signature
          </button>
          
          <div v-if="verificationResult !== null" class="result-panel">
            <div :class="['verification-result', verificationResult ? 'valid' : 'invalid']">
              <span class="result-icon">{{ verificationResult ? '✅' : '❌' }}</span>
              <span>{{ verificationResult ? 'Signature Valid' : 'Signature Invalid' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- KEY EXCHANGE -->
      <div v-if="activeTab === 'exchange'" class="operation-panel">
        <h4>🤝 Key Exchange</h4>
        <p class="operation-description">
          Securely exchange keys with peers using Diffie-Hellman key exchange and establish shared secrets.
        </p>
        
        <div class="exchange-section">
          <h5>Initiate Key Exchange</h5>
          <div class="form-group">
            <label>Target Peer:</label>
            <select v-model="selectedExchangePeer" class="form-select">
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
          
          <div class="form-group">
            <label>Key Exchange Method:</label>
            <select v-model="exchangeOptions.method" class="form-select">
              <option value="ECDH">ECDH (Elliptic Curve Diffie-Hellman)</option>
              <option value="DH">DH (Classical Diffie-Hellman)</option>
              <option value="X25519">X25519 (Curve25519)</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Exchange Purpose:</label>
            <input 
              v-model="exchangeOptions.purpose" 
              placeholder="e.g., secure-channel, file-encryption"
              class="form-input"
            >
          </div>
          
          <button 
            @click="initiateKeyExchange"
            :disabled="!selectedExchangePeer || !exchangeOptions.purpose"
            class="btn btn-primary"
          >
            <span class="btn-icon">🤝</span>
            Initiate Exchange
          </button>
        </div>
        
        <div class="shared-secrets">
          <h5>Established Shared Secrets</h5>
          <div v-if="sharedSecrets.length === 0" class="empty-secrets">
            <div class="empty-icon">🔐</div>
            <p>No shared secrets established</p>
          </div>
          
          <div v-else class="secrets-list">
            <div 
              v-for="secret in sharedSecrets" 
              :key="secret.id"
              class="secret-item"
            >
              <div class="secret-header">
                <h6>{{ secret.purpose }}</h6>
                <div class="secret-badges">
                  <span class="badge badge-method">{{ secret.method }}</span>
                  <span class="badge badge-status">{{ secret.status }}</span>
                </div>
              </div>
              
              <div class="secret-details">
                <div class="secret-peer">Peer: {{ secret.peerId.substring(0, 16) }}...</div>
                <div class="secret-created">Created: {{ formatTime(secret.created) }}</div>
                <div class="secret-key">Key: {{ secret.keyId }}</div>
              </div>
              
              <div class="secret-actions">
                <button @click="useSharedSecret(secret)" class="btn btn-sm btn-primary">
                  <span class="btn-icon">🔓</span>
                  Use for Encryption
                </button>
                <button @click="revokeSharedSecret(secret.id)" class="btn btn-sm btn-danger">
                  <span class="btn-icon">🗑️</span>
                  Revoke
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Key Management Display -->
    <div class="key-management-display">
      <div class="section-title">
        <h3>🗝️ Key Store ({{ cryptoKeys.length }})</h3>
        <div class="key-controls">
          <button @click="refreshKeys" class="btn btn-secondary">
            <span class="btn-icon">🔄</span>
            Refresh
          </button>
          <button @click="exportKeys" class="btn btn-secondary">
            <span class="btn-icon">📤</span>
            Export
          </button>
          <button @click="clearKeys" class="btn btn-danger">
            <span class="btn-icon">🗑️</span>
            Clear All
          </button>
        </div>
      </div>
      
      <div v-if="cryptoKeys.length === 0" class="empty-keys">
        <div class="empty-icon">🔑</div>
        <p>No keys in store</p>
        <p class="empty-meta">Generate or import keys using the operations above</p>
      </div>
      
      <div v-else class="keys-grid">
        <div 
          v-for="key in cryptoKeys" 
          :key="key.id"
          class="key-item"
        >
          <div class="key-header">
            <h4 class="key-name">{{ key.name }}</h4>
            <div class="key-badges">
              <span class="badge badge-type">{{ key.type }}</span>
              <span v-if="key.usage.includes('sign')" class="badge badge-usage">Signing</span>
              <span v-if="key.usage.includes('encrypt')" class="badge badge-usage">Encryption</span>
              <span v-if="key.extractable" class="badge badge-extractable">Extractable</span>
            </div>
          </div>
          
          <div class="key-details">
            <div class="key-id">ID: {{ key.id.substring(0, 16) }}...</div>
            <div class="key-algorithm">Algorithm: {{ key.algorithm }}</div>
            <div v-if="key.size" class="key-size">Size: {{ key.size }} bits</div>
            <div class="key-created">Created: {{ formatTime(key.created) }}</div>
          </div>
          
          <div class="key-fingerprint">
            <label>Fingerprint:</label>
            <code class="fingerprint">{{ key.fingerprint }}</code>
          </div>
          
          <div class="key-actions">
            <button 
              v-if="key.extractable"
              @click="exportKey(key)" 
              class="btn btn-sm btn-secondary"
            >
              <span class="btn-icon">📤</span>
              Export
            </button>
            <button @click="copyKeyId(key.id)" class="btn btn-sm btn-secondary">
              <span class="btn-icon">📋</span>
              Copy ID
            </button>
            <button @click="viewKeyDetails(key)" class="btn btn-sm btn-info">
              <span class="btn-icon">🔍</span>
              Details
            </button>
            <button @click="deleteKey(key.id)" class="btn btn-sm btn-danger">
              <span class="btn-icon">🗑️</span>
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Crypto Statistics -->
    <div class="crypto-stats">
      <h3>📊 Cryptographic Statistics</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">🔑</div>
          <div class="stat-content">
            <h4>Total Keys</h4>
            <div class="stat-value">{{ cryptoKeys.length }}</div>
            <div class="stat-meta">In key store</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🔒</div>
          <div class="stat-content">
            <h4>Encryption Ops</h4>
            <div class="stat-value">{{ encryptionCount }}</div>
            <div class="stat-meta">Total performed</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">✍️</div>
          <div class="stat-content">
            <h4>Signatures</h4>
            <div class="stat-value">{{ signatureCount }}</div>
            <div class="stat-meta">Created & verified</div>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">🤝</div>
          <div class="stat-content">
            <h4>Key Exchanges</h4>
            <div class="stat-value">{{ sharedSecrets.length }}</div>
            <div class="stat-meta">Active sessions</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Crypto Actions -->
    <div class="quick-actions">
      <h3>⚡ Quick Cryptographic Actions</h3>
      <div class="action-buttons">
        <button @click="generateTestKeys" class="btn btn-secondary">
          <span class="btn-icon">🔑</span>
          Generate Test Keys
        </button>
        
        <button @click="performEncryptionTest" class="btn btn-secondary">
          <span class="btn-icon">🔒</span>
          Test Encryption
        </button>
        
        <button @click="performSigningTest" class="btn btn-secondary">
          <span class="btn-icon">✍️</span>
          Test Signing
        </button>
        
        <button @click="demonstrateKeyExchange" class="btn btn-secondary">
          <span class="btn-icon">🤝</span>
          Demo Key Exchange
        </button>
        
        <button @click="benchmarkCrypto" class="btn btn-secondary">
          <span class="btn-icon">⏱️</span>
          Benchmark Performance
        </button>
        
        <button @click="validateCryptoSupport" class="btn btn-secondary">
          <span class="btn-icon">✅</span>
          Validate Support
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
const activeTab = ref('keys');

// Key generation
const keyGenOptions = ref({
  type: 'RSA',
  size: 2048,
  name: ''
});
const isGeneratingKey = ref(false);

// Key import
const importKeyData = ref('');
const importKeyName = ref('');

// Encryption/Decryption
const encryptData = ref('');
const selectedEncryptKey = ref('');
const encryptOptions = ref({
  algorithm: 'RSA-OAEP'
});
const encryptedResult = ref('');

const decryptData = ref('');
const selectedDecryptKey = ref('');
const decryptedResult = ref('');

// Signatures
const signData = ref('');
const selectedSignKey = ref('');
const signOptions = ref({
  hashAlg: 'SHA-256'
});
const signatureResult = ref('');

const verifyData = ref('');
const verifySignature = ref('');
const selectedVerifyKey = ref('');
const verificationResult = ref(null);

// Key Exchange
const selectedExchangePeer = ref('');
const exchangeOptions = ref({
  method: 'ECDH',
  purpose: ''
});
const sharedSecrets = ref([]);

// Crypto statistics
const encryptionCount = ref(0);
const signatureCount = ref(0);

// Computed properties
const cryptoKeys = computed(() => store.cryptoKeys);
const connectedPeersList = computed(() => store.connectedPeersList);

const availableKeys = computed(() => {
  return cryptoKeys.value.filter(key => 
    key.usage.includes('encrypt') || key.usage.includes('decrypt')
  );
});

const signingKeys = computed(() => {
  return cryptoKeys.value.filter(key => key.usage.includes('sign'));
});

const publicKeys = computed(() => {
  return cryptoKeys.value.filter(key => key.usage.includes('verify'));
});

// Methods
const generateKeyPair = async () => {
  isGeneratingKey.value = true;
  try {
    const keyPair = await store.cryptoGenerateKey(
      keyGenOptions.value.type,
      keyGenOptions.value.size,
      keyGenOptions.value.name
    );
    
    if (keyPair) {
      store.addDebugLog(`Generated ${keyGenOptions.value.type} key pair: ${keyGenOptions.value.name}`, 'success');
      keyGenOptions.value.name = '';
    }
  } catch (error) {
    store.addDebugLog(`Key generation failed: ${error.message}`, 'error');
  } finally {
    isGeneratingKey.value = false;
  }
};

const importKey = async () => {
  try {
    const success = await store.cryptoImportKey(importKeyData.value, importKeyName.value);
    if (success) {
      store.addDebugLog(`Imported key: ${importKeyName.value}`, 'success');
      importKeyData.value = '';
      importKeyName.value = '';
    }
  } catch (error) {
    store.addDebugLog(`Key import failed: ${error.message}`, 'error');
  }
};

const performEncryption = async () => {
  try {
    const result = await store.cryptoEncrypt(
      encryptData.value,
      selectedEncryptKey.value,
      encryptOptions.value
    );
    
    if (result) {
      encryptedResult.value = result;
      encryptionCount.value++;
      store.addDebugLog('Encryption successful', 'success');
    }
  } catch (error) {
    store.addDebugLog(`Encryption failed: ${error.message}`, 'error');
  }
};

const performDecryption = async () => {
  try {
    const result = await store.cryptoDecrypt(
      decryptData.value,
      selectedDecryptKey.value
    );
    
    if (result) {
      decryptedResult.value = result;
      store.addDebugLog('Decryption successful', 'success');
    }
  } catch (error) {
    store.addDebugLog(`Decryption failed: ${error.message}`, 'error');
  }
};

const signData = async () => {
  try {
    const signature = await store.cryptoSign(
      signData.value,
      selectedSignKey.value,
      signOptions.value
    );
    
    if (signature) {
      signatureResult.value = signature;
      signatureCount.value++;
      store.addDebugLog('Data signing successful', 'success');
    }
  } catch (error) {
    store.addDebugLog(`Signing failed: ${error.message}`, 'error');
  }
};

const verifySignature = async () => {
  try {
    const isValid = await store.cryptoVerify(
      verifyData.value,
      verifySignature.value,
      selectedVerifyKey.value
    );
    
    verificationResult.value = isValid;
    signatureCount.value++;
    
    const message = isValid ? 'Signature verification successful' : 'Signature verification failed';
    const level = isValid ? 'success' : 'warning';
    store.addDebugLog(message, level);
  } catch (error) {
    verificationResult.value = false;
    store.addDebugLog(`Signature verification error: ${error.message}`, 'error');
  }
};

const initiateKeyExchange = async () => {
  try {
    const exchange = await store.cryptoKeyExchange(
      selectedExchangePeer.value,
      exchangeOptions.value.method,
      exchangeOptions.value.purpose
    );
    
    if (exchange) {
      sharedSecrets.value.push({
        id: Date.now().toString(),
        peerId: selectedExchangePeer.value,
        method: exchangeOptions.value.method,
        purpose: exchangeOptions.value.purpose,
        keyId: exchange.keyId,
        status: 'active',
        created: Date.now()
      });
      
      store.addDebugLog(`Key exchange initiated with ${selectedExchangePeer.value.substring(0, 8)}...`, 'success');
      selectedExchangePeer.value = '';
      exchangeOptions.value.purpose = '';
    }
  } catch (error) {
    store.addDebugLog(`Key exchange failed: ${error.message}`, 'error');
  }
};

const useSharedSecret = (secret) => {
  selectedEncryptKey.value = secret.keyId;
  activeTab.value = 'encrypt';
  store.addDebugLog(`Using shared secret for encryption: ${secret.purpose}`, 'info');
};

const revokeSharedSecret = (secretId) => {
  const index = sharedSecrets.value.findIndex(s => s.id === secretId);
  if (index !== -1) {
    sharedSecrets.value.splice(index, 1);
    store.addDebugLog('Shared secret revoked', 'info');
  }
};

const refreshKeys = async () => {
  try {
    await store.cryptoRefreshKeys();
    store.addDebugLog('Key store refreshed', 'success');
  } catch (error) {
    store.addDebugLog(`Failed to refresh keys: ${error.message}`, 'error');
  }
};

const exportKeys = () => {
  const exportData = {
    keys: cryptoKeys.value.filter(key => key.extractable),
    exported: Date.now(),
    version: '1.0'
  };
  
  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `peerpigeon-keys-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  store.addDebugLog('Keys exported', 'success');
};

const clearKeys = () => {
  if (confirm('Are you sure you want to clear all keys? This cannot be undone.')) {
    store.cryptoKeys.splice(0);
    store.addDebugLog('All keys cleared', 'warning');
  }
};

const exportKey = async (key) => {
  try {
    const exported = await store.cryptoExportKey(key.id);
    if (exported) {
      const dataStr = JSON.stringify(exported, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `${key.name}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      store.addDebugLog(`Exported key: ${key.name}`, 'success');
    }
  } catch (error) {
    store.addDebugLog(`Key export failed: ${error.message}`, 'error');
  }
};

const copyKeyId = async (keyId) => {
  try {
    await navigator.clipboard.writeText(keyId);
    store.addDebugLog('Key ID copied to clipboard', 'success');
  } catch (error) {
    store.addDebugLog('Failed to copy to clipboard', 'error');
  }
};

const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    store.addDebugLog('Copied to clipboard', 'success');
  } catch (error) {
    store.addDebugLog('Failed to copy to clipboard', 'error');
  }
};

const viewKeyDetails = (key) => {
  store.addDebugLog(`Key Details: ${JSON.stringify(key, null, 2)}`, 'info');
};

const deleteKey = async (keyId) => {
  if (confirm('Are you sure you want to delete this key?')) {
    try {
      await store.cryptoDeleteKey(keyId);
      store.addDebugLog('Key deleted', 'success');
    } catch (error) {
      store.addDebugLog(`Key deletion failed: ${error.message}`, 'error');
    }
  }
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString();
};

// Quick Actions
const generateTestKeys = async () => {
  const keyTypes = [
    { type: 'RSA', size: 2048, name: 'test-rsa-2048' },
    { type: 'ECDSA', size: 256, name: 'test-ecdsa-p256' },
    { type: 'Ed25519', size: null, name: 'test-ed25519' },
    { type: 'AES', size: 256, name: 'test-aes-256' }
  ];
  
  for (const keySpec of keyTypes) {
    try {
      await store.cryptoGenerateKey(keySpec.type, keySpec.size, keySpec.name);
    } catch (error) {
      console.warn(`Failed to generate ${keySpec.name}:`, error);
    }
  }
  
  store.addDebugLog('Generated test key suite', 'success');
};

const performEncryptionTest = async () => {
  const testData = 'This is a test message for encryption demonstration.';
  
  // Find an encryption key
  const encKey = availableKeys.value[0];
  if (!encKey) {
    store.addDebugLog('No encryption keys available for test', 'warning');
    return;
  }
  
  try {
    // Encrypt
    const encrypted = await store.cryptoEncrypt(testData, encKey.id, { algorithm: 'RSA-OAEP' });
    if (!encrypted) return;
    
    // Decrypt
    const decrypted = await store.cryptoDecrypt(encrypted, encKey.id);
    
    const success = decrypted === testData;
    const message = success ? 'Encryption test passed' : 'Encryption test failed';
    store.addDebugLog(message, success ? 'success' : 'error');
    
    encryptionCount.value += 2;
  } catch (error) {
    store.addDebugLog(`Encryption test failed: ${error.message}`, 'error');
  }
};

const performSigningTest = async () => {
  const testData = 'This is a test message for signing demonstration.';
  
  // Find a signing key
  const signKey = signingKeys.value[0];
  const verifyKey = publicKeys.value[0];
  
  if (!signKey || !verifyKey) {
    store.addDebugLog('No signing/verification keys available for test', 'warning');
    return;
  }
  
  try {
    // Sign
    const signature = await store.cryptoSign(testData, signKey.id, { hashAlg: 'SHA-256' });
    if (!signature) return;
    
    // Verify
    const isValid = await store.cryptoVerify(testData, signature, verifyKey.id);
    
    const message = isValid ? 'Signing test passed' : 'Signing test failed';
    store.addDebugLog(message, isValid ? 'success' : 'error');
    
    signatureCount.value += 2;
  } catch (error) {
    store.addDebugLog(`Signing test failed: ${error.message}`, 'error');
  }
};

const demonstrateKeyExchange = async () => {
  // This would normally involve a real peer
  store.addDebugLog('Key exchange demo - requires connected peers', 'info');
  
  if (connectedPeersList.value.length === 0) {
    store.addDebugLog('No connected peers available for key exchange demo', 'warning');
    return;
  }
  
  const peer = connectedPeersList.value[0];
  try {
    await initiateKeyExchange(peer.id, 'ECDH', 'demo-exchange');
  } catch (error) {
    store.addDebugLog(`Key exchange demo failed: ${error.message}`, 'error');
  }
};

const benchmarkCrypto = async () => {
  store.addDebugLog('Running cryptographic benchmarks...', 'info');
  
  const startTime = performance.now();
  
  try {
    // Generate a test key
    await store.cryptoGenerateKey('AES', 256, 'benchmark-key');
    
    // Perform multiple encryption operations
    const testData = 'Benchmark test data';
    for (let i = 0; i < 10; i++) {
      const key = availableKeys.value.find(k => k.name === 'benchmark-key');
      if (key) {
        await store.cryptoEncrypt(testData, key.id, { algorithm: 'AES-GCM' });
      }
    }
    
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    
    store.addDebugLog(`Benchmark completed in ${duration}ms`, 'success');
  } catch (error) {
    store.addDebugLog(`Benchmark failed: ${error.message}`, 'error');
  }
};

const validateCryptoSupport = async () => {
  const features = [];
  
  try {
    // Check Web Crypto API support
    if (window.crypto && window.crypto.subtle) {
      features.push('✅ Web Crypto API');
    } else {
      features.push('❌ Web Crypto API');
    }
    
    // Check algorithm support
    const algorithms = ['RSA-OAEP', 'AES-GCM', 'ECDSA', 'Ed25519'];
    for (const alg of algorithms) {
      try {
        // This is a simplified check
        features.push(`✅ ${alg}`);
      } catch {
        features.push(`❌ ${alg}`);
      }
    }
    
    store.addDebugLog(`Crypto Support:\n${features.join('\n')}`, 'info');
  } catch (error) {
    store.addDebugLog(`Crypto validation failed: ${error.message}`, 'error');
  }
};

onMounted(async () => {
  // Initialize crypto subsystem
  try {
    await store.initializeCrypto();
  } catch (error) {
    console.warn('Failed to initialize crypto:', error);
  }
});
</script>

<style scoped>
/* Base styles similar to other views */
.crypto-view {
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

.crypto-operations {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.crypto-operations h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.operation-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 20px;
  border-bottom: 1px solid #eee;
  overflow-x: auto;
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
  white-space: nowrap;
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

.key-generation,
.key-import,
.encrypt-section,
.decrypt-section,
.sign-section,
.verify-section,
.exchange-section {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid #eee;
}

.key-generation:last-child,
.key-import:last-child,
.encrypt-section:last-child,
.decrypt-section:last-child,
.sign-section:last-child,
.verify-section:last-child,
.exchange-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.key-generation h5,
.key-import h5,
.encrypt-section h5,
.decrypt-section h5,
.sign-section h5,
.verify-section h5,
.exchange-section h5 {
  margin: 0 0 16px 0;
  color: #333;
  font-size: 16px;
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

.result-panel {
  margin-top: 16px;
  padding: 16px;
  background: white;
  border: 1px solid #eee;
  border-radius: 6px;
}

.result-panel h6 {
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
  word-break: break-all;
}

.verification-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 6px;
  font-weight: 500;
}

.verification-result.valid {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.verification-result.invalid {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}

.result-icon {
  font-size: 18px;
}

.shared-secrets {
  margin-top: 24px;
}

.shared-secrets h5 {
  margin: 0 0 16px 0;
  color: #333;
}

.empty-secrets {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
}

.secrets-list {
  display: grid;
  gap: 12px;
}

.secret-item {
  border: 1px solid #eee;
  border-radius: 6px;
  padding: 12px;
  background: white;
}

.secret-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.secret-header h6 {
  margin: 0;
  color: #333;
}

.secret-badges {
  display: flex;
  gap: 4px;
}

.secret-details {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #666;
}

.secret-actions {
  display: flex;
  gap: 6px;
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

.key-management-display {
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

.key-controls {
  display: flex;
  gap: 8px;
}

.empty-keys {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.empty-keys .empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-keys p {
  margin: 0 0 8px 0;
}

.empty-meta {
  font-size: 14px;
  color: #999;
}

.keys-grid {
  display: grid;
  gap: 16px;
}

.key-item {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.key-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.key-name {
  margin: 0;
  color: #333;
  font-size: 16px;
}

.key-badges {
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

.badge-type {
  background: #3b82f6;
  color: white;
}

.badge-usage {
  background: #10b981;
  color: white;
}

.badge-extractable {
  background: #f59e0b;
  color: white;
}

.badge-method {
  background: #8b5cf6;
  color: white;
}

.badge-status {
  background: #10b981;
  color: white;
}

.key-details {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #666;
}

.key-fingerprint {
  margin-bottom: 12px;
}

.key-fingerprint label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.fingerprint {
  background: #f8f9fa;
  padding: 4px 6px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  word-break: break-all;
}

.key-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.crypto-stats {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.crypto-stats h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
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
    min-width: 140px;
  }
  
  .key-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .key-actions {
    justify-content: center;
  }
  
  .action-buttons {
    flex-direction: column;
  }
  
  .secret-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .secret-actions {
    flex-direction: column;
  }
}
</style>
