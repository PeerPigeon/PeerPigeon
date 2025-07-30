import { EventEmitter } from './EventEmitter.js';
import { environmentDetector } from './EnvironmentDetector.js';
import DebugLogger from './DebugLogger.js';

export class PeerDiscovery extends EventEmitter {
  constructor(peerId, options = {}) {
    super();
    this.debug = DebugLogger.create('PeerDiscovery');
    this.peerId = peerId;
    this.discoveredPeers = new Map();
    this.connectionAttempts = new Map();
    this.cleanupInterval = null;
    this.autoDiscovery = options.autoDiscovery ?? true;
    this.evictionStrategy = options.evictionStrategy ?? true;
    this.xorRouting = options.xorRouting ?? true;
    this.minPeers = options.minPeers ?? 0;
    this.maxPeers = options.maxPeers ?? 10;
  }

  start() {
    this.startCleanupInterval();
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.discoveredPeers.clear();
    this.connectionAttempts.clear();
  }

  addDiscoveredPeer(peerId) {
    // Skip if we already know about this peer (prevent duplicate processing)
    if (this.discoveredPeers.has(peerId)) {
      // Update timestamp but don't emit events or trigger connections
      this.discoveredPeers.set(peerId, Date.now());
      return;
    }

    this.discoveredPeers.set(peerId, Date.now());
    this.emit('peerDiscovered', { peerId });

    this.debug.log(`Discovered peer ${peerId.substring(0, 8)}...`);

    // Only auto-connect if we should initiate to this peer and we're not already trying
    if (this.autoDiscovery && this.shouldInitiateConnection(peerId) && !this.connectionAttempts.has(peerId)) {
      this.debug.log(`Considering connection to ${peerId.substring(0, 8)}...`);

      const canAccept = this.canAcceptMorePeers();
      if (canAccept) {
        this.debug.log(`Connecting to ${peerId.substring(0, 8)}...`);
        this.emit('connectToPeer', { peerId });
      }
    }

    this.scheduleMeshOptimization();
  }

  // Update connection attempts tracking (no complex isolation logic needed)
  onConnectionEstablished() {
    this.debug.log('Connection established');
  }

  removeDiscoveredPeer(peerId) {
    this.discoveredPeers.delete(peerId);
    this.connectionAttempts.delete(peerId);
  }

  trackConnectionAttempt(peerId) {
    this.connectionAttempts.set(peerId, Date.now());
  }

  clearConnectionAttempt(peerId) {
    this.connectionAttempts.delete(peerId);
  }

  calculateXorDistance(peerId1, peerId2) {
    let distance = 0n;
    for (let i = 0; i < Math.min(peerId1.length, peerId2.length); i += 2) {
      const byte1 = parseInt(peerId1.substr(i, 2), 16);
      const byte2 = parseInt(peerId2.substr(i, 2), 16);
      const xor = byte1 ^ byte2;
      distance = (distance << 8n) | BigInt(xor);
    }
    return distance;
  }

  shouldInitiateConnection(targetPeerId) {
    if (this.connectionAttempts.has(targetPeerId)) {
      return false;
    }

    // Check current connection count to handle isolation
    this.emit('checkCapacity');
    const currentConnectionCount = this._currentConnectionCount || 0;

    // Standard rule: Lexicographically larger peer ID initiates
    const lexicographicShouldInitiate = this.peerId > targetPeerId;

    // CRITICAL FIX: If we have no connections, override lexicographic rule to avoid isolation
    if (currentConnectionCount === 0 && this.discoveredPeers.size > 0) {
      // For completely isolated peers, be more aggressive about connecting
      const discoveredPeers = Array.from(this.discoveredPeers.keys());
      const naturalInitiators = discoveredPeers.filter(peerId => this.peerId > peerId);

      // First priority: peers where we'd naturally be the initiator
      if (naturalInitiators.length > 0 && naturalInitiators.includes(targetPeerId)) {
        this.debug.log(`shouldInitiateConnection: Isolation override (natural) - ${this.peerId.substring(0, 8)}... will initiate to ${targetPeerId.substring(0, 8)}...`);
        return true;
      }

      // Second priority: if no natural initiators, try the closest 3 peers by XOR distance
      if (naturalInitiators.length === 0) {
        const sortedByDistance = discoveredPeers.sort((a, b) => {
          const distA = this.calculateXorDistance(this.peerId, a);
          const distB = this.calculateXorDistance(this.peerId, b);
          return distA < distB ? -1 : 1;
        });

        // Try to connect to the closest 3 peers (or all if less than 3)
        const closestPeers = sortedByDistance.slice(0, Math.min(3, sortedByDistance.length));
        if (closestPeers.includes(targetPeerId)) {
          const index = closestPeers.indexOf(targetPeerId);
          this.debug.log(`shouldInitiateConnection: Isolation override (closest ${index + 1}) - ${this.peerId.substring(0, 8)}... will initiate to ${targetPeerId.substring(0, 8)}...`);
          return true;
        }
      }

      // Third priority: if we still have no connections and have attempted several peers,
      // be even more aggressive and try ANY peer to break isolation
      const attemptedConnections = this.connectionAttempts.size;
      if (attemptedConnections >= 2 && discoveredPeers.includes(targetPeerId)) {
        this.debug.log(`shouldInitiateConnection: Isolation override (desperate) - ${this.peerId.substring(0, 8)}... will initiate to ${targetPeerId.substring(0, 8)}... (${attemptedConnections} attempts failed)`);
        return true;
      }
    }

    // SAFETY: If we have very few connections (below minimum), override lexicographic order
    // to ensure every peer gets at least minimum connectivity
    const currentConnectedCount = this.mesh.connectionManager.getConnectedPeerCount();
    const allDiscoveredPeers = Array.from(this.discoveredPeers.keys());

    if (currentConnectedCount < this.mesh.minPeers && allDiscoveredPeers.includes(targetPeerId)) {
      this.debug.log(`shouldInitiateConnection: Below minimum connectivity (${currentConnectedCount}/${this.mesh.minPeers}) - overriding lexicographic order for ${targetPeerId.substring(0, 8)}...`);
      return true;
    }

    this.debug.log(`shouldInitiateConnection: ${this.peerId.substring(0, 8)}... > ${targetPeerId.substring(0, 8)}... = ${lexicographicShouldInitiate}`);
    return lexicographicShouldInitiate;
  }

  isAttemptingConnection(peerId) {
    return this.connectionAttempts.has(peerId);
  }

  shouldEvictForPeer(newPeerId) {
    if (!this.evictionStrategy || !this.xorRouting) {
      return null;
    }

    // This would need access to current peers, so we'll emit an event instead
    this.emit('checkEviction', { newPeerId });
    return this._shouldEvictForPeer ?? null; // Use stored value from mesh, default to null
  }

  canAcceptMorePeers() {
    // This needs to be determined by the mesh
    this.emit('checkCapacity');
    return this._canAcceptMorePeers ?? true; // Use stored value from mesh, default to true
  }

  optimizeMeshConnections(currentPeers) {
    if (!this.autoDiscovery) return;

    this.debug.log('Optimizing mesh connections...');

    // Find unconnected peers that we should initiate connections to
    const unconnectedPeers = Array.from(this.discoveredPeers.keys())
      .filter(peerId => {
        const notConnected = !currentPeers.has(peerId);
        const notConnecting = !this.connectionAttempts.has(peerId);
        const shouldInitiate = this.shouldInitiateConnection(peerId);

        return notConnected && notConnecting && shouldInitiate;
      });

    if (unconnectedPeers.length === 0) {
      this.debug.log('No unconnected peers to optimize');

      // DISABLED: Aggressive rebalancing causing connection drops
      // Only do gentle rebalancing if we're significantly over-connected
      // if (this.mesh.meshOptimizer && this.mesh.meshOptimizer.rebalanceMeshConnections) {
      //   this.mesh.meshOptimizer.rebalanceMeshConnections();
      // }
      return;
    }

    // Sort by XOR distance to prioritize closer peers (if XOR routing enabled)
    if (this.xorRouting) {
      unconnectedPeers.sort((a, b) => {
        const distA = this.calculateXorDistance(this.peerId, a);
        const distB = this.calculateXorDistance(this.peerId, b);
        return distA < distB ? -1 : 1;
      });
    }

    this.emit('optimizeConnections', { unconnectedPeers });
  }

  startCleanupInterval() {
    if (environmentDetector.isBrowser) {
      this.cleanupInterval = window.setInterval(() => {
        this.cleanupStaleDiscoveredPeers();
      }, 30000);
    } else {
      this.cleanupInterval = setInterval(() => {
        this.cleanupStaleDiscoveredPeers();
      }, 30000);
    }
  }

  cleanupStaleDiscoveredPeers() {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000;
    let removedCount = 0;

    this.discoveredPeers.forEach((timestamp, peerId) => {
      if (now - timestamp > staleThreshold) {
        this.discoveredPeers.delete(peerId);
        this.connectionAttempts.delete(peerId);
        removedCount++;
        this.debug.log('Removed stale peer:', peerId.substring(0, 8));
      }
    });

    if (removedCount > 0) {
      this.emit('peersUpdated', { removedCount });
    }
  }

  getDiscoveredPeers() {
    return Array.from(this.discoveredPeers.entries()).map(([peerId, timestamp]) => ({
      peerId,
      timestamp,
      distance: this.calculateXorDistance(this.peerId, peerId),
      isConnecting: this.connectionAttempts.has(peerId),
      isConnected: false // Will be set by the mesh when it has peer info
    }));
  }

  hasPeer(peerId) {
    return this.discoveredPeers.has(peerId);
  }

  setSettings(settings) {
    if (settings.autoDiscovery !== undefined) {
      this.autoDiscovery = settings.autoDiscovery;
    }
    if (settings.evictionStrategy !== undefined) {
      this.evictionStrategy = settings.evictionStrategy;
    }
    if (settings.xorRouting !== undefined) {
      this.xorRouting = settings.xorRouting;
    }
    if (settings.minPeers !== undefined) {
      this.minPeers = settings.minPeers;
    }
    if (settings.maxPeers !== undefined) {
      this.maxPeers = settings.maxPeers;
    }
  }

  updateDiscoveryTimestamp(peerId) {
    if (this.discoveredPeers.has(peerId)) {
      this.discoveredPeers.set(peerId, Date.now());
    }
  }

  debugCurrentState() {
    const discoveredPeerIds = Array.from(this.discoveredPeers.keys()).map(p => p.substring(0, 8));
    const connectionAttempts = Array.from(this.connectionAttempts.keys()).map(p => p.substring(0, 8));

    this.debug.log('=== PEER DISCOVERY DEBUG ===');
    this.debug.log(`Our peer ID: ${this.peerId.substring(0, 8)}...`);
    this.debug.log(`Discovered peers (${discoveredPeerIds.length}): ${discoveredPeerIds.join(', ')}`);
    this.debug.log(`Connection attempts (${connectionAttempts.length}): ${connectionAttempts.join(', ')}`);

    // Show which peers we should/shouldn't initiate to
    discoveredPeerIds.forEach(peerId => {
      const fullPeerId = Array.from(this.discoveredPeers.keys()).find(p => p.startsWith(peerId));
      const shouldInitiate = this.shouldInitiateConnection(fullPeerId);
      const comparison = this.peerId > fullPeerId;
      this.debug.log(`  ${peerId}...: should initiate = ${shouldInitiate} (${this.peerId.substring(0, 8)}... > ${peerId}... = ${comparison})`);
    });
    this.debug.log('=== END DEBUG ===');
  }
}
