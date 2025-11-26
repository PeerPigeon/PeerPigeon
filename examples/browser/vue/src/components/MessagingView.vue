<template>
  <div class="messaging-view">
    <div class="section-header">
      <h2>💬 Messaging System</h2>
      <p>Send broadcast messages via gossip protocol and direct peer-to-peer messages</p>
    </div>

    <div class="messaging-layout">
      <!-- Broadcast Messages Section -->
      <div class="broadcast-section">
        <h3>🌐 Broadcast Messages (Gossip Protocol)</h3>
        <p class="section-description">
          Messages sent via gossip protocol reach all peers in the network, not just direct connections.
          They propagate with TTL (Time To Live) and path tracking to prevent loops.
        </p>
        
        <div class="message-composer">
          <div class="composer-header">
            <span class="composer-icon">📢</span>
            <span>Broadcast to all peers</span>
          </div>
          <div class="composer-controls">
            <textarea
              v-model="broadcastMessage"
              placeholder="Type your message to broadcast to all peers..."
              class="message-input"
              rows="3"
              @keydown.ctrl.enter="sendBroadcast"
            ></textarea>
            <div class="composer-actions">
              <button 
                @click="sendBroadcast"
                :disabled="!broadcastMessage.trim() || !isConnected"
                class="btn btn-primary"
              >
                <span class="btn-icon">📤</span>
                Send Broadcast
              </button>
              <span class="shortcut-hint">Ctrl+Enter</span>
            </div>
          </div>
        </div>

        <div class="messages-container">
          <div class="messages-header">
            <h4>Recent Broadcasts ({{ messages.length }})</h4>
            <button @click="clearBroadcastMessages" class="btn btn-secondary btn-sm">
              Clear
            </button>
          </div>
          
          <div class="messages-list">
            <div v-if="messages.length === 0" class="empty-state">
              <div class="empty-icon">📭</div>
              <p>No broadcast messages yet</p>
              <p class="empty-meta">Send a message or wait for messages from other peers</p>
            </div>
            
            <div 
              v-for="message in reversedMessages" 
              :key="message.id"
              :class="['message-item', { 'own-message': message.fromPeerId === 'You' }]"
            >
              <div class="message-header">
                <span class="message-sender">{{ message.fromPeerId }}</span>
                <span class="message-time">{{ formatTime(message.timestamp) }}</span>
                <span class="message-type">
                  {{ message.type }}
                  <span v-if="message.encrypted" class="encryption-indicator" title="Encrypted message">🔒</span>
                </span>
              </div>
              <div class="message-content">
                <pre>{{ formatMessageContent(message.content) || '[Empty message]' }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Direct Messages Section -->
      <div class="direct-section">
        <h3>💌 Direct Messages</h3>
        <p class="section-description">
          Send messages directly to specific peers. Messages are routed through the mesh network.
        </p>
        
        <!-- Peer Selection -->
        <div class="peer-selector">
          <label>Select target peer:</label>
          <select v-model="selectedPeer" class="peer-select">
            <option value="">Choose a peer...</option>
            <option 
              v-for="peer in connectedPeersList" 
              :key="peer.id"
              :value="peer.id"
            >
              {{ peer.id.substring(0, 16) }}... ({{ peer.status }})
            </option>
          </select>
        </div>

        <div class="message-composer" v-if="selectedPeer">
          <div class="composer-header">
            <span class="composer-icon">💌</span>
            <span>Direct message to {{ selectedPeer.substring(0, 16) }}...</span>
          </div>
          <div class="composer-controls">
            <textarea
              v-model="directMessage"
              placeholder="Type your direct message..."
              class="message-input"
              rows="3"
              @keydown.ctrl.enter="sendDirect"
            ></textarea>
            <div class="composer-actions">
              <div class="encrypt-toggle">
                <label class="checkbox-label">
                  <input type="checkbox" v-model="encryptDirect" />
                  Encrypt Direct Message
                </label>
              </div>
              <div class="composer-buttons">
                <button 
                  @click="sendDirect"
                  :disabled="!directMessage.trim() || !selectedPeer || !isConnected"
                  class="btn btn-primary"
                >
                  <span class="btn-icon">📤</span>
                  {{ encryptDirect ? 'Send Encrypted' : 'Send Direct' }}
                </button>
              </div>
              <span class="shortcut-hint">Ctrl+Enter</span>
            </div>
          </div>
        </div>

        <!-- Direct Message Conversations -->
        <div class="conversations">
          <div class="conversations-header">
            <h4>Conversations</h4>
          </div>
          
          <div v-if="directMessagesList.length === 0" class="empty-state">
            <div class="empty-icon">💬</div>
            <p>No direct messages yet</p>
            <p class="empty-meta">Select a peer and send a direct message</p>
          </div>
          
          <div 
            v-for="conversation in directMessagesList" 
            :key="conversation.peerId"
            class="conversation"
          >
            <div class="conversation-header">
              <h5>{{ conversation.peerId.substring(0, 16) }}...</h5>
              <span class="message-count">({{ conversation.messages.length }})</span>
            </div>
            
            <div class="conversation-messages">
              <div 
                v-for="message in conversation.messages.slice(-5)" 
                :key="message.id"
                :class="['message-item', 'direct', { 'own-message': message.fromPeerId === 'You' }]"
              >
                <div class="message-header">
                  <span class="message-sender">
                    {{ message.fromPeerId }}
                    <span v-if="message.encrypted" class="encryption-indicator" title="Encrypted message">🔒</span>
                  </span>
                  <span class="message-time">{{ formatTime(message.timestamp) }}</span>
                </div>
                <div class="message-content">
                  <pre>{{ formatMessageContent(message.content) }}</pre>
                </div>
              </div>
              
              <div v-if="conversation.messages.length > 5" class="more-messages">
                + {{ conversation.messages.length - 5 }} more messages
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Message Statistics -->
    <div class="stats-section">
      <h3>📊 Messaging Statistics</h3>
      <div class="stats-grid">
        <div class="stat-item">
          <strong>Total Broadcasts:</strong>
          <span>{{ broadcastCount }}</span>
        </div>
        <div class="stat-item">
          <strong>Total Direct Messages:</strong>
          <span>{{ directMessageCount }}</span>
        </div>
        <div class="stat-item">
          <strong>Active Conversations:</strong>
          <span>{{ directMessagesList.length }}</span>
        </div>
        <div class="stat-item">
          <strong>Messages Sent:</strong>
          <span>{{ sentMessageCount }}</span>
        </div>
      </div>
    </div>

    <!-- Advanced Messaging Features -->
    <div class="advanced-section">
      <h3>🔧 Advanced Messaging</h3>
      
      <div class="advanced-controls">
        <button @click="sendPingAll" class="btn btn-secondary">
          <span class="btn-icon">🏓</span>
          Ping All Peers
        </button>
        
        <button @click="sendSystemInfo" class="btn btn-secondary">
          <span class="btn-icon">ℹ️</span>
          Broadcast System Info
        </button>
        
        <button @click="testMessageTypes" class="btn btn-secondary">
          <span class="btn-icon">🧪</span>
          Test Message Types
        </button>
        
        <button @click="enableMessageFiltering" class="btn btn-secondary">
          <span class="btn-icon">🔍</span>
          Toggle Message Filtering
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

// Local reactive state
const broadcastMessage = ref('');
const directMessage = ref('');
const selectedPeer = ref('');
const messageFilter = ref('');
const filteringEnabled = ref(false);
const encryptDirect = ref(false);

// Computed properties
const messages = computed(() => store.messages);
const directMessages = computed(() => store.directMessages);
const connectedPeersList = computed(() => store.connectedPeersList);
const isConnected = computed(() => store.isConnected);

const reversedMessages = computed(() => {
  return [...messages.value].reverse();
});

const directMessagesList = computed(() => {
  const conversations = [];
  for (const [peerId, msgs] of directMessages.value) {
    conversations.push({
      peerId,
      messages: msgs,
      lastMessage: msgs[msgs.length - 1]
    });
  }
  return conversations.sort((a, b) => 
    new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp)
  );
});

const broadcastCount = computed(() => {
  return messages.value.filter(msg => msg.type === 'broadcast').length;
});

const directMessageCount = computed(() => {
  let count = 0;
  for (const msgs of directMessages.value.values()) {
    count += msgs.length;
  }
  return count;
});

const sentMessageCount = computed(() => {
  const broadcastSent = messages.value.filter(msg => msg.fromPeerId === 'You').length;
  let directSent = 0;
  for (const msgs of directMessages.value.values()) {
    directSent += msgs.filter(msg => msg.fromPeerId === 'You').length;
  }
  return broadcastSent + directSent;
});

// Methods
const sendBroadcast = () => {
  if (!broadcastMessage.value.trim() || !isConnected.value) return;
  
  try {
    store.sendBroadcastMessage(broadcastMessage.value.trim());
    broadcastMessage.value = '';
    store.addDebugLog('Broadcast message sent successfully', 'success');
  } catch (error) {
    store.addDebugLog(`Failed to send broadcast: ${error.message}`, 'error');
  }
};

const sendDirect = () => {
  if (!directMessage.value.trim() || !selectedPeer.value || !isConnected.value) return;
  
  try {
    if (encryptDirect.value) {
      store.sendEncryptedDirectMessage(selectedPeer.value, directMessage.value.trim());
    } else {
      store.sendDirectMessage(selectedPeer.value, directMessage.value.trim());
    }
    directMessage.value = '';
    store.addDebugLog(`Direct message sent to ${selectedPeer.value.substring(0, 8)}...`, 'success');
  } catch (error) {
    store.addDebugLog(`Failed to send direct message: ${error.message}`, 'error');
  }
};

const clearBroadcastMessages = () => {
  store.messages = [];
  store.addDebugLog('Broadcast messages cleared', 'info');
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString();
};

const formatMessageContent = (content) => {
  if (typeof content === 'string') {
    return content;
  }
  return JSON.stringify(content, null, 2);
};

const sendPingAll = () => {
  const pingMessage = {
    type: 'ping',
    timestamp: Date.now(),
    source: 'vue-demo'
  };
  
  store.sendBroadcastMessage(pingMessage);
  store.addDebugLog('Ping sent to all peers', 'info');
};

const sendSystemInfo = () => {
  const systemInfo = {
    type: 'system_info',
    timestamp: Date.now(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    online: navigator.onLine,
    connectionType: navigator.connection?.effectiveType || 'unknown',
    peerId: store.peerId.substring(0, 8) + '...',
    connectedPeers: store.networkStatus.connectedCount
  };
  
  store.sendBroadcastMessage(systemInfo);
  store.addDebugLog('System info broadcast sent', 'info');
};

const testMessageTypes = () => {
  const testMessages = [
    { type: 'text', content: 'Simple text message' },
    { type: 'json', data: { key: 'value', number: 42, array: [1, 2, 3] } },
    { type: 'binary_info', size: 1024, encoding: 'base64' },
    { type: 'event', event: 'user_action', action: 'click', target: 'button' }
  ];
  
  testMessages.forEach((msg, index) => {
    setTimeout(() => {
      store.sendBroadcastMessage(msg);
    }, index * 500);
  });
  
  store.addDebugLog('Test messages sent', 'info');
};

const enableMessageFiltering = () => {
  filteringEnabled.value = !filteringEnabled.value;
  store.addDebugLog(`Message filtering ${filteringEnabled.value ? 'enabled' : 'disabled'}`, 'info');
};
</script>

<style scoped>
.messaging-view {
  max-width: 1200px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 30px;
}

.section-header h2 {
  font-size: 28px;
  color: #333;
  margin-bottom: 8px;
}

.section-header p {
  color: #666;
  font-size: 16px;
}

.messaging-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
  margin-bottom: 30px;
}

.broadcast-section,
.direct-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.broadcast-section h3,
.direct-section h3 {
  margin: 0 0 8px 0;
  color: #333;
  font-size: 20px;
}

.section-description {
  color: #666;
  font-size: 14px;
  margin-bottom: 20px;
  line-height: 1.5;
}

.message-composer {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.composer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 500;
  color: #333;
}

.composer-icon {
  font-size: 16px;
}

.composer-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-input {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
  min-height: 80px;
}

.message-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.composer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-secondary {
  background: #6b7280;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background: #4b5563;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 12px;
}

.btn-icon {
  font-size: 14px;
}

.shortcut-hint {
  font-size: 12px;
  color: #999;
}

.messages-container {
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
}

.messages-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #eee;
}

.messages-header h4 {
  margin: 0;
  font-size: 14px;
  color: #333;
}

.messages-list {
  max-height: 400px;
  overflow-y: auto;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
}

.empty-meta {
  font-size: 12px;
  color: #999;
}

.message-item {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.message-item:last-child {
  border-bottom: none;
}

.message-item.own-message {
  background: rgba(59, 130, 246, 0.05);
}

.message-item.direct {
  background: rgba(16, 185, 129, 0.05);
}

.message-item.direct.own-message {
  background: rgba(59, 130, 246, 0.1);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
}

.message-sender {
  font-weight: 500;
  color: #333;
}

.message-time {
  color: #999;
}

.message-type {
  background: #e5e7eb;
  color: #374151;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  text-transform: uppercase;
}

.message-content {
  color: #333;
  line-height: 1.4;
}

.message-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}

.peer-selector {
  margin-bottom: 20px;
}

.peer-selector label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #333;
  font-size: 14px;
}

.peer-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  background: white;
}

.conversations {
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
}

.conversations-header {
  padding: 12px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #eee;
}

.conversations-header h4 {
  margin: 0;
  font-size: 14px;
  color: #333;
}

.conversation {
  border-bottom: 1px solid #eee;
}

.conversation:last-child {
  border-bottom: none;
}

.conversation-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
}

.conversation-header h5 {
  margin: 0;
  font-size: 13px;
  color: #333;
  font-family: monospace;
}

.message-count {
  font-size: 11px;
  color: #999;
}

.conversation-messages {
  background: white;
}

.more-messages {
  padding: 8px 16px;
  font-size: 11px;
  color: #999;
  text-align: center;
  background: #f8f9fa;
  border-top: 1px solid #f0f0f0;
}

.stats-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.stats-section h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #eee;
}

.stat-item:last-child {
  border-bottom: none;
}

.advanced-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.advanced-section h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.advanced-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* Encryption indicator styling */
.encryption-indicator {
  display: inline-block;
  margin-left: 4px;
  font-size: 12px;
  opacity: 0.8;
  vertical-align: middle;
}

/* Responsive design */
@media (max-width: 768px) {
  .messaging-layout {
    grid-template-columns: 1fr;
  }
  
  .advanced-controls {
    flex-direction: column;
  }
  
  .composer-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  
  .shortcut-hint {
    text-align: center;
  }
}
</style>
