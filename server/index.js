// PeerPigeon WebSocket Server - Node.js module
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { EventEmitter } from 'events';
import { URL } from 'url';
import { PeerPigeonMesh } from '../src/PeerPigeonMesh.js';

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
        this.cleanupInterval = options.cleanupInterval || 30000; // 30 seconds
        this.peerTimeout = options.peerTimeout || 300000; // 5 minutes
        this.corsOrigin = options.corsOrigin || '*';
        this.maxMessageSize = options.maxMessageSize || 1048576; // 1MB
        this.maxPortRetries = options.maxPortRetries || 10; // Try up to 10 ports
        this.verboseLogging = options.verboseLogging === true; // Default false, set true to enable verbose logs
        
                
        // Hub configuration
        this.isHub = options.isHub || false; // Whether this server is a hub
        this.hubMeshNamespace = options.hubMeshNamespace || 'pigeonhub-mesh'; // Reserved namespace for hubs (default: 'pigeonhub-mesh')
        this.bootstrapHubs = options.bootstrapHubs || []; // URIs of bootstrap hubs to connect to
        this.autoConnect = options.autoConnect !== false; // Auto-connect to bootstrap hubs (default: true)
        this.reconnectInterval = options.reconnectInterval || 5000; // Reconnect interval in ms
        this.maxReconnectAttempts = options.maxReconnectAttempts || 10; // Max reconnection attempts
        this.hubMeshMaxPeers = options.hubMeshMaxPeers || 3; // Max P2P connections in hub mesh (for partial mesh)
        this.hubMeshMinPeers = options.hubMeshMinPeers || 2; // Min P2P connections in hub mesh
        this.meshMigrationDelay = options.meshMigrationDelay || 10000; // Delay before closing WS connections after mesh is ready (10s)
        
        // Generate hub peer ID if this is a hub
        this.hubPeerId = options.hubPeerId || (this.isHub ? this.generatePeerId() : null);

        this.httpServer = null;
        this.wss = null;
        this.connections = new Map(); // peerId -> WebSocket
        this.peerData = new Map(); // peerId -> peer info
        this.networkPeers = new Map(); // networkName -> Set of peerIds
        this.hubs = new Map(); // peerId -> hub info (for peers identified as hubs)
        this.bootstrapConnections = new Map(); // bootstrapUri -> connection info
        this.isRunning = false;
        this.cleanupTimer = null;
        this.startTime = null;
        
        // Hub mesh P2P properties
        this.hubMesh = null; // PeerPigeonMesh instance for hub-to-hub P2P connections
        this.hubMeshReady = false; // Whether the P2P mesh is established
        this.hubMeshPeers = new Map(); // hubPeerId -> { p2pConnected: boolean, wsConnection: WebSocket }
        this.migratedToP2P = new Set(); // Set of hub peer IDs that have migrated from WS to P2P
        this.migrationTimer = null; // Timer for WS disconnection after mesh establishment
    }

    /**
     * Validate peer ID format
     */
    validatePeerId(peerId) {
        return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
    }

    /**
     * Generate a random peer ID (40 hex characters)
     */
    generatePeerId() {
        // Generate random hex string
        const chars = '0123456789abcdef';
        let peerId = '';
        for (let i = 0; i < 40; i++) {
            peerId += chars[Math.floor(Math.random() * 16)];
        }
        return peerId;
    }

    /**
     * Check if a peer is registered as a hub
     */
    isPeerHub(peerId) {
        return this.hubs.has(peerId);
    }

    /**
     * Register a peer as a hub
     */
    registerHub(peerId, hubInfo = {}) {
        this.hubs.set(peerId, {
            peerId,
            registeredAt: Date.now(),
            lastActivity: Date.now(),
            ...hubInfo
        });
        console.log(`🏢 Registered hub: ${peerId.substring(0, 8)}... (${this.hubs.size} total hubs)`);
        this.emit('hubRegistered', { peerId, totalHubs: this.hubs.size });
    }

    /**
     * Unregister a hub
     */
    unregisterHub(peerId) {
        if (this.hubs.delete(peerId)) {
            console.log(`🏢 Unregistered hub: ${peerId.substring(0, 8)}... (${this.hubs.size} remaining hubs)`);
            this.emit('hubUnregistered', { peerId, totalHubs: this.hubs.size });
        }
    }

    /**
     * Get all connected hubs
     */
    getConnectedHubs(excludePeerId = null) {
        const hubList = [];
        for (const [peerId, hubInfo] of this.hubs) {
            if (peerId !== excludePeerId && this.connections.has(peerId)) {
                hubList.push({ peerId, ...hubInfo });
            }
        }
        return hubList;
    }

    /**
     * Find closest peers using XOR distance
     */
    findClosestPeers(targetPeerId, allPeerIds, maxPeers = 3) {
        if (!targetPeerId || !allPeerIds || allPeerIds.length === 0) {
            return [];
        }

        // XOR distance calculation (simplified)
        const distances = allPeerIds.map(peerId => {
            let distance = 0;
            const minLength = Math.min(targetPeerId.length, peerId.length);

            for (let i = 0; i < minLength; i++) {
                const xor = parseInt(targetPeerId[i], 16) ^ parseInt(peerId[i], 16);
                distance += xor;
            }

            return { peerId, distance };
        });

        // Sort by distance and return closest peers
        distances.sort((a, b) => a.distance - b.distance);
        return distances.slice(0, maxPeers).map(item => item.peerId);
    }

    /**
     * Get active peers in a network
     */
    getActivePeers(excludePeerId = null, networkName = 'global') {
        const peers = [];
        const stalePeers = [];

        // Get peers for the specific network
        const networkPeerSet = this.networkPeers.get(networkName);
        if (!networkPeerSet) {
            return peers; // No peers in this network
        }

        for (const peerId of networkPeerSet) {
            if (peerId !== excludePeerId) {
                const connection = this.connections.get(peerId);
                if (connection && connection.readyState === connection.OPEN) {
                    peers.push(peerId);
                } else {
                    // Mark stale connections for cleanup
                    stalePeers.push(peerId);
                }
            }
        }

        // Clean up stale connections
        stalePeers.forEach(peerId => {
            if (this.verboseLogging) {
                console.log(`🧹 Cleaning up stale connection: ${peerId.substring(0, 8)}...`);
            }
            this.cleanupPeer(peerId);
        });

        return peers;
    }

    /**
     * Try to start server on a specific port
     */
    async tryPort(port, maxRetries = null) {
        maxRetries = maxRetries !== null ? maxRetries : this.maxPortRetries;
        
        return new Promise((resolve, reject) => {
            const attemptPort = (currentPort, retriesLeft) => {
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
                            isHub: this.isHub,
                            connections: this.connections.size,
                            peers: this.peerData.size,
                            hubs: this.hubs.size,
                            networks: this.networkPeers.size,
                            memory: process.memoryUsage()
                        }));
                        return;
                    }

                    // Hubs endpoint - list connected hubs
                    if (req.url === '/hubs') {
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': this.corsOrigin
                        });
                        res.end(JSON.stringify({
                            timestamp: new Date().toISOString(),
                            totalHubs: this.hubs.size,
                            hubs: this.getConnectedHubs()
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

                // Handle port in use error
                const errorHandler = (error) => {
                    if (error.code === 'EADDRINUSE') {
                        console.log(`⚠️  Port ${currentPort} is already in use`);
                        
                        // Clean up failed server
                        this.httpServer.removeAllListeners();
                        if (this.wss) {
                            this.wss.close();
                        }
                        this.httpServer = null;
                        this.wss = null;

                        if (retriesLeft > 0) {
                            const nextPort = currentPort + 1;
                            console.log(`🔄 Trying port ${nextPort}...`);
                            attemptPort(nextPort, retriesLeft - 1);
                        } else {
                            reject(new Error(`Failed to find available port after ${maxRetries} attempts (tried ${port}-${currentPort})`));
                        }
                    } else {
                        console.error('❌ HTTP server error:', error);
                        this.emit('error', error);
                        reject(error);
                    }
                };

                this.httpServer.once('error', errorHandler);

                // Start HTTP server
                this.httpServer.listen(currentPort, this.host, () => {
                    // Remove error handler after successful start
                    this.httpServer.removeListener('error', errorHandler);
                    
                    // Update port to the actual port used
                    this.port = currentPort;
                    this.isRunning = true;
                    this.startTime = Date.now();
                    this.startCleanupTimer();

                    if (currentPort !== port) {
                        console.log(`✅ Port ${port} was in use, using port ${currentPort} instead`);
                    }

                    const serverType = this.isHub ? '🏢 PeerPigeon Hub Server' : '🚀 PeerPigeon WebSocket Server';
                    console.log(`${serverType} started on ws://${this.host}:${this.port}`);
                    if (this.isHub) {
                        console.log(`🌐 Hub mesh namespace: ${this.hubMeshNamespace}`);
                    }
                    console.log(`📊 Max connections: ${this.maxConnections}`);
                    console.log(`🧹 Cleanup interval: ${this.cleanupInterval}ms`);
                    console.log(`⏰ Peer timeout: ${this.peerTimeout}ms`);

                    this.emit('started', { host: this.host, port: this.port });
                    resolve({ host: this.host, port: this.port });

                    // Add persistent error handler after successful start
                    this.httpServer.on('error', (error) => {
                        console.error('❌ HTTP server error:', error);
                        this.emit('error', error);
                    });
                });
            };

            attemptPort(port, maxRetries);
        });
    }

    /**
     * Start the WebSocket server
     */
    async start() {
        if (this.isRunning) {
            throw new Error('Server is already running');
        }

        try {
            const result = await this.tryPort(this.port);
            
            // If this is a hub, initialize hub mesh AFTER server is running, then connect to bootstrap hubs
            if (this.isHub && this.autoConnect) {
                // Give the server a moment to be fully ready for connections
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                await this.initializeHubMesh();
                await this.connectToBootstrapHubs();
            }
            
            return result;
        } catch (error) {
            console.error('❌ Failed to start server:', error);
            throw error;
        }
    }

    /**
     * Initialize the hub P2P mesh
     */
    async initializeHubMesh() {
        if (!this.isHub || this.hubMesh) {
            return;
        }

        console.log(`🔗 Initializing hub P2P mesh on namespace: ${this.hubMeshNamespace}`);
        console.log(`   Hub Peer ID: ${this.hubPeerId.substring(0, 8)}...`);
        console.log(`   Max P2P connections: ${this.hubMeshMaxPeers} (partial mesh with XOR routing)`);

        // Create PeerPigeonMesh instance for hub-to-hub connections
        this.hubMesh = new PeerPigeonMesh({
            peerId: this.hubPeerId,
            networkName: this.hubMeshNamespace,
            maxPeers: this.hubMeshMaxPeers,
            minPeers: this.hubMeshMinPeers,
            autoConnect: true,
            autoDiscovery: true,
            xorRouting: true, // Use XOR routing for partial mesh
            enableWebDHT: false, // Don't need DHT for hub mesh
            enableCrypto: false // Hubs don't need encryption between themselves
        });

        // Initialize the mesh (required before connecting)
        await this.hubMesh.init();

        // Set up hub mesh event handlers
        this.setupHubMeshEventHandlers();

        // Connect to local signaling server (ourselves)
        // Use 127.0.0.1 for localhost to avoid potential DNS issues
        const host = this.host === '0.0.0.0' ? '127.0.0.1' : this.host;
        const signalingUrl = `ws://${host}:${this.port}`;
        
        console.log(`🔌 Connecting hub mesh to local signaling: ${signalingUrl}`);
        await this.hubMesh.connect(signalingUrl);

        console.log(`✅ Hub mesh connected to local signaling`);
    }

    /**
     * Set up event handlers for the hub P2P mesh
     */
    setupHubMeshEventHandlers() {
        if (!this.hubMesh) return;

        // Track P2P connections to other hubs
        this.hubMesh.addEventListener('peerConnected', (event) => {
            const hubPeerId = event.peerId;
            console.log(`🔗 P2P connection established with hub: ${hubPeerId.substring(0, 8)}...`);
            
            // Update hub peer tracking
            if (!this.hubMeshPeers.has(hubPeerId)) {
                this.hubMeshPeers.set(hubPeerId, { p2pConnected: false, wsConnection: null });
            }
            const hubInfo = this.hubMeshPeers.get(hubPeerId);
            hubInfo.p2pConnected = true;

            this.emit('hubP2PConnected', { hubPeerId });
            
            // Check if we should migrate to P2P-only
            this.checkMeshReadiness();
        });

        this.hubMesh.addEventListener('peerDisconnected', (event) => {
            const hubPeerId = event.peerId;
            console.log(`🔌 P2P connection lost with hub: ${hubPeerId.substring(0, 8)}...`);
            
            const hubInfo = this.hubMeshPeers.get(hubPeerId);
            if (hubInfo) {
                hubInfo.p2pConnected = false;
            }
            
            this.migratedToP2P.delete(hubPeerId);
            this.emit('hubP2PDisconnected', { hubPeerId });
        });

        // Handle messages from other hubs via P2P
        this.hubMesh.addEventListener('messageReceived', (event) => {
            this.handleHubP2PMessage(event.from, event.data);
        });

        // Track mesh status updates
        this.hubMesh.addEventListener('peersUpdated', () => {
            const connectedCount = this.hubMesh.connectionManager.getConnectedPeers().length;
            console.log(`📊 Hub mesh status: ${connectedCount} P2P connections active`);
            this.checkMeshReadiness();
        });
    }

    /**
     * Check if the hub mesh is ready and trigger migration from WS to P2P
     */
    checkMeshReadiness() {
        if (!this.isHub || !this.hubMesh || this.hubMeshReady) {
            return;
        }

        const connectedP2PPeers = this.hubMesh.connectionManager.getConnectedPeers().length;
        const discoveredHubs = this.hubs.size;

        // Consider mesh ready if we have P2P connections to at least minPeers hubs
        // OR if there are fewer than minPeers total hubs available
        const isReady = connectedP2PPeers >= this.hubMeshMinPeers || 
                       (discoveredHubs < this.hubMeshMinPeers && connectedP2PPeers >= discoveredHubs);

        if (isReady && !this.hubMeshReady) {
            this.hubMeshReady = true;
            console.log(`✅ Hub mesh is READY! ${connectedP2PPeers} P2P connections established`);
            console.log(`   Scheduling WebSocket migration in ${this.meshMigrationDelay}ms...`);
            
            this.emit('hubMeshReady', { 
                p2pConnections: connectedP2PPeers, 
                totalHubs: discoveredHubs 
            });

            // Schedule migration from WebSocket to P2P-only
            if (this.migrationTimer) {
                clearTimeout(this.migrationTimer);
            }
            this.migrationTimer = setTimeout(() => {
                this.migrateToP2POnly();
            }, this.meshMigrationDelay);
        }
    }

    /**
     * Migrate from WebSocket connections to P2P-only for hub-to-hub communication
     */
    migrateToP2POnly() {
        if (!this.isHub || !this.hubMesh) {
            return;
        }

        console.log(`🔄 MIGRATING to P2P-only hub mesh...`);
        
        const p2pConnectedHubs = this.hubMesh.connectionManager.getConnectedPeers();
        let migratedCount = 0;
        let skippedCount = 0;

        for (const hubPeerId of p2pConnectedHubs) {
            // Check if this hub has both WS and P2P connections
            const hubInfo = this.hubMeshPeers.get(hubPeerId);
            if (!hubInfo || !hubInfo.p2pConnected) {
                continue;
            }

            // Check if we have a direct WebSocket connection to this hub (incoming)
            const directWsConnection = this.connections.get(hubPeerId);
            if (directWsConnection && directWsConnection.readyState === WebSocket.OPEN) {
                console.log(`🔌 Closing direct WebSocket to hub ${hubPeerId.substring(0, 8)}... (P2P active)`);
                
                try {
                    directWsConnection.close(1000, 'Migrated to P2P mesh');
                    this.migratedToP2P.add(hubPeerId);
                    migratedCount++;
                } catch (error) {
                    console.error(`❌ Error closing WebSocket for hub ${hubPeerId.substring(0, 8)}...:`, error);
                }
            } else {
                skippedCount++;
            }
        }

        // Also close bootstrap WebSocket connections if we have P2P to those hubs
        console.log(`🔌 Closing bootstrap WebSocket connections (migrating to P2P)...`);
        let bootstrapClosed = 0;
        
        for (const [uri, connInfo] of this.bootstrapConnections) {
            if (connInfo.connected && connInfo.ws && connInfo.ws.readyState === WebSocket.OPEN) {
                // Check if we have P2P connection (we may not know the exact peer ID for bootstrap)
                // Close bootstrap connections if we have sufficient P2P connections
                if (p2pConnectedHubs.length >= this.hubMeshMinPeers) {
                    console.log(`🔌 Closing bootstrap WebSocket: ${uri} (sufficient P2P connections)`);
                    try {
                        connInfo.ws.close(1000, 'Migrated to P2P mesh');
                        connInfo.connected = false;
                        bootstrapClosed++;
                    } catch (error) {
                        console.error(`❌ Error closing bootstrap WebSocket ${uri}:`, error);
                    }
                }
            }
        }

        console.log(`✅ Migration complete:`);
        console.log(`   - ${migratedCount} direct hub WebSocket connections closed`);
        console.log(`   - ${bootstrapClosed} bootstrap WebSocket connections closed`);
        console.log(`   - ${skippedCount} connections already closed or non-existent`);
        console.log(`🌐 Hub mesh now operating on P2P (${p2pConnectedHubs.length} connections)`);
        
        this.emit('hubMeshMigrated', { 
            migratedCount: migratedCount + bootstrapClosed,
            p2pConnections: p2pConnectedHubs.length 
        });
    }

    /**
     * Handle P2P messages from other hubs
     */
    handleHubP2PMessage(fromHubPeerId, message) {
        console.log(`📨 P2P message from hub ${fromHubPeerId.substring(0, 8)}...: ${message.type || 'unknown'}`);
        
        // Handle signaling relay through P2P mesh
        if (message.type === 'client-signal-relay') {
            this.handleClientSignalRelay(fromHubPeerId, message);
            return;
        }

        // Handle peer announcements through P2P mesh
        if (message.type === 'peer-announce-relay') {
            this.handlePeerAnnounceRelay(fromHubPeerId, message);
            return;
        }

        // Default: log unknown message types
        console.log(`⚠️  Unknown P2P message type from hub: ${message.type}`);
    }

    /**
     * Handle client signaling relay through P2P hub mesh
     */
    handleClientSignalRelay(fromHubPeerId, message) {
        const { targetPeerId, signalData } = message;
        
        if (!targetPeerId || !signalData) {
            console.log(`⚠️  Invalid client signal relay from ${fromHubPeerId.substring(0, 8)}...`);
            return;
        }

        // Check if target peer is connected to this hub
        const targetConnection = this.connections.get(targetPeerId);
        if (targetConnection && targetConnection.readyState === WebSocket.OPEN) {
            console.log(`📥 Relaying signal to local client ${targetPeerId.substring(0, 8)}...`);
            this.sendToConnection(targetConnection, signalData);
        } else {
            // Forward to other hubs via P2P if we have more connections
            console.log(`🔄 Client ${targetPeerId.substring(0, 8)}... not local, forwarding to other hubs`);
            this.forwardSignalToHubMesh(targetPeerId, signalData, fromHubPeerId);
        }
    }

    /**
     * Handle peer announcement relay through P2P hub mesh
     */
    handlePeerAnnounceRelay(fromHubPeerId, message) {
        const { peerId, networkName, peerData } = message;
        
        if (!peerId || !networkName) {
            console.log(`⚠️  Invalid peer announce relay from ${fromHubPeerId.substring(0, 8)}...`);
            return;
        }

        console.log(`📣 Peer ${peerId.substring(0, 8)}... announced via hub ${fromHubPeerId.substring(0, 8)}... on network: ${networkName}`);
        
        // Forward to local clients in the same network
        const localPeers = this.getActivePeers(null, networkName);
        localPeers.forEach(localPeerId => {
            const localConnection = this.connections.get(localPeerId);
            if (localConnection) {
                this.sendToConnection(localConnection, {
                    type: 'peer-discovered',
                    data: peerData,
                    networkName,
                    fromPeerId: 'system',
                    targetPeerId: localPeerId,
                    timestamp: Date.now()
                });
            }
        });
    }

    /**
     * Forward signaling message to hub mesh via P2P
     */
    forwardSignalToHubMesh(targetPeerId, signalData, excludeHubPeerId = null) {
        if (!this.hubMesh) {
            return;
        }

        const connectedHubConnections = this.hubMesh.connectionManager.getConnectedPeers();
        const connectedHubs = connectedHubConnections
            .map(conn => conn.peerId)
            .filter(hubId => hubId !== excludeHubPeerId);

        if (connectedHubs.length === 0) {
            console.log(`⚠️  No other hubs available in P2P mesh for forwarding`);
            return;
        }

        const relayMessage = {
            type: 'client-signal-relay',
            targetPeerId,
            signalData,
            timestamp: Date.now()
        };

        // Use XOR routing to find closest hubs
        const closestHubs = this.findClosestPeers(targetPeerId, connectedHubs, 2);
        
        closestHubs.forEach(hubPeerIdObj => {
            const hubPeerId = typeof hubPeerIdObj === 'string' ? hubPeerIdObj : hubPeerIdObj.peerId;
            console.log(`📤 Forwarding signal to hub ${hubPeerId.substring(0, 8)}... via P2P`);
            
            // Get the peer connection and send the message
            const peerConnection = this.hubMesh.connectionManager.peers.get(hubPeerId);
            if (peerConnection && peerConnection.sendMessage) {
                peerConnection.sendMessage(relayMessage);
                console.log(`✅ Sent signal via P2P to hub ${hubPeerId.substring(0, 8)}...`);
            } else {
                console.error(`❌ No peer connection found for hub ${hubPeerId.substring(0, 8)}...`);
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

            // Stop migration timer if running
            if (this.migrationTimer) {
                clearTimeout(this.migrationTimer);
                this.migrationTimer = null;
            }

            // Disconnect hub mesh if this is a hub
            if (this.isHub && this.hubMesh) {
                console.log('🔌 Disconnecting hub P2P mesh...');
                this.hubMesh.disconnect();
                this.hubMesh = null;
                this.hubMeshReady = false;
                this.hubMeshPeers.clear();
                this.migratedToP2P.clear();
            }

            // Disconnect from bootstrap hubs if this is a hub
            if (this.isHub) {
                this.disconnectFromBootstrapHubs();
            }

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
     * Connect to bootstrap hubs
     */
    async connectToBootstrapHubs() {
        if (!this.isHub) {
            console.log('⚠️  Not a hub, skipping bootstrap connections');
            return;
        }

        // If no bootstrap hubs specified, try default port 3000
        let bootstrapUris = this.bootstrapHubs;
        if (!bootstrapUris || bootstrapUris.length === 0) {
            // Don't connect to ourselves
            const defaultPort = 3000;
            if (this.port !== defaultPort) {
                bootstrapUris = [`ws://${this.host}:${defaultPort}`];
                console.log(`🔗 No bootstrap hubs specified, trying default: ws://${this.host}:${defaultPort}`);
            } else {
                console.log('ℹ️  No bootstrap hubs to connect to (running on default port 3000)');
                return;
            }
        }

        console.log(`🔗 Connecting to ${bootstrapUris.length} bootstrap hub(s)...`);

        for (const uri of bootstrapUris) {
            try {
                await this.connectToHub(uri);
            } catch (error) {
                console.error(`❌ Failed to connect to bootstrap hub ${uri}:`, error.message);
            }
        }
    }

    /**
     * Connect to a specific hub
     */
    async connectToHub(uri, attemptNumber = 0) {
        return new Promise((resolve, reject) => {
            try {
                // Parse URI to check if it's our own server
                const url = new URL(uri);
                const hubPort = parseInt(url.port) || 3000;
                const hubHost = url.hostname;

                // Don't connect to ourselves
                if (hubHost === this.host && hubPort === this.port) {
                    console.log(`⚠️  Skipping self-connection to ${uri}`);
                    resolve();
                    return;
                }

                const wsUrl = `${uri}?peerId=${this.hubPeerId}`;
                console.log(`🔗 Connecting to hub: ${uri} (attempt ${attemptNumber + 1})`);

                const ws = new WebSocket(wsUrl);
                
                const connectionInfo = {
                    uri,
                    ws,
                    connected: false,
                    attemptNumber,
                    lastAttempt: Date.now(),
                    reconnectTimer: null
                };

                this.bootstrapConnections.set(uri, connectionInfo);

                ws.on('open', () => {
                    console.log(`✅ Connected to bootstrap hub: ${uri}`);
                    connectionInfo.connected = true;
                    connectionInfo.attemptNumber = 0; // Reset attempt counter on success

                    // Announce this hub on the hub mesh
                    this.announceToHub(ws);
                    
                    this.emit('bootstrapConnected', { uri });
                    resolve();
                });

                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.handleBootstrapMessage(uri, message);
                    } catch (error) {
                        console.error(`❌ Error handling message from ${uri}:`, error);
                    }
                });

                ws.on('close', (code, reason) => {
                    console.log(`🔌 Disconnected from bootstrap hub ${uri} (${code}: ${reason})`)
                    connectionInfo.connected = false;
                    
                    this.emit('bootstrapDisconnected', { uri, code, reason });
                    
                    // Attempt to reconnect
                    if (this.isRunning && attemptNumber < this.maxReconnectAttempts) {
                        connectionInfo.reconnectTimer = setTimeout(() => {
                            console.log(`🔄 Reconnecting to ${uri}...`);
                            this.connectToHub(uri, attemptNumber + 1);
                        }, this.reconnectInterval);
                    } else if (attemptNumber >= this.maxReconnectAttempts) {
                        console.log(`❌ Max reconnection attempts reached for ${uri}`);
                        this.bootstrapConnections.delete(uri);
                    }
                });

                ws.on('error', (error) => {
                    console.error(`❌ WebSocket error for ${uri}:`, error.message);
                    
                    // Only reject on first attempt, otherwise we'll retry
                    if (attemptNumber === 0) {
                        this.bootstrapConnections.delete(uri);
                        reject(error);
                    }
                });

            } catch (error) {
                console.error(`❌ Failed to create connection to ${uri}:`, error);
                reject(error);
            }
        });
    }

    /**
     * Announce this hub to a bootstrap hub
     */
    announceToHub(ws) {
        const announcement = {
            type: 'announce',
            networkName: this.hubMeshNamespace,
            data: {
                isHub: true,
                port: this.port,
                host: this.host,
                capabilities: ['signaling', 'relay'],
                timestamp: Date.now()
            }
        };

        ws.send(JSON.stringify(announcement));
        console.log(`📢 Announced to bootstrap hub on ${this.hubMeshNamespace}`);
        
        // Announce all existing local peers to the bootstrap hub
        this.announceLocalPeersToHub(ws);
    }
    
    /**
     * Announce all local peers to a bootstrap hub (including hub mesh peers for P2P discovery)
     */
    announceLocalPeersToHub(ws) {
        let totalAnnounced = 0;
        
        console.log(`📡 Announcing local peers to bootstrap hub (${this.networkPeers.size} networks)`);
        
        // Iterate through all networks and announce their peers
        for (const [networkName, peerSet] of this.networkPeers) {
            console.log(`   Network '${networkName}': ${peerSet.size} peers`);
            
            for (const peerId of peerSet) {
                const peerData = this.peerData.get(peerId);
                
                // For hub mesh namespace, only announce our own hub mesh client (not other hubs)
                if (networkName === this.hubMeshNamespace && peerId !== this.hubPeerId) {
                    console.log(`   Skipping hub ${peerId.substring(0, 8)}... (not our mesh client)`);
                    continue;
                }
                
                // For other namespaces, skip hub peers
                if (networkName !== this.hubMeshNamespace && peerData?.isHub) {
                    console.log(`   Skipping hub peer ${peerId.substring(0, 8)}... in network ${networkName}`);
                    continue;
                }
                
                // Skip if not connected or not announced
                const connection = this.connections.get(peerId);
                if (!connection || connection.readyState !== WebSocket.OPEN || !peerData?.announced) {
                    console.log(`   Skipping ${peerId.substring(0, 8)}... (not connected or not announced)`);
                    continue;
                }
                
                console.log(`   ✅ Announcing ${peerId.substring(0, 8)}... from network '${networkName}'`);
                
                // Send peer-discovered message to bootstrap hub
                const peerAnnouncement = {
                    type: 'peer-discovered',
                    data: {
                        peerId,
                        isHub: networkName === this.hubMeshNamespace,
                        ...peerData.data
                    },
                    networkName: networkName,
                    fromPeerId: 'system',
                    timestamp: Date.now()
                };
                
                try {
                    ws.send(JSON.stringify(peerAnnouncement));
                    totalAnnounced++;
                } catch (error) {
                    console.error(`❌ Error announcing peer ${peerId.substring(0, 8)}... to bootstrap:`, error.message);
                }
            }
        }
        
        if (totalAnnounced > 0) {
            console.log(`📡 Announced ${totalAnnounced} local peer(s) to bootstrap hub`);
        }
    }
    
    /**
     * Send all local peers to a connected hub (via peerId)
     */
    sendLocalPeersToHub(hubPeerId) {
        const hubConnection = this.connections.get(hubPeerId);
        if (!hubConnection || hubConnection.readyState !== WebSocket.OPEN) {
            console.log(`⚠️  Cannot send peers to hub ${hubPeerId.substring(0, 8)}... - not connected`);
            return;
        }
        
        let totalSent = 0;
        
        // Iterate through all networks and send their peers
        for (const [networkName, peerSet] of this.networkPeers) {
            // Skip the hub mesh namespace
            if (networkName === this.hubMeshNamespace) {
                continue;
            }
            
            for (const peerId of peerSet) {
                const peerData = this.peerData.get(peerId);
                
                // Skip hubs, only send regular peers
                if (peerData?.isHub) {
                    continue;
                }
                
                // Skip if not connected or not announced
                const connection = this.connections.get(peerId);
                if (!connection || connection.readyState !== WebSocket.OPEN || !peerData?.announced) {
                    continue;
                }
                
                // Send peer-discovered message to the hub
                const peerAnnouncement = {
                    type: 'peer-discovered',
                    data: {
                        peerId,
                        isHub: false,
                        ...peerData.data
                    },
                    networkName: networkName,
                    fromPeerId: 'system',
                    targetPeerId: hubPeerId,
                    timestamp: Date.now()
                };
                
                try {
                    this.sendToConnection(hubConnection, peerAnnouncement);
                    totalSent++;
                } catch (error) {
                    console.error(`❌ Error sending peer ${peerId.substring(0, 8)}... to hub:`, error.message);
                }
            }
        }
        
        if (totalSent > 0) {
            console.log(`📡 Sent ${totalSent} local peer(s) to hub ${hubPeerId.substring(0, 8)}...`);
        }
    }

    /**
     * Handle messages from bootstrap hubs
     */
    handleBootstrapMessage(uri, message) {
        const { type, data, fromPeerId, targetPeerId, networkName } = message;

        switch (type) {
            case 'connected':
                console.log(`✅ Bootstrap hub acknowledged connection: ${uri}`);
                break;

            case 'peer-discovered':
                if (data?.isHub) {
                    console.log(`🏢 Discovered hub via bootstrap: ${data.peerId?.substring(0, 8)}...`);
                    this.emit('hubDiscovered', { peerId: data.peerId, via: uri, data });
                    
                    // Forward to our local hub mesh client so it can form P2P connections
                    const discoveredNetwork = networkName || this.hubMeshNamespace;
                    if (discoveredNetwork === this.hubMeshNamespace) {
                        console.log(`📥 Forwarding hub ${data.peerId?.substring(0, 8)}... to local mesh client`);
                        const localPeers = this.getActivePeers(null, discoveredNetwork);
                        localPeers.forEach(localPeerId => {
                            const localConnection = this.connections.get(localPeerId);
                            if (localConnection) {
                                this.sendToConnection(localConnection, {
                                    type: 'peer-discovered',
                                    data,
                                    networkName: discoveredNetwork,
                                    fromPeerId: 'system',
                                    targetPeerId: localPeerId,
                                    timestamp: Date.now()
                                });
                            }
                        });
                    }
                } else if (data?.peerId) {
                    // Regular peer discovered on another hub - notify our local peers in same network
                    const discoveredPeerId = data.peerId;
                    const discoveredNetwork = networkName || 'global';
                    
                    console.log(`📥 Peer ${discoveredPeerId.substring(0, 8)}... discovered on another hub (network: ${discoveredNetwork})`);
                    
                    // Forward to all our local peers in the same network
                    const localPeers = this.getActivePeers(null, discoveredNetwork);
                    localPeers.forEach(localPeerId => {
                        const localConnection = this.connections.get(localPeerId);
                        if (localConnection) {
                            this.sendToConnection(localConnection, {
                                type: 'peer-discovered',
                                data,
                                networkName: discoveredNetwork,
                                fromPeerId: 'system',
                                targetPeerId: localPeerId,
                                timestamp: Date.now()
                            });
                        }
                    });
                }
                break;

            case 'peer-disconnected':
                if (data?.isHub) {
                    console.log(`🏢 Hub disconnected: ${data.peerId?.substring(0, 8)}...`);
                }
                break;

            case 'offer':
            case 'answer':
            case 'ice-candidate':
                // Check if target peer is on this hub
                if (targetPeerId) {
                    const targetConnection = this.connections.get(targetPeerId);
                    if (targetConnection && targetConnection.readyState === WebSocket.OPEN) {
                        // Forward to local peer
                        console.log(`📥 Received ${type} from ${fromPeerId?.substring(0, 8)}... for local peer ${targetPeerId.substring(0, 8)}...`);
                        this.sendToConnection(targetConnection, message);
                    } else {
                        // Not our peer, relay to other bootstrap hubs
                        console.log(`🔄 Relaying ${type} from ${fromPeerId?.substring(0, 8)}... for ${targetPeerId.substring(0, 8)}... (not local)`);
                        for (const [otherUri, connInfo] of this.bootstrapConnections) {
                            if (otherUri !== uri && connInfo.connected && connInfo.ws.readyState === WebSocket.OPEN) {
                                connInfo.ws.send(JSON.stringify(message));
                            }
                        }
                    }
                } else {
                    console.log(`⚠️  Received ${type} without targetPeerId via ${uri}`);
                }
                this.emit('bootstrapSignaling', { type, data, fromPeerId, targetPeerId, uri });
                break;

            case 'pong':
                // Heartbeat response
                break;

            default:
                console.log(`📨 Received ${type} from bootstrap hub ${uri}`);
        }
    }

    /**
     * Disconnect from all bootstrap hubs
     */
    disconnectFromBootstrapHubs() {
        console.log(`🔌 Disconnecting from ${this.bootstrapConnections.size} bootstrap hub(s)...`);
        
        for (const [uri, info] of this.bootstrapConnections) {
            if (info.reconnectTimer) {
                clearTimeout(info.reconnectTimer);
            }
            
            if (info.ws && info.ws.readyState === WebSocket.OPEN) {
                info.ws.close(1000, 'Hub shutting down');
            }
        }
        
        this.bootstrapConnections.clear();
    }

    /**
     * Setup WebSocket connection handlers
     */
    setupWebSocketHandlers() {
        this.wss.on('connection', (ws, req) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const peerId = url.searchParams.get('peerId');

            // Validate peer ID
            if (!peerId || !this.validatePeerId(peerId)) {
                console.log('❌ Invalid peer ID, closing connection');
                ws.close(1008, 'Invalid peerId format');
                return;
            }

            // Check if peerId is already connected
            if (this.connections.has(peerId)) {
                const existingConnection = this.connections.get(peerId);
                if (existingConnection.readyState === existingConnection.OPEN) {
                    console.log(`⚠️  Peer ${peerId.substring(0, 8)}... already connected, closing duplicate`);
                    ws.close(1008, 'Peer already connected');
                    return;
                } else {
                    // Clean up stale connection
                    console.log(`🔄 Replacing stale connection for ${peerId.substring(0, 8)}...`);
                    this.cleanupPeer(peerId);
                }
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
                remoteAddress: req.socket.remoteAddress,
                connected: true
            });

            // Set up connection metadata
            ws.connectedAt = Date.now();

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

        const { type, data: messageData, targetPeerId, networkName, fromPeerId: originalFromPeerId } = message;

        // Log message type
        if (this.verboseLogging) {
            console.log(`📨 Received ${type} from ${peerId.substring(0, 8)}... in network: ${networkName || 'global'}`);
        }

        // Preserve the original fromPeerId if it exists (for relayed messages from other hubs)
        // Otherwise use the peerId of the connection
        const responseMessage = {
            type,
            data: messageData,
            fromPeerId: originalFromPeerId || peerId,
            targetPeerId,
            networkName: networkName || 'global',
            timestamp: Date.now()
        };

        switch (type) {
            case 'announce':
                this.handleAnnounce(peerId, message, responseMessage);
                break;
            case 'goodbye':
                this.handleGoodbye(peerId, message, responseMessage);
                break;
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                this.handleSignaling(peerId, message, responseMessage);
                break;
            case 'peer-discovered':
                // Handle peer discovery from other hubs
                this.handlePeerDiscovered(peerId, message);
                break;
            case 'ping':
                this.handlePing(peerId, message);
                break;
            case 'cleanup':
                this.handleCleanup(peerId, message);
                break;
            default:
                if (this.verboseLogging) {
                    console.log(`⚠️  Ignoring non-signaling message type '${type}' - peers should route their own messages`);
                }
                const connection = this.connections.get(peerId);
                if (connection && connection.readyState === WebSocket.OPEN) {
                    this.sendToConnection(connection, {
                        type: 'error',
                        error: `Signaling server does not route '${type}' messages. Use WebRTC data channels for peer-to-peer communication.`,
                        timestamp: Date.now()
                    });
                }
                break;
        }
    }

    /**
     * Handle peer announcement
     */
    handleAnnounce(peerId, message, responseMessage) {
        // Extract network name from the message
        const peerNetworkName = message.networkName || 'global';
        
        // Detect if this peer is a hub
        const isHub = message.data?.isHub === true || peerNetworkName === this.hubMeshNamespace;
        
        if (this.verboseLogging) {
            if (isHub) {
                console.log(`📢 Hub announced: ${peerId.substring(0, 8)}... in network: ${peerNetworkName}`);
            } else {
                console.log(`📢 Peer announced: ${peerId.substring(0, 8)}... in network: ${peerNetworkName}`);
            }
        }

        // Update peer data with network information
        const peerInfo = this.peerData.get(peerId);
        if (peerInfo) {
            peerInfo.announced = true;
            peerInfo.announcedAt = Date.now();
            peerInfo.networkName = peerNetworkName;
            peerInfo.data = message.data;
            peerInfo.isHub = isHub;
        }

        // Register as hub if applicable
        if (isHub) {
            this.registerHub(peerId, {
                networkName: peerNetworkName,
                data: message.data,
                connectedAt: peerInfo?.connectedAt || Date.now()
            });
            
            // Track WebSocket connection with this hub
            const wsConnection = this.connections.get(peerId);
            if (wsConnection) {
                if (!this.hubMeshPeers.has(peerId)) {
                    this.hubMeshPeers.set(peerId, { p2pConnected: false, wsConnection: null });
                }
                this.hubMeshPeers.get(peerId).wsConnection = wsConnection;
                console.log(`📊 Tracking hub ${peerId.substring(0, 8)}... WebSocket connection for migration`);
            }
            
            // When a new hub announces itself, send it all our local peers
            if (this.isHub) {
                console.log(`📡 New hub connected, sending our local peers to ${peerId.substring(0, 8)}...`);
                this.sendLocalPeersToHub(peerId);
            }
        }

        // Add peer to network tracking
        if (!this.networkPeers.has(peerNetworkName)) {
            this.networkPeers.set(peerNetworkName, new Set());
        }
        this.networkPeers.get(peerNetworkName).add(peerId);

        // If this is a hub, broadcast this peer to ALL other connected hubs (both bootstrap and incoming)
        if (this.isHub && !isHub) {
            const connectedHubs = [];
            
            // 1. Add outgoing bootstrap connections
            for (const [uri, connInfo] of this.bootstrapConnections) {
                if (connInfo.connected && connInfo.ws.readyState === WebSocket.OPEN) {
                    connectedHubs.push({ type: 'bootstrap', ws: connInfo.ws, id: uri });
                }
            }
            
            // 2. Add incoming hub connections (hubs that connected to us)
            for (const [hubPeerId, hubInfo] of this.hubs) {
                // Skip self and the announcing hub
                if (hubPeerId === this.hubPeerId || hubPeerId === peerId) {
                    continue;
                }
                const hubConnection = this.connections.get(hubPeerId);
                if (hubConnection && hubConnection.readyState === WebSocket.OPEN) {
                    connectedHubs.push({ type: 'incoming', ws: hubConnection, id: hubPeerId });
                }
            }
            
            if (connectedHubs.length > 0) {
                console.log(`📡 Broadcasting peer ${peerId.substring(0, 8)}... to ${connectedHubs.length} connected hub(s)`);
                const peerAnnouncement = {
                    type: 'peer-discovered',
                    data: {
                        peerId,
                        isHub: false,
                        ...message.data
                    },
                    networkName: peerNetworkName,
                    fromPeerId: 'system',
                    timestamp: Date.now()
                };
                
                for (const hub of connectedHubs) {
                    try {
                        if (hub.type === 'bootstrap') {
                            hub.ws.send(JSON.stringify(peerAnnouncement));
                        } else {
                            this.sendToConnection(hub.ws, peerAnnouncement);
                        }
                    } catch (error) {
                        console.error(`❌ Error broadcasting to hub ${hub.id}:`, error.message);
                    }
                }
            }
        }

        // ALSO broadcast through P2P hub mesh if available and mesh is ready
        if (this.isHub && !isHub && this.hubMesh && this.hubMeshReady) {
            const p2pConnectedHubs = this.hubMesh.connectionManager.getConnectedPeers();
            if (p2pConnectedHubs.length > 0) {
                console.log(`📡 Broadcasting peer ${peerId.substring(0, 8)}... to ${p2pConnectedHubs.length} P2P-connected hub(s)`);
                
                const p2pRelayMessage = {
                    type: 'peer-announce-relay',
                    peerId,
                    networkName: peerNetworkName,
                    peerData: {
                        peerId,
                        isHub: false,
                        ...message.data
                    },
                    timestamp: Date.now()
                };
                
                p2pConnectedHubs.forEach(hubPeerConnection => {
                    try {
                        const hubPeerId = hubPeerConnection.peerId;
                        this.hubMesh.sendMessage(p2pRelayMessage, hubPeerId);
                    } catch (error) {
                        const hubPeerId = hubPeerConnection.peerId || 'unknown';
                        console.error(`❌ Error broadcasting to P2P hub ${hubPeerId.substring(0, 8)}...:`, error.message);
                    }
                });
            }
        }

        // Get active peers in the same network
        const activePeers = this.getActivePeers(peerId, peerNetworkName);

        // Validate peers
        const validatedPeers = [];
        for (const otherPeerId of activePeers) {
            const connection = this.connections.get(otherPeerId);
            if (connection && connection.readyState === connection.OPEN) {
                validatedPeers.push(otherPeerId);
            } else {
                console.log(`🧹 Found dead connection during announce: ${otherPeerId.substring(0, 8)}...`);
                this.cleanupPeer(otherPeerId);
            }
        }

        const hubType = isHub ? 'hub' : 'peer';
        console.log(`📢 Announcing ${hubType} ${peerId.substring(0, 8)}... to ${validatedPeers.length} validated peers in network: ${peerNetworkName}`);

        // Send peer-discovered messages to validated peers only
        validatedPeers.forEach(otherPeerId => {
            const otherPeerData = this.peerData.get(otherPeerId);
            this.sendToConnection(this.connections.get(otherPeerId), {
                type: 'peer-discovered',
                data: { 
                    peerId, 
                    isHub,
                    ...message.data 
                },
                networkName: peerNetworkName,
                fromPeerId: 'system',
                targetPeerId: otherPeerId,
                timestamp: Date.now()
            });
        });

        // Send existing validated peers to the new peer (include their hub status)
        const newPeerConnection = this.connections.get(peerId);
        validatedPeers.forEach(existingPeerId => {
            const existingPeerData = this.peerData.get(existingPeerId);
            this.sendToConnection(newPeerConnection, {
                type: 'peer-discovered',
                data: { 
                    peerId: existingPeerId,
                    isHub: existingPeerData?.isHub || false,
                    ...existingPeerData?.data 
                },
                networkName: peerNetworkName,
                fromPeerId: 'system',
                targetPeerId: peerId,
                timestamp: Date.now()
            });
        });

        this.emit('peerAnnounced', { peerId, networkName: peerNetworkName, isHub });
    }

    /**
     * Handle peer goodbye
     */
    handleGoodbye(peerId, message, responseMessage) {
        if (this.verboseLogging) {
            console.log(`👋 Peer goodbye: ${peerId.substring(0, 8)}...`);
        }

        // Broadcast to closest peers before removing peer data
        this.broadcastToClosestPeers(peerId, responseMessage);
        
        // Remove peer
        this.cleanupPeer(peerId);
        this.emit('peerGoodbye', { peerId });
    }

    /**
     * Handle WebRTC signaling messages
     */
    handleSignaling(peerId, message, responseMessage) {
        const targetPeerId = message.targetPeerId;
        const networkName = message.networkName || 'global';
        
        if (this.verboseLogging) {
            console.log(`🔍 SIGNALING DEBUG: Received ${message.type} from ${peerId.substring(0, 8)}... to ${targetPeerId?.substring(0, 8)}... in network '${networkName}'`);
        }
        
        if (!targetPeerId) {
            if (this.verboseLogging) {
                console.log(`❌ No target peer ID in signaling message from ${peerId.substring(0, 8)}...`);
            }
            return;
        }

        const targetConnection = this.connections.get(targetPeerId);
        
        // Only validate network if target peer is local (we have their data)
        if (targetConnection) {
            const targetPeerData = this.peerData.get(targetPeerId);
            const targetNetwork = targetPeerData?.networkName || 'global';
            
            if (networkName !== targetNetwork) {
                if (this.verboseLogging) {
                    console.log(`🚫 Blocking ${message.type} from ${peerId.substring(0, 8)}... (network: ${networkName}) to ${targetPeerId.substring(0, 8)}... (network: ${targetNetwork}) - different networks`);
                }
                return;
            }
            
            // Target is local - forward directly
            if (this.verboseLogging) {
                console.log(`✅ Forwarding ${message.type} to LOCAL peer ${targetPeerId.substring(0, 8)}...`);
            }
            this.sendToConnection(targetConnection, responseMessage);
        } else {
            // Target peer not on this hub - relay to other hubs
            console.log(`🔄 Target peer ${targetPeerId.substring(0, 8)}... NOT LOCAL, relaying to other hubs (network: ${networkName})`);
            
            let relayed = false;
            
            // PRIORITY: Try P2P hub mesh first if available and ready
            if (this.isHub && this.hubMesh && this.hubMeshReady) {
                const p2pConnectedHubs = this.hubMesh.connectionManager.getConnectedPeers();
                if (p2pConnectedHubs.length > 0) {
                    console.log(`📡 Relaying ${message.type} through P2P hub mesh (${p2pConnectedHubs.length} hubs)`);
                    this.forwardSignalToHubMesh(targetPeerId, responseMessage);
                    relayed = true;
                }
            }
            
            // Fallback: Try relaying through WebSocket bootstrap hubs
            if (!relayed && this.bootstrapConnections.size > 0) {
                console.log(`🔗 Relaying ${message.type} through ${this.bootstrapConnections.size} WebSocket bootstrap connection(s)`);
                
                for (const [uri, connInfo] of this.bootstrapConnections) {
                    if (connInfo.connected && connInfo.ws.readyState === WebSocket.OPEN) {
                        connInfo.ws.send(JSON.stringify(responseMessage));
                        console.log(`✅ Relayed ${message.type} to bootstrap hub ${uri}`);
                        relayed = true;
                    }
                }
            }
            
            // Final fallback: Forward to WebSocket-connected hubs
            if (!relayed && this.hubs.size > 0) {
                console.log(`🔗 Forwarding ${message.type} to ${this.hubs.size} WebSocket-connected hub(s)`);
                
                for (const [hubPeerId, hubInfo] of this.hubs) {
                    const hubConnection = this.connections.get(hubPeerId);
                    if (hubConnection && hubConnection.readyState === WebSocket.OPEN) {
                        hubConnection.send(JSON.stringify(responseMessage));
                        console.log(`✅ Forwarded ${message.type} to hub ${hubPeerId.substring(0, 8)}...`);
                        relayed = true;
                    }
                }
            }
            
            if (!relayed) {
                console.log(`❌ FAILED TO RELAY: No hubs available for ${targetPeerId.substring(0, 8)}... (network: ${networkName})`);
                console.log(`   - P2P hub mesh: ${this.hubMesh ? this.hubMesh.connectionManager.getConnectedPeers().length : 0}`);
                console.log(`   - Bootstrap connections: ${this.bootstrapConnections.size}`);
                console.log(`   - Connected hubs: ${this.hubs.size}`);
            }
        }
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
     * Handle peer discovery messages from other hubs
     */
    handlePeerDiscovered(fromHubPeerId, message) {
        const { data: messageData, networkName } = message;
        const discoveredPeerId = messageData?.peerId;
        
        if (!discoveredPeerId || !networkName) {
            console.log(`⚠️ Invalid peer-discovered message from ${fromHubPeerId.substring(0, 8)}...`);
            return;
        }

        // Check if sender is a hub
        const senderPeerData = this.peerData.get(fromHubPeerId);
        const isFromHub = senderPeerData?.isHub || senderPeerData?.networkName === this.hubMeshNamespace;

        if (!isFromHub) {
            console.log(`⚠️ Received peer-discovered from non-hub peer ${fromHubPeerId.substring(0, 8)}... - ignoring`);
            return;
        }

        console.log(`🔍 Received peer discovery from hub ${fromHubPeerId.substring(0, 8)}... - Peer ${discoveredPeerId.substring(0, 8)}... in network '${networkName}'`);

        // Forward to all local CLIENT peers in the same network (exclude hubs)
        const localPeers = this.networkPeers.get(networkName);
        if (localPeers && localPeers.size > 0) {
            let forwardedCount = 0;
            for (const localPeerId of localPeers) {
                // Skip hubs - only forward to client peers
                const localPeerData = this.peerData.get(localPeerId);
                if (localPeerData?.isHub) {
                    continue;
                }

                const ws = this.connections.get(localPeerId);
                if (ws && ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'peer-discovered',
                        data: messageData,
                        networkName,
                        fromPeerId: 'system',
                        targetPeerId: localPeerId,
                        timestamp: Date.now()
                    }));
                    forwardedCount++;
                }
            }
            console.log(`✅ Forwarded peer-discovered to ${forwardedCount} local peer(s) in network '${networkName}'`);
        } else {
            console.log(`ℹ️ No local peers in network '${networkName}' to forward to`);
        }
    }

    /**
     * Handle peer disconnection
     */
    handleDisconnection(peerId, code, reason) {
        if (this.verboseLogging) {
            console.log(`❌ Peer disconnected: ${peerId.substring(0, 8)}... (code: ${code}, reason: ${reason})`);
        }

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
        this.cleanupPeer(peerId);
        this.emit('peerDisconnected', { peerId, code, reason, totalConnections: this.connections.size });
    }

    /**
     * Remove peer from server with network cleanup
     */
    cleanupPeer(peerId) {
        const wasConnected = this.connections.has(peerId);
        const peerInfo = this.peerData.get(peerId);
        const isHub = peerInfo?.isHub || false;
        
        this.connections.delete(peerId);
        this.peerData.delete(peerId);
        
        // Unregister hub if applicable
        if (isHub) {
            this.unregisterHub(peerId);
        }
        
        // Remove from network tracking
        if (peerInfo && peerInfo.networkName) {
            const networkPeerSet = this.networkPeers.get(peerInfo.networkName);
            if (networkPeerSet) {
                networkPeerSet.delete(peerId);
                // Clean up empty network sets
                if (networkPeerSet.size === 0) {
                    this.networkPeers.delete(peerInfo.networkName);
                }
            }
        }

        if (wasConnected) {
            const peerType = isHub ? 'hub' : 'peer';
            if (this.verboseLogging) {
                console.log(`🧹 Cleaned up ${peerType}: ${peerId.substring(0, 8)}... from network: ${peerInfo?.networkName || 'unknown'}`);
            }

            // Notify other peers in the same network about disconnection
            if (peerInfo && peerInfo.networkName) {
                const activePeers = this.getActivePeers(null, peerInfo.networkName);
                activePeers.forEach(otherPeerId => {
                    this.sendToConnection(this.connections.get(otherPeerId), {
                        type: 'peer-disconnected',
                        data: { 
                            peerId,
                            isHub
                        },
                        networkName: peerInfo.networkName,
                        fromPeerId: 'system',
                        targetPeerId: otherPeerId,
                        timestamp: Date.now()
                    });
                });
            }
        }
    }

    /**
     * Remove peer from server (backwards compatibility)
     */
    removePeer(peerId) {
        this.cleanupPeer(peerId);
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
        if (this.verboseLogging) {
            console.log(`📡 Broadcast to ${sentCount} peers`);
        }
        return sentCount;
    }

    /**
     * Broadcast message to closest peers in same network
     */
    broadcastToClosestPeers(fromPeerId, message, maxPeers = 5) {
        const peerInfo = this.peerData.get(fromPeerId);
        const networkName = peerInfo?.networkName || 'global';
        const activePeers = this.getActivePeers(fromPeerId, networkName);
        const closestPeers = this.findClosestPeers(fromPeerId, activePeers, maxPeers);

        if (this.verboseLogging) {
            console.log(`Broadcasting from ${fromPeerId.substring(0, 8)}... to ${closestPeers.length} closest peers in network: ${networkName}`);
        }

        closestPeers.forEach(peerId => {
            this.sendToConnection(this.connections.get(peerId), message);
        });
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
        const totalConnections = this.connections.size;
        
        // Clean up all networks
        for (const [networkName] of this.networkPeers) {
            this.getActivePeers(null, networkName); // This will clean up stale connections
        }
        
        const cleanedUp = totalConnections - this.connections.size;

        if (cleanedUp > 0) {
            console.log(`🧹 Periodic cleanup: removed ${cleanedUp} stale connections, ${this.connections.size} active across ${this.networkPeers.size} networks`);
        }
    }

    /**
     * Get server statistics
     */
    getStats() {
        const bootstrapStats = {
            total: this.bootstrapConnections.size,
            connected: 0
        };
        
        for (const [, info] of this.bootstrapConnections) {
            if (info.connected) {
                bootstrapStats.connected++;
            }
        }
        
        return {
            isRunning: this.isRunning,
            isHub: this.isHub,
            hubPeerId: this.hubPeerId,
            hubMeshNamespace: this.hubMeshNamespace,
            connections: this.connections.size,
            peers: this.peerData.size,
            hubs: this.hubs.size,
            networks: this.networkPeers.size,
            bootstrapHubs: bootstrapStats,
            maxConnections: this.maxConnections,
            uptime: this.isRunning && this.startTime ? Date.now() - this.startTime : 0,
            host: this.host,
            port: this.port
        };
    }

    /**
     * Get hub statistics
     */
    getHubStats() {
        const connectedHubs = this.getConnectedHubs();
        const bootstrapHubsInfo = [];
        
        for (const [uri, info] of this.bootstrapConnections) {
            bootstrapHubsInfo.push({
                uri,
                connected: info.connected,
                lastAttempt: info.lastAttempt,
                attemptNumber: info.attemptNumber
            });
        }
        
        return {
            totalHubs: this.hubs.size,
            connectedHubs: connectedHubs.length,
            hubs: connectedHubs,
            bootstrapHubs: bootstrapHubsInfo
        };
    }

    /**
     * Get list of connected peers
     */
    getPeers() {
        return Array.from(this.peerData.values());
    }

    /**
     * Get the current hub mesh namespace
     */
    getHubMeshNamespace() {
        return this.hubMeshNamespace;
    }

    /**
     * Set the hub mesh namespace (only when server is not running)
     */
    setHubMeshNamespace(namespace) {
        if (this.isRunning) {
            throw new Error('Cannot change hub mesh namespace while server is running. Stop the server first.');
        }
        
        if (typeof namespace !== 'string' || namespace.trim().length === 0) {
            throw new Error('Hub mesh namespace must be a non-empty string');
        }
        
        this.hubMeshNamespace = namespace.trim();
        console.log(`🌐 Hub mesh namespace set to: ${this.hubMeshNamespace}`);
        return this.hubMeshNamespace;
    }
}

// For backwards compatibility and standalone usage
export default PeerPigeonServer;
