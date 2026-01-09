<template>
  <div class="grid" style="grid-template-columns: 1fr;">
    <div v-if="connected" class="status-banner connected-banner">
      ✅ Connected to mesh • {{ peerList.length }} peer{{ peerList.length !== 1 ? 's' : '' }} • Room: {{ roomId }}
    </div>
    <div v-else class="status-banner disconnected-banner">
      ⚠️ Not connected • Go to Network page to connect
    </div>
    
    <section class="card">
      <h3>📦 Distributed Storage</h3>
      <p class="small">Synchronized key-value store across all peers</p>
      
      <div class="storage-ops">
        <div class="op-section">
          <h4>Put / Update</h4>
          <div class="kv" style="margin-top: 8px;">
            <div>Key</div>
            <input v-model="key" class="input" placeholder="e.g. username" />
            
            <div>Value</div>
            <textarea v-model="value" class="input" placeholder="Enter value" style="min-height: 60px;"></textarea>
          </div>
          <button class="btn primary" @click="putKV" :disabled="!key.trim()" style="margin-top: 8px;">
            Put / Update
          </button>
        </div>

        <div class="op-section">
          <h4>Get</h4>
          <div class="kv" style="margin-top: 8px;">
            <div>Key</div>
            <input v-model="getKey" class="input" placeholder="e.g. username" />
          </div>
          <button class="btn" @click="getKV" :disabled="!getKey.trim()" style="margin-top: 8px;">
            Get Value
          </button>
          <div v-if="getValue !== null" class="result-box">
            <strong>Result:</strong> {{ getValue }}
          </div>
        </div>

        <div class="op-section">
          <h4>Delete</h4>
          <div class="kv" style="margin-top: 8px;">
            <div>Key</div>
            <input v-model="deleteKey" class="input" placeholder="e.g. username" />
          </div>
          <button class="btn" @click="deleteKV" :disabled="!deleteKey.trim()" style="margin-top: 8px; background: #ef4444;">
            Delete
          </button>
        </div>

        <div class="op-section">
          <h4>Subscribe</h4>
          <div class="kv" style="margin-top: 8px;">
            <div>Key Pattern</div>
            <input v-model="subscribeKey" class="input" placeholder="e.g. user:*" />
          </div>
          <button class="btn" @click="subscribeKV" :disabled="!subscribeKey.trim()" style="margin-top: 8px;">
            {{ isSubscribed ? 'Unsubscribe' : 'Subscribe' }}
          </button>
          <div v-if="subscriptions.length > 0" class="result-box">
            <strong>Subscribed:</strong>
            <div v-for="sub in subscriptions" :key="sub" class="code small">{{ sub }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Current Store ({{ Object.keys(kvStore).length }} entries)</h3>
      <div v-if="Object.keys(kvStore).length === 0" class="small">Empty - no keys stored</div>
      <div v-else class="store-list">
        <div v-for="(v, k) in kvStore" :key="k" class="store-item">
          <div class="store-key">{{ k }}</div>
          <div class="store-value">{{ v }}</div>
          <button class="btn-small" @click="deleteSpecific(k)">🗑️</button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { dht, kv, connected, peerList, roomId } from '../dhtStore.js';

const key = ref('');
const value = ref('');
const getKey = ref('');
const getValue = ref(null);
const deleteKey = ref('');
const subscribeKey = ref('');
const isSubscribed = ref(false);
const subscriptions = ref([]);
const kvStore = computed(() => kv.value);

function putKV() {
  if (!dht.value || !key.value.trim()) return;
  const msg = { type: 'kv-set', key: key.value.trim(), value: value.value };
  try {
    dht.value.broadcast(JSON.stringify(msg));
    kv.value = { ...kv.value, [msg.key]: msg.value };
    key.value = '';
    value.value = '';
  } catch (e) {
    console.error('Put failed', e);
  }
}

function getKV() {
  if (!getKey.value.trim()) return;
  const val = kv.value[getKey.value.trim()];
  getValue.value = val !== undefined ? val : 'Key not found';
}

function deleteKV() {
  if (!dht.value || !deleteKey.value.trim()) return;
  const msg = { type: 'kv-delete', key: deleteKey.value.trim() };
  try {
    dht.value.broadcast(JSON.stringify(msg));
    const newKv = { ...kv.value };
    delete newKv[msg.key];
    kv.value = newKv;
    deleteKey.value = '';
  } catch (e) {
    console.error('Delete failed', e);
  }
}

function deleteSpecific(k) {
  const msg = { type: 'kv-delete', key: k };
  try {
    dht.value.broadcast(JSON.stringify(msg));
    const newKv = { ...kv.value };
    delete newKv[k];
    kv.value = newKv;
  } catch (e) {
    console.error('Delete failed', e);
  }
}

function subscribeKV() {
  if (!subscribeKey.value.trim()) return;
  
  if (isSubscribed.value) {
    subscriptions.value = subscriptions.value.filter(s => s !== subscribeKey.value);
    isSubscribed.value = false;
  } else {
    subscriptions.value.push(subscribeKey.value);
    isSubscribed.value = true;
  }
  
  console.log('Subscribed to:', subscriptions.value);
}
</script>

<style scoped>
.kv { display: grid; grid-template-columns: 100px 1fr; gap: 12px; align-items: start; }
textarea.input { min-height: 80px; }
.storage-ops {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  margin-top: 16px;
}
.op-section {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 16px;
}
.op-section h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
}
.result-box {
  margin-top: 12px;
  padding: 12px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 6px;
  font-size: 14px;
}
.store-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.store-item {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
}
.store-key {
  font-weight: bold;
  color: #60a5fa;
  word-break: break-word;
}
.store-value {
  color: #d1d5db;
  word-break: break-word;
}
.btn-small {
  padding: 4px 8px;
  font-size: 14px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-small:hover {
  background: rgba(239, 68, 68, 0.3);
}
</style>
