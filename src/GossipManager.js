import { EventEmitter } from './EventEmitter.js';
import { environmentDetector } from './EnvironmentDetector.js';
import DebugLogger from './DebugLogger.js';

/**
 * Manages gossip protocol for message propagation across the mesh network
 * Ensures all peers receive messages even if not directly connected
 */
export class GossipManager extends EventEmitter {
  constructor(mesh, connectionManager) {
    super();
    this.mesh = mesh;
    this.connectionManager = connectionManager;
    this.debug = DebugLogger.create('GossipManager');

    // Track message history to prevent infinite loops
    this.seenMessages = new Map(); // messageId -> { timestamp, ttl }
    this.messageHistory = new Map(); // messageId -> message content

    // Track key exchanges to prevent duplicates (separate from general message deduplication)
    this.processedKeyExchanges = new Map(); // "peerId:keyType" -> timestamp

    // Configuration
    // Increased TTL further to improve reliability across multi-hub partial meshes
    this.maxTTL = 40; // allow deeper multi-hop propagation before expiry
    this.messageExpiryTime = 5 * 60 * 1000; // 5 minutes
    this.cleanupInterval = 60 * 1000; // 1 minute
    this.cleanupTimer = null; // Track cleanup timer for proper cleanup

    // (Rollback) Remove adaptive resend structures - rely on pure gossip

    this.startCleanupTimer();
  }

  /**
     * Broadcast a message to all peers in the network using gossip protocol
     */
  async broadcastMessage(content, messageType = 'chat') {
    // Validate content
    if (content === undefined || content === null) {
      this.debug.error('Cannot broadcast message with undefined/null content');
      return null;
    }

    if (messageType === 'chat' && (typeof content !== 'string' || content.trim().length === 0)) {
      this.debug.error('Cannot broadcast empty chat message');
      return null;
    }

    if (messageType === 'encrypted' && (typeof content !== 'object' || !content.encrypted)) {
      this.debug.error('Cannot broadcast invalid encrypted message');
      return null;
    }

    const messageId = await this.generateMessageId();
    const message = {
      id: messageId,
      type: 'gossip',
      subtype: messageType,
      content,
      from: this.mesh.peerId,
      networkName: this.mesh.networkName, // Include network namespace
      timestamp: Date.now(),
      ttl: this.maxTTL,
      path: [this.mesh.peerId] // Track propagation path
    };

    this.debug.log(`Broadcasting ${messageType} message: ${messageId.substring(0, 8)}... content: "${content}"`);

    // Store our own message
    this.seenMessages.set(messageId, {
      timestamp: Date.now(),
      ttl: this.maxTTL
    });
    this.messageHistory.set(messageId, message);

    // (Rollback) No adaptive resend tracking

    // Send to all connected peers
    this.propagateMessage(message);

    // Emit locally if it's a chat or encrypted message
    if (messageType === 'chat' || messageType === 'encrypted') {
      this.emit('messageReceived', {
        from: this.mesh.peerId,
        content,
        timestamp: message.timestamp,
        messageId,
        encrypted: messageType === 'encrypted'
      });
    }

    return messageId;
  }

  /**
   * Attempt adaptive resend of recent broadcasts to peers that connected
   * after initial propagation window.
   */
  // (Rollback) attemptAdaptiveResends removed

  /**
     * Send a direct message to a specific peer using gossip routing (DM)
     * @param {string} targetPeerId - The destination peer's ID
     * @param {string|object} content - The message content
     * @param {string} subtype - Message subtype (default: 'dm')
     * @returns {string|null} The message ID if sent, or null on error
     */
  async sendDirectMessage(targetPeerId, content, subtype = 'dm') {
    if (!targetPeerId || typeof targetPeerId !== 'string') {
      this.debug.error('Invalid targetPeerId for direct message');
      return null;
    }

    // Validate peer ID format (40-character hex string)
    if (!/^[a-fA-F0-9]{40}$/.test(targetPeerId)) {
      this.debug.error('Invalid peer ID format for direct message:', targetPeerId);
      return null;
    }

    const messageId = await this.generateMessageId();
    const message = {
      id: messageId,
      type: 'gossip',
      subtype,
      content,
      from: this.mesh.peerId,
      to: targetPeerId,
      networkName: this.mesh.networkName, // Include network namespace
      timestamp: Date.now(),
      ttl: this.maxTTL,
      path: [this.mesh.peerId]
    };
    // Store our own message
    this.seenMessages.set(messageId, {
      timestamp: Date.now(),
      ttl: this.maxTTL
    });
    this.messageHistory.set(messageId, message);
    // Route to closest peer
    this.propagateMessage(message);
    return messageId;
  }

  /**
     * Handle incoming gossip message from a peer
     */
  async handleGossipMessage(message, fromPeerId) {
    this.debug.log(`🔥🔥🔥 GOSSIP MESSAGE RECEIVED! From: ${fromPeerId?.substring(0, 8)}...`);
    this.debug.log('🔥🔥🔥 Message:', message);

    const { id: messageId, ttl, from: originPeerId, subtype, content, timestamp, path, to, networkName } = message;

    // Validate message structure
    if (!messageId || !originPeerId || !subtype || content === undefined) {
      this.debug.error('Invalid gossip message structure:', message);
      return;
    }

    // Filter messages by network namespace
    const messageNetwork = networkName || 'global';
    const currentNetwork = this.mesh.networkName;
    
    if (messageNetwork !== currentNetwork) {
      this.debug.log(`Filtering gossip message from different network: ${messageNetwork} (current: ${currentNetwork})`);
      return;
    }

    // Check if we've already seen this message
    if (this.seenMessages.has(messageId)) {
      this.debug.log(`Ignoring duplicate message: ${messageId.substring(0, 8)}...`);
      return;
    }

    // Check TTL
    if (ttl <= 0) {
      this.debug.log(`Message expired: ${messageId.substring(0, 8)}...`);
      return;
    }

    // Check for loops (our peer ID in path)
    if (path && path.includes(this.mesh.peerId)) {
      this.debug.log(`Preventing message loop: ${messageId.substring(0, 8)}...`);
      return;
    }

    this.debug.log(`Received gossip message: ${messageId.substring(0, 8)}... from ${fromPeerId.substring(0, 8)}... (TTL: ${ttl}, content: "${content}")`);

    // Store message to prevent duplicates
    this.seenMessages.set(messageId, {
      timestamp: Date.now(),
      ttl
    });
    this.messageHistory.set(messageId, message);

    // Handle crypto-related messages first
    if (this.mesh.enableCrypto && this.mesh.cryptoManager) {
      const handled = await this._handleCryptoMessage(message, fromPeerId, originPeerId);
      if (handled) {
        return; // Don't propagate crypto messages further
      }
    }

    // Handle encrypted content decryption
    let processedContent = content;
    let isEncrypted = false;

    if (this.mesh.enableCrypto && this.mesh.cryptoManager &&
            content && typeof content === 'object' && content.encrypted) {
      try {
        processedContent = await this.mesh.decryptMessage(content);
        isEncrypted = true;
        this.debug.log(`🔐 Decrypted message from ${originPeerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error('Failed to decrypt message:', error);
        // Continue with original content
        processedContent = content;
      }
    }

    // Emit the message locally
    if (subtype === 'chat') {
      // Validate chat content (handle both encrypted objects and plain strings)
      if (isEncrypted || (typeof processedContent === 'string' && processedContent.trim().length > 0)) {
        this.emit('messageReceived', {
          from: originPeerId,
          content: processedContent,
          timestamp,
          messageId,
          hops: this.maxTTL - ttl,
          direct: false, // Flag to indicate this was a gossip message
          encrypted: isEncrypted
        });
      } else {
        this.debug.warn('Ignoring gossip chat message with invalid content:', processedContent);
        return;
      }
    } else if (subtype === 'encrypted') {
      // Handle encrypted broadcast messages
      this.emit('messageReceived', {
        from: originPeerId,
        content: processedContent,
        timestamp,
        messageId,
        hops: this.maxTTL - ttl,
        direct: false,
        encrypted: true
      });
    } else if (subtype === 'peer-announcement') {
      this.handlePeerAnnouncement(content, originPeerId);
    } else if (subtype === 'mediaEvent') {
      // Handle media streaming events
      this.handleMediaEvent(content, originPeerId);
    } else if (subtype === 'stream-chunk') {
      // Handle gossip stream chunks - pass directly to mesh
      this.emit('messageReceived', {
        from: originPeerId,
        message: {
          type: 'stream-chunk',
          ...content
        },
        timestamp,
        messageId
      });
    } else if (subtype === 'stream-control') {
      // Handle gossip stream control messages - pass directly to mesh
      this.emit('messageReceived', {
        from: originPeerId,
        message: {
          type: 'stream-control',
          ...content
        },
        timestamp,
        messageId
      });
    } else if (subtype === 'dm') {
      // Direct message logic
      if (typeof to === 'string' && typeof this.mesh.peerId === 'string' && to.trim().toLowerCase() === this.mesh.peerId.trim().toLowerCase()) {
        // This peer is the target - check if this message type should be filtered
        
        this.debug.log(`🔍 DM DEBUG: Received DM from ${originPeerId?.substring(0, 8)}, content type: ${typeof processedContent}`);
        if (typeof processedContent === 'object' && processedContent) {
          this.debug.log(`🔍 DM DEBUG: Content object has type: ${processedContent.type}`);
        }
        
        // Define message types that should be filtered from peer-readable messages
        // These messages are processed but not emitted as regular messages to UI/applications
        const filteredMessageTypes = new Set([
          'signaling-relay',
          'peer-announce-relay', 
          'bootstrap-keepalive'
        ]);

        // Parse the content to check message type
        let messageType = null;
        let shouldFilter = false;
        
        // Check if content is already an object with type property
        if (typeof processedContent === 'object' && processedContent && processedContent.type) {
          messageType = processedContent.type;
          shouldFilter = filteredMessageTypes.has(messageType);
        } else if (typeof processedContent === 'string') {
          // Try to parse as JSON if it's a string
          try {
            const parsedContent = JSON.parse(processedContent);
            messageType = parsedContent.type;
            shouldFilter = filteredMessageTypes.has(messageType);
          } catch (e) {
            // Not JSON or doesn't have type - treat as regular message
          }
        }

        this.debug.log(`🔍 DM DEBUG: messageType=${messageType}, shouldFilter=${shouldFilter}`);

        if (shouldFilter) {
          this.debug.log(`🔇 FILTER: Processing filtered DM type '${messageType}' from ${originPeerId?.substring(0, 8)} (not emitted to UI)`);
          
          // Process the filtered message internally but don't emit to UI
          if (messageType === 'signaling-relay' && typeof processedContent === 'object') {
            // Handle signaling relay
            if (processedContent.signalingMessage && this.mesh.signalingHandler) {
              this.mesh.signalingHandler.handleSignalingMessage({
                type: processedContent.signalingMessage.type,
                data: processedContent.signalingMessage.data,
                fromPeerId: processedContent.signalingMessage.fromPeerId || originPeerId,
                targetPeerId: processedContent.targetPeerId,
                timestamp: processedContent.timestamp
              });
            }
          } else if (messageType === 'peer-announce-relay' && typeof processedContent === 'object') {
            // Handle peer announce relay
            if (processedContent.data && this.mesh.signalingHandler) {
              this.mesh.signalingHandler.handlePeerAnnouncement(processedContent.data, originPeerId);
            }
          } else if (messageType === 'bootstrap-keepalive') {
            // Handle bootstrap keepalive - content can be object or string
            if (this.mesh.peerDiscovery) {
              // For bootstrap keepalive from a specific source, use the 'from' field as the peer ID
              const keepalivePeerId = (typeof processedContent === 'object' && processedContent.from)
                ? processedContent.from
                : originPeerId;
              this.mesh.peerDiscovery.updateDiscoveryTimestamp(keepalivePeerId);
            }
          }
          
          // Do NOT emit to UI and do NOT relay further
          return;
        }

        // This is a regular (non-filtered) direct message - emit to UI
        this.emit('messageReceived', {
          from: originPeerId,
          content: processedContent,
          timestamp,
          messageId,
          hops: this.maxTTL - ttl,
          direct: true, // Flag to indicate this was a direct message
          encrypted: isEncrypted
        });
        // Do NOT relay further if we are the recipient
        return;
      } else {
        // Not the target, relay silently (do not emit)
      }
    } else if (subtype === 'dht-routing') {
      // DHT routing message - check if we're the target
      if (typeof to === 'string' && typeof this.mesh.peerId === 'string' && to.trim().toLowerCase() === this.mesh.peerId.trim().toLowerCase()) {
        this.debug.log(`DHT: Received routed message for us from ${originPeerId.substring(0, 8)}`);
        // We are the target, deliver the DHT message locally
        if (this.mesh.webDHT && content) {
          // Simulate receiving the message from the original sender
          this.mesh.webDHT.handleMessage(content, originPeerId);
        }
        // Do NOT relay further since we are the recipient
        return;
      } else {
        this.debug.log(`DHT: Routing message for ${to?.substring(0, 8)} (not us)`);
        // Not the target, continue routing
      }
    }
    // Propagate to other peers with decremented TTL
    const updatedMessage = {
      ...message,
      ttl: ttl - 1,
      path: [...(path || []), this.mesh.peerId]
    };

    this.propagateMessage(updatedMessage, fromPeerId);
  }

  /**
     * Handle peer announcements received via gossip
     */
  handlePeerAnnouncement(announcementData, originPeerId) {
    const { peerId: announcedPeerId } = announcementData;

    this.debug.log(`Gossip peer announcement: ${announcedPeerId.substring(0, 8)}... via ${originPeerId.substring(0, 8)}...`);

    // Add to discovered peers if we don't know about them
    if (!this.mesh.peerDiscovery.hasPeer(announcedPeerId) &&
            announcedPeerId !== this.mesh.peerId) {
      this.mesh.emit('statusChanged', {
        type: 'info',
        message: `Discovered peer ${announcedPeerId.substring(0, 8)}... via gossip`
      });

      this.mesh.peerDiscovery.addDiscoveredPeer(announcedPeerId);
    }
  }

  /**
   * Handle media streaming events received via gossip
   */
  handleMediaEvent(eventData, originPeerId) {
    const { event, peerId, hasVideo, hasAudio, timestamp } = eventData;

    this.debug.log(`Media event gossip: ${event} from ${peerId.substring(0, 8)}... via ${originPeerId.substring(0, 8)}...`);

    // Don't process our own events
    if (peerId === this.mesh.peerId) {
      return;
    }

    // Emit the media event for the UI to handle
    if (event === 'streamStarted') {
      this.mesh.emit('remoteStreamAnnouncement', {
        peerId,
        hasVideo,
        hasAudio,
        timestamp,
        event: 'started'
      });
    } else if (event === 'streamStopped') {
      this.mesh.emit('remoteStreamAnnouncement', {
        peerId,
        timestamp,
        event: 'stopped'
      });
    }
  }

  /**
     * Broadcast peer announcement via gossip when we connect
     */
  async announcePeer(peerId = this.mesh.peerId) {
    const announcementData = {
      peerId,
      timestamp: Date.now()
    };

    this.debug.log(`Gossiping peer announcement for: ${peerId.substring(0, 8)}...`);
    await this.broadcastMessage(announcementData, 'peer-announcement');
  }

  /**
     * Propagate message to ALL peers that can receive messages - ignore connection states!
     */
  propagateMessage(message, excludePeerId = null) {
    // DM and DHT routing: route to closest peer(s) for messages with specific targets
    if ((message.subtype === 'dm' || message.subtype === 'dht-routing') && message.to) {
      const targetId = message.to;
      const allPeers = Array.from(this.connectionManager.peers.values());
      const capablePeers = allPeers.filter(peerConnection => {
        return peerConnection.dataChannel && peerConnection.dataChannel.readyState === 'open';
      });
      // Improved XOR distance for 40-char hex peer IDs
      function xorDistance(a, b) {
        if (!a || !b) return Number.MAX_SAFE_INTEGER;
        let dist = 0n;
        for (let i = 0; i < 40; i += 8) {
          const aChunk = a.substring(i, i + 8);
          const bChunk = b.substring(i, i + 8);
          dist = (dist << 32n) + (BigInt('0x' + aChunk) ^ BigInt('0x' + bChunk));
        }
        return dist;
      }
      let minDist = null;
      let closestPeers = [];
      capablePeers.forEach(peerConnection => {
        if (peerConnection.peerId === excludePeerId || message.ttl <= 0) return;
        const dist = xorDistance(peerConnection.peerId, targetId);
        if (minDist === null || dist < minDist) {
          minDist = dist;
          closestPeers = [peerConnection];
        } else if (dist === minDist) {
          closestPeers.push(peerConnection);
        }
      });
      if (closestPeers.length > 0) {
        closestPeers.forEach(peer => {
          try {
            peer.sendMessage(message);
            const routingType = message.subtype === 'dht-routing' ? 'DHT' : 'DM';
            this.debug.log(`${routingType} routed to closest peer: ${peer.peerId.substring(0, 8)}...`);
          } catch (error) {
            this.debug.error(`${message.subtype} routing failed:`, error);
          }
        });
      } else {
        // Fallback: relay to all capable peers except sender
        capablePeers.forEach(peerConnection => {
          if (peerConnection.peerId === excludePeerId || message.ttl <= 0) return;
          try {
            peerConnection.sendMessage(message);
            const routingType = message.subtype === 'dht-routing' ? 'DHT' : 'DM';
            this.debug.log(`${routingType} fallback relay to: ${peerConnection.peerId.substring(0, 8)}...`);
          } catch (error) {
            this.debug.error(`${message.subtype} fallback relay failed:`, error);
          }
        });
      }
      return;
    }
    // AGGRESSIVE: Get ALL peers regardless of status - we only care if we can send a message
    const allPeers = Array.from(this.connectionManager.peers.values());
    const capablePeers = allPeers.filter(peerConnection => {
      // ONLY requirement: does the peer have an open data channel?
      return peerConnection.dataChannel &&
                   peerConnection.dataChannel.readyState === 'open';
    });

    let propagatedTo = 0;

    this.debug.log(`🚀 AGGRESSIVE GOSSIP: Found ${capablePeers.length}/${allPeers.length} peers with open data channels`);
    this.debug.log(`Message: ${message.id.substring(0, 8)}..., TTL: ${message.ttl}, Exclude: ${excludePeerId?.substring(0, 8) || 'none'}`);

    // Debug: show state of ALL peers
    allPeers.forEach(peerConnection => {
      const status = peerConnection.getStatus();
      const dataChannelState = peerConnection.dataChannel?.readyState || 'none';
      const canSend = peerConnection.dataChannel && peerConnection.dataChannel.readyState === 'open';
      const isExcluded = peerConnection.peerId === excludePeerId;
      this.debug.log(`  ${peerConnection.peerId.substring(0, 8)}... - Status: ${status}, DataChannel: ${dataChannelState}, CanSend: ${canSend}, Excluded: ${isExcluded}`);
    });

    capablePeers.forEach(peerConnection => {
      const peerId = peerConnection.peerId;

      // Don't send back to sender or if TTL expired
      if (peerId === excludePeerId || message.ttl <= 0) {
        return;
      }

      try {
        peerConnection.sendMessage(message);
        propagatedTo++;
        this.debug.log(`✅ GOSSIP SUCCESS: Sent to ${peerId.substring(0, 8)}...`);
      } catch (error) {
        this.debug.error(`❌ GOSSIP FAILED: Could not send to ${peerId.substring(0, 8)}...`, error);
      }
    });

    this.debug.log(`🎯 GOSSIP RESULT: Propagated to ${propagatedTo}/${capablePeers.length} capable peers`);

    if (propagatedTo === 0 && allPeers.length > 0) {
      this.debug.error(`🚨 GOSSIP FAILURE: NO PROPAGATION! ${allPeers.length} total peers, ${capablePeers.length} with data channels`);
    }
  }

  /**
     * Get message statistics
     */
  getStats() {
    return {
      seenMessages: this.seenMessages.size,
      storedMessages: this.messageHistory.size,
      maxTTL: this.maxTTL,
      messageExpiryTime: this.messageExpiryTime
    };
  }

  /**
     * Generate unique message ID
     */
  async generateMessageId() {
    const array = new Uint8Array(16);
    
    // Environment-aware random value generation
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      // Browser environment
      crypto.getRandomValues(array);
    } else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      // Node.js environment
      try {
        const crypto = await import('crypto');
        const randomBytes = crypto.randomBytes(16);
        array.set(randomBytes);
      } catch (e) {
        console.warn('Could not use Node.js crypto, falling back to Math.random');
        // Fallback to Math.random
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
      }
    } else {
      // Fallback to Math.random for other environments
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
    
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
     * Clean up expired messages
     */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    if (environmentDetector.isBrowser) {
      this.cleanupTimer = window.setInterval(() => {
        this.cleanupExpiredMessages();
      }, this.cleanupInterval);
    } else {
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpiredMessages();
      }, this.cleanupInterval);
    }
  }

  /**
     * Stop cleanup timer
     */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  cleanupExpiredMessages() {
    const now = Date.now();
    let cleaned = 0;
    let keyExchangesCleaned = 0;

    // Clean up seen messages
    this.seenMessages.forEach((data, messageId) => {
      if (now - data.timestamp > this.messageExpiryTime) {
        this.seenMessages.delete(messageId);
        this.messageHistory.delete(messageId);
        cleaned++;
      }
    });

    // Clean up old key exchange tracking (keep for shorter time - 1 minute)
    this.processedKeyExchanges.forEach((timestamp, keyExchangeId) => {
      if (now - timestamp > 60000) { // 1 minute
        this.processedKeyExchanges.delete(keyExchangeId);
        keyExchangesCleaned++;
      }
    });

    if (cleaned > 0) {
      this.debug.log(`Cleaned up ${cleaned} expired gossip messages`);
    }
    if (keyExchangesCleaned > 0) {
      this.debug.log(`Cleaned up ${keyExchangesCleaned} old key exchange tracking entries`);
    }
  }

  /**
     * Cleanup method
     */
  cleanup() {
    this.stopCleanupTimer();
    this.seenMessages.clear();
    this.messageHistory.clear();
    this.processedKeyExchanges.clear();
  }

  /**
     * Handle crypto-related messages (key exchange, etc.)
     * @private
     */
  async _handleCryptoMessage(message, fromPeerId, originPeerId) {
    const { subtype, content } = message;

    // Handle key exchange messages
    if (subtype === 'key_exchange' || subtype === 'key_exchange_response') {
      if (content && (content.type === 'key_exchange' || content.type === 'key_exchange_response') && content.publicKey) {
        
        // Create a unique identifier for this key exchange to prevent duplicates
        const keyExchangeId = `${originPeerId}:${content.type}:${content.timestamp || Date.now()}`;
        
        // Check if we've already processed this key exchange
        if (this.processedKeyExchanges.has(keyExchangeId)) {
          this.debug.log(`🔐 Ignoring duplicate ${content.type} from peer ${originPeerId.substring(0, 8)}... (already processed)`);
          return true; // Mark as handled to prevent further propagation
        }
        
        // Also check for recent key exchanges from the same peer (within last 5 seconds)
        const recentKeyExchangePattern = `${originPeerId}:${content.type}:`;
        const now = Date.now();
        let foundRecent = false;
        
        for (const [existingId, timestamp] of this.processedKeyExchanges.entries()) {
          if (existingId.startsWith(recentKeyExchangePattern) && (now - timestamp) < 5000) {
            foundRecent = true;
            break;
          }
        }
        
        if (foundRecent) {
          this.debug.log(`🔐 Ignoring recent duplicate ${content.type} from peer ${originPeerId.substring(0, 8)}... (processed recently)`);
          return true;
        }

        this.debug.log(`🔐 Processing ${content.type} from peer ${originPeerId.substring(0, 8)}...`);
        
        // Mark this key exchange as processed
        this.processedKeyExchanges.set(keyExchangeId, now);

        // Use the mesh's key exchange handler which properly handles both pub and epub keys
        this.mesh._handleKeyExchange(content, originPeerId);

        // Don't propagate key exchange messages further
        return true; // Indicates message was handled and should not be processed further
      }
    }

    return false; // Message was not handled by crypto processing
  }
}
