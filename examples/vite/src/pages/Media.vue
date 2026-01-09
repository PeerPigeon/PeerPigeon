<template>
  <div class="grid" style="grid-template-columns: 1fr;">
    <div v-if="connected" class="status-banner connected-banner">
      ✅ Connected to mesh • {{ peerList.length }} peer{{ peerList.length !== 1 ? 's' : '' }} • Room: {{ roomId }}
    </div>
    <div v-else class="status-banner disconnected-banner">
      ⚠️ Not connected • Go to Network page to connect
    </div>
  </div>
  
  <div class="grid" style="grid-template-columns: 1fr 1fr;">
    <section class="card">
      <h3>📤 Send File</h3>
      <div class="kv" style="margin-top: 12px;">
        <div>Peer</div>
        <select v-model="selectedPeer" class="select">
          <option value="">Broadcast</option>
          <option v-for="p in peerList" :key="p" :value="p">{{ p.substring(0,16) }}...</option>
        </select>
        <div>File</div>
        <input type="file" @change="onFile" />
      </div>
      <button class="btn primary" @click="sendFile" :disabled="!file || peerList.length===0">Send</button>
    </section>

    <section class="card">
      <h3>📥 Received Files</h3>
      <div v-if="filesList.length===0" class="small">No files yet</div>
      <ul v-else style="list-style:none;padding:0;">
        <li v-for="(f,i) in filesList" :key="i" class="code small" style="margin-bottom:6px;">
          <strong>{{ f.name }}</strong> ({{ f.size }} bytes) from {{ f.from.substring(0,8) }}...
          <a :href="f.url" download="{{ f.name }}" style="margin-left:8px;">Download</a>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { dht, peerList, files } from '../dhtStore.js';

const selectedPeer = ref('');
const file = ref(null);
const filesList = computed(() => files.value);

function onFile(e) {
  file.value = e.target.files?.[0] || null;
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendFile() {
  if (!file.value || !dht.value) return;
  const name = file.value.name;
  const dataBase64 = await toBase64(file.value);
  const msg = { type: 'file', payload: { name, dataBase64 } };
  try {
    if (selectedPeer.value) {
      dht.value.send(selectedPeer.value, JSON.stringify(msg));
    } else {
      dht.value.broadcast(JSON.stringify(msg));
    }
  } catch (e) { console.error('File send failed', e); }
}
</script>

<style scoped>
.kv { display:grid; grid-template-columns: 80px 1fr; gap:8px; }
</style>
