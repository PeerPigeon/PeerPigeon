// Updated: 2025-07-04 - Fixed getConnectionStatus method name
export class PeerPigeonUI {
    constructor(mesh) {
        this.mesh = mesh;
        this.lastCleanupTime = 0; // Track when we last did cleanup
        this.setupEventListeners();
        this.bindDOMEvents();
        this.initializeMedia();
   }

    setupEventListeners() {
        this.mesh.addEventListener('statusChanged', (data) => {
            this.handleStatusChange(data);
        });

        this.mesh.addEventListener('peerDiscovered', (data) => {
            this.updateDiscoveredPeers();
        });

        this.mesh.addEventListener('peerConnected', (data) => {
            this.updateUI();
            this.updateDiscoveredPeers();
        });

        this.mesh.addEventListener('peerDisconnected', (data) => {
            this.addMessage('System', `Peer ${data.peerId.substring(0, 8)}... disconnected (${data.reason})`);
            this.updateUI();
            this.updateDiscoveredPeers();
        });

        this.mesh.addEventListener('messageReceived', (data) => {
            // Only show messages from other peers, not self
            if (data.from !== this.mesh.peerId) {
                if (data.direct) {
                    this.addMessage(`${data.from.substring(0, 8)}...`, `(DM) ${data.content}`, 'dm');
                } else {
                    this.addMessage(`${data.from.substring(0, 8)}...`, data.content);
                }
            }
        });

        this.mesh.addEventListener('peerEvicted', (data) => {
            this.updateUI();
            this.updateDiscoveredPeers();
        });

        this.mesh.addEventListener('peersUpdated', () => {
            this.updateDiscoveredPeers();
        });

        this.mesh.addEventListener('connectionStats', (stats) => {
            // Handle connection stats if needed
        });

        // DHT event listeners
        this.mesh.addEventListener('dhtValueChanged', (data) => {
            const { key, newValue, timestamp } = data;
            this.addDHTLogEntry(`🔔 Value Changed: ${key} = ${JSON.stringify(newValue)} (timestamp: ${timestamp})`);
        });

        // Media event listeners
        this.mesh.addEventListener('localStreamStarted', (data) => {
            this.handleLocalStreamStarted(data);
        });

        this.mesh.addEventListener('localStreamStopped', () => {
            this.handleLocalStreamStopped();
        });

        this.mesh.addEventListener('mediaError', (data) => {
            this.addMessage('System', `Media error: ${data.error.message}`, 'error');
        });

        // Listen for remote streams
        this.mesh.addEventListener('remoteStream', (data) => {
            this.handleRemoteStream(data);
        });
    }

    handleStatusChange(data) {
        switch (data.type) {
            case 'initialized':
                this.updateUI();
                break;
            case 'connecting':
                this.addMessage('System', 'Connecting to signaling server...');
                this.updateUI();
                break;
            case 'connected':
                this.addMessage('System', 'Connected to signaling server');
                this.updateUI();
                break;
            case 'disconnected':
                this.addMessage('System', 'Disconnected from signaling server');
                this.updateUI();
                this.updateDiscoveredPeers();
                break;
            case 'error':
                this.addMessage('System', data.message, 'error');
                this.updateUI();
                break;
            case 'warning':
                this.addMessage('System', data.message, 'warning');
                break;
            case 'info':
                this.addMessage('System', data.message);
                break;
            case 'urlLoaded':
                document.getElementById('signaling-url').value = data.signalingUrl;
                this.addMessage('System', `API Gateway URL loaded: ${data.signalingUrl}`);
                break;
            case 'setting':
                const settingName = data.setting === 'autoDiscovery' ? 'Auto discovery' : 
                                   data.setting === 'evictionStrategy' ? 'Smart eviction strategy' :
                                   data.setting === 'xorRouting' ? 'XOR-based routing' :
                                   data.setting === 'connectionType' ? 'Connection type' : data.setting;
                                   
                if (data.setting === 'connectionType') {
                    this.addMessage('System', `${settingName} set to: ${data.value}`);
                } else {
                    this.addMessage('System', `${settingName} ${data.value ? 'enabled' : 'disabled'}`);
                }
                break;
        }
    }

    bindDOMEvents() {
        // Connection controls
        document.getElementById('connect-btn').addEventListener('click', () => {
            this.handleConnect();
        });

        document.getElementById('disconnect-btn').addEventListener('click', () => {
            this.handleDisconnect();
        });

        document.getElementById('cleanup-btn').addEventListener('click', () => {
            this.handleCleanup();
        });

        document.getElementById('health-check-btn').addEventListener('click', () => {
            this.handleHealthCheck();
        });

        document.getElementById('refresh-btn').addEventListener('click', () => {
            window.location.reload();
        });

        // Messaging
        document.getElementById('send-message-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // Manual connection
        document.getElementById('connect-peer-btn').addEventListener('click', () => {
            this.connectToPeer();
        });

        document.getElementById('target-peer').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.connectToPeer();
            }
        });

        // Settings
        document.getElementById('min-peers').addEventListener('change', (e) => {
            this.mesh.setMinPeers(parseInt(e.target.value));
        });

        document.getElementById('max-peers').addEventListener('change', (e) => {
            this.mesh.setMaxPeers(parseInt(e.target.value));
        });

        document.getElementById('auto-discovery-toggle').addEventListener('change', (e) => {
            this.mesh.setAutoDiscovery(e.target.checked);
        });

        document.getElementById('eviction-strategy-toggle').addEventListener('change', (e) => {
            this.mesh.setEvictionStrategy(e.target.checked);
        });

        document.getElementById('xor-routing-toggle').addEventListener('change', (e) => {
            this.mesh.setXorRouting(e.target.checked);
        });

        // DHT controls
        this.setupDHTControls();

        // Collapsible sections
        this.setupCollapsibleSections();

        // Media controls
        this.setupMediaControls();
    }

    setupDHTControls() {
        // DHT input fields and controls
        const dhtKey = document.getElementById('dht-key');
        const dhtValue = document.getElementById('dht-value');
        const dhtGetKey = document.getElementById('dht-get-key'); // Separate key field for retrieval
        const dhtPutBtn = document.getElementById('dht-put-btn');
        const dhtUpdateBtn = document.getElementById('dht-update-btn');
        const dhtGetBtn = document.getElementById('dht-get-btn');
        const dhtSubscribeBtn = document.getElementById('dht-subscribe-btn');
        const dhtUnsubscribeBtn = document.getElementById('dht-unsubscribe-btn');
        const dhtEnableTtl = document.getElementById('dht-enable-ttl');
        const dhtTtlGroup = document.getElementById('dht-ttl-group');
        const dhtTtl = document.getElementById('dht-ttl');

        // Debug: Check if elements are found
        console.log('DHT Controls setup - Elements found:', {
            dhtKey: !!dhtKey,
            dhtValue: !!dhtValue,
            dhtGetKey: !!dhtGetKey,
            dhtPutBtn: !!dhtPutBtn,
            dhtUpdateBtn: !!dhtUpdateBtn,
            dhtGetBtn: !!dhtGetBtn,
            dhtSubscribeBtn: !!dhtSubscribeBtn,
            dhtUnsubscribeBtn: !!dhtUnsubscribeBtn
        });
        
        if (!dhtKey) {
            console.error('DHT key input element not found!');
            this.addDHTLogEntry('❌ Error: DHT key input field not found in DOM');
        }
        
        if (!dhtValue) {
            console.error('DHT value input element not found!');
            this.addDHTLogEntry('❌ Error: DHT value input field not found in DOM');
        }
        
        if (!dhtGetKey) {
            console.error('DHT get-key input element not found!');
            this.addDHTLogEntry('❌ Error: DHT get-key input field not found in DOM');
        }

        // Toggle TTL input visibility
        if (dhtEnableTtl && dhtTtlGroup) {
            dhtEnableTtl.addEventListener('change', (e) => {
                dhtTtlGroup.style.display = e.target.checked ? 'block' : 'none';
            });
        }

        // Store in DHT
        if (dhtPutBtn) {
            dhtPutBtn.addEventListener('click', async () => {
                const key = dhtKey?.value?.trim();
                const value = dhtValue?.value?.trim();
                
                // Debug logging
                console.log('DHT PUT - Elements found:', {
                    dhtKey: !!dhtKey,
                    dhtValue: !!dhtValue,
                    keyValue: key,
                    valueValue: value
                });
                
                if (!key || !value) {
                    this.addDHTLogEntry('❌ Error: Both key and value are required');
                    this.addDHTLogEntry(`   Debug: key="${key}", value="${value}"`);
                    return;
                }

                if (!this.mesh.isDHTEnabled()) {
                    this.addDHTLogEntry('❌ Error: WebDHT is disabled');
                    return;
                }

                try {
                    let parsedValue;
                    try {
                        parsedValue = JSON.parse(value);
                    } catch {
                        parsedValue = value; // Use as string if not valid JSON
                    }

                    const options = {};
                    if (dhtEnableTtl?.checked && dhtTtl?.value) {
                        options.ttl = parseInt(dhtTtl.value) * 1000; // Convert to milliseconds
                    }

                    const success = await this.mesh.dhtPut(key, parsedValue, options);
                    if (success) {
                        this.addDHTLogEntry(`✅ Stored: ${key} = ${JSON.stringify(parsedValue)}`);
                        if (options.ttl) {
                            this.addDHTLogEntry(`   TTL: ${options.ttl / 1000} seconds`);
                        }
                        this.addDHTLogEntry(`   🏆 This peer is now an ORIGINAL STORING PEER for "${key}"`);
                        
                        // Auto-subscribe to the key we just stored (essential for original storing peers)
                        try {
                            await this.mesh.dhtSubscribe(key);
                            this.addDHTLogEntry(`🔔 Auto-subscribed as original storing peer: ${key}`);
                            this.addDHTLogEntry(`   📡 Will receive and relay all future updates for this key`);
                        } catch (subscribeError) {
                            this.addDHTLogEntry(`⚠️ Failed to auto-subscribe to ${key}: ${subscribeError.message}`);
                        }
                    } else {
                        this.addDHTLogEntry(`❌ Failed to store: ${key}`);
                    }
                } catch (error) {
                    this.addDHTLogEntry(`❌ Error storing ${key}: ${error.message}`);
                }
            });
        }

        // Update in DHT
        if (dhtUpdateBtn) {
            dhtUpdateBtn.addEventListener('click', async () => {
                const key = dhtKey?.value?.trim();
                const value = dhtValue?.value?.trim();
                
                // Debug logging
                console.log('DHT UPDATE - Elements found:', {
                    dhtKey: !!dhtKey,
                    dhtValue: !!dhtValue,
                    keyValue: key,
                    valueValue: value
                });
                
                if (!key || !value) {
                    this.addDHTLogEntry('❌ Error: Both key and value are required');
                    this.addDHTLogEntry(`   Debug: key="${key}", value="${value}"`);
                    return;
                }

                if (!this.mesh.isDHTEnabled()) {
                    this.addDHTLogEntry('❌ Error: WebDHT is disabled');
                    return;
                }

                try {
                    let parsedValue;
                    try {
                        parsedValue = JSON.parse(value);
                    } catch {
                        parsedValue = value; // Use as string if not valid JSON
                    }

                    const options = {};
                    if (dhtEnableTtl?.checked && dhtTtl?.value) {
                        options.ttl = parseInt(dhtTtl.value) * 1000; // Convert to milliseconds
                    }

                    const success = await this.mesh.dhtUpdate(key, parsedValue, options);
                    if (success) {
                        this.addDHTLogEntry(`🔄 Updated: ${key} = ${JSON.stringify(parsedValue)}`);
                        if (options.ttl) {
                            this.addDHTLogEntry(`   TTL: ${options.ttl / 1000} seconds`);
                        }
                        this.addDHTLogEntry(`   🏆 This peer is now an ORIGINAL STORING PEER for "${key}"`);
                        
                        // Auto-subscribe to the key we just updated (essential for original storing peers)
                        try {
                            await this.mesh.dhtSubscribe(key);
                            this.addDHTLogEntry(`🔔 Auto-subscribed as original storing peer: ${key}`);
                            this.addDHTLogEntry(`   📡 Will receive and relay all future updates for this key`);
                        } catch (subscribeError) {
                            this.addDHTLogEntry(`⚠️ Failed to auto-subscribe to ${key}: ${subscribeError.message}`);
                        }
                    } else {
                        this.addDHTLogEntry(`❌ Failed to update: ${key}`);
                    }
                } catch (error) {
                    this.addDHTLogEntry(`❌ Error updating ${key}: ${error.message}`);
                }
            });
        }

        // Get from DHT
        if (dhtGetBtn) {
            dhtGetBtn.addEventListener('click', async () => {
                const key = dhtGetKey?.value?.trim(); // Fixed: Use dhtGetKey instead of dhtKey
                
                // Debug logging
                console.log('DHT GET - Elements found:', {
                    dhtGetKey: !!dhtGetKey,
                    keyValue: key
                });
                
                if (!key) {
                    this.addDHTLogEntry('❌ Error: Key is required');
                    this.addDHTLogEntry(`   Debug: key="${key}"`);
                    return;
                }

                if (!this.mesh.isDHTEnabled()) {
                    this.addDHTLogEntry('❌ Error: WebDHT is disabled');
                    return;
                }

                try {
                    this.addDHTLogEntry(`🔍 Fetching from ORIGINAL STORING PEERS: ${key}`);
                    this.addDHTLogEntry(`   📡 Bypassing local cache to ensure fresh data`);
                    
                    // Force fresh retrieval from original storing peers
                    const value = await this.mesh.dhtGet(key, { forceRefresh: true });
                    if (value !== null) {
                        this.addDHTLogEntry(`📥 Retrieved from original peers: ${key} = ${JSON.stringify(value)}`);
                        this.addDHTLogEntry(`   ✅ Data is FRESH from authoritative source`);
                        if (dhtValue) {
                            dhtValue.value = typeof value === 'string' ? value : JSON.stringify(value);
                        }
                        
                        // Auto-subscribe to the key we just retrieved for future updates
                        try {
                            await this.mesh.dhtSubscribe(key);
                            this.addDHTLogEntry(`🔔 Auto-subscribed for future updates: ${key}`);
                            this.addDHTLogEntry(`   📡 Will receive notifications when original peers update this key`);
                        } catch (subscribeError) {
                            this.addDHTLogEntry(`⚠️ Failed to auto-subscribe to ${key}: ${subscribeError.message}`);
                        }
                    } else {
                        this.addDHTLogEntry(`❌ Not found on original storing peers: ${key}`);
                        this.addDHTLogEntry(`   💡 Key may not exist or all original storing peers are offline`);
                    }
                } catch (error) {
                    this.addDHTLogEntry(`❌ Error retrieving ${key}: ${error.message}`);
                }
            });
        }

        // Subscribe to DHT key
        if (dhtSubscribeBtn) {
            dhtSubscribeBtn.addEventListener('click', async () => {
                // Check both key fields - use whichever has a value
                const putKey = dhtKey?.value?.trim();
                const getKey = dhtGetKey?.value?.trim();
                const key = putKey || getKey;
                
                if (!key) {
                    this.addDHTLogEntry('❌ Error: Key is required (enter key in either Put/Update or Get field)');
                    return;
                }

                if (!this.mesh.isDHTEnabled()) {
                    this.addDHTLogEntry('❌ Error: WebDHT is disabled');
                    return;
                }

                try {
                    this.addDHTLogEntry(`🔔 Explicitly subscribing to key: ${key}`);
                    this.addDHTLogEntry(`   📡 Will receive notifications when original storing peers update this key`);
                    
                    const value = await this.mesh.dhtSubscribe(key);
                    this.addDHTLogEntry(`✅ Subscribed to: ${key}`);
                    if (value !== null) {
                        this.addDHTLogEntry(`   Current value from original storing peers: ${JSON.stringify(value)}`);
                        if (dhtValue) {
                            dhtValue.value = typeof value === 'string' ? value : JSON.stringify(value);
                        }
                    } else {
                        this.addDHTLogEntry(`   No current value found on original storing peers`);
                    }
                } catch (error) {
                    this.addDHTLogEntry(`❌ Error subscribing to ${key}: ${error.message}`);
                }
            });
        }

        // Unsubscribe from DHT key
        if (dhtUnsubscribeBtn) {
            dhtUnsubscribeBtn.addEventListener('click', async () => {
                // Check both key fields - use whichever has a value
                const putKey = dhtKey?.value?.trim();
                const getKey = dhtGetKey?.value?.trim();
                const key = putKey || getKey;
                
                if (!key) {
                    this.addDHTLogEntry('❌ Error: Key is required (enter key in either Put/Update or Get field)');
                    return;
                }

                if (!this.mesh.isDHTEnabled()) {
                    this.addDHTLogEntry('❌ Error: WebDHT is disabled');
                    return;
                }

                try {
                    await this.mesh.dhtUnsubscribe(key);
                    this.addDHTLogEntry(`🔕 Unsubscribed from: ${key}`);
                } catch (error) {
                    this.addDHTLogEntry(`❌ Error unsubscribing from ${key}: ${error.message}`);
                }
            });
        }
    }

    setupMediaControls() {
        // Start media button
        document.getElementById('start-media-btn').addEventListener('click', async () => {
            await this.startMedia();
        });

        // Stop media button
        document.getElementById('stop-media-btn').addEventListener('click', async () => {
            await this.stopMedia();
        });

        // Toggle video button
        document.getElementById('toggle-video-btn').addEventListener('click', () => {
            this.toggleVideo();
        });

        // Toggle audio button
        document.getElementById('toggle-audio-btn').addEventListener('click', () => {
            this.toggleAudio();
        });

        // Audio test button
        document.getElementById('test-audio-btn').addEventListener('click', () => {
            this.testAudio();
        });

        // Media type checkboxes
        document.getElementById('enable-video').addEventListener('change', () => {
            this.updateMediaButtonStates();
        });

        document.getElementById('enable-audio').addEventListener('change', () => {
            this.updateMediaButtonStates();
        });

        // Device selection dropdowns
        document.getElementById('camera-select').addEventListener('change', () => {
            // Auto-restart media if it's currently active
            if (this.mesh.getMediaState().hasLocalStream) {
                this.startMedia();
            }
        });

        document.getElementById('microphone-select').addEventListener('change', () => {
            // Auto-restart media if it's currently active
            if (this.mesh.getMediaState().hasLocalStream) {
                this.startMedia();
            }
        });
    }

    setupCollapsibleSections() {
        const sections = [
            'discovered-peers',
            'connected-peers',
            'manual-connection',
            'settings',
            'dht',
            'media'
        ];

        sections.forEach(sectionId => {
            const toggle = document.getElementById(`${sectionId}-toggle`);
            const content = document.getElementById(`${sectionId}-content`);
            
            if (toggle && content) {
                toggle.addEventListener('click', () => {
                    this.toggleSection(sectionId);
                });
            }
        });
    }

    toggleSection(sectionId) {
        const toggle = document.getElementById(`${sectionId}-toggle`);
        const content = document.getElementById(`${sectionId}-content`);
        
        if (!toggle || !content) {
            console.warn(`Could not find elements for section: ${sectionId}`);
            return;
        }
        
        const section = toggle.closest(`.${sectionId}`);
        
        if (!section) {
            console.warn(`Could not find section container for: ${sectionId}`, {
                toggle: toggle,
                toggleParent: toggle.parentElement,
                toggleParentParent: toggle.parentElement?.parentElement,
                classList: toggle.parentElement?.parentElement?.classList
            });
            return;
        }
        
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        
        toggle.setAttribute('aria-expanded', !isExpanded);
        
        // Add null check before calling setAttribute
        if (section) {
            section.setAttribute('aria-expanded', !isExpanded);
        }
        
        if (isExpanded) {
            content.style.display = 'none';
            toggle.textContent = toggle.textContent.replace('▼', '▶');
        } else {
            content.style.display = 'block';
            toggle.textContent = toggle.textContent.replace('▶', '▼');
        }
    }

    // Media-related methods
    async initializeMedia() {
        try {
            // Initialize media manager
            await this.mesh.initializeMedia();
            
            // Populate device lists
            await this.updateDeviceLists();
            
            // Update button states
            this.updateMediaButtonStates();
            
            console.log('Media initialized successfully');
        } catch (error) {
            console.error('Failed to initialize media:', error);
            this.addMessage('System', `Failed to initialize media: ${error.message}`, 'error');
        }
    }

    async updateDeviceLists() {
        try {
            const devices = await this.mesh.enumerateMediaDevices();
            
            // Update camera list
            const cameraSelect = document.getElementById('camera-select');
            if (cameraSelect) {
                cameraSelect.innerHTML = '<option value="">Select camera...</option>';
                devices.cameras.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.textContent = device.label || `Camera ${device.deviceId.substring(0, 8)}...`;
                    cameraSelect.appendChild(option);
                });
                cameraSelect.disabled = devices.cameras.length === 0;
            }
            
            // Update microphone list
            const micSelect = document.getElementById('microphone-select');
            if (micSelect) {
                micSelect.innerHTML = '<option value="">Select microphone...</option>';
                devices.microphones.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.textContent = device.label || `Microphone ${device.deviceId.substring(0, 8)}...`;
                    micSelect.appendChild(option);
                });
                micSelect.disabled = devices.microphones.length === 0;
            }
            
        } catch (error) {
            console.error('Failed to update device lists:', error);
        }
    }

    updateMediaButtonStates() {
        const videoEnabled = document.getElementById('enable-video')?.checked || false;
        const audioEnabled = document.getElementById('enable-audio')?.checked || false;
        const mediaState = this.mesh.getMediaState();
        
        // Enable start button if at least one media type is selected
        const startBtn = document.getElementById('start-media-btn');
        if (startBtn) {
            startBtn.disabled = !(videoEnabled || audioEnabled) || mediaState.hasLocalStream;
        }
        
        // Enable stop button if media is active
        const stopBtn = document.getElementById('stop-media-btn');
        if (stopBtn) {
            stopBtn.disabled = !mediaState.hasLocalStream;
        }
        
        // Enable toggle buttons if media is active
        const toggleVideoBtn = document.getElementById('toggle-video-btn');
        const toggleAudioBtn = document.getElementById('toggle-audio-btn');
        
        if (toggleVideoBtn) {
            toggleVideoBtn.disabled = !mediaState.hasLocalStream;
            toggleVideoBtn.textContent = mediaState.videoEnabled ? 'Turn Off Video' : 'Turn On Video';
        }
        
        if (toggleAudioBtn) {
            toggleAudioBtn.disabled = !mediaState.hasLocalStream;
            toggleAudioBtn.textContent = mediaState.audioEnabled ? 'Turn Off Audio' : 'Turn On Audio';
        }
    }

    // Media event handlers
    handleLocalStreamStarted(data) {
        console.log('Local stream started:', data);
        this.addMessage('System', 'Local media stream started');
        
        // Display local video if it exists
        const { stream } = data;
        if (stream) {
            const videoTracks = stream.getVideoTracks();
            if (videoTracks.length > 0) {
                this.displayLocalVideo(stream);
            }
        }
        
        this.updateMediaButtonStates();
    }

    handleLocalStreamStopped() {
        console.log('Local stream stopped');
        this.addMessage('System', 'Local media stream stopped');
        
        // Clear local video display
        this.clearLocalVideo();
        this.updateMediaButtonStates();
    }

    handleRemoteStream(data) {
        const { peerId, stream } = data;
        console.log('Remote stream received from:', peerId);
        
        // Validate the remote stream to prevent loops
        if (this.validateRemoteStream(peerId, stream)) {
            this.addMessage('System', `Received media stream from peer ${peerId.substring(0, 8)}...`);
            this.displayRemoteVideo(peerId, stream);
        } else {
            console.warn('Remote stream validation failed for peer:', peerId);
        }
    }

    /**
     * Enhanced validation to prevent media stream synchronization loops in the UI
     */
    validateRemoteStream(peerId, stream) {
        // Check 1: Prevent receiving our own stream
        if (peerId === this.mesh.peerId) {
            console.error('🚨 LOOPBACK DETECTED: Received our own stream as remote!');
            console.error('Peer ID:', peerId, 'vs Our ID:', this.mesh.peerId);
            return false;
        }

        // Check 2: Verify stream is marked as remote origin
        if (stream._peerPigeonOrigin === 'local') {
            console.error('🚨 SYNCHRONIZATION LOOP DETECTED: Stream marked as local origin!');
            console.error('Stream ID:', stream.id, 'Origin:', stream._peerPigeonOrigin);
            return false;
        }

        // Check 3: Compare with our local stream
        const localStream = this.mesh.getLocalStream();
        if (localStream && stream.id === localStream.id) {
            console.error('🚨 STREAM ID COLLISION: Remote stream has same ID as local stream!');
            console.error('Local stream ID:', localStream.id, 'Remote stream ID:', stream.id);
            return false;
        }

        // Check 4: Track-level validation
        if (localStream) {
            const localTracks = localStream.getTracks();
            const remoteTracks = stream.getTracks();
            
            for (const remoteTrack of remoteTracks) {
                const isOwnTrack = localTracks.some(localTrack => localTrack.id === remoteTrack.id);
                if (isOwnTrack) {
                    console.error('🚨 TRACK LOOPBACK: Remote track matches local track!');
                    console.error('Track ID:', remoteTrack.id, 'Kind:', remoteTrack.kind);
                    return false;
                }
            }
        }

        console.log('✅ Remote stream validation passed for peer', peerId.substring(0, 8));
        return true;
    }

    // Media control methods
    async startMedia() {
        try {
            const videoEnabled = document.getElementById('enable-video')?.checked || false;
            const audioEnabled = document.getElementById('enable-audio')?.checked || false;
            
            if (!videoEnabled && !audioEnabled) {
                this.addMessage('System', 'Please enable at least video or audio before starting media', 'warning');
                return;
            }

            // Get selected device IDs
            const cameraSelect = document.getElementById('camera-select');
            const micSelect = document.getElementById('microphone-select');
            
            const deviceIds = {};
            if (cameraSelect?.value) {
                deviceIds.camera = cameraSelect.value;
            }
            if (micSelect?.value) {
                deviceIds.microphone = micSelect.value;
            }

            this.addMessage('System', 'Starting media stream...');
            const stream = await this.mesh.startMedia({ 
                video: videoEnabled, 
                audio: audioEnabled,
                deviceIds 
            });
            
            console.log('Media stream started successfully:', stream);
            this.updateMediaButtonStates();
            
        } catch (error) {
            console.error('Failed to start media:', error);
            this.addMessage('System', `Failed to start media: ${error.message}`, 'error');
        }
    }

    async stopMedia() {
        try {
            this.addMessage('System', 'Stopping media stream...');
            await this.mesh.stopMedia();
            this.updateMediaButtonStates();
            
        } catch (error) {
            console.error('Failed to stop media:', error);
            this.addMessage('System', `Failed to stop media: ${error.message}`, 'error');
        }
    }

    toggleVideo() {
        try {
            const isEnabled = this.mesh.toggleVideo();
            this.addMessage('System', `Video ${isEnabled ? 'enabled' : 'disabled'}`);
            this.updateMediaButtonStates();
            
        } catch (error) {
            console.error('Failed to toggle video:', error);
            this.addMessage('System', `Failed to toggle video: ${error.message}`, 'error');
        }
    }

    toggleAudio() {
        try {
            const isEnabled = this.mesh.toggleAudio();
            this.addMessage('System', `Audio ${isEnabled ? 'enabled' : 'disabled'}`);
            this.updateMediaButtonStates();
            
        } catch (error) {
            console.error('Failed to toggle audio:', error);
            this.addMessage('System', `Failed to toggle audio: ${error.message}`, 'error');
        }
    }

    testAudio() {
        try {
            // Create a simple audio test tone
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A note
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5); // Play for 0.5 seconds
            
            this.addMessage('System', 'Playing audio test tone (440Hz for 0.5s)');
            
        } catch (error) {
            console.error('Failed to test audio:', error);
            this.addMessage('System', `Audio test failed: ${error.message}`, 'error');
        }
    }

    // Video display methods
    displayLocalVideo(stream) {
        const container = document.getElementById('local-video-container');
        if (!container) return;

        // Remove existing video
        const existingVideo = container.querySelector('video');
        if (existingVideo) {
            existingVideo.remove();
        }

        // Create new video element
        const videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.muted = true; // Prevent feedback
        videoElement.style.width = '100%';
        videoElement.style.height = 'auto';
        videoElement.style.borderRadius = '8px';
        
        videoElement.srcObject = stream;
        container.innerHTML = ''; // Clear placeholder text
        container.appendChild(videoElement);
    }

    clearLocalVideo() {
        const container = document.getElementById('local-video-container');
        if (container) {
            container.innerHTML = '<p class="video-placeholder">No video stream</p>';
        }
    }

    displayRemoteVideo(peerId, stream) {
        // Find or create remote videos container
        const remoteVideosContainer = document.getElementById('remote-videos-container') || document.getElementById('remote-videos');
        if (!remoteVideosContainer) {
            console.warn('Remote videos container not found');
            return;
        }

        // Remove placeholder if it exists
        const placeholder = remoteVideosContainer.querySelector('.video-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // Check if video element for this peer already exists
        let videoElement = remoteVideosContainer.querySelector(`video[data-peer-id="${peerId}"]`);
        
        if (!videoElement) {
            // Create new video element for this peer
            videoElement = document.createElement('video');
            videoElement.setAttribute('data-peer-id', peerId);
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.controls = true;
            videoElement.style.width = '300px';
            videoElement.style.height = 'auto';
            videoElement.style.margin = '10px';
            videoElement.style.border = '2px solid #333';
            videoElement.style.borderRadius = '8px';
            videoElement.style.backgroundColor = '#000';
            
            // Add peer label
            const peerLabel = document.createElement('div');
            peerLabel.style.textAlign = 'center';
            peerLabel.style.fontSize = '12px';
            peerLabel.style.color = '#666';
            peerLabel.style.marginBottom = '5px';
            peerLabel.textContent = `Peer: ${peerId.substring(0, 8)}...`;
            
            // Create container for this peer's video
            const peerContainer = document.createElement('div');
            peerContainer.style.display = 'inline-block';
            peerContainer.style.margin = '10px';
            peerContainer.appendChild(peerLabel);
            peerContainer.appendChild(videoElement);
            
            remoteVideosContainer.appendChild(peerContainer);
        }
        
        // Set the stream
        videoElement.srcObject = stream;
        
        console.log(`Displaying remote video from peer ${peerId.substring(0, 8)}...`);
    }

    removeRemoteVideo(peerId) {
        const remoteVideosContainer = document.getElementById('remote-videos-container') || document.getElementById('remote-videos');
        if (!remoteVideosContainer) return;

        // Find and remove the video element for this peer
        const videoElement = remoteVideosContainer.querySelector(`video[data-peer-id="${peerId}"]`);
        if (videoElement) {
            const peerContainer = videoElement.parentElement;
            if (peerContainer) {
                peerContainer.remove();
            } else {
                videoElement.remove();
            }
            
            console.log(`Removed remote video from peer ${peerId.substring(0, 8)}...`);
            
            // Add placeholder back if no more videos
            const remainingVideos = remoteVideosContainer.querySelectorAll('video');
            if (remainingVideos.length === 0) {
                const placeholder = document.createElement('p');
                placeholder.className = 'video-placeholder';
                placeholder.textContent = 'No remote video streams';
                remoteVideosContainer.appendChild(placeholder);
            }
        }
    }
}