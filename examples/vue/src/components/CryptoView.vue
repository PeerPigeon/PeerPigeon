<template>
  <div>
    <h2 class="section-title">🔐 Encryption & Key Management</h2>

    <!-- Crypto Status -->
    <div class="card">
      <h3>🔏 Encryption Status</h3>
      <div class="status-grid">
        <div class="status-item">
          <span class="status-label">Status</span>
          <span :class="['status-badge', store.cryptoState.initialized ? 'connected' : 'disconnected']">
            {{ store.cryptoState.initialized ? '✅ Initialized' : '❌ Not Initialized' }}
          </span>
        </div>
        <div class="status-item">
          <span class="status-label">Key Pairs</span>
          <span class="status-value">{{ store.cryptoState.initialized ? '1 (ECDH P-256)' : 'None' }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Peer Keys</span>
          <span class="status-value">{{ store.cryptoState.peerKeys?.size ?? 0 }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Algorithm</span>
          <span class="status-value">AES-GCM + ECDH P-256</span>
        </div>
      </div>

      <div v-if="store.cryptoState.publicKey" class="key-display">
        <label>Public Key (JWK):</label>
        <div class="key-box">{{ JSON.stringify(store.cryptoState.publicKey).substring(0,120) }}...</div>
      </div>

      <div class="button-group" style="margin-top:12px">
        <button class="btn primary" @click="initCrypto">🔑 Initialize Crypto</button>
        <button class="btn secondary" :disabled="!store.cryptoState.initialized" @click="refreshKeys">🔄 Refresh Keys</button>
        <button class="btn secondary" :disabled="!store.isConnected" @click="exchangeAllKeys">📤 Exchange with All Peers</button>
      </div>
    </div>

    <!-- Encrypted Broadcast -->
    <div class="card">
      <h3>📢 Encrypted Broadcast</h3>
      <p class="description">Send encrypted messages to all peers with a shared group key</p>
      <div class="input-group">
        <label>Message:</label>
        <textarea v-model="encBroadcastMsg" rows="3" placeholder="Enter encrypted broadcast message..."
          @keydown.enter.exact.prevent="sendEncBroadcast" />
      </div>
      <div class="input-group">
        <label>Group ID (optional):</label>
        <input v-model="groupId" type="text" placeholder="Optional group identifier" />
      </div>
      <div class="button-group">
        <button class="btn primary" :disabled="!store.isConnected || !store.cryptoState.initialized" @click="sendEncBroadcast">
          🔒 Send Encrypted Broadcast
        </button>
      </div>
      <p v-if="encBroadcastError" class="error-msg">{{ encBroadcastError }}</p>
    </div>

    <!-- Key Exchange -->
    <div class="card">
      <h3>🤝 Key Exchange</h3>
      <p class="description">Manually exchange ECDH keys with specific peers</p>
      <div class="input-group">
        <label>Target Peer ID:</label>
        <div class="combo-row">
          <select v-model="keyExchangeTarget">
            <option value="">Select peer...</option>
            <option v-for="peer in connectedPeers" :key="peer.id" :value="peer.id">
              {{ peer.id.substring(0,8) }}...{{ peer.id.substring(peer.id.length-8) }}
            </option>
          </select>
          <input v-model="keyExchangeManual" type="text" placeholder="Or enter peer ID manually" />
        </div>
      </div>
      <div class="button-group">
        <button class="btn primary" :disabled="!store.isConnected || !store.cryptoState.initialized" @click="exchangeKeys">
          🤝 Exchange Keys
        </button>
      </div>
    </div>

    <!-- Manual Key Management -->
    <div class="card">
      <h3>🔧 Manual Key Management</h3>
      <p class="description">Manually add or view peer public keys</p>
      <div class="input-group">
        <label>Peer ID:</label>
        <input v-model="manualPeerId" type="text" placeholder="Peer ID" />
      </div>
      <div class="input-group">
        <label>Public Key (JWK JSON):</label>
        <textarea v-model="manualPublicKey" rows="3" placeholder='{"kty":"EC","crv":"P-256",...}' />
      </div>
      <div class="button-group">
        <button class="btn primary" :disabled="!store.isConnected" @click="addManualKey">✅ Add Key</button>
        <button class="btn secondary" @click="viewKey">👁️ View Key</button>
      </div>
      <div v-if="keyViewResult" class="result-box">
        <pre>{{ keyViewResult }}</pre>
      </div>
    </div>

    <!-- Existing Peer Keys -->
    <div class="card" v-if="store.cryptoState.peerKeys?.size > 0">
      <h3>🗝️ Known Peer Keys ({{ store.cryptoState.peerKeys.size }})</h3>
      <div v-for="[pid] in store.cryptoState.peerKeys" :key="pid" class="peer-key-row">
        <span class="peer-id-short">{{ pid.substring(0,8) }}...{{ pid.substring(pid.length-8) }}</span>
        <span class="key-status">✅ Key stored</span>
      </div>
    </div>

    <!-- Crypto Log -->
    <div class="card">
      <h3>📋 Crypto Activity Log</h3>
      <div class="activity-log">
        <p v-if="store.cryptoLogs.length === 0" class="empty-state" style="color:#90cdf4">No crypto activity yet</p>
        <div v-for="(entry, i) in store.cryptoLogs" :key="i" :class="['log-entry', entry.level || 'info']">
          {{ entry.message || entry }}
        </div>
      </div>
      <button class="btn tertiary" @click="store.cryptoLogs.splice(0)">Clear</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

const encBroadcastMsg = ref('');
const groupId = ref('');
const encBroadcastError = ref('');
const keyExchangeTarget = ref('');
const keyExchangeManual = ref('');
const manualPeerId = ref('');
const manualPublicKey = ref('');
const keyViewResult = ref('');

const connectedPeers = computed(() =>
  Array.from(store.peers.values()).filter(p => p.connected)
);

const initCrypto = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    if (m.cryptoManager) {
      await m.cryptoManager.generateKeypair();
      const pub = await m.cryptoManager.getPublicKeyJwk?.();
      store.cryptoState.initialized = true;
      store.cryptoState.publicKey = pub;
      store.addCryptoLog('🔑 Crypto keypair generated', 'success');
    }
  } catch (e) {
    store.addCryptoLog(`❌ Init failed: ${e.message}`, 'error');
  }
};

const refreshKeys = async () => {
  await initCrypto();
  store.addCryptoLog('🔄 Keys refreshed', 'info');
};

const exchangeAllKeys = async () => {
  const m = store.mesh;
  if (!m) return;
  const peers = connectedPeers.value;
  for (const peer of peers) {
    try {
      await m.exchangeKeysWithPeer?.(peer.id);
      store.addCryptoLog(`📤 Key exchange initiated with ${peer.id.substring(0,8)}...`, 'info');
    } catch (e) {
      store.addCryptoLog(`❌ Key exchange failed with ${peer.id.substring(0,8)}...: ${e.message}`, 'error');
    }
  }
};

const sendEncBroadcast = async () => {
  encBroadcastError.value = '';
  const text = encBroadcastMsg.value.trim();
  if (!text) { encBroadcastError.value = 'Please enter a message'; return; }

  const m = store.mesh;
  if (!m) { encBroadcastError.value = 'Not initialized'; return; }
  try {
    const id = await m.sendEncryptedBroadcast(text, groupId.value || undefined);
    if (id) {
      store.addCryptoLog(`🔒 Encrypted broadcast sent (id: ${id})`, 'success');
      encBroadcastMsg.value = '';
    } else {
      encBroadcastError.value = 'Send failed — no peers?';
    }
  } catch (e) {
    encBroadcastError.value = e.message;
    store.addCryptoLog(`❌ Encrypted broadcast failed: ${e.message}`, 'error');
  }
};

const exchangeKeys = async () => {
  const target = keyExchangeTarget.value || keyExchangeManual.value.trim();
  if (!target) return;
  const m = store.mesh;
  if (!m) return;
  try {
    await m.exchangeKeysWithPeer?.(target);
    store.addCryptoLog(`🤝 Key exchange initiated with ${target.substring(0,8)}...`, 'success');
  } catch (e) {
    store.addCryptoLog(`❌ Key exchange failed: ${e.message}`, 'error');
  }
};

const addManualKey = async () => {
  if (!manualPeerId.value.trim() || !manualPublicKey.value.trim()) return;
  const m = store.mesh;
  if (!m) return;
  try {
    const keyObj = JSON.parse(manualPublicKey.value);
    await m.addPeerKey?.(manualPeerId.value.trim(), keyObj);
    if (!store.cryptoState.peerKeys) store.cryptoState.peerKeys = new Map();
    store.cryptoState.peerKeys.set(manualPeerId.value.trim(), keyObj);
    store.addCryptoLog(`✅ Manual key added for ${manualPeerId.value.substring(0,8)}...`, 'success');
    manualPublicKey.value = '';
  } catch (e) {
    store.addCryptoLog(`❌ Failed to add key: ${e.message}`, 'error');
  }
};

const viewKey = async () => {
  const m = store.mesh;
  if (!m || !manualPeerId.value.trim()) return;
  const key = m.cryptoManager?.peerKeys?.get(manualPeerId.value.trim())
    ?? store.cryptoState.peerKeys?.get(manualPeerId.value.trim());
  keyViewResult.value = key ? JSON.stringify(key, null, 2) : 'No key found for this peer';
};
</script>

<style scoped>
.status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
.status-item { display: flex; flex-direction: column; gap: 4px; background: #1a202c; padding: 10px; border-radius: 6px; }
.status-label { color: #718096; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.status-value { color: #e2e8f0; font-size: 13px; }
.key-display { margin-top: 12px; }
.key-display label { color: #718096; font-size: 12px; display: block; margin-bottom: 4px; }
.key-box { background: #1a202c; border: 1px solid #2d3748; border-radius: 6px; padding: 8px; font-size: 10px; font-family: monospace; color: #90cdf4; word-break: break-all; }
.combo-row { display: flex; flex-direction: column; gap: 6px; }
.peer-key-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #1a202c; border-radius: 4px; margin-bottom: 4px; }
.peer-id-short { font-family: monospace; font-size: 12px; color: #90cdf4; }
.key-status { font-size: 11px; color: #68d391; }
.result-box { background: #1a202c; border: 1px solid #2d3748; border-radius: 6px; padding: 10px; margin-top: 8px; }
.result-box pre { color: #90cdf4; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 0; }
.error-msg { color: #c53030; font-size: 12px; margin-top: 4px; }
</style>
