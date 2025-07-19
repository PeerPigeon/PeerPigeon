import { EventEmitter } from './EventEmitter.js';
import { environmentDetector } from './EnvironmentDetector.js';

export class SignalingClient extends EventEmitter {
    constructor(peerId, maxPeers = 10, mesh = null) {
        super();
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
        
        // Add keep-alive ping to prevent WebSocket timeout
        this.keepAliveInterval = null;
        this.keepAliveIntervalMs = 9 * 60 * 1000; // Ping every 9 minutes for large safety margin
        
        // Health monitoring
        this.lastPingTime = null;
        this.lastPongTime = null;
        this.pingTimeout = null;
        this.healthCheckInterval = null;
        this.connectionQualityTimeout = 10000; // 10 seconds to consider connection unhealthy
    }

    setConnectionType(type) {
        // WebSocket-only implementation, ignore connection type setting
        console.log(`WebSocket-only implementation - connection type setting ignored: ${type}`);
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
                    console.warn('WebSocket package detection not available in ES modules. Ensure "ws" is installed.');
                    throw new Error('WebSocket not available in Node.js ES modules. Install the "ws" package and import it manually.');
                }
            } catch (error) {
                console.warn('ws package not found in Node.js environment. Install with: npm install ws');
                throw new Error('WebSocket not available in Node.js. Install the "ws" package.');
            }
        } else if (environmentDetector.isBrowser || environmentDetector.isWorker) {
            // In browser or worker environments, use the native WebSocket
            return new WebSocket(url);
        } else {
            throw new Error('WebSocket not supported in this environment');
        }
    }

    async sendSignalingMessage(message) {
        // Check connection health before sending
        if (!this.isConnected()) {
            console.log('WebSocket not connected, attempting to reconnect...');
            if (!this.isReconnecting) {
                this.attemptReconnect();
            }
            throw new Error('WebSocket not connected');
        }

        const payload = {
            type: message.type,
            data: message.data,
            maxPeers: this.maxPeers,
            ...(message.targetPeerId && { targetPeerId: message.targetPeerId })
        };

        try {
            this.websocket.send(JSON.stringify(payload));
            console.log('Sent WebSocket message:', payload.type);
            return { success: true };
        } catch (error) {
            console.error('Failed to send WebSocket message:', error);
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
            console.log('Connection already in progress, waiting for completion...');
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
                    
                    console.log('WebSocket connected');
                    this.emit('statusChanged', { type: 'info', message: 'WebSocket connected' });
                    
                    // Send announce message
                    this.sendSignalingMessage({
                        type: 'announce',
                        data: { peerId: this.peerId }
                    }).then(() => {
                        this.startKeepAlive();
                        // Removed health monitoring - keep-alive pings are sufficient
                        this.emit('connected');
                        resolve();
                    }).catch(error => {
                        console.error('Failed to send announce message:', error);
                        this.startKeepAlive();
                        // Removed health monitoring - keep-alive pings are sufficient
                        this.emit('connected'); // Still emit connected even if announce fails
                        resolve();
                    });
                };
                
                this.websocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        console.log('Received WebSocket message:', message.type);
                        
                        if (message.type === 'connected') {
                            // Connection confirmation from server
                            console.log('WebSocket connection confirmed by server');
                        } else if (message.type === 'pong') {
                            // Handle pong response for health monitoring
                            this.handlePong();
                        } else {
                            // Forward signaling message to mesh
                            this.emit('signalingMessage', message);
                        }
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error);
                    }
                };
                
                this.websocket.onclose = (event) => {
                    clearTimeout(connectTimeout);
                    this.connected = false;
                    this.connectionPromise = null;
                    this.stopKeepAlive();
                    // Removed health monitoring stop - not using health monitoring
                    
                    console.log('WebSocket closed:', event.code, event.reason);
                    
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
                    console.error('WebSocket error:', error);
                    
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
            console.log('Reconnection already in progress');
            return;
        }

        // Clear any existing reconnect timeout
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnection attempts reached, using exponential backoff');
            // Don't give up completely, but use longer delays
            const extendedDelay = Math.min(this.maxReconnectDelay * 2, 300000); // Max 5 minutes
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectAttempts = Math.floor(this.maxReconnectAttempts / 2); // Reset to half max
                this.attemptReconnect();
            }, extendedDelay);
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
        
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        this.reconnectTimeout = setTimeout(async () => {
            if (!this.connected && this.signalingUrl) {
                try {
                    await this.connect(this.signalingUrl);
                    this.emit('statusChanged', { type: 'info', message: 'WebSocket reconnected successfully' });
                } catch (error) {
                    console.error('Reconnection failed:', error);
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
        this.stopKeepAlive();
        this.stopHealthMonitoring(); // FIX: Stop health monitoring to prevent memory leaks
        
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
            console.log('Sending goodbye message');
            
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
            console.error('Failed to send goodbye message:', error);
        }
    }

    async sendCleanupMessage(targetPeerId) {
        if (!this.connected) return;
        
        try {
            await this.sendSignalingMessage({
                type: 'cleanup',
                data: { 
                    peerId: this.peerId,
                    targetPeerId: targetPeerId,
                    timestamp: Date.now(),
                    reason: 'peer_disconnect'
                },
                targetPeerId: targetPeerId
            });
        } catch (error) {
            console.log(`Cleanup message failed for ${targetPeerId}:`, error.message);
        }
    }

    startKeepAlive() {
        if (this.keepAliveInterval) return;

        console.log('Starting keep-alive pings every', this.keepAliveIntervalMs / 1000, 'seconds');
        
        const keepAliveCallback = () => {
            if (this.connected) {
                // Check if this peer should send the ping
                if (this.shouldSendKeepAlivePing()) {
                    console.log('Sending keep-alive ping (designated peer)');
                    this.sendSignalingMessage({
                        type: 'ping',
                        data: { peerId: this.peerId }
                    }).catch(error => {
                        console.error('Keep-alive ping failed:', error);
                    });
                } else {
                    console.log('Skipping keep-alive ping (not designated peer)');
                }
            }
        };

        if (environmentDetector.isBrowser) {
            this.keepAliveInterval = window.setInterval(keepAliveCallback, this.keepAliveIntervalMs);
        } else {
            this.keepAliveInterval = setInterval(keepAliveCallback, this.keepAliveIntervalMs);
        }
    }

    /**
     * Determine if this peer should send the keep-alive ping.
     * Only one peer should send it when there are multiple peers connected.
     * The peer with the lexicographically smallest ID becomes the designated sender.
     */
    shouldSendKeepAlivePing() {
        // If no mesh reference available, always send (fallback)
        if (!this.mesh) {
            return true;
        }

        // Get all connected peers
        const connectedPeers = this.mesh.connectionManager.getConnectedPeers();
        
        // If no peers connected, always send
        if (connectedPeers.length === 0) {
            return true;
        }

        // Get all peer IDs including this one
        const allPeerIds = [this.peerId, ...connectedPeers.map(peer => peer.peerId)];
        
        // Sort lexicographically and check if this peer is the smallest
        allPeerIds.sort();
        const designatedPeer = allPeerIds[0];
        
        const isDesignated = designatedPeer === this.peerId;
        console.log(`Keep-alive ping decision: ${isDesignated ? 'SEND' : 'SKIP'} (this: ${this.peerId.substring(0, 8)}, designated: ${designatedPeer.substring(0, 8)}, total peers: ${allPeerIds.length})`);
        
        return isDesignated;
    }

    stopKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
            console.log('Stopped keep-alive pings');
        }
    }

    startHealthMonitoring() {
        if (this.healthCheckInterval) return;

        console.log('Starting connection health monitoring');
        
        const healthCheckCallback = () => {
            // Check WebSocket state first
            if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
                console.warn('WebSocket is not in OPEN state:', this.websocket?.readyState);
                this.handleUnhealthyConnection();
                return;
            }

            if (this.connected) {
                const now = Date.now();
                
                // Only check for pong timeout if we have a pending ping
                if (this.pingTimeout) {
                    // There's already a ping waiting for pong, don't send another
                    console.log('Ping already pending, waiting for pong...');
                    return;
                }
                
                // Check if we have an old pong that indicates connection issues
                if (this.lastPingTime && this.lastPongTime && 
                    (this.lastPingTime > this.lastPongTime) && 
                    (now - this.lastPingTime > this.connectionQualityTimeout)) {
                    console.warn('Connection unhealthy - ping/pong timeout');
                    this.handleUnhealthyConnection();
                    return;
                }
                
                // Send health ping
                this.sendHealthPing();
            }
        };

        if (environmentDetector.isBrowser) {
            this.healthCheckInterval = window.setInterval(healthCheckCallback, 30000);
        } else {
            this.healthCheckInterval = setInterval(healthCheckCallback, 30000);
        }
    }

    stopHealthMonitoring() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            console.log('Stopped connection health monitoring');
        }
        
        if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
            this.pingTimeout = null;
        }
    }

    sendHealthPing() {
        if (!this.isConnected()) return;

        try {
            this.lastPingTime = Date.now();
            
            // Set timeout for pong response
            if (this.pingTimeout) {
                clearTimeout(this.pingTimeout);
            }
            
            this.pingTimeout = setTimeout(() => {
                console.warn('Health ping timeout - connection may be unhealthy');
                this.handleUnhealthyConnection();
            }, this.connectionQualityTimeout);

            // Send ping as a regular message (server will handle it)
            this.websocket.send(JSON.stringify({
                type: 'ping',
                data: { peerId: this.peerId, timestamp: this.lastPingTime }
            }));
            
            console.log('Sent health ping');
        } catch (error) {
            console.error('Failed to send health ping:', error);
            this.handleUnhealthyConnection();
        }
    }

    handlePong() {
        this.lastPongTime = Date.now();
        
        if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
            this.pingTimeout = null;
        }
        
        console.log('Received pong - connection healthy');
    }

    handleUnhealthyConnection() {
        console.warn('Detected unhealthy WebSocket connection, forcing reconnection');
        this.emit('statusChanged', { type: 'warning', message: 'Connection health degraded - reconnecting...' });
        
        // Force close and reconnect
        this.connected = false;
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.close(3000, 'Health check failed'); // Use valid close code 3000-4999
        }
        
        if (!this.isReconnecting) {
            this.attemptReconnect();
        }
    }

    forceHealthCheck() {
        if (!this.isConnected()) {
            console.log('Connection not healthy, triggering reconnection');
            if (!this.isReconnecting) {
                this.attemptReconnect();
            }
            return false;
        }
        
        this.sendHealthPing();
        return true;
    }

    /**
     * Force an immediate keep-alive ping check when peer topology changes.
     * This ensures quick takeover when the designated ping sender disconnects.
     */
    triggerKeepAlivePingCheck() {
        if (!this.connected) return;
        
        if (this.shouldSendKeepAlivePing()) {
            console.log('Topology changed - sending immediate keep-alive ping as new designated peer');
            this.sendSignalingMessage({
                type: 'ping',
                data: { peerId: this.peerId }
            }).catch(error => {
                console.error('Immediate keep-alive ping failed:', error);
            });
        } else {
            console.log('Topology changed - not designated for keep-alive pings');
        }
    }

    getConnectionStats() {
        return {
            connected: this.connected,
            isReconnecting: this.isReconnecting,
            reconnectAttempts: this.reconnectAttempts,
            lastPingTime: this.lastPingTime,
            lastPongTime: this.lastPongTime,
            websocketState: this.websocket ? this.websocket.readyState : 'not created'
        };
    }
}
