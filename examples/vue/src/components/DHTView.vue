<template>
  <div>
    <h2 class="section-title">🌐 WebDHT & Distributed Storage</h2>

    <!-- WebDHT Section -->
    <div class="card">
      <h3>🌐 WebDHT Operations</h3>
      <p class="description">Distributed key-value storage across the peer mesh</p>

      <!-- Store -->
      <div class="subsection">
        <h4>Store Data</h4>
        <div class="form-row">
          <div class="form-group flex-1">
            <label>Key:</label>
            <input v-model="dhtKey" type="text" placeholder="Storage key" />
          </div>
          <div class="form-group w-80">
            <label>TTL (sec, 0=forever):</label>
            <input v-model.number="dhtTtl" type="number" min="0" placeholder="3600" />
          </div>
        </div>
        <div class="input-group">
          <label>Value (JSON or plain text):</label>
          <textarea v-model="dhtValue" rows="3" placeholder='{"key":"value"} or plain text' />
        </div>
        <div class="button-group">
          <button class="btn primary" :disabled="!store.isConnected" @click="dhtPut">💾 Store (Put)</button>
          <button class="btn secondary" :disabled="!store.isConnected" @click="dhtUpdate">✏️ Update</button>
        </div>
      </div>

      <!-- Retrieve/Delete -->
      <div class="subsection">
        <h4>Retrieve / Delete</h4>
        <div class="input-group">
          <label>Key:</label>
          <input v-model="dhtRetrieveKey" type="text" placeholder="Key to retrieve or delete" />
        </div>
        <div class="button-group">
          <button class="btn primary" :disabled="!store.isConnected" @click="dhtGet">🔍 Retrieve (Get)</button>
          <button class="btn danger" :disabled="!store.isConnected" @click="dhtDelete">🗑️ Delete</button>
        </div>
        <div v-if="dhtResult !== null" class="result-box">
          <div class="result-label">Result:</div>
          <pre>{{ formatJson(dhtResult) }}</pre>
        </div>
      </div>

      <!-- Subscribe -->
      <div class="subsection">
        <h4>Subscribe to Changes</h4>
        <div class="input-group">
          <label>Key:</label>
          <input v-model="dhtSubKey" type="text" placeholder="Key to watch" />
        </div>
        <div class="button-group">
          <button class="btn primary" :disabled="!store.isConnected" @click="dhtSubscribe">👁️ Subscribe</button>
          <button class="btn secondary" :disabled="!store.isConnected" @click="dhtUnsubscribe">🚫 Unsubscribe</button>
        </div>
        <div v-if="store.activeSubscriptions.size > 0" class="tags-row">
          <span class="tag" v-for="sub in store.activeSubscriptions" :key="sub">{{ sub }}</span>
        </div>
      </div>
    </div>

    <!-- DHT Data View -->
    <div class="card" v-if="store.dhtData.size > 0">
      <h3>📊 DHT Data Store ({{ store.dhtData.size }} entries)</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Key</th><th>Value</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="[key, entry] in store.dhtData" :key="key">
              <td class="mono">{{ key }}</td>
              <td class="mono truncate">{{ formatJson(entry?.value ?? entry) }}</td>
              <td>
                <button class="btn-sm secondary" @click="quickGet(key)">Get</button>
                <button class="btn-sm danger" @click="quickDelete(key)" style="margin-left:4px">Del</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- DHT Log -->
    <div class="card">
      <h3>📋 DHT Activity Log</h3>
      <div class="activity-log">
        <p v-if="store.dhtLogs.length === 0" class="empty-state" style="color:#90cdf4">No DHT activity yet</p>
        <div v-for="(entry, i) in store.dhtLogs" :key="i" :class="['log-entry', entry.level || 'info']">
          {{ entry.message || entry }}
        </div>
      </div>
      <button class="btn tertiary" @click="store.dhtLogs.splice(0)">Clear</button>
    </div>

    <!-- Distributed Storage Section -->
    <div class="card">
      <h3>🗄️ Distributed Storage</h3>
      <p class="description">Higher-level storage with access control and namespacing</p>

      <div class="form-row" style="align-items:flex-end;margin-bottom:12px">
        <div>
          <label>Space:</label>
          <select v-model="storageSpace">
            <option value="public">🌐 Public</option>
            <option value="private">🔒 Private</option>
            <option value="frozen">🧊 Frozen</option>
          </select>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:flex-end">
          <button class="btn secondary" @click="storageEnable">✅ Enable</button>
          <button class="btn secondary" @click="storageDisable">❌ Disable</button>
          <button class="btn secondary" @click="storageStatus">ℹ️ Status</button>
        </div>
      </div>

      <div v-if="storageStatusInfo" class="result-box" style="margin-bottom:12px">
        <pre>{{ storageStatusInfo }}</pre>
      </div>

      <div class="subsection">
        <h4>Store / Retrieve / Delete</h4>
        <div class="form-row">
          <div class="form-group flex-1">
            <label>Key:</label>
            <input v-model="storageKey" type="text" placeholder="Storage key" />
          </div>
        </div>
        <div class="input-group">
          <label>Data (JSON or plain text):</label>
          <textarea v-model="storageData" rows="3" placeholder='{"data":"value"}' />
        </div>
        <div class="button-group">
          <button class="btn primary" :disabled="!store.isConnected" @click="storagePut">💾 Store</button>
          <button class="btn primary" :disabled="!store.isConnected" @click="storageGet">🔍 Retrieve</button>
          <button class="btn danger" :disabled="!store.isConnected" @click="storageDelete">🗑️ Delete</button>
        </div>
        <div v-if="storageResult !== null" class="result-box">
          <div class="result-label">Result:</div>
          <pre>{{ formatJson(storageResult) }}</pre>
        </div>
      </div>

      <div class="subsection">
        <h4>List / Stats / Clear</h4>
        <div class="button-group">
          <button class="btn secondary" :disabled="!store.isConnected" @click="storageListKeys">📋 List Keys</button>
          <button class="btn secondary" :disabled="!store.isConnected" @click="storageGetStats">📊 Get Stats</button>
          <button class="btn danger" :disabled="!store.isConnected" @click="storageClear">🗑️ Clear</button>
        </div>
        <div v-if="storageKeys.length > 0" class="tags-row">
          <span class="tag" v-for="k in storageKeys" :key="k">{{ k }}</span>
        </div>
      </div>
    </div>

    <!-- Storage Log -->
    <div class="card">
      <h3>📋 Storage Activity Log</h3>
      <div class="activity-log">
        <p v-if="store.storageLogs.length === 0" class="empty-state" style="color:#90cdf4">No storage activity yet</p>
        <div v-for="(entry, i) in store.storageLogs" :key="i" :class="['log-entry', entry.level || 'info']">
          {{ entry.message || entry }}
        </div>
      </div>
      <button class="btn tertiary" @click="store.storageLogs.splice(0)">Clear</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

// DHT state
const dhtKey = ref('');
const dhtValue = ref('');
const dhtTtl = ref(0);
const dhtRetrieveKey = ref('');
const dhtSubKey = ref('');
const dhtResult = ref(null);

// Storage state
const storageSpace = ref('public');
const storageKey = ref('');
const storageData = ref('');
const storageResult = ref(null);
const storageKeys = ref([]);
const storageStatusInfo = ref('');

function parseValue(val) {
  try { return JSON.parse(val); } catch { return val; }
}
function formatJson(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

const dhtPut = async () => {
  const m = store.mesh;
  if (!m || !dhtKey.value.trim()) return;
  const val = parseValue(dhtValue.value);
  const opts = dhtTtl.value > 0 ? { ttl: dhtTtl.value * 1000 } : {};
  try {
    await m.dhtPut(dhtKey.value.trim(), val, opts);
    store.addDHTLog(`💾 Put: ${dhtKey.value} = ${JSON.stringify(val).substring(0,60)}`, 'success');
    store.dhtData.set(dhtKey.value.trim(), { value: val });
  } catch (e) {
    store.addDHTLog(`❌ Put failed: ${e.message}`, 'error');
  }
};

const dhtUpdate = async () => {
  const m = store.mesh;
  if (!m || !dhtKey.value.trim()) return;
  const val = parseValue(dhtValue.value);
  try {
    await m.dhtUpdate(dhtKey.value.trim(), val);
    store.addDHTLog(`✏️ Updated: ${dhtKey.value}`, 'info');
    if (store.dhtData.has(dhtKey.value.trim())) store.dhtData.set(dhtKey.value.trim(), { value: val });
  } catch (e) {
    store.addDHTLog(`❌ Update failed: ${e.message}`, 'error');
  }
};

const dhtGet = async () => {
  const m = store.mesh;
  if (!m || !dhtRetrieveKey.value.trim()) return;
  try {
    dhtResult.value = await m.dhtGet(dhtRetrieveKey.value.trim());
    store.addDHTLog(`🔍 Get: ${dhtRetrieveKey.value} = ${JSON.stringify(dhtResult.value).substring(0,60)}`, 'info');
  } catch (e) {
    store.addDHTLog(`❌ Get failed: ${e.message}`, 'error');
  }
};

const dhtDelete = async () => {
  const m = store.mesh;
  if (!m || !dhtRetrieveKey.value.trim()) return;
  try {
    await m.dhtDelete(dhtRetrieveKey.value.trim());
    store.addDHTLog(`🗑️ Deleted: ${dhtRetrieveKey.value}`, 'warning');
    store.dhtData.delete(dhtRetrieveKey.value.trim());
  } catch (e) {
    store.addDHTLog(`❌ Delete failed: ${e.message}`, 'error');
  }
};

const dhtSubscribe = async () => {
  const m = store.mesh;
  if (!m || !dhtSubKey.value.trim()) return;
  try {
    await m.dhtSubscribe(dhtSubKey.value.trim());
    store.activeSubscriptions.add(dhtSubKey.value.trim());
    store.addDHTLog(`👁️ Subscribed to: ${dhtSubKey.value}`, 'info');
  } catch (e) {
    store.addDHTLog(`❌ Subscribe failed: ${e.message}`, 'error');
  }
};

const dhtUnsubscribe = async () => {
  const m = store.mesh;
  if (!m || !dhtSubKey.value.trim()) return;
  try {
    await m.dhtUnsubscribe(dhtSubKey.value.trim());
    store.activeSubscriptions.delete(dhtSubKey.value.trim());
    store.addDHTLog(`🚫 Unsubscribed from: ${dhtSubKey.value}`, 'info');
  } catch (e) {
    store.addDHTLog(`❌ Unsubscribe failed: ${e.message}`, 'error');
  }
};

const quickGet = async (key) => {
  const m = store.mesh;
  if (!m) return;
  dhtRetrieveKey.value = key;
  const result = await m.dhtGet(key);
  dhtResult.value = result;
};

const quickDelete = async (key) => {
  const m = store.mesh;
  if (!m) return;
  await m.dhtDelete(key);
  store.dhtData.delete(key);
  store.addDHTLog(`🗑️ Deleted: ${key}`, 'warning');
};

// Storage
const getDs = () => store.mesh?.distributedStorage ?? null;

const storageEnable = async () => {
  const ds = getDs();
  if (!ds) return;
  try { await ds.enable(); store.addStorageLog('✅ Storage enabled', 'success'); }
  catch (e) { store.addStorageLog(`❌ ${e.message}`, 'error'); }
};

const storageDisable = async () => {
  const ds = getDs();
  if (!ds) return;
  try { await ds.disable(); store.addStorageLog('❌ Storage disabled', 'warning'); }
  catch (e) { store.addStorageLog(`❌ ${e.message}`, 'error'); }
};

const storageStatus = async () => {
  const ds = getDs();
  if (!ds) return;
  try { storageStatusInfo.value = JSON.stringify(ds.getStatus ? ds.getStatus() : ds.getStats?.(), null, 2); }
  catch (e) { storageStatusInfo.value = e.message; }
};

const storagePut = async () => {
  const ds = getDs();
  if (!ds || !storageKey.value.trim()) return;
  const data = parseValue(storageData.value);
  try {
    await ds.store(storageKey.value.trim(), data, { space: storageSpace.value });
    store.addStorageLog(`💾 Stored: ${storageKey.value} (${storageSpace.value})`, 'success');
  } catch (e) {
    store.addStorageLog(`❌ Store failed: ${e.message}`, 'error');
  }
};

const storageGet = async () => {
  const ds = getDs();
  if (!ds || !storageKey.value.trim()) return;
  try {
    storageResult.value = await ds.retrieve(storageKey.value.trim());
    store.addStorageLog(`🔍 Retrieved: ${storageKey.value}`, 'info');
  } catch (e) {
    store.addStorageLog(`❌ Retrieve failed: ${e.message}`, 'error');
  }
};

const storageDelete = async () => {
  const ds = getDs();
  if (!ds || !storageKey.value.trim()) return;
  try {
    await ds.delete(storageKey.value.trim());
    store.addStorageLog(`🗑️ Deleted: ${storageKey.value}`, 'warning');
  } catch (e) {
    store.addStorageLog(`❌ Delete failed: ${e.message}`, 'error');
  }
};

const storageListKeys = async () => {
  const ds = getDs();
  if (!ds) return;
  try {
    storageKeys.value = await ds.listKeys?.({ space: storageSpace.value }) ?? [];
    store.addStorageLog(`📋 Listed ${storageKeys.value.length} keys (${storageSpace.value})`, 'info');
  } catch (e) {
    store.addStorageLog(`❌ ${e.message}`, 'error');
  }
};

const storageGetStats = async () => {
  const ds = getDs();
  if (!ds) return;
  try {
    const stats = ds.getStats ? ds.getStats() : {};
    storageStatusInfo.value = JSON.stringify(stats, null, 2);
    store.addStorageLog(`📊 Stats: ${JSON.stringify(stats).substring(0,80)}`, 'info');
  } catch (e) {
    store.addStorageLog(`❌ ${e.message}`, 'error');
  }
};

const storageClear = async () => {
  const ds = getDs();
  if (!ds) return;
  try {
    await ds.clear?.({ space: storageSpace.value });
    storageKeys.value = [];
    store.addStorageLog(`🗑️ Cleared ${storageSpace.value} space`, 'warning');
  } catch (e) {
    store.addStorageLog(`❌ ${e.message}`, 'error');
  }
};
</script>

<style scoped>
.subsection { border-left: 2px solid #2d3748; padding-left: 12px; margin-bottom: 16px; }
.subsection h4 { color: #90cdf4; font-size: 13px; margin-bottom: 10px; }
.form-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; align-items: flex-start; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.flex-1 { flex: 1; }
.w-80 { width: 120px; flex-shrink: 0; }
.result-box { background: #1a202c; border: 1px solid #2d3748; border-radius: 6px; padding: 10px; margin-top: 8px; }
.result-box pre { color: #90cdf4; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 0; }
.result-label { color: #718096; font-size: 11px; margin-bottom: 4px; }
.table-wrapper { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th { color: #718096; font-weight: 600; padding: 6px 10px; border-bottom: 1px solid #2d3748; text-align: left; }
.data-table td { padding: 6px 10px; border-bottom: 1px solid #1a202c; color: #e2e8f0; }
.data-table .mono { font-family: monospace; }
.data-table .truncate { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tags-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag { background: #2d3748; color: #90cdf4; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-family: monospace; }
.btn-sm { padding: 2px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; border: none; }
.btn-sm.secondary { background: #2d3748; color: #e2e8f0; }
.btn-sm.danger { background: #742a2a; color: #fed7d7; }
</style>
