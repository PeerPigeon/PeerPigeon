import { EventEmitter } from './EventEmitter.js';
import DebugLogger from './DebugLogger.js';

/**
 * Manages mesh optimization, connection strategies, and peer discovery optimization
 */
export class MeshOptimizer extends EventEmitter {
  constructor(mesh, connectionManager, evictionManager) {
    super();
    this.debug = DebugLogger.create('MeshOptimizer');
    this.mesh = mesh;
    this.connectionManager = connectionManager;
    this.evictionManager = evictionManager;
  }

  handleOptimizeConnections(unconnectedPeers) {
    if (!this.mesh.autoDiscovery) return;

    // For small mesh sizes, optimize if under capacity. For larger meshes, only optimize if significantly under capacity.
    const currentConnected = this.connectionManager.getConnectedPeerCount();

    // CRITICAL FIX: If we have no connections and there are available peers, we should connect
    // This handles the case where a peer with a small ID needs to connect to maintain mesh connectivity
    const hasNoConnections = currentConnected === 0;
    const belowMinimum = currentConnected < this.mesh.minPeers;

    if (hasNoConnections && unconnectedPeers.length > 0) {
      this.debug.log(`Peer has no connections but found ${unconnectedPeers.length} unconnected peers - forcing connection attempt`);
      // Force connection to the closest peer by XOR distance
      const sortedByDistance = unconnectedPeers.sort((a, b) => {
        const distA = this.calculateXorDistance(this.mesh.peerId, a);
        const distB = this.calculateXorDistance(this.mesh.peerId, b);
        return distA < distB ? -1 : 1;
      });

      const targetPeer = sortedByDistance[0];
      this.debug.log(`Forcing connection to closest peer: ${targetPeer.substring(0, 8)}... (no connections, mesh connectivity required)`);
      this.connectionManager.connectToPeer(targetPeer);
      return;
    }

    if (belowMinimum && unconnectedPeers.length > 0) {
      this.debug.log(`Below minimum peers (${currentConnected}/${this.mesh.minPeers}) - connecting to additional peers`);
      const needed = Math.min(this.mesh.minPeers - currentConnected, unconnectedPeers.length);

      // Sort by XOR distance and connect to closest peers
      const sortedByDistance = unconnectedPeers.sort((a, b) => {
        const distA = this.calculateXorDistance(this.mesh.peerId, a);
        const distB = this.calculateXorDistance(this.mesh.peerId, b);
        return distA < distB ? -1 : 1;
      });

      for (let i = 0; i < needed; i++) {
        const targetPeer = sortedByDistance[i];
        this.debug.log(`Connecting to reach minimum: ${targetPeer.substring(0, 8)}...`);
        this.connectionManager.connectToPeer(targetPeer);
      }
      return;
    }

    // Normal optimization logic
    if (this.mesh.maxPeers <= 3) {
      // For small meshes, always try to reach max capacity
      if (currentConnected >= this.mesh.maxPeers) {
        this.debug.log(`Skipping optimization - already at max capacity ${currentConnected}/${this.mesh.maxPeers}`);
        return;
      }
    } else {
      // For larger meshes, only optimize if below 70% capacity
      const targetThreshold = Math.floor(this.mesh.maxPeers * 0.7);
      if (currentConnected >= targetThreshold) {
        this.debug.log(`Skipping optimization - ${currentConnected}/${this.mesh.maxPeers} peers connected (threshold: ${targetThreshold})`);
        return;
      }
    }

    const availableSlots = this.mesh.maxPeers - currentConnected;
    const peersToConnect = unconnectedPeers.slice(0, Math.min(availableSlots, 1)); // Only connect to 1 peer at a time

    this.debug.log(`Optimizing connections carefully: ${availableSlots} slots available, connecting to ${peersToConnect.length} peer(s)`);

    peersToConnect.forEach((peerId, _index) => {
      if (this.mesh.peerDiscovery.shouldInitiateConnection(peerId)) {
        this.debug.log(`Initiating immediate connection to ${peerId.substring(0, 8)}... in optimization`);
        // Double-check conditions before connecting
        if (this.connectionManager.canAcceptMorePeers() &&
                    !this.connectionManager.hasPeer(peerId) &&
                    !this.mesh.peerDiscovery.isAttemptingConnection(peerId)) {
          this.connectionManager.connectToPeer(peerId);
        } else {
          this.debug.log(`Skipping connection to ${peerId.substring(0, 8)}... - conditions changed`);
        }
      } else {
        this.debug.log(`Not initiating connection to ${peerId.substring(0, 8)}... (should not initiate)`);
      }
    });
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

  // Method to force connection attempts to all discovered peers
  forceConnectToAllPeers() {
    const discoveredPeers = this.mesh.getDiscoveredPeers();
    let connectionAttempts = 0;

    this.debug.log(`Forcing connections to ${discoveredPeers.length} discovered peers...`);

    discoveredPeers.forEach(peer => {
      if (!this.connectionManager.hasPeer(peer.peerId) && this.connectionManager.canAcceptMorePeers()) {
        this.debug.log(`Force connecting to ${peer.peerId.substring(0, 8)}...`);
        this.connectionManager.connectToPeer(peer.peerId);
        connectionAttempts++;
      }
    });

    this.debug.log(`Initiated ${connectionAttempts} forced connection attempts`);
    return connectionAttempts;
  }

  // Debug method to help diagnose connectivity issues
  debugConnectivity() {
    const connectedPeers = this.connectionManager.getConnectedPeerCount();
    const discoveredPeers = this.mesh.getDiscoveredPeers();
    const totalPeers = this.connectionManager.peers.size;

    this.debug.log('=== CONNECTIVITY DEBUG ===');
    this.debug.log(`My Peer ID: ${this.mesh.peerId}`);
    this.debug.log(`Connected Peers: ${connectedPeers}/${this.mesh.maxPeers}`);
    this.debug.log(`Total Peer Objects: ${totalPeers}`);
    this.debug.log(`Discovered Peers: ${discoveredPeers.length}`);

    this.debug.log('\nPeer Details:');
    this.connectionManager.peers.forEach((peerConnection, peerId) => {
      const status = peerConnection.getStatus();
      const dataChannelReady = peerConnection.dataChannelReady;
      const connectionState = peerConnection.connection?.connectionState || 'unknown';
      const dataChannelState = peerConnection.dataChannel?.readyState || 'unknown';

      this.debug.log(`  ${peerId.substring(0, 8)}... - Status: ${status}, WebRTC: ${connectionState}, DataChannel: ${dataChannelState}, Ready: ${dataChannelReady}`);
    });

    this.debug.log('\nDiscovered Peers:');
    discoveredPeers.forEach(peer => {
      const shouldInitiate = this.mesh.peerId < peer.peerId;
      const isConnected = this.connectionManager.hasPeer(peer.peerId);
      this.debug.log(`  ${peer.peerId.substring(0, 8)}... - ShouldInitiate: ${shouldInitiate}, IsConnected: ${isConnected}`);
    });

    this.debug.log('\nConnection Attempts:');
    this.connectionManager.connectionAttempts.forEach((attempts, peerId) => {
      this.debug.log(`  ${peerId.substring(0, 8)}... - Attempts: ${attempts}/${this.connectionManager.maxConnectionAttempts}`);
    });

    this.debug.log('\nEviction Status:');
    this.debug.log(`  Eviction Strategy: ${this.mesh.evictionStrategy ? 'enabled' : 'disabled'}`);
    this.debug.log(`  XOR Routing: ${this.mesh.xorRouting ? 'enabled' : 'disabled'}`);

    this.debug.log('=== END DEBUG ===\n');

    return {
      connectedPeers,
      totalPeers,
      discoveredPeers: discoveredPeers.length,
      evictionEnabled: this.mesh.evictionStrategy,
      xorRouting: this.mesh.xorRouting,
      peerStatuses: Array.from(this.connectionManager.peers.entries()).map(([peerId, conn]) => ({
        peerId: peerId.substring(0, 8),
        status: conn.getStatus(),
        dataChannelReady: conn.dataChannelReady
      }))
    };
  }
}
