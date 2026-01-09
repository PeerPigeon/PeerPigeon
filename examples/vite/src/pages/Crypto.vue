<template>
  <div class="grid" style="grid-template-columns: 1fr 1fr;">
    <section class="card">
      <h3>🔐 Encryption</h3>
      <p class="small">Enable AES-GCM chat encryption using the deterministic room key.</p>
      <div class="kv" style="margin-top: 12px;">
        <div>Status</div>
        <div :class="encryptionEnabled ? 'online' : 'offline'">{{ encryptionEnabled ? 'Enabled' : 'Disabled' }}</div>
        <div>Room</div>
        <div class="code small">{{ roomId }}</div>
      </div>
      <button class="btn primary" @click="toggle">{{ encryptionEnabled ? 'Disable' : 'Enable' }} Encryption</button>
    </section>

    <section class="card">
      <h3>🔎 Details</h3>
      <div class="small">Messages sent from Messaging page will use type <strong>chat-enc</strong> when encryption is enabled.</div>
      <div class="small" style="margin-top: 8px;">Other peers must also enable encryption to read encrypted messages.</div>
    </section>
  </div>
</template>

<script setup>
import { encryptionEnabled, roomId } from '../dhtStore.js';

function toggle() {
  encryptionEnabled.value = !encryptionEnabled.value;
}
</script>

<style scoped>
.kv { display: grid; grid-template-columns: 80px 1fr; gap: 8px; }
.online { color: #4ade80; font-weight: bold; }
.offline { color: #f87171; font-weight: bold; }
</style>
