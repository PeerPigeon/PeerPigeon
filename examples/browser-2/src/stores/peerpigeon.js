import { defineStore } from 'pinia';
import { ref, reactive, computed, markRaw } from 'vue';

// Helper to wait for PeerPigeon to be available
const waitForPeerPigeon = (maxWait = 5000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = 100;
    
    const check = () => {
      if (window.PeerPigeon?.PeerPigeonMesh) {
        console.log('✅ PeerPigeon loaded successfully');
        resolve(window.PeerPigeon);
      } else if (Date.now() - startTime > maxWait) {
        console.error('❌ PeerPigeon failed to load within timeout');
        reject(new Error('PeerPigeon library not available'));
      } else {
        setTimeout(check, checkInterval);
      }
    };
    
    check();
  });
};

export const usePeerPigeonStore = defineStore('peerpigeon', () => {
  // Core state  
  const mesh = ref(null); // Will be wrapped with markRaw to prevent reactivity issues
  const isInitialized = ref(false);
  const isConnected = ref(false);
  const signalingUrl = ref('ws://localhost:3000');
  const peerId = ref('');
  
  // Network namespace state
  const networkName = ref('global');
  const originalNetworkName = ref('global');
  const isInFallbackMode = ref(false);
  const allowGlobalFallback = ref(true);
  
  // Network state
  const peers = reactive(new Map());
  const discoveredPeers = reactive(new Map());
  const networkStatus = reactive({
    connectedCount: 0,
    maxPeers: 4,
    minPeers: 2,
    autoConnect: true,
    autoDiscovery: true,
    evictionStrategy: true,
    xorRouting: true
  });
  
  // Messages
  const messages = ref([]);
  const directMessages = reactive(new Map());
  
  // Media state
  const mediaState = reactive({
    localStream: null,
    remoteStreams: new Map(),
    audioEnabled: false,
    videoEnabled: false,
    devices: []
  });
  
  // DHT state
  const dhtData = reactive(new Map());
  const dhtStats = reactive({});
  
  // Storage state
  const storageData = reactive(new Map());
  const storageStats = reactive({});
  
  // Crypto state
  const cryptoKeys = ref([]);
  const cryptoState = reactive({
    enabled: false,
    initialized: false,
    publicKey: '',
    peerKeys: new Map()
  });
  
  // Debug state
  const debugLogs = ref([]);
  const debugModules = ref([]);
  const enabledModules = ref(new Set());
  
  // Computed
  const connectedPeersList = computed(() => {
    return Array.from(peers.values()).filter(peer => peer.connected);
  });
  
  const canAcceptMorePeers = computed(() => {
    return networkStatus.connectedCount < networkStatus.maxPeers;
  });
  
  // Core methods
  const initMesh = async (options = {}) => {
    try {
      // Wait for PeerPigeon to be available
      addDebugLog('Waiting for PeerPigeon library to load...', 'info');
      
      let PeerPigeonLib;
      try {
        PeerPigeonLib = await waitForPeerPigeon();
      } catch (error) {
        console.error('❌ PeerPigeon not available:', error);
        addDebugLog('PeerPigeon library not found - using mock', 'error');
        PeerPigeonLib = null;
      }
      
      // Debug: Check if PeerPigeon is available
      console.log('🔍 PeerPigeon availability:', {
        available: !!PeerPigeonLib,
        PeerPigeonMesh: !!(PeerPigeonLib?.PeerPigeonMesh),
        keys: PeerPigeonLib ? Object.keys(PeerPigeonLib) : []
      });
      
      // Use real PeerPigeonMesh if available, otherwise mock
      const PeerPigeonMeshClass = PeerPigeonLib?.PeerPigeonMesh;
      
      if (!PeerPigeonMeshClass) {
        console.error('❌ PeerPigeonMesh not found! Using mock implementation.');
        addDebugLog('Using mock PeerPigeon implementation', 'warning');
        
        // Fallback to mock implementation for development
        const MockPeerPigeonMesh = class {
          constructor(meshOptions) {
            this.options = meshOptions;
            this.peerId = 'mock-peer-' + Math.random().toString(36).substr(2, 9);
            this.eventListeners = new Map();
            this.networkName = meshOptions.networkName || 'global';
            this.originalNetworkName = this.networkName;
            this.isInFallbackMode = false;
            this.allowGlobalFallback = meshOptions.allowGlobalFallback !== false;
          }
          
          async init() { 
            addDebugLog('Mock mesh initialized', 'success');
            return true; 
          }
          
          async connect(url) { 
            addDebugLog(`Mock connected to ${url}`, 'success');
            return true; 
          }
          
          disconnect() {
            addDebugLog('Mock disconnected', 'info');
          }
          
          addEventListener(event, handler) {
            if (!this.eventListeners.has(event)) {
              this.eventListeners.set(event, []);
            }
            this.eventListeners.get(event).push(handler);
          }
          
          sendMessage(content) { 
            addDebugLog(`Mock broadcast: ${JSON.stringify(content)}`, 'info');
            return 'mock-message-id-' + Date.now(); 
          }
          
          sendDirectMessage(peerId, content) { 
            addDebugLog(`Mock direct to ${peerId}: ${JSON.stringify(content)}`, 'info');
            return 'mock-message-id-' + Date.now(); 
          }
          
          getStatus() { 
            return { 
              connectedCount: 0, 
              maxPeers: networkStatus.maxPeers, 
              minPeers: networkStatus.minPeers,
              autoDiscovery: networkStatus.autoDiscovery,
              evictionStrategy: networkStatus.evictionStrategy,
              xorRouting: networkStatus.xorRouting,
              networkName: this.networkName,
              originalNetworkName: this.originalNetworkName,
              isInFallbackMode: this.isInFallbackMode,
              allowGlobalFallback: this.allowGlobalFallback
            }; 
          }
          
          setNetworkName(name) {
            this.networkName = name || 'global';
            this.originalNetworkName = this.networkName;
            this.isInFallbackMode = false;
            addDebugLog(`Mock network changed to: ${this.networkName}`, 'info');
            return this.networkName;
          }
          
          getNetworkName() {
            return this.networkName;
          }
          
          getOriginalNetworkName() {
            return this.originalNetworkName;
          }
          
          isUsingGlobalFallback() {
            return this.isInFallbackMode;
          }
          
          setAllowGlobalFallback(allow) {
            this.allowGlobalFallback = allow;
            addDebugLog(`Mock global fallback ${allow ? 'enabled' : 'disabled'}`, 'info');
            return this.allowGlobalFallback;
          }
          
          async startMedia(options) {
            addDebugLog(`Mock media started: ${JSON.stringify(options)}`, 'info');
            return null; // Mock stream
          }
          
          async stopMedia() {
            addDebugLog('Mock media stopped', 'info');
          }
          
          async dhtPut(key, _value, _options) {
            addDebugLog(`Mock DHT PUT: ${key}`, 'info');
            return true;
          }
          
          async dhtGet(key, _options) {
            addDebugLog(`Mock DHT GET: ${key}`, 'info');
            return null;
          }
          
          getDHTStats() {
            return { entries: 0, peers: 0 };
          }
          
          get distributedStorage() {
            return {
              store: async (key, _value, _options) => {
                addDebugLog(`Mock storage STORE: ${key}`, 'info');
                return true;
              },
              retrieve: async (key, _options) => {
                addDebugLog(`Mock storage RETRIEVE: ${key}`, 'info');
                return null;
              },
              getStats: async () => ({ items: 0, size: 0 })
            };
          }
          
          get cryptoManager() {
            return {
              init: async () => true,
              getPublicKey: () => 'mock-public-key'
            };
          }
        };
        
        const meshOptions = {
          enableWebDHT: true,
          enableCrypto: true,
          enableDistributedStorage: true,
          networkName: networkName.value,
          allowGlobalFallback: allowGlobalFallback.value,
          maxPeers: networkStatus.maxPeers,
          minPeers: networkStatus.minPeers,
          autoConnect: true,
          autoDiscovery: networkStatus.autoDiscovery,
          evictionStrategy: networkStatus.evictionStrategy,
          xorRouting: networkStatus.xorRouting,
          ...options
        };
        
        mesh.value = markRaw(new MockPeerPigeonMesh(meshOptions));
      } else {
        // Use real PeerPigeonMesh
        console.log('🚀 Initializing real PeerPigeonMesh with options:', {
          networkName: networkName.value,
          maxPeers: networkStatus.maxPeers,
          autoConnect: true,
          autoDiscovery: networkStatus.autoDiscovery
        });
        
        const meshOptions = {
          enableWebDHT: true,
          enableCrypto: true,
          enableDistributedStorage: true,
          networkName: networkName.value,
          allowGlobalFallback: allowGlobalFallback.value,
          maxPeers: networkStatus.maxPeers,
          minPeers: networkStatus.minPeers,
          autoConnect: true,
          autoDiscovery: networkStatus.autoDiscovery,
          evictionStrategy: networkStatus.evictionStrategy,
          xorRouting: networkStatus.xorRouting,
          ...options
        };
        
        // CRITICAL: Use markRaw to prevent Vue from making mesh reactive
        // Vue's Proxy wrapper can interfere with WebRTC connections
        mesh.value = markRaw(new PeerPigeonMeshClass(meshOptions));
        console.log('✅ PeerPigeonMesh instance created (marked as raw)');
      }
      
      setupEventHandlers();
      
      // Use raw instance for init to avoid Vue proxy issues
      await mesh.value.init();
      isInitialized.value = true;
      peerId.value = mesh.value.peerId;
      
      // Update network state from mesh
      if (mesh.value.getNetworkName) {
        networkName.value = mesh.value.getNetworkName();
        originalNetworkName.value = mesh.value.getOriginalNetworkName();
        isInFallbackMode.value = mesh.value.isUsingGlobalFallback();
      }
      
      // Initialize crypto if enabled
      if (mesh.value.cryptoManager) {
        await mesh.value.cryptoManager.init();
        cryptoState.enabled = true;
        cryptoState.initialized = true;
        cryptoState.publicKey = mesh.value.cryptoManager.getPublicKey();
      }
      
      addDebugLog(`Mesh initialized successfully in network: ${networkName.value}`, 'success');
      return true;
    } catch (error) {
      addDebugLog(`Failed to initialize mesh: ${error.message}`, 'error');
      throw error;
    }
  };
  
  const connectToSignaling = async (url) => {
    if (!mesh.value || !isInitialized.value) {
      throw new Error('Mesh not initialized');
    }
    
    try {
      signalingUrl.value = url;
      await mesh.value.connect(url);
      isConnected.value = true;
      addDebugLog(`Connected to signaling server: ${url}`, 'success');
      return true;
    } catch (error) {
      addDebugLog(`Failed to connect to signaling server: ${error.message}`, 'error');
      throw error;
    }
  };
  
  const disconnect = () => {
    if (mesh.value) {
      mesh.value.disconnect();
      isConnected.value = false;
      peers.clear();
      discoveredPeers.clear();
      networkStatus.connectedCount = 0;
      addDebugLog('Disconnected from mesh', 'info');
    }
  };
  
  // Event handlers setup
  const setupEventHandlers = () => {
    if (!mesh.value) return;
    
    // Connection events
    mesh.value.addEventListener('statusChanged', (event) => {
      addDebugLog(`Status: ${event.type} - ${event.message || ''}`, 'info');
      
      // Handle network-specific status changes
      if (event.type === 'network') {
        networkName.value = event.networkName || networkName.value;
        isInFallbackMode.value = event.fallbackMode || false;
        addDebugLog(`Network status: ${event.message}`, event.fallbackMode ? 'warning' : 'info');
      }
      
      // Handle settings changes
      if (event.type === 'setting') {
        if (event.setting === 'networkName') {
          networkName.value = event.value;
        } else if (event.setting === 'allowGlobalFallback') {
          allowGlobalFallback.value = event.value;
        }
      }
      
      updateNetworkStatus();
    });
    
    mesh.value.addEventListener('peerConnected', (event) => {
      console.log('🤝 PEER CONNECTED EVENT:', event);
      const peerInfo = {
        id: event.peerId,
        connected: true,
        connectionTime: new Date(),
        status: 'connected'
      };
      peers.set(event.peerId, peerInfo);
      updateNetworkStatus();
      addDebugLog(`Peer connected: ${event.peerId.substring(0, 8)}...`, 'success');
    });
    
    mesh.value.addEventListener('peerDisconnected', (event) => {
      console.log('👋 PEER DISCONNECTED EVENT:', event);
      const peer = peers.get(event.peerId);
      if (peer) {
        peer.connected = false;
        peer.status = 'disconnected';
        peer.disconnectionTime = new Date();
        peer.disconnectionReason = event.reason;
      }
      updateNetworkStatus();
      addDebugLog(`Peer disconnected: ${event.peerId.substring(0, 8)}... (${event.reason})`, 'warning');
    });
    
    mesh.value.addEventListener('peerDiscovered', (event) => {
      console.log('🔍 PEER DISCOVERED EVENT:', event);
      discoveredPeers.set(event.peerId, {
        id: event.peerId,
        discoveryTime: new Date(),
        status: 'discovered'
      });
      addDebugLog(`Peer discovered: ${event.peerId.substring(0, 8)}...`, 'info');
    });
    
    // Message events
    mesh.value.addEventListener('messageReceived', (event) => {
      const message = {
        id: event.messageId || Date.now().toString(),
        content: event.message || event.content,
        from: event.from,
        timestamp: new Date(),
        type: event.subtype || 'broadcast',
        fromPeerId: event.from?.substring(0, 8) + '...' || 'unknown'
      };
      
      if (event.subtype === 'direct') {
        if (!directMessages.has(event.from)) {
          directMessages.set(event.from, []);
        }
        directMessages.get(event.from).push(message);
      } else {
        messages.value.push(message);
      }
      
      addDebugLog(`Message received from ${message.fromPeerId}: ${JSON.stringify(message.content)}`, 'info');
    });
    
    // Media events
    mesh.value.addEventListener('localStreamStarted', (event) => {
      mediaState.localStream = event.stream;
      addDebugLog('Local media stream started', 'success');
    });
    
    mesh.value.addEventListener('localStreamStopped', () => {
      mediaState.localStream = null;
      addDebugLog('Local media stream stopped', 'info');
    });
    
    mesh.value.addEventListener('remoteStream', (event) => {
      mediaState.remoteStreams.set(event.peerId, {
        stream: event.stream,
        peerId: event.peerId,
        startTime: new Date()
      });
      addDebugLog(`Remote stream received from ${event.peerId.substring(0, 8)}...`, 'success');
    });
    
    mesh.value.addEventListener('remoteStreamEnded', (event) => {
      mediaState.remoteStreams.delete(event.peerId);
      addDebugLog(`Remote stream ended from ${event.peerId.substring(0, 8)}...`, 'info');
    });
    
    // DHT events
    mesh.value.addEventListener('dhtValueChanged', (event) => {
      dhtData.set(event.key, {
        value: event.newValue,
        timestamp: new Date(),
        version: event.version
      });
      addDebugLog(`DHT value changed: ${event.key}`, 'info');
    });
    
    // Storage events
    mesh.value.addEventListener('storageDataStored', (event) => {
      addDebugLog(`Storage data stored: ${event.key}`, 'success');
    });
    
    mesh.value.addEventListener('storageDataUpdated', (event) => {
      addDebugLog(`Storage data updated: ${event.key} (version ${event.version})`, 'info');
    });
    
    // Crypto events
    mesh.value.addEventListener('cryptoReady', () => {
      cryptoState.initialized = true;
      addDebugLog('Crypto system ready', 'success');
    });
    
    mesh.value.addEventListener('peerKeyAdded', (event) => {
      cryptoState.peerKeys.set(event.peerId, event.publicKey);
      addDebugLog(`Peer key added: ${event.peerId.substring(0, 8)}...`, 'success');
    });
  };
  
  // Utility methods
  const updateNetworkStatus = () => {
    if (!mesh.value) return;
    
    const status = mesh.value.getStatus();
    networkStatus.connectedCount = status.connectedCount;
    networkStatus.maxPeers = status.maxPeers;
    networkStatus.minPeers = status.minPeers;
    networkStatus.autoDiscovery = status.autoDiscovery;
    networkStatus.evictionStrategy = status.evictionStrategy;
    networkStatus.xorRouting = status.xorRouting;
  };
  
  const addDebugLog = (message, level = 'info') => {
    const log = {
      timestamp: new Date(),
      message,
      level,
      id: Date.now() + Math.random()
    };
    debugLogs.value.push(log);
    
    // Keep only last 100 logs
    if (debugLogs.value.length > 100) {
      debugLogs.value.shift();
    }
  };
  
  // Messaging methods
  const sendBroadcastMessage = (content) => {
    if (!mesh.value || !isConnected.value) {
      throw new Error('Not connected to mesh');
    }
    
    const messageId = mesh.value.sendMessage(content);
    const message = {
      id: messageId,
      content,
      from: peerId.value,
      timestamp: new Date(),
      type: 'broadcast',
      fromPeerId: 'You'
    };
    messages.value.push(message);
    addDebugLog(`Broadcast message sent: ${JSON.stringify(content)}`, 'success');
    return messageId;
  };
  
  const sendDirectMessage = (targetPeerId, content) => {
    if (!mesh.value || !isConnected.value) {
      throw new Error('Not connected to mesh');
    }
    
    const messageId = mesh.value.sendDirectMessage(targetPeerId, content);
    const message = {
      id: messageId,
      content,
      from: peerId.value,
      to: targetPeerId,
      timestamp: new Date(),
      type: 'direct',
      fromPeerId: 'You'
    };
    
    if (!directMessages.has(targetPeerId)) {
      directMessages.set(targetPeerId, []);
    }
    directMessages.get(targetPeerId).push(message);
    addDebugLog(`Direct message sent to ${targetPeerId.substring(0, 8)}...: ${JSON.stringify(content)}`, 'success');
    return messageId;
  };
  
  // Media methods
  const startMedia = async (options = {}) => {
    if (!mesh.value) throw new Error('Mesh not initialized');
    
    const stream = await mesh.value.startMedia(options);
    mediaState.audioEnabled = stream.getAudioTracks().length > 0;
    mediaState.videoEnabled = stream.getVideoTracks().length > 0;
    return stream;
  };
  
  const stopMedia = async () => {
    if (!mesh.value) return;
    
    await mesh.value.stopMedia();
    mediaState.audioEnabled = false;
    mediaState.videoEnabled = false;
  };
  
  // DHT methods
  const dhtPut = async (key, value, options = {}) => {
    if (!mesh.value) throw new Error('Mesh not initialized');
    
    const success = await mesh.value.dhtPut(key, value, options);
    if (success) {
      dhtData.set(key, {
        value,
        timestamp: new Date(),
        local: true
      });
      addDebugLog(`DHT put: ${key}`, 'success');
    }
    return success;
  };
  
  const dhtGet = async (key, options = {}) => {
    if (!mesh.value) throw new Error('Mesh not initialized');
    
    const value = await mesh.value.dhtGet(key, options);
    if (value !== null) {
      dhtData.set(key, {
        value,
        timestamp: new Date(),
        local: false
      });
      addDebugLog(`DHT get: ${key}`, 'success');
    }
    return value;
  };
  
  const getDHTStats = () => {
    if (!mesh.value) return {};
    return mesh.value.getDHTStats();
  };
  
  // Storage methods
  const storageStore = async (key, value, options = {}) => {
    if (!mesh.value?.distributedStorage) throw new Error('Distributed storage not available');
    
    const result = await mesh.value.distributedStorage.store(key, value, options);
    storageData.set(key, {
      value,
      options,
      timestamp: new Date(),
      local: true
    });
    return result;
  };
  
  const storageRetrieve = async (key, options = {}) => {
    if (!mesh.value?.distributedStorage) throw new Error('Distributed storage not available');
    
    const value = await mesh.value.distributedStorage.retrieve(key, options);
    if (value !== null) {
      storageData.set(key, {
        value,
        timestamp: new Date(),
        local: false
      });
    }
    return value;
  };
  
  const getStorageStats = async () => {
    if (!mesh.value?.distributedStorage) return {};
    return await mesh.value.distributedStorage.getStats();
  };
  
  // Debug methods
  const getDebugModules = () => {
    // Return the debug logger modules if available
    if (mesh.value?.debugLogger) {
      return mesh.value.debugLogger.getModules();
    }
    return ['PeerPigeonMesh', 'ConnectionManager', 'GossipManager', 'WebDHT', 'CryptoManager', 'MediaManager'];
  };
  
  const enableDebugModule = (moduleName) => {
    enabledModules.value.add(moduleName);
    // Enable the module in DebugLogger if available
    if (mesh.value?.debugLogger) {
      mesh.value.debugLogger.enable(moduleName);
    }
    addDebugLog(`Debug enabled for module: ${moduleName}`, 'info');
  };
  
  const disableDebugModule = (moduleName) => {
    enabledModules.value.delete(moduleName);
    // Disable the module in DebugLogger if available
    if (mesh.value?.debugLogger) {
      mesh.value.debugLogger.disable(moduleName);
    }
    addDebugLog(`Debug disabled for module: ${moduleName}`, 'info');
  };
  
  const clearDebugLogs = () => {
    debugLogs.value = [];
  };

  // Crypto methods (placeholder implementations)
  const initializeCrypto = async () => {
    try {
      cryptoState.initialized = true;
      addDebugLog('Crypto system initialized', 'success');
      return true;
    } catch (error) {
      addDebugLog(`Crypto initialization failed: ${error.message}`, 'error');
      return false;
    }
  };

  const cryptoGenerateKey = async (type, size, name) => {
    try {
      const keyPair = {
        id: Date.now().toString(),
        name,
        type,
        size,
        algorithm: type,
        usage: ['encrypt', 'decrypt', 'sign', 'verify'],
        extractable: true,
        created: Date.now(),
        fingerprint: Math.random().toString(36).substring(2)
      };
      
      cryptoKeys.value.push(keyPair);
      addDebugLog(`Generated ${type} key: ${name}`, 'success');
      return keyPair;
    } catch (error) {
      addDebugLog(`Key generation failed: ${error.message}`, 'error');
      return null;
    }
  };

  const cryptoImportKey = async (keyData, name) => {
    try {
      const key = {
        id: Date.now().toString(),
        name,
        type: 'imported',
        algorithm: 'RSA',
        usage: ['encrypt', 'decrypt'],
        extractable: true,
        created: Date.now(),
        fingerprint: Math.random().toString(36).substring(2)
      };
      
      cryptoKeys.value.push(key);
      addDebugLog(`Imported key: ${name}`, 'success');
      return true;
    } catch (error) {
      addDebugLog(`Key import failed: ${error.message}`, 'error');
      return false;
    }
  };

  const cryptoEncrypt = async (data, keyId, _options) => {
    try {
      // Mock encryption - in real implementation would use WebCrypto
      const encrypted = btoa(JSON.stringify(data));
      addDebugLog(`Data encrypted with key: ${keyId}`, 'success');
      return encrypted;
    } catch (error) {
      addDebugLog(`Encryption failed: ${error.message}`, 'error');
      return null;
    }
  };

  const cryptoDecrypt = async (encryptedData, keyId) => {
    try {
      // Mock decryption
      const decrypted = JSON.parse(atob(encryptedData));
      addDebugLog(`Data decrypted with key: ${keyId}`, 'success');
      return decrypted;
    } catch (error) {
      addDebugLog(`Decryption failed: ${error.message}`, 'error');
      return null;
    }
  };

  const cryptoSign = async (data, keyId, _options) => {
    try {
      // Mock signing
      const signature = btoa(data + keyId + Date.now());
      addDebugLog(`Data signed with key: ${keyId}`, 'success');
      return signature;
    } catch (error) {
      addDebugLog(`Signing failed: ${error.message}`, 'error');
      return null;
    }
  };

  const cryptoVerify = async (data, signature, keyId) => {
    try {
      // Mock verification - always returns true for demo
      addDebugLog(`Signature verified with key: ${keyId}`, 'success');
      return true;
    } catch (error) {
      addDebugLog(`Verification failed: ${error.message}`, 'error');
      return false;
    }
  };

  const cryptoKeyExchange = async (peerId, method, purpose) => {
    try {
      const exchange = {
        keyId: Date.now().toString(),
        peerId,
        method,
        purpose,
        created: Date.now()
      };
      addDebugLog(`Key exchange initiated: ${method}`, 'success');
      return exchange;
    } catch (error) {
      addDebugLog(`Key exchange failed: ${error.message}`, 'error');
      return null;
    }
  };

  const cryptoRefreshKeys = async () => {
    addDebugLog('Key store refreshed', 'info');
  };

  const cryptoExportKey = async (keyId) => {
    const key = cryptoKeys.value.find(k => k.id === keyId);
    if (key) {
      addDebugLog(`Key exported: ${key.name}`, 'success');
      return { ...key, privateKey: 'mock-private-key' };
    }
    return null;
  };

  const cryptoDeleteKey = async (keyId) => {
    const index = cryptoKeys.value.findIndex(k => k.id === keyId);
    if (index !== -1) {
      const deleted = cryptoKeys.value.splice(index, 1)[0];
      addDebugLog(`Key deleted: ${deleted.name}`, 'info');
      return true;
    }
    return false;
  };

  // Network management methods
  const setNetworkName = (name) => {
    if (mesh.value && mesh.value.setNetworkName) {
      const newName = mesh.value.setNetworkName(name);
      networkName.value = newName;
      originalNetworkName.value = mesh.value.getOriginalNetworkName();
      isInFallbackMode.value = mesh.value.isUsingGlobalFallback();
      addDebugLog(`Network changed to: ${newName}`, 'success');
      return newName;
    } else {
      networkName.value = name || 'global';
      originalNetworkName.value = networkName.value;
      isInFallbackMode.value = false;
      addDebugLog(`Network name set: ${networkName.value}`, 'info');
      return networkName.value;
    }
  };

  const getNetworkInfo = () => {
    return {
      currentNetwork: networkName.value,
      originalNetwork: originalNetworkName.value,
      isInFallbackMode: isInFallbackMode.value,
      allowGlobalFallback: allowGlobalFallback.value
    };
  };

  const setAllowGlobalFallback = (allow) => {
    if (mesh.value && mesh.value.setAllowGlobalFallback) {
      const result = mesh.value.setAllowGlobalFallback(allow);
      allowGlobalFallback.value = result;
      addDebugLog(`Global fallback ${allow ? 'enabled' : 'disabled'}`, 'success');
      return result;
    } else {
      allowGlobalFallback.value = allow;
      addDebugLog(`Global fallback setting: ${allow}`, 'info');
      return allowGlobalFallback.value;
    }
  };

  const forceReturnToOriginalNetwork = async () => {
    if (mesh.value && mesh.value._tryReturnToOriginalNetwork) {
      await mesh.value._tryReturnToOriginalNetwork();
      networkName.value = mesh.value.getNetworkName();
      isInFallbackMode.value = mesh.value.isUsingGlobalFallback();
      addDebugLog('Attempted to return to original network', 'info');
    } else {
      addDebugLog('Force return to original network not available', 'warning');
    }
  };
  
  return {
    // State
    mesh,
    isInitialized,
    isConnected,
    signalingUrl,
    peerId,
    networkName,
    originalNetworkName,
    isInFallbackMode,
    allowGlobalFallback,
    peers,
    discoveredPeers,
    networkStatus,
    messages,
    directMessages,
    mediaState,
    dhtData,
    dhtStats,
    storageData,
    storageStats,
    cryptoKeys,
    cryptoState,
    debugLogs,
    debugModules,
    enabledModules,
    
    // Computed
    connectedPeersList,
    canAcceptMorePeers,
    
    // Methods
    initMesh,
    connectToSignaling,
    disconnect,
    sendBroadcastMessage,
    sendDirectMessage,
    startMedia,
    stopMedia,
    dhtPut,
    dhtGet,
    getDHTStats,
    storageStore,
    storageRetrieve,
    getStorageStats,
    getDebugModules,
    enableDebugModule,
    disableDebugModule,
    clearDebugLogs,
    addDebugLog,
    
    // Network management methods
    setNetworkName,
    getNetworkInfo,
    setAllowGlobalFallback,
    forceReturnToOriginalNetwork,
    
    // Crypto methods
    initializeCrypto,
    cryptoGenerateKey,
    cryptoImportKey,
    cryptoEncrypt,
    cryptoDecrypt,
    cryptoSign,
    cryptoVerify,
    cryptoKeyExchange,
    cryptoRefreshKeys,
    cryptoExportKey,
    cryptoDeleteKey
  };
});
