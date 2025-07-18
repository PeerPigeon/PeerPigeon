// PeerPigeon WebSocket Server - Node.js module
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { EventEmitter } from 'events';

/**
 * PeerPigeon WebSocket signaling server
 * Can be used programmatically or as a standalone server
 */
export class PeerPigeonServer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.port = options.port || 3000;
        this.host = options.host || 'localhost';
        this.maxConnections = options.maxConnections || 1000;
        this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
        this.peerTimeout = options.peerTimeout || 300000; // 5 minutes
        this.corsOrigin = options.corsOrigin || '*';
        this.maxMessageSize = options.maxMessageSize || 1048576; // 1MB
        
        this.httpServer = null;
        this.wss = null;
        this.connections = new Map(); // peerId -> WebSocket
        this.peerData = new Map(); // peerId -> peer info
        this.isRunning = false;
        this.cleanupTimer = null;
    }

    /**
     * Start the WebSocket server
     */
    async start() {
        if (this.isRunning) {
            throw new Error('Server is already running');
        }

        return new Promise((resolve, reject) => {
            try {
                // Create HTTP server
                this.httpServer = createServer((req, res) => {
                    // Handle CORS preflight
                    if (req.method === 'OPTIONS') {
                        res.writeHead(200, {
                            'Access-Control-Allow-Origin': this.corsOrigin,
                            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                        });
                        res.end();
                        return;
                    }

                    // Health check endpoint
                    if (req.url === '/health') {
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': this.corsOrigin
                        });
                        res.end(JSON.stringify({
                            status: 'healthy',
                            timestamp: new Date().toISOString(),
                            uptime: process.uptime(),
                            connections: this.connections.size,
                            peers: this.peerData.size,
                            memory: process.memoryUsage()
                        }));
                        return;
                    }

                    // Default response
                    res.writeHead(200, {
                        'Content-Type': 'text/plain',
                        'Access-Control-Allow-Origin': this.corsOrigin
                    });
                    res.end('PeerPigeon WebSocket Signaling Server');
                });

                // Create WebSocket server
                this.wss = new WebSocketServer({ 
                    server: this.httpServer,
                    maxPayload: this.maxMessageSize
                });

                this.setupWebSocketHandlers();

                // Start HTTP server
                this.httpServer.listen(this.port, this.host, () => {
                    this.isRunning = true;
                    this.startCleanupTimer();
                    
                    console.log(`🚀 PeerPigeon WebSocket server started on ws://${this.host}:${this.port}`);
                    console.log(`📊 Max connections: ${this.maxConnections}`);
                    console.log(`🧹 Cleanup interval: ${this.cleanupInterval}ms`);
                    console.log(`⏰ Peer timeout: ${this.peerTimeout}ms`);
                    
                    this.emit('started', { host: this.host, port: this.port });
                    resolve();
                });

                this.httpServer.on('error', (error) => {
                    console.error('❌ HTTP server error:', error);
                    this.emit('error', error);
                    reject(error);
                });

            } catch (error) {
                console.error('❌ Failed to start server:', error);
                reject(error);
            }
        });
    }

    /**
     * Stop the WebSocket server
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }

        return new Promise((resolve) => {
            console.log('🛑 Stopping PeerPigeon WebSocket server...');
            
            // Stop cleanup timer
            if (this.cleanupTimer) {
                clearInterval(this.cleanupTimer);
                this.cleanupTimer = null;
            }

            // Close all WebSocket connections
            for (const [peerId, ws] of this.connections) {
                try {
                    ws.close(1000, 'Server shutting down');
                } catch (error) {
                    console.error(`Error closing connection for ${peerId}:`, error);
                }
            }

            // Close WebSocket server
            if (this.wss) {
                this.wss.close(() => {
                    console.log('✅ WebSocket server closed');
                    
                    // Close HTTP server
                    if (this.httpServer) {
                        this.httpServer.close(() => {
                            console.log('✅ HTTP server closed');
                            this.isRunning = false;
                            this.emit('stopped');
                            resolve();
                        });
                    } else {
                        this.isRunning = false;
                        this.emit('stopped');
                        resolve();
                    }
                });
            } else {
                this.isRunning = false;
                this.emit('stopped');
                resolve();
            }
        });
    }

    /**
     * Setup WebSocket connection handlers
     */
    setupWebSocketHandlers() {
        this.wss.on('connection', (ws, req) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const peerId = url.searchParams.get('peerId');
            
            // Validate peer ID
            if (!peerId || !/^[a-fA-F0-9]{40}$/.test(peerId)) {
                console.log('❌ Invalid peer ID, closing connection');
                ws.close(1008, 'Invalid peerId format');
                return;
            }

            // Check connection limit
            if (this.connections.size >= this.maxConnections) {
                console.log('❌ Maximum connections reached, closing connection');
                ws.close(1008, 'Maximum connections reached');
                return;
            }

            // Store connection
            this.connections.set(peerId, ws);
            this.peerData.set(peerId, {
                peerId,
                connectedAt: Date.now(),
                lastActivity: Date.now(),
                remoteAddress: req.socket.remoteAddress
            });

            console.log(`✅ Peer connected: ${peerId.substring(0, 8)}... (${this.connections.size} total)`);
            this.emit('peerConnected', { peerId, totalConnections: this.connections.size });

            // Handle incoming messages
            ws.on('message', (data) => {
                try {
                    this.handleMessage(peerId, data);
                } catch (error) {
                    console.error(`❌ Error handling message from ${peerId.substring(0, 8)}...:`, error);
                }
            });

            // Handle connection close
            ws.on('close', (code, reason) => {
                this.handleDisconnection(peerId, code, reason);
            });

            // Handle connection error
            ws.on('error', (error) => {
                console.error(`❌ WebSocket error for ${peerId.substring(0, 8)}...:`, error);
                this.handleDisconnection(peerId, 1006, 'WebSocket error');
            });

            // Send connected confirmation
            this.sendToConnection(ws, {
                type: 'connected',
                data: { peerId },
                fromPeerId: 'system',
                timestamp: Date.now()
            });
        });

        this.wss.on('error', (error) => {
            console.error('❌ WebSocket server error:', error);
            this.emit('error', error);
        });
    }

    /**
     * Handle incoming messages from peers
     */
    handleMessage(peerId, data) {
        // Update last activity
        const peerInfo = this.peerData.get(peerId);
        if (peerInfo) {
            peerInfo.lastActivity = Date.now();
        }

        let message;
        try {
            message = JSON.parse(data.toString());
        } catch (error) {
            console.error(`❌ Invalid JSON from ${peerId.substring(0, 8)}...:`, error);
            return;
        }

        // Log message type
        console.log(`📨 Message from ${peerId.substring(0, 8)}...: ${message.type}`);

        switch (message.type) {
            case 'announce':
                this.handleAnnounce(peerId, message);
                break;
            case 'goodbye':
                this.handleGoodbye(peerId, message);
                break;
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                this.handleSignaling(peerId, message);
                break;
            case 'ping':
                this.handlePing(peerId, message);
                break;
            case 'cleanup':
                this.handleCleanup(peerId, message);
                break;
            default:
                console.log(`❓ Unknown message type from ${peerId.substring(0, 8)}...: ${message.type}`);
        }
    }

    /**
     * Handle peer announcement
     */
    handleAnnounce(peerId, message) {
        console.log(`📢 Peer announced: ${peerId.substring(0, 8)}...`);
        
        // Update peer data
        const peerInfo = this.peerData.get(peerId);
        if (peerInfo) {
            peerInfo.announced = true;
            peerInfo.announcedAt = Date.now();
        }

        // Notify other peers about this peer
        this.broadcastToOthers(peerId, {
            type: 'peer-discovered',
            data: {
                peerId,
                timestamp: Date.now(),
                ...message.data
            },
            fromPeerId: 'system',
            timestamp: Date.now()
        });

        this.emit('peerAnnounced', { peerId });
    }

    /**
     * Handle peer goodbye
     */
    handleGoodbye(peerId, message) {
        console.log(`👋 Peer goodbye: ${peerId.substring(0, 8)}...`);
        
        // Notify other peers about disconnection
        this.broadcastToOthers(peerId, {
            type: 'peer-disconnected',
            data: {
                peerId,
                reason: message.data?.reason || 'goodbye',
                timestamp: Date.now()
            },
            fromPeerId: 'system',
            timestamp: Date.now()
        });

        // Remove peer
        this.removePeer(peerId);
        this.emit('peerGoodbye', { peerId });
    }

    /**
     * Handle WebRTC signaling messages
     */
    handleSignaling(peerId, message) {
        const targetPeerId = message.targetPeerId;
        if (!targetPeerId) {
            console.log(`❌ No target peer ID in signaling message from ${peerId.substring(0, 8)}...`);
            return;
        }

        const targetConnection = this.connections.get(targetPeerId);
        if (!targetConnection) {
            console.log(`❌ Target peer ${targetPeerId.substring(0, 8)}... not found for signaling`);
            return;
        }

        // Forward signaling message to target peer
        this.sendToConnection(targetConnection, {
            ...message,
            fromPeerId: peerId,
            timestamp: Date.now()
        });

        console.log(`🔄 Forwarded ${message.type} from ${peerId.substring(0, 8)}... to ${targetPeerId.substring(0, 8)}...`);
    }

    /**
     * Handle ping messages
     */
    handlePing(peerId, message) {
        const connection = this.connections.get(peerId);
        if (connection) {
            this.sendToConnection(connection, {
                type: 'pong',
                data: { timestamp: Date.now() },
                fromPeerId: 'system',
                targetPeerId: peerId,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Handle cleanup messages
     */
    handleCleanup(peerId, message) {
        console.log(`🧹 Cleanup request from ${peerId.substring(0, 8)}...`);
        // Cleanup is handled by the cleanup timer
        // This is just for logging purposes
    }

    /**
     * Handle peer disconnection
     */
    handleDisconnection(peerId, code, reason) {
        console.log(`❌ Peer disconnected: ${peerId.substring(0, 8)}... (code: ${code}, reason: ${reason})`);
        
        // Notify other peers about disconnection
        this.broadcastToOthers(peerId, {
            type: 'peer-disconnected',
            data: {
                peerId,
                reason: reason?.toString() || 'disconnected',
                timestamp: Date.now()
            },
            fromPeerId: 'system',
            timestamp: Date.now()
        });

        // Remove peer
        this.removePeer(peerId);
        this.emit('peerDisconnected', { peerId, code, reason, totalConnections: this.connections.size });
    }

    /**
     * Remove peer from server
     */
    removePeer(peerId) {
        this.connections.delete(peerId);
        this.peerData.delete(peerId);
        console.log(`🗑️ Removed peer: ${peerId.substring(0, 8)}... (${this.connections.size} remaining)`);
    }

    /**
     * Send message to specific connection
     */
    sendToConnection(connection, message) {
        if (connection.readyState === connection.OPEN) {
            try {
                connection.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error('❌ Failed to send message:', error);
                return false;
            }
        }
        return false;
    }

    /**
     * Broadcast message to all peers except the sender
     */
    broadcastToOthers(senderPeerId, message) {
        let sentCount = 0;
        for (const [peerId, connection] of this.connections) {
            if (peerId !== senderPeerId) {
                if (this.sendToConnection(connection, {
                    ...message,
                    targetPeerId: peerId
                })) {
                    sentCount++;
                }
            }
        }
        console.log(`📡 Broadcast to ${sentCount} peers`);
        return sentCount;
    }

    /**
     * Start cleanup timer
     */
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.performCleanup();
        }, this.cleanupInterval);
    }

    /**
     * Perform cleanup of inactive connections
     */
    performCleanup() {
        const now = Date.now();
        const disconnectedPeers = [];

        for (const [peerId, peerInfo] of this.peerData) {
            if (now - peerInfo.lastActivity > this.peerTimeout) {
                console.log(`🧹 Cleaning up inactive peer: ${peerId.substring(0, 8)}...`);
                
                const connection = this.connections.get(peerId);
                if (connection) {
                    try {
                        connection.close(1000, 'Inactive timeout');
                    } catch (error) {
                        console.error(`Error closing inactive connection for ${peerId}:`, error);
                    }
                }
                
                disconnectedPeers.push(peerId);
            }
        }

        // Remove disconnected peers
        disconnectedPeers.forEach(peerId => {
            this.removePeer(peerId);
        });

        if (disconnectedPeers.length > 0) {
            console.log(`🧹 Cleaned up ${disconnectedPeers.length} inactive peers`);
        }
    }

    /**
     * Get server statistics
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            connections: this.connections.size,
            peers: this.peerData.size,
            maxConnections: this.maxConnections,
            uptime: this.isRunning ? Date.now() - this.startTime : 0,
            host: this.host,
            port: this.port
        };
    }

    /**
     * Get list of connected peers
     */
    getPeers() {
        return Array.from(this.peerData.values());
    }
}

// For backwards compatibility and standalone usage
export default PeerPigeonServer;
