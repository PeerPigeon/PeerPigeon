<template>
  <div class="grid" style="grid-template-columns: 1fr 1fr;">
    <section class="card">
      <h3>🐛 State Overview</h3>
      <ul style="list-style:none;padding:0;">
        <li class="code small">Connected: {{ connected }}</li>
        <li class="code small">Node ID: {{ nodeId }}</li>
        <li class="code small">Room: {{ roomId }}</li>
        <li class="code small">Peers: {{ peerList.length }}</li>
        <li class="code small">Discovered: {{ discoveredPeers.length }}</li>
        <li class="code small">Messages: {{ messages.length }}</li>
        <li class="code small">Files: {{ files.length }}</li>
      </ul>
      <button class="btn" @click="exportState">Export JSON</button>
    </section>

    <section class="card">
      <h3>🧾 KV Store</h3>
      <ul v-if="Object.keys(kv).length>0" style="list-style:none;padding:0;">
        <li v-for="(v,k) in kv" :key="k" class="code small"><strong>{{ k }}</strong>: {{ v }}</li>
      </ul>
      <div v-else class="small">Empty</div>
    </section>
  </div>
</template>

<script setup>
import { connected, nodeId, roomId, peerList, discoveredPeers, messages, files, kv } from '../dhtStore.js';

function exportState() {
  const data = {
    connected: connected.value,
    nodeId: nodeId.value,
    roomId: roomId.value,
    peers: peerList.value,
    discovered: discoveredPeers.value,
    messages: messages.value,
    files: files.value,
    kv: kv.value,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'peerpigeon-debug.json';
  a.click();
  URL.revokeObjectURL(url);
}
</script>
