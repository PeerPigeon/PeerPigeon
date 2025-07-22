import { EventEmitter } from './EventEmitter.js';

/**
 * Manages cleanup operations for signaling data and peer connections
 */
export class CleanupManager extends EventEmitter {
  constructor(mesh) {
    super();
    this.mesh = mesh;
    this.cleanupInProgress = new Set();
  }

  async cleanupSignalingData(peerId) {
    // Prevent duplicate cleanup calls
    if (this.cleanupInProgress.has(peerId)) {
      console.log('Cleanup already in progress for', peerId);
      return;
    }

    this.cleanupInProgress.add(peerId);

    try {
      console.log('Cleaning up signaling data for', peerId);

      const response = await this.mesh.signalingClient.sendSignalingMessage({
        type: 'cleanup',
        data: {
          peerId: this.mesh.peerId,
          targetPeerId: peerId,
          timestamp: Date.now(),
          reason: 'connection_established'
        },
        targetPeerId: peerId
      });

      // Only log if something was actually cleaned up
      if (response.cleaned && (response.cleaned.signaling > 0 || response.cleaned.discovery > 0)) {
        console.log('Signaling cleanup completed for', peerId, response);
        this.mesh.emit('statusChanged', { type: 'info', message: `Cleaned up signaling data with ${peerId.substring(0, 8)}...` });
      }
    } catch (error) {
      console.error('Failed to cleanup signaling data for', peerId, error);
      // Don't show error to user as this is background cleanup
    } finally {
      this.cleanupInProgress.delete(peerId);
    }
  }

  async cleanupAllSignalingData() {
    if (this.mesh.signalingClient && this.mesh.peerId) {
      try {
        const response = await this.mesh.signalingClient.sendSignalingMessage({
          type: 'cleanup-all',
          data: {
            peerId: this.mesh.peerId,
            timestamp: Date.now(),
            reason: 'peer_cleanup'
          }
        });

        // Only log if something was actually cleaned
        if (response.cleaned > 0) {
          console.log(`Cleaned up ${response.cleaned} stale signaling items`);
        }
      } catch (error) {
        console.log('Failed to cleanup all signaling data:', error.message);
      }
    }
  }

  cleanupAllSignalingDataSync() {
    if (this.mesh.signalingClient && this.mesh.connected && this.mesh.peerId) {
      try {
        // Send cleanup message via WebSocket synchronously
        this.mesh.signalingClient.sendSignalingMessage({
          type: 'cleanup-all',
          data: {
            peerId: this.mesh.peerId,
            timestamp: Date.now(),
            reason: 'browser_unload'
          }
        }).catch(error => {
          console.log('Failed to send cleanup-all message:', error.message);
        });
        console.log('Cleanup-all message sent via WebSocket');
      } catch (error) {
        console.log('Failed to send cleanup-all message:', error.message);
      }
    }
  }

  // Manual cleanup method for already-connected mesh networks
  async cleanupStaleSignalingData() {
    if (!this.mesh.signalingClient || !this.mesh.connected) {
      console.log('Cannot cleanup - not connected to signaling server');
      return;
    }

    console.log('Manually cleaning up stale signaling data for all connected peers...');

    try {
      // Clean up signaling data for each connected peer
      const cleanupPromises = [];

      // Use safer iteration to avoid race conditions
      if (this.mesh.connectionManager && this.mesh.connectionManager.peers) {
        const peerEntries = Array.from(this.mesh.connectionManager.peers.entries());

        for (const [peerId, peerConnection] of peerEntries) {
          try {
            if (peerConnection && peerConnection.getStatus && peerConnection.getStatus() === 'connected') {
              cleanupPromises.push(this.cleanupSignalingData(peerId));
            }
          } catch (error) {
            console.log(`Error checking peer ${peerId} status during cleanup:`, error.message);
          }
        }
      }

      // Wait for all peer-specific cleanups to complete
      if (cleanupPromises.length > 0) {
        await Promise.allSettled(cleanupPromises);
      }

      // Then do a comprehensive cleanup
      await this.cleanupAllSignalingData();

      console.log('Manual cleanup completed for all connected peers');
      this.mesh.emit('statusChanged', { type: 'info', message: 'Cleaned up stale signaling data' });
    } catch (error) {
      console.error('Manual cleanup failed:', error);
      this.mesh.emit('statusChanged', { type: 'error', message: 'Failed to cleanup signaling data' });
    }
  }

  sendGoodbyeMessageSync() {
    if (this.mesh.signalingClient && this.mesh.connected) {
      try {
        // For WebSocket, send goodbye message synchronously
        this.mesh.signalingClient.sendGoodbyeMessage();
        console.log('Goodbye message sent via WebSocket');
      } catch (error) {
        console.log('Failed to send goodbye message:', error.message);
      }
    }
  }

  async sendGoodbyeMessage() {
    if (this.mesh.signalingClient && this.mesh.connected) {
      try {
        await this.mesh.signalingClient.sendSignalingMessage({
          type: 'goodbye',
          data: { peerId: this.mesh.peerId, timestamp: Date.now() }
        });
      } catch (error) {
        console.log('Failed to send goodbye message:', error.message);
      }
    }
  }

  setupUnloadHandlers() {
    // Handle page unload/refresh - ONLY clean up ALL peer data on actual unload
    if (typeof window !== 'undefined') {
      const handleUnload = () => {
        console.log('Page unloading - cleaning up ALL peer data');
        this.sendGoodbyeMessageSync();
        this.cleanupAllSignalingDataSync();
      };

      // Only trigger cleanup on actual page unload scenarios
      // DO NOT cleanup on focus loss or visibility change (breaks multi-tab usage)
      window.addEventListener('beforeunload', handleUnload);
      window.addEventListener('unload', handleUnload);
      window.addEventListener('pagehide', handleUnload);
    }
  }

  cleanup() {
    this.cleanupInProgress.clear();
  }
}
