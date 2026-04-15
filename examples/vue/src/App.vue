<template>
  <div class="container">
    <header>
      <h1>🐦 PeerPigeon — Complete API Testing Suite</h1>
      <p>Comprehensive browser-based tool for testing all PeerPigeon features</p>
      <div class="peer-info">
        <span><strong>Peer ID:</strong> <code>{{ store.peerId }}</code></span>
        <span>
          <strong>Status:</strong>
          <span :class="['status', store.isConnected ? 'connected' : 'disconnected']">
            {{ store.isConnected ? 'Connected' : 'Disconnected' }}
          </span>
        </span>
        <span><strong>Peers:</strong> {{ store.networkStatus.connectedCount }}</span>
      </div>
    </header>

    <nav class="feature-tabs">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="tab-btn"
        active-class="active"
      >{{ tab.label }}</RouterLink>
    </nav>

    <!-- Global Message History -->
    <section class="global-message-history">
      <div class="card">
        <h3>📬 Message History</h3>
        <div class="message-history" ref="msgHistoryRef">
          <p v-if="store.messages.length === 0" class="empty-state">No messages yet</p>
          <div
            v-for="msg in store.messages"
            :key="msg.id"
            :class="['message-item', msg.type]"
          >
            <div class="message-header">
              <span class="message-type">{{ typeIcon(msg.type) }}</span>
              <span class="message-sender">{{ msg.fromShort }}</span>
              <span v-if="msg.encrypted" class="message-encryption">🔒</span>
              <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
            </div>
            <div class="message-content">{{ formatContent(msg.content) }}</div>
          </div>
        </div>
        <div class="button-group">
          <button class="btn tertiary" @click="store.messages.length = 0">Clear History</button>
        </div>
      </div>
    </section>

    <main>
      <RouterView />
    </main>

    <footer>
      <div class="system-log">
        <h3>System Log</h3>
        <div class="log-display" ref="sysLogRef">
          <p v-if="store.debugLogs.length === 0" class="empty-state">System log will appear here...</p>
          <div
            v-for="(log, i) in store.debugLogs"
            :key="i"
            :class="['log-entry', log.level]"
          >
            [{{ formatTime(log.timestamp) }}] {{ log.message }}
          </div>
        </div>
        <button class="btn tertiary" @click="store.debugLogs.length = 0">Clear Log</button>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import { usePeerPigeonStore } from './stores/peerpigeon.js';

const store = usePeerPigeonStore();
const msgHistoryRef = ref(null);
const sysLogRef = ref(null);

const tabs = [
  { path: '/connection', label: 'Connection' },
  { path: '/messaging', label: 'Messaging' },
  { path: '/media', label: 'Media' },
  { path: '/dht', label: 'WebDHT & Storage' },
  { path: '/crypto', label: 'Encryption' },
  { path: '/network', label: 'Network Info' },
  { path: '/testing', label: 'API Testing' },
];

function typeIcon(type) {
  const icons = { broadcast: '📢', direct: '📧', encrypted: '🔐', group: '👥', system: '⚙️' };
  return icons[type] || '💬';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

function formatContent(content) {
  if (content === null || content === undefined) return '(empty)';
  if (typeof content === 'object') return JSON.stringify(content);
  return String(content);
}

// Auto-scroll log panels
watch(() => store.messages.length, async () => {
  await nextTick();
  if (msgHistoryRef.value) msgHistoryRef.value.scrollTop = msgHistoryRef.value.scrollHeight;
});
watch(() => store.debugLogs.length, async () => {
  await nextTick();
  if (sysLogRef.value) sysLogRef.value.scrollTop = sysLogRef.value.scrollHeight;
});

onMounted(async () => {
  await store.initMesh();
});
</script>

<style>
/* ─── Reset & Base ─────────────────────────────────────────────────────────── */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #333;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

/* ─── Header ───────────────────────────────────────────────────────────────── */
header {
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 20px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.1);
}

header h1 { font-size: 24px; color: #2d3748; margin-bottom: 4px; }
header p { color: #718096; font-size: 14px; margin-bottom: 12px; }

.peer-info {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
}
.peer-info code {
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 2px 6px;
  font-family: monospace;
  font-size: 12px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: bottom;
}

/* ─── Status Badge ─────────────────────────────────────────────────────────── */
.status {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 100px;
  font-weight: 600;
  font-size: 12px;
}
.status.connected    { background: #c6f6d5; color: #276749; }
.status.disconnected { background: #fed7d7; color: #9b2335; }

/* ─── Nav Tabs ─────────────────────────────────────────────────────────────── */
.feature-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 20px;
}
.tab-btn {
  padding: 8px 16px;
  border: none;
  background: rgba(255,255,255,0.25);
  color: #fff;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  text-decoration: none;
}
.tab-btn:hover  { background: rgba(255,255,255,0.4); }
.tab-btn.active { background: #fff; color: #667eea; font-weight: 700; }

/* ─── Cards & Layout ───────────────────────────────────────────────────────── */
main { display: flex; flex-direction: column; gap: 16px; }

.card {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  margin-bottom: 16px;
}
.card h3 { font-size: 16px; color: #2d3748; margin-bottom: 14px; }
.card h4 { font-size: 14px; color: #4a5568; margin-bottom: 10px; }

.section-title {
  font-size: 20px;
  color: #fff;
  margin-bottom: 16px;
  font-weight: 700;
  text-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.description { font-size: 13px; color: #718096; margin-bottom: 12px; }

/* ─── Forms ────────────────────────────────────────────────────────────────── */
.input-group { margin-bottom: 12px; }
.input-group label { display: block; font-size: 12px; font-weight: 600; color: #4a5568; margin-bottom: 4px; }
.input-group small { display: block; font-size: 11px; color: #718096; margin-top: 2px; }

input[type="text"],
input[type="number"],
input[type="url"],
textarea,
select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 13px;
  color: #2d3748;
  background: #f7fafc;
  transition: border-color 0.2s;
  font-family: inherit;
}
input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: #667eea;
  background: #fff;
}
textarea { resize: vertical; min-height: 60px; }

.checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 12px;
}

/* ─── Buttons ──────────────────────────────────────────────────────────────── */
.button-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.primary   { background: #667eea; color: #fff; }
.btn.primary:hover:not(:disabled) { background: #5a6fd6; }
.btn.secondary { background: #48bb78; color: #fff; }
.btn.secondary:hover:not(:disabled) { background: #3da666; }
.btn.tertiary  { background: #e2e8f0; color: #4a5568; }
.btn.tertiary:hover:not(:disabled) { background: #cbd5e0; }
.btn.danger    { background: #fc8181; color: #fff; }
.btn.danger:hover:not(:disabled) { background: #f56565; }
.btn.active    { outline: 2px solid #667eea; }
.btn.small     { padding: 4px 8px; font-size: 12px; }

/* ─── Log/Activity Panels ───────────────────────────────────────────────────── */
.log-display,
.activity-log {
  height: 200px;
  overflow-y: auto;
  background: #1a202c;
  border-radius: 8px;
  padding: 12px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  margin-bottom: 8px;
}

.log-entry { padding: 2px 0; line-height: 1.5; }
.log-entry.info    { color: #90cdf4; }
.log-entry.success { color: #9ae6b4; }
.log-entry.warning { color: #fbd38d; }
.log-entry.error   { color: #fc8181; }

/* ─── Message History ─────────────────────────────────────────────────────── */
.global-message-history { margin-bottom: 16px; }

.message-history {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  background: #f7fafc;
  margin-bottom: 8px;
}

.message-item {
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 6px;
  border-left: 3px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.message-item.broadcast { border-left-color: #667eea; }
.message-item.direct    { border-left-color: #48bb78; }
.message-item.encrypted { border-left-color: #f6ad55; }

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: #718096;
}
.message-sender { font-weight: 600; font-family: monospace; }
.message-content { font-size: 13px; color: #2d3748; word-break: break-word; }

/* ─── Status Info Panels ─────────────────────────────────────────────────── */
.info-display {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  background: #f7fafc;
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 12px;
}
.info-display div { font-size: 13px; color: #4a5568; }
.info-display span { font-weight: 600; color: #2d3748; }

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.status-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #f7fafc;
  border-radius: 6px;
  padding: 10px;
  font-size: 13px;
}
.status-item label { font-weight: 600; color: #718096; font-size: 12px; }

/* ─── Peers List ─────────────────────────────────────────────────────────── */
.peers-list {
  min-height: 60px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  background: #f7fafc;
  margin-bottom: 12px;
}
.peer-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  margin-bottom: 4px;
  background: #fff;
  border: 1px solid #e2e8f0;
  font-size: 12px;
  font-family: monospace;
  gap: 8px;
}
.peer-badge { padding: 2px 8px; border-radius: 100px; font-size: 11px; font-weight: 600; }
.peer-badge.connected    { background: #c6f6d5; color: #276749; }
.peer-badge.disconnected { background: #fed7d7; color: #9b2335; }

/* ─── Result Display ─────────────────────────────────────────────────────── */
.result-display {
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
  min-height: 40px;
  margin-bottom: 8px;
}
.result-display pre {
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
}

/* ─── Media ──────────────────────────────────────────────────────────────── */
.media-preview {
  background: #1a202c;
  border-radius: 8px;
  overflow: hidden;
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}
.media-preview video {
  max-width: 100%;
  max-height: 300px;
  border-radius: 6px;
}
.media-status { color: #718096; font-size: 13px; text-align: center; padding: 20px; }

.remote-streams {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  min-height: 60px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  background: #f7fafc;
  margin-bottom: 12px;
}
.remote-stream-item {
  background: #1a202c;
  border-radius: 8px;
  overflow: hidden;
  text-align: center;
}
.remote-stream-item video { width: 100%; max-height: 180px; display: block; }
.remote-stream-label {
  color: #90cdf4;
  font-size: 11px;
  font-family: monospace;
  padding: 4px;
  background: rgba(0,0,0,0.4);
}

/* ─── Quick Networks ─────────────────────────────────────────────────────── */
.quick-networks { display: flex; flex-wrap: wrap; gap: 8px; }

/* ─── Subscriptions ──────────────────────────────────────────────────────── */
.subscriptions-list {
  min-height: 40px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 8px;
}
.subscription-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #f7fafc;
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 13px;
}

/* ─── Test Results ──────────────────────────────────────────────────────── */
.test-log {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  background: #f7fafc;
  margin-bottom: 8px;
}
.test-result {
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
  border-left: 3px solid #e2e8f0;
  background: #fff;
}
.test-result.success { border-left-color: #48bb78; }
.test-result.error   { border-left-color: #fc8181; }
.test-result.warning { border-left-color: #f6ad55; }
.test-header { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
.test-content { font-size: 12px; font-family: monospace; white-space: pre-wrap; }
.test-time { font-size: 11px; color: #718096; margin-top: 4px; }

/* ─── Peer States ─────────────────────────────────────────────────────────── */
.peer-states {
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
}
.peer-state-overview {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}
.peer-state-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 4px;
  background: #fff;
  margin-bottom: 4px;
  font-size: 12px;
  font-family: monospace;
}
.peer-state { padding: 2px 8px; border-radius: 100px; font-size: 11px; font-weight: 600; }
.peer-state.connected    { background: #c6f6d5; color: #276749; }
.peer-state.disconnected { background: #fed7d7; color: #9b2335; }
.peer-state.connecting   { background: #bee3f8; color: #2b6cb0; }
.peer-state.failed       { background: #fed7d7; color: #9b2335; }

/* ─── Connection Stats ────────────────────────────────────────────────────── */
.stats-display {
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}
.stats-item { display: flex; flex-direction: column; font-size: 13px; }
.stats-item label { font-size: 11px; color: #718096; font-weight: 600; }

/* ─── Footer ──────────────────────────────────────────────────────────────── */
footer {
  margin-top: 20px;
  background: rgba(255,255,255,0.9);
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
footer h3 { font-size: 15px; color: #2d3748; margin-bottom: 10px; }

/* ─── Fallback / Empty States ────────────────────────────────────────────── */
.empty-state {
  color: #a0aec0;
  font-style: italic;
  font-size: 13px;
  padding: 8px 0;
  text-align: center;
}

/* ─── Network Badge ──────────────────────────────────────────────────────── */
.fallback-badge {
  background: #fef3c7;
  color: #92400e;
  border-radius: 100px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 700;
  margin-left: 8px;
}

/* ─── Utility ────────────────────────────────────────────────────────────── */
.text-muted { color: #718096; }
</style>
