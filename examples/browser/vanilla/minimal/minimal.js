/**
 * PeerPigeon MINIMAL Browser Implementation
 * Stripped down to absolute essentials: peer connections, data channels, encryption
 */

// Load PeerPigeon from the global bundle
let PeerPigeon;

// Wait for PeerPigeon to be available
async function waitForPeerPigeon() {
    return new Promise((resolve) => {
        const checkPeerPigeon = () => {
            if (window.PeerPigeon) {
                PeerPigeon = window.PeerPigeon;
                resolve();
            } else {
                setTimeout(checkPeerPigeon, 100);
            }
        };
        checkPeerPigeon();
    });
}

class MinimalPeerPigeon {
    constructor() {
        this.mesh = null;
        this.connected = false;
        this.peerCount = 0;
        
        this.init();
    }

    async init() {
        // Wait for PeerPigeon to be loaded
        await waitForPeerPigeon();
        
        this.log('🚀 Initializing minimal PeerPigeon...');
        
        try {
            // Create mesh with ONLY essential features
            this.mesh = new PeerPigeon.PeerPigeonMesh({
                enableWebDHT: false,           // DISABLED - not needed for basic connectivity
                enableCrypto: true,            // ENABLED - needed for key exchange
                enableDistributedStorage: false, // DISABLED - not needed for basic connectivity
                maxPeers: 2,                   // MINIMAL - only 2 peers max
                minPeers: 1,                   // MINIMAL - only 1 peer min
                autoDiscovery: true,           // ENABLED - needed for peer discovery
                evictionStrategy: false,       // DISABLED - not needed for basic connectivity
                xorRouting: false             // DISABLED - not needed for basic connectivity
            });

            await this.mesh.init();
            this.setupDetailedEventListeners();
            
            document.getElementById('peer-id').textContent = this.mesh.peerId.substring(0, 8) + '...';
            document.getElementById('status').textContent = 'Ready';
            
            this.log('✅ Minimal PeerPigeon initialized');
            this.log(`🆔 Peer ID: ${this.mesh.peerId}`);
            
        } catch (error) {
            this.log(`❌ Initialization failed: ${error.message}`, 'error');
        }
    }

    setupDetailedEventListeners() {
        // Connection events with detailed debugging
        this.mesh.addEventListener('peerConnected', (data) => {
            this.peerCount++;
            this.log(`🤝 PEER CONNECTED: ${data.peerId.substring(0, 8)}...`, 'success');
            this.log(`🔍 Connection details: reason=${data.reason || 'unknown'}, total peers=${this.peerCount}`);
            document.getElementById('peer-count').textContent = this.peerCount;
        });

        this.mesh.addEventListener('peerDisconnected', (data) => {
            this.peerCount--;
            this.log(`👋 PEER DISCONNECTED: ${data.peerId.substring(0, 8)}... (${data.reason})`, 'warning');
            document.getElementById('peer-count').textContent = this.peerCount;
        });

        this.mesh.addEventListener('peerDiscovered', (data) => {
            this.log(`🔍 PEER DISCOVERED: ${data.peerId.substring(0, 8)}...`);
            this.log(`🔍 Discovery details: method=${data.method || 'signaling'}, timestamp=${Date.now()}`);
        });

        // Message events
        this.mesh.addEventListener('messageReceived', (data) => {
            this.log(`📨 MESSAGE FROM ${data.fromPeerId.substring(0, 8)}...: ${JSON.stringify(data.message)}`, 'success');
        });

        // Crypto events
        this.mesh.addEventListener('cryptoReady', () => {
            this.log('🔐 CRYPTO READY');
        });

        this.mesh.addEventListener('peerKeyAdded', (data) => {
            this.log(`🔐 KEY EXCHANGE COMPLETED: ${data.peerId.substring(0, 8)}...`, 'success');
        });

        // Enhanced status events with detailed logging
        this.mesh.addEventListener('statusChanged', (data) => {
            this.log(`📊 STATUS: ${data.type} - ${data.message || 'No message'}`);
            
            if (data.type === 'connected') {
                this.connected = true;
                document.getElementById('status').textContent = 'Connected to signaling';
                this.log('🟢 CONNECTED to signaling server', 'success');
            } else if (data.type === 'disconnected') {
                this.connected = false;
                document.getElementById('status').textContent = 'Disconnected';
                this.log('🔴 DISCONNECTED from signaling server', 'error');
            }
        });

        // Error events with enhanced debugging
        this.mesh.addEventListener('error', (data) => {
            this.log(`❌ ERROR: ${data.error.message}`, 'error');
            this.log(`🔍 Error details: ${JSON.stringify(data)}`, 'error');
        });

        // REAL DATA CHANNEL EVENTS - these should exist
        this.mesh.connectionManager?.addEventListener('dataChannelOpen', (data) => {
            this.log(`� DATA CHANNEL OPENED: ${data.peerId.substring(0, 8)}...`, 'success');
        });

        // Check for peer connection events from ConnectionManager
        if (this.mesh.connectionManager) {
            this.log('🔍 ConnectionManager found, setting up peer connection listeners');
            
            // Monitor new peer connections
            this.mesh.connectionManager.addEventListener('peerConnected', (data) => {
                this.log(`� PEER CONNECTION ESTABLISHED: ${data.peerId.substring(0, 8)}...`, 'success');
            });
        }

        // Add a debug function to check connection states
        setInterval(() => {
            if (this.mesh && this.mesh.connectionManager) {
                const peers = this.mesh.connectionManager.peers || new Map();
                const connectedPeers = [];
                
                peers.forEach((peerConnection, peerId) => {
                    const state = peerConnection.connection?.connectionState || 'unknown';
                    const iceState = peerConnection.connection?.iceConnectionState || 'unknown';
                    const signalingState = peerConnection.connection?.signalingState || 'unknown';
                    const dataChannelState = peerConnection.dataChannel?.readyState || 'no-channel';
                    const isInitiator = peerConnection.isInitiator;
                    
                    if (state !== 'new' || iceState !== 'new') {
                        connectedPeers.push({
                            id: peerId.substring(0, 8),
                            connection: state,
                            ice: iceState,
                            signaling: signalingState,
                            dataChannel: dataChannelState,
                            initiator: isInitiator
                        });
                    }
                });
                
                if (connectedPeers.length > 0) {
                    connectedPeers.forEach(peer => {
                        this.log(`🔍 PEER STATUS: ${peer.id}... | conn:${peer.connection} | ice:${peer.ice} | sig:${peer.signaling} | data:${peer.dataChannel} | init:${peer.initiator}`);
                    });
                }
            }
        }, 5000); // Check every 5 seconds
    }

    async connect() {
        if (!this.mesh) {
            this.log('❌ Mesh not initialized', 'error');
            return;
        }

        try {
            this.log('🔌 Connecting to signaling server...');
            await this.mesh.connect('ws://localhost:3000');
            this.log('✅ Connection initiated', 'success');
        } catch (error) {
            this.log(`❌ Connection failed: ${error.message}`, 'error');
        }
    }

    sendMessage() {
        if (!this.mesh || this.peerCount === 0) {
            this.log('❌ No connected peers', 'error');
            return;
        }

        const testMessage = {
            type: 'test',
            content: 'Hello from minimal browser!',
            timestamp: Date.now()
        };

        try {
            this.mesh.broadcast(testMessage);
            this.log(`📤 BROADCAST: ${JSON.stringify(testMessage)}`);
        } catch (error) {
            this.log(`❌ Broadcast failed: ${error.message}`, 'error');
        }
    }

    log(message, type = 'info') {
        const logElement = document.getElementById('log');
        const timestamp = new Date().toLocaleTimeString();
        const className = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : '';
        
        const logEntry = document.createElement('div');
        logEntry.className = className;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        logElement.appendChild(logEntry);
        logElement.scrollTop = logElement.scrollHeight;
        
        // Also log to console for debugging
        console.log(`[MINIMAL] ${message}`);
    }

    clearLog() {
        document.getElementById('log').innerHTML = '';
    }
}

// Global functions for HTML buttons
const minimalPeer = new MinimalPeerPigeon();
window.minimalPeer = minimalPeer;
window.connect = () => minimalPeer.connect();
window.sendMessage = () => minimalPeer.sendMessage();
window.clearLog = () => minimalPeer.clearLog();

// Debug: Expose mesh for console inspection
window.mesh = () => minimalPeer.mesh;
