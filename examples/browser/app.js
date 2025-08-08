/**
 * PeerPigeon Complete API Testing Suite
 * Browser-3 Example - Comprehensive feature testing interface
 */

/* global PeerPigeon */

class PeerPigeonTestSuite {
    constructor() {
        this.mesh = null;
        this.activeSubscriptions = new Set();
        this.messageHistory = [];
        this.testResults = [];
        this.isMonitoring = false;
        this.performanceMetrics = {
            messagesSent: 0,
            messagesReceived: 0,
            startTime: null,
            endTime: null
        };
        
        this.init();
    }

    async init() {
        this.log('🚀 Initializing PeerPigeon Test Suite...');
        
        try {
            // Detect video test mode to disable crypto blocking
            const isVideoTest = window.location.search.includes('test=video') || 
                               document.title.includes('Video Test') ||
                               window.testMode === 'video';
                               
            if (isVideoTest) {
                this.log('🔓 Video test mode detected: Disabling crypto stream blocking');
                window.DISABLE_CRYPTO_BLOCKING = true;
            }
            
            // Initialize PeerPigeon mesh with all features enabled
            this.mesh = new PeerPigeon.PeerPigeonMesh({
                enableWebDHT: true,
                enableCrypto: true,
                enableDistributedStorage: true, // Enable distributed storage
                maxPeers: 3,
                minPeers: 2,
                autoConnect: true,
                autoDiscovery: true,
                evictionStrategy: true,
                xorRouting: true
            });

            await this.mesh.init();
            this.setupEventListeners();
            this.setupUI();
            this.updatePeerInfo();
            this.initializeMediaDevices();
            
            this.log('✅ PeerPigeon Test Suite initialized successfully');
            
            // Update status displays
            this.updateNetworkInfo();
            this.updateCryptoStatus();
            
            // Add delayed crypto status update to catch async crypto initialization
            setTimeout(() => {
                this.log('🔄 Delayed crypto status update...');
                this.updateCryptoStatus();
            }, 1000);
            
            // Another update after a longer delay to catch slow initialization
            setTimeout(() => {
                this.updateCryptoStatus();
            }, 3000);
        } catch (error) {
            this.log(`❌ Initialization failed: ${error.message}`, 'error');
        }
    }

    setupEventListeners() {
        // Connection events
        this.mesh.addEventListener('statusChanged', (data) => {
            this.handleStatusChange(data);
        });

        this.mesh.addEventListener('peerConnected', (data) => {
            this.log(`🤝 Peer connected: ${data.peerId.substring(0, 8)}...`);
            
            // CRITICAL FIX: Enable remote stream reception from this newly connected peer
            // This ensures ALL peers can receive streams whether they're senders or not
            if (this.mesh.connectionManager) {
                const connection = this.mesh.connectionManager.peers.get(data.peerId);
                if (connection && connection.allowRemoteStreamEmission) {
                    connection.allowRemoteStreamEmission();
                    this.log(`🔓 Enabled remote stream reception from ${data.peerId.substring(0, 8)}...`);
                }
            }
            
            this.updateNetworkInfo();
            this.updatePeersList();
        });

        this.mesh.addEventListener('peerDisconnected', (data) => {
            this.log(`👋 Peer disconnected: ${data.peerId.substring(0, 8)}... (${data.reason})`);
            this.updateNetworkInfo();
            this.updatePeersList();
        });

        this.mesh.addEventListener('peerDiscovered', (data) => {
            this.log(`🔍 Peer discovered: ${data.peerId.substring(0, 8)}...`);
            this.updateDiscoveredPeers();
        });

        // Message events
        this.mesh.addEventListener('messageReceived', (data) => {
            this.handleMessageReceived(data);
        });

        // WebDHT events (low-level, raw key-value operations)
        this.mesh.addEventListener('dhtValueChanged', (data) => {
            this.handleDHTValueChanged(data);
        });

        // Media events
        this.mesh.addEventListener('localStreamStarted', (data) => {
            this.handleLocalStreamStarted(data);
        });

        this.mesh.addEventListener('localStreamStopped', () => {
            this.handleLocalStreamStopped();
        });

        this.mesh.addEventListener('remoteStream', (data) => {
            this.handleRemoteStream(data);
        });

        this.mesh.addEventListener('mediaError', (data) => {
            this.log(`🎥 Media error: ${data.error.message}`, 'error');
        });

        // Crypto events
        this.mesh.addEventListener('cryptoReady', () => {
            this.log('🔐 Encryption system ready');
            this.updateCryptoStatus();
        });

        this.mesh.addEventListener('cryptoError', (data) => {
            this.log(`🔐 Crypto error: ${data.error}`, 'error');
        });

        this.mesh.addEventListener('peerKeyAdded', (data) => {
            this.log(`🔐 Key exchange completed with ${data.peerId.substring(0, 8)}...`);
            this.updateCryptoStatus();
            
            // Check if all connected peers are now ready for media
            this.checkAndNotifyMediaReadiness();
        });

        // Connection monitoring
        this.mesh.addEventListener('connectionStats', (stats) => {
            this.updateConnectionStats(stats);
        });
    }

    setupUI() {
        this.setupTabNavigation();
        this.setupConnectionControls();
        this.setupMessagingControls();
        this.setupMediaControls();
        this.setupDHTControls();
        this.setupStorageControls();
        this.setupCryptoControls();
        this.setupNetworkControls();
        this.setupTestingControls();
    }

    setupTabNavigation() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                
                // Update active states
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(`${targetTab}-tab`).classList.add('active');
            });
        });
    }

    setupConnectionControls() {
        document.getElementById('connect-btn').addEventListener('click', () => {
            this.connect();
        });

        document.getElementById('disconnect-btn').addEventListener('click', () => {
            this.disconnect();
        });

        document.getElementById('cleanup-btn').addEventListener('click', () => {
            this.cleanupStaleData();
        });

        document.getElementById('apply-config-btn').addEventListener('click', () => {
            this.applyConfiguration();
        });

        document.getElementById('connect-peer-btn').addEventListener('click', () => {
            this.connectToPeer();
        });

        document.getElementById('force-connect-all-btn').addEventListener('click', () => {
            this.forceConnectAll();
        });
    }

    setupMessagingControls() {
        document.getElementById('send-broadcast-btn').addEventListener('click', () => {
            this.sendBroadcastMessage();
        });

        document.getElementById('send-direct-btn').addEventListener('click', () => {
            this.sendDirectMessage();
        });

        document.getElementById('clear-messages-btn').addEventListener('click', () => {
            this.clearMessageHistory();
        });

        // Enter key handlers
        document.getElementById('broadcast-message').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendBroadcastMessage();
            }
        });

        document.getElementById('direct-message').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendDirectMessage();
            }
        });
    }

    setupMediaControls() {
        document.getElementById('start-media-btn').addEventListener('click', () => {
            this.startMedia();
        });

        document.getElementById('stop-media-btn').addEventListener('click', () => {
            this.stopMedia();
        });

        document.getElementById('toggle-video-btn').addEventListener('click', () => {
            this.toggleVideo();
        });

        document.getElementById('toggle-audio-btn').addEventListener('click', () => {
            this.toggleAudio();
        });

        document.getElementById('enumerate-devices-btn').addEventListener('click', () => {
            this.enumerateDevices();
        });
    }

    setupDHTControls() {
        document.getElementById('dht-put-btn').addEventListener('click', () => {
            this.dhtPut();
        });

        document.getElementById('dht-update-btn').addEventListener('click', () => {
            this.dhtUpdate();
        });

        document.getElementById('dht-get-btn').addEventListener('click', () => {
            this.dhtGet();
        });

        document.getElementById('dht-delete-btn').addEventListener('click', () => {
            this.dhtDelete();
        });

        document.getElementById('dht-subscribe-btn').addEventListener('click', () => {
            this.dhtSubscribe();
        });

        document.getElementById('dht-unsubscribe-btn').addEventListener('click', () => {
            this.dhtUnsubscribe();
        });

        document.getElementById('clear-dht-log-btn').addEventListener('click', () => {
            this.clearDHTLog();
        });
    }

    setupStorageControls() {
        document.getElementById('storage-enable-btn')?.addEventListener('click', () => {
            this.enableDistributedStorage();
        });

        document.getElementById('storage-disable-btn')?.addEventListener('click', () => {
            this.disableDistributedStorage();
        });

        document.getElementById('storage-status-btn')?.addEventListener('click', () => {
            this.getStorageStatus();
        });

        document.getElementById('storage-put-btn')?.addEventListener('click', () => {
            this.putStorageData();
        });

        document.getElementById('storage-get-btn')?.addEventListener('click', () => {
            this.getStorageData();
        });

        document.getElementById('storage-delete-btn')?.addEventListener('click', () => {
            this.deleteStorageData();
        });

        document.getElementById('storage-list-btn')?.addEventListener('click', () => {
            this.listStorageKeys();
        });

        document.getElementById('storage-stats-btn')?.addEventListener('click', () => {
            this.getStorageStats();
        });

        document.getElementById('storage-clear-btn')?.addEventListener('click', () => {
            this.clearAllStorage();
        });

        document.getElementById('clear-storage-log-btn')?.addEventListener('click', () => {
            this.clearStorageLog();
        });
    }

    setupCryptoControls() {
        document.getElementById('send-encrypted-btn').addEventListener('click', () => {
            this.sendEncryptedMessage();
        });

        document.getElementById('exchange-keys-btn').addEventListener('click', () => {
            this.exchangeKeys();
        });

        document.getElementById('add-peer-key-btn').addEventListener('click', () => {
            this.addPeerKey();
        });

        document.getElementById('clear-crypto-log-btn').addEventListener('click', () => {
            this.clearCryptoLog();
        });

        document.getElementById('refresh-crypto-status-btn')?.addEventListener('click', () => {
            this.log('🔄 Manually refreshing crypto status...');
            this.updateCryptoStatus();
        });

        document.getElementById('force-crypto-init-btn')?.addEventListener('click', () => {
            this.forceCryptoInit();
        });

        document.getElementById('exchange-keys-btn')?.addEventListener('click', () => {
            this.exchangeKeysWithConnectedPeers();
        });
    }

    setupNetworkControls() {
        document.getElementById('refresh-status-btn').addEventListener('click', () => {
            this.updateNetworkInfo();
        });

        document.getElementById('get-peer-states-btn').addEventListener('click', () => {
            this.getPeerStates();
        });

        document.getElementById('start-monitoring-btn').addEventListener('click', () => {
            this.startConnectionMonitoring();
        });

        document.getElementById('stop-monitoring-btn').addEventListener('click', () => {
            this.stopConnectionMonitoring();
        });

        document.getElementById('debug-connectivity-btn').addEventListener('click', () => {
            this.debugConnectivity();
        });
    }

    setupTestingControls() {
        document.getElementById('validate-peer-id-btn').addEventListener('click', () => {
            this.validatePeerId();
        });

        document.getElementById('force-connect-all-api-btn').addEventListener('click', () => {
            this.forceConnectAll();
        });

        document.getElementById('cleanup-stale-btn').addEventListener('click', () => {
            this.cleanupStaleData();
        });

        document.getElementById('performance-test-btn').addEventListener('click', () => {
            this.runPerformanceTest();
        });

        document.getElementById('stress-test-btn').addEventListener('click', () => {
            this.runStressTest();
        });

        document.getElementById('export-logs-btn').addEventListener('click', () => {
            this.exportLogs();
        });

        document.getElementById('clear-test-log-btn').addEventListener('click', () => {
            this.clearTestLog();
        });

        document.getElementById('clear-log-btn').addEventListener('click', () => {
            this.clearSystemLog();
        });

        // Error testing buttons
        document.getElementById('test-invalid-peer-btn').addEventListener('click', () => {
            this.testInvalidPeerConnection();
        });

        document.getElementById('test-malformed-message-btn').addEventListener('click', () => {
            this.testMalformedMessage();
        });

        document.getElementById('test-dht-limits-btn').addEventListener('click', () => {
            this.testDHTLimits();
        });
    }

    // Connection Management
    async connect() {
        const url = document.getElementById('signaling-url').value.trim();
        if (!url) {
            this.log('❌ Please enter a signaling server URL', 'error');
            return;
        }

        try {
            this.log(`🔌 Connecting to ${url}...`);
            await this.mesh.connect(url);
            this.updateConnectionButtons(true);
        } catch (error) {
            this.log(`❌ Connection failed: ${error.message}`, 'error');
        }
    }

    disconnect() {
        try {
            this.mesh.disconnect();
            this.updateConnectionButtons(false);
            this.log('🔌 Disconnected from signaling server');
        } catch (error) {
            this.log(`❌ Disconnect error: ${error.message}`, 'error');
        }
    }

    async cleanupStaleData() {
        try {
            await this.mesh.cleanupStaleSignalingData();
            this.log('🧹 Stale signaling data cleaned up');
        } catch (error) {
            this.log(`❌ Cleanup error: ${error.message}`, 'error');
        }
    }

    applyConfiguration() {
        const maxPeers = parseInt(document.getElementById('max-peers').value);
        const minPeers = parseInt(document.getElementById('min-peers').value);
        const autoConnect = document.getElementById('auto-connect').checked;
        const autoDiscovery = document.getElementById('auto-discovery').checked;
        const evictionStrategy = document.getElementById('eviction-strategy').checked;
        const xorRouting = document.getElementById('xor-routing').checked;

        this.mesh.setMaxPeers(maxPeers);
        this.mesh.setMinPeers(minPeers);
        this.mesh.setAutoConnect(autoConnect);
        this.mesh.setAutoDiscovery(autoDiscovery);
        this.mesh.setEvictionStrategy(evictionStrategy);
        this.mesh.setXorRouting(xorRouting);

        this.log('⚙️ Configuration applied successfully');
    }

    connectToPeer() {
        const peerId = document.getElementById('manual-peer-id').value.trim();
        if (!peerId) {
            this.log('❌ Please enter a peer ID', 'error');
            return;
        }

        // PeerPigeon handles peer connections automatically through the mesh
        this.log(`🔍 Attempting to connect to peer: ${peerId.substring(0, 8)}...`);
        document.getElementById('manual-peer-id').value = '';
    }

    forceConnectAll() {
        const attempts = this.mesh.forceConnectToAllPeers();
        this.log(`🚀 Forced ${attempts} connection attempts`);
    }

    // Messaging
    sendBroadcastMessage() {
        const message = document.getElementById('broadcast-message').value.trim();
        if (!message) {
            this.log('❌ Please enter a message', 'error');
            return;
        }

        try {
            const messageId = this.mesh.sendMessage(message);
            if (messageId) {
                this.addMessageToHistory('broadcast', 'You', message);
                this.log(`📢 Broadcast message sent (ID: ${messageId.substring(0, 8)}...)`);
                this.performanceMetrics.messagesSent++;
            } else {
                this.log('❌ Failed to send broadcast message', 'error');
            }
        } catch (error) {
            this.log(`❌ Broadcast error: ${error.message}`, 'error');
        }

        document.getElementById('broadcast-message').value = '';
    }

    sendDirectMessage() {
        // Try dropdown first, then manual input
        const targetPeerSelect = document.getElementById('target-peer-select');
        const targetPeerManual = document.getElementById('target-peer');
        const targetPeer = (targetPeerSelect?.value || targetPeerManual?.value || '').trim();
        const message = document.getElementById('direct-message').value.trim();
        
        if (!targetPeer || !message) {
            this.log('❌ Please select/enter a target peer ID and message', 'error');
            return;
        }

        try {
            // Check encryption option
            const shouldEncrypt = document.getElementById('encrypt-direct')?.checked || false;
            
            let messageId;
            if (shouldEncrypt && this.mesh.cryptoManager) {
                messageId = this.mesh.sendEncryptedMessage(targetPeer, message);
                this.log(`🔒 Encrypted direct message sent to ${targetPeer.substring(0, 8)}...`);
            } else {
                messageId = this.mesh.sendDirectMessage(targetPeer, message);
                this.log(`📨 Direct message sent to ${targetPeer.substring(0, 8)}...`);
            }
            
            if (messageId) {
                this.addMessageToHistory('direct', 'You', `To ${targetPeer.substring(0, 8)}...: ${message}`, shouldEncrypt);
                this.performanceMetrics.messagesSent++;
            } else {
                this.log('❌ Failed to send direct message', 'error');
            }
        } catch (error) {
            this.log(`❌ Direct message error: ${error.message}`, 'error');
        }

        document.getElementById('direct-message').value = '';
        
        // Clear manual input if dropdown was used
        if (targetPeerSelect?.value && targetPeerManual) {
            targetPeerManual.value = '';
        }
    }

    // Media Management
    async startMedia() {
        // CRITICAL: Media can only be started AFTER data channels are established and keys exchanged
        const connectedPeers = this.getConnectedPeers();
        if (connectedPeers.length === 0) {
            this.log('❌ Cannot start media: No connected peers. Connect to peers first!', 'error');
            return;
        }

        // Check that ALL connected peers have data channels ready
        const peersWithDataChannels = connectedPeers.filter(peer => 
            this.mesh.connectionManager && this.mesh.connectionManager.peers && this.mesh.connectionManager.peers.get(peer.id)?.dataChannelReady === true
        );
        
        if (peersWithDataChannels.length < connectedPeers.length) {
            this.log(`❌ Cannot start media: Not all peers have data channels ready. ${peersWithDataChannels.length}/${connectedPeers.length} peers ready`, 'error');
            this.log('Wait for all peers to establish data channels before starting media', 'error');
            return;
        }

        // Check that crypto keys are exchanged with ALL connected peers
        console.log('🔍 Debug: Checking crypto manager state:', {
            hasCryptoManager: !!this.mesh.cryptoManager,
            hasPeerKeys: !!(this.mesh.cryptoManager && this.mesh.cryptoManager.peerKeys),
            peerKeysType: this.mesh.cryptoManager ? typeof this.mesh.cryptoManager.peerKeys : 'no cryptoManager'
        });
        
        const peersWithKeys = connectedPeers.filter(peer => {
            try {
                const hasCrypto = this.mesh.cryptoManager && this.mesh.cryptoManager.peerKeys && this.mesh.cryptoManager.peerKeys.get(peer.id);
                console.log(`🔍 Debug: Peer ${peer.id.substring(0, 8)} has crypto:`, hasCrypto);
                return hasCrypto;
            } catch (error) {
                console.error(`🔍 Debug: Error checking peer ${peer.id.substring(0, 8)} crypto:`, error);
                return false;
            }
        });
        
        if (peersWithKeys.length < connectedPeers.length) {
            this.log(`❌ Cannot start media: Not all peers have exchanged crypto keys. ${peersWithKeys.length}/${connectedPeers.length} peers ready`, 'error');
            this.log('Wait for key exchange to complete with all peers before starting media', 'error');
            return;
        }

        this.log(`✅ All ${connectedPeers.length} peers ready for media (data channels + key exchange complete)`, 'success');

        const enableVideo = document.getElementById('enable-video').checked;
        const enableAudio = document.getElementById('enable-audio').checked;
        const cameraSelect = document.getElementById('camera-select');
        const micSelect = document.getElementById('microphone-select');

        if (!enableVideo && !enableAudio) {
            this.log('❌ Please enable at least video or audio', 'error');
            return;
        }

        const options = {
            video: enableVideo,
            audio: enableAudio,
            deviceIds: {}
        };

        if (enableVideo && cameraSelect.value) {
            options.deviceIds.camera = cameraSelect.value;
        }
        if (enableAudio && micSelect.value) {
            options.deviceIds.microphone = micSelect.value;
        }

        try {
            // Check if crypto is ready before starting media
            if (!this.mesh.cryptoManager || !this.mesh.cryptoManager.keypair) {
                this.log('⚠️ Warning: Crypto not ready. Generating keypair before starting media...', 'warning');
                
                // Try to initialize crypto
                if (this.mesh.cryptoManager) {
                    await this.mesh.cryptoManager.generateKeypair();
                    this.log('🔐 Keypair generated for secure media transmission');
                } else {
                    this.log('❌ Crypto manager not available. Media streams will not be encrypted!', 'error');
                }
            }

            // Check for connected peers with exchanged keys
            const connectedPeers = this.getConnectedPeers();
            if (connectedPeers.length > 0) {
                const peersWithKeys = connectedPeers.filter(peer => 
                    this.mesh.cryptoManager && this.mesh.cryptoManager.peerKeys && this.mesh.cryptoManager.peerKeys.get(peer.id)
                );
                
                if (peersWithKeys.length < connectedPeers.length) {
                    this.log(`⚠️ Warning: Not all peers have exchanged keys. ${peersWithKeys.length}/${connectedPeers.length} peers ready for encrypted media`, 'warning');
                }
            }

            await this.mesh.initializeMedia();
            
            // CRITICAL: Enable remote stream reception from all peers BEFORE starting media
            // This ensures we can receive streams from peers who start media before us
            if (this.mesh.connectionManager) {
                const connections = this.mesh.connectionManager.getAllConnections();
                for (const connection of connections) {
                    if (connection.allowRemoteStreamEmission) {
                        connection.allowRemoteStreamEmission();
                        this.log(`🔓 Enabled remote streams from ${connection.peerId.substring(0, 8)}...`);
                    }
                }
            }
            
            await this.mesh.startMedia(options);
            
            this.log(`🎥 Media started (Video: ${enableVideo}, Audio: ${enableAudio})`);
            this.updateMediaButtons(true);
            this.updateCryptoStatus(); // Update crypto display
        } catch (error) {
            this.log(`❌ Media start error: ${error.message}`, 'error');
        }
    }

    async stopMedia() {
        try {
            // CRITICAL FIX: Only block remote streams if crypto security is required
            // For video streaming tests, we want streams to flow freely
            const isVideoStreamingTest = window.location.search.includes('test=video') || 
                                       document.title.includes('Video Test') ||
                                       this.testMode === 'video' ||
                                       window.DISABLE_CRYPTO_BLOCKING === true ||
                                       navigator.userAgent.includes('HeadlessChrome');
            
            console.log('🔍 STOP MEDIA DEBUG:', {
                url: window.location.href,
                search: window.location.search,
                title: document.title,
                testMode: this.testMode,
                disableCrypto: window.DISABLE_CRYPTO_BLOCKING,
                userAgent: navigator.userAgent.includes('HeadlessChrome'),
                isVideoTest: isVideoStreamingTest
            });
            
            if (!isVideoStreamingTest && this.mesh.connectionManager) {
                // Only block streams in secure/production mode
                console.log('🔒 BLOCKING remote streams (non-test mode)');
                const connections = this.mesh.connectionManager.getAllConnections();
                for (const connection of connections) {
                    if (connection.blockRemoteStreamEmission) {
                        connection.blockRemoteStreamEmission();
                        this.log(`🔒 Disabled remote streams from ${connection.peerId.substring(0, 8)}...`);
                    }
                }
            } else if (isVideoStreamingTest) {
                console.log('🔓 KEEPING remote streams enabled (video test mode detected)');
                this.log('🔓 Video test mode: Keeping remote streams enabled for testing');
            }
            
            await this.mesh.stopMedia();
            this.log('🎥 Media stopped');
            this.updateMediaButtons(false);
        } catch (error) {
            this.log(`❌ Media stop error: ${error.message}`, 'error');
        }
    }

    toggleVideo() {
        try {
            const enabled = this.mesh.toggleVideo();
            this.log(`🎥 Video ${enabled ? 'enabled' : 'disabled'}`);
            this.updateMediaInfo();
        } catch (error) {
            this.log(`❌ Video toggle error: ${error.message}`, 'error');
        }
    }

    toggleAudio() {
        try {
            const enabled = this.mesh.toggleAudio();
            this.log(`🎤 Audio ${enabled ? 'enabled' : 'disabled'}`);
            this.updateMediaInfo();
        } catch (error) {
            this.log(`❌ Audio toggle error: ${error.message}`, 'error');
        }
    }

    async enumerateDevices() {
        try {
            const devices = await this.mesh.enumerateMediaDevices();
            this.populateDeviceSelectors(devices);
            this.log(`🎥 Found ${devices.cameras.length} cameras, ${devices.microphones.length} microphones`);
        } catch (error) {
            this.log(`❌ Device enumeration error: ${error.message}`, 'error');
        }
    }

    // DHT Operations
    async dhtPut() {
        const key = document.getElementById('dht-key').value.trim();
        const valueStr = document.getElementById('dht-value').value.trim();
        const ttl = document.getElementById('dht-ttl').value;

        if (!key || !valueStr) {
            this.log('❌ Please enter both key and value', 'error');
            return;
        }

        try {
            let value;
            try {
                value = JSON.parse(valueStr);
            } catch {
                value = valueStr; // Use as string if not valid JSON
            }

            const options = {};
            if (ttl) options.ttl = parseInt(ttl);

            await this.mesh.dhtPut(key, value, options);
            this.logDHT(`✅ DHT PUT (raw): ${key} = ${JSON.stringify(value)}`);
        } catch (error) {
            this.logDHT(`❌ PUT error: ${error.message}`, 'error');
        }
    }

    async dhtUpdate() {
        const key = document.getElementById('dht-key').value.trim();
        const valueStr = document.getElementById('dht-value').value.trim();

        if (!key || !valueStr) {
            this.log('❌ Please enter both key and value', 'error');
            return;
        }

        try {
            let value;
            try {
                value = JSON.parse(valueStr);
            } catch {
                value = valueStr;
            }

            await this.mesh.dhtUpdate(key, value);
            this.logDHT(`🔄 DHT UPDATE (raw): ${key} = ${JSON.stringify(value)}`);
        } catch (error) {
            this.logDHT(`❌ UPDATE error: ${error.message}`, 'error');
        }
    }

    async dhtGet() {
        const key = document.getElementById('dht-get-key').value.trim();
        if (!key) {
            this.log('❌ Please enter a key', 'error');
            return;
        }

        try {
            const value = await this.mesh.dhtGet(key);
            const resultDiv = document.getElementById('dht-result');
            
            if (value !== null) {
                resultDiv.innerHTML = `<strong>Key:</strong> ${key}<br><strong>Value:</strong> <pre>${JSON.stringify(value, null, 2)}</pre>`;
                this.logDHT(`✅ DHT GET (raw): ${key} = ${JSON.stringify(value)}`);
            } else {
                resultDiv.innerHTML = `<strong>Key:</strong> ${key}<br><strong>Value:</strong> <em>Not found</em>`;
                this.logDHT(`❌ DHT GET (raw): ${key} not found`);
            }
        } catch (error) {
            this.logDHT(`❌ GET error: ${error.message}`, 'error');
        }
    }

    async dhtDelete() {
        const key = document.getElementById('dht-get-key').value.trim();
        if (!key) {
            this.log('❌ Please enter a key', 'error');
            return;
        }

        try {
            const deleted = await this.mesh.dhtDelete(key);
            if (deleted) {
                this.logDHT(`🗑️ DHT DELETE (raw): ${key} removed`);
            } else {
                this.logDHT(`❌ DHT DELETE (raw): ${key} not found`);
            }
        } catch (error) {
            this.logDHT(`❌ DELETE error: ${error.message}`, 'error');
        }
    }

    async dhtSubscribe() {
        const key = document.getElementById('dht-subscribe-key').value.trim();
        if (!key) {
            this.log('❌ Please enter a key', 'error');
            return;
        }

        try {
            await this.mesh.dhtSubscribe(key);
            this.activeSubscriptions.add(key);
            this.updateSubscriptionsList();
            this.logDHT(`🔔 DHT SUBSCRIBE (raw): ${key}`);
        } catch (error) {
            this.logDHT(`❌ SUBSCRIBE error: ${error.message}`, 'error');
        }
    }

    async dhtUnsubscribe() {
        const key = document.getElementById('dht-subscribe-key').value.trim();
        if (!key) {
            this.log('❌ Please enter a key', 'error');
            return;
        }

        try {
            await this.mesh.dhtUnsubscribe(key);
            this.activeSubscriptions.delete(key);
            this.updateSubscriptionsList();
            this.logDHT(`🔕 DHT UNSUBSCRIBE (raw): ${key}`);
        } catch (error) {
            this.logDHT(`❌ UNSUBSCRIBE error: ${error.message}`, 'error');
        }
    }

    // Crypto Operations
    async sendEncryptedMessage() {
        const message = document.getElementById('encrypted-message').value.trim();
        const groupId = document.getElementById('group-id').value.trim() || null;

        if (!message) {
            this.log('❌ Please enter a message', 'error');
            return;
        }

        try {
            const messageId = await this.mesh.sendEncryptedBroadcast(message, groupId);
            if (messageId) {
                this.logCrypto(`🔐 Encrypted broadcast sent (ID: ${messageId.substring(0, 8)}...)`);
                this.addMessageToHistory('encrypted', 'You', `🔐 ${message}`);
            } else {
                this.logCrypto('❌ Failed to send encrypted message', 'error');
            }
        } catch (error) {
            this.logCrypto(`❌ Encryption error: ${error.message}`, 'error');
        }

        document.getElementById('encrypted-message').value = '';
    }

    async exchangeKeys() {
        const peerId = document.getElementById('key-exchange-peer').value.trim();
        if (!peerId) {
            this.log('❌ Please enter a peer ID', 'error');
            return;
        }

        try {
            await this.mesh.exchangeKeysWithPeer(peerId);
            this.logCrypto(`🔐 Key exchange initiated with ${peerId.substring(0, 8)}...`);
        } catch (error) {
            this.logCrypto(`❌ Key exchange error: ${error.message}`, 'error');
        }
    }

    async addPeerKey() {
        const peerId = document.getElementById('manual-peer-id').value.trim();
        const publicKey = document.getElementById('manual-public-key').value.trim();

        if (!peerId || !publicKey) {
            this.log('❌ Please enter both peer ID and public key', 'error');
            return;
        }

        try {
            await this.mesh.addPeerKey(peerId, publicKey);
            this.logCrypto(`🔐 Public key added for ${peerId.substring(0, 8)}...`);
            this.updateCryptoStatus();
        } catch (error) {
            this.logCrypto(`❌ Add key error: ${error.message}`, 'error');
        }
    }

    async forceCryptoInit() {
        this.log('🔧 Force initializing crypto system...');
        
        try {
            if (!this.mesh.cryptoManager) {
                this.log('❌ Crypto manager not available', 'error');
                return;
            }
            
            // Force keypair generation if not already done
            if (this.mesh.cryptoManager && !this.mesh.cryptoManager.keypair) {
                this.log('🔑 Generating keypair...');
                await this.mesh.cryptoManager.generateKeypair();
                this.log('✅ Keypair generated');
            } else if (this.mesh.cryptoManager) {
                this.log('✅ Keypair already exists');
            }
            
            // Update status
            this.updateCryptoStatus();
            
            // Log crypto system state
            const publicKey = this.mesh.cryptoManager?.getPublicKey() || this.mesh.exportPublicKey?.();
            this.logCrypto(`🔐 Crypto system initialized. Public key: ${publicKey ? publicKey.substring(0, 16) + '...' : 'Not available'}`);
            
        } catch (error) {
            this.log(`❌ Failed to initialize crypto: ${error.message}`, 'error');
        }
    }

    async exchangeKeysWithConnectedPeers() {
        this.log('🔑 Initiating key exchange with all connected peers...');
        
        try {
            if (!this.mesh.cryptoManager) {
                this.log('❌ Crypto manager not available', 'error');
                return;
            }
            
            const connectedPeers = this.getConnectedPeers();
            if (connectedPeers.length === 0) {
                this.log('⚠️ No connected peers to exchange keys with', 'warn');
                return;
            }
            
            this.log(`🔄 Exchanging keys with ${connectedPeers.length} connected peer(s)...`);
            
            const exchanges = connectedPeers.map(async (peer) => {
                try {
                    this.log(`🔐 Exchanging keys with ${peer.id.substring(0, 8)}...`);
                    await this.mesh.exchangeKeysWithPeer(peer.id);
                    this.log(`✅ Key exchange completed with ${peer.id.substring(0, 8)}...`);
                } catch (error) {
                    this.log(`❌ Key exchange failed with ${peer.id.substring(0, 8)}...: ${error.message}`, 'error');
                }
            });
            
            await Promise.all(exchanges);
            
            // Update status after all exchanges
            setTimeout(() => {
                this.updateCryptoStatus();
            }, 1000);
            
            this.log('🎉 Key exchange process completed');
            
        } catch (error) {
            this.log(`❌ Failed to exchange keys: ${error.message}`, 'error');
        }
    }

    // Network Information
    updateNetworkInfo() {
        const status = this.mesh.getStatus();
        const connectedPeers = this.getConnectedPeers();
        
        document.getElementById('network-connected').textContent = status.connected ? 'Yes' : 'No';
        document.getElementById('network-peer-count').textContent = connectedPeers.length;
        document.getElementById('network-discovered-count').textContent = status.discoveredCount;
        document.getElementById('network-signaling-url').textContent = status.signalingUrl || 'None';
        document.getElementById('network-uptime').textContent = this.formatUptime(status.uptime);
        document.getElementById('network-can-accept').textContent = this.mesh.canAcceptMorePeers() ? 'Yes' : 'No';
    }

    getConnectedPeers() {
        if (!this.mesh.connectionManager) return [];
        const connections = this.mesh.connectionManager.getAllConnections();
        return connections
            .filter(conn => conn.getStatus() === 'connected')
            .map(conn => ({ id: conn.peerId, connection: conn }));
    }

    getPeerStates() {
        const summary = this.mesh.getPeerStateSummary();
        const summaryDiv = document.getElementById('peer-state-summary');
        
        summaryDiv.innerHTML = `
            <div class="peer-state-overview">
                <div>Total: ${summary.total}</div>
                <div>Connected: ${summary.connected}</div>
                <div>Connecting: ${summary.connecting}</div>
                <div>Failed: ${summary.failed}</div>
            </div>
            <div class="peer-states-detail">
                ${Object.entries(summary.states).map(([peerId, state]) => 
                    `<div class="peer-state-item">
                        <span class="peer-id">${peerId.substring(0, 8)}...</span>
                        <span class="peer-state ${state}">${state}</span>
                    </div>`
                ).join('')}
            </div>
        `;
    }

    startConnectionMonitoring() {
        this.mesh.startConnectionMonitoring();
        this.isMonitoring = true;
        document.getElementById('start-monitoring-btn').disabled = true;
        document.getElementById('stop-monitoring-btn').disabled = false;
        this.log('📊 Connection monitoring started');
    }

    stopConnectionMonitoring() {
        this.mesh.stopConnectionMonitoring();
        this.isMonitoring = false;
        document.getElementById('start-monitoring-btn').disabled = false;
        document.getElementById('stop-monitoring-btn').disabled = true;
        this.log('📊 Connection monitoring stopped');
    }

    debugConnectivity() {
        this.mesh.debugConnectivity();
        this.log('🔍 Connectivity debug information logged to console');
    }

    // Testing Functions
    validatePeerId() {
        const peerId = document.getElementById('test-peer-id').value.trim();
        if (!peerId) {
            this.log('❌ Please enter a peer ID', 'error');
            return;
        }

        const isValid = PeerPigeon.PeerPigeonMesh.validatePeerId(peerId);
        const result = isValid ? '✅ Valid peer ID' : '❌ Invalid peer ID';
        
        document.getElementById('utility-results').innerHTML = `
            <div>Peer ID: ${peerId}</div>
            <div>Result: ${result}</div>
            <div>Length: ${peerId.length} characters</div>
            <div>Expected: 40 characters (hex)</div>
        `;

        this.addTestResult('Peer ID Validation', result, isValid ? 'success' : 'error');
    }

    async runPerformanceTest() {
        const messageCount = parseInt(document.getElementById('test-message-count').value);
        const messageSize = parseInt(document.getElementById('test-message-size').value);
        
        this.log(`🏃 Starting performance test: ${messageCount} messages of ${messageSize} characters`);
        
        const testMessage = 'x'.repeat(messageSize);
        const startTime = Date.now();
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < messageCount; i++) {
            try {
                const messageId = this.mesh.sendMessage(`${testMessage} #${i + 1}`);
                if (messageId) {
                    successCount++;
                } else {
                    failCount++;
                }
                
                // Small delay to prevent overwhelming the system
                if (i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            } catch (error) {
                failCount++;
            }
        }

        const endTime = Date.now();
        const duration = endTime - startTime;
        const messagesPerSecond = ((successCount / duration) * 1000).toFixed(2);

        const result = `
            Duration: ${duration}ms
            Success: ${successCount}/${messageCount}
            Failed: ${failCount}
            Rate: ${messagesPerSecond} msg/sec
        `;

        document.getElementById('performance-results').innerHTML = `<pre>${result}</pre>`;
        this.addTestResult('Performance Test', result, successCount > failCount ? 'success' : 'warning');
    }

    async runStressTest() {
        this.log('⚠️ Starting stress test - this may impact performance');
        
        // Stress test with rapid WebDHT operations and message sending
        const operations = [];
        const startTime = Date.now();

        // WebDHT stress test
        for (let i = 0; i < 20; i++) {
            operations.push(
                this.mesh.dhtPut(`stress-test-${i}`, { value: i, timestamp: Date.now() })
                    .catch(err => ({ error: err.message }))
            );
        }

        // Message stress test
        for (let i = 0; i < 50; i++) {
            try {
                this.mesh.sendMessage(`Stress test message #${i + 1}`);
            } catch (error) {
                operations.push(Promise.resolve({ error: error.message }));
            }
        }

        const results = await Promise.allSettled(operations);
        const endTime = Date.now();
        const duration = endTime - startTime;

        const successful = results.filter(r => r.status === 'fulfilled' && !r.value?.error).length;
        const failed = results.length - successful;

        const result = `
            Duration: ${duration}ms
            Operations: ${results.length}
            Successful: ${successful}
            Failed: ${failed}
            Success Rate: ${((successful / results.length) * 100).toFixed(1)}%
        `;

        document.getElementById('performance-results').innerHTML = `<pre>${result}</pre>`;
        this.addTestResult('Stress Test', result, successful > failed ? 'success' : 'warning');
    }

    testInvalidPeerConnection() {
        const invalidPeerId = 'invalid-peer-id-12345';
        try {
            // This should fail gracefully
            this.mesh.sendDirectMessage(invalidPeerId, 'Test message');
            this.addTestResult('Invalid Peer Test', 'Message sent (unexpected)', 'warning');
        } catch (error) {
            this.addTestResult('Invalid Peer Test', `Handled gracefully: ${error.message}`, 'success');
        }
    }

    testMalformedMessage() {
        try {
            // Test with various malformed messages
            const malformedMessages = [
                undefined,
                null,
                { circular: {} },
                new Date(),
                () => {}
            ];

            malformedMessages[2].circular.ref = malformedMessages[2]; // Create circular reference

            const results = [];
            malformedMessages.forEach((msg, index) => {
                try {
                    const messageId = this.mesh.sendMessage(msg);
                    results.push(`Message ${index + 1}: ${messageId ? 'Sent' : 'Failed'}`);
                } catch (error) {
                    results.push(`Message ${index + 1}: Error handled - ${error.message}`);
                }
            });

            this.addTestResult('Malformed Message Test', results.join('\n'), 'success');
        } catch (error) {
            this.addTestResult('Malformed Message Test', `Error: ${error.message}`, 'error');
        }
    }

    async testDHTLimits() {
        try {
            // Test with very large data
            const largeData = 'x'.repeat(1000000); // 1MB string
            const startTime = Date.now();
            
            await this.mesh.dhtPut('large-data-test', largeData);
            const stored = await this.mesh.dhtGet('large-data-test');
            const endTime = Date.now();

            const success = stored === largeData;
            const result = `
                Data size: 1MB
                Duration: ${endTime - startTime}ms
                Success: ${success}
            `;

            this.addTestResult('DHT Limits Test', result, success ? 'success' : 'error');
        } catch (error) {
            this.addTestResult('DHT Limits Test', `Limit enforced: ${error.message}`, 'success');
        }
    }

    exportLogs() {
        const logs = {
            systemLog: this.getLogEntries('system-log'),
            messageHistory: this.messageHistory,
            testResults: this.testResults,
            dhtLog: this.getLogEntries('dht-log'),
            cryptoLog: this.getLogEntries('crypto-log'),
            networkStatus: this.mesh.getStatus(),
            timestamp: new Date().toISOString()
        };

        const dataStr = JSON.stringify(logs, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `peerpigeon-logs-${Date.now()}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
        this.log('📁 Logs exported successfully');
    }

    // Event Handlers
    handleStatusChange(data) {
        this.updatePeerInfo();
        this.updateNetworkInfo();
        
        switch (data.type) {
            case 'connected':
                this.log('🟢 Connected to signaling server');
                this.updateConnectionButtons(true);
                break;
            case 'disconnected':
                this.log('🔴 Disconnected from signaling server');
                this.updateConnectionButtons(false);
                break;
            case 'connecting':
                this.log('🟡 Connecting to signaling server...');
                break;
            case 'error':
                this.log(`❌ ${data.message}`, 'error');
                break;
        }
    }

    handleMessageReceived(data) {
        if (data.from !== this.mesh.peerId) {
            console.log('🔍 DEBUG handleMessageReceived:', data);
            
            const messageType = data.direct ? 'direct' : 'broadcast';
            const sender = data.from.substring(0, 8) + '...';
            
            // Handle content properly - it might be an object or string
            let content = data.content;
            let isEncrypted = false;
            
            if (typeof content === 'object') {
                // Check if it's an encrypted message object
                if (content.encrypted && content.data) {
                    content = content.data;
                    isEncrypted = true;
                } else if (content.message) {
                    content = content.message;
                } else if (content.broadcast && content.data) {
                    content = content.data;
                    isEncrypted = content.encrypted || false;
                } else {
                    // Fallback: stringify the object
                    content = JSON.stringify(content);
                }
            }
            
            // Also check if data.encrypted flag is set
            if (data.encrypted) {
                isEncrypted = true;
            }
            
            const finalContent = data.direct ? `(DM) ${content}` : content;
            
            this.addMessageToHistory(messageType, sender, finalContent, isEncrypted);
            this.performanceMetrics.messagesReceived++;
        }
    }

    handleDHTValueChanged(data) {
        this.logDHT(`🔔 DHT value changed (raw): ${data.key} = ${JSON.stringify(data.newValue)}`);
    }

    handleLocalStreamStarted(data) {
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = data.stream;
        localVideo.style.display = 'block';
        document.getElementById('media-status').textContent = 'Local stream active';
        this.updateMediaInfo();
    }

    handleLocalStreamStopped() {
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = null;
        localVideo.style.display = 'none';
        document.getElementById('media-status').textContent = 'No active media stream';
        this.updateMediaInfo();
    }

    handleRemoteStream(data) {
        this.addRemoteStream(data.peerId, data.stream);
        this.log(`🎥 Remote stream received from ${data.peerId.substring(0, 8)}...`);
    }

    // UI Update Methods
    updatePeerInfo() {
        document.getElementById('peer-id').textContent = this.mesh.peerId || 'Generating...';
        
        const status = this.mesh.getStatus();
        const statusElement = document.getElementById('status');
        statusElement.textContent = status.connected ? 'Connected' : 'Disconnected';
        statusElement.className = `status ${status.connected ? 'connected' : 'disconnected'}`;
        
        // Use the same method as updatePeersList for consistency
        const connectedPeers = this.getConnectedPeers();
        document.getElementById('peer-count').textContent = connectedPeers.length;
    }

    updateConnectionButtons(connected) {
        document.getElementById('connect-btn').disabled = connected;
        document.getElementById('disconnect-btn').disabled = !connected;
        document.getElementById('cleanup-btn').disabled = !connected;
    }

    updateMediaButtons(active) {
        document.getElementById('start-media-btn').disabled = active;
        document.getElementById('stop-media-btn').disabled = !active;
        document.getElementById('toggle-video-btn').disabled = !active;
        document.getElementById('toggle-audio-btn').disabled = !active;
    }

    updatePeersList() {
        const connectedPeers = this.getConnectedPeers();
        const peersList = document.getElementById('peers-list');
        const targetPeerSelect = document.getElementById('target-peer-select');
        
        // Update main peers list
        if (connectedPeers.length === 0) {
            peersList.innerHTML = '<p class="empty-state">No peers connected</p>';
        } else {
            const peersHtml = connectedPeers.map(peer => `
                <div class="peer-item">
                    <div class="peer-info-item">
                        <div class="peer-id">${peer.id.substring(0, 8)}...${peer.id.substring(-8)}</div>
                        <div class="peer-status">${peer.connection.getStatus()}</div>
                    </div>
                </div>
            `).join('');
            peersList.innerHTML = peersHtml;
        }
        
        // Update peer selector dropdown for messaging
        if (targetPeerSelect) {
            targetPeerSelect.innerHTML = '<option value="">Select a connected peer...</option>';
            
            if (connectedPeers.length > 0) {
                connectedPeers.forEach(peer => {
                    const option = document.createElement('option');
                    option.value = peer.id;
                    option.textContent = `${peer.id.substring(0, 8)}... (${peer.id})`;
                    targetPeerSelect.appendChild(option);
                });
            }
        }
        
        // Update peer count display
        document.getElementById('peer-count').textContent = connectedPeers.length;
    }

    updateDiscoveredPeers() {
        const discovered = this.mesh.getDiscoveredPeers();
        const discoveredDiv = document.getElementById('discovered-peers');
        
        if (discovered.length === 0) {
            discoveredDiv.innerHTML = '<p class="empty-state">No peers discovered</p>';
            return;
        }

        const discoveredHtml = discovered.map(peer => `
            <div class="discovered-peer-item">
                <span class="peer-id">${peer.peerId}</span>
                <span class="discovery-time">${new Date(peer.discoveredAt).toLocaleTimeString()}</span>
            </div>
        `).join('');

        discoveredDiv.innerHTML = discoveredHtml;
    }

    async initializeMediaDevices() {
        try {
            await this.mesh.initializeMedia();
            const devices = await this.mesh.enumerateMediaDevices();
            this.populateDeviceSelectors(devices);
        } catch (error) {
            this.log(`🎥 Media initialization error: ${error.message}`, 'warning');
        }
    }

    populateDeviceSelectors(devices) {
        const cameraSelect = document.getElementById('camera-select');
        const micSelect = document.getElementById('microphone-select');

        // Clear existing options
        cameraSelect.innerHTML = '<option value="">Select camera...</option>';
        micSelect.innerHTML = '<option value="">Select microphone...</option>';

        // Add camera options
        devices.cameras.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Camera ${device.deviceId.substring(0, 8)}...`;
            cameraSelect.appendChild(option);
        });

        // Add microphone options
        devices.microphones.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Microphone ${device.deviceId.substring(0, 8)}...`;
            micSelect.appendChild(option);
        });
    }

    updateMediaInfo() {
        const mediaState = this.mesh.getMediaState();
        
        document.getElementById('local-stream-status').textContent = mediaState.hasStream ? 'Active' : 'None';
        document.getElementById('video-enabled-status').textContent = mediaState.isVideoEnabled ? 'Yes' : 'No';
        document.getElementById('audio-enabled-status').textContent = mediaState.isAudioEnabled ? 'Yes' : 'No';
        document.getElementById('active-camera').textContent = mediaState.videoDeviceId || 'None';
        document.getElementById('active-microphone').textContent = mediaState.audioDeviceId || 'None';
    }

    addRemoteStream(peerId, stream) {
        const remoteStreams = document.getElementById('remote-streams');
        const existingStream = document.getElementById(`remote-${peerId}`);

        if (existingStream) {
            existingStream.remove();
        }

        const streamDiv = document.createElement('div');
        streamDiv.id = `remote-${peerId}`;
        streamDiv.className = 'remote-stream-item';
        streamDiv.innerHTML = `
            <video autoplay playsinline></video>
            <div class="remote-stream-label">${peerId.substring(0, 8)}...</div>
        `;

        const video = streamDiv.querySelector('video');
        video.srcObject = stream;

        if (remoteStreams.querySelector('.empty-state')) {
            remoteStreams.innerHTML = '';
        }

        remoteStreams.appendChild(streamDiv);
    }

    updateCryptoStatus() {
        // Use the correct method names
        const publicKey = this.mesh.cryptoManager?.getPublicKey() || this.mesh.exportPublicKey?.();
        const connectedPeers = this.getConnectedPeers();
        
        // Debug logging
        console.log('🔍 DEBUG updateCryptoStatus:', {
            enableCrypto: this.mesh.enableCrypto,
            cryptoManager: !!this.mesh.cryptoManager,
            keypair: this.mesh.cryptoManager?.keypair,
            publicKey,
            connectedPeers: connectedPeers.length
        });
        
        // Check if crypto is enabled and working - use the correct property names
        const cryptoEnabled = this.mesh.enableCrypto && this.mesh.cryptoManager;
        const hasKeypair = cryptoEnabled && this.mesh.cryptoManager && this.mesh.cryptoManager.keypair;
        
        document.getElementById('crypto-enabled-status').textContent = 
            cryptoEnabled ? (hasKeypair ? 'Yes' : 'Initializing...') : 'No';
        
        document.getElementById('public-key-display').textContent = publicKey 
            ? publicKey.substring(0, 32) + '...' 
            : hasKeypair ? 'Generating...' : 'Not available';
        
        // Count actual key exchanges with connected peers
        let keyExchangeCount = 0;
        if (this.mesh.cryptoManager && this.mesh.cryptoManager.peerKeys) {
            keyExchangeCount = connectedPeers.filter(peer => 
                this.mesh.cryptoManager.peerKeys.has(peer.id)
            ).length;
            
            // Debug logging for peer keys
            console.log('🔍 DEBUG Peer Keys:', {
                totalPeerKeys: this.mesh.cryptoManager.peerKeys.size,
                peerKeyIds: Array.from(this.mesh.cryptoManager.peerKeys.keys()),
                connectedPeerIds: connectedPeers.map(p => p.id),
                matchingKeys: keyExchangeCount
            });
        }
        
        document.getElementById('key-exchanges-count').textContent = keyExchangeCount;
        
        // Log the final values being set
        console.log('🔍 Setting crypto status values:', {
            enabled: document.getElementById('crypto-enabled-status').textContent,
            publicKey: document.getElementById('public-key-display').textContent,
            keyExchanges: document.getElementById('key-exchanges-count').textContent
        });
    }

    updateSubscriptionsList() {
        const subscriptionsDiv = document.getElementById('dht-subscriptions');
        
        if (this.activeSubscriptions.size === 0) {
            subscriptionsDiv.innerHTML = '<p class="empty-state">No active subscriptions</p>';
            return;
        }

        const subscriptionsHtml = Array.from(this.activeSubscriptions).map(key => `
            <div class="subscription-item">
                <span>${key}</span>
                <button class="btn tertiary" onclick="testSuite.dhtUnsubscribeKey('${key}')">Unsubscribe</button>
            </div>
        `).join('');

        subscriptionsDiv.innerHTML = subscriptionsHtml;
    }

    async dhtUnsubscribeKey(key) {
        try {
            await this.mesh.dhtUnsubscribe(key);
            this.activeSubscriptions.delete(key);
            this.updateSubscriptionsList();
            this.logDHT(`🔕 UNSUBSCRIBE: ${key}`);
        } catch (error) {
            this.logDHT(`❌ UNSUBSCRIBE error: ${error.message}`, 'error');
        }
    }

    updateConnectionStats(stats) {
        const statsDiv = document.getElementById('connection-stats');
        statsDiv.innerHTML = `
            <div class="stats-item">
                <label>Bandwidth In:</label>
                <span>${this.formatBytes(stats.bytesReceived || 0)}/s</span>
            </div>
            <div class="stats-item">
                <label>Bandwidth Out:</label>
                <span>${this.formatBytes(stats.bytesSent || 0)}/s</span>
            </div>
            <div class="stats-item">
                <label>Packets Lost:</label>
                <span>${stats.packetsLost || 0}</span>
            </div>
            <div class="stats-item">
                <label>Round Trip Time:</label>
                <span>${stats.roundTripTime || 0}ms</span>
            </div>
        `;
    }

    // Message and Log Management
    addMessageToHistory(type, sender, content, encrypted = false) {
        const message = {
            type,
            sender,
            content,
            encrypted,
            timestamp: Date.now()
        };

        this.messageHistory.push(message);
        this.displayMessage(message);

        // Keep only last 100 messages
        if (this.messageHistory.length > 100) {
            this.messageHistory = this.messageHistory.slice(-100);
        }
    }

    displayMessage(message) {
        const historyDiv = document.getElementById('message-history');
        
        if (historyDiv.querySelector('.empty-state')) {
            historyDiv.innerHTML = '';
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message-item ${message.type}`;
        
        const encryptionIcon = message.encrypted ? '🔒' : '';
        const typeIcon = this.getMessageTypeIcon(message.type);
        
        // Ensure content is properly formatted for display
        let displayContent = message.content;
        if (typeof displayContent === 'object') {
            displayContent = JSON.stringify(displayContent, null, 2);
        } else if (displayContent === undefined || displayContent === null) {
            displayContent = '(empty message)';
        }
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-type">${typeIcon}</span>
                <span class="message-sender">${message.sender}</span>
                <span class="message-encryption">${encryptionIcon}</span>
                <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="message-content">${displayContent}</div>
        `;

        historyDiv.appendChild(messageDiv);
        historyDiv.scrollTop = historyDiv.scrollHeight;
    }

    getMessageTypeIcon(type) {
        const icons = {
            broadcast: '📢',
            direct: '📧',
            encrypted: '🔐',
            group: '👥',
            system: '⚙️'
        };
        return icons[type] || '💬';
    }

    clearMessageHistory() {
        this.messageHistory = [];
        document.getElementById('message-history').innerHTML = '<p class="empty-state">No messages yet</p>';
    }

    log(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}`;
        
        this.addLogEntry('system-log', logEntry, level);
    }

    logDHT(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}`;
        
        this.addLogEntry('dht-log', logEntry, level);
    }

    logCrypto(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}`;
        
        this.addLogEntry('crypto-log', logEntry, level);
    }

    addLogEntry(logId, message, level = 'info') {
        const logDiv = document.getElementById(logId);
        
        if (logDiv.querySelector('.empty-state')) {
            logDiv.innerHTML = '';
        }

        const entryDiv = document.createElement('div');
        entryDiv.className = `log-entry ${level}`;
        entryDiv.textContent = message;

        logDiv.appendChild(entryDiv);
        logDiv.scrollTop = logDiv.scrollHeight;

        // Keep only last 50 entries per log
        const entries = logDiv.querySelectorAll('.log-entry');
        if (entries.length > 50) {
            entries[0].remove();
        }
    }

    addTestResult(testName, result, level = 'info') {
        const testResult = {
            name: testName,
            result,
            level,
            timestamp: Date.now()
        };

        this.testResults.push(testResult);
        this.displayTestResult(testResult);

        // Keep only last 20 test results
        if (this.testResults.length > 20) {
            this.testResults = this.testResults.slice(-20);
        }
    }

    displayTestResult(testResult) {
        const testLogDiv = document.getElementById('test-log');
        
        if (testLogDiv.querySelector('.empty-state')) {
            testLogDiv.innerHTML = '';
        }

        const resultDiv = document.createElement('div');
        resultDiv.className = `test-result ${testResult.level}`;
        resultDiv.innerHTML = `
            <div class="test-header">${testResult.name}</div>
            <div class="test-content">${testResult.result}</div>
            <div class="test-time">${new Date(testResult.timestamp).toLocaleString()}</div>
        `;

        testLogDiv.appendChild(resultDiv);
        testLogDiv.scrollTop = testLogDiv.scrollHeight;
    }

    clearDHTLog() {
        document.getElementById('dht-log').innerHTML = '<p class="empty-state">No DHT activity yet</p>';
    }

    clearCryptoLog() {
        document.getElementById('crypto-log').innerHTML = '<p class="empty-state">No encryption activity yet</p>';
    }

    clearTestLog() {
        this.testResults = [];
        document.getElementById('test-log').innerHTML = '<p class="empty-state">No test results yet</p>';
    }

    clearSystemLog() {
        document.getElementById('system-log').innerHTML = '<p class="empty-state">System log will appear here...</p>';
    }

    getLogEntries(logId) {
        const logDiv = document.getElementById(logId);
        const entries = logDiv.querySelectorAll('.log-entry');
        return Array.from(entries).map(entry => entry.textContent);
    }

    // Distributed Storage Functions
    async enableDistributedStorage() {
        try {
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available in this mesh instance');
                return;
            }
            
            await this.mesh.distributedStorage.enable();
            this.logStorage('✅ Distributed storage enabled');
            this.updateStorageStatus();
        } catch (error) {
            this.logStorage(`❌ Failed to enable storage: ${error.message}`, 'error');
        }
    }

    async disableDistributedStorage() {
        try {
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available');
                return;
            }
            
            await this.mesh.distributedStorage.disable();
            this.logStorage('⚠️ Distributed storage disabled');
            this.updateStorageStatus();
        } catch (error) {
            this.logStorage(`❌ Failed to disable storage: ${error.message}`, 'error');
        }
    }

    async getStorageStatus() {
        try {
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available');
                return;
            }
            
            const status = await this.mesh.distributedStorage.getStatus();
            this.logStorage(`📊 Storage Status: ${JSON.stringify(status, null, 2)}`);
            
            document.getElementById('storage-result').innerHTML = `
                <h4>Storage Status</h4>
                <pre>${JSON.stringify(status, null, 2)}</pre>
            `;
        } catch (error) {
            this.logStorage(`❌ Failed to get storage status: ${error.message}`, 'error');
        }
    }

    async putStorageData() {
        const key = document.getElementById('storage-key').value.trim();
        const dataText = document.getElementById('storage-data').value.trim();
        const space = document.getElementById('storage-space').value;

        if (!key || !dataText) {
            this.logStorage('❌ Please enter both key and data', 'error');
            return;
        }

        try {
            const data = JSON.parse(dataText);
            
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available');
                return;
            }
            
            const options = {};
            if (space) options.space = space;
            
            await this.mesh.distributedStorage.store(key, data, options);
            this.logStorage(`✅ Stored data with key: ${key} (space: ${space})`);
            
            document.getElementById('storage-result').innerHTML = `
                <h4>Storage Success</h4>
                <p><strong>Key:</strong> ${key}</p>
                <p><strong>Space:</strong> ${space}</p>
                <p><strong>Data:</strong> <pre>${JSON.stringify(data, null, 2)}</pre></p>
            `;
        } catch (error) {
            this.logStorage(`❌ Failed to store data: ${error.message}`, 'error');
        }
    }

    async getStorageData() {
        const key = document.getElementById('storage-key').value.trim();

        if (!key) {
            this.logStorage('❌ Please enter a key to retrieve', 'error');
            return;
        }

        try {
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available');
                return;
            }
            
            const data = await this.mesh.distributedStorage.retrieve(key, { forceRefresh: true });
            this.logStorage(`📥 Retrieved data for key: ${key}`);
            
            document.getElementById('storage-result').innerHTML = `
                <h4>Retrieved Data</h4>
                <p><strong>Key:</strong> ${key}</p>
                <p><strong>Data:</strong> <pre>${JSON.stringify(data, null, 2)}</pre></p>
            `;
        } catch (error) {
            this.logStorage(`❌ Failed to retrieve data: ${error.message}`, 'error');
        }
    }

    async deleteStorageData() {
        const key = document.getElementById('storage-key').value.trim();

        if (!key) {
            this.logStorage('❌ Please enter a key to delete', 'error');
            return;
        }

        if (!confirm(`Are you sure you want to delete the data for key "${key}"?`)) {
            return;
        }

        try {
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available');
                return;
            }
            
            await this.mesh.distributedStorage.delete(key);
            this.logStorage(`🗑️ Deleted data for key: ${key}`);
            
            document.getElementById('storage-result').innerHTML = `
                <h4>Data Deleted</h4>
                <p><strong>Key:</strong> ${key}</p>
                <p>Data has been removed from distributed storage</p>
            `;
        } catch (error) {
            this.logStorage(`❌ Failed to delete data: ${error.message}`, 'error');
        }
    }

    async listStorageKeys() {
        try {
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available');
                return;
            }
            
            const keys = await this.mesh.distributedStorage.listKeys();
            this.logStorage(`📋 Found ${keys.length} stored keys`);
            
            document.getElementById('storage-result').innerHTML = `
                <h4>Stored Keys</h4>
                <ul>
                    ${keys.map(key => `<li>${key}</li>`).join('')}
                </ul>
            `;
        } catch (error) {
            this.logStorage(`❌ Failed to list keys: ${error.message}`, 'error');
        }
    }

    async getStorageStats() {
        try {
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available');
                return;
            }
            
            const stats = await this.mesh.distributedStorage.getStats();
            this.logStorage('📊 Storage statistics retrieved');
            
            document.getElementById('storage-result').innerHTML = `
                <h4>Storage Statistics</h4>
                <pre>${JSON.stringify(stats, null, 2)}</pre>
            `;
        } catch (error) {
            this.logStorage(`❌ Failed to get storage stats: ${error.message}`, 'error');
        }
    }

    async clearAllStorage() {
        if (!confirm('Are you sure you want to clear ALL stored data? This cannot be undone.')) {
            return;
        }

        try {
            if (!this.mesh.distributedStorage) {
                this.logStorage('❌ Distributed storage not available');
                return;
            }
            
            await this.mesh.distributedStorage.clear();
            this.logStorage('🧹 All storage data cleared');
            
            document.getElementById('storage-result').innerHTML = `
                <h4>Storage Cleared</h4>
                <p>All distributed storage data has been removed</p>
            `;
        } catch (error) {
            this.logStorage(`❌ Failed to clear storage: ${error.message}`, 'error');
        }
    }

    logStorage(message, level = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logDiv = document.getElementById('storage-log');
        
        if (logDiv.querySelector('.empty-state')) {
            logDiv.innerHTML = '';
        }

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${level}`;
        logEntry.innerHTML = `[${timestamp}] ${message}`;
        
        logDiv.appendChild(logEntry);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    clearStorageLog() {
        document.getElementById('storage-log').innerHTML = '<p class="empty-state">No storage activity yet</p>';
    }

    updateStorageStatus() {
        // This could be enhanced to show storage status in the UI
        if (this.mesh.distributedStorage) {
            this.logStorage('🔄 Storage status updated');
        }
    }

    // Utility Methods
    checkAndNotifyMediaReadiness() {
        const connectedPeers = this.getConnectedPeers();
        if (connectedPeers.length === 0) return;

        // Check that ALL connected peers have data channels ready AND keys exchanged
        const peersWithDataChannels = connectedPeers.filter(peer => 
            this.mesh.connectionManager && this.mesh.connectionManager.peers && this.mesh.connectionManager.peers.get(peer.id)?.dataChannelReady === true
        );
        
        const peersWithKeys = connectedPeers.filter(peer => 
            this.mesh.cryptoManager && this.mesh.cryptoManager.peerKeys && this.mesh.cryptoManager.peerKeys.get(peer.id)
        );
        
        if (peersWithDataChannels.length === connectedPeers.length && 
            peersWithKeys.length === connectedPeers.length) {
            this.log(`✅ MEDIA READY: All ${connectedPeers.length} peers have data channels + key exchange complete. You can now safely start media!`, 'success');
        }
    }

    formatUptime(milliseconds) {
        if (!milliseconds) return '0s';
        
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }
}

// Initialize the test suite when the page loads
let testSuite;

window.addEventListener('DOMContentLoaded', () => {
    testSuite = new PeerPigeonTestSuite();
    // Make testSuite globally available for testing
    window.peerPigeonTestSuite = testSuite;
    window.testSuite = testSuite;
});
