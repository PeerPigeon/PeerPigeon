import { EventEmitter } from './EventEmitter.js';

/**
 * Simple eviction manager for mesh topology optimization
 * Evicts farthest peers when at capacity to maintain optimal XOR distance topology
 */
export class EvictionManager extends EventEmitter {
    constructor(mesh, connectionManager) {
        super();
        this.mesh = mesh;
        this.connectionManager = connectionManager;
    }

    shouldEvictForPeer(newPeerId) {
        // Only evict for mesh topology optimization
        if (!this.mesh.evictionStrategy) {
            console.log(`Eviction disabled - evictionStrategy is false`);
            return null;
        }

        // Check total peer count (including connecting peers) to prevent race conditions
        const totalPeerCount = this.connectionManager.peers.size;
        if (totalPeerCount < this.mesh.maxPeers) {
            console.log(`No eviction needed: ${totalPeerCount}/${this.mesh.maxPeers} peers`);
            return null;
        }

        // Special case: if we have 0 connected peers (isolated), be very aggressive about making room
        const connectedCount = this.connectionManager.getConnectedPeerCount();
        if (connectedCount === 0) {
            console.log(`Isolated peer scenario: finding any peer to evict for ${newPeerId.substring(0, 8)}...`);
            // Find any peer to evict (even connecting ones) to make room for this connection
            const anyPeerId = Array.from(this.connectionManager.peers.keys())[0];
            if (anyPeerId) {
                console.log(`Will evict any peer ${anyPeerId.substring(0, 8)}... to escape isolation for ${newPeerId.substring(0, 8)}...`);
                return anyPeerId;
            }
        }

        // If XOR routing is enabled, use distance-based eviction
        if (this.mesh.xorRouting) {
            const newPeerDistance = this.calculateXorDistance(this.mesh.peerId, newPeerId);
            const farthestPeerId = this.findFarthestPeer();
            
            if (!farthestPeerId) {
                console.log(`No eviction candidate found (no peers to evict)`);
                return null;
            }

            const farthestDistance = this.calculateXorDistance(this.mesh.peerId, farthestPeerId);

            console.log(`Eviction check: new peer ${newPeerId.substring(0, 8)}... (distance: ${newPeerDistance.toString(16).substring(0, 8)}) vs farthest ${farthestPeerId.substring(0, 8)}... (distance: ${farthestDistance.toString(16).substring(0, 8)})`);

            // LOOSENED RULE: If we're at max capacity, always try to evict the farthest peer
            // even if the new peer isn't strictly closer (helps with network connectivity)
            const shouldEvict = newPeerDistance < farthestDistance || 
                               (totalPeerCount >= this.mesh.maxPeers && connectedCount < this.mesh.minPeers);

            if (shouldEvict) {
                console.log(`Will evict ${farthestPeerId.substring(0, 8)}... for ${newPeerDistance < farthestDistance ? 'closer' : 'network connectivity'} peer ${newPeerId.substring(0, 8)}... (${totalPeerCount}/${this.mesh.maxPeers} peers)`);
                return farthestPeerId;
            }

            console.log(`Not evicting for ${newPeerId.substring(0, 8)}... - criteria not met (${totalPeerCount}/${this.mesh.maxPeers} peers)`);
            return null;
        } else {
            // If XOR routing is disabled, use simple FIFO eviction - evict oldest peer
            console.log(`XOR routing disabled - using FIFO eviction for ${newPeerId.substring(0, 8)}...`);
            const oldestPeerId = this.findOldestPeer();
            if (oldestPeerId) {
                console.log(`Will evict oldest peer ${oldestPeerId.substring(0, 8)}... for new peer ${newPeerId.substring(0, 8)}... (${totalPeerCount}/${this.mesh.maxPeers} peers)`);
                return oldestPeerId;
            }
            
            console.log(`No eviction candidate found (no peers to evict)`);
            return null;
        }
    }

    async evictPeer(peerId, reason = 'topology optimization') {
        const peerConnection = this.connectionManager.getPeer(peerId);
        if (!peerConnection) {
            console.log(`Cannot evict ${peerId.substring(0, 8)}... - peer not found`);
            return;
        }

        console.log(`Evicting ${peerId.substring(0, 8)}... (${reason})`);
        
        // Send eviction notice
        try {
            peerConnection.sendMessage({
                type: 'eviction',
                reason: reason,
                from: this.mesh.peerId
            });
        } catch (error) {
            console.log('Failed to send eviction notice:', error.message);
        }

        // Close connection and clean up
        peerConnection.close();
        this.connectionManager.peers.delete(peerId);
        this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
        
        this.mesh.emit('peerDisconnected', { peerId, reason: `evicted: ${reason}` });
        this.connectionManager.emit('peersUpdated');
    }

    handleEvictionNotice(message, fromPeerId) {
        console.log(`Evicted by ${fromPeerId.substring(0, 8)}... (${message.reason})`);
        
        // Clean up the connection
        this.connectionManager.peers.delete(fromPeerId);
        this.mesh.peerDiscovery.clearConnectionAttempt(fromPeerId);
        
        this.mesh.emit('peerEvicted', { fromPeerId, reason: message.reason });
        this.connectionManager.emit('peersUpdated');
        
        // The evicted peer will naturally discover other peers and connect to those it's closer to
        // No complex reconnection logic needed - let peer discovery handle it
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

    findFarthestPeer() {
        if (this.connectionManager.peers.size === 0) {
            console.log(`No peers available for eviction`);
            return null;
        }

        let farthestPeer = null;
        let maxDistance = 0n;
        let candidateCount = 0;

        this.connectionManager.peers.forEach((peerConnection, peerId) => {
            const status = peerConnection.getStatus();
            // LOOSENED: Accept more peer states as eviction candidates
            if (status === 'connected' || 
                status === 'channel-connecting' || 
                status === 'connecting' ||
                status === 'channel-open') {
                candidateCount++;
                const distance = this.calculateXorDistance(this.mesh.peerId, peerId);
                if (distance > maxDistance) {
                    maxDistance = distance;
                    farthestPeer = peerId;
                }
            }
        });

        // FALLBACK: If no candidates found with strict criteria, try ANY peer
        if (!farthestPeer && this.connectionManager.peers.size > 0) {
            console.log(`No eviction candidates with connected/connecting status, trying any peer...`);
            this.connectionManager.peers.forEach((peerConnection, peerId) => {
                candidateCount++;
                const distance = this.calculateXorDistance(this.mesh.peerId, peerId);
                if (distance > maxDistance) {
                    maxDistance = distance;
                    farthestPeer = peerId;
                }
            });
        }

        if (farthestPeer) {
            console.log(`Found farthest peer for eviction: ${farthestPeer.substring(0, 8)}... (distance: ${maxDistance.toString(16).substring(0, 8)}, ${candidateCount} candidate peers)`);
        } else {
            console.log(`No peers available for eviction (${candidateCount} candidate peers)`);
        }

        return farthestPeer;
    }

    findOldestPeer() {
        if (this.connectionManager.peers.size === 0) {
            console.log(`No peers available for FIFO eviction`);
            return null;
        }

        let oldestPeer = null;
        let oldestTime = Date.now();
        let candidateCount = 0;

        this.connectionManager.peers.forEach((peerConnection, peerId) => {
            const status = peerConnection.getStatus();
            // LOOSENED: Accept more peer states as eviction candidates
            if (status === 'connected' || 
                status === 'channel-connecting' || 
                status === 'connecting' ||
                status === 'channel-open') {
                candidateCount++;
                const connectionTime = peerConnection.connectionStartTime || Date.now();
                if (connectionTime < oldestTime) {
                    oldestTime = connectionTime;
                    oldestPeer = peerId;
                }
            }
        });

        // FALLBACK: If no candidates found with strict criteria, try ANY peer
        if (!oldestPeer && this.connectionManager.peers.size > 0) {
            console.log(`No FIFO eviction candidates with connected/connecting status, trying any peer...`);
            this.connectionManager.peers.forEach((peerConnection, peerId) => {
                candidateCount++;
                const connectionTime = peerConnection.connectionStartTime || Date.now();
                if (connectionTime < oldestTime) {
                    oldestTime = connectionTime;
                    oldestPeer = peerId;
                }
            });
        }

        if (oldestPeer) {
            console.log(`Found oldest peer for eviction: ${oldestPeer.substring(0, 8)}... (connected at: ${new Date(oldestTime).toLocaleTimeString()}, ${candidateCount} candidates)`);
        } else {
            console.log(`No peers available for FIFO eviction (${candidateCount} candidates)`);
        }

        return oldestPeer;
    }

    disconnectExcessPeers() {
        if (this.connectionManager.peers.size <= this.mesh.maxPeers) return;

        const peerEntries = Array.from(this.connectionManager.peers.entries())
            .filter(([_, peerConnection]) => peerConnection.connectionStartTime)
            .sort((a, b) => a[1].connectionStartTime - b[1].connectionStartTime);

        const toDisconnect = peerEntries.slice(0, this.connectionManager.peers.size - this.mesh.maxPeers);
        
        toDisconnect.forEach(([peerId, peerConnection]) => {
            console.log(`Disconnecting ${peerId.substring(0, 8)}... (over max peers limit)`);
            peerConnection.close();
            this.connectionManager.peers.delete(peerId);
            this.mesh.peerDiscovery.clearConnectionAttempt(peerId);
            this.mesh.emit('peerDisconnected', { peerId, reason: 'over max peers limit' });
        });
        
        this.connectionManager.emit('peersUpdated');
    }

    clearEvictionTracking(peerId) {
        // No eviction tracking in simplified system
    }

    cleanup() {
        // Simple cleanup - no complex state to manage
    }
}
