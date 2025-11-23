import { EventEmitter } from './EventEmitter.js';
import { PeerConnection } from './PeerConnection.js';
import { environmentDetector } from './EnvironmentDetector.js';
import DebugLogger from './DebugLogger.js';

/**
 * Manages individual peer connections, timeouts, and connection attempts
 */
export class ConnectionManager extends EventEmitter {
  constructor(mesh) {
    super();
    this.mesh = mesh;
    this.debug = DebugLogger.create('ConnectionManager');
    this.peers = new Map();
    this.connectionAttempts = new Map();
    this.pendingIceCandidates = new Map();
    this.disconnectionInProgress = new Set();
    this.cleanupInProgress = new Set();
    this.lastConnectionAttempt = new Map(); // Track last attempt time per peer

    // Renegotiation management to prevent conflicts
    this.activeRenegotiations = new Set();
    this.renegotiationQueue = new Map();
    this.maxConcurrentRenegotiations = 1; // Only allow 1 renegotiation at a time

    // Configuration
    this.maxConnectionAttempts = 3;
    this.retryDelay = 500; // Faster retry - 500ms between attempts to same peer

    // Start periodic cleanup of stale peers
    this.startPeriodicCleanup();

    // Start monitoring for stuck connections
    this.startStuckConnectionMonitoring();
    
    // Set up mesh-level event listeners for crypto-gated media
    this.setupMeshEventListeners();
  }
  
  /**
   * Set up event listeners for mesh-level events
   */
  setupMeshEventListeners() {
    // Listen for successful key exchanges to enable media sharing
    this.mesh.addEventListener('peerKeyAdded', (event) => {
      this.handlePeerKeyAdded(event.peerId);
    });
  }
  
  /**
   * Handle when a peer's crypto key is successfully added
   * @param {string} peerId - The peer ID whose key was added
   */
  async handlePeerKeyAdded(peerId) {
    this.debug.log(`🔐 Key added for ${peerId.substring(0, 8)}... - crypto verification complete`);
    
    // NOTE: We do NOT automatically enable remote streams here
    // Media streams (both local and remote) must be manually invoked by the user via the "Start Media" button
    // This ensures complete control over when ANY media streams are allowed
    this.debug.log(`🔐 Crypto verified for ${peerId.substring(0, 8)}... - user must manually invoke media to enable streams`);
  }

  async connectToPeer(targetPeerId) {
    this.debug.log(`connectToPeer called for ${targetPeerId.substring(0, 8)}...`);

    // Enhanced duplicate connection prevention
    if (this.peers.has(targetPeerId)) {
      this.debug.log(`Already connected to ${targetPeerId.substring(0, 8)}...`);
      return;
    }

    // Check if we're already attempting through PeerDiscovery
    if (this.mesh.peerDiscovery.isAttemptingConnection(targetPeerId)) {
      this.debug.log(`Already attempting connection to ${targetPeerId.substring(0, 8)}... via PeerDiscovery`);
      return;
    }

    // INITIATOR LOGIC: Use deterministic peer ID comparison to prevent race conditions
    // Only become initiator if our peer ID is lexicographically greater than target's
    const shouldBeInitiator = this.mesh.peerId > targetPeerId;
    if (!shouldBeInitiator) {
      this.debug.log(`🔄 INITIATOR LOGIC: Not becoming initiator for ${targetPeerId.substring(0, 8)}... (our ID: ${this.mesh.peerId.substring(0, 8)}... is smaller)`);
      return; // Let the other peer initiate
    }

    this.debug.log(`🔄 INITIATOR LOGIC: Becoming initiator for ${targetPeerId.substring(0, 8)}... (our ID: ${this.mesh.peerId.substring(0, 8)}... is greater)`);

    if (!this.mesh.canAcceptMorePeers()) {
      this.debug.log(`Cannot connect to ${targetPeerId.substring(0, 8)}... (max peers reached: ${this.mesh.maxPeers})`);
      return;
    }

    // Check retry cooldown (only apply after first attempt)
    const now = Date.now();
    const attempts = this.connectionAttempts.get(targetPeerId) || 0;
    if (attempts > 0) {
      const lastAttempt = this.lastConnectionAttempt.get(targetPeerId) || 0;

      // Use shorter delay for isolated peers to help them connect faster
      const connectedCount = this.getConnectedPeerCount();
      const retryDelay = connectedCount === 0 ? 200 : this.retryDelay; // 200ms for isolated peers, 500ms otherwise

      if (now - lastAttempt < retryDelay) {
        const remaining = retryDelay - (now - lastAttempt);
        this.debug.log(`Connection to ${targetPeerId.substring(0, 8)}... on cooldown (${Math.round(remaining / 1000)}s remaining, isolated: ${connectedCount === 0})`);
        return;
      }
    }

    // Check connection attempt count
    if (attempts >= this.maxConnectionAttempts) {
      this.mesh.emit('statusChanged', { type: 'warning', message: `Max connection attempts reached for ${targetPeerId.substring(0, 8)}...` });
      this.mesh.peerDiscovery.removeDiscoveredPeer(targetPeerId);
      return;
    }

    this.debug.log(`Starting connection to ${targetPeerId.substring(0, 8)}... (attempt ${attempts + 1})`);
    this.connectionAttempts.set(targetPeerId, attempts + 1);
    this.lastConnectionAttempt.set(targetPeerId, now);
    this.mesh.peerDiscovery.trackConnectionAttempt(targetPeerId);

    try {
      this.debug.log(`Creating PeerConnection for ${targetPeerId.substring(0, 8)}...`);

      // SECURITY: NO automatic media sharing - all media must be manually invoked
      const options = {
        localStream: null, // Always null - media must be manually added later
        // ALWAYS enable both audio and video transceivers for maximum compatibility
        // This allows peers to receive media even if they don't have media when connecting
        enableAudio: true,
        enableVideo: true
        // allowRemoteStreams defaults to false - streams only invoked when user clicks "Start Media"
      };

      this.debug.log(`🔄 INITIATOR SETUP: Creating PeerConnection(${targetPeerId.substring(0, 8)}..., isInitiator=true)`);
      const peerConnection = new PeerConnection(targetPeerId, true, options);

      // Set up event handlers BEFORE creating connection to catch all events
      this.setupPeerConnectionHandlers(peerConnection);
      this.peers.set(targetPeerId, peerConnection);

      this.debug.log(`Creating WebRTC connection for ${targetPeerId.substring(0, 8)}...`);
      await peerConnection.createConnection();

      this.debug.log(`Creating offer for ${targetPeerId.substring(0, 8)}...`);
      const offer = await peerConnection.createOffer();

      this.debug.log(`Offer created for ${targetPeerId.substring(0, 8)}...`, {
        type: offer.type,
        sdpLength: offer.sdp?.length || 0,
        hasAudio: offer.sdp?.includes('m=audio') || false,
        hasVideo: offer.sdp?.includes('m=video') || false
      });

      this.debug.log(`Sending offer to ${targetPeerId.substring(0, 8)}...`);
      await this.mesh.sendSignalingMessage({
        type: 'offer',
        data: offer
      }, targetPeerId);

      this.mesh.emit('statusChanged', { type: 'info', message: `Offer sent to ${targetPeerId.substring(0, 8)}...` });
    } catch (error) {
      this.debug.error('Failed to connect to peer:', error);
      this.mesh.emit('statusChanged', { type: 'error', message: `Failed to connect to ${targetPeerId.substring(0, 8)}...: ${error.message}` });
      this.cleanupFailedConnection(targetPeerId);
    }
  }

  cleanupFailedConnection(peerId) {
    this.debug.log(`Cleaning up failed connection for ${peerId.substring(0, 8)}...`);

    // Remove peer connection
    let peerRemoved = false;
    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId);
      const status = peer.getStatus();
      this.debug.log(`Removing peer ${peerId.substring(0, 8)}... with status: ${status}`);

      try {
        if (typeof peer.markAsFailed === 'function') {
          peer.markAsFailed('failed');
        }
        peer.close();
      } catch (error) {
        this.debug.error('Error closing failed connection:', error);
      }
      this.peers.delete(peerId);
      peerRemoved = true;
      this.debug.log(`Successfully removed peer ${peerId.substring(0, 8)}... from peers Map`);
    } else {
      this.debug.log(`Peer ${peerId.substring(0, 8)}... was not in peers Map`);
    }

    // Clean up related data
    this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
    this.pendingIceCandidates.delete(peerId);

    // Always emit peersUpdated if we removed a peer or to force UI refresh
    if (peerRemoved) {
      this.debug.log(`Emitting peersUpdated after removing ${peerId.substring(0, 8)}...`);
      this.emit('peersUpdated');
    }
  }

  cleanupRaceCondition(peerId) {
    // Remove peer connection but preserve connection attempts
    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId);
      try {
        peer.close();
      } catch (error) {
        this.debug.error('Error closing race condition connection:', error);
      }
      this.peers.delete(peerId);
    }

    // Don't clear connection attempts or discovery data - just the active connection
    this.pendingIceCandidates.delete(peerId);
    this.emit('peersUpdated');
  }

  setupPeerConnectionHandlers(peerConnection) {
    peerConnection.addEventListener('iceCandidate', async (event) => {
      try {
        this.debug.log('Sending ICE candidate to', event.peerId);
        await this.mesh.sendSignalingMessage({
          type: 'ice-candidate',
          data: event.candidate
        }, event.peerId);
      } catch (error) {
        this.debug.error('Failed to send ICE candidate:', error);
      }
    });

    peerConnection.addEventListener('connected', (event) => {
      this.debug.log(`[EVENT] Connected event received from ${event.peerId.substring(0, 8)}...`);

      // Reset connection attempts on successful connection
      this.connectionAttempts.delete(event.peerId);

      // Don't emit peerConnected here - wait for data channel to be ready
      this.mesh.emit('statusChanged', { type: 'info', message: `WebRTC connected to ${event.peerId.substring(0, 8)}...` });
      this.mesh.peerDiscovery.clearConnectionAttempt(event.peerId);
      this.mesh.peerDiscovery.updateDiscoveryTimestamp(event.peerId);

      this.emit('peersUpdated');
    });

    peerConnection.addEventListener('disconnected', (event) => {
      this.mesh.emit('statusChanged', { type: 'info', message: `Disconnected from ${event.peerId.substring(0, 8)}...` });
      this.handlePeerDisconnection(event.peerId, event.reason);
    });

    peerConnection.addEventListener('dataChannelOpen', (event) => {
      this.debug.log(`[EVENT] DataChannelOpen event received from ${event.peerId.substring(0, 8)}...`);

      this.mesh.emit('statusChanged', { type: 'info', message: `Data channel ready with ${event.peerId.substring(0, 8)}...` });
      this.emit('peersUpdated');

      // Track successful connections to reset isolation timer
      if (this.mesh.peerDiscovery) {
        this.mesh.peerDiscovery.onConnectionEstablished();
      }

      // Automatically initiate key exchange when crypto is enabled
      if (this.mesh.cryptoManager) {
        // Check if we already have this peer's key to avoid duplicate exchanges
        const hasExistingKey = this.mesh.cryptoManager.peerKeys.has(event.peerId);
        if (!hasExistingKey) {
          this.debug.log(`🔐 Automatically exchanging keys with newly connected peer ${event.peerId.substring(0, 8)}...`);
          // PERFORMANCE: Defer key exchange to prevent blocking data channel establishment
          setTimeout(() => {
            this.mesh.exchangeKeysWithPeer(event.peerId).catch(error => {
              this.debug.error(`🔐 Failed to exchange keys with ${event.peerId.substring(0, 8)}:`, error);
            });
          }, 0);
        } else {
          this.debug.log(`🔐 Skipping key exchange with ${event.peerId.substring(0, 8)}... - key already exists`);
        }
      }

      this.mesh.emit('peerConnected', { peerId: event.peerId });
    });

    peerConnection.addEventListener('message', (event) => {
      this.handleIncomingMessage(event.message, event.peerId);
    });

    peerConnection.addEventListener('remoteStream', (event) => {
      this.debug.log(`[EVENT] Remote stream received from ${event.peerId.substring(0, 8)}...`);
      this.emit('remoteStream', event);

      // DISABLED: Media forwarding causes cascade renegotiation issues with 3+ peers
      // Each peer should manage their own direct streams to avoid conflicts
      // this._forwardStreamToOtherPeers(event.stream, event.peerId);
      this.debug.log('🔄 MEDIA FORWARDING: Disabled to prevent renegotiation conflicts with 3+ peers');
    });

    // Forward data stream events
    peerConnection.addEventListener('streamReceived', (event) => {
      this.debug.log(`[EVENT] Data stream received from ${event.peerId.substring(0, 8)}...`);
      this.mesh.emit('streamReceived', event);
    });

    peerConnection.addEventListener('streamCompleted', (event) => {
      this.debug.log(`[EVENT] Data stream completed from ${event.peerId.substring(0, 8)}...`);
      this.mesh.emit('streamCompleted', event);
    });

    peerConnection.addEventListener('streamAborted', (event) => {
      this.debug.log(`[EVENT] Data stream aborted from ${event.peerId.substring(0, 8)}...`);
      this.mesh.emit('streamAborted', event);
    });

    peerConnection.addEventListener('renegotiationNeeded', async (event) => {
      this.debug.log(`🔄 Renegotiation needed for ${event.peerId.substring(0, 8)}...`);

      // SMART RENEGOTIATION: Queue renegotiations to prevent conflicts
      if (this.activeRenegotiations.size >= this.maxConcurrentRenegotiations) {
        this.debug.log(`🔄 QUEUE: Renegotiation for ${event.peerId.substring(0, 8)}... queued (${this.activeRenegotiations.size} active)`);
        this.renegotiationQueue.set(event.peerId, event);
        return;
      }

      await this._performRenegotiation(peerConnection, event);
    });

    // ...existing code...
  }

  handlePeerDisconnection(peerId, reason) {
    // Prevent duplicate disconnection handling
    if (this.disconnectionInProgress.has(peerId)) {
      this.debug.log(`Disconnection already in progress for ${peerId.substring(0, 8)}..., skipping duplicate`);
      return;
    }

    this.debug.log(`Handling peer disconnection: ${peerId.substring(0, 8)}... (${reason})`);

    // Mark disconnection in progress
    this.disconnectionInProgress.add(peerId);

    try {
      // Clear all related data
      if (this.peers.has(peerId)) {
        const peerConnection = this.peers.get(peerId);

        try {
          peerConnection.close();
        } catch (error) {
          this.debug.error('Error closing peer connection:', error);
        }

        this.peers.delete(peerId);
      }

      this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
      this.pendingIceCandidates.delete(peerId);

      // Clean up eviction tracking
      this.mesh.evictionManager.clearEvictionTracking(peerId);

      // Don't remove from discovered peers immediately - let it timeout naturally
      // unless it's a goodbye or explicit removal
      if (reason === 'left network' || reason === 'manually removed') {
        this.mesh.peerDiscovery.removeDiscoveredPeer(peerId);
        this.connectionAttempts.delete(peerId);
      } else if (reason === 'connection failed' || reason === 'connection disconnected' || reason === 'ICE connection closed') {
        // For connection failures, clear the attempt so we can retry later
        this.connectionAttempts.delete(peerId);
        this.debug.log(`Cleared connection attempt for ${peerId.substring(0, 8)}... due to ${reason} - will retry later`);
      }

      this.mesh.emit('peerDisconnected', { peerId, reason });
      this.emit('peersUpdated');

      // Only trigger optimization if we're significantly under capacity
      const connectedCount = this.getConnectedPeerCount();
      const needsOptimization = connectedCount === 0; // Only optimize if completely disconnected

      if (needsOptimization && this.mesh.autoDiscovery && this.mesh.peerDiscovery.getDiscoveredPeers().length > 0) {
        this.debug.log(`Completely disconnected (${connectedCount}/${this.mesh.maxPeers}), scheduling mesh optimization`);
        setTimeout(() => {
          // Check if we still need optimization
          const currentCount = this.getConnectedPeerCount();
          if (currentCount === 0) {
            this.debug.log(`Still completely disconnected (${currentCount}/${this.mesh.maxPeers}), attempting optimization`);
            this.mesh.peerDiscovery.optimizeMeshConnections(this.peers);
          } else {
            this.debug.log(`Connection recovered (${currentCount}/${this.mesh.maxPeers}), skipping optimization`);
          }
        }, 500); // Wait 500ms before optimizing - faster response
      } else {
        this.debug.log(`Peer count appropriate at ${connectedCount}/${this.mesh.maxPeers}, no optimization needed`);
      }
    } finally {
      // Always clean up the disconnection tracking
      this.disconnectionInProgress.delete(peerId);
    }
  }

  disconnectAllPeers() {
    this.peers.forEach((peerConnection, peerId) => {
      peerConnection.close();
      this.mesh.emit('peerDisconnected', { peerId, reason: 'mesh disconnected' });
    });
  }

  disconnectPeer(peerId, reason) {
    this.handlePeerDisconnection(peerId, reason);
  }

  removePeer(peerId) {
    this.mesh.peerDiscovery.removeDiscoveredPeer(peerId);
    this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
    this.connectionAttempts.delete(peerId);

    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId);
      if (peer.connection) {
        peer.connection.close();
      }
      this.peers.delete(peerId);
      this.mesh.emit('peerDisconnected', { peerId, reason: 'manually removed' });
    }

    this.emit('peersUpdated');
  }

  canAcceptMorePeers() {
    // Count connected peers for capacity check
    const connectedCount = this.getConnectedPeerCount();
    const totalPeerCount = this.peers.size;
    
    // STRICT: Don't accept if we're at or over maxPeers
    // Remove the "+1 overhead" logic that was causing overshoot
    if (connectedCount >= this.mesh.maxPeers) {
      this.debug.log(`At or over capacity: ${connectedCount}/${this.mesh.maxPeers} connected, rejecting new connections`);
      return false;
    }
    
    // Also check total peer count (including connecting) to prevent race conditions
    if (totalPeerCount >= this.mesh.maxPeers) {
      this.debug.log(`Total peer count at capacity: ${totalPeerCount}/${this.mesh.maxPeers}, rejecting new connections`);
      return false;
    }
    
    return true;
    this.debug.log(`Cannot accept more peers: ${connectedCount}/${this.mesh.maxPeers} connected, ${totalPeerCount} total peers in Map`);
    return false;
  }

  /**
     * Count peers that are in stale/non-viable states
     */
  getStalePeerCount() {
    const now = Date.now();
    const STALE_THRESHOLD = 45000; // 45 seconds (shorter than cleanup threshold)

    return Array.from(this.peers.values()).filter(peerConnection => {
      const status = peerConnection.getStatus();
      const connectionAge = now - peerConnection.connectionStartTime;

      return connectionAge > STALE_THRESHOLD &&
                   (status === 'failed' || status === 'disconnected' || status === 'closed');
    }).length;
  }

  getConnectedPeerCount() {
    return Array.from(this.peers.values()).filter(peerConnection =>
      peerConnection.getStatus() === 'connected'
    ).length;
  }

  getConnectedPeers() {
    return Array.from(this.peers.values()).filter(peerConnection =>
      peerConnection.getStatus() === 'connected'
    );
  }

  getPeers() {
    return Array.from(this.peers.entries()).map(([peerId, peerConnection]) => ({
      peerId,
      status: peerConnection.getStatus(),
      isInitiator: peerConnection.isInitiator,
      connectionStartTime: peerConnection.connectionStartTime
    }));
  }

  hasPeer(peerId) {
    return this.peers.has(peerId);
  }

  getPeer(peerId) {
    return this.peers.get(peerId);
  }

  sendMessage(content) {
    if (!content || typeof content !== 'string') {
      this.debug.error('Invalid message content:', content);
      return 0;
    }

    // Use gossip protocol to broadcast messages throughout the mesh network
    this.debug.log(`Broadcasting message via gossip protocol: "${content}"`);
    const messageId = this.mesh.gossipManager.broadcastMessage(content, 'chat');

    if (messageId) {
      // Return the number of directly connected peers for UI feedback
      // (the message will propagate to the entire network via gossip)
      const connectedCount = this.getConnectedPeerCount();
      this.debug.log(`Message broadcasted via gossip to ${connectedCount} directly connected peer(s), will propagate to entire network`);
      return connectedCount;
    } else {
      this.debug.error('Failed to broadcast message via gossip protocol');
      return 0;
    }
  }

  /**
     * Send a message directly to a specific peer via data channel
     * @param {string} peerId - The peer ID to send to
     * @param {Object} message - The message object to send
     * @returns {boolean} - True if message was sent successfully
     */
  sendDirectMessage(peerId, message) {
    const peerConnection = this.peers.get(peerId);
    if (!peerConnection) {
      this.debug.warn(`Cannot send direct message to ${peerId?.substring(0, 8)}: peer not connected`);
      return false;
    }

    try {
      this.debug.log(`📤 Sending direct message to ${peerId?.substring(0, 8)}:`, message);
      peerConnection.sendMessage(message);
      return true;
    } catch (error) {
      this.debug.error(`Failed to send direct message to ${peerId?.substring(0, 8)}:`, error);
      return false;
    }
  }

  async handleIceCandidate(candidate, fromPeerId) {
    this.debug.log('Handling ICE candidate from', fromPeerId);

    const peerConnection = this.peers.get(fromPeerId);
    if (peerConnection) {
      try {
        await peerConnection.handleIceCandidate(candidate);
      } catch (error) {
        this.debug.error('Failed to add ICE candidate:', error);
      }
    } else {
      // No peer connection exists yet - buffer the candidate for when it's created
      this.debug.log('Buffering ICE candidate for', fromPeerId, '(no peer connection yet)');
      if (!this.pendingIceCandidates.has(fromPeerId)) {
        this.pendingIceCandidates.set(fromPeerId, []);
      }
      this.pendingIceCandidates.get(fromPeerId).push(candidate);
    }
  }

  async processPendingIceCandidates(peerId) {
    const candidates = this.pendingIceCandidates.get(peerId);
    if (candidates && candidates.length > 0) {
      this.debug.log(`Processing ${candidates.length} buffered ICE candidates for`, peerId);
      const peerConnection = this.peers.get(peerId);

      if (peerConnection) {
        for (const candidate of candidates) {
          try {
            await peerConnection.handleIceCandidate(candidate);
          } catch (error) {
            this.debug.error('Failed to add buffered ICE candidate:', error);
          }
        }

        // Clear the buffer after processing
        this.pendingIceCandidates.delete(peerId);
      }
    }
  }

  cleanup() {
    // Stop periodic cleanup
    this.stopPeriodicCleanup();

    this.peers.clear();
    this.connectionAttempts.clear();
    this.pendingIceCandidates.clear();
    this.disconnectionInProgress.clear();
    this.cleanupInProgress.clear();
    this.lastConnectionAttempt.clear();
  }

  /**
     * Start periodic cleanup of stale peer connections
     */
  startPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Run cleanup every 30 seconds - environment-aware timer
    if (environmentDetector.isBrowser) {
      this.cleanupInterval = window.setInterval(() => {
        this.cleanupStalePeers();
      }, 30000);
    } else {
      this.cleanupInterval = setInterval(() => {
        this.cleanupStalePeers();
      }, 30000);
    }
  }

  /**
     * Stop periodic cleanup
     */
  stopPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
     * Clean up peers that are in non-viable states for too long
     */
  cleanupStalePeers() {
    const now = Date.now();
    const STALE_THRESHOLD = 60000; // 60 seconds
    const DISCONNECTED_THRESHOLD = 5000; // 5 seconds for disconnected peers
    const peersToCleanup = [];

    this.peers.forEach((peerConnection, peerId) => {
      const status = peerConnection.getStatus();
      const connectionAge = now - peerConnection.connectionStartTime;

      // Immediately clean up disconnected peers
      if (status === 'disconnected' && connectionAge > DISCONNECTED_THRESHOLD) {
        this.debug.log(`Disconnected peer detected: ${peerId.substring(0, 8)}... (status: ${status}, age: ${Math.round(connectionAge / 1000)}s)`);
        peersToCleanup.push(peerId);
      } else if (connectionAge > STALE_THRESHOLD) {
        if (status === 'connecting' || status === 'channel-connecting' ||
                    status === 'failed' || status === 'closed') {
          this.debug.log(`Stale peer detected: ${peerId.substring(0, 8)}... (status: ${status}, age: ${Math.round(connectionAge / 1000)}s)`);
          peersToCleanup.push(peerId);
        }
      }
    });

    if (peersToCleanup.length > 0) {
      this.debug.log(`Cleaning up ${peersToCleanup.length} stale peer(s)`);
      peersToCleanup.forEach(peerId => {
        this.cleanupFailedConnection(peerId);
      });
    }
  }

  /**
     * Force cleanup of peers that are not in connected state (for debugging)
     */
  forceCleanupInvalidPeers() {
    this.debug.log('Force cleaning up peers not in connected state...');
    const peersToRemove = [];

    this.peers.forEach((peerConnection, peerId) => {
      const status = peerConnection.getStatus();
      if (status !== 'connected') {
        this.debug.log(`Found peer ${peerId.substring(0, 8)}... in invalid state: ${status}`);
        peersToRemove.push(peerId);
      }
    });

    peersToRemove.forEach(peerId => {
      this.debug.log(`Force removing peer ${peerId.substring(0, 8)}...`);
      this.cleanupFailedConnection(peerId);
    });

    if (peersToRemove.length > 0) {
      this.debug.log(`Force cleaned up ${peersToRemove.length} invalid peers`);
      this.emit('peersUpdated');
    }

    return peersToRemove.length;
  }

  /**
     * Get a summary of all peer states for debugging
     */
  getPeerStateSummary() {
    const summary = {
      total: this.peers.size,
      connected: 0,
      connecting: 0,
      channelConnecting: 0,
      failed: 0,
      disconnected: 0,
      closed: 0,
      other: 0,
      stale: this.getStalePeerCount()
    };

    this.peers.forEach((peerConnection) => {
      const status = peerConnection.getStatus();
      switch (status) {
        case 'connected':
          summary.connected++;
          break;
        case 'connecting':
          summary.connecting++;
          break;
        case 'channel-connecting':
          summary.channelConnecting++;
          break;
        case 'failed':
          summary.failed++;
          break;
        case 'disconnected':
          summary.disconnected++;
          break;
        case 'closed':
          summary.closed++;
          break;
        default:
          summary.other++;
      }
    });

    return summary;
  }

  getDetailedPeerStatus() {
    const peerStatuses = {};
    this.peers.forEach((peerConnection, peerId) => {
      peerStatuses[peerId.substring(0, 8) + '...'] = {
        status: peerConnection.getStatus(),
        isInitiator: peerConnection.isInitiator,
        dataChannelReady: peerConnection.dataChannelReady,
        connectionStartTime: peerConnection.connectionStartTime,
        connectionState: peerConnection.connection?.connectionState,
        iceConnectionState: peerConnection.connection?.iceConnectionState
      };
    });
    return peerStatuses;
  }

  // Get all peer connections
  getAllConnections() {
    return Array.from(this.peers.values());
  }

  /**
     * Route incoming messages based on their type
     */
  handleIncomingMessage(message, fromPeerId) {
    if (!message || typeof message !== 'object') {
      this.debug.warn('Received invalid message from', fromPeerId?.substring(0, 8));
      return;
    }

    // Emit generic messageReceived event for all messages (used by hub server)
    this.mesh.emit('messageReceived', {
      from: fromPeerId,
      data: message,
      timestamp: Date.now()
    });

    // Handle binary messages first
    if (message.type === 'binary' && message.data instanceof Uint8Array) {
      this.debug.log(`📦 Received binary message (${message.size} bytes) from ${fromPeerId.substring(0, 8)}...`);
      
      // Emit binary message directly to application
      this.mesh.emit('binaryMessageReceived', {
        from: fromPeerId,
        data: message.data,
        size: message.size,
        timestamp: Date.now()
      });
      return;
    }

    // Define message types that should be filtered from peer-readable messages
    // These messages are processed but not emitted as regular messages to UI/applications
    const filteredMessageTypes = new Set([
      'signaling-relay',
      'peer-announce-relay', 
      'bootstrap-keepalive',
      'client-peer-announcement',
      'cross-bootstrap-signaling'
    ]);

    // Check if this message type should be filtered from peer-readable messages
    const isFilteredMessage = filteredMessageTypes.has(message.type);
    if (isFilteredMessage) {
      this.debug.log(`🔇 FILTER: Processing filtered message type '${message.type}' from ${fromPeerId?.substring(0, 8)} (not emitted to UI)`);
    }

    // Route based on message type
    switch (message.type) {
      case 'gossip':
        // Gossip protocol messages (async call, but we don't wait for it)
        this.mesh.gossipManager.handleGossipMessage(message, fromPeerId).catch(error => {
          this.debug.error('Error handling gossip message:', error);
        });
        break;

      case 'eviction':
        // Handle eviction notices
        this.handleEvictionMessage(message, fromPeerId);
        break;

      case 'dht':
        // WebDHT messages
        if (this.mesh.webDHT) {
          this.mesh.webDHT.handleMessage(message, fromPeerId);
        }
        break;

      case 'renegotiation-offer':
        // Handle renegotiation offers from peers
        this.handleRenegotiationOffer(message, fromPeerId);
        break;

      case 'renegotiation-answer':
        // Handle renegotiation answers from peers
        this.handleRenegotiationAnswer(message, fromPeerId);
        break;

      case 'signaling':
        // Handle wrapped signaling messages sent via mesh
        this.debug.log(`🔄 MESH SIGNALING: Received ${message.data?.type} from ${fromPeerId?.substring(0, 8)}...`);
        if (message.data && message.data.type) {
          // Unwrap and handle the signaling message
          const signalingMessage = {
            type: message.data.type,
            data: message.data.data,
            fromPeerId: message.fromPeerId || fromPeerId,
            targetPeerId: this.mesh.peerId,
            timestamp: message.timestamp
          };

          // Route to signaling handler
          this.mesh.signalingHandler.handleSignalingMessage(signalingMessage);
        }
        break;

      case 'signaling-relay':
        // Process signaling relay messages but don't emit as peer-readable
        this.debug.log(`🔇 FILTER: Processing signaling-relay from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
        // Handle the signaling relay internally - extract and process the actual signaling message
        if (message.data && message.targetPeerId === this.mesh.peerId) {
          this.mesh.signalingHandler.handleSignalingMessage({
            type: message.data.type,
            data: message.data.data,
            fromPeerId: message.fromPeerId || fromPeerId,
            targetPeerId: message.targetPeerId,
            timestamp: message.timestamp
          });
        }
        return; // Early return to prevent fallback to gossip handler

      case 'peer-announce-relay':
        // Process peer announce relay messages but don't emit as peer-readable
        this.debug.log(`🔇 FILTER: Processing peer-announce-relay from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
        // Handle the peer announcement internally
        if (message.data && this.mesh.signalingHandler) {
          this.mesh.signalingHandler.handlePeerAnnouncement(message.data, fromPeerId);
        }
        return; // Early return to prevent fallback to gossip handler

      case 'bootstrap-keepalive':
        // Process bootstrap keepalive messages but don't emit as peer-readable
        this.debug.log(`🔇 FILTER: Processing bootstrap-keepalive from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
        // Handle keepalive internally - update peer discovery timestamps
        if (this.mesh.peerDiscovery) {
          this.mesh.peerDiscovery.updateDiscoveryTimestamp(fromPeerId);
        }
        return; // Early return to prevent fallback to gossip handler

      case 'client-peer-announcement':
        // Process client peer announcement messages but don't emit as peer-readable
        this.debug.log(`🔇 FILTER: Processing client-peer-announcement from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
        // Handle client peer announcement internally
        if (message.clientPeerId && this.mesh.signalingHandler) {
          this.mesh.signalingHandler.handlePeerAnnouncement(message.clientPeerId);
        }
        return; // Early return to prevent fallback to gossip handler

      case 'cross-bootstrap-signaling':
        // Process cross-bootstrap signaling messages but don't emit as peer-readable
        this.debug.log(`🔇 FILTER: Processing cross-bootstrap-signaling from ${fromPeerId?.substring(0, 8)} (filtered from UI)`);
        // Handle cross-bootstrap signaling internally
        if (message.originalMessage && message.targetPeerId === this.mesh.peerId && this.mesh.signalingHandler) {
          // Extract and process the wrapped signaling message
          this.mesh.signalingHandler.handleSignalingMessage({
            type: message.originalMessage.type,
            data: message.originalMessage.data,
            fromPeerId: message.originalMessage.fromPeerId || fromPeerId,
            targetPeerId: message.targetPeerId,
            timestamp: message.originalMessage.timestamp || message.timestamp
          });
        }
        return; // Early return to prevent fallback to gossip handler

      default:
        // For non-filtered message types, check if they should be emitted
        if (!isFilteredMessage) {
          // Unknown message type - try gossip as fallback for backward compatibility
          this.debug.warn(`Unknown message type '${message.type}' from ${fromPeerId?.substring(0, 8)}, trying gossip handler`);
          this.mesh.gossipManager.handleGossipMessage(message, fromPeerId).catch(error => {
            this.debug.error('Error handling unknown message as gossip:', error);
          });
        } else {
          // This is a filtered message type that doesn't have a specific handler
          this.debug.log(`🔇 FILTER: Filtered message type '${message.type}' processed but not emitted`);
        }
        break;
    }
  }

  /**
     * Handle eviction messages
     */
  handleEvictionMessage(message, fromPeerId) {
    this.debug.log(`Received eviction notice from ${fromPeerId?.substring(0, 8)}: ${message.reason}`);

    // Emit eviction event for UI notification
    this.mesh.emit('peerEvicted', {
      peerId: fromPeerId,
      reason: message.reason,
      initiatedByPeer: true
    });

    // Close the connection gracefully
    const peerConnection = this.peers.get(fromPeerId);
    if (peerConnection) {
      peerConnection.close();
      this.peers.delete(fromPeerId);
    }
  }

  /**
   * Perform a single renegotiation with conflict prevention
   * @private
   */
  async _performRenegotiation(peerConnection, event) {
    const peerId = event.peerId;
    
    // Mark this renegotiation as active
    this.activeRenegotiations.add(peerId);
    
    try {
      this.debug.log(`🔄 ACTIVE: Starting renegotiation for ${peerId.substring(0, 8)}... (${this.activeRenegotiations.size} active)`);

      // Check connection state - allow renegotiation for stable connections or those stuck in "have-local-offer"
      const signalingState = peerConnection.connection.signalingState;
      if (signalingState !== 'stable' && signalingState !== 'have-local-offer') {
        this.debug.log(`Skipping renegotiation for ${peerId.substring(0, 8)}... - connection in unsupported state (${signalingState})`);
        return;
      }

      // Additional check for connection state
      if (peerConnection.connection.connectionState !== 'connected') {
        this.debug.log(`Skipping renegotiation for ${peerId.substring(0, 8)}... - not connected (${peerConnection.connection.connectionState})`);
        return;
      }

      this.debug.log(`🔄 Creating renegotiation offer for ${peerId.substring(0, 8)}... (signaling state: ${signalingState})`);

      // Create new offer for renegotiation
      const offer = await peerConnection.connection.createOffer();

      this.debug.log('🔍 RENEGOTIATION OFFER SDP DEBUG:');
      this.debug.log(`   SDP length: ${offer.sdp.length}`);
      this.debug.log(`   Contains video: ${offer.sdp.includes('m=video')}`);
      this.debug.log(`   Contains audio: ${offer.sdp.includes('m=audio')}`);

      await peerConnection.connection.setLocalDescription(offer);

      // Send the renegotiation offer
      await this.mesh.sendSignalingMessage({
        type: 'renegotiation-offer',
        data: offer
      }, peerId);

      this.debug.log(`✅ ACTIVE: Sent renegotiation offer to ${peerId.substring(0, 8)}...`);
    } catch (error) {
      this.debug.error(`❌ ACTIVE: Failed to renegotiate with ${peerId.substring(0, 8)}...`, error);
    } finally {
      // Always clean up and process queue
      this.activeRenegotiations.delete(peerId);
      this.debug.log(`🔄 ACTIVE: Completed renegotiation for ${peerId.substring(0, 8)}... (${this.activeRenegotiations.size} active)`);
      
      // Process next queued renegotiation
      this._processRenegotiationQueue();
    }
  }

  /**
   * Process the next renegotiation in the queue
   * @private
   */
  _processRenegotiationQueue() {
    if (this.activeRenegotiations.size >= this.maxConcurrentRenegotiations || this.renegotiationQueue.size === 0) {
      return;
    }

    // Get next queued renegotiation
    const [nextPeerId, nextEvent] = this.renegotiationQueue.entries().next().value;
    this.renegotiationQueue.delete(nextPeerId);

    const peerConnection = this.peers.get(nextPeerId);
    if (peerConnection) {
      this.debug.log(`🔄 QUEUE: Processing queued renegotiation for ${nextPeerId.substring(0, 8)}...`);
      this._performRenegotiation(peerConnection, nextEvent);
    }
  }

  /**
   * Handle renegotiation offers from peers
   */
  async handleRenegotiationOffer(message, fromPeerId) {
    this.debug.log(`🔄 Handling renegotiation offer via mesh from ${fromPeerId.substring(0, 8)}...`);

    // Find the existing peer connection
    const peerConnection = this.peers.get(fromPeerId);
    if (!peerConnection) {
      this.debug.error(`No peer connection found for renegotiation from ${fromPeerId.substring(0, 8)}...`);
      return;
    }

    try {
      // Handle the renegotiation offer and get the answer
      const answer = await peerConnection.handleOffer(message.data);
      this.debug.log(`✅ Renegotiation offer processed, sending answer to ${fromPeerId.substring(0, 8)}...`);

      // Send the answer back to complete the renegotiation handshake
      await this.mesh.sendSignalingMessage({
        type: 'renegotiation-answer',
        data: answer
      }, fromPeerId);

      this.debug.log(`✅ Renegotiation completed via mesh with ${fromPeerId.substring(0, 8)}...`);
    } catch (error) {
      this.debug.error(`❌ Failed to handle renegotiation offer via mesh from ${fromPeerId.substring(0, 8)}...`, error);
    }
  }

  async handleRenegotiationAnswer(message, fromPeerId) {
    this.debug.log(`🔄 Handling renegotiation answer via mesh from ${fromPeerId.substring(0, 8)}...`);

    // Find the existing peer connection
    const peerConnection = this.peers.get(fromPeerId);
    if (!peerConnection) {
      this.debug.error(`No peer connection found for renegotiation answer from ${fromPeerId.substring(0, 8)}...`);
      return;
    }

    try {
      // Handle the renegotiation answer
      await peerConnection.handleAnswer(message.data);
      this.debug.log(`✅ Renegotiation answer processed from ${fromPeerId.substring(0, 8)}... - renegotiation complete`);
    } catch (error) {
      this.debug.error(`❌ Failed to handle renegotiation answer via mesh from ${fromPeerId.substring(0, 8)}...`, error);
    }
  }

  /**
   * Monitor and fix stuck connections that remain in "have-local-offer" state
   * This is called periodically to detect and fix connections that get stuck
   */
  monitorAndFixStuckConnections() {
    if (!this.mesh.connected) return;

    const stuckConnections = [];

    for (const [peerId, peerConnection] of this.peers) {
      if (peerConnection.connection?.signalingState === 'have-local-offer') {
        const connectionAge = Date.now() - peerConnection.connectionStartTime;

        // If connection has been stuck in "have-local-offer" for more than 10 seconds, fix it
        // This timeout balances between allowing time for signaling and detecting truly stuck connections
        if (connectionAge > 10000) {
          stuckConnections.push(peerId);
        }
      }
    }

    if (stuckConnections.length > 0) {
      this.debug.log(`🚨 STUCK MONITOR: Found ${stuckConnections.length} stuck connections - forcing recovery`);
      
      // Log a warning about local testing requirements
      if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
        console.warn('⚠️ LOCAL TESTING: WebRTC connections on localhost require media permissions!');
        console.warn('   Go to the Media tab and click "Start Media" to grant permissions.');
        console.warn('   See docs/LOCAL_TESTING.md for details.');
      }

      for (const peerId of stuckConnections) {
        this.forceConnectionRecovery(peerId).catch(error => {
          this.debug.error(`Failed to recover stuck connection for ${peerId}:`, error);
        });
      }
    }
  }

  /**
   * Force recovery of a stuck connection by completely recreating it
   */
  async forceConnectionRecovery(peerId) {
    const peerConnection = this.getPeer(peerId);
    if (!peerConnection) {
      this.debug.error(`Cannot recover - peer ${peerId} not found`);
      return null;
    }

    this.debug.log(`🔄 FORCE RECOVERY: Completely recreating connection for ${peerId.substring(0, 8)}...`);

    try {
      // Preserve the current media stream
      const currentLocalStream = peerConnection.getLocalStream();

      // Close the stuck connection
      peerConnection.close();

      // Remove from peers map
      this.peers.delete(peerId);

      // Create a completely fresh connection
      const freshConnection = await this.connectToPeer(peerId, false, {
        localStream: currentLocalStream
      });

      if (freshConnection && currentLocalStream) {
        // Apply the media stream to the fresh connection
        await freshConnection.setLocalStream(currentLocalStream);
        this.debug.log(`✅ FORCE RECOVERY: Fresh connection created with media for ${peerId.substring(0, 8)}...`);
      }

      return freshConnection;
    } catch (error) {
      this.debug.error(`❌ FORCE RECOVERY: Failed to recreate connection for ${peerId.substring(0, 8)}...`, error);
      throw error;
    }
  }

  /**
   * Start monitoring for stuck connections
   */
  startStuckConnectionMonitoring() {
    // Check every 2 seconds for stuck connections - much more responsive
    setInterval(() => {
      this.monitorAndFixStuckConnections();
    }, 2000);

    this.debug.log('🔍 Started stuck connection monitoring');
  }

  /**
   * Forward a received stream to all other connected peers (except the sender)
   * This implements media forwarding through the mesh topology
   * @param {MediaStream} stream - The stream to forward
   * @param {string} sourcePeerId - The peer ID that sent the stream (don't forward back to them)
   * @private
   */
  async _forwardStreamToOtherPeers(stream, sourcePeerId) {
    if (!stream || !sourcePeerId) {
      this.debug.warn('Cannot forward stream - invalid parameters');
      return;
    }

    this.debug.log(`🔄 FORWARD STREAM: Forwarding stream from ${sourcePeerId.substring(0, 8)}... to other connected peers`);

    // Get the original source peer ID from the stream metadata
    const originalSourcePeerId = stream._peerPigeonSourcePeerId || sourcePeerId;

    // Count how many peers we're forwarding to
    let forwardCount = 0;

    // Forward to all connected peers except the source and the original sender
    for (const [peerId, connection] of this.peers) {
      // Skip the peer who sent us the stream
      if (peerId === sourcePeerId) {
        this.debug.log(`🔄 FORWARD STREAM: Skipping source peer ${peerId.substring(0, 8)}...`);
        continue;
      }

      // Skip the original peer who created the stream (to prevent loops)
      if (peerId === originalSourcePeerId) {
        this.debug.log(`🔄 FORWARD STREAM: Skipping original stream creator ${peerId.substring(0, 8)}...`);
        continue;
      }

      // Only forward to connected peers
      if (connection.getStatus() !== 'connected') {
        this.debug.log(`🔄 FORWARD STREAM: Skipping disconnected peer ${peerId.substring(0, 8)}...`);
        continue;
      }

      try {
        this.debug.log(`🔄 FORWARD STREAM: Setting forwarded stream for peer ${peerId.substring(0, 8)}...`);

        // CRITICAL: Clone the stream to avoid conflicts
        const forwardedStream = stream.clone();

        // Mark the forwarded stream with original source information
        Object.defineProperty(forwardedStream, '_peerPigeonSourcePeerId', {
          value: originalSourcePeerId,
          writable: false,
          enumerable: false,
          configurable: false
        });

        Object.defineProperty(forwardedStream, '_peerPigeonOrigin', {
          value: 'forwarded',
          writable: false,
          enumerable: false,
          configurable: false
        });

        // Set the cloned stream as the local stream for this connection
        await connection.setLocalStream(forwardedStream);

        forwardCount++;
        this.debug.log(`✅ FORWARD STREAM: Successfully forwarded stream to peer ${peerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`❌ FORWARD STREAM: Failed to forward stream to peer ${peerId.substring(0, 8)}...`, error);
      }
    }

    this.debug.log(`🔄 FORWARD STREAM: Forwarded stream from ${sourcePeerId.substring(0, 8)}... to ${forwardCount} peer(s)`);
  }
}
