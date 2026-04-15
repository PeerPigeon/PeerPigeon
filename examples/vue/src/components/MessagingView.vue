<template>
  <div>
    <h2 class="section-title">💬 Messaging & Communication</h2>

    <!-- Broadcast -->
    <div class="card">
      <h3>📢 Broadcast Messages</h3>
      <p class="description">Send messages to all connected peers in the mesh</p>
      <div class="input-group">
        <label>Broadcast Message:</label>
        <textarea v-model="broadcastMsg" placeholder="Enter your broadcast message..." rows="3"
          @keydown.enter.exact.prevent="sendBroadcast" />
      </div>
      <div class="checkbox-group">
        <label><input v-model="encryptBroadcast" type="checkbox" /> Encrypt Message</label>
      </div>
      <div class="button-group">
        <button class="btn primary" :disabled="!store.isConnected" @click="sendBroadcast">
          📢 Send Broadcast
        </button>
      </div>
      <p v-if="broadcastError" class="error-msg">{{ broadcastError }}</p>
    </div>

    <!-- Direct Messages -->
    <div class="card">
      <h3>📧 Direct Messages</h3>
      <p class="description">Send private messages to specific peers</p>
      <div class="input-group">
        <label>Target Peer:</label>
        <select v-model="selectedPeer">
          <option value="">Select a connected peer...</option>
          <option v-for="peer in connectedPeers" :key="peer.id" :value="peer.id">
            {{ peer.id.substring(0,8) }}...{{ peer.id.substring(peer.id.length-8) }}
          </option>
        </select>
        <input v-model="manualTargetPeer" type="text" placeholder="Or enter peer ID manually"
               style="margin-top:6px;" />
      </div>
      <div class="input-group">
        <label>Private Message:</label>
        <textarea v-model="directMsg" placeholder="Enter your direct message..." rows="3"
          @keydown.enter.exact.prevent="sendDirect" />
      </div>
      <div class="checkbox-group">
        <label><input v-model="encryptDirect" type="checkbox" /> Encrypt Message</label>
      </div>
      <div class="button-group">
        <button class="btn primary" :disabled="!store.isConnected" @click="sendDirect">
          📧 Send Direct Message
        </button>
      </div>
      <p v-if="directError" class="error-msg">{{ directError }}</p>
    </div>

    <!-- Direct Messages History per peer -->
    <div class="card" v-for="[pid, msgs] in store.directMessages" :key="pid">
      <h3>📧 DM Thread: {{ pid.substring(0,8) }}...</h3>
      <div class="message-history" style="max-height:160px;overflow-y:auto;">
        <div v-for="msg in msgs" :key="msg.id" class="message-item direct">
          <div class="message-header">
            <span class="message-type">📧</span>
            <span class="message-sender">{{ msg.fromShort }}</span>
            <span v-if="msg.encrypted" class="message-encryption">🔒</span>
            <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
          </div>
          <div class="message-content">{{ formatContent(msg.content) }}</div>
        </div>
      </div>
    </div>

    <!-- Outgoing log -->
    <div class="card">
      <h3>📨 Message Activity</h3>
      <div class="activity-log">
        <p v-if="sentLog.length === 0" class="empty-state" style="color:#90cdf4">No sent messages yet</p>
        <div v-for="(entry, i) in sentLog" :key="i" class="log-entry info">{{ entry }}</div>
      </div>
      <button class="btn tertiary" @click="sentLog.length = 0">Clear</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

const broadcastMsg = ref('');
const directMsg = ref('');
const selectedPeer = ref('');
const manualTargetPeer = ref('');
const encryptBroadcast = ref(false);
const encryptDirect = ref(false);
const broadcastError = ref('');
const directError = ref('');
const sentLog = ref([]);

const connectedPeers = computed(() =>
  Array.from(store.peers.values()).filter(p => p.connected)
);

function ts() { return new Date().toLocaleTimeString(); }
function formatTime(ts) { return new Date(ts).toLocaleTimeString(); }
function formatContent(c) {
  if (c === null || c === undefined) return '(empty)';
  if (typeof c === 'object') return JSON.stringify(c);
  return String(c);
}

const sendBroadcast = async () => {
  broadcastError.value = '';
  const text = broadcastMsg.value.trim();
  if (!text) { broadcastError.value = 'Please enter a message'; return; }

  const m = store.mesh;
  if (!m) { broadcastError.value = 'Not initialized'; return; }

  try {
    let id;
    if (encryptBroadcast.value) {
      id = await m.sendEncryptedBroadcast(text);
    } else {
      id = m.sendMessage(text);
    }

    if (id) {
      sentLog.value.push(`[${ts()}] 📢 Broadcast sent (${encryptBroadcast.value ? 'encrypted' : 'plain'}): ${text.substring(0,60)}`);
      store.messages.push({
        id: id,
        content: text,
        from: store.peerId,
        timestamp: new Date(),
        type: encryptBroadcast.value ? 'encrypted' : 'broadcast',
        fromShort: 'You',
        encrypted: encryptBroadcast.value
      });
      broadcastMsg.value = '';
    } else {
      broadcastError.value = 'Failed to send — not connected?';
    }
  } catch (e) {
    broadcastError.value = e.message;
  }
};

const sendDirect = async () => {
  directError.value = '';
  const target = selectedPeer.value || manualTargetPeer.value.trim();
  const text = directMsg.value.trim();
  if (!target) { directError.value = 'Please select or enter a target peer'; return; }
  if (!text) { directError.value = 'Please enter a message'; return; }

  const m = store.mesh;
  if (!m) { directError.value = 'Not initialized'; return; }

  try {
    let id;
    if (encryptDirect.value && m.cryptoManager) {
      id = await m.sendEncryptedMessage(target, text);
      sentLog.value.push(`[${ts()}] 🔒 Encrypted DM to ${target.substring(0,8)}...: ${text.substring(0,60)}`);
    } else {
      id = m.sendDirectMessage(target, text);
      sentLog.value.push(`[${ts()}] 📧 DM to ${target.substring(0,8)}...: ${text.substring(0,60)}`);
    }

    if (id) {
      store.messages.push({
        id,
        content: `→ ${target.substring(0,8)}...: ${text}`,
        from: store.peerId,
        timestamp: new Date(),
        type: 'direct',
        fromShort: 'You',
        encrypted: encryptDirect.value
      });
      directMsg.value = '';
    } else {
      directError.value = 'Failed to send — peer not reachable?';
    }
  } catch (e) {
    directError.value = e.message;
  }
};
</script>

<style scoped>
.error-msg { color: #c53030; font-size: 12px; margin-top: 4px; }
</style>
