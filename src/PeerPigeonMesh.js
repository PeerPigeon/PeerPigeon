import { EventEmitter } from './EventEmitter.js';
import { SignalingClient } from './SignalingClient.js';
import { PeerDiscovery } from './PeerDiscovery.js';
import { ConnectionManager } from './ConnectionManager.js';
import { SignalingHandler } from './SignalingHandler.js';
import { EvictionManager } from './EvictionManager.js';
import { MeshOptimizer } from './MeshOptimizer.js';
import { CleanupManager } from './CleanupManager.js';
import { StorageManager } from './StorageManager.js';
import { GossipManager } from './GossipManager.js';
import { MediaManager } from './MediaManager.js';
import { WebDHT } from './WebDHT.js';
import { CryptoManager } from './CryptoManager.js';
import { DistributedStorageManager } from './DistributedStorageManager.js';
import { environmentDetector } from './EnvironmentDetector.js';
import DebugLogger from './DebugLogger.js';

export class PeerPigeonMesh extends EventEmitter {
  constructor(options = {}) {
    super();
    this.debug = DebugLogger.create('PeerPigeonMesh');

    // Validate environment capabilities
    this.environmentReport = this.validateEnvironment(options);

    this.peerId = null;
    this.providedPeerId = options.peerId || null;
    this.signalingClient = null;
    this.peerDiscovery = null;

    // Configuration
    this.maxPeers = 3;
    this.minPeers = 2;
    this.autoDiscovery = true;
    this.evictionStrategy = true;
    this.xorRouting = true;
    this.enableWebDHT = options.enableWebDHT !== false; // Default to true, can be disabled by setting to false
    this.enableCrypto = options.enableCrypto === true; // Default to false, must be explicitly enabled

    // State
    this.connected = false;
    this.polling = false; // Only WebSocket is supported
    this.signalingUrl = null;
    this.discoveredPeers = new Map();
    this.connectionMonitorInterval = null;

    // Initialize managers
    this.storageManager = new StorageManager(this);
    this.mediaManager = new MediaManager();
    this.connectionManager = new ConnectionManager(this);
    this.evictionManager = new EvictionManager(this, this.connectionManager);
    this.meshOptimizer = new MeshOptimizer(this, this.connectionManager, this.evictionManager);
    this.cleanupManager = new CleanupManager(this);
    this.signalingHandler = new SignalingHandler(this, this.connectionManager);
    this.gossipManager = new GossipManager(this, this.connectionManager);
    this.webDHT = null; // Will be initialized after peerId is set
    this.distributedStorage = null; // Will be initialized after WebDHT is set

    // Initialize crypto manager if enabled
    this.cryptoManager = null;
    if (this.enableCrypto) {
      this.cryptoManager = new CryptoManager();
    }

    // Set up inter-module event forwarding
    this.setupManagerEventHandlers();

    // Set up unload handlers
    this.cleanupManager.setupUnloadHandlers();

    // Load saved signaling URL immediately
    this.storageManager.loadSignalingUrlFromStorage();
  }

  setupManagerEventHandlers() {
    // Forward events from managers to main mesh
    this.connectionManager.addEventListener('peersUpdated', () => {
      this.emit('peersUpdated');
    });

    // Handle peer disconnections and trigger keep-alive ping coordination
    this.addEventListener('peerDisconnected', (data) => {
      this.debug.log(`Peer ${data.peerId.substring(0, 8)}... disconnected: ${data.reason}`);
      // Trigger immediate keep-alive ping check in case the disconnected peer was the designated sender
      if (this.signalingClient && this.signalingClient.connected) {
        setTimeout(() => {
          this.signalingClient.triggerKeepAlivePingCheck();
        }, 1000); // Small delay to let peer lists update
      }
    });

    // Handle gossip messages and intercept mesh signaling
    this.gossipManager.addEventListener('messageReceived', (data) => {
      // Check if this is a mesh signaling message
      if (data.message && data.message.type === 'mesh_signaling') {
        this._handleMeshSignalingMessage(data.message, data.from);
        return; // Don't emit as regular message
      }

      // Handle crypto key exchange messages
      if (data.message && (data.message.type === 'key_exchange' || data.message.type === 'key_exchange_response')) {
        this._handleKeyExchange(data.message, data.from);
        return; // Don't emit as regular message
      }

      this.emit('messageReceived', data);
    });

    // CRITICAL: Handle remote stream announcements from gossip
    // When we hear about a stream from an indirectly connected peer,
    // establish a direct connection to receive the media
    this.addEventListener('remoteStreamAnnouncement', (data) => {
      this._handleRemoteStreamAnnouncement(data);
    });

    // Forward media events
    this.mediaManager.addEventListener('localStreamStarted', (data) => {
      this.emit('localStreamStarted', data);
      // Gossip stream start announcement to all peers in the mesh
      this.gossipManager.broadcastMessage({
        event: 'streamStarted',
        peerId: this.peerId,
        hasVideo: data.hasVideo,
        hasAudio: data.hasAudio,
        timestamp: Date.now()
      }, 'mediaEvent');
    });

    this.mediaManager.addEventListener('localStreamStopped', () => {
      this.emit('localStreamStopped');
      // Gossip stream stop announcement to all peers in the mesh
      this.gossipManager.broadcastMessage({
        event: 'streamStopped',
        peerId: this.peerId,
        timestamp: Date.now()
      }, 'mediaEvent');
    });

    this.mediaManager.addEventListener('error', (data) => {
      this.emit('mediaError', data);
    });

    // Forward remote stream events from ConnectionManager
    this.connectionManager.addEventListener('remoteStream', (data) => {
      this.emit('remoteStream', data);
    });

    // Handle crypto events if crypto is enabled
    if (this.cryptoManager) {
      this.cryptoManager.addEventListener('cryptoReady', (data) => {
        this.emit('cryptoReady', data);
      });

      this.cryptoManager.addEventListener('cryptoError', (data) => {
        this.emit('cryptoError', data);
      });

      this.cryptoManager.addEventListener('peerKeyAdded', (data) => {
        this.emit('peerKeyAdded', data);
      });

      this.cryptoManager.addEventListener('userAuthenticated', (data) => {
        this.emit('userAuthenticated', data);
      });
    }
  }

  validateEnvironment(options = {}) {
    const report = environmentDetector.getEnvironmentReport();
    const warnings = [];
    const errors = [];

    // Log environment info
    this.debug.log('🔍 PeerPigeon Environment Detection:', {
      runtime: `${report.runtime.isBrowser ? 'Browser' : ''}${report.runtime.isNodeJS ? 'Node.js' : ''}${report.runtime.isWorker ? 'Worker' : ''}${report.runtime.isNativeScript ? 'NativeScript' : ''}`,
      webrtc: report.capabilities.webrtc,
      websocket: report.capabilities.webSocket,
      browser: report.browser?.name || 'N/A',
      nativescript: report.nativescript?.platform || 'N/A'
    });

    // Check WebRTC support (required for peer connections)
    if (!report.capabilities.webrtc) {
      if (report.runtime.isBrowser) {
        errors.push('WebRTC is not supported in this browser. PeerPigeon requires WebRTC for peer-to-peer connections.');
      } else if (report.runtime.isNodeJS) {
        warnings.push('WebRTC support not detected in Node.js environment. Consider using a WebRTC library like node-webrtc.');
      } else if (report.runtime.isNativeScript) {
        warnings.push('WebRTC support not detected in NativeScript environment. Consider using a native WebRTC plugin.');
      }
    }

    // Check WebSocket support (required for signaling)
    if (!report.capabilities.webSocket) {
      if (report.runtime.isBrowser) {
        errors.push('WebSocket is not supported in this browser. PeerPigeon requires WebSocket for signaling.');
      } else if (report.runtime.isNodeJS) {
        warnings.push('WebSocket support not detected. Install the "ws" package for WebSocket support in Node.js.');
      } else if (report.runtime.isNativeScript) {
        warnings.push('WebSocket support not detected. Consider using a native WebSocket plugin or polyfill.');
      }
    }

    // Check storage capabilities for persistent peer ID
    if ((report.runtime.isBrowser || report.runtime.isNativeScript) && !report.capabilities.localStorage && !report.capabilities.sessionStorage) {
      warnings.push('No storage mechanism available. Peer ID will not persist between sessions.');
    }

    // Check crypto support for secure peer ID generation
    if (!report.capabilities.randomValues) {
      warnings.push('Crypto random values not available. Peer ID generation may be less secure.');
    }

    // Network connectivity checks
    if (report.runtime.isBrowser && !report.network.online) {
      warnings.push('Browser reports offline status. Mesh networking may not function properly.');
    }

    // Environment-specific warnings
    if (report.runtime.isBrowser) {
      // Browser-specific checks
      const browser = report.browser;
      if (browser && browser.name === 'ie') {
        errors.push('Internet Explorer is not supported. Please use a modern browser.');
      }

      // Check for secure context in production
      if (typeof location !== 'undefined' && location.protocol === 'http:' && location.hostname !== 'localhost') {
        warnings.push('Running on HTTP in production. Some WebRTC features may be limited. Consider using HTTPS.');
      }
    }

    if (report.runtime.isNativeScript) {
      // NativeScript-specific checks
      const nativeScript = report.nativescript;
      if (nativeScript && nativeScript.platform) {
        this.debug.log(`🔮 Running on NativeScript ${nativeScript.platform} platform`);

        // Platform-specific considerations
        if (nativeScript.platform === 'android') {
          warnings.push('Android WebRTC may require network permissions and appropriate security configurations.');
        } else if (nativeScript.platform === 'ios' || nativeScript.platform === 'visionos') {
          warnings.push('iOS/visionOS WebRTC may require camera/microphone permissions for media features.');
        }
      }
    }

    // Handle errors and warnings
    if (errors.length > 0) {
      const errorMessage = 'PeerPigeon environment validation failed:\n' + errors.join('\n');
      this.debug.error(errorMessage);
      if (!options.ignoreEnvironmentErrors) {
        throw new Error(errorMessage);
      }
    }

    if (warnings.length > 0) {
      this.debug.warn('PeerPigeon environment warnings:\n' + warnings.join('\n'));
    }

    // Store capabilities for runtime checks
    this.capabilities = report.capabilities;
    this.runtimeInfo = report.runtime;

    return report;
  }

  async init() {
    try {
      // Use provided peer ID if valid, otherwise generate one
      if (this.providedPeerId) {
        if (this.storageManager.validatePeerId(this.providedPeerId)) {
          this.peerId = this.providedPeerId;
          this.debug.log(`Using provided peer ID: ${this.peerId}`);
        } else {
          this.debug.warn(`Invalid peer ID provided: ${this.providedPeerId}. Must be 40-character SHA-1 hex string. Generating new one.`);
          this.peerId = await this.storageManager.generatePeerId();
        }
      } else {
        this.peerId = await this.storageManager.generatePeerId();
      }

      // Initialize WebDHT now that we have a peerId (if enabled)
      if (this.enableWebDHT) {
        this.webDHT = new WebDHT(this);
        this.debug.log('WebDHT initialized and enabled');

        // Setup WebDHT event handlers now that it's initialized
        this.setupWebDHTEventHandlers();

        // Initialize DistributedStorageManager if WebDHT is enabled
        this.distributedStorage = new DistributedStorageManager(this);
        this.debug.log('DistributedStorageManager initialized');

        // Setup DistributedStorageManager event handlers
        this.setupDistributedStorageEventHandlers();
      } else {
        this.debug.log('WebDHT disabled by configuration');
      }

      // Load signaling URL from query params or storage
      const savedUrl = this.storageManager.loadSignalingUrlFromQuery();
      if (savedUrl) {
        this.signalingUrl = savedUrl;
      }

      this.signalingClient = new SignalingClient(this.peerId, this.maxPeers, this);
      this.setupSignalingHandlers();

      this.peerDiscovery = new PeerDiscovery(this.peerId, {
        autoDiscovery: this.autoDiscovery,
        evictionStrategy: this.evictionStrategy,
        xorRouting: this.xorRouting,
        minPeers: this.minPeers,
        maxPeers: this.maxPeers
      });
      this.setupDiscoveryHandlers();

      // Initialize crypto manager if enabled
      if (this.cryptoManager) {
        try {
          this.debug.log('🔐 Initializing crypto manager...');
          await this.cryptoManager.init({ generateKeypair: true });
          this.debug.log('🔐 Crypto manager initialized successfully');
        } catch (error) {
          this.debug.error('Failed to initialize crypto manager:', error);
          // Continue without crypto - don't fail the entire init
          this.enableCrypto = false;
          this.cryptoManager = null;
        }
      }

      this.emit('statusChanged', { type: 'initialized', peerId: this.peerId });
    } catch (error) {
      this.debug.error('Failed to initialize mesh:', error);
      this.emit('statusChanged', { type: 'error', message: `Initialization failed: ${error.message}` });
      throw error;
    }
  }

  setupSignalingHandlers() {
    this.signalingClient.addEventListener('connected', () => {
      this.connected = true;
      this.polling = false;
      this.peerDiscovery.start();

      // Start periodic health monitoring
      this.startConnectionMonitoring();

      this.emit('statusChanged', { type: 'connected' });
    });

    this.signalingClient.addEventListener('disconnected', () => {
      this.connected = false;
      this.polling = false;
      this.peerDiscovery.stop();
      this.connectionManager.disconnectAllPeers();
      this.stopConnectionMonitoring();
      this.emit('statusChanged', { type: 'disconnected' });
    });

    this.signalingClient.addEventListener('signalingMessage', (message) => {
      this.signalingHandler.handleSignalingMessage(message);
    });

    this.signalingClient.addEventListener('statusChanged', (data) => {
      this.emit('statusChanged', data);
    });
  }

  setupDiscoveryHandlers() {
    this.peerDiscovery.addEventListener('peerDiscovered', (data) => {
      this.emit('peerDiscovered', data);
    });

    this.peerDiscovery.addEventListener('connectToPeer', (data) => {
      this.debug.log(`PeerDiscovery requested connection to: ${data.peerId.substring(0, 8)}...`);
      this.connectionManager.connectToPeer(data.peerId);
    });

    this.peerDiscovery.addEventListener('evictPeer', (data) => {
      this.evictionManager.evictPeer(data.peerId, data.reason);
    });

    this.peerDiscovery.addEventListener('optimizeMesh', () => {
      this.peerDiscovery.optimizeMeshConnections(this.connectionManager.peers);
    });

    this.peerDiscovery.addEventListener('optimizeConnections', (data) => {
      this.meshOptimizer.handleOptimizeConnections(data.unconnectedPeers);
    });

    this.peerDiscovery.addEventListener('peersUpdated', (data) => {
      this.emit('statusChanged', { type: 'info', message: `Cleaned up ${data.removedCount} stale peer(s)` });
      this.emit('peersUpdated');
    });

    // Handle capacity checks
    this.peerDiscovery.addEventListener('checkCapacity', () => {
      const canAccept = this.connectionManager.canAcceptMorePeers();
      const currentConnectionCount = this.connectionManager.getConnectedPeerCount();
      this.debug.log(`Capacity check: ${canAccept} (${currentConnectionCount}/${this.maxPeers} peers)`);
      this.peerDiscovery._canAcceptMorePeers = canAccept;
      this.peerDiscovery._currentConnectionCount = currentConnectionCount;
    });

    // Handle eviction checks
    this.peerDiscovery.addEventListener('checkEviction', (data) => {
      const evictPeerId = this.evictionManager.shouldEvictForPeer(data.newPeerId);
      this.debug.log(`Eviction check for ${data.newPeerId.substring(0, 8)}...: ${evictPeerId ? evictPeerId.substring(0, 8) + '...' : 'none'}`);
      this.peerDiscovery._shouldEvictForPeer = evictPeerId;
    });
  }

  async connect(signalingUrl) {
    this.signalingUrl = signalingUrl;
    this.storageManager.saveSignalingUrlToStorage(signalingUrl);
    this.polling = false; // Only WebSocket is supported
    // Don't emit connecting here - SignalingClient will handle it with more detail

    try {
      await this.signalingClient.connect(signalingUrl);
    } catch (error) {
      this.debug.error('Connection failed:', error);
      this.polling = false;
      this.emit('statusChanged', { type: 'error', message: `Connection failed: ${error.message}` });
      throw error;
    }
  }

  disconnect() {
    if (this.connected) {
      this.cleanupManager.sendGoodbyeMessage();
    }

    this.connected = false;
    this.polling = false;

    // Stop connection monitoring
    this.stopConnectionMonitoring();

    if (this.signalingClient) {
      this.signalingClient.disconnect();
    }

    if (this.peerDiscovery) {
      this.peerDiscovery.stop();
    }

    this.connectionManager.disconnectAllPeers();
    this.connectionManager.cleanup();

    // Cleanup WebDHT
    if (this.webDHT) {
      this.webDHT.cleanup();
    }
    this.evictionManager.cleanup();
    this.cleanupManager.cleanup();
    this.gossipManager.cleanup();

    this.emit('statusChanged', { type: 'disconnected' });
  }

  // Configuration methods
  setMaxPeers(maxPeers) {
    this.maxPeers = Math.max(1, Math.min(50, maxPeers));

    if (this.connectionManager.peers.size > this.maxPeers) {
      this.evictionManager.disconnectExcessPeers();
    }

    return this.maxPeers;
  }

  setMinPeers(minPeers) {
    this.minPeers = Math.max(0, Math.min(49, minPeers));

    // If we're below minimum and auto-discovery is enabled, trigger optimization
    if (this.connectionManager.getConnectedPeerCount() < this.minPeers && this.autoDiscovery && this.connected) {
      this.peerDiscovery.optimizeMeshConnections(this.connectionManager.peers);
    }

    return this.minPeers;
  }

  setXorRouting(enabled) {
    this.xorRouting = enabled;
    this.emit('statusChanged', { type: 'setting', setting: 'xorRouting', value: enabled });

    // If XOR routing is disabled, we might need to adjust our connection strategy
    if (!enabled && this.evictionStrategy) {
      this.emit('statusChanged', { type: 'warning', message: 'XOR routing disabled - eviction strategy effectiveness reduced' });
    }
  }

  setAutoDiscovery(enabled) {
    this.autoDiscovery = enabled;
    this.emit('statusChanged', { type: 'setting', setting: 'autoDiscovery', value: enabled });
  }

  setEvictionStrategy(enabled) {
    this.evictionStrategy = enabled;
    this.emit('statusChanged', { type: 'setting', setting: 'evictionStrategy', value: enabled });
  }

  // Status and information methods
  getStatus() {
    const connectedCount = this.connectionManager.getConnectedPeerCount();
    const totalCount = this.connectionManager.peers.size;
    return {
      peerId: this.peerId,
      connected: this.connected,
      polling: false, // Only WebSocket is supported
      connectedCount,
      totalPeerCount: totalCount, // Include total count for debugging
      minPeers: this.minPeers,
      maxPeers: this.maxPeers,
      discoveredCount: this.discoveredPeers.size,
      autoDiscovery: this.autoDiscovery,
      evictionStrategy: this.evictionStrategy,
      xorRouting: this.xorRouting
    };
  }

  getPeers() {
    return this.connectionManager.getPeers();
  }

  getPeerStatus(peerConnection) {
    return peerConnection.getStatus();
  }

  getDiscoveredPeers() {
    if (!this.peerDiscovery) {
      return [];
    }
    const discoveredPeers = this.peerDiscovery.getDiscoveredPeers();

    // Enrich with connection state from the actual peer connections
    return discoveredPeers.map(peer => {
      const peerConnection = this.connectionManager.getPeer(peer.peerId);
      let isConnected = false;

      if (peerConnection) {
        const status = peerConnection.getStatus();
        // Consider peer connected if WebRTC connection is established
        isConnected = status === 'connected' || status === 'channel-connecting';
      }

      return {
        ...peer,
        isConnected
      };
    });
  }

  /**
     * Send a direct message to a specific peer via gossip routing
     * @param {string} targetPeerId - The destination peer's ID
     * @param {string|object} content - The message content
     * @returns {string|null} The message ID if sent, or null on error
     */
  sendDirectMessage(targetPeerId, content) {
    if (!targetPeerId || typeof targetPeerId !== 'string') {
      this.debug.error('Invalid targetPeerId for direct message');
      return null;
    }
    return this.gossipManager.sendDirectMessage(targetPeerId, content);
  }

  /**
     * Send a broadcast (gossip) message to all peers
     * @param {string|object} content - The message content
     * @returns {string|null} The message ID if sent, or null on error
     */
  sendMessage(content) {
    // For clarity, this is a broadcast/gossip message
    return this.gossipManager.broadcastMessage(content, 'chat');
  }

  // Helper methods for backward compatibility
  canAcceptMorePeers() {
    return this.connectionManager.canAcceptMorePeers();
  }

  getConnectedPeerCount() {
    return this.connectionManager.getConnectedPeerCount();
  }

  // Expose peers Map for backward compatibility
  get peers() {
    return this.connectionManager.peers;
  }

  // Get peer status method for UI compatibility
  getPeerUIStatus(peer) {
    if (!peer) return 'unknown';
    return peer.getStatus ? peer.getStatus() : 'unknown';
  }

  // Get connected peer IDs as array for UI compatibility
  getConnectedPeerIds() {
    return this.connectionManager.getPeers()
      .filter(peer => peer.status === 'connected')
      .map(peer => peer.peerId);
  }

  // Advanced methods
  async cleanupStaleSignalingData() {
    return this.cleanupManager.cleanupStaleSignalingData();
  }

  forceConnectToAllPeers() {
    return this.meshOptimizer.forceConnectToAllPeers();
  }

  // Debugging and maintenance methods
  forceCleanupInvalidPeers() {
    this.debug.log('Force cleaning up peers not in connected state...');
    return this.connectionManager.forceCleanupInvalidPeers();
  }

  cleanupStalePeers() {
    this.debug.log('Manually cleaning up stale peers...');
    return this.connectionManager.cleanupStalePeers();
  }

  getPeerStateSummary() {
    return this.connectionManager.getPeerStateSummary();
  }

  debugConnectivity() {
    return this.meshOptimizer.debugConnectivity();
  }

  // Connection monitoring methods
  startConnectionMonitoring() {
    // Monitor connection health every 2 minutes
    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
    }

    // Environment-aware timer
    const intervalCallback = () => {
      if (this.signalingClient) {
        const stats = this.signalingClient.getConnectionStats();
        this.debug.log('Connection monitoring:', stats);

        // Force health check if connection seems problematic
        if (stats.connected && stats.lastPingTime && stats.lastPongTime) {
          const timeSinceLastPong = Date.now() - stats.lastPongTime;
          if (timeSinceLastPong > 60000) { // 1 minute without pong
            this.debug.warn('Connection may be unhealthy, forcing health check');
            this.signalingClient.forceHealthCheck();
          }
        }

        // Emit connection status for UI
        this.emit('connectionStats', stats);
      }
    };

    if (environmentDetector.isBrowser) {
      this.connectionMonitorInterval = window.setInterval(intervalCallback, 120000);
    } else {
      this.connectionMonitorInterval = setInterval(intervalCallback, 120000);
    }

    this.debug.log('Started connection monitoring');
  }

  stopConnectionMonitoring() {
    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
      this.connectionMonitorInterval = null;
      this.debug.log('Stopped connection monitoring');
    }
  }

  // Media management methods
  async initializeMedia() {
    return await this.mediaManager.init();
  }

  async startMedia(options = {}) {
    const { video = false, audio = false, deviceIds = {} } = options;

    try {
      const stream = await this.mediaManager.startLocalStream({ video, audio, deviceIds });

      // Update all existing peer connections with the new stream
      const connections = this.connectionManager.getAllConnections();
      this.debug.log(`📡 MEDIA START: Applying stream to ${connections.length} connections`);

      for (const connection of connections) {
        this.debug.log(`📡 MEDIA START: Setting stream for peer ${connection.peerId.substring(0, 8)}...`);
        await connection.setLocalStream(stream);

        // FORCE IMMEDIATE RENEGOTIATION: Don't wait for the automatic trigger
        this.debug.log(`📡 MEDIA START: Forcing immediate renegotiation for peer ${connection.peerId.substring(0, 8)}...`);
        // Force immediate renegotiation without delay for faster connection
        try {
          if (connection.connection && connection.connection.signalingState === 'stable') {
            // Create and send a renegotiation offer immediately
            const offer = await connection.createOffer();
            await this.sendSignalingMessage({
              type: 'renegotiation-offer',
              data: offer,
              timestamp: Date.now(),
              forced: true // Mark as forced renegotiation
            }, connection.peerId);
            this.debug.log(`✅ MEDIA START: Forced renegotiation offer sent to ${connection.peerId.substring(0, 8)}...`);
          }
        } catch (error) {
          this.debug.error(`❌ MEDIA START: Failed to force renegotiation for ${connection.peerId.substring(0, 8)}...`, error);
        }
      }

      return stream;
    } catch (error) {
      this.debug.error('Failed to start media:', error);
      throw error;
    }
  }

  async stopMedia() {
    this.mediaManager.stopLocalStream();

    // Update all existing peer connections to remove the stream
    const connections = this.connectionManager.getAllConnections();
    for (const connection of connections) {
      await connection.setLocalStream(null);
    }
  }

  toggleVideo() {
    return this.mediaManager.toggleVideo();
  }

  toggleAudio() {
    return this.mediaManager.toggleAudio();
  }

  getMediaState() {
    return this.mediaManager.getMediaState();
  }

  getMediaDevices() {
    return this.mediaManager.devices;
  }

  async enumerateMediaDevices() {
    return await this.mediaManager.enumerateDevices();
  }

  getLocalStream() {
    return this.mediaManager.localStream;
  }

  // Get remote streams from all connected peers
  getRemoteStreams() {
    const streams = new Map();
    const connections = this.connectionManager.getAllConnections();

    for (const connection of connections) {
      const remoteStream = connection.getRemoteStream();
      if (remoteStream) {
        streams.set(connection.peerId, remoteStream);
      }
    }

    return streams;
  }

  // Static utility methods
  static validatePeerId(peerId) {
    return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
  }

  static async generatePeerId() {
    const array = new Uint8Array(20);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // WebDHT methods - Distributed Hash Table
  /**
     * Store a key-value pair in the distributed hash table
     * @param {string} key - The key to store
     * @param {any} value - The value to store
     * @param {object} options - Storage options (ttl, etc.)
     * @returns {Promise<boolean>} True if stored successfully
     */
  async dhtPut(key, value, options = {}) {
    if (!this.enableWebDHT) {
      throw new Error('WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.');
    }
    if (!this.webDHT) {
      throw new Error('WebDHT not initialized');
    }
    return this.webDHT.put(key, value, options);
  }

  /**
     * Retrieve a value from the distributed hash table
     * @param {string} key - The key to retrieve
     * @param {object} options - Retrieval options (subscribe, etc.)
     * @returns {Promise<any>} The stored value or null if not found
     */
  async dhtGet(key, options = {}) {
    if (!this.enableWebDHT) {
      throw new Error('WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.');
    }
    if (!this.webDHT) {
      throw new Error('WebDHT not initialized');
    }
    return this.webDHT.get(key, options);
  }

  /**
     * Subscribe to changes for a key in the DHT
     * @param {string} key - The key to subscribe to
     * @returns {Promise<any>} The current value
     */
  async dhtSubscribe(key) {
    if (!this.enableWebDHT) {
      throw new Error('WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.');
    }
    if (!this.webDHT) {
      throw new Error('WebDHT not initialized');
    }
    return this.webDHT.subscribe(key);
  }

  /**
     * Unsubscribe from changes for a key in the DHT
     * @param {string} key - The key to unsubscribe from
     */
  async dhtUnsubscribe(key) {
    if (!this.enableWebDHT) {
      throw new Error('WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.');
    }
    if (!this.webDHT) {
      throw new Error('WebDHT not initialized');
    }
    return this.webDHT.unsubscribe(key);
  }

  /**
     * Update a key's value and notify subscribers
     * @param {string} key - The key to update
     * @param {any} newValue - The new value
     * @param {object} options - Update options
     * @returns {Promise<boolean>} True if updated successfully
     */
  async dhtUpdate(key, newValue, options = {}) {
    if (!this.enableWebDHT) {
      throw new Error('WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.');
    }
    if (!this.webDHT) {
      throw new Error('WebDHT not initialized');
    }
    return this.webDHT.update(key, newValue, options);
  }

  /**
     * Get DHT statistics
     * @returns {object} DHT statistics
     */
  getDHTStats() {
    if (!this.enableWebDHT) {
      return { error: 'WebDHT is disabled. Enable it by setting enableWebDHT: true in constructor options.' };
    }
    if (!this.webDHT) {
      return { error: 'WebDHT not initialized' };
    }
    return this.webDHT.getStats();
  }

  /**
     * Check if WebDHT is enabled
     * @returns {boolean} True if WebDHT is enabled
     */
  isDHTEnabled() {
    return this.enableWebDHT;
  }

  /**
     * Setup WebDHT event handlers
     */
  setupWebDHTEventHandlers() {
    // Only set up if webDHT exists
    if (this.webDHT) {
      this.webDHT.addEventListener('valueChanged', (data) => {
        this.emit('dhtValueChanged', data);
      });
    }
  }

  /**
   * Setup event handlers for DistributedStorageManager
   */
  setupDistributedStorageEventHandlers() {
    // Only set up if distributedStorage exists
    if (this.distributedStorage) {
      this.distributedStorage.addEventListener('dataStored', (data) => {
        this.emit('storageDataStored', data);
      });

      this.distributedStorage.addEventListener('dataRetrieved', (data) => {
        this.emit('storageDataRetrieved', data);
      });

      this.distributedStorage.addEventListener('dataUpdated', (data) => {
        this.emit('storageDataUpdated', data);
      });

      this.distributedStorage.addEventListener('dataDeleted', (data) => {
        this.emit('storageDataDeleted', data);
      });

      this.distributedStorage.addEventListener('accessGranted', (data) => {
        this.emit('storageAccessGranted', data);
      });

      this.distributedStorage.addEventListener('accessRevoked', (data) => {
        this.emit('storageAccessRevoked', data);
      });
    }
  }

  /**
     * Connect to a specific peer by ID
     */
  connectToPeer(peerId) {
    if (!peerId || typeof peerId !== 'string') {
      throw new Error('Valid peer ID is required');
    }

    if (peerId === this.peerId) {
      throw new Error('Cannot connect to yourself');
    }

    return this.connectionManager.connectToPeer(peerId);
  }

  /**
     * Get the current environment report
     * @returns {object} Complete environment detection report
     */
  getEnvironmentReport() {
    return this.environmentReport;
  }

  /**
     * Get runtime capabilities
     * @returns {object} Capabilities detected during initialization
     */
  getCapabilities() {
    return this.capabilities;
  }

  /**
     * Get runtime information
     * @returns {object} Runtime environment information
     */
  getRuntimeInfo() {
    return this.runtimeInfo;
  }

  /**
     * Check if a specific feature is supported
     * @param {string} feature - The feature to check (e.g., 'webrtc', 'websocket', 'localstorage')
     * @returns {boolean} True if the feature is supported
     */
  hasFeature(feature) {
    return environmentDetector.hasFeature(feature);
  }

  /**
     * Get environment-specific recommendations
     * @returns {object} Recommendations based on current environment
     */
  getEnvironmentRecommendations() {
    const recommendations = [];
    const report = this.environmentReport;

    if (report.runtime.isBrowser) {
      if (!report.network.online) {
        recommendations.push({
          type: 'warning',
          message: 'Browser is offline. Enable network connectivity for mesh functionality.'
        });
      }

      if (typeof location !== 'undefined' && location.protocol === 'http:' && location.hostname !== 'localhost') {
        recommendations.push({
          type: 'security',
          message: 'Consider using HTTPS for better WebRTC compatibility and security.'
        });
      }

      if (report.browser && report.browser.name === 'safari') {
        recommendations.push({
          type: 'compatibility',
          message: 'Safari has some WebRTC limitations. Test thoroughly for production use.'
        });
      }
    }

    if (report.runtime.isNodeJS) {
      if (!report.capabilities.webSocket) {
        recommendations.push({
          type: 'dependency',
          message: 'Install the "ws" package for WebSocket support: npm install ws'
        });
      }

      if (!report.capabilities.webrtc) {
        recommendations.push({
          type: 'dependency',
          message: 'Install "node-webrtc" or similar for WebRTC support in Node.js: npm install node-webrtc'
        });
      }
    }

    if (!report.capabilities.localStorage && !report.capabilities.sessionStorage) {
      recommendations.push({
        type: 'feature',
        message: 'No persistent storage available. Peer ID will change on restart.'
      });
    }

    return {
      environment: report.runtime,
      recommendations
    };
  }

  // ============================================
  // Cryptographic Methods (unsea integration)
  // ============================================

  /**
     * Initialize crypto with user credentials
     * @param {Object} options - Crypto initialization options
     * @param {string} options.alias - User alias for persistent identity
     * @param {string} options.password - User password
     * @returns {Promise<boolean>} True if crypto was initialized successfully
     */
  async initCrypto(options = {}) {
    if (!this.enableCrypto) {
      this.enableCrypto = true;
      this.cryptoManager = new CryptoManager();
    }

    if (!this.cryptoManager) {
      throw new Error('Crypto manager not available');
    }

    try {
      await this.cryptoManager.init(options);
      return true;
    } catch (error) {
      this.debug.error('Failed to initialize crypto:', error);
      throw error;
    }
  }

  /**
     * Get crypto status and information
     * @returns {Object} Crypto status information
     */
  getCryptoStatus() {
    if (!this.cryptoManager) {
      return {
        enabled: false,
        initialized: false,
        error: 'Crypto not enabled. Enable with enableCrypto: true in constructor'
      };
    }

    return this.cryptoManager.getStatus();
  }

  /**
     * Enable/disable crypto functionality
     * @param {boolean} enabled - Whether to enable crypto
     */
  setCrypto(enabled) {
    if (enabled && !this.cryptoManager) {
      this.cryptoManager = new CryptoManager();
    }
    this.enableCrypto = enabled;
  }

  /**
     * Encrypt a message without sending it
     * @param {any} content - Message content to encrypt
     * @param {string} peerId - Optional target peer ID for peer-to-peer encryption
     * @param {string} groupId - Optional group ID for group encryption
     * @returns {Promise<Object>} Encrypted message object
     */
  async encryptMessage(content, peerId = null, groupId = null) {
    if (!this.enableCrypto || !this.cryptoManager) {
      throw new Error('Crypto not enabled or initialized');
    }

    try {
      if (groupId) {
        return await this.cryptoManager.encryptForGroup(content, groupId);
      } else if (peerId) {
        return await this.cryptoManager.encryptForPeer(content, peerId);
      } else {
        // For benchmark/testing purposes, encrypt with our own public key
        const ourPeerId = this.peerId;
        const ourKeypair = this.cryptoManager.keypair;
        if (ourKeypair && ourKeypair.pub && ourKeypair.epub) {
          // Add our own key temporarily for testing (include both pub and epub)
          this.cryptoManager.addPeerKey(ourPeerId, {
            pub: ourKeypair.pub,
            epub: ourKeypair.epub
          });
          return await this.cryptoManager.encryptForPeer(content, ourPeerId);
        } else {
          throw new Error('No complete keypair available for encryption (need both pub and epub)');
        }
      }
    } catch (error) {
      this.debug.error('Failed to encrypt message:', error);
      throw error;
    }
  }

  /**
   * Send a signaling message over the mesh (peer-to-peer) instead of the signaling server
   * This allows peers to coordinate without the signaling server after initial connection
   * @param {Object} message - The signaling message
   * @param {string} targetPeerId - Target peer ID (optional, for direct signaling)
   * @returns {Promise<boolean>} Success status
   */
  async sendMeshSignalingMessage(message, targetPeerId = null) {
    if (!this.connected) {
      this.debug.warn('Cannot send mesh signaling message - mesh not connected');
      return false;
    }

    const signalingMessage = {
      type: 'mesh_signaling',
      meshSignalingType: message.type,
      data: message.data,
      fromPeerId: this.peerId,
      targetPeerId,
      timestamp: Date.now(),
      messageId: this.generateMessageId()
    };

    this.debug.log(`📡 Sending mesh signaling message: ${message.type} ${targetPeerId ? `to ${targetPeerId.substring(0, 8)}...` : '(broadcast)'}`);

    try {
      if (targetPeerId) {
        // Send directly to target peer
        return this.sendDirectMessage(targetPeerId, signalingMessage);
      } else {
        // Broadcast to all connected peers
        return this.broadcast(signalingMessage);
      }
    } catch (error) {
      this.debug.error('Failed to send mesh signaling message:', error);
      return false;
    }
  }

  /**
   * Handle incoming mesh signaling messages
   * @param {Object} message - The mesh signaling message
   * @param {string} from - Sender peer ID
   * @private
   */
  _handleMeshSignalingMessage(message, from) {
    if (!message.meshSignalingType || !message.data) {
      this.debug.warn('Invalid mesh signaling message format');
      return;
    }

    // Only process messages intended for us or broadcasts
    if (message.targetPeerId && message.targetPeerId !== this.peerId) {
      this.debug.log(`Ignoring mesh signaling message not intended for us (target: ${message.targetPeerId?.substring(0, 8)}...)`);
      return;
    }

    this.debug.log(`📡 Received mesh signaling message: ${message.meshSignalingType} from ${from.substring(0, 8)}...`);

    // Create a signaling message format that our existing handler can process
    const reconstitutedMessage = {
      type: message.meshSignalingType,
      data: message.data,
      fromPeerId: from,
      targetPeerId: message.targetPeerId,
      timestamp: message.timestamp,
      messageId: message.messageId,
      viaWebSocket: false, // Mark as coming from mesh, not WebSocket
      viaMesh: true
    };

    // Forward to our existing signaling handler
    this.signalingHandler.handleSignalingMessage(reconstitutedMessage);
  }

  /**
   * Send a signaling message, using mesh connections for renegotiation
   * @param {Object} message - The signaling message
   * @param {string} targetPeerId - Target peer ID (optional)
   * @returns {Promise<boolean>} Success status
   */
  async sendSignalingMessage(message, targetPeerId = null) {
    // CRITICAL FIX: Use mesh for renegotiation, WebSocket only for initial handshake
    const isRenegotiation = message.type === 'renegotiation-offer' || message.type === 'renegotiation-answer';

    if (isRenegotiation && targetPeerId) {
      // Use existing mesh connection for renegotiation
      this.debug.log(`🔄 MESH RENEGOTIATION: Sending ${message.type} via mesh to ${targetPeerId.substring(0, 8)}...`);

      const peerConnection = this.connectionManager.getPeer(targetPeerId);
      if (peerConnection && peerConnection.sendMessage) {
        const success = peerConnection.sendMessage({
          type: 'signaling',
          data: message,
          fromPeerId: this.peerId,
          timestamp: Date.now()
        });

        if (success) {
          this.debug.log(`✅ MESH RENEGOTIATION: ${message.type} sent via mesh to ${targetPeerId.substring(0, 8)}...`);
          return true;
        } else {
          this.debug.error(`❌ MESH RENEGOTIATION: Failed to send ${message.type} via mesh to ${targetPeerId.substring(0, 8)}...`);
        }
      } else {
        this.debug.error(`❌ MESH RENEGOTIATION: No mesh connection to ${targetPeerId.substring(0, 8)}... for ${message.type}`);
      }

      // Fall back to WebSocket if mesh fails
      this.debug.log(`🔄 FALLBACK: Using WebSocket for ${message.type} to ${targetPeerId.substring(0, 8)}...`);
    }

    // Use WebSocket for initial offers/answers and fallback
    if (this.signalingClient && this.signalingClient.isConnected()) {
      this.debug.log(`📡 Using WebSocket signaling for ${message.type} to ${targetPeerId?.substring(0, 8) || 'broadcast'}`);

      // Include targetPeerId in the message if provided
      const messageWithTarget = { ...message };
      if (targetPeerId) {
        messageWithTarget.targetPeerId = targetPeerId;
      }

      return await this.signalingClient.sendSignalingMessage(messageWithTarget);
    }

    this.debug.warn(`📡 Cannot send signaling message ${message.type} - WebSocket not connected and mesh failed`);
    return false;
  }

  /**
     * Send an encrypted message to a specific peer
     * @param {string} peerId - Target peer ID
     * @param {any} content - Message content
     * @param {Object} options - Message options
     * @returns {Promise<string|null>} Message ID if sent successfully
     */
  async sendEncryptedMessage(peerId, content, _options = {}) {
    if (!this.enableCrypto || !this.cryptoManager) {
      throw new Error('Crypto not enabled or initialized');
    }

    try {
      const encryptedContent = await this.cryptoManager.encryptForPeer(content, peerId);
      return this.sendDirectMessage(peerId, encryptedContent);
    } catch (error) {
      this.debug.error('Failed to send encrypted message:', error);
      throw error;
    }
  }

  /**
     * Send an encrypted broadcast message
     * @param {any} content - Message content
     * @param {string} groupId - Optional group ID for group encryption
     * @returns {Promise<string|null>} Message ID if sent successfully
     */
  async sendEncryptedBroadcast(content, groupId = null) {
    if (!this.enableCrypto || !this.cryptoManager) {
      throw new Error('Crypto not enabled or initialized');
    }

    try {
      let encryptedContent;
      if (groupId) {
        encryptedContent = await this.cryptoManager.encryptForGroup(content, groupId);
      } else {
        // For broadcast without group, we'll need to encrypt for each peer individually
        // This is a simplified approach - in practice, you'd use group keys
        encryptedContent = {
          encrypted: true,
          broadcast: true,
          data: content,
          from: this.cryptoManager.getPublicKey(),
          timestamp: Date.now()
        };
      }
      // Use 'encrypted' message type instead of 'chat' for encrypted broadcasts
      return this.gossipManager.broadcastMessage(encryptedContent, 'encrypted');
    } catch (error) {
      this.debug.error('Failed to send encrypted broadcast:', error);
      throw error;
    }
  }

  /**
     * Decrypt a received message
     * @param {Object} encryptedData - Encrypted message data
     * @returns {Promise<any>} Decrypted content
     */
  async decryptMessage(encryptedData) {
    if (!this.enableCrypto || !this.cryptoManager) {
      return encryptedData; // Return as-is if crypto not enabled
    }

    try {
      if (encryptedData.group) {
        return await this.cryptoManager.decryptFromGroup(encryptedData);
      } else {
        return await this.cryptoManager.decryptFromPeer(encryptedData);
      }
    } catch (error) {
      this.debug.error('Failed to decrypt message:', error);
      throw error;
    }
  }

  /**
     * Exchange public keys with a peer
     * @param {string} peerId - Peer ID to exchange keys with
     */
  async exchangeKeysWithPeer(peerId) {
    if (!this.enableCrypto || !this.cryptoManager) {
      throw new Error('Crypto not enabled or initialized');
    }

    const keypair = this.cryptoManager.keypair;
    if (!keypair || !keypair.pub || !keypair.epub) {
      throw new Error('No complete keypair available (need both pub and epub)');
    }

    // Send both our public key (pub) and encryption public key (epub) to the peer
    return this.gossipManager.sendDirectMessage(peerId, {
      type: 'key_exchange',
      publicKey: {
        pub: keypair.pub,
        epub: keypair.epub
      },
      timestamp: Date.now()
    }, 'key_exchange');
  }

  /**
     * Add a peer's public key
     * @param {string} peerId - Peer ID
     * @param {string} publicKey - Peer's public key
     * @returns {boolean} True if key was added successfully
     */
  addPeerPublicKey(peerId, publicKey) {
    if (!this.enableCrypto || !this.cryptoManager) {
      return false;
    }

    return this.cryptoManager.addPeerKey(peerId, publicKey);
  }

  /**
     * Generate a group key for encrypted group communications
     * @param {string} groupId - Group identifier
     * @returns {Promise<Object>} Generated group key
     */
  async generateGroupKey(groupId) {
    if (!this.enableCrypto || !this.cryptoManager) {
      throw new Error('Crypto not enabled or initialized');
    }

    return await this.cryptoManager.generateGroupKey(groupId);
  }

  /**
     * Add a group key for encrypted group communications
     * @param {string} groupId - Group identifier
     * @param {Object} groupKey - Group key object
     */
  addGroupKey(groupId, groupKey) {
    if (!this.enableCrypto || !this.cryptoManager) {
      throw new Error('Crypto not enabled or initialized');
    }

    this.cryptoManager.addGroupKey(groupId, groupKey);
  }

  /**
     * Sign data with our private key
     * @param {any} data - Data to sign
     * @returns {Promise<string>} Digital signature
     */
  async signData(data) {
    if (!this.enableCrypto || !this.cryptoManager) {
      throw new Error('Crypto not enabled or initialized');
    }

    return await this.cryptoManager.sign(data);
  }

  /**
     * Verify a signature
     * @param {string} signature - Signature to verify
     * @param {any} data - Original data
     * @param {string} publicKey - Signer's public key
     * @returns {Promise<boolean>} True if signature is valid
     */
  async verifySignature(signature, data, publicKey) {
    if (!this.enableCrypto || !this.cryptoManager) {
      return true; // If crypto disabled, assume valid
    }

    return await this.cryptoManager.verify(signature, data, publicKey);
  }

  /**
     * Export our public key for sharing
     * @returns {Object|null} Public key export data
     */
  exportPublicKey() {
    if (!this.enableCrypto || !this.cryptoManager) {
      return null;
    }

    return this.cryptoManager.exportPublicKey();
  }

  /**
     * Run crypto self-tests
     * @returns {Promise<Object>} Test results
     */
  async runCryptoTests() {
    if (!this.enableCrypto || !this.cryptoManager) {
      throw new Error('Crypto not enabled or initialized');
    }

    return await this.cryptoManager.runSelfTest();
  }

  /**
     * Reset crypto state and clear all keys
     */
  resetCrypto() {
    if (this.cryptoManager) {
      this.cryptoManager.reset();
    }
  }

  /**
     * Handle incoming key exchange messages
     * @param {Object} data - Key exchange message data
     * @param {string} from - Sender's peer ID
     * @private
     */
  _handleKeyExchange(data, from) {
    if ((data.type === 'key_exchange' || data.type === 'key_exchange_response') && data.publicKey && this.cryptoManager) {
      this.cryptoManager.addPeerKey(from, data.publicKey);
      this.debug.log(`🔐 Stored public key for peer ${from.substring(0, 8)}...`);

      // Send our public key back if this was an initial exchange (not a response)
      if (data.type === 'key_exchange') {
        const keypair = this.cryptoManager.keypair;
        if (keypair && keypair.pub && keypair.epub) {
          this.gossipManager.sendDirectMessage(from, {
            type: 'key_exchange_response',
            publicKey: {
              pub: keypair.pub,
              epub: keypair.epub
            },
            timestamp: Date.now()
          }, 'key_exchange_response');
        }
      }
    }
  }

  /**
   * Handle remote stream announcements from gossip protocol
   * The actual stream forwarding is handled by ConnectionManager
   * @param {Object} data - Stream announcement data
   * @private
   */
  async _handleRemoteStreamAnnouncement(data) {
    const { peerId, event } = data;

    // Don't process our own announcements
    if (peerId === this.peerId) {
      return;
    }

    this.debug.log(`🎵 GOSSIP STREAM: Received stream announcement - ${event} from ${peerId.substring(0, 8)}...`);

    // Stream forwarding is now handled automatically by ConnectionManager
    // when remoteStream events are received, so we just emit for UI handling
    this.emit('remoteStreamAnnouncement', data);
  }
}
