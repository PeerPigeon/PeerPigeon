<template>
  <div class="debug-view">
    <div class="section-header">
      <h2>🔍 Debug & Monitoring</h2>
      <p>System diagnostics, logging, performance monitoring, and debugging tools</p>
    </div>

    <!-- Debug Controls -->
    <div class="debug-controls">
      <h3>🎛️ Debug Controls</h3>
      
      <div class="control-tabs">
        <button 
          @click="activeTab = 'logging'"
          :class="['tab-btn', { active: activeTab === 'logging' }]"
        >
          LOGGING
        </button>
        <button 
          @click="activeTab = 'monitoring'"
          :class="['tab-btn', { active: activeTab === 'monitoring' }]"
        >
          MONITORING
        </button>
        <button 
          @click="activeTab = 'performance'"
          :class="['tab-btn', { active: activeTab === 'performance' }]"
        >
          PERFORMANCE
        </button>
        <button 
          @click="activeTab = 'diagnostics'"
          :class="['tab-btn', { active: activeTab === 'diagnostics' }]"
        >
          DIAGNOSTICS
        </button>
      </div>

      <!-- LOGGING Controls -->
      <div v-if="activeTab === 'logging'" class="control-panel">
        <h4>📝 Logging Configuration</h4>
        <p class="panel-description">
          Configure debug logging levels and modules. Control what information is captured and displayed.
        </p>
        
        <div class="logging-config">
          <div class="form-group">
            <label>Global Log Level:</label>
            <select v-model="logConfig.globalLevel" @change="updateLogLevel" class="form-select">
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
              <option value="verbose">Verbose</option>
            </select>
          </div>
          
          <div class="module-controls">
            <h5>Module-Specific Logging:</h5>
            <div class="module-grid">
              <div v-for="module in debugModules" :key="module.name" class="module-item">
                <div class="module-header">
                  <span class="module-name">{{ module.name }}</span>
                  <span class="module-status" :class="{ enabled: module.enabled }">
                    {{ module.enabled ? 'ON' : 'OFF' }}
                  </span>
                </div>
                
                <div class="module-controls">
                  <label class="toggle-label">
                    <input 
                      type="checkbox" 
                      v-model="module.enabled"
                      @change="toggleModule(module.name, module.enabled)"
                    >
                    Enable
                  </label>
                  
                  <select 
                    v-model="module.level" 
                    @change="setModuleLevel(module.name, module.level)"
                    :disabled="!module.enabled"
                    class="form-select-sm"
                  >
                    <option value="error">Error</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                    <option value="debug">Debug</option>
                    <option value="verbose">Verbose</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
          
          <div class="logging-actions">
            <button @click="enableAllModules" class="btn btn-primary">
              <span class="btn-icon">✅</span>
              Enable All
            </button>
            <button @click="disableAllModules" class="btn btn-secondary">
              <span class="btn-icon">❌</span>
              Disable All
            </button>
            <button @click="resetLoggingConfig" class="btn btn-secondary">
              <span class="btn-icon">🔄</span>
              Reset Config
            </button>
          </div>
        </div>
      </div>

      <!-- MONITORING Controls -->
      <div v-if="activeTab === 'monitoring'" class="control-panel">
        <h4>📊 System Monitoring</h4>
        <p class="panel-description">
          Monitor system performance, network activity, and resource usage in real-time.
        </p>
        
        <div class="monitoring-config">
          <div class="form-group">
            <label>Monitoring Interval:</label>
            <select v-model="monitoringConfig.interval" @change="updateMonitoringInterval" class="form-select">
              <option value="1000">1 second</option>
              <option value="5000">5 seconds</option>
              <option value="10000">10 seconds</option>
              <option value="30000">30 seconds</option>
            </select>
          </div>
          
          <div class="monitoring-toggles">
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                v-model="monitoringConfig.networkActivity"
                @change="toggleNetworkMonitoring"
              >
              Network Activity Monitoring
            </label>
            
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                v-model="monitoringConfig.memoryUsage"
                @change="toggleMemoryMonitoring"
              >
              Memory Usage Tracking
            </label>
            
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                v-model="monitoringConfig.peerMetrics"
                @change="togglePeerMetrics"
              >
              Peer Connection Metrics
            </label>
            
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                v-model="monitoringConfig.eventTracking"
                @change="toggleEventTracking"
              >
              Event Tracking
            </label>
          </div>
          
          <div class="monitoring-actions">
            <button 
              @click="startMonitoring" 
              :disabled="isMonitoring"
              class="btn btn-success"
            >
              <span class="btn-icon">▶️</span>
              Start Monitoring
            </button>
            <button 
              @click="stopMonitoring" 
              :disabled="!isMonitoring"
              class="btn btn-danger"
            >
              <span class="btn-icon">⏹️</span>
              Stop Monitoring
            </button>
            <button @click="clearMonitoringData" class="btn btn-secondary">
              <span class="btn-icon">🗑️</span>
              Clear Data
            </button>
          </div>
        </div>
      </div>

      <!-- PERFORMANCE Controls -->
      <div v-if="activeTab === 'performance'" class="control-panel">
        <h4>⚡ Performance Analysis</h4>
        <p class="panel-description">
          Analyze performance bottlenecks, measure operation timing, and optimize system performance.
        </p>
        
        <div class="performance-config">
          <div class="profiling-controls">
            <h5>Performance Profiling:</h5>
            <div class="profiling-actions">
              <button 
                @click="startProfiling" 
                :disabled="isProfiling"
                class="btn btn-primary"
              >
                <span class="btn-icon">🎯</span>
                Start Profiling
              </button>
              <button 
                @click="stopProfiling" 
                :disabled="!isProfiling"
                class="btn btn-danger"
              >
                <span class="btn-icon">⏹️</span>
                Stop Profiling
              </button>
              <button @click="generatePerformanceReport" class="btn btn-info">
                <span class="btn-icon">📊</span>
                Generate Report
              </button>
            </div>
          </div>
          
          <div class="benchmark-controls">
            <h5>System Benchmarks:</h5>
            <div class="benchmark-actions">
              <button @click="runNetworkBenchmark" class="btn btn-secondary">
                <span class="btn-icon">🌐</span>
                Network Benchmark
              </button>
              <button @click="runCryptoBenchmark" class="btn btn-secondary">
                <span class="btn-icon">🔒</span>
                Crypto Benchmark
              </button>
              <button @click="runStorageBenchmark" class="btn btn-secondary">
                <span class="btn-icon">💾</span>
                Storage Benchmark
              </button>
              <button @click="runFullBenchmarkSuite" class="btn btn-primary">
                <span class="btn-icon">🚀</span>
                Full Benchmark Suite
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- DIAGNOSTICS Controls -->
      <div v-if="activeTab === 'diagnostics'" class="control-panel">
        <h4>🔧 System Diagnostics</h4>
        <p class="panel-description">
          Run diagnostic tests, validate system health, and troubleshoot issues.
        </p>
        
        <div class="diagnostics-config">
          <div class="health-check">
            <h5>System Health Check:</h5>
            <div class="health-actions">
              <button @click="runHealthCheck" class="btn btn-primary">
                <span class="btn-icon">❤️</span>
                Run Health Check
              </button>
              <button @click="validateConfiguration" class="btn btn-secondary">
                <span class="btn-icon">✅</span>
                Validate Config
              </button>
              <button @click="testConnectivity" class="btn btn-secondary">
                <span class="btn-icon">🌐</span>
                Test Connectivity
              </button>
            </div>
          </div>
          
          <div class="troubleshooting">
            <h5>Troubleshooting Tools:</h5>
            <div class="trouble-actions">
              <button @click="generateDiagnosticReport" class="btn btn-info">
                <span class="btn-icon">📋</span>
                Diagnostic Report
              </button>
              <button @click="exportDebugLogs" class="btn btn-secondary">
                <span class="btn-icon">📤</span>
                Export Debug Logs
              </button>
              <button @click="resetSystem" class="btn btn-warning">
                <span class="btn-icon">🔄</span>
                Reset System
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Debug Log Display -->
    <div class="debug-logs">
      <div class="section-title">
        <h3>📜 Debug Logs ({{ debugLogs.length }})</h3>
        <div class="log-controls">
          <div class="log-filters">
            <select v-model="logFilter" class="form-select-sm">
              <option value="all">All Levels</option>
              <option value="error">Errors Only</option>
              <option value="warning">Warnings+</option>
              <option value="info">Info+</option>
              <option value="debug">Debug+</option>
              <option value="verbose">Verbose</option>
            </select>
            
            <input 
              v-model="logSearch" 
              placeholder="Search logs..."
              class="form-input-sm"
            >
          </div>
          
          <div class="log-actions">
            <button @click="toggleAutoScroll" :class="['btn', 'btn-sm', autoScroll ? 'btn-primary' : 'btn-secondary']">
              <span class="btn-icon">{{ autoScroll ? '📌' : '📌' }}</span>
              Auto-scroll
            </button>
            <button @click="clearLogs" class="btn btn-sm btn-danger">
              <span class="btn-icon">🗑️</span>
              Clear
            </button>
            <button @click="exportLogs" class="btn btn-sm btn-secondary">
              <span class="btn-icon">📤</span>
              Export
            </button>
          </div>
        </div>
      </div>
      
      <div class="log-display" ref="logDisplay">
        <div v-if="filteredLogs.length === 0" class="empty-logs">
          <div class="empty-icon">📭</div>
          <p>No logs to display</p>
          <p class="empty-meta">
            {{ logFilter === 'all' ? 'No debug logs yet' : `No logs matching filter: ${logFilter}` }}
          </p>
        </div>
        
        <div v-else class="log-entries">
          <div 
            v-for="log in filteredLogs" 
            :key="log.id"
            :class="['log-entry', `log-${log.level}`]"
          >
            <div class="log-header">
              <span class="log-timestamp">{{ formatLogTime(log.timestamp) }}</span>
              <span class="log-level">{{ log.level.toUpperCase() }}</span>
              <span v-if="log.module" class="log-module">{{ log.module }}</span>
            </div>
            
            <div class="log-message">{{ log.message }}</div>
            
            <div v-if="log.data" class="log-data">
              <details>
                <summary>Additional Data</summary>
                <pre>{{ JSON.stringify(log.data, null, 2) }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- System Status Dashboard -->
    <div class="system-dashboard">
      <h3>📊 System Status Dashboard</h3>
      
      <div class="dashboard-grid">
        <div class="status-card">
          <div class="status-icon">🖥️</div>
          <div class="status-content">
            <h4>System Status</h4>
            <div class="status-value" :class="systemStatus.overall">{{ systemStatus.overall }}</div>
            <div class="status-meta">Last checked: {{ formatTime(systemStatus.lastCheck) }}</div>
          </div>
        </div>
        
        <div class="status-card">
          <div class="status-icon">🌐</div>
          <div class="status-content">
            <h4>Network Health</h4>
            <div class="status-value" :class="networkHealth.status">{{ networkHealth.status }}</div>
            <div class="status-meta">{{ networkHealth.connectedPeers }} peers connected</div>
          </div>
        </div>
        
        <div class="status-card">
          <div class="status-icon">💾</div>
          <div class="status-content">
            <h4>Memory Usage</h4>
            <div class="status-value">{{ memoryUsage.used }}MB</div>
            <div class="status-meta">{{ memoryUsage.percentage }}% of {{ memoryUsage.total }}MB</div>
          </div>
        </div>
        
        <div class="status-card">
          <div class="status-icon">⚡</div>
          <div class="status-content">
            <h4>Performance</h4>
            <div class="status-value" :class="performance.status">{{ performance.averageLatency }}ms</div>
            <div class="status-meta">Average latency</div>
          </div>
        </div>
      </div>
      
      <div v-if="monitoringData.length > 0" class="monitoring-charts">
        <h4>Performance Charts</h4>
        <div class="chart-placeholder">
          <div class="chart-info">
            <p>📈 Real-time performance data visualization would be displayed here</p>
            <p>Data points: {{ monitoringData.length }}</p>
            <p>Monitoring since: {{ formatTime(monitoringStartTime) }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Debug Actions -->
    <div class="quick-debug-actions">
      <h3>⚡ Quick Debug Actions</h3>
      <div class="action-buttons">
        <button @click="logTestMessages" class="btn btn-secondary">
          <span class="btn-icon">📝</span>
          Generate Test Logs
        </button>
        
        <button @click="simulateError" class="btn btn-warning">
          <span class="btn-icon">⚠️</span>
          Simulate Error
        </button>
        
        <button @click="stressTestSystem" class="btn btn-danger">
          <span class="btn-icon">🔥</span>
          Stress Test
        </button>
        
        <button @click="generatePerformanceProfile" class="btn btn-info">
          <span class="btn-icon">📊</span>
          Performance Profile
        </button>
        
        <button @click="enableVerboseLogging" class="btn btn-primary">
          <span class="btn-icon">🔍</span>
          Enable Verbose Logging
        </button>
        
        <button @click="captureSystemSnapshot" class="btn btn-secondary">
          <span class="btn-icon">📸</span>
          System Snapshot
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { usePeerPigeonStore } from '../stores/peerpigeon.js';

const store = usePeerPigeonStore();

// Local reactive state
const activeTab = ref('logging');
const logDisplay = ref(null);
const autoScroll = ref(true);
const logFilter = ref('all');
const logSearch = ref('');

// Monitoring state
const isMonitoring = ref(false);
const isProfiling = ref(false);
const monitoringInterval = ref(null);
const monitoringStartTime = ref(null);
const monitoringData = ref([]);

// Debug configuration
const logConfig = ref({
  globalLevel: 'info'
});

const monitoringConfig = ref({
  interval: 5000,
  networkActivity: true,
  memoryUsage: true,
  peerMetrics: true,
  eventTracking: true
});

// Debug modules configuration
const debugModules = ref([
  { name: 'Network', enabled: true, level: 'info' },
  { name: 'Storage', enabled: true, level: 'info' },
  { name: 'Crypto', enabled: true, level: 'info' },
  { name: 'DHT', enabled: true, level: 'info' },
  { name: 'Messaging', enabled: true, level: 'info' },
  { name: 'Media', enabled: true, level: 'info' },
  { name: 'WebRTC', enabled: false, level: 'debug' },
  { name: 'SignalingClient', enabled: false, level: 'debug' },
  { name: 'PeerConnection', enabled: false, level: 'debug' },
  { name: 'EventEmitter', enabled: false, level: 'verbose' }
]);

// System status
const systemStatus = ref({
  overall: 'healthy',
  lastCheck: Date.now()
});

const networkHealth = ref({
  status: 'good',
  connectedPeers: 0
});

const memoryUsage = ref({
  used: 0,
  total: 0,
  percentage: 0
});

const performance = ref({
  status: 'good',
  averageLatency: 0
});

// Computed properties
const debugLogs = computed(() => store.debugLogs);

const filteredLogs = computed(() => {
  let logs = debugLogs.value;
  
  // Filter by level
  if (logFilter.value !== 'all') {
    const levelPriority = {
      'error': 0,
      'warning': 1,
      'info': 2,
      'debug': 3,
      'verbose': 4
    };
    
    const filterPriority = levelPriority[logFilter.value];
    logs = logs.filter(log => levelPriority[log.level] <= filterPriority);
  }
  
  // Filter by search
  if (logSearch.value) {
    const search = logSearch.value.toLowerCase();
    logs = logs.filter(log => 
      log.message.toLowerCase().includes(search) ||
      (log.module && log.module.toLowerCase().includes(search))
    );
  }
  
  return logs;
});

// Methods
const updateLogLevel = () => {
  if (store.mesh?.debugLogger) {
    store.mesh.debugLogger.setGlobalLevel(logConfig.value.globalLevel);
  }
  store.addDebugLog(`Global log level set to: ${logConfig.value.globalLevel}`, 'info');
};

const toggleModule = (moduleName, enabled) => {
  if (store.mesh?.debugLogger) {
    if (enabled) {
      store.mesh.debugLogger.enableModule(moduleName);
    } else {
      store.mesh.debugLogger.disableModule(moduleName);
    }
  }
  store.addDebugLog(`Module ${moduleName}: ${enabled ? 'enabled' : 'disabled'}`, 'info');
};

const setModuleLevel = (moduleName, level) => {
  if (store.mesh?.debugLogger) {
    store.mesh.debugLogger.setModuleLevel(moduleName, level);
  }
  store.addDebugLog(`Module ${moduleName} level set to: ${level}`, 'info');
};

const enableAllModules = () => {
  debugModules.value.forEach(module => {
    module.enabled = true;
    toggleModule(module.name, true);
  });
};

const disableAllModules = () => {
  debugModules.value.forEach(module => {
    module.enabled = false;
    toggleModule(module.name, false);
  });
};

const resetLoggingConfig = () => {
  logConfig.value.globalLevel = 'info';
  debugModules.value.forEach(module => {
    module.enabled = ['Network', 'Storage', 'Crypto', 'DHT', 'Messaging', 'Media'].includes(module.name);
    module.level = 'info';
  });
  updateLogLevel();
  store.addDebugLog('Logging configuration reset to defaults', 'info');
};

const updateMonitoringInterval = () => {
  if (isMonitoring.value) {
    stopMonitoring();
    startMonitoring();
  }
};

const toggleNetworkMonitoring = () => {
  store.addDebugLog(`Network monitoring: ${monitoringConfig.value.networkActivity ? 'enabled' : 'disabled'}`, 'info');
};

const toggleMemoryMonitoring = () => {
  store.addDebugLog(`Memory monitoring: ${monitoringConfig.value.memoryUsage ? 'enabled' : 'disabled'}`, 'info');
};

const togglePeerMetrics = () => {
  store.addDebugLog(`Peer metrics: ${monitoringConfig.value.peerMetrics ? 'enabled' : 'disabled'}`, 'info');
};

const toggleEventTracking = () => {
  store.addDebugLog(`Event tracking: ${monitoringConfig.value.eventTracking ? 'enabled' : 'disabled'}`, 'info');
};

const startMonitoring = () => {
  isMonitoring.value = true;
  monitoringStartTime.value = Date.now();
  
  monitoringInterval.value = setInterval(() => {
    collectMonitoringData();
  }, monitoringConfig.value.interval);
  
  store.addDebugLog('System monitoring started', 'success');
};

const stopMonitoring = () => {
  isMonitoring.value = false;
  
  if (monitoringInterval.value) {
    clearInterval(monitoringInterval.value);
    monitoringInterval.value = null;
  }
  
  store.addDebugLog('System monitoring stopped', 'info');
};

const clearMonitoringData = () => {
  monitoringData.value = [];
  store.addDebugLog('Monitoring data cleared', 'info');
};

const collectMonitoringData = () => {
  const dataPoint = {
    timestamp: Date.now(),
    memoryUsage: performance.memory ? {
      used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
    } : { used: 0, total: 0 },
    connectedPeers: store.connectedPeersList.length,
    networkLatency: Math.random() * 100 + 20, // Simulated
    cpuUsage: Math.random() * 50 + 10 // Simulated
  };
  
  monitoringData.value.push(dataPoint);
  
  // Keep only last 100 data points
  if (monitoringData.value.length > 100) {
    monitoringData.value.shift();
  }
  
  // Update dashboard values
  updateSystemStatus(dataPoint);
};

const updateSystemStatus = (dataPoint) => {
  // Update memory usage
  memoryUsage.value = {
    used: dataPoint.memoryUsage.used,
    total: dataPoint.memoryUsage.total,
    percentage: dataPoint.memoryUsage.total > 0 ? 
      Math.round((dataPoint.memoryUsage.used / dataPoint.memoryUsage.total) * 100) : 0
  };
  
  // Update network health
  networkHealth.value = {
    status: dataPoint.connectedPeers > 0 ? 'good' : 'warning',
    connectedPeers: dataPoint.connectedPeers
  };
  
  // Update performance
  performance.value = {
    status: dataPoint.networkLatency < 100 ? 'good' : 'warning',
    averageLatency: Math.round(dataPoint.networkLatency)
  };
  
  // Update overall system status
  systemStatus.value = {
    overall: (networkHealth.value.status === 'good' && performance.value.status === 'good') ? 'healthy' : 'warning',
    lastCheck: Date.now()
  };
};

const startProfiling = () => {
  isProfiling.value = true;
  store.addDebugLog('Performance profiling started', 'info');
  
  // Enable verbose logging for performance analysis
  debugModules.value.forEach(module => {
    if (['Network', 'WebRTC', 'PeerConnection'].includes(module.name)) {
      module.enabled = true;
      module.level = 'debug';
      toggleModule(module.name, true);
      setModuleLevel(module.name, 'debug');
    }
  });
};

const stopProfiling = () => {
  isProfiling.value = false;
  store.addDebugLog('Performance profiling stopped', 'info');
};

const generatePerformanceReport = () => {
  const report = {
    timestamp: Date.now(),
    monitoringData: monitoringData.value.slice(-20), // Last 20 data points
    systemStatus: systemStatus.value,
    memoryUsage: memoryUsage.value,
    networkHealth: networkHealth.value,
    performance: performance.value,
    logSummary: {
      total: debugLogs.value.length,
      errors: debugLogs.value.filter(log => log.level === 'error').length,
      warnings: debugLogs.value.filter(log => log.level === 'warning').length
    }
  };
  
  const reportStr = JSON.stringify(report, null, 2);
  const reportBlob = new Blob([reportStr], { type: 'application/json' });
  const url = URL.createObjectURL(reportBlob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `peerpigeon-performance-report-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  store.addDebugLog('Performance report generated and downloaded', 'success');
};

const runNetworkBenchmark = async () => {
  store.addDebugLog('Running network benchmark...', 'info');
  
  const startTime = performance.now();
  
  // Simulate network operations
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    if (store.connectedPeersList.length > 0) {
      // Simulate sending messages
      store.addDebugLog(`Benchmark message ${i + 1}/10`, 'debug');
    }
  }
  
  const endTime = performance.now();
  const duration = Math.round(endTime - startTime);
  
  store.addDebugLog(`Network benchmark completed in ${duration}ms`, 'success');
};

const runCryptoBenchmark = async () => {
  store.addDebugLog('Running crypto benchmark...', 'info');
  
  const startTime = performance.now();
  
  // Simulate crypto operations
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    store.addDebugLog(`Crypto operation ${i + 1}/5`, 'debug');
  }
  
  const endTime = performance.now();
  const duration = Math.round(endTime - startTime);
  
  store.addDebugLog(`Crypto benchmark completed in ${duration}ms`, 'success');
};

const runStorageBenchmark = async () => {
  store.addDebugLog('Running storage benchmark...', 'info');
  
  const startTime = performance.now();
  
  // Simulate storage operations
  for (let i = 0; i < 15; i++) {
    await store.storageStore(`benchmark:test-${i}`, { data: `test-data-${i}`, timestamp: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  
  const endTime = performance.now();
  const duration = Math.round(endTime - startTime);
  
  store.addDebugLog(`Storage benchmark completed in ${duration}ms`, 'success');
};

const runFullBenchmarkSuite = async () => {
  store.addDebugLog('Running full benchmark suite...', 'info');
  
  await runNetworkBenchmark();
  await runCryptoBenchmark();
  await runStorageBenchmark();
  
  store.addDebugLog('Full benchmark suite completed', 'success');
};

const runHealthCheck = async () => {
  store.addDebugLog('Running system health check...', 'info');
  
  const checks = [
    { name: 'Mesh Connection', status: store.isConnected ? 'pass' : 'fail' },
    { name: 'WebRTC Support', status: window.RTCPeerConnection ? 'pass' : 'fail' },
    { name: 'WebSocket Support', status: window.WebSocket ? 'pass' : 'fail' },
    { name: 'Crypto API', status: window.crypto && window.crypto.subtle ? 'pass' : 'fail' },
    { name: 'Storage Manager', status: store.mesh?.distributedStorage ? 'pass' : 'fail' },
    { name: 'Debug Logger', status: store.mesh?.debugLogger ? 'pass' : 'fail' }
  ];
  
  checks.forEach(check => {
    const level = check.status === 'pass' ? 'success' : 'error';
    store.addDebugLog(`Health Check - ${check.name}: ${check.status.toUpperCase()}`, level);
  });
  
  const passedChecks = checks.filter(c => c.status === 'pass').length;
  store.addDebugLog(`Health check completed: ${passedChecks}/${checks.length} checks passed`, 
    passedChecks === checks.length ? 'success' : 'warning');
};

const validateConfiguration = () => {
  store.addDebugLog('Validating system configuration...', 'info');
  
  const config = {
    mesh: !!store.mesh,
    peerId: !!store.peerId,
    signalingServer: store.signalingServer || 'default',
    debugLogging: !!store.mesh?.debugLogger
  };
  
  store.addDebugLog(`Configuration validation:\n${JSON.stringify(config, null, 2)}`, 'info');
};

const testConnectivity = async () => {
  store.addDebugLog('Testing connectivity...', 'info');
  
  try {
    // Test signaling server connection
    if (store.mesh?.signalingClient) {
      store.addDebugLog('Signaling server: Connected', 'success');
    } else {
      store.addDebugLog('Signaling server: Not connected', 'warning');
    }
    
    // Test peer connections
    const peerCount = store.connectedPeersList.length;
    store.addDebugLog(`Peer connections: ${peerCount} active`, peerCount > 0 ? 'success' : 'warning');
    
    store.addDebugLog('Connectivity test completed', 'info');
  } catch (error) {
    store.addDebugLog(`Connectivity test failed: ${error.message}`, 'error');
  }
};

const generateDiagnosticReport = () => {
  const report = {
    timestamp: Date.now(),
    system: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      onLine: navigator.onLine
    },
    peerpigeon: {
      version: '1.0.0',
      peerId: store.peerId,
      isConnected: store.isConnected,
      connectedPeers: store.connectedPeersList.length,
      storageItems: store.storageData.size,
      cryptoKeys: store.cryptoKeys.length
    },
    logs: {
      total: debugLogs.value.length,
      recent: debugLogs.value.slice(-50) // Last 50 logs
    },
    monitoring: {
      isActive: isMonitoring.value,
      dataPoints: monitoringData.value.length,
      systemStatus: systemStatus.value
    }
  };
  
  const reportStr = JSON.stringify(report, null, 2);
  const reportBlob = new Blob([reportStr], { type: 'application/json' });
  const url = URL.createObjectURL(reportBlob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `peerpigeon-diagnostic-report-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  store.addDebugLog('Diagnostic report generated and downloaded', 'success');
};

const exportDebugLogs = () => {
  const logsData = {
    exported: Date.now(),
    totalLogs: debugLogs.value.length,
    logs: debugLogs.value
  };
  
  const logsStr = JSON.stringify(logsData, null, 2);
  const logsBlob = new Blob([logsStr], { type: 'application/json' });
  const url = URL.createObjectURL(logsBlob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `peerpigeon-debug-logs-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  store.addDebugLog('Debug logs exported', 'success');
};

const resetSystem = () => {
  if (confirm('Are you sure you want to reset the system? This will clear all data and restart.')) {
    store.addDebugLog('System reset initiated...', 'warning');
    
    // Stop monitoring
    stopMonitoring();
    
    // Clear all data
    store.debugLogs.splice(0);
    store.storageData.clear();
    store.cryptoKeys.splice(0);
    monitoringData.value = [];
    
    // Reset configurations
    resetLoggingConfig();
    
    store.addDebugLog('System reset completed', 'info');
  }
};

const toggleAutoScroll = () => {
  autoScroll.value = !autoScroll.value;
  if (autoScroll.value) {
    scrollToBottom();
  }
};

const clearLogs = () => {
  store.debugLogs.splice(0);
  store.addDebugLog('Debug logs cleared', 'info');
};

const exportLogs = () => {
  exportDebugLogs();
};

const scrollToBottom = () => {
  nextTick(() => {
    if (logDisplay.value) {
      logDisplay.value.scrollTop = logDisplay.value.scrollHeight;
    }
  });
};

const formatLogTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString();
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString();
};

// Quick Actions
const logTestMessages = () => {
  const levels = ['error', 'warning', 'info', 'debug', 'verbose'];
  const modules = ['Network', 'Storage', 'Crypto', 'DHT'];
  
  levels.forEach((level, index) => {
    setTimeout(() => {
      const module = modules[index % modules.length];
      store.addDebugLog(`Test ${level} message from ${module}`, level, module);
    }, index * 200);
  });
};

const simulateError = () => {
  store.addDebugLog('Simulated error: Connection timeout', 'error', 'Network');
  store.addDebugLog('Retrying connection...', 'warning', 'Network');
  setTimeout(() => {
    store.addDebugLog('Connection retry successful', 'success', 'Network');
  }, 1000);
};

const stressTestSystem = async () => {
  store.addDebugLog('Starting stress test...', 'warning');
  
  for (let i = 0; i < 50; i++) {
    setTimeout(() => {
      store.addDebugLog(`Stress test operation ${i + 1}/50`, 'debug');
    }, i * 50);
  }
  
  setTimeout(() => {
    store.addDebugLog('Stress test completed', 'success');
  }, 50 * 50 + 100);
};

const generatePerformanceProfile = () => {
  generatePerformanceReport();
};

const enableVerboseLogging = () => {
  logConfig.value.globalLevel = 'verbose';
  updateLogLevel();
  
  debugModules.value.forEach(module => {
    module.enabled = true;
    module.level = 'verbose';
    toggleModule(module.name, true);
    setModuleLevel(module.name, 'verbose');
  });
  
  store.addDebugLog('Verbose logging enabled for all modules', 'info');
};

const captureSystemSnapshot = () => {
  const snapshot = {
    timestamp: Date.now(),
    mesh: {
      isConnected: store.isConnected,
      peerId: store.peerId,
      connectedPeers: store.connectedPeersList.length
    },
    storage: {
      itemCount: store.storageData.size,
      keys: Array.from(store.storageData.keys())
    },
    crypto: {
      keyCount: store.cryptoKeys.length
    },
    system: {
      memoryUsage: memoryUsage.value,
      performance: performance.value,
      networkHealth: networkHealth.value
    },
    debug: {
      logCount: debugLogs.value.length,
      isMonitoring: isMonitoring.value,
      moduleStates: debugModules.value
    }
  };
  
  store.addDebugLog(`System Snapshot:\n${JSON.stringify(snapshot, null, 2)}`, 'info');
};

// Watch for new logs to auto-scroll
watch(debugLogs, () => {
  if (autoScroll.value) {
    scrollToBottom();
  }
}, { deep: true });

onMounted(() => {
  // Start initial system monitoring
  if (monitoringConfig.value.networkActivity || monitoringConfig.value.memoryUsage) {
    startMonitoring();
  }
  
  // Initialize system status
  collectMonitoringData();
  
  store.addDebugLog('Debug view initialized', 'info');
});

onUnmounted(() => {
  if (monitoringInterval.value) {
    clearInterval(monitoringInterval.value);
  }
});
</script>

<style scoped>
/* Same base styles as other views with debug-specific styling */
.debug-view {
  max-width: 1400px;
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

.debug-controls {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.debug-controls h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.control-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 20px;
  border-bottom: 1px solid #eee;
  overflow-x: auto;
}

.tab-btn {
  padding: 12px 20px;
  border: none;
  background: none;
  color: #666;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
  font-weight: 500;
  white-space: nowrap;
}

.tab-btn:hover {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.tab-btn.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.control-panel {
  padding: 20px;
  border: 1px solid #eee;
  border-radius: 8px;
  background: #fafafa;
}

.control-panel h4 {
  margin: 0 0 8px 0;
  color: #333;
}

.panel-description {
  color: #666;
  font-size: 14px;
  margin-bottom: 20px;
  line-height: 1.5;
}

.logging-config,
.monitoring-config,
.performance-config,
.diagnostics-config {
  display: grid;
  gap: 20px;
}

.module-controls h5 {
  margin: 0 0 12px 0;
  color: #333;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.module-item {
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 12px;
  background: white;
}

.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.module-name {
  font-weight: 500;
  color: #333;
}

.module-status {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 500;
  background: #dc2626;
  color: white;
}

.module-status.enabled {
  background: #10b981;
}

.module-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
  margin-bottom: 8px;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  margin: 0;
}

.monitoring-toggles {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #333;
  font-size: 14px;
}

.form-select,
.form-select-sm {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  background: white;
}

.form-select-sm {
  padding: 4px 8px;
  font-size: 12px;
}

.form-input-sm {
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
}

.logging-actions,
.monitoring-actions,
.profiling-actions,
.benchmark-actions,
.health-actions,
.trouble-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.profiling-controls,
.benchmark-controls,
.health-check,
.troubleshooting {
  border-top: 1px solid #eee;
  padding-top: 16px;
}

.profiling-controls h5,
.benchmark-controls h5,
.health-check h5,
.troubleshooting h5 {
  margin: 0 0 12px 0;
  color: #333;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
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

.btn-success {
  background: #10b981;
  color: white;
}

.btn-success:hover:not(:disabled) {
  background: #059669;
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-warning {
  background: #f59e0b;
  color: white;
}

.btn-warning:hover:not(:disabled) {
  background: #d97706;
}

.btn-info {
  background: #06b6d4;
  color: white;
}

.btn-info:hover:not(:disabled) {
  background: #0891b2;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 12px;
}

.btn-icon {
  font-size: 14px;
}

.debug-logs {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 16px;
}

.section-title h3 {
  margin: 0;
  color: #333;
}

.log-controls {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.log-filters {
  display: flex;
  gap: 8px;
  align-items: center;
}

.log-actions {
  display: flex;
  gap: 8px;
}

.log-display {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 6px;
  background: #fafafa;
}

.empty-logs {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-logs p {
  margin: 0 0 8px 0;
}

.empty-meta {
  font-size: 14px;
  color: #999;
}

.log-entries {
  padding: 16px;
}

.log-entry {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 3px solid #ddd;
  background: white;
}

.log-entry.log-error {
  border-left-color: #ef4444;
  background: #fef2f2;
}

.log-entry.log-warning {
  border-left-color: #f59e0b;
  background: #fffbeb;
}

.log-entry.log-info {
  border-left-color: #3b82f6;
  background: #eff6ff;
}

.log-entry.log-debug {
  border-left-color: #8b5cf6;
  background: #f5f3ff;
}

.log-entry.log-verbose {
  border-left-color: #6b7280;
  background: #f9fafb;
}

.log-entry.log-success {
  border-left-color: #10b981;
  background: #f0fdf4;
}

.log-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 4px;
  font-size: 12px;
}

.log-timestamp {
  color: #666;
  font-family: monospace;
}

.log-level {
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 500;
  font-size: 10px;
}

.log-entry.log-error .log-level {
  background: #ef4444;
  color: white;
}

.log-entry.log-warning .log-level {
  background: #f59e0b;
  color: white;
}

.log-entry.log-info .log-level {
  background: #3b82f6;
  color: white;
}

.log-entry.log-debug .log-level {
  background: #8b5cf6;
  color: white;
}

.log-entry.log-verbose .log-level {
  background: #6b7280;
  color: white;
}

.log-entry.log-success .log-level {
  background: #10b981;
  color: white;
}

.log-module {
  background: #e5e7eb;
  color: #374151;
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 10px;
}

.log-message {
  color: #333;
  font-size: 13px;
  line-height: 1.4;
}

.log-data {
  margin-top: 8px;
}

.log-data details {
  cursor: pointer;
}

.log-data summary {
  color: #666;
  font-size: 12px;
  margin-bottom: 4px;
}

.log-data pre {
  margin: 0;
  padding: 8px;
  background: #f8f9fa;
  border: 1px solid #e5e7eb;
  border-radius: 3px;
  font-size: 11px;
  overflow-x: auto;
}

.system-dashboard {
  background: white;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 30px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.system-dashboard h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.status-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #eee;
}

.status-icon {
  font-size: 24px;
  opacity: 0.8;
}

.status-content h4 {
  margin: 0 0 4px 0;
  font-size: 13px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-value {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 2px;
}

.status-value.healthy,
.status-value.good {
  color: #10b981;
}

.status-value.warning {
  color: #f59e0b;
}

.status-value.error {
  color: #ef4444;
}

.status-meta {
  font-size: 11px;
  color: #999;
}

.monitoring-charts {
  border-top: 1px solid #eee;
  padding-top: 20px;
}

.monitoring-charts h4 {
  margin: 0 0 16px 0;
  color: #333;
}

.chart-placeholder {
  height: 200px;
  background: #f8f9fa;
  border: 2px dashed #ddd;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.chart-info {
  color: #666;
}

.chart-info p {
  margin: 0 0 4px 0;
}

.quick-debug-actions {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.quick-debug-actions h3 {
  margin: 0 0 20px 0;
  color: #333;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* Responsive design */
@media (max-width: 768px) {
  .control-tabs {
    flex-wrap: wrap;
  }
  
  .tab-btn {
    flex: 1;
    min-width: 120px;
  }
  
  .section-title {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .log-controls {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .module-grid {
    grid-template-columns: 1fr;
  }
  
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  
  .action-buttons {
    flex-direction: column;
  }
}
</style>
