<template>
  <div class="grid" style="grid-template-columns: 1fr;">
    <div v-if="connected" class="status-banner connected-banner">
      ✅ Connected to mesh • {{ peerList.length }} peer{{ peerList.length !== 1 ? 's' : '' }} • Room: {{ roomId }}
    </div>
    <div v-else class="status-banner disconnected-banner">
      ⚠️ Not connected • Go to Network page to connect
    </div>
    
    <section class="card">
      <h3>💬 P2P Messaging</h3>
      <p class="small">Send messages directly to connected peers</p>

      <div v-if="connected">
        <div class="kv" style="margin-top: 12px;">
          <div>Connected Peers</div>
          <div><strong>{{ peerList.length }}</strong></div>
        </div>

        <div style="margin-top: 16px;">
          <label style="display: block; margin-bottom: 4px; font-size: 14px;">Send to Peer:</label>
          <select v-model="selectedPeer" class="select" style="width: 100%;">
            <option value="">Broadcast to all</option>
            <option v-for="peer in peerList" :key="peer" :value="peer">
              {{ peer.substring(0, 16) }}...
            </option>
          </select>
        </div>

        <div style="margin-top: 16px;">
          <label style="display: block; margin-bottom: 4px; font-size: 14px;">Message:</label>
          <textarea 
            v-model="message" 
            class="input" 
            style="width: 100%; min-height: 80px; resize: vertical;"
            placeholder="Type your message..."
            @keydown.ctrl.enter="sendMessage"
          ></textarea>
        </div>

        <button class="btn primary" @click="sendMessage" :disabled="!message.trim()" style="margin-top: 8px;">
          Send Message (Ctrl+Enter)
        </button>

        <div style="margin-top: 24px;">
          <h4>Messages</h4>
          <div v-if="messages.length === 0" class="small">No messages yet</div>
          <div v-else style="max-height: 300px; overflow-y: auto;">
            <div v-for="(msg, i) in messages" :key="i" class="card" style="margin-bottom: 8px; padding: 8px; display: flex; gap: 8px;">
              <div style="font-size: 20px;">{{ msg.from === nodeId ? '🟢' : '🔵' }}</div>
              <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <strong :style="{ color: msg.from === nodeId ? '#10b981' : '#3b82f6' }">
                      {{ msg.from === nodeId ? 'You' : msg.from.substring(0, 8) + '...' }}
                    </strong>
                    <span style="font-size: 14px;">{{ msg.encrypted ? '🔒' : '🔓' }}</span>
                  </div>
                  <span class="small">{{ msg.time }}</span>
                </div>
                <div>{{ msg.text }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { dht, connected, nodeId, peerList, messages, encryptionEnabled, encryptChat, roomId } from '../dhtStore.js';

const selectedPeer = ref('');
const message = ref('');

function pushLocal(msg) {
  messages.value.push({
    from: msg.from,
    text: msg.text,
    time: new Date(msg.timestamp).toLocaleTimeString(),
    encrypted: msg.encrypted || false
  });
}

async function sendMessage() {
  if (!message.value.trim() || !dht.value) return;

  const plain = message.value.trim();
  const base = { from: nodeId.value, timestamp: Date.now() };
  let outgoing;
  
  if (encryptionEnabled.value) {
    const payload = await encryptChat(plain);
    outgoing = { type: 'chat-enc', payload, ...base };
  } else {
    outgoing = { type: 'chat', text: plain, ...base };
  }

  try {
    if (selectedPeer.value) {
      dht.value.send(selectedPeer.value, JSON.stringify(outgoing));
    } else {
      dht.value.broadcast(JSON.stringify(outgoing));
    }
    pushLocal({ from: base.from, text: plain, timestamp: base.timestamp, encrypted: encryptionEnabled.value });
  } catch (err) {
    console.error('Send failed', err);
  }

  message.value = '';
}
</script>
