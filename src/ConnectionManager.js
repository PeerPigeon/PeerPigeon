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
    this.connectionTimeouts = new Map();
    this.pendingIceCandidates = new Map();
    this.disconnectionInProgress = new Set();
    this.cleanupInProgress = new Set();
    this.lastConnectionAttempt = new Map(); // Track last attempt time per peer

    // Configuration
    this.maxConnectionAttempts = 3;
    this.connectionTimeout = 30000; // Reduced to 30 seconds for faster retry
    this.retryDelay = 1500; // 1.5 second cooldown between attempts to same peer

    // Start periodic cleanup of stale peers
    this.startPeriodicCleanup();

    // Start monitoring for stuck connections
    this.startStuckConnectionMonitoring();
  }

  async connectToPeer(targetPeerId) {
    this.debug.log(`connectToPeer called for ${targetPeerId.substring(0, 8)}...`);

    // Enhanced duplicate connection prevention
    if (this.peers.has(targetPeerId)) {
      this.debug.log(`Already connected to ${targetPeerId.substring(0, 8)}...`);
      return;
    }

    // Check if we're already in the process of connecting
    if (this.connectionTimeouts.has(targetPeerId)) {
      this.debug.log(`Already connecting to ${targetPeerId.substring(0, 8)}... (connection in progress)`);
      return;
    }

    // Check if we're already attempting through PeerDiscovery
    if (this.mesh.peerDiscovery.isAttemptingConnection(targetPeerId)) {
      this.debug.log(`Already attempting connection to ${targetPeerId.substring(0, 8)}... via PeerDiscovery`);
      return;
    }

    if (!this.mesh.canAcceptMorePeers()) {
      this.debug.log(`Cannot connect to ${targetPeerId.substring(0, 8)}... (max peers reached: ${this.mesh.maxPeers})`);
      return;
    }

    // Check retry cooldown (only apply after first attempt)
    const now = Date.now();
    const attempts = this.connectionAttempts.get(targetPeerId) || 0;
    const connectedCount = this.getConnectedPeerCount(); // Calculate once and reuse

    if (attempts > 0) {
      const lastAttempt = this.lastConnectionAttempt.get(targetPeerId) || 0;

      // Use shorter delay for isolated peers to help them connect faster
      const retryDelay = connectedCount === 0 ? 500 : this.retryDelay; // 500ms for isolated peers, 1500ms otherwise

      if (now - lastAttempt < retryDelay) {
        const remaining = retryDelay - (now - lastAttempt);
        this.debug.log(`Connection to ${targetPeerId.substring(0, 8)}... on cooldown (${Math.round(remaining / 1000)}s remaining, isolated: ${connectedCount === 0})`);
        return;
      }
    }

    // Check connection attempt count - be more lenient with isolated peers
    const maxAttempts = connectedCount === 0 ? 5 : this.maxConnectionAttempts; // 5 attempts for isolated peers
    if (attempts >= maxAttempts) {
      this.mesh.emit('statusChanged', { type: 'warning', message: `Max connection attempts reached for ${targetPeerId.substring(0, 8)}... (${attempts}/${maxAttempts}, isolated: ${connectedCount === 0})` });
      this.mesh.peerDiscovery.removeDiscoveredPeer(targetPeerId);
      return;
    }

    this.debug.log(`Starting connection to ${targetPeerId.substring(0, 8)}... (attempt ${attempts + 1})`);
    this.connectionAttempts.set(targetPeerId, attempts + 1);
    this.lastConnectionAttempt.set(targetPeerId, now);
    this.mesh.peerDiscovery.trackConnectionAttempt(targetPeerId);

    // Set connection timeout - longer for media-enabled connections and extra time for isolated peers
    const hasMedia = this.mesh.mediaManager.localStream !== null;
    const baseTimeout = hasMedia ? 60000 : 45000; // 60s for media, 45s for data-only (increased)
    const timeoutDuration = connectedCount === 0 ? baseTimeout + 15000 : baseTimeout; // Extra 15s for isolated peers

    this.debug.log(`Setting connection timeout for ${targetPeerId.substring(0, 8)}... - ${timeoutDuration / 1000}s (media: ${hasMedia}, isolated: ${connectedCount === 0})`);

    const timeoutId = setTimeout(() => {
      if (this.peers.has(targetPeerId)) {
        const peer = this.peers.get(targetPeerId);
        const status = peer.getStatus();
        const detailedStatus = peer.getDetailedStatus();
        this.debug.log(`Connection timeout check for ${targetPeerId.substring(0, 8)}... - current status: ${status}`);
        this.debug.log('Detailed status:', detailedStatus);

        // Cleanup if not fully connected (includes 'connecting', 'new', 'failed', etc.)
        if (status !== 'connected') {
          this.mesh.emit('statusChanged', { type: 'warning', message: `Connection timeout for ${targetPeerId.substring(0, 8)}... (status: ${status}, media: ${hasMedia})` });
          this.handleConnectionTimeout(targetPeerId);
        } else {
          this.debug.log(`Connection to ${targetPeerId.substring(0, 8)}... is connected, clearing timeout`);
          this.connectionTimeouts.delete(targetPeerId);
        }
      } else {
        this.debug.log(`Peer ${targetPeerId.substring(0, 8)}... no longer in peers Map, cleaning up timeout`);
        this.connectionTimeouts.delete(targetPeerId);
      }
    }, timeoutDuration);

    this.connectionTimeouts.set(targetPeerId, timeoutId);

    try {
      this.debug.log(`Creating PeerConnection for ${targetPeerId.substring(0, 8)}...`);

      // Get current media stream if available
      const localStream = this.mesh.mediaManager.localStream;
      const options = {
        localStream,
        // ALWAYS enable both audio and video transceivers for maximum compatibility
        // This allows peers to receive media even if they don't have media when connecting
        enableAudio: true,
        enableVideo: true
      };

      const peerConnection = new PeerConnection(targetPeerId, true, options);

      // Set up event handlers BEFORE creating connection to catch all events
      this.setupPeerConnectionHandlers(peerConnection);
      this.peers.set(targetPeerId, peerConnection);

      this.debug.log(`Creating WebRTC connection for ${targetPeerId.substring(0, 8)}...`);
      await peerConnection.createConnection();

      this.debug.log(`Creating offer for ${targetPeerId.substring(0, 8)}... (with media: ${hasMedia})`);
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

  handleConnectionTimeout(peerId) {
    this.debug.log(`Connection timeout for ${peerId.substring(0, 8)}...`);

    const attempts = this.connectionAttempts.get(peerId) || 0;
    if (attempts >= this.maxConnectionAttempts) {
      this.mesh.emit('statusChanged', { type: 'warning', message: `Removing unresponsive peer ${peerId.substring(0, 8)}... after ${attempts} attempts` });
      this.mesh.peerDiscovery.removeDiscoveredPeer(peerId);
      this.connectionAttempts.delete(peerId);
    } else {
      this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
      this.debug.log(`Will retry connection to ${peerId.substring(0, 8)}... (attempt ${attempts}/${this.maxConnectionAttempts})`);
    }

    // Always cleanup the failed connection and ensure it's removed from peers Map
    this.cleanupFailedConnection(peerId);

    // Double-check that the peer is actually removed from the UI
    if (this.peers.has(peerId)) {
      this.debug.warn(`Peer ${peerId.substring(0, 8)}... still in peers Map after timeout cleanup, force removing`);
      this.peers.delete(peerId);
      this.emit('peersUpdated');
    }
  }

  cleanupFailedConnection(peerId) {
    this.debug.log(`Cleaning up failed connection for ${peerId.substring(0, 8)}...`);

    // Clear timeout
    const timeoutId = this.connectionTimeouts.get(peerId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.connectionTimeouts.delete(peerId);
      this.debug.log(`Cleared timeout for ${peerId.substring(0, 8)}...`);
    }

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
    // Clear timeout
    const timeoutId = this.connectionTimeouts.get(peerId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.connectionTimeouts.delete(peerId);
    }

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

      // Clear connection timeout on successful connection
      const timeoutId = this.connectionTimeouts.get(event.peerId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.connectionTimeouts.delete(event.peerId);
      }

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
        this.debug.log(`🔐 Automatically exchanging keys with newly connected peer ${event.peerId.substring(0, 8)}...`);
        // Use setTimeout to ensure the connection is fully established
        setTimeout(() => {
          this.mesh.exchangeKeysWithPeer(event.peerId).catch(error => {
            this.debug.error(`🔐 Failed to exchange keys with ${event.peerId.substring(0, 8)}:`, error);
          });
        }, 100);
      }

      this.mesh.emit('peerConnected', { peerId: event.peerId });
    });

    peerConnection.addEventListener('message', (event) => {
      this.handleIncomingMessage(event.message, event.peerId);
    });

    peerConnection.addEventListener('remoteStream', (event) => {
      this.debug.log(`[EVENT] Remote stream received from ${event.peerId.substring(0, 8)}...`);
      this.emit('remoteStream', event);

      // CRITICAL: Forward the stream to other connected peers (media forwarding)
      this._forwardStreamToOtherPeers(event.stream, event.peerId);
    });

    peerConnection.addEventListener('renegotiationNeeded', async (event) => {
      this.debug.log(`🔄 Renegotiation needed for ${event.peerId.substring(0, 8)}...`);

      try {
        // Check connection state - allow renegotiation for stable connections or those stuck in "have-local-offer"
        // The latter case indicates an incomplete initial handshake that needs to be completed
        const signalingState = peerConnection.connection.signalingState;
        if (signalingState !== 'stable' && signalingState !== 'have-local-offer') {
          this.debug.log(`Skipping renegotiation for ${event.peerId.substring(0, 8)}... - connection in unsupported state (${signalingState})`);
          return;
        }

        // CRITICAL FIX: Check for stuck "have-local-offer" connections and force recovery
        if (signalingState === 'have-local-offer') {
          this.debug.log(`� STUCK CONNECTION RECOVERY: Connection with ${event.peerId.substring(0, 8)}... stuck in "have-local-offer" - forcing complete recovery`);

          try {
            // DIRECT FIX: Force the connection back to working state by bypassing the stuck offer
            this.debug.log(`🔄 RECOVERY: Creating bypass connection for stuck peer ${event.peerId.substring(0, 8)}...`);

            // Get the current local stream to preserve media state
            const currentLocalStream = peerConnection.getLocalStream();

            // Close and recreate the connection completely
            peerConnection.close();

            // Remove the old connection
            this.peers.delete(event.peerId);

            // Create a fresh connection with media
            const freshConnection = await this.connectToPeer(event.peerId, false, {
              localStream: currentLocalStream
            });

            if (freshConnection) {
              this.debug.log(`✅ RECOVERY: Successfully created fresh connection for ${event.peerId.substring(0, 8)}... - media should work now`);

              // Apply media stream to the fresh connection
              if (currentLocalStream) {
                await freshConnection.setLocalStream(currentLocalStream);
                this.debug.log(`✅ RECOVERY: Applied media stream to fresh connection for ${event.peerId.substring(0, 8)}...`);
              }
            } else {
              this.debug.error(`❌ RECOVERY: Failed to create fresh connection for ${event.peerId.substring(0, 8)}...`);
            }

            return; // Exit early - fresh connection will handle renegotiation naturally
          } catch (error) {
            this.debug.error(`❌ RECOVERY: Complete recovery failed for ${event.peerId.substring(0, 8)}...`, error);
            // Continue with existing fallback logic
          }
        }

        // Additional check for connection state
        if (peerConnection.connection.connectionState !== 'connected') {
          this.debug.log(`Skipping renegotiation for ${event.peerId.substring(0, 8)}... - not connected (${peerConnection.connection.connectionState})`);
          return;
        }

        this.debug.log(`🔄 Creating renegotiation offer for ${event.peerId.substring(0, 8)}... (signaling state: ${signalingState})`);

        // Create new offer for renegotiation - no need for special options since we have pre-allocated transceivers
        const offer = await peerConnection.connection.createOffer();

        // CRITICAL DEBUG: Check if offer SDP contains media information
        this.debug.log('🔍 RENEGOTIATION OFFER SDP DEBUG:');
        this.debug.log(`   SDP length: ${offer.sdp.length}`);
        this.debug.log(`   Contains video: ${offer.sdp.includes('m=video')}`);
        this.debug.log(`   Contains audio: ${offer.sdp.includes('m=audio')}`);
        this.debug.log(`   Send recv: ${offer.sdp.includes('sendrecv')}`);
        const videoLines = offer.sdp.split('\n').filter(line => line.includes('video')).length;
        const audioLines = offer.sdp.split('\n').filter(line => line.includes('audio')).length;
        this.debug.log(`   Video lines: ${videoLines}, Audio lines: ${audioLines}`);

        await peerConnection.connection.setLocalDescription(offer);

        // Send the renegotiation offer via regular signaling (NOT as a new offer, but as renegotiation)
        await this.mesh.sendSignalingMessage({
          type: 'renegotiation-offer',
          data: offer
        }, event.peerId);

        // AGGRESSIVE FIX: Set up stuck connection watchdog timer
        setTimeout(() => {
          if (peerConnection.connection.signalingState === 'have-local-offer') {
            this.debug.log(`⚠️ WATCHDOG: Connection with ${event.peerId.substring(0, 8)}... still stuck after 10 seconds - forcing emergency recovery`);

            // Emergency recovery: Create immediate bypass
            this.connectToPeer(event.peerId, false, {
              localStream: peerConnection.getLocalStream(),
              emergency: true
            }).catch(err => {
              this.debug.error(`❌ EMERGENCY: Failed emergency recovery for ${event.peerId.substring(0, 8)}...`, err);
            });
          }
        }, 10000); // 10 second watchdog

        this.debug.log(`🔄 Sent renegotiation offer to ${event.peerId.substring(0, 8)}... (signaling state: ${signalingState})`);
      } catch (error) {
        this.debug.error(`Failed to renegotiate with ${event.peerId}:`, error);

        // If renegotiation fails due to m-line order, log but don't crash
        if (error.name === 'InvalidAccessError' && error.message.includes('m-line')) {
          this.debug.log(`🔄 M-line order error detected for ${event.peerId.substring(0, 8)}... - this is expected with replaceTrack approach`);
        }
      }
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
      const timeoutId = this.connectionTimeouts.get(peerId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.connectionTimeouts.delete(peerId);
      }

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
        }, 2000); // Wait 2 seconds before optimizing to allow connections to stabilize
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

    // Clear timeout if exists
    const timeoutId = this.connectionTimeouts.get(peerId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.connectionTimeouts.delete(peerId);
    }

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
    // Count connected peers first (these are guaranteed slots)
    const connectedCount = this.getConnectedPeerCount();

    // If we have room for connected peers, always accept
    if (connectedCount < this.mesh.maxPeers) {
      return true;
    }

    // If at max connected peers, check if we have stale peers we can evict
    const stalePeerCount = this.getStalePeerCount();
    const totalPeerCount = this.peers.size;

    // Accept if we have stale peers that can be cleaned up
    if (stalePeerCount > 0 && totalPeerCount >= this.mesh.maxPeers) {
      this.debug.log(`At capacity (${connectedCount}/${this.mesh.maxPeers} connected, ${totalPeerCount} total) but have ${stalePeerCount} stale peers that can be evicted`);
      return true;
    }

    // Reject if we're at capacity with all viable peers
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
    this.connectionTimeouts.clear();
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

      default:
        // Unknown message type - try gossip as fallback for backward compatibility
        this.debug.warn(`Unknown message type '${message.type}' from ${fromPeerId?.substring(0, 8)}, trying gossip handler`);
        this.mesh.gossipManager.handleGossipMessage(message, fromPeerId).catch(error => {
          this.debug.error('Error handling unknown message as gossip:', error);
        });
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
        if (connectionAge > 10000) {
          stuckConnections.push(peerId);
        }
      }
    }

    if (stuckConnections.length > 0) {
      this.debug.log(`🚨 STUCK MONITOR: Found ${stuckConnections.length} stuck connections - forcing recovery`);

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
    // Check every 5 seconds for stuck connections (more aggressive)
    setInterval(() => {
      this.monitorAndFixStuckConnections();
    }, 5000);

    // Additional check specifically for isolated peers every 10 seconds
    setInterval(() => {
      this.checkForIsolatedPeer();
    }, 10000);

    this.debug.log('🔍 Started stuck connection monitoring (5s intervals) and isolation monitoring (10s intervals)');
  }

  /**
   * Check specifically for isolated peers and force aggressive reconnection
   */
  checkForIsolatedPeer() {
    const activeConnections = this.getActiveConnections().length;

    if (activeConnections === 0) {
      const availablePeers = this.mesh.peerDiscovery.getAvailablePeers();
      this.debug.warn(`🚨 ISOLATED PEER DETECTED: ${activeConnections} connections, ${availablePeers.length} peers available`);

      // Clear existing connection attempts to reset retry logic
      this.connectionAttempts.clear();
      this.lastConnectionAttempt.clear();

      // Attempt connections to up to 3 peers with staggered timing
      const peersToTry = availablePeers.slice(0, 3);
      peersToTry.forEach((peerId, index) => {
        setTimeout(() => {
          this.debug.log(`🚀 Emergency connection attempt to ${peerId.substring(0, 8)}...`);
          this.connectToPeer(peerId);
        }, index * 1000); // Stagger by 1 second
      });

      // If still isolated after 3 seconds, try peer discovery refresh
      setTimeout(() => {
        if (this.getActiveConnections().length === 0) {
          this.debug.warn('🔴 Still isolated after emergency attempts, refreshing peer discovery');
          if (this.mesh.peerDiscovery.refreshPeerList) {
            this.mesh.peerDiscovery.refreshPeerList();
          }
        }
      }, 3000);
    }
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
