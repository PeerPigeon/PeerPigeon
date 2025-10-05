import { EventEmitter } from './EventEmitter.js';
import DebugLogger from './DebugLogger.js';

/**
 * SimpleWebDHT - Efficient Distributed Hash Table for millions of WebR    const targetPeers = this.findClosestPeers(keyHash, replicationFactor);
    
    const spaceInfo = options.space ? ` (${options.space} space, RF=${replicationFactor})` : '';
    this.debug.log(`GET: Querying ${targetPeers.length} peers for ${key} in network ${this.mesh.networkName}${spaceInfo}`);

    // Query peers in parallelers
 * 
 * Design principles:
 * 1. SIMPLE: Minimal complexity, maximum reliability
 * 2. EFFICIENT: Optimized for millions of peers with O(log N) operations
 * 3. SCALABLE: Consistent hashing with automatic load balancing
 * 4. RELIABLE: Gossip-based replication with eventual consistency
 * 
 * Key features:
 * - Consistent hashing for efficient key distribution
 * - Minimal routing table (only closest peers)
 * - Gossip-based replication (fire-and-forget)
 * - Automatic peer discovery and failure handling
 * - No complex Kademlia routing - just simple consistent hashing
 */
export class WebDHT extends EventEmitter {
  constructor(mesh) {
    super();
    this.debug = DebugLogger.create('SimpleWebDHT');
    this.mesh = mesh;
    this.peerId = mesh.peerId;

    // Simple local storage
    this.storage = new Map();
    
    // Minimal routing: just track closest peers for efficient forwarding
    this.closestPeers = new Set();
    
    // Simple replication factor
    this.replicationFactor = 3;
    
    // Hash ring position for this peer
    this.hashPosition = this.hashPeerId(this.peerId);
    
    this.debug.log(`SimpleWebDHT initialized for peer ${this.peerId.substring(0, 8)} at position ${this.hashPosition.toString(16).substring(0, 8)}`);
    
    this.setupMessageHandling();
    this.startMaintenance();
  }

  /**
   * Calculate replication factor based on storage space and network size
   * @param {string} space - Storage space type (private, public, frozen)
   * @param {number} totalPeers - Total number of connected peers
   * @returns {number} Appropriate replication factor
   */
  getReplicationFactor(space, totalPeers = null) {
    const peerCount = totalPeers || Array.from(this.mesh.connectionManager.peers.keys())
      .filter(peerId => this.mesh.connectionManager.peers.get(peerId).getStatus() === 'connected').length;
    
    if (peerCount === 0) return 0;
    
    switch(space) {
      case 'private':
        // Private data: minimal replication (only owner can decrypt)
        return Math.min(3, peerCount);
      
      case 'public':
        // Public data: moderate replication for good availability
        // 30% of peers, minimum 3, maximum 7
        return Math.max(3, Math.min(Math.ceil(peerCount * 0.3), 7));
      
      case 'frozen':
        // Frozen data: high replication for immutability and permanence
        // 50% of peers, minimum 5, maximum 10
        return Math.max(5, Math.min(Math.ceil(peerCount * 0.5), 10));
      
      default:
        // Default: use base replication factor
        return Math.min(this.replicationFactor, peerCount);
    }
  }

  /**
   * Simple hash function for consistent hashing
   */
  async hash(data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(typeof data === 'string' ? data : JSON.stringify(data));
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    
    // Convert to number for position on hash ring
    let hash = 0;
    for (let i = 0; i < 4; i++) {
      hash = (hash * 256 + hashArray[i]) >>> 0;
    }
    return hash;
  }

  /**
   * Hash peer ID to position on ring
   */
  hashPeerId(peerId) {
    // Simple deterministic hash of peer ID
    let hash = 0;
    for (let i = 0; i < peerId.length; i++) {
      hash = ((hash << 5) - hash + peerId.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  /**
   * Calculate distance between two positions on hash ring
   */
  ringDistance(pos1, pos2) {
    const diff = Math.abs(pos1 - pos2);
    const maxUint32 = 0xFFFFFFFF;
    return Math.min(diff, maxUint32 - diff);
  }

  /**
   * Find closest peers to a hash position
   */
  findClosestPeers(targetHash, count = this.replicationFactor) {
    const connectedPeers = Array.from(this.mesh.connectionManager.peers.keys())
      .filter(peerId => this.mesh.connectionManager.peers.get(peerId).getStatus() === 'connected');
    
    if (connectedPeers.length === 0) {
      return [];
    }

    // Calculate distances and sort
    const peersWithDistance = connectedPeers.map(peerId => ({
      peerId,
      distance: this.ringDistance(targetHash, this.hashPeerId(peerId))
    }));

    peersWithDistance.sort((a, b) => a.distance - b.distance);
    
    return peersWithDistance.slice(0, count).map(p => p.peerId);
  }

  /**
   * Store key-value pair with network namespace support
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   * @param {Object} options - Storage options
   * @param {string} options.space - Storage space (private, public, frozen) for replication strategy
   */
  async put(key, value, options = {}) {
    // Add network namespace to the key to ensure network isolation
    const namespacedKey = `${this.mesh.networkName}:${key}`;
    const keyHash = await this.hash(namespacedKey);
    
    const storeData = {
      key: namespacedKey,
      originalKey: key, // Store original key for retrieval
      value,
      networkName: this.mesh.networkName,
      timestamp: Date.now(),
      publisher: this.peerId,
      space: options.space // Track space for replication info
    };

    // Always store locally first
    this.storage.set(namespacedKey, storeData);
    this.debug.log(`PUT: Stored ${key} locally in network ${this.mesh.networkName}`);

    // Determine replication factor based on storage space
    const replicationFactor = options.space 
      ? this.getReplicationFactor(options.space)
      : this.replicationFactor;
    
    // Find closest peers for replication
    const targetPeers = this.findClosestPeers(keyHash, replicationFactor);
    
    this.debug.log(`PUT: Replicating ${key} to ${targetPeers.length} peers`);
    
    // Simple fire-and-forget replication
    const replicationPromises = targetPeers.map(async (peerId) => {
      if (peerId !== this.peerId) {
        try {
          this.sendMessage(peerId, 'dht_store', storeData);
          // Add small delay to ensure message is sent
          await new Promise(resolve => setTimeout(resolve, 50));
          return { peerId, success: true };
        } catch (error) {
          this.debug.warn(`Replication to ${peerId.substring(0, 8)} failed:`, error.message);
          return { peerId, success: false, error: error.message };
        }
      }
      return { peerId, success: true };
    });

    // Wait for all sends to complete
    await Promise.allSettled(replicationPromises);
    
    const spaceInfo = options.space ? ` (${options.space} space, RF=${replicationFactor})` : '';
    this.debug.log(`PUT: ${key} replicated to ${targetPeers.length} peers in network ${this.mesh.networkName}${spaceInfo}`);
    
    return true;
  }

  /**
   * Retrieve value by key with network namespace support
   * @param {string} key - Storage key
   * @param {Object} options - Retrieval options
   * @param {boolean} options.forceRefresh - Force refresh from network
   * @param {string} options.space - Storage space for space-aware replication
   */
  async get(key, options = {}) {
    const forceRefresh = options.forceRefresh || false;
    const namespacedKey = `${this.mesh.networkName}:${key}`;
    
    // Check local storage first (unless force refresh)
    if (!forceRefresh && this.storage.has(namespacedKey)) {
      const data = this.storage.get(namespacedKey);
      this.debug.log(`GET: Found ${key} locally in network ${this.mesh.networkName}`);
      return data.value;
    }

    // If not found locally or force refresh, query the network
    const keyHash = await this.hash(namespacedKey);
    
    // Use space-aware replication factor for querying
    const replicationFactor = options.space 
      ? this.getReplicationFactor(options.space)
      : this.replicationFactor;
    
    const targetPeers = this.findClosestPeers(keyHash, replicationFactor);
    
    this.debug.log(`GET: Querying ${targetPeers.length} peers for ${key} in network ${this.mesh.networkName}`);

    // Query peers in parallel
    const queryPromises = targetPeers.map(async (peerId) => {
      if (peerId === this.peerId) return null;
      
      try {
        this.debug.log(`GET: Querying peer ${peerId.substring(0, 8)} for ${key}`);
        const result = await this.queryPeer(peerId, namespacedKey);
        this.debug.log(`GET: Peer ${peerId.substring(0, 8)} response for ${key}:`, result ? 'found' : 'not found');
        return result;
      } catch (error) {
        this.debug.warn(`Query to ${peerId.substring(0, 8)} failed:`, error.message);
        return null;
      }
    });

    const results = await Promise.allSettled(queryPromises);
    
    // Find the first successful result
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const data = result.value;
        
        // Cache locally for future use
        this.storage.set(namespacedKey, data);
        
        this.debug.log(`GET: Found ${key} from network ${this.mesh.networkName}`);
        return data.value;
      }
    }

    this.debug.log(`GET: ${key} not found after querying ${targetPeers.length} peers`);
    return null;
  }

  /**
   * Query a specific peer for a key
   */
  async queryPeer(peerId, key) {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(7);
      
      // Set timeout for query
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(requestId);
        reject(new Error('Query timeout'));
      }, 5000);

      // Store response handler
      this.responseHandlers.set(requestId, (response) => {
        clearTimeout(timeout);
        this.responseHandlers.delete(requestId);
        
        if (response.found) {
          resolve(response.data);
        } else {
          resolve(null);
        }
      });

      // Send query
      this.sendMessage(peerId, 'dht_query', { key, requestId });
    });
  }

  /**
   * Send message to peer through connection manager
   */
  sendMessage(peerId, type, data) {
    const message = {
      type: 'dht',
      messageType: type,
      data,
      from: this.peerId,
      timestamp: Date.now()
    };

    const peer = this.mesh.connectionManager.peers.get(peerId);
    if (peer && peer.getStatus() === 'connected') {
      peer.sendMessage(message);
    } else {
      throw new Error(`Peer ${peerId} not connected`);
    }
  }

  /**
   * Setup message handling
   */
  setupMessageHandling() {
    this.responseHandlers = new Map();
  }

  /**
   * Handle incoming DHT message
   */
  async handleMessage(message, fromPeerId) {
    const { messageType, data } = message;

    switch (messageType) {
      case 'dht_store':
        this.handleStore(data, fromPeerId);
        break;
        
      case 'dht_query':
        await this.handleQuery(data, fromPeerId);
        break;
        
      case 'dht_query_response':
        this.handleQueryResponse(data);
        break;
        
      default:
        this.debug.warn(`Unknown DHT message type: ${messageType}`);
    }
  }

  /**
   * Handle store request from peer with network filtering
   */
  handleStore(data, fromPeerId) {
    const { key, value, timestamp, publisher, networkName, space } = data;
    
    // Filter by network namespace
    const messageNetwork = networkName || 'global';
    if (messageNetwork !== this.mesh.networkName) {
      this.debug.log(`Filtering DHT store from different network: ${messageNetwork} (current: ${this.mesh.networkName})`);
      return;
    }
    
    try {
      // Simple conflict resolution: latest timestamp wins
      if (this.storage.has(key)) {
        const existing = this.storage.get(key);
        if (existing.timestamp >= timestamp) {
          return; // Ignore older data
        }
      }

      // Store the complete data with all fields including space
      this.storage.set(key, { key, value, timestamp, publisher, space, networkName });
      this.debug.log(`STORE: Received ${key} from ${fromPeerId.substring(0, 8)}`);
    } catch (error) {
      this.debug.warn(`Store failed for ${key}:`, error.message);
    }
  }

  /**
   * Handle query request from peer
   */
  async handleQuery(data, fromPeerId) {
    const { key, requestId } = data;
    
    const response = {
      requestId,
      found: false,
      data: null
    };

    if (this.storage.has(key)) {
      response.found = true;
      response.data = this.storage.get(key);
    }

    // Send response
    this.sendMessage(fromPeerId, 'dht_query_response', response);
  }

  /**
   * Handle query response
   */
  handleQueryResponse(data) {
    const { requestId } = data;
    const handler = this.responseHandlers.get(requestId);
    
    if (handler) {
      handler(data);
    }
  }

  /**
   * Update closest peers for efficient routing
   */
  updateClosestPeers() {
    const connectedPeers = Array.from(this.mesh.connectionManager.peers.keys())
      .filter(peerId => this.mesh.connectionManager.peers.get(peerId).getStatus() === 'connected');

    // Keep track of closest peers for efficient routing
    const peersWithDistance = connectedPeers.map(peerId => ({
      peerId,
      distance: this.ringDistance(this.hashPosition, this.hashPeerId(peerId))
    }));

    peersWithDistance.sort((a, b) => a.distance - b.distance);
    
    // Keep top 10 closest peers for efficient routing
    this.closestPeers = new Set(
      peersWithDistance.slice(0, 10).map(p => p.peerId)
    );
  }

  /**
   * Periodic maintenance
   */
  startMaintenance() {
    // Update routing table every 30 seconds
    setInterval(() => {
      this.updateClosestPeers();
    }, 30000);

    // Clean up old data every 5 minutes
    setInterval(() => {
      this.cleanupOldData();
    }, 300000);
  }

  /**
   * Clean up old data (optional TTL support)
   */
  cleanupOldData() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [key, data] of this.storage) {
      if (now - data.timestamp > maxAge) {
        this.storage.delete(key);
        this.debug.log(`Cleaned up old data: ${key}`);
      }
    }
  }

  /**
   * Get DHT statistics
   */
  getStats() {
    return {
      localKeys: this.storage.size,
      connectedPeers: this.mesh.connectionManager.getConnectedPeerCount(),
      closestPeers: this.closestPeers.size,
      hashPosition: this.hashPosition.toString(16).substring(0, 8)
    };
  }
}
