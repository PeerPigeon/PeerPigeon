<template>
  <div class="grid" style="grid-template-columns: 1fr 1fr;">
    <section class="card">
      <h3>🧪 Ping / RTT</h3>
      <div class="kv" style="margin-top: 12px;">
        <div>Peer</div>
        <select v-model="selectedPeer" class="select">
          <option value="">Broadcast</option>
          <option v-for="p in peerList" :key="p" :value="p">{{ p.substring(0,16) }}...</option>
        </select>
      </div>
      <button class="btn primary" @click="sendPing" :disabled="peerList.length===0">Send Ping</button>
      <div style="margin-top: 12px;">
        <h4>Latency</h4>
        <ul v-if="Object.keys(latencyMap).length>0" style="list-style:none;padding:0;">
          <li v-for="(ms, pid) in latencyMap" :key="pid" class="code small">{{ pid.substring(0,16) }}... → {{ ms }} ms</li>
        </ul>
        <div v-else class="small">No measurements yet</div>
      </div>
    </section>

    <section class="card">
      <h3>📣 Broadcast Test</h3>
      <p class="small">Sends a broadcast message to all peers.</p>
      <button class="btn" @click="broadcastTest" :disabled="peerList.length===0">Broadcast</button>
    </section>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { dht, peerList, latency } from '../dhtStore.js';

const selectedPeer = ref('');
const latencyMap = computed(() => latency.value);

function sendPing() {
  if (!dht.value) return;
  const msg = { type: 'ping', t: Date.now() };
  try {
    if (selectedPeer.value) {
      dht.value.send(selectedPeer.value, JSON.stringify(msg));
    } else {
      dht.value.broadcast(JSON.stringify(msg));
    }
  } catch (e) { console.error('Ping failed', e); }
}

function broadcastTest() {
  if (!dht.value) return;
  const msg = { type: 'chat', text: 'Broadcast test', from: 'tester', timestamp: Date.now() };
  try {
    dht.value.broadcast(JSON.stringify(msg));
  } catch (e) { console.error('Broadcast failed', e); }
}
</script>

<style scoped>
.kv { display:grid; grid-template-columns: 80px 1fr; gap:8px; }
</style>
