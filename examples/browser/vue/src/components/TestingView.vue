<template>
  <div class="testing-view">
    <div class="view-header">
      <h2>🧪 PeerPigeon API Testing</h2>
      <p>Comprehensive test suite for validating all PeerPigeon features</p>
    </div>

    <!-- Quick Test Controls -->
    <div class="card">
      <h3>⚡ Quick Tests</h3>
      <div class="button-grid">
        <button @click="validatePeerId" class="btn btn-primary">
          🔍 Validate Peer ID
        </button>
        <button @click="runPerformanceTest" class="btn btn-primary" :disabled="!store.isConnected">
          🏃 Performance Test
        </button>
        <button @click="runStressTest" class="btn btn-primary" :disabled="!store.isConnected">
          ⚡ Stress Test
        </button>
        <button @click="testInvalidPeer" class="btn btn-secondary">
          ❌ Test Invalid Peer
        </button>
        <button @click="testMalformedMessage" class="btn btn-secondary">
          ⚠️ Test Malformed Message
        </button>
        <button @click="testDHTLimits" class="btn btn-secondary" :disabled="!store.isConnected">
          📊 Test DHT Limits
        </button>
      </div>
    </div>

    <!-- Test Configuration -->
    <div class="card">
      <h3>⚙️ Test Configuration</h3>
      <div class="input-grid">
        <div class="input-group">
          <label for="test-peer-id">Test Peer ID:</label>
          <input 
            id="test-peer-id" 
            v-model="testPeerId" 
            type="text" 
            placeholder="Enter peer ID to validate"
          >
        </div>
        <div class="input-group">
          <label for="test-message-count">Message Count:</label>
          <input 
            id="test-message-count" 
            v-model.number="testMessageCount" 
            type="number" 
            min="1" 
            max="1000"
          >
        </div>
        <div class="input-group">
          <label for="test-message-size">Message Size (chars):</label>
          <input 
            id="test-message-size" 
            v-model.number="testMessageSize" 
            type="number" 
            min="1" 
            max="10000"
          >
        </div>
      </div>
    </div>

    <!-- Test Results -->
    <div class="card">
      <h3>📊 Test Results</h3>
      <div class="test-results-header">
        <button @click="clearTestResults" class="btn btn-tertiary">
          🗑️ Clear Results
        </button>
        <button @click="exportTestResults" class="btn btn-tertiary">
          📥 Export Results
        </button>
      </div>
      <div class="test-results" ref="testResultsContainer">
        <div v-if="testResults.length === 0" class="empty-state">
          No test results yet. Run a test to see results here.
        </div>
        <div 
          v-for="(result, index) in testResults" 
          :key="index" 
          class="test-result-item"
          :class="result.status"
        >
          <div class="result-header">
            <span class="result-icon">{{ getStatusIcon(result.status) }}</span>
            <span class="result-name">{{ result.name }}</span>
            <span class="result-time">{{ formatTime(result.timestamp) }}</span>
          </div>
          <div class="result-details">
            <pre>{{ result.details }}</pre>
          </div>
          <div v-if="result.error" class="result-error">
            <strong>Error:</strong> {{ result.error }}
          </div>
        </div>
      </div>
    </div>

    <!-- Utility Test Results -->
    <div class="card">
      <h3>🔧 Utility Results</h3>
      <div class="utility-results" v-if="utilityResult">
        <pre>{{ utilityResult }}</pre>
      </div>
      <div v-else class="empty-state">
        Utility test results will appear here
      </div>
    </div>

    <!-- Performance Metrics -->
    <div class="card">
      <h3>📈 Performance Metrics</h3>
      <div class="metrics-grid">
        <div class="metric-item">
          <span class="metric-label">Messages Sent:</span>
          <span class="metric-value">{{ performanceMetrics.messagesSent }}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Messages Received:</span>
          <span class="metric-value">{{ performanceMetrics.messagesReceived }}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">DHT Operations:</span>
          <span class="metric-value">{{ performanceMetrics.dhtOperations }}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Test Duration:</span>
          <span class="metric-value">{{ formatDuration(performanceMetrics.duration) }}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Success Rate:</span>
          <span class="metric-value">{{ successRate }}%</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Avg Response Time:</span>
          <span class="metric-value">{{ avgResponseTime }}ms</span>
        </div>
      </div>
      <button @click="resetMetrics" class="btn btn-tertiary">
        🔄 Reset Metrics
      </button>
    </div>

    <!-- Export Options -->
    <div class="card">
      <h3>📁 Export Options</h3>
      <div class="button-grid">
        <button @click="exportLogs" class="btn btn-primary">
          📋 Export All Logs
        </button>
        <button @click="exportTestResults" class="btn btn-primary">
          📊 Export Test Results
        </button>
        <button @click="exportMetrics" class="btn btn-primary">
          📈 Export Metrics
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

// Test configuration
const testPeerId = ref('');
const testMessageCount = ref(50);
const testMessageSize = ref(100);

// Test results
const testResults = ref([]);
const utilityResult = ref('');

// Performance metrics
const performanceMetrics = ref({
  messagesSent: 0,
  messagesReceived: 0,
  dhtOperations: 0,
  duration: 0,
  testStartTime: null,
  testEndTime: null,
  responseTimes: []
});

// Computed
const successRate = computed(() => {
  if (testResults.value.length === 0) return 0;
  const successful = testResults.value.filter(r => r.status === 'success').length;
  return ((successful / testResults.value.length) * 100).toFixed(1);
});

const avgResponseTime = computed(() => {
  const times = performanceMetrics.value.responseTimes;
  if (times.length === 0) return 0;
  const sum = times.reduce((a, b) => a + b, 0);
  return (sum / times.length).toFixed(2);
});

// Test results container ref
const testResultsContainer = ref(null);

// Helper methods
const addTestResult = (name, details, status = 'info', error = null) => {
  testResults.value.push({
    name,
    details,
    status,
    error,
    timestamp: Date.now()
  });
  
  // Scroll to bottom
  nextTick(() => {
    if (testResultsContainer.value) {
      testResultsContainer.value.scrollTop = testResultsContainer.value.scrollHeight;
    }
  });
};

const getStatusIcon = (status) => {
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  return icons[status] || 'ℹ️';
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString();
};

const formatDuration = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

// Test methods
const validatePeerId = () => {
  if (!testPeerId.value) {
    addTestResult('Peer ID Validation', 'Please enter a peer ID to validate', 'warning');
    return;
  }

  // Simple validation - should be a non-empty string
  const isValid = testPeerId.value.length >= 8;
  
  const details = `
Peer ID: ${testPeerId.value}
Length: ${testPeerId.value.length} characters
Valid: ${isValid ? 'Yes' : 'No'}
Expected: At least 8 characters
  `.trim();
  
  utilityResult.value = details;
  addTestResult('Peer ID Validation', details, isValid ? 'success' : 'error');
};

const runPerformanceTest = async () => {
  if (!store.mesh) {
    addTestResult('Performance Test', 'Mesh not initialized', 'error');
    return;
  }

  addTestResult('Performance Test', `Starting test with ${testMessageCount.value} messages...`, 'info');
  
  const testMessage = 'x'.repeat(testMessageSize.value);
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;
  const responseTimes = [];

  performanceMetrics.value.testStartTime = startTime;

  for (let i = 0; i < testMessageCount.value; i++) {
    const msgStartTime = Date.now();
    try {
      const messageId = await store.sendBroadcastMessage(`${testMessage} #${i + 1}`);
      if (messageId) {
        successCount++;
        performanceMetrics.value.messagesSent++;
        responseTimes.push(Date.now() - msgStartTime);
      } else {
        failCount++;
      }
      
      // Small delay every 10 messages
      if (i % 10 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } catch (error) {
      failCount++;
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  performanceMetrics.value.testEndTime = endTime;
  performanceMetrics.value.duration = duration;
  performanceMetrics.value.responseTimes = responseTimes;

  const messagesPerSecond = ((successCount / duration) * 1000).toFixed(2);

  const details = `
Duration: ${duration}ms
Success: ${successCount}/${testMessageCount.value}
Failed: ${failCount}
Rate: ${messagesPerSecond} msg/sec
Avg Response: ${avgResponseTime.value}ms
  `.trim();

  addTestResult(
    'Performance Test',
    details,
    successCount > failCount ? 'success' : 'warning'
  );
};

const runStressTest = async () => {
  if (!store.mesh) {
    addTestResult('Stress Test', 'Mesh not initialized', 'error');
    return;
  }

  addTestResult('Stress Test', 'Starting stress test...', 'info');
  
  const operations = [];
  const startTime = Date.now();

  // DHT stress test
  for (let i = 0; i < 20; i++) {
    operations.push(
      store.dhtPut(`stress-test-${i}`, { value: i, timestamp: Date.now() })
        .then(() => {
          performanceMetrics.value.dhtOperations++;
          return { success: true };
        })
        .catch(err => ({ error: err.message }))
    );
  }

  // Message stress test
  for (let i = 0; i < 50; i++) {
    try {
      const messageId = await store.sendBroadcastMessage(`Stress test message #${i + 1}`);
      if (messageId) {
        performanceMetrics.value.messagesSent++;
        operations.push(Promise.resolve({ success: true }));
      } else {
        operations.push(Promise.resolve({ error: 'Failed to send' }));
      }
    } catch (error) {
      operations.push(Promise.resolve({ error: error.message }));
    }
  }

  const results = await Promise.allSettled(operations);
  const endTime = Date.now();
  const duration = endTime - startTime;

  const successful = results.filter(r => 
    r.status === 'fulfilled' && r.value?.success
  ).length;
  const failed = results.length - successful;

  const details = `
Duration: ${duration}ms
Operations: ${results.length}
Successful: ${successful}
Failed: ${failed}
Success Rate: ${((successful / results.length) * 100).toFixed(1)}%
  `.trim();

  addTestResult(
    'Stress Test',
    details,
    successful > failed ? 'success' : 'warning'
  );
};

const testInvalidPeer = async () => {
  const invalidPeerId = 'invalid-peer-id-12345';
  
  try {
    await store.sendDirectMessage(invalidPeerId, 'Test message');
    addTestResult(
      'Invalid Peer Test',
      'Message sent to invalid peer (unexpected)',
      'warning'
    );
  } catch (error) {
    addTestResult(
      'Invalid Peer Test',
      `Handled gracefully: ${error.message}`,
      'success'
    );
  }
};

const testMalformedMessage = async () => {
  const malformedMessages = [
    { type: 'undefined', value: undefined },
    { type: 'null', value: null },
    { type: 'function', value: () => {} },
    { type: 'symbol', value: Symbol('test') }
  ];

  const results = [];
  
  for (const msg of malformedMessages) {
    try {
      const messageId = await store.sendBroadcast(msg.value);
      results.push(`${msg.type}: ${messageId ? 'Sent' : 'Failed'}`);
    } catch (error) {
      results.push(`${msg.type}: Error handled - ${error.message}`);
    }
  }

  addTestResult(
    'Malformed Message Test',
    results.join('\n'),
    'success'
  );
};

const testDHTLimits = async () => {
  try {
    // Test with large data
    const largeData = 'x'.repeat(100000); // 100KB string
    const startTime = Date.now();
    
    await store.dhtPut('large-data-test', largeData);
    const stored = await store.dhtGet('large-data-test');
    const endTime = Date.now();

    const success = stored === largeData;
    const details = `
Data size: 100KB
Duration: ${endTime - startTime}ms
Success: ${success}
    `.trim();

    addTestResult('DHT Limits Test', details, success ? 'success' : 'error');
  } catch (error) {
    addTestResult(
      'DHT Limits Test',
      `Limit enforced: ${error.message}`,
      'success'
    );
  }
};

// Export methods
const exportLogs = () => {
  const logs = {
    testResults: testResults.value,
    performanceMetrics: performanceMetrics.value,
    debugLogs: store.debugLogs,
    messages: store.messages,
    networkStatus: store.networkStatus,
    timestamp: new Date().toISOString()
  };

  downloadJSON(logs, `peerpigeon-logs-${Date.now()}.json`);
  addTestResult('Export', 'Logs exported successfully', 'success');
};

const exportTestResults = () => {
  const data = {
    results: testResults.value,
    metrics: performanceMetrics.value,
    successRate: successRate.value,
    avgResponseTime: avgResponseTime.value,
    timestamp: new Date().toISOString()
  };

  downloadJSON(data, `peerpigeon-test-results-${Date.now()}.json`);
  addTestResult('Export', 'Test results exported successfully', 'success');
};

const exportMetrics = () => {
  downloadJSON(
    performanceMetrics.value,
    `peerpigeon-metrics-${Date.now()}.json`
  );
  addTestResult('Export', 'Metrics exported successfully', 'success');
};

const downloadJSON = (data, filename) => {
  const dataStr = JSON.stringify(data, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  
  URL.revokeObjectURL(url);
};

// Clear methods
const clearTestResults = () => {
  testResults.value = [];
  utilityResult.value = '';
};

const resetMetrics = () => {
  performanceMetrics.value = {
    messagesSent: 0,
    messagesReceived: 0,
    dhtOperations: 0,
    duration: 0,
    testStartTime: null,
    testEndTime: null,
    responseTimes: []
  };
};
</script>

<style scoped>
.testing-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.view-header {
  margin-bottom: 8px;
}

.view-header h2 {
  font-size: 28px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 8px 0;
}

.view-header p {
  color: #6b7280;
  margin: 0;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.card h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 16px 0;
}

.button-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.input-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-group label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.input-group input {
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.input-group input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.btn {
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
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

.btn-tertiary {
  background: #e5e7eb;
  color: #374151;
}

.btn-tertiary:hover:not(:disabled) {
  background: #d1d5db;
}

.test-results-header {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.test-results {
  max-height: 500px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: #9ca3af;
  font-style: italic;
}

.test-result-item {
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.test-result-item.success {
  background: #f0fdf4;
  border-color: #86efac;
}

.test-result-item.error {
  background: #fef2f2;
  border-color: #fca5a5;
}

.test-result-item.warning {
  background: #fffbeb;
  border-color: #fde68a;
}

.test-result-item.info {
  background: #eff6ff;
  border-color: #93c5fd;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.result-icon {
  font-size: 20px;
}

.result-name {
  font-weight: 600;
  color: #1f2937;
  flex: 1;
}

.result-time {
  font-size: 12px;
  color: #6b7280;
}

.result-details {
  margin-top: 8px;
}

.result-details pre {
  margin: 0;
  font-size: 13px;
  white-space: pre-wrap;
  color: #374151;
}

.result-error {
  margin-top: 8px;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 6px;
  font-size: 13px;
  color: #dc2626;
}

.utility-results {
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
}

.utility-results pre {
  margin: 0;
  font-size: 14px;
  color: #374151;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.metric-item {
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metric-label {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
}

/* Scrollbar styles */
.test-results::-webkit-scrollbar {
  width: 8px;
}

.test-results::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 4px;
}

.test-results::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.test-results::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
</style>
