import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import { PeerPigeonMesh } from 'peerpigeon';

export const usePeerPigeonStore = defineStore('peerpigeon', () => {
  // ── Core State ────────────────────────────────────────────────────────────
  const mesh = ref(null);
  const peerId = ref('Initializing...');
  const isConnected = ref(false);
  const networkName = ref('test');
  const allowGlobalFallback = ref(false);
  const signalingUrl = ref('wss://peer.ooo/ws');

  const peers = reactive(new Map());           // peerId -> peerInfo obj
  const discoveredPeers = reactive(new Map()); // peerId -> { peerId, discoveredAt }

  const networkStatus = reactive({
    connectedCount: 0,
    discoveredCount: 0,
    maxPeers: 6,
    minPeers: 1,
    autoDiscovery: true,
    evictionStrategy: true,
    xorRouting: true,
    uptime: 0,
    signalingUrl: null,
    canAcceptMore: true
  });

  // ── Messages ──────────────────────────────────────────────────────────────
  const messages = ref([]);
  const directMessages = reactive(new Map()); // peerId -> message[]

  // ── Debug Log ─────────────────────────────────────────────────────────────
  const debugLogs = ref([]);
  const dhtLogs = ref([]);
  const cryptoLogs = ref([]);
  const storageLogs = ref([]);

  // ── DHT ───────────────────────────────────────────────────────────────────
  const dhtData = reactive(new Map()); // key -> { value, version, timestamp }
  const activeSubscriptions = ref(new Set());

  // ── Crypto ────────────────────────────────────────────────────────────────
  const cryptoState = reactive({
    initialized: false,
    publicKey: null,
    peerKeys: new Map()
  });

  // ── Media ─────────────────────────────────────────────────────────────────
  const mediaState = reactive({
    localStream: null,
    remoteStreams: new Map(),
    isActive: false
  });

  // ── Testing ───────────────────────────────────────────────────────────────
  const testResults = ref([]);
  const connectionStats = ref([]);
  const isMonitoring = ref(false);
  let unloadBound = false;

  // ── Computed ──────────────────────────────────────────────────────────────
  const connectedPeerList = computed(() =>
    Array.from(peers.values()).filter(p => p.connected)
  );

  // ── Init ──────────────────────────────────────────────────────────────────
  const initMesh = async () => {
    if (mesh.value) {
      try { mesh.value.disconnect(); } catch { /* ignore */ }
      mesh.value = null;
    }

    const m = new PeerPigeonMesh({
      enableWebDHT: true,
      enableCrypto: true,
      enableDistributedStorage: true,
      networkName: networkName.value,
      allowGlobalFallback: allowGlobalFallback.value,
      maxPeers: 6,
      minPeers: 1,
      autoConnect: true,
      autoDiscovery: true,
      evictionStrategy: true,
      xorRouting: true,
    });

    peerId.value = m.peerId;

    await m.init();
    mesh.value = m;
    peerId.value = m.peerId || peerId.value;

    if (!unloadBound && typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        try { mesh.value?.disconnect?.(); } catch { /* ignore */ }
      });
      unloadBound = true;
    }

    setupEventHandlers(m);
    updateNetworkStatus();
    addDebugLog('PeerPigeon initialized', 'success');
    return m;
  };

  // ── Event Handlers ────────────────────────────────────────────────────────
  const setupEventHandlers = (m) => {
    m.addEventListener('statusChanged', (event) => {
      const level = event.type === 'error' ? 'error'
        : event.type === 'disconnected' ? 'warning'
        : event.type === 'connected' ? 'success' : 'info';
      addDebugLog(`Status [${event.type}]: ${event.message || ''}`, level);

      if (event.type === 'connected') {
        isConnected.value = true;
        peerId.value = m.peerId || peerId.value;
      } else if (event.type === 'disconnected') {
        isConnected.value = false;
        peers.clear();
        discoveredPeers.clear();
      } else if (event.type === 'setting' && event.setting === 'networkName') {
        networkName.value = event.value;
      }

      updateNetworkStatus();
    });

    m.addEventListener('peerConnected', (event) => {
      peers.set(event.peerId, {
        id: event.peerId,
        connected: true,
        connectionTime: new Date(),
        status: 'connected'
      });
      updateNetworkStatus();
      addDebugLog(`Peer connected: ${event.peerId.substring(0, 8)}...`, 'success');
    });

    m.addEventListener('peerDisconnected', (event) => {
      const peer = peers.get(event.peerId);
      if (peer) {
        peer.connected = false;
        peer.status = 'disconnected';
        peer.disconnectionReason = event.reason;
      }
      updateNetworkStatus();
      addDebugLog(`Peer disconnected: ${event.peerId.substring(0, 8)}... (${event.reason})`, 'warning');
    });

    m.addEventListener('statusChanged', (event) => {
      if (event.type === 'peer-error') {
        addDebugLog(`Peer error${event.peerId ? ` ${event.peerId.substring(0, 8)}...` : ''}: ${event.message}`, 'error');
      }
      if (event.type === 'protocol-debug' || event.type === 'protocol-membership') {
        addDebugLog(`Protocol [${event.type}]: ${event.message}`, 'info');
      }
    });

    m.addEventListener('peerDiscovered', (event) => {
      discoveredPeers.set(event.peerId, {
        peerId: event.peerId,
        discoveredAt: Date.now()
      });
      addDebugLog(`Peer discovered: ${event.peerId.substring(0, 8)}...`, 'info');
      updateNetworkStatus();
    });

    m.addEventListener('messageReceived', (event) => {
      const selfId = m.peerId;
      if (event.from && event.from === selfId) return;

      const filteredTypes = new Set([
        'signaling-relay', 'peer-announce-relay', 'bootstrap-keepalive',
        'client-peer-announcement', 'cross-bootstrap-signaling', 'dht',
        'eviction', 'renegotiation-offer', 'renegotiation-answer',
        'signaling', 'binary', 'key_exchange', 'media-offer', 'media-answer',
        'media-ice', 'media-stop', 'cecr-state'
      ]);

      const rawContent = event.message ?? event.content ?? event.data ?? null;

      const isInternal = (() => {
        if (!rawContent) return true;
        try {
          const obj = typeof rawContent === 'object' ? rawContent : null;
          if (obj) {
            if (obj.type && filteredTypes.has(obj.type)) return true;
            if (obj.event) return true;
          }
        } catch { /* ignore */ }
        return false;
      })();

      if (isInternal) return;

      let displayContent = rawContent;
      let isEncrypted = false;

      if (displayContent && typeof displayContent === 'object') {
        if (displayContent.encrypted && displayContent.message) {
          isEncrypted = true;
          displayContent = displayContent.message;
        } else if (displayContent.message) {
          displayContent = displayContent.message;
        } else if (displayContent.encrypted_broadcast) {
          isEncrypted = true;
          displayContent = displayContent.message || JSON.stringify(displayContent);
        }
      }

      if (!displayContent && displayContent !== 0) return;
      if (typeof displayContent === 'string' && displayContent.trim().length === 0) return;

      const msg = {
        id: event.messageId || Date.now().toString(),
        content: displayContent,
        from: event.from,
        timestamp: new Date(),
        type: event.subtype || (event.direct ? 'direct' : 'broadcast'),
        fromShort: (event.from?.substring(0, 8) + '...') || 'unknown',
        encrypted: isEncrypted || !!event.encrypted
      };

      if (event.direct || event.subtype === 'direct') {
        const key = event.from;
        if (!directMessages.has(key)) directMessages.set(key, []);
        directMessages.get(key).push(msg);
      } else {
        messages.value.push(msg);
        if (messages.value.length > 200) messages.value.shift();
      }

      addDebugLog(`Message from ${msg.fromShort}: ${typeof msg.content === 'string' ? msg.content.substring(0, 60) : JSON.stringify(msg.content).substring(0, 60)}`, 'info');
    });

    m.addEventListener('localStreamStarted', () => {
      mediaState.localStream = m.getMediaState().hasStream ? true : null;
      addDebugLog('Local media stream started', 'success');
    });

    m.addEventListener('localStreamStopped', () => {
      mediaState.localStream = null;
      mediaState.isActive = false;
      addDebugLog('Local media stream stopped', 'info');
    });

    m.addEventListener('remoteStream', (event) => {
      mediaState.remoteStreams.set(event.peerId, { stream: event.stream, peerId: event.peerId });
      addDebugLog(`Remote stream from ${event.peerId.substring(0, 8)}...`, 'success');
    });

    m.addEventListener('remoteStreamEnded', (event) => {
      mediaState.remoteStreams.delete(event.peerId);
      addDebugLog(`Remote stream ended: ${event.peerId.substring(0, 8)}...`, 'info');
    });

    m.addEventListener('dhtValueChanged', (event) => {
      dhtData.set(event.key, { value: event.newValue, version: event.version, timestamp: new Date() });
      addDHTLog(`DHT value changed: ${event.key} = ${JSON.stringify(event.newValue)}`);
    });

    m.addEventListener('storageDataStored', (event) => {
      addStorageLog(`Data stored: ${event.key}`, 'success');
    });

    m.addEventListener('cryptoReady', () => {
      cryptoState.initialized = true;
      cryptoState.publicKey = m.exportPublicKey();
      addCryptoLog('Crypto system ready', 'success');
    });

    m.addEventListener('peerKeyAdded', (event) => {
      cryptoState.peerKeys.set(event.peerId, event.publicKey);
      addCryptoLog(`Key exchange complete with ${event.peerId.substring(0, 8)}...`, 'success');
    });

    m.addEventListener('connectionStats', (stats) => {
      connectionStats.value.push({ ...stats, timestamp: Date.now() });
      if (connectionStats.value.length > 100) connectionStats.value.shift();
    });

    m.addEventListener('selectiveStreamStarted', (event) => {
      addDebugLog(`Selective streaming started to ${event.targetPeerIds?.length || 0} peer(s)`, 'info');
    });
    m.addEventListener('selectiveStreamStopped', (event) => {
      addDebugLog(`Selective streaming stopped${event.returnToBroadcast ? ' (broadcast mode)' : ''}`, 'info');
    });
    m.addEventListener('broadcastStreamEnabled', () => {
      addDebugLog('Broadcast streaming enabled', 'info');
    });
    m.addEventListener('streamingBlockedToPeers', (event) => {
      addDebugLog(`Streaming blocked to ${event.blockedPeerIds?.length || 0} peer(s)`, 'warning');
    });
    m.addEventListener('streamingAllowedToPeers', (event) => {
      addDebugLog(`Streaming allowed to ${event.allowedPeerIds?.length || 0} peer(s)`, 'success');
    });
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const connect = async () => {
    if (!mesh.value) await initMesh();
    try {
      if (mesh.value.setNetworkName) mesh.value.setNetworkName(networkName.value);
      if (mesh.value.setAllowGlobalFallback) mesh.value.setAllowGlobalFallback(allowGlobalFallback.value);
      addDebugLog(`Connecting to ${signalingUrl.value} on network "${networkName.value}"...`, 'info');
      await mesh.value.connect(signalingUrl.value);
    } catch (e) {
      addDebugLog(`Connection failed: ${e.message}`, 'error');
      throw e;
    }
  };

  const disconnect = () => {
    if (mesh.value) {
      mesh.value.disconnect();
      isConnected.value = false;
      peers.clear();
      discoveredPeers.clear();
      networkStatus.connectedCount = 0;
      addDebugLog('Disconnected', 'info');
    }
  };

  const updateNetworkStatus = () => {
    if (!mesh.value) return;
    const status = mesh.value.getStatus();
    networkStatus.connectedCount = status.connectedCount;
    networkStatus.discoveredCount = status.discoveredCount;
    networkStatus.maxPeers = status.maxPeers;
    networkStatus.minPeers = status.minPeers;
    networkStatus.autoDiscovery = status.autoDiscovery;
    networkStatus.evictionStrategy = status.evictionStrategy;
    networkStatus.xorRouting = status.xorRouting;
    networkStatus.uptime = status.uptime;
    networkStatus.signalingUrl = status.signalingUrl;
    networkStatus.canAcceptMore = mesh.value.canAcceptMorePeers?.() ?? true;
  };

  // ── Log Helpers ───────────────────────────────────────────────────────────
  const addDebugLog = (message, level = 'info') => {
    debugLogs.value.push({ message, level, timestamp: new Date() });
    if (debugLogs.value.length > 200) debugLogs.value.shift();
  };

  const addDHTLog = (message, level = 'info') => {
    dhtLogs.value.push({ message, level, timestamp: new Date() });
    if (dhtLogs.value.length > 100) dhtLogs.value.shift();
  };

  const addCryptoLog = (message, level = 'info') => {
    cryptoLogs.value.push({ message, level, timestamp: new Date() });
    if (cryptoLogs.value.length > 100) cryptoLogs.value.shift();
  };

  const addStorageLog = (message, level = 'info') => {
    storageLogs.value.push({ message, level, timestamp: new Date() });
    if (storageLogs.value.length > 100) storageLogs.value.shift();
  };

  return {
    // State
    mesh, peerId, isConnected, networkName, allowGlobalFallback, signalingUrl,
    peers, discoveredPeers, networkStatus,
    messages, directMessages,
    debugLogs, dhtLogs, cryptoLogs, storageLogs,
    dhtData, activeSubscriptions,
    cryptoState,
    mediaState,
    testResults, connectionStats, isMonitoring,
    // Computed
    connectedPeerList,
    // Actions
    initMesh, connect, disconnect, updateNetworkStatus,
    addDebugLog, addDHTLog, addCryptoLog, addStorageLog,
  };
});
