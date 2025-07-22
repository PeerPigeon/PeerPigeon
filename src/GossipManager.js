import { EventEmitter } from './EventEmitter.js';
import { environmentDetector } from './EnvironmentDetector.js';

/**
 * Manages gossip protocol for message propagation across the mesh network
 * Ensures all peers receive messages even if not directly connected
 */
export class GossipManager extends EventEmitter {
  constructor(mesh, connectionManager) {
    super();
    this.mesh = mesh;
    this.connectionManager = connectionManager;

    // Track message history to prevent infinite loops
    this.seenMessages = new Map(); // messageId -> { timestamp, ttl }
    this.messageHistory = new Map(); // messageId -> message content

    // Configuration
    this.maxTTL = 10; // Maximum hops before message expires
    this.messageExpiryTime = 5 * 60 * 1000; // 5 minutes
    this.cleanupInterval = 60 * 1000; // 1 minute
    this.cleanupTimer = null; // Track cleanup timer for proper cleanup

    this.startCleanupTimer();
  }

  /**
     * Broadcast a message to all peers in the network using gossip protocol
     */
  broadcastMessage(content, messageType = 'chat') {
    // Validate content
    if (content === undefined || content === null) {
      console.error('Cannot broadcast message with undefined/null content');
      return null;
    }

    if (messageType === 'chat' && (typeof content !== 'string' || content.trim().length === 0)) {
      console.error('Cannot broadcast empty chat message');
      return null;
    }

    if (messageType === 'encrypted' && (typeof content !== 'object' || !content.encrypted)) {
      console.error('Cannot broadcast invalid encrypted message');
      return null;
    }

    const messageId = this.generateMessageId();
    const message = {
      id: messageId,
      type: 'gossip',
      subtype: messageType,
      content,
      from: this.mesh.peerId,
      timestamp: Date.now(),
      ttl: this.maxTTL,
      path: [this.mesh.peerId] // Track propagation path
    };

    console.log(`Broadcasting ${messageType} message: ${messageId.substring(0, 8)}... content: "${content}"`);

    // Store our own message
    this.seenMessages.set(messageId, {
      timestamp: Date.now(),
      ttl: this.maxTTL
    });
    this.messageHistory.set(messageId, message);

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
     * Send a direct message to a specific peer using gossip routing (DM)
     * @param {string} targetPeerId - The destination peer's ID
     * @param {string|object} content - The message content
     * @param {string} subtype - Message subtype (default: 'dm')
     * @returns {string|null} The message ID if sent, or null on error
     */
  sendDirectMessage(targetPeerId, content, subtype = 'dm') {
    if (!targetPeerId || typeof targetPeerId !== 'string') {
      console.error('Invalid targetPeerId for direct message');
      return null;
    }

    // Validate peer ID format (40-character hex string)
    if (!/^[a-fA-F0-9]{40}$/.test(targetPeerId)) {
      console.error('Invalid peer ID format for direct message:', targetPeerId);
      return null;
    }

    const messageId = this.generateMessageId();
    const message = {
      id: messageId,
      type: 'gossip',
      subtype,
      content,
      from: this.mesh.peerId,
      to: targetPeerId,
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
    console.log(`🔥🔥🔥 GOSSIP MESSAGE RECEIVED! From: ${fromPeerId?.substring(0, 8)}...`);
    console.log('🔥🔥🔥 Message:', message);

    const { id: messageId, ttl, from: originPeerId, subtype, content, timestamp, path, to } = message;

    // Validate message structure
    if (!messageId || !originPeerId || !subtype || content === undefined) {
      console.error('Invalid gossip message structure:', message);
      return;
    }

    // Check if we've already seen this message
    if (this.seenMessages.has(messageId)) {
      console.log(`Ignoring duplicate message: ${messageId.substring(0, 8)}...`);
      return;
    }

    // Check TTL
    if (ttl <= 0) {
      console.log(`Message expired: ${messageId.substring(0, 8)}...`);
      return;
    }

    // Check for loops (our peer ID in path)
    if (path && path.includes(this.mesh.peerId)) {
      console.log(`Preventing message loop: ${messageId.substring(0, 8)}...`);
      return;
    }

    console.log(`Received gossip message: ${messageId.substring(0, 8)}... from ${fromPeerId.substring(0, 8)}... (TTL: ${ttl}, content: "${content}")`);

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
        console.log(`🔐 Decrypted message from ${originPeerId.substring(0, 8)}...`);
      } catch (error) {
        console.error('Failed to decrypt message:', error);
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
        console.warn('Ignoring gossip chat message with invalid content:', processedContent);
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
    } else if (subtype === 'dm') {
      // Direct message logic
      if (typeof to === 'string' && typeof this.mesh.peerId === 'string' && to.trim().toLowerCase() === this.mesh.peerId.trim().toLowerCase()) {
        // This peer is the target, emit to UI
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
        console.log(`DHT: Received routed message for us from ${originPeerId.substring(0, 8)}`);
        // We are the target, deliver the DHT message locally
        if (this.mesh.webDHT && content) {
          // Simulate receiving the message from the original sender
          this.mesh.webDHT.handleMessage(content, originPeerId);
        }
        // Do NOT relay further since we are the recipient
        return;
      } else {
        console.log(`DHT: Routing message for ${to?.substring(0, 8)} (not us)`);
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

    console.log(`Gossip peer announcement: ${announcedPeerId.substring(0, 8)}... via ${originPeerId.substring(0, 8)}...`);

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
     * Broadcast peer announcement via gossip when we connect
     */
  announcePeer(peerId = this.mesh.peerId) {
    const announcementData = {
      peerId,
      timestamp: Date.now()
    };

    console.log(`Gossiping peer announcement for: ${peerId.substring(0, 8)}...`);
    this.broadcastMessage(announcementData, 'peer-announcement');
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
            console.log(`${routingType} routed to closest peer: ${peer.peerId.substring(0, 8)}...`);
          } catch (error) {
            console.error(`${message.subtype} routing failed:`, error);
          }
        });
      } else {
        // Fallback: relay to all capable peers except sender
        capablePeers.forEach(peerConnection => {
          if (peerConnection.peerId === excludePeerId || message.ttl <= 0) return;
          try {
            peerConnection.sendMessage(message);
            const routingType = message.subtype === 'dht-routing' ? 'DHT' : 'DM';
            console.log(`${routingType} fallback relay to: ${peerConnection.peerId.substring(0, 8)}...`);
          } catch (error) {
            console.error(`${message.subtype} fallback relay failed:`, error);
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

    console.log(`🚀 AGGRESSIVE GOSSIP: Found ${capablePeers.length}/${allPeers.length} peers with open data channels`);
    console.log(`Message: ${message.id.substring(0, 8)}..., TTL: ${message.ttl}, Exclude: ${excludePeerId?.substring(0, 8) || 'none'}`);

    // Debug: show state of ALL peers
    allPeers.forEach(peerConnection => {
      const status = peerConnection.getStatus();
      const dataChannelState = peerConnection.dataChannel?.readyState || 'none';
      const canSend = peerConnection.dataChannel && peerConnection.dataChannel.readyState === 'open';
      const isExcluded = peerConnection.peerId === excludePeerId;
      console.log(`  ${peerConnection.peerId.substring(0, 8)}... - Status: ${status}, DataChannel: ${dataChannelState}, CanSend: ${canSend}, Excluded: ${isExcluded}`);
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
        console.log(`✅ GOSSIP SUCCESS: Sent to ${peerId.substring(0, 8)}...`);
      } catch (error) {
        console.error(`❌ GOSSIP FAILED: Could not send to ${peerId.substring(0, 8)}...`, error);
      }
    });

    console.log(`🎯 GOSSIP RESULT: Propagated to ${propagatedTo}/${capablePeers.length} capable peers`);

    if (propagatedTo === 0 && allPeers.length > 0) {
      console.error(`🚨 GOSSIP FAILURE: NO PROPAGATION! ${allPeers.length} total peers, ${capablePeers.length} with data channels`);
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
  generateMessageId() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
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

    // Clean up seen messages
    this.seenMessages.forEach((data, messageId) => {
      if (now - data.timestamp > this.messageExpiryTime) {
        this.seenMessages.delete(messageId);
        this.messageHistory.delete(messageId);
        cleaned++;
      }
    });

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired gossip messages`);
    }
  }

  /**
     * Cleanup method
     */
  cleanup() {
    this.stopCleanupTimer();
    this.seenMessages.clear();
    this.messageHistory.clear();
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
        console.log(`🔐 Received ${content.type} from peer ${originPeerId.substring(0, 8)}...`);

        // Use the mesh's key exchange handler which properly handles both pub and epub keys
        this.mesh._handleKeyExchange(content, originPeerId);

        // Don't propagate key exchange messages further
        return true; // Indicates message was handled and should not be processed further
      }
    }

    return false; // Message was not handled by crypto processing
  }
}
