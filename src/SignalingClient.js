import { EventEmitter } from './EventEmitter.js';
import { environmentDetector } from './EnvironmentDetector.js';
import DebugLogger from './DebugLogger.js';

export class SignalingClient extends EventEmitter {
  constructor(peerId, maxPeers = 10, mesh = null) {
    super();
    this.debug = DebugLogger.create('SignalingClient');
    this.peerId = peerId;
    this.maxPeers = maxPeers;
    this.mesh = mesh; // Reference to the mesh for peer coordination
    this.signalingUrl = null;
    this.connected = false;
    this.websocket = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10; // Increased for better persistence
    this.connectionPromise = null;
    this.reconnectTimeout = null;
    this.isReconnecting = false;
  }

  setConnectionType(type) {
    // WebSocket-only implementation, ignore connection type setting
    this.debug.log(`WebSocket-only implementation - connection type setting ignored: ${type}`);
  }

  createWebSocket(url) {
    // Environment-aware WebSocket creation
    if (environmentDetector.isNodeJS) {
      // Check for globally injected WebSocket first (set by user)
      if (typeof global !== 'undefined' && typeof global.WebSocket !== 'undefined') {
        return new global.WebSocket(url);
      }
      if (typeof WebSocket !== 'undefined') {
        return new WebSocket(url);
      }

      // Try to use the 'ws' package if available
      try {
        if (typeof require !== 'undefined') {
          const WebSocket = require('ws');
          return new WebSocket(url);
        } else {
          // In ES modules, dynamic import would be needed
          this.debug.warn('WebSocket package detection not available in ES modules. Ensure "ws" is installed.');
          throw new Error('WebSocket not available in Node.js ES modules. Install the "ws" package and import it manually.');
        }
      } catch (error) {
        this.debug.warn('ws package not found in Node.js environment. Install with: npm install ws');
        throw new Error('WebSocket not available in Node.js. Install the "ws" package.');
      }
    } else if (environmentDetector.isBrowser || environmentDetector.isWorker || environmentDetector.isNativeScript) {
      // In browser, worker, or NativeScript environments, use the native WebSocket
      return new WebSocket(url);
    } else {
      throw new Error('WebSocket not supported in this environment');
    }
  }

  async sendSignalingMessage(message) {
    // Check connection status before sending
    if (!this.isConnected()) {
      this.debug.log('WebSocket not connected, attempting to reconnect...');
      if (!this.isReconnecting) {
        this.attemptReconnect();
      }
      throw new Error('WebSocket not connected');
    }

    const payload = {
      type: message.type,
      data: message.data,
      maxPeers: this.maxPeers,
      networkName: this.mesh ? this.mesh.networkName : 'global', // Include network namespace
      ...(message.targetPeerId && { targetPeerId: message.targetPeerId })
    };

    try {
      this.websocket.send(JSON.stringify(payload));
      this.debug.log(`Sent WebSocket message: ${payload.type} (network: ${payload.networkName})`);
      return { success: true };
    } catch (error) {
      this.debug.error('Failed to send WebSocket message:', error);
      // Trigger reconnection on send failure
      if (!this.isReconnecting) {
        this.attemptReconnect();
      }
      throw error;
    }
  }

  isConnected() {
    return this.websocket &&
               this.websocket.readyState === WebSocket.OPEN &&
               this.connected;
  }

  async connect(websocketUrl) {
    // Validate WebSocket support before attempting connection
    if (!environmentDetector.hasWebSocket) {
      const error = new Error('WebSocket not supported in this environment');
      this.emit('statusChanged', { type: 'error', message: error.message });
      throw error;
    }

    // Prevent multiple simultaneous connection attempts
    if (this.connectionPromise) {
      this.debug.log('Connection already in progress, waiting for completion...');
      return this.connectionPromise;
    }

    // Convert HTTP/HTTPS URL to WebSocket URL if needed
    if (websocketUrl.startsWith('http://')) {
      websocketUrl = websocketUrl.replace('http://', 'ws://');
    } else if (websocketUrl.startsWith('https://')) {
      websocketUrl = websocketUrl.replace('https://', 'wss://');
    }

    // Ensure WebSocket URL format
    if (!websocketUrl.startsWith('ws://') && !websocketUrl.startsWith('wss://')) {
      throw new Error('Invalid WebSocket URL format');
    }

    this.signalingUrl = websocketUrl;

    // Add peerId as query parameter
    const url = new URL(websocketUrl);
    url.searchParams.set('peerId', this.peerId);

    this.emit('statusChanged', { type: 'connecting', message: 'Connecting to WebSocket...' });

    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        // Create WebSocket with environment-specific handling
        this.websocket = this.createWebSocket(url.toString());

        const connectTimeout = setTimeout(() => {
          if (this.websocket.readyState === WebSocket.CONNECTING) {
            this.websocket.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

        this.websocket.onopen = () => {
          clearTimeout(connectTimeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.isReconnecting = false;
          this.connectionPromise = null;

          this.debug.log('WebSocket connected');
          this.emit('statusChanged', { type: 'info', message: 'WebSocket connected' });

          // Send announce message
          this.sendSignalingMessage({
            type: 'announce',
            data: { peerId: this.peerId }
          }).then(() => {
            this.emit('connected');
            resolve();
          }).catch(error => {
            this.debug.error('Failed to send announce message:', error);
            this.emit('connected'); // Still emit connected even if announce fails
            resolve();
          });
        };

        this.websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.debug.log(`Received WebSocket message: ${message.type} (network: ${message.networkName || 'unknown'})`);

            if (message.type === 'connected') {
              // Connection confirmation from server
              this.debug.log('WebSocket connection confirmed by server');
            } else {
              // Filter messages by network namespace
              const currentNetwork = this.mesh ? this.mesh.networkName : 'global';
              const messageNetwork = message.networkName || 'global';
              
              if (messageNetwork === currentNetwork) {
                // Forward signaling message to mesh
                this.emit('signalingMessage', message);
              } else {
                this.debug.log(`Filtered message from different network: ${messageNetwork} (current: ${currentNetwork})`);
              }
            }
          } catch (error) {
            this.debug.error('Failed to parse WebSocket message:', error);
          }
        };

        this.websocket.onclose = (event) => {
          clearTimeout(connectTimeout);
          this.connected = false;
          this.connectionPromise = null;

          this.debug.log('WebSocket closed:', event.code, event.reason);

          if (event.code === 1000) {
            // Normal closure
            this.emit('disconnected');
          } else {
            // Abnormal closure - attempt reconnection
            this.emit('statusChanged', { type: 'warning', message: 'WebSocket connection lost - reconnecting...' });
            if (!this.isReconnecting) {
              this.attemptReconnect();
            }
          }
        };

        this.websocket.onerror = (error) => {
          clearTimeout(connectTimeout);
          this.debug.error('WebSocket error:', error);

          if (this.websocket.readyState === WebSocket.CONNECTING) {
            this.connectionPromise = null;
            reject(new Error('WebSocket connection failed'));
          } else {
            this.emit('statusChanged', { type: 'error', message: 'WebSocket error occurred' });
            // Trigger reconnection on error if not already reconnecting
            if (!this.isReconnecting) {
              this.attemptReconnect();
            }
          }
        };
      } catch (error) {
        this.connectionPromise = null;
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  attemptReconnect() {
    if (this.isReconnecting) {
      this.debug.log('Reconnection already in progress');
      return;
    }

    // Check if we have healthy peer connections - if so, be less aggressive with reconnection
    const hasHealthyPeers = this.mesh && this.mesh.connectionManager &&
                           this.mesh.connectionManager.getConnectedPeerCount() > 0;

    if (hasHealthyPeers) {
      this.debug.log('Have healthy peer connections, reducing reconnection urgency');
    }

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.debug.log('Max reconnection attempts reached, using exponential backoff');
      // If we have healthy peers, use much longer delays to avoid disrupting the mesh
      const baseExtendedDelay = hasHealthyPeers ? 600000 : this.maxReconnectDelay * 2; // 10 min vs 2x normal
      const extendedDelay = Math.min(baseExtendedDelay, 600000); // Max 10 minutes
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectAttempts = Math.floor(this.maxReconnectAttempts / 2); // Reset to half max
        this.attemptReconnect();
      }, extendedDelay);
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Use longer delays if we have healthy peer connections
    const baseDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    const delayMultiplier = hasHealthyPeers ? 3 : 1; // 3x longer delay if peers are healthy
    const delay = Math.min(baseDelay * delayMultiplier, hasHealthyPeers ? 300000 : this.maxReconnectDelay);

    this.debug.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}, healthy peers: ${hasHealthyPeers})`);

    this.reconnectTimeout = setTimeout(async () => {
      if (!this.connected && this.signalingUrl) {
        try {
          await this.connect(this.signalingUrl);
          this.emit('statusChanged', { type: 'info', message: 'WebSocket reconnected successfully' });
        } catch (error) {
          this.debug.error('Reconnection failed:', error);
          this.isReconnecting = false;
          this.attemptReconnect();
        }
      } else {
        this.isReconnecting = false;
      }
    }, delay);
  }

  disconnect() {
    // Clear reconnection state
    this.isReconnecting = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // The sendGoodbyeMessage is often called from an unload handler,
    // so we don't want to make it part of the standard disconnect flow here.
    // The CleanupManager handles sending goodbye on unload.

    this.connected = false;
    this.connectionPromise = null;

    if (this.websocket) {
      // Clear event handlers to prevent memory leaks
      this.websocket.onopen = null;
      this.websocket.onmessage = null;
      this.websocket.onclose = null;
      this.websocket.onerror = null;

      this.websocket.close(1000, 'Client disconnect');
      this.websocket = null;
    }

    this.emit('disconnected');
  }

  sendGoodbyeMessage() {
    if (!this.connected) return;

    try {
      this.debug.log('Sending goodbye message');

      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        this.websocket.send(JSON.stringify({
          type: 'goodbye',
          data: {
            peerId: this.peerId,
            timestamp: Date.now(),
            reason: 'peer_disconnect'
          }
        }));
      }
    } catch (error) {
      this.debug.error('Failed to send goodbye message:', error);
    }
  }

  async sendCleanupMessage(targetPeerId) {
    if (!this.connected) return;

    try {
      await this.sendSignalingMessage({
        type: 'cleanup',
        data: {
          peerId: this.peerId,
          targetPeerId,
          timestamp: Date.now(),
          reason: 'peer_disconnect'
        },
        targetPeerId
      });
    } catch (error) {
      this.debug.log(`Cleanup message failed for ${targetPeerId}:`, error.message);
    }
  }

  getConnectionStats() {
    return {
      connected: this.connected,
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      websocketState: this.websocket ? this.websocket.readyState : 'not created'
    };
  }
}
