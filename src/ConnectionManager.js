import { EventEmitter } from './EventEmitter.js';
import { PeerConnection } from './PeerConnection.js';
import { environmentDetector } from './EnvironmentDetector.js';

/**
 * Manages individual peer connections, timeouts, and connection attempts
 */
export class ConnectionManager extends EventEmitter {
    constructor(mesh) {
        super();
        this.mesh = mesh;
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
    }

    async connectToPeer(targetPeerId) {
        console.log(`connectToPeer called for ${targetPeerId.substring(0, 8)}...`);
        
        // Enhanced duplicate connection prevention
        if (this.peers.has(targetPeerId)) {
            console.log(`Already connected to ${targetPeerId.substring(0, 8)}...`);
            return;
        }

        // Check if we're already in the process of connecting
        if (this.connectionTimeouts.has(targetPeerId)) {
            console.log(`Already connecting to ${targetPeerId.substring(0, 8)}... (connection in progress)`);
            return;
        }

        // Check if we're already attempting through PeerDiscovery
        if (this.mesh.peerDiscovery.isAttemptingConnection(targetPeerId)) {
            console.log(`Already attempting connection to ${targetPeerId.substring(0, 8)}... via PeerDiscovery`);
            return;
        }

        if (!this.mesh.canAcceptMorePeers()) {
            console.log(`Cannot connect to ${targetPeerId.substring(0, 8)}... (max peers reached: ${this.mesh.maxPeers})`);
            return;
        }

        // Check retry cooldown (only apply after first attempt)
        const now = Date.now();
        const attempts = this.connectionAttempts.get(targetPeerId) || 0;
        if (attempts > 0) {
            const lastAttempt = this.lastConnectionAttempt.get(targetPeerId) || 0;
            
            // Use shorter delay for isolated peers to help them connect faster
            const connectedCount = this.getConnectedPeerCount();
            const retryDelay = connectedCount === 0 ? 500 : this.retryDelay; // 500ms for isolated peers, 1500ms otherwise
            
            if (now - lastAttempt < retryDelay) {
                const remaining = retryDelay - (now - lastAttempt);
                console.log(`Connection to ${targetPeerId.substring(0, 8)}... on cooldown (${Math.round(remaining/1000)}s remaining, isolated: ${connectedCount === 0})`);
                return;
            }
        }

        // Check connection attempt count
        if (attempts >= this.maxConnectionAttempts) {
            this.mesh.emit('statusChanged', { type: 'warning', message: `Max connection attempts reached for ${targetPeerId.substring(0, 8)}...` });
            this.mesh.peerDiscovery.removeDiscoveredPeer(targetPeerId);
            return;
        }

        console.log(`Starting connection to ${targetPeerId.substring(0, 8)}... (attempt ${attempts + 1})`);
        this.connectionAttempts.set(targetPeerId, attempts + 1);
        this.lastConnectionAttempt.set(targetPeerId, now);
        this.mesh.peerDiscovery.trackConnectionAttempt(targetPeerId);

        // Set connection timeout - longer for media-enabled connections
        const hasMedia = this.mesh.mediaManager.localStream !== null;
        const timeoutDuration = hasMedia ? 45000 : 30000; // 45s for media, 30s for data-only
        
        console.log(`Setting connection timeout for ${targetPeerId.substring(0, 8)}... - ${timeoutDuration/1000}s (media: ${hasMedia})`);
        
        const timeoutId = setTimeout(() => {
            if (this.peers.has(targetPeerId)) {
                const peer = this.peers.get(targetPeerId);
                const status = peer.getStatus();
                const detailedStatus = peer.getDetailedStatus();
                console.log(`Connection timeout check for ${targetPeerId.substring(0, 8)}... - current status: ${status}`);
                console.log(`Detailed status:`, detailedStatus);
                
                // Cleanup if not fully connected (includes 'connecting', 'new', 'failed', etc.)
                if (status !== 'connected') {
                    this.mesh.emit('statusChanged', { type: 'warning', message: `Connection timeout for ${targetPeerId.substring(0, 8)}... (status: ${status}, media: ${hasMedia})` });
                    this.handleConnectionTimeout(targetPeerId);
                } else {
                    console.log(`Connection to ${targetPeerId.substring(0, 8)}... is connected, clearing timeout`);
                    this.connectionTimeouts.delete(targetPeerId);
                }
            } else {
                console.log(`Peer ${targetPeerId.substring(0, 8)}... no longer in peers Map, cleaning up timeout`);
                this.connectionTimeouts.delete(targetPeerId);
            }
        }, timeoutDuration);
        
        this.connectionTimeouts.set(targetPeerId, timeoutId);

        try {
            console.log(`Creating PeerConnection for ${targetPeerId.substring(0, 8)}...`);
            
            // Get current media stream if available
            const localStream = this.mesh.mediaManager.localStream;
            const options = { 
                localStream,
                enableAudio: hasMedia && localStream.getAudioTracks().length > 0,
                enableVideo: hasMedia && localStream.getVideoTracks().length > 0
            };
            
            const peerConnection = new PeerConnection(targetPeerId, true, options);
            
            // Set up event handlers BEFORE creating connection to catch all events
            this.setupPeerConnectionHandlers(peerConnection);
            this.peers.set(targetPeerId, peerConnection);
            
            console.log(`Creating WebRTC connection for ${targetPeerId.substring(0, 8)}...`);
            await peerConnection.createConnection();

            console.log(`Creating offer for ${targetPeerId.substring(0, 8)}... (with media: ${hasMedia})`);
            const offer = await peerConnection.createOffer();
            
            console.log(`Offer created for ${targetPeerId.substring(0, 8)}...`, {
                type: offer.type,
                sdpLength: offer.sdp?.length || 0,
                hasAudio: offer.sdp?.includes('m=audio') || false,
                hasVideo: offer.sdp?.includes('m=video') || false
            });

            console.log(`Sending offer to ${targetPeerId.substring(0, 8)}...`);
            await this.mesh.signalingClient.sendSignalingMessage({
                type: 'offer',
                data: offer,
                targetPeerId
            });

            this.mesh.emit('statusChanged', { type: 'info', message: `Offer sent to ${targetPeerId.substring(0, 8)}...` });
        } catch (error) {
            console.error('Failed to connect to peer:', error);
            this.mesh.emit('statusChanged', { type: 'error', message: `Failed to connect to ${targetPeerId.substring(0, 8)}...: ${error.message}` });
            this.cleanupFailedConnection(targetPeerId);
        }
    }

    handleConnectionTimeout(peerId) {
        console.log(`Connection timeout for ${peerId.substring(0, 8)}...`);
        
        const attempts = this.connectionAttempts.get(peerId) || 0;
        if (attempts >= this.maxConnectionAttempts) {
            this.mesh.emit('statusChanged', { type: 'warning', message: `Removing unresponsive peer ${peerId.substring(0, 8)}... after ${attempts} attempts` });
            this.mesh.peerDiscovery.removeDiscoveredPeer(peerId);
            this.connectionAttempts.delete(peerId);
        } else {
            this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
            console.log(`Will retry connection to ${peerId.substring(0, 8)}... (attempt ${attempts}/${this.maxConnectionAttempts})`);
        }
        
        // Always cleanup the failed connection and ensure it's removed from peers Map
        this.cleanupFailedConnection(peerId);
        
        // Double-check that the peer is actually removed from the UI
        if (this.peers.has(peerId)) {
            console.warn(`Peer ${peerId.substring(0, 8)}... still in peers Map after timeout cleanup, force removing`);
            this.peers.delete(peerId);
            this.emit('peersUpdated');
        }
    }

    cleanupFailedConnection(peerId) {
        console.log(`Cleaning up failed connection for ${peerId.substring(0, 8)}...`);
        
        // Clear timeout
        const timeoutId = this.connectionTimeouts.get(peerId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.connectionTimeouts.delete(peerId);
            console.log(`Cleared timeout for ${peerId.substring(0, 8)}...`);
        }
        
        // Remove peer connection
        let peerRemoved = false;
        if (this.peers.has(peerId)) {
            const peer = this.peers.get(peerId);
            const status = peer.getStatus();
            console.log(`Removing peer ${peerId.substring(0, 8)}... with status: ${status}`);
            
            try {
                if (typeof peer.markAsFailed === 'function') {
                    peer.markAsFailed('failed');
                }
                peer.close();
            } catch (error) {
                console.error('Error closing failed connection:', error);
            }
            this.peers.delete(peerId);
            peerRemoved = true;
            console.log(`Successfully removed peer ${peerId.substring(0, 8)}... from peers Map`);
        } else {
            console.log(`Peer ${peerId.substring(0, 8)}... was not in peers Map`);
        }
        
        // Clean up related data
        this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
        this.pendingIceCandidates.delete(peerId);
        
        // Always emit peersUpdated if we removed a peer or to force UI refresh
        if (peerRemoved) {
            console.log(`Emitting peersUpdated after removing ${peerId.substring(0, 8)}...`);
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
                console.error('Error closing race condition connection:', error);
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
                console.log('Sending ICE candidate to', event.peerId);
                await this.mesh.signalingClient.sendSignalingMessage({
                    type: 'ice-candidate',
                    data: event.candidate,
                    targetPeerId: event.peerId
                });
            } catch (error) {
                console.error('Failed to send ICE candidate:', error);
            }
        });

        peerConnection.addEventListener('connected', (event) => {
            console.log(`[EVENT] Connected event received from ${event.peerId.substring(0, 8)}...`);
            
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
            console.log(`[EVENT] DataChannelOpen event received from ${event.peerId.substring(0, 8)}...`);
            
            this.mesh.emit('statusChanged', { type: 'info', message: `Data channel ready with ${event.peerId.substring(0, 8)}...` });
            this.emit('peersUpdated');
            this.mesh.emit('peerConnected', { peerId: event.peerId });
        });

        peerConnection.addEventListener('message', (event) => {
            this.handleIncomingMessage(event.message, event.peerId);
        });

        peerConnection.addEventListener('remoteStream', (event) => {
            console.log(`[EVENT] Remote stream received from ${event.peerId.substring(0, 8)}...`);
            this.emit('remoteStream', event);
        });

        peerConnection.addEventListener('renegotiationNeeded', async (event) => {
            console.log(`🔄 Renegotiation needed for ${event.peerId.substring(0, 8)}...`);
            
            try {
                // Check connection state before attempting renegotiation
                if (peerConnection.connection.signalingState !== 'stable') {
                    console.log(`Skipping renegotiation for ${event.peerId.substring(0, 8)}... - connection not stable (${peerConnection.connection.signalingState})`);
                    return;
                }
                
                // Additional check for connection state
                if (peerConnection.connection.connectionState !== 'connected') {
                    console.log(`Skipping renegotiation for ${event.peerId.substring(0, 8)}... - not connected (${peerConnection.connection.connectionState})`);
                    return;
                }

                console.log(`🔄 Creating renegotiation offer for ${event.peerId.substring(0, 8)}...`);
                
                // Create new offer with restartIce flag to avoid m-line issues
                const offerOptions = {
                    iceRestart: false, // Don't restart ICE unless necessary
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                };
                
                const offer = await peerConnection.connection.createOffer(offerOptions);
                await peerConnection.connection.setLocalDescription(offer);
                
                // Send the new offer to the peer using the correct signaling method
                await this.mesh.signalingClient.sendSignalingMessage({
                    type: 'offer',
                    data: offer,
                    targetPeerId: event.peerId
                });
                
                console.log(`🔄 Sent renegotiation offer to ${event.peerId.substring(0, 8)}...`);
            } catch (error) {
                console.error(`Failed to renegotiate with ${event.peerId}:`, error);
                
                // If renegotiation fails due to m-line order, log but don't crash
                if (error.name === 'InvalidAccessError' && error.message.includes('m-line')) {
                    console.log(`🔄 M-line order error detected for ${event.peerId.substring(0, 8)}... - this is expected with replaceTrack approach`);
                }
            }
        });

        // ...existing code...
    }

    handlePeerDisconnection(peerId, reason) {
        // Prevent duplicate disconnection handling
        if (this.disconnectionInProgress.has(peerId)) {
            console.log(`Disconnection already in progress for ${peerId.substring(0, 8)}..., skipping duplicate`);
            return;
        }
        
        console.log(`Handling peer disconnection: ${peerId.substring(0, 8)}... (${reason})`);
        
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
                    console.error('Error closing peer connection:', error);
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
                console.log(`Cleared connection attempt for ${peerId.substring(0, 8)}... due to ${reason} - will retry later`);
            }
            
            this.mesh.emit('peerDisconnected', { peerId, reason });
            this.emit('peersUpdated');
            
            // Only trigger optimization if we're significantly under capacity
            const connectedCount = this.getConnectedPeerCount();
            const needsOptimization = connectedCount === 0; // Only optimize if completely disconnected
                
            if (needsOptimization && this.mesh.autoDiscovery && this.mesh.peerDiscovery.getDiscoveredPeers().length > 0) {
                console.log(`Completely disconnected (${connectedCount}/${this.mesh.maxPeers}), scheduling mesh optimization`);
                setTimeout(() => {
                    // Check if we still need optimization
                    const currentCount = this.getConnectedPeerCount();
                    if (currentCount === 0) {
                        console.log(`Still completely disconnected (${currentCount}/${this.mesh.maxPeers}), attempting optimization`);
                        this.mesh.peerDiscovery.optimizeMeshConnections(this.peers);
                    } else {
                        console.log(`Connection recovered (${currentCount}/${this.mesh.maxPeers}), skipping optimization`);
                    }
                }, 2000); // Wait 2 seconds before optimizing to allow connections to stabilize
            } else {
                console.log(`Peer count appropriate at ${connectedCount}/${this.mesh.maxPeers}, no optimization needed`);
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
            console.log(`At capacity (${connectedCount}/${this.mesh.maxPeers} connected, ${totalPeerCount} total) but have ${stalePeerCount} stale peers that can be evicted`);
            return true;
        }
        
        // Reject if we're at capacity with all viable peers
        console.log(`Cannot accept more peers: ${connectedCount}/${this.mesh.maxPeers} connected, ${totalPeerCount} total peers in Map`);
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
            console.error('Invalid message content:', content);
            return 0;
        }

        // Use gossip protocol to broadcast messages throughout the mesh network
        console.log(`Broadcasting message via gossip protocol: "${content}"`);
        const messageId = this.mesh.gossipManager.broadcastMessage(content, 'chat');
        
        if (messageId) {
            // Return the number of directly connected peers for UI feedback
            // (the message will propagate to the entire network via gossip)
            const connectedCount = this.getConnectedPeerCount();
            console.log(`Message broadcasted via gossip to ${connectedCount} directly connected peer(s), will propagate to entire network`);
            return connectedCount;
        } else {
            console.error('Failed to broadcast message via gossip protocol');
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
            console.warn(`Cannot send direct message to ${peerId?.substring(0, 8)}: peer not connected`);
            return false;
        }

        try {
            console.log(`📤 Sending direct message to ${peerId?.substring(0, 8)}:`, message);
            peerConnection.sendMessage(message);
            return true;
        } catch (error) {
            console.error(`Failed to send direct message to ${peerId?.substring(0, 8)}:`, error);
            return false;
        }
    }

    async handleIceCandidate(candidate, fromPeerId) {
        console.log('Handling ICE candidate from', fromPeerId);
        
        const peerConnection = this.peers.get(fromPeerId);
        if (peerConnection) {
            try {
                await peerConnection.handleIceCandidate(candidate);
            } catch (error) {
                console.error('Failed to add ICE candidate:', error);
            }
        } else {
            // No peer connection exists yet - buffer the candidate for when it's created
            console.log('Buffering ICE candidate for', fromPeerId, '(no peer connection yet)');
            if (!this.pendingIceCandidates.has(fromPeerId)) {
                this.pendingIceCandidates.set(fromPeerId, []);
            }
            this.pendingIceCandidates.get(fromPeerId).push(candidate);
        }
    }

    async processPendingIceCandidates(peerId) {
        const candidates = this.pendingIceCandidates.get(peerId);
        if (candidates && candidates.length > 0) {
            console.log(`Processing ${candidates.length} buffered ICE candidates for`, peerId);
            const peerConnection = this.peers.get(peerId);
            
            if (peerConnection) {
                for (const candidate of candidates) {
                    try {
                        await peerConnection.handleIceCandidate(candidate);
                    } catch (error) {
                        console.error('Failed to add buffered ICE candidate:', error);
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
                console.log(`Disconnected peer detected: ${peerId.substring(0, 8)}... (status: ${status}, age: ${Math.round(connectionAge/1000)}s)`);
                peersToCleanup.push(peerId);
            }
            // Clean up peers that have been in non-connected states for too long
            else if (connectionAge > STALE_THRESHOLD) {
                if (status === 'connecting' || status === 'channel-connecting' || 
                    status === 'failed' || status === 'closed') {
                    console.log(`Stale peer detected: ${peerId.substring(0, 8)}... (status: ${status}, age: ${Math.round(connectionAge/1000)}s)`);
                    peersToCleanup.push(peerId);
                }
            }
        });

        if (peersToCleanup.length > 0) {
            console.log(`Cleaning up ${peersToCleanup.length} stale peer(s)`);
            peersToCleanup.forEach(peerId => {
                this.cleanupFailedConnection(peerId);
            });
        }
    }

    /**
     * Force cleanup of peers that are not in connected state (for debugging)
     */
    forceCleanupInvalidPeers() {
        console.log('Force cleaning up peers not in connected state...');
        const peersToRemove = [];
        
        this.peers.forEach((peerConnection, peerId) => {
            const status = peerConnection.getStatus();
            if (status !== 'connected') {
                console.log(`Found peer ${peerId.substring(0, 8)}... in invalid state: ${status}`);
                peersToRemove.push(peerId);
            }
        });
        
        peersToRemove.forEach(peerId => {
            console.log(`Force removing peer ${peerId.substring(0, 8)}...`);
            this.cleanupFailedConnection(peerId);
        });
        
        if (peersToRemove.length > 0) {
            console.log(`Force cleaned up ${peersToRemove.length} invalid peers`);
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
            console.warn('Received invalid message from', fromPeerId?.substring(0, 8));
            return;
        }

        // Route based on message type
        switch (message.type) {
            case 'gossip':
                // Gossip protocol messages
                this.mesh.gossipManager.handleGossipMessage(message, fromPeerId);
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
                
            default:
                // Unknown message type - try gossip as fallback for backward compatibility
                console.warn(`Unknown message type '${message.type}' from ${fromPeerId?.substring(0, 8)}, trying gossip handler`);
                this.mesh.gossipManager.handleGossipMessage(message, fromPeerId);
                break;
        }
    }

    /**
     * Handle eviction messages
     */
    handleEvictionMessage(message, fromPeerId) {
        console.log(`Received eviction notice from ${fromPeerId?.substring(0, 8)}: ${message.reason}`);
        
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
}
