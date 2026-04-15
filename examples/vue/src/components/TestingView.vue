<template>
  <div>
    <h2 class="section-title">🧪 API Testing & Utilities</h2>

    <!-- Peer ID Validation -->
    <div class="card">
      <h3>🔍 Peer ID Validation</h3>
      <div class="input-group">
        <label>Peer ID to validate:</label>
        <input v-model="validateInput" type="text" placeholder="Enter peer ID..." />
      </div>
      <div class="button-group">
        <button class="btn primary" @click="validatePeerId">✅ Validate</button>
      </div>
      <div v-if="validateResult !== null" :class="['result-badge', validateResult.valid ? 'success' : 'fail']">
        {{ validateResult.valid ? '✅ Valid peer ID' : '❌ Invalid: ' + validateResult.reason }}
      </div>
    </div>

    <!-- Mesh Utilities -->
    <div class="card">
      <h3>🛠️ Mesh Utilities</h3>
      <div class="button-group">
        <button class="btn secondary" :disabled="!store.isConnected" @click="forceConnectAll">
          🔌 Force Connect All
        </button>
        <button class="btn secondary" :disabled="!store.isConnected" @click="cleanupStale">
          🧹 Cleanup Stale
        </button>
        <button class="btn danger" :disabled="!store.isConnected" @click="hardReset">
          ⚠️ Hard Reset
        </button>
      </div>
    </div>

    <!-- Performance Test -->
    <div class="card">
      <h3>⚡ Performance Test</h3>
      <p class="description">Send a burst of messages and measure throughput</p>
      <div class="form-row">
        <div class="form-group">
          <label>Message Count:</label>
          <input v-model.number="perfCount" type="number" min="1" max="1000" style="width:100px" />
        </div>
        <div class="form-group">
          <label>Message Size (chars):</label>
          <input v-model.number="perfSize" type="number" min="1" max="10000" style="width:100px" />
        </div>
      </div>
      <div class="button-group">
        <button class="btn primary" :disabled="!store.isConnected || perfRunning" @click="runPerfTest">
          {{ perfRunning ? '⏳ Running...' : '▶ Run Test' }}
        </button>
      </div>
      <div v-if="perfResult" class="perf-result">
        <div class="perf-stat"><span>Messages Sent</span><strong>{{ perfResult.sent }}</strong></div>
        <div class="perf-stat"><span>Duration</span><strong>{{ perfResult.duration }}ms</strong></div>
        <div class="perf-stat"><span>Throughput</span><strong>{{ perfResult.rate }} msg/s</strong></div>
        <div class="perf-stat"><span>Data</span><strong>{{ perfResult.bytes }} bytes</strong></div>
      </div>
    </div>

    <!-- Stress Test -->
    <div class="card">
      <h3>💥 Stress Test</h3>
      <p class="description">Concurrently sends 20 DHT records + 50 broadcast messages</p>
      <div class="button-group">
        <button class="btn primary" :disabled="!store.isConnected || stressRunning" @click="runStressTest">
          {{ stressRunning ? '⏳ Running...' : '💥 Run Stress Test' }}
        </button>
      </div>
      <div v-if="stressResult" class="perf-result">
        <div class="perf-stat"><span>DHT Puts</span><strong>{{ stressResult.dhtPuts }}</strong></div>
        <div class="perf-stat"><span>Messages</span><strong>{{ stressResult.messages }}</strong></div>
        <div class="perf-stat"><span>Errors</span><strong>{{ stressResult.errors }}</strong></div>
        <div class="perf-stat"><span>Duration</span><strong>{{ stressResult.duration }}ms</strong></div>
      </div>
    </div>

    <!-- Error Test Cases -->
    <div class="card">
      <h3>🚨 Error Tests</h3>
      <p class="description">Test error handling and edge cases</p>
      <div class="button-group">
        <button class="btn secondary" @click="testInvalidPeer">Invalid Peer Connect</button>
        <button class="btn secondary" @click="testMalformedMsg">Malformed Message</button>
        <button class="btn secondary" @click="testDHTLimits">DHT Limits</button>
        <button class="btn secondary" @click="testEncryptNoKey">Encrypt (No Key)</button>
      </div>
    </div>

    <!-- Log Export -->
    <div class="card">
      <h3>📤 Export Logs</h3>
      <div class="button-group">
        <button class="btn secondary" @click="exportLogs">📥 Export All Logs (JSON)</button>
        <button class="btn tertiary" @click="store.debugLogs.splice(0)">Clear Debug Logs</button>
      </div>
    </div>

    <!-- Test Results -->
    <div class="card">
      <h3>📋 Test Results</h3>
      <div class="activity-log">
        <p v-if="store.testResults.length === 0" class="empty-state" style="color:#90cdf4">No test results yet</p>
        <div v-for="(r, i) in store.testResults" :key="i" :class="['log-entry', r.level ?? (r.pass ? 'success' : 'error')]">
          <span class="result-indicator">{{ r.pass ? '✅' : '❌' }}</span>
          {{ r.name }}: {{ r.message }}
        </div>
      </div>
      <button class="btn tertiary" @click="store.testResults.splice(0)">Clear</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

const validateInput = ref('');
const validateResult = ref(null);
const perfCount = ref(50);
const perfSize = ref(100);
const perfRunning = ref(false);
const perfResult = ref(null);
const stressRunning = ref(false);
const stressResult = ref(null);

function addResult(name, pass, message, level = null) {
  store.testResults.push({
    name,
    pass,
    message,
    level: level ?? (pass ? 'success' : 'error'),
    timestamp: Date.now()
  });
}

const validatePeerId = () => {
  const id = validateInput.value.trim();
  if (!id) { validateResult.value = { valid: false, reason: 'Empty input' }; return; }
  try {
    // Import might not expose static method — try both paths
    const PeerPigeonMesh = store.mesh?.constructor;
    let valid = false;
    let reason = 'Unknown';
    if (PeerPigeonMesh?.validatePeerId) {
      valid = PeerPigeonMesh.validatePeerId(id);
      reason = valid ? 'OK' : 'Format invalid';
    } else {
      // Basic fallback: SHA-256 hex or UUID-like 64 char hex
      valid = /^[a-f0-9]{64}$/i.test(id) || /^[a-f0-9-]{36,}$/i.test(id) || id.length > 8;
      reason = valid ? 'Appears valid' : 'Too short or invalid characters';
    }
    validateResult.value = { valid, reason };
    addResult('validatePeerId', valid, `"${id.substring(0,20)}..." → ${valid}`);
  } catch (e) {
    validateResult.value = { valid: false, reason: e.message };
    addResult('validatePeerId', false, e.message);
  }
};

const forceConnectAll = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.forceConnectToAllPeers?.();
    addResult('forceConnectAll', true, 'Triggered successfully');
    store.addDebugLog('🔌 Force connect all triggered', 'info');
  } catch (e) {
    addResult('forceConnectAll', false, e.message);
  }
};

const cleanupStale = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.cleanupStaleSignalingData?.();
    addResult('cleanupStale', true, 'Stale data cleaned up');
    store.addDebugLog('🧹 Stale signaling data cleaned', 'info');
  } catch (e) {
    addResult('cleanupStale', false, e.message);
  }
};

const hardReset = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.hardReset?.('manual-reset');
    addResult('hardReset', true, 'Hard reset completed');
    store.addDebugLog('⚠️ Hard reset triggered', 'warning');
  } catch (e) {
    addResult('hardReset', false, e.message);
  }
};

const runPerfTest = async () => {
  const m = store.mesh;
  if (!m) return;
  perfRunning.value = true;
  perfResult.value = null;

  const payload = 'x'.repeat(perfSize.value);
  const count = perfCount.value;
  let sent = 0;
  const start = performance.now();

  for (let i = 0; i < count; i++) {
    try {
      const id = m.sendMessage(`perf-test:${i}:${payload}`);
      if (id) sent++;
    } catch (e) {
      // ignore individual send errors
    }
  }

  const duration = Math.round(performance.now() - start);
  const rate = duration > 0 ? Math.round((sent / duration) * 1000) : sent;
  const bytes = sent * (9 + payload.length);

  perfResult.value = { sent, duration, rate, bytes };
  addResult('performanceTest', true, `${sent}/${count} sent at ${rate} msg/s (${duration}ms)`);
  perfRunning.value = false;
};

const runStressTest = async () => {
  const m = store.mesh;
  if (!m) return;
  stressRunning.value = true;
  stressResult.value = null;

  let dhtPuts = 0, messages = 0, errors = 0;
  const start = performance.now();

  const allPromises = [];

  // 20 DHT puts
  for (let i = 0; i < 20; i++) {
    allPromises.push(
      m.dhtPut(`stress-key-${i}`, { value: i, ts: Date.now() })
        .then(() => dhtPuts++)
        .catch(() => errors++)
    );
  }

  // 50 messages
  for (let i = 0; i < 50; i++) {
    try {
      const id = m.sendMessage(`stress-msg-${i}`);
      if (id) messages++;
    } catch { errors++; }
  }

  await Promise.allSettled(allPromises);
  const duration = Math.round(performance.now() - start);

  stressResult.value = { dhtPuts, messages, errors, duration };
  addResult('stressTest', errors < 5, `DHT: ${dhtPuts}, Msgs: ${messages}, Errors: ${errors} (${duration}ms)`);
  stressRunning.value = false;
};

const testInvalidPeer = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    await m.connectToPeer?.('not-a-valid-peer-id-12345');
    addResult('invalidPeer', false, 'Expected error but none thrown');
  } catch (e) {
    addResult('invalidPeer', true, `Correctly rejected: ${e.message.substring(0,60)}`);
  }
};

const testMalformedMsg = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    const id = m.sendMessage(null);
    addResult('malformedMsg', id === null || id === undefined, id ? `Sent (id: ${id})` : 'Correctly rejected null message');
  } catch (e) {
    addResult('malformedMsg', true, `Correctly threw: ${e.message.substring(0,60)}`);
  }
};

const testDHTLimits = async () => {
  const m = store.mesh;
  if (!m) return;
  try {
    const bigValue = { data: 'x'.repeat(100000) };
    await m.dhtPut('test-limit-key', bigValue);
    addResult('dhtLimits', false, 'Accepted oversized value (unexpected)');
  } catch (e) {
    addResult('dhtLimits', true, `Correctly rejected: ${e.message.substring(0,60)}`);
  }
};

const testEncryptNoKey = async () => {
  const m = store.mesh;
  if (!m) return;
  const fakePeerId = 'aaaa'.repeat(16); // plausible but not connected
  try {
    await m.sendEncryptedMessage(fakePeerId, 'test message');
    addResult('encryptNoKey', false, 'Sent without a key (unexpected)');
  } catch (e) {
    addResult('encryptNoKey', true, `Correctly threw: ${e.message.substring(0,60)}`);
  }
};

const exportLogs = () => {
  const data = {
    exportedAt: new Date().toISOString(),
    peerId: store.peerId,
    networkName: store.networkName,
    debugLogs: store.debugLogs,
    messages: store.messages,
    testResults: store.testResults,
    dhtLogs: store.dhtLogs,
    cryptoLogs: store.cryptoLogs,
    storageLogs: store.storageLogs,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `peerpigeon-logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  addResult('exportLogs', true, `Exported ${JSON.stringify(data).length} bytes`);
};
</script>

<style scoped>
.form-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; align-items: flex-start; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.result-badge { display: inline-block; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; margin-top: 8px; }
.result-badge.success { background: #276749; color: #9ae6b4; }
.result-badge.fail { background: #742a2a; color: #fed7d7; }
.perf-result { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-top: 12px; }
.perf-stat { text-align: center; background: #1a202c; padding: 10px; border-radius: 6px; }
.perf-stat span { display: block; color: #718096; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
.perf-stat strong { color: #90cdf4; font-size: 18px; }
.result-indicator { margin-right: 4px; }
</style>
