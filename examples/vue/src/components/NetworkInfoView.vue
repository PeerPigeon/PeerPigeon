<template>
  <div>
    <h2 class="section-title">📊 Network Information</h2>

    <!-- Network Status Overview -->
    <div class="card">
      <h3>🌐 Network Status</h3>
      <div class="status-grid">
        <div class="status-item">
          <span class="status-label">Connection</span>
          <span :class="['status-badge', store.isConnected ? 'connected' : 'disconnected']">
            {{ store.isConnected ? '✅ Connected' : '❌ Disconnected' }}
          </span>
        </div>
        <div class="status-item">
          <span class="status-label">Peer ID</span>
          <span class="status-value mono" :title="store.peerId">
            {{ store.peerId ? store.peerId.substring(0,8) + '...' + store.peerId.substring(store.peerId.length-8) : '—' }}
          </span>
        </div>
        <div class="status-item">
          <span class="status-label">Network</span>
          <span class="status-value">{{ store.networkName || '—' }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Connected Peers</span>
          <span class="status-value">{{ store.networkStatus.connectedPeers ?? 0 }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Discovered Peers</span>
          <span class="status-value">{{ store.networkStatus.discoveredPeers ?? 0 }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Accepts Peers</span>
          <span :class="['status-badge', store.networkStatus.canAcceptMore ? 'connected' : 'warning']">
            {{ store.networkStatus.canAcceptMore ? '✅ Yes' : '⚠️ At Limit' }}
          </span>
        </div>
        <div class="status-item">
          <span class="status-label">Signaling URL</span>
          <span class="status-value url">{{ store.signalingUrl || '—' }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">Uptime</span>
          <span class="status-value">{{ formatUptime(store.networkStatus.uptime) }}</span>
        </div>
      </div>
      <div class="button-group" style="margin-top:12px">
        <button class="btn secondary" @click="refresh">🔄 Refresh</button>
      </div>
    </div>

    <!-- Peer State Summary -->
    <div class="card">
      <h3>👥 Peer State Summary</h3>
      <div class="button-group" style="margin-bottom:12px">
        <button class="btn secondary" :disabled="!store.isConnected" @click="loadPeerSummary">📊 Load Summary</button>
      </div>
      <div v-if="peerSummary">
        <div class="summary-stats">
          <div class="summary-stat"><span>Total</span><strong>{{ peerSummary.total ?? 0 }}</strong></div>
          <div class="summary-stat connected"><span>Connected</span><strong>{{ peerSummary.connected ?? 0 }}</strong></div>
          <div class="summary-stat connecting"><span>Connecting</span><strong>{{ peerSummary.connecting ?? 0 }}</strong></div>
          <div class="summary-stat failed"><span>Failed</span><strong>{{ peerSummary.failed ?? 0 }}</strong></div>
          <div class="summary-stat disconnected"><span>Disconnected</span><strong>{{ peerSummary.disconnected ?? 0 }}</strong></div>
        </div>
        <div v-if="peerSummary.peers && peerSummary.peers.length" class="peer-state-list">
          <div v-for="p in peerSummary.peers" :key="p.id" class="peer-state-row">
            <span class="peer-id-short mono">{{ p.id?.substring(0,8) }}...</span>
            <span :class="['state-badge', p.state]">{{ p.state }}</span>
            <span v-if="p.latency" class="latency">{{ p.latency }}ms</span>
          </div>
        </div>
      </div>
      <p v-else class="empty-state" style="color:#718096">Click "Load Summary" to view peer states</p>
    </div>

    <!-- Connection Monitoring -->
    <div class="card">
      <h3>📡 Connection Monitoring</h3>
      <div class="button-group">
        <button class="btn primary" :disabled="!store.isConnected || store.isMonitoring" @click="startMonitoring">
          ▶ Start Monitoring
        </button>
        <button class="btn secondary" :disabled="!store.isMonitoring" @click="stopMonitoring">
          ⏹ Stop Monitoring
        </button>
        <button class="btn secondary" :disabled="!store.isConnected" @click="debugConnectivity">
          🔍 Debug Connectivity
        </button>
      </div>
      <div v-if="store.isMonitoring" class="monitoring-badge">
        <span class="pulse"></span>
        Monitoring active
      </div>
      <div v-if="store.connectionStats.length > 0" class="stats-list">
        <div v-for="(stat, i) in store.connectionStats.slice(-5)" :key="i" class="stat-row">
          <span class="stat-time">{{ formatTime(stat.timestamp) }}</span>
          <span class="stat-content">{{ formatStat(stat) }}</span>
        </div>
      </div>
    </div>

    <!-- Discovered Peers -->
    <div class="card">
      <h3>🔍 Discovered Peers ({{ store.discoveredPeers.size }})</h3>
      <p v-if="store.discoveredPeers.size === 0" class="empty-state" style="color:#718096">No peers discovered yet</p>
      <div v-else class="peer-list-grid">
        <div v-for="[pid, info] in store.discoveredPeers" :key="pid" class="discovered-peer">
          <div class="discovered-peer-id mono">{{ pid.substring(0,8) }}...{{ pid.substring(pid.length-8) }}</div>
          <div class="discovered-peer-meta">
            <span v-if="store.peers.has(pid)" class="state-badge connected">connected</span>
            <span v-else class="state-badge disconnected">known</span>
            <button class="btn-sm primary" style="margin-left:6px" @click="connectToPeer(pid)">Connect</button>
          </div>
        </div>
      </div>
    </div>

    <!-- All Known Peers -->
    <div class="card">
      <h3>👥 All Connected Peers ({{ store.peers.size }})</h3>
      <p v-if="store.peers.size === 0" class="empty-state" style="color:#718096">No peers connected</p>
      <div v-for="[pid, peer] in store.peers" :key="pid" class="peer-row">
        <div class="peer-main">
          <span class="peer-id-full mono">{{ pid }}</span>
        </div>
        <div class="peer-meta">
          <span :class="['state-badge', peer.connected ? 'connected' : 'disconnected']">
            {{ peer.connected ? 'connected' : 'disconnected' }}
          </span>
          <span class="peer-since" v-if="peer.connectedAt">since {{ formatTime(peer.connectedAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();
const peerSummary = ref(null);

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString();
}

function formatUptime(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

function formatStat(stat) {
  if (typeof stat === 'string') return stat;
  const { connected, total, timestamp, ...rest } = stat;
  return JSON.stringify(rest).substring(0, 100);
}

const refresh = async () => {
  await store.updateNetworkStatus();
};

const loadPeerSummary = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    const summary = m.getPeerStateSummary?.();
    if (summary) {
      peerSummary.value = summary;
    } else {
      const connected = m.getConnectedPeers?.() ?? [];
      const discovered = m.getDiscoveredPeers?.() ?? [];
      peerSummary.value = {
        total: Math.max(connected.length, discovered.length),
        connected: connected.length,
        connecting: 0,
        failed: 0,
        disconnected: Math.max(0, discovered.length - connected.length),
        peers: connected.map(id => ({ id, state: 'connected' }))
      };
    }
  } catch (e) {
    peerSummary.value = { error: e.message };
  }
};

const startMonitoring = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    m.startConnectionMonitoring?.();
    store.isMonitoring = true;
  } catch (e) {
    console.error(e);
  }
};

const stopMonitoring = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    m.stopConnectionMonitoring?.();
    store.isMonitoring = false;
  } catch (e) {
    console.error(e);
  }
};

const debugConnectivity = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    const result = m.debugConnectivity?.();
    if (result) {
      store.connectionStats.push({ timestamp: Date.now(), ...result });
    }
  } catch (e) {
    console.error(e);
  }
};

const connectToPeer = async (pid) => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.connectToPeer?.(pid);
  } catch (e) {
    console.error(e);
  }
};
</script>

<style scoped>
.status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.status-item { display: flex; flex-direction: column; gap: 4px; background: #1a202c; padding: 10px; border-radius: 6px; }
.status-label { color: #718096; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.status-value { color: #e2e8f0; font-size: 13px; }
.status-value.mono { font-family: monospace; font-size: 11px; }
.status-value.url { font-size: 10px; word-break: break-all; }
.summary-stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.summary-stat { text-align: center; background: #1a202c; padding: 10px 16px; border-radius: 6px; min-width: 80px; }
.summary-stat span { display: block; color: #718096; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
.summary-stat strong { color: #e2e8f0; font-size: 20px; }
.summary-stat.connected strong { color: #68d391; }
.summary-stat.connecting strong { color: #f6e05e; }
.summary-stat.failed strong { color: #fc8181; }
.peer-state-list { display: flex; flex-direction: column; gap: 4px; }
.peer-state-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; background: #1a202c; border-radius: 4px; }
.peer-id-short { color: #90cdf4; font-size: 12px; }
.latency { color: #718096; font-size: 11px; margin-left: auto; }
.state-badge { padding: 2px 8px; border-radius: 10px; font-size: 10px; text-transform: uppercase; font-weight: 600; }
.state-badge.connected { background: #276749; color: #9ae6b4; }
.state-badge.disconnected { background: #742a2a; color: #fed7d7; }
.state-badge.connecting { background: #744210; color: #fef08a; }
.state-badge.failed { background: #742a2a; color: #fc8181; }
.monitoring-badge { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: #68d391; font-size: 13px; }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: #68d391; animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.5); } }
.stats-list { margin-top: 12px; display: flex; flex-direction: column; gap: 4px; }
.stat-row { display: flex; gap: 10px; padding: 6px; background: #1a202c; border-radius: 4px; font-size: 11px; }
.stat-time { color: #718096; white-space: nowrap; }
.stat-content { color: #90cdf4; word-break: break-all; }
.peer-list-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.discovered-peer { background: #1a202c; border-radius: 6px; padding: 8px 10px; }
.discovered-peer-id { font-size: 11px; color: #90cdf4; margin-bottom: 4px; }
.discovered-peer-meta { display: flex; align-items: center; gap: 6px; }
.peer-row { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: #1a202c; border-radius: 6px; margin-bottom: 6px; }
.peer-main .mono { font-size: 10px; word-break: break-all; color: #90cdf4; }
.peer-meta { display: flex; align-items: center; gap: 8px; }
.peer-since { font-size: 10px; color: #718096; }
.btn-sm { padding: 2px 8px; font-size: 11px; border-radius: 4px; cursor: pointer; border: none; }
.btn-sm.primary { background: #2b6cb0; color: #bee3f8; }
</style>
