<template>
  <div class="grid" style="grid-template-columns: 1fr;">
    <section class="card">
      <h3>🗄️ DHT Routing Table</h3>
      <p class="small">Distributed Hash Table routing information and peer buckets</p>
      
      <div class="kv" style="margin-top: 12px;">
        <div>Node ID</div>
        <div class="code small">{{ nodeId || 'Not connected' }}</div>

        <div>Status</div>
        <div :class="connected ? 'online' : 'offline'">{{ connected ? '🟢 Connected' : '🔴 Disconnected' }}</div>

        <div>Room ID</div>
        <div class="code small">{{ roomId }}</div>
        
        <div>Total Peers</div>
        <div><strong>{{ peerList.length }}</strong> connected / <strong>{{ discoveredPeers.length }}</strong> discovered</div>
      </div>
    </section>

    <section class="card">
      <h3>📋 K-Buckets (Routing Table)</h3>
      <p class="small">Peers organized by XOR distance from this node</p>
      
      <div v-if="peerList.length === 0" class="small">No peers in routing table</div>
      <div v-else>
        <div v-for="(bucket, idx) in peerBuckets" :key="idx" class="bucket-card">
          <div class="bucket-header">
            <strong>Bucket {{ idx }}</strong>
            <span class="small">{{ bucket.length }} peer{{ bucket.length !== 1 ? 's' : '' }}</span>
          </div>
          <ul style="list-style: none; padding: 0; margin-top: 8px;">
            <li v-for="p in bucket" :key="p" class="code small" style="padding: 4px 0;">
              🟢 {{ p.substring(0, 24) }}...
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>🔍 Discovered Peers (Not Yet Connected)</h3>
      <div v-if="notConnectedPeers.length === 0" class="small">No discovered peers waiting to connect</div>
      <ul v-else style="list-style: none; padding: 0;">
        <li v-for="p in notConnectedPeers" :key="p" class="code small" style="padding: 4px 0;">
          🔵 {{ p.substring(0, 24) }}...
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { connected, nodeId, peerList, discoveredPeers, roomId } from '../dhtStore.js';

const notConnectedPeers = computed(() => {
  return discoveredPeers.value.filter(p => !peerList.value.includes(p));
});

const peerBuckets = computed(() => {
  if (!peerList.value || peerList.value.length === 0) return [];
  
  const buckets = [];
  const peersPerBucket = Math.max(1, Math.ceil(peerList.value.length / 4));
  
  for (let i = 0; i < peerList.value.length; i += peersPerBucket) {
    buckets.push(peerList.value.slice(i, i + peersPerBucket));
  }
  
  return buckets;
});
</script>

<style scoped>
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 12px; align-items: center; }
.online { color: #4ade80; font-weight: bold; }
.offline { color: #f87171; font-weight: bold; }
.bucket-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.bucket-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
