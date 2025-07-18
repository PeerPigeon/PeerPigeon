import { EventEmitter } from './EventEmitter.js';

export class PeerConnection extends EventEmitter {
    constructor(peerId, isInitiator = false, options = {}) {
        super();
        this.peerId = peerId;
        this.isInitiator = isInitiator;
        this.connection = null;
        this.dataChannel = null;
        this.remoteDescriptionSet = false;
        this.dataChannelReady = false;
        this.connectionStartTime = Date.now();
        this.pendingIceCandidates = [];
        this.iceCheckingTimeout = null; // Timeout for ICE checking state
        this.connectingTimeout = null; // Timeout for stuck connecting state
        this.isClosing = false; // Flag to prevent disconnection events during intentional close
        this._forcedStatus = null; // Track forced status (e.g., failed)
        
        // Media stream support
        this.localStream = options.localStream || null;
        this.remoteStream = null;
        this.enableVideo = options.enableVideo || false;
        this.enableAudio = options.enableAudio || false;
    }

    /**
     * Force this connection into a terminal state (e.g., failed/timeout)
     */
    markAsFailed(reason = 'failed') {
        this._forcedStatus = reason;
        try {
            this.close();
        } catch (e) {}
    }

    async createConnection() {
        this.connection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        this.setupConnectionHandlers();

        // Pre-allocate placeholder transceivers for audio and video to avoid m-line order issues
        // This ensures consistent SDP structure even when media is added later
        console.log('🔄 Pre-allocating transceivers for stable media negotiation');
        
        // Add audio transceiver (inactive initially) - start with recvonly to avoid conflicts
        this.audioTransceiver = this.connection.addTransceiver('audio', {
            direction: 'recvonly'
        });
        
        // Add video transceiver (inactive initially) - for future use
        this.videoTransceiver = this.connection.addTransceiver('video', {
            direction: 'recvonly'
        });

        // Add local media stream if provided
        if (this.localStream) {
            console.log('Adding local stream tracks to existing transceivers');
            await this.setLocalStreamToTransceivers(this.localStream);
        }

        if (this.isInitiator) {
            this.dataChannel = this.connection.createDataChannel('messages', {
                ordered: true
            });
            this.setupDataChannel();
        } else {
            this.connection.ondatachannel = (event) => {
                console.log('Received data channel from', this.peerId);
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };
        }
    }

    setupConnectionHandlers() {
        this.connection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`🧊 Generated ICE candidate for ${this.peerId.substring(0, 8)}...`, {
                    type: event.candidate.type,
                    protocol: event.candidate.protocol,
                    address: event.candidate.address?.substring(0, 10) + '...' || 'unknown'
                });
                this.emit('iceCandidate', { peerId: this.peerId, candidate: event.candidate });
            } else {
                console.log(`🧊 ICE gathering complete for ${this.peerId.substring(0, 8)}...`);
            }
        };

        // Handle remote media streams
        this.connection.ontrack = (event) => {
            console.log('🎵 Received remote media stream from', this.peerId);
            const stream = event.streams[0];
            const track = event.track;
            
            console.log(`🎵 Track received: kind=${track.kind}, id=${track.id}, enabled=${track.enabled}, readyState=${track.readyState}`);
            
            // CRITICAL: Check if this is actually a remote stream or our own local stream
            if (this.localStream && stream.id === this.localStream.id) {
                console.error('❌ LOOPBACK DETECTED: Received our own local stream as remote!');
                console.error('Local stream ID:', this.localStream.id);
                console.error('Received stream ID:', stream.id);
                return; // Don't process our own stream as remote
            }
            
            if (stream) {
                this.remoteStream = stream;
                const audioTracks = stream.getAudioTracks();
                const videoTracks = stream.getVideoTracks();
                
                console.log(`🎵 Remote stream tracks: ${audioTracks.length} audio, ${videoTracks.length} video`);
                console.log(`🎵 Remote stream ID: ${stream.id} (vs local: ${this.localStream?.id || 'none'})`);
                
                audioTracks.forEach((audioTrack, index) => {
                    console.log(`🎵 Audio track ${index}: enabled=${audioTrack.enabled}, readyState=${audioTrack.readyState}, muted=${audioTrack.muted}, id=${audioTrack.id}`);
                    
                    // Check if this track ID matches any of our local tracks
                    if (this.localStream) {
                        const localAudioTracks = this.localStream.getAudioTracks();
                        const isOwnTrack = localAudioTracks.some(localTrack => localTrack.id === audioTrack.id);
                        if (isOwnTrack) {
                            console.error('❌ LOOPBACK: This audio track is our own local track!');
                        }
                    }
                    
                    // Add audio data monitoring
                    this.setupAudioDataMonitoring(audioTrack, index);
                });
                
                this.emit('remoteStream', { peerId: this.peerId, stream: this.remoteStream });
            }
        };

        this.connection.onconnectionstatechange = () => {
            console.log(`🔗 Connection state with ${this.peerId}: ${this.connection.connectionState} (previous signaling: ${this.connection.signalingState})`);
            
            // Log additional context about transceivers and media
            const transceivers = this.connection.getTransceivers();
            const audioSending = this.audioTransceiver && this.audioTransceiver.sender.track;
            const videoSending = this.videoTransceiver && this.videoTransceiver.sender.track;
            console.log(`🔗 Media context: Audio sending=${!!audioSending}, Video sending=${!!videoSending}, Transceivers=${transceivers.length}`);
            
            if (this.connection.connectionState === 'connected') {
                // Clear any pending timeouts
                if (this.connectingTimeout) {
                    clearTimeout(this.connectingTimeout);
                    this.connectingTimeout = null;
                }
                console.log(`✅ Connection established with ${this.peerId}`);
                this.emit('connected', { peerId: this.peerId });
            } else if (this.connection.connectionState === 'connecting') {
                console.log(`🔄 Connection to ${this.peerId} is connecting...`);
                // Add timeout for stuck connecting state
                if (this.connectingTimeout) {
                    clearTimeout(this.connectingTimeout);
                }
                this.connectingTimeout = setTimeout(() => {
                    if (this.connection && this.connection.connectionState === 'connecting' && !this.isClosing) {
                        console.log(`⏰ Connection stuck in connecting state for ${this.peerId}, treating as failed`);
                        this.emit('disconnected', { peerId: this.peerId, reason: 'connection timeout' });
                    }
                }, 20000); // Increased timeout to 20 seconds for better stability
            } else if (this.connection.connectionState === 'disconnected') {
                // Give WebRTC more time to recover - it's common for connections to briefly disconnect during renegotiation
                console.log(`⚠️ WebRTC connection disconnected for ${this.peerId}, waiting for potential recovery...`);
                setTimeout(() => {
                    if (this.connection && 
                        this.connection.connectionState === 'disconnected' && 
                        !this.isClosing) {
                        console.log(`❌ WebRTC connection remained disconnected for ${this.peerId}, treating as failed`);
                        this.emit('disconnected', { peerId: this.peerId, reason: 'connection disconnected' });
                    }
                }, 8000); // Increased wait time to 8 seconds to account for renegotiation
            } else if (this.connection.connectionState === 'failed') {
                if (!this.isClosing) {
                    console.log(`❌ Connection failed for ${this.peerId}`);
                    this.emit('disconnected', { peerId: this.peerId, reason: 'connection failed' });
                }
            } else if (this.connection.connectionState === 'closed') {
                if (!this.isClosing) {
                    console.log(`❌ Connection closed for ${this.peerId}`);
                    this.emit('disconnected', { peerId: this.peerId, reason: 'connection closed' });
                }
            }
        };

        this.connection.oniceconnectionstatechange = () => {
            console.log(`🧊 ICE connection state with ${this.peerId}: ${this.connection.iceConnectionState}`);
            
            if (this.connection.iceConnectionState === 'connected') {
                // Clear any pending timeout
                if (this.iceCheckingTimeout) {
                    clearTimeout(this.iceCheckingTimeout);
                    this.iceCheckingTimeout = null;
                }
                console.log(`✅ ICE connection established with ${this.peerId}`);
            } else if (this.connection.iceConnectionState === 'checking') {
                console.log(`🔄 ICE checking for ${this.peerId}...`);
                // Set a timeout for ICE checking state - if it takes too long, restart
                if (this.iceCheckingTimeout) {
                    clearTimeout(this.iceCheckingTimeout);
                }
                this.iceCheckingTimeout = setTimeout(() => {
                    if (this.connection && this.connection.iceConnectionState === 'checking') {
                        console.log(`⏰ ICE checking timeout for ${this.peerId}, attempting restart`);
                        try {
                            this.connection.restartIce();
                        } catch (error) {
                            console.error('Failed to restart ICE:', error);
                            this.emit('disconnected', { peerId: this.peerId, reason: 'ICE restart failed' });
                        }
                    }
                }, 20000); // Increased timeout to 20 seconds for ICE checking
            } else if (this.connection.iceConnectionState === 'failed') {
                console.log(`❌ ICE connection failed for ${this.peerId}, attempting restart`);
                try {
                    this.connection.restartIce();
                } catch (error) {
                    console.error('Failed to restart ICE after failure:', error);
                    this.emit('disconnected', { peerId: this.peerId, reason: 'ICE failed' });
                }
            } else if (this.connection.iceConnectionState === 'disconnected') {
                // Give more time for ICE reconnection - this is common during renegotiation
                console.log(`⚠️ ICE connection disconnected for ${this.peerId}, waiting for potential reconnection...`);
                setTimeout(() => {
                    if (this.connection && 
                        this.connection.iceConnectionState === 'disconnected' && 
                        !this.isClosing) {
                        console.log(`❌ ICE remained disconnected for ${this.peerId}, attempting restart`);
                        try {
                            this.connection.restartIce();
                        } catch (error) {
                            console.error('Failed to restart ICE after disconnection:', error);
                            this.emit('disconnected', { peerId: this.peerId, reason: 'ICE disconnected' });
                        }
                    }
                }, 10000); // Increased wait time to 10 seconds for ICE reconnection
            }
        };

        // Handle renegotiation when tracks are added/removed
        this.connection.onnegotiationneeded = () => {
            console.log(`🔄 Negotiation needed for ${this.peerId} (WebRTC detected track changes)`);
            // With pre-allocated transceivers, we should NEVER need renegotiation
            // Any renegotiation indicates a problem with our transceiver approach
            console.log('🚫 UNEXPECTED: Renegotiation triggered despite transceiver approach - investigating...');
            
            // Log debug info about current transceivers
            const transceivers = this.connection.getTransceivers();
            console.log('� Transceivers state during unexpected negotiation:', transceivers.map(t => ({
                kind: t.receiver.track?.kind || 'unknown',
                direction: t.direction,
                hasTrack: !!t.sender.track,
                mid: t.mid
            })));
            
            // For now, ignore renegotiation to prevent connection issues
            // this.emit('renegotiationNeeded', { peerId: this.peerId });
        };
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log(`Data channel opened with ${this.peerId}`);
            this.dataChannelReady = true;
            this.emit('dataChannelOpen', { peerId: this.peerId });
        };

        this.dataChannel.onclose = () => {
            console.log(`Data channel closed with ${this.peerId}`);
            this.dataChannelReady = false;
            
            // Only emit disconnection if we're not intentionally closing
            if (!this.isClosing) {
                this.emit('disconnected', { peerId: this.peerId, reason: 'data channel closed' });
            }
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.emit('message', { peerId: this.peerId, message });
            } catch (error) {
                console.error('Failed to parse message:', error);
                this.emit('message', { peerId: this.peerId, message: { content: event.data } });
            }
        };

        this.dataChannel.onerror = (error) => {
            console.error(`Data channel error with ${this.peerId}:`, error);
            this.dataChannelReady = false;
            
            // Only emit disconnection if we're not intentionally closing
            if (!this.isClosing) {
                this.emit('disconnected', { peerId: this.peerId, reason: 'data channel error' });
            }
        };
    }

    async createOffer() {
        const offer = await this.connection.createOffer();
        await this.connection.setLocalDescription(offer);
        return offer;
    }

    async handleOffer(offer) {
        // Check if we're in the right state to handle an offer
        if (this.connection.signalingState !== 'stable') {
            console.log(`Cannot handle offer from ${this.peerId} - connection state is ${this.connection.signalingState} (expected: stable)`);
            throw new Error(`Cannot handle offer in state: ${this.connection.signalingState}`);
        }
        
        await this.connection.setRemoteDescription(offer);
        this.remoteDescriptionSet = true;
        await this.processPendingIceCandidates();
        
        const answer = await this.connection.createAnswer();
        await this.connection.setLocalDescription(answer);
        return answer;
    }

    async handleAnswer(answer) {
        // Check if we're in the right state to handle an answer
        if (this.connection.signalingState !== 'have-local-offer') {
            console.log(`Cannot handle answer from ${this.peerId} - connection state is ${this.connection.signalingState} (expected: have-local-offer)`);
            
            // If we're already stable, the connection might already be established
            if (this.connection.signalingState === 'stable') {
                console.log('Connection already stable, answer not needed');
                return;
            }
            
            throw new Error(`Cannot handle answer in state: ${this.connection.signalingState}`);
        }
        
        await this.connection.setRemoteDescription(answer);
        this.remoteDescriptionSet = true;
        await this.processPendingIceCandidates();
    }

    async handleIceCandidate(candidate) {
        console.log(`🧊 Received ICE candidate for ${this.peerId.substring(0, 8)}...`, {
            type: candidate.type,
            protocol: candidate.protocol
        });
        
        if (!this.remoteDescriptionSet) {
            console.log(`🧊 Buffering ICE candidate for ${this.peerId.substring(0, 8)}... (remote description not set yet)`);
            this.pendingIceCandidates.push(candidate);
            return;
        }

        try {
            await this.connection.addIceCandidate(candidate);
            console.log(`🧊 Successfully added ICE candidate for ${this.peerId.substring(0, 8)}...`);
        } catch (error) {
            console.error(`🧊 Failed to add ICE candidate for ${this.peerId.substring(0, 8)}...:`, error);
        }
    }

    async processPendingIceCandidates() {
        if (this.pendingIceCandidates.length > 0) {
            console.log(`🧊 Processing ${this.pendingIceCandidates.length} buffered ICE candidates for ${this.peerId.substring(0, 8)}...`);
            
            for (const candidate of this.pendingIceCandidates) {
                try {
                    await this.connection.addIceCandidate(candidate);
                    console.log(`🧊 Successfully added buffered ICE candidate (${candidate.type}) for ${this.peerId.substring(0, 8)}...`);
                } catch (error) {
                    console.error(`🧊 Failed to add buffered ICE candidate for ${this.peerId.substring(0, 8)}...:`, error);
                }
            }
            
            this.pendingIceCandidates = [];
            console.log(`🧊 Finished processing buffered ICE candidates for ${this.peerId.substring(0, 8)}...`);
        }
    }

    sendMessage(message) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            try {
                this.dataChannel.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error(`Failed to send message to ${this.peerId}:`, error);
                return false;
            }
        }
        return false;
    }

    /**
     * Add or replace local media stream
     */
    async setLocalStream(stream) {
        if (!this.connection) {
            throw new Error('Connection not initialized');
        }

        console.log(`Setting local stream for ${this.peerId}, current state: ${this.connection.connectionState}, signaling: ${this.connection.signalingState}`);

        // DEBUG: Log current transceivers before any changes
        const transceivers = this.connection.getTransceivers();
        console.log(`🔍 Current transceivers before stream change:`, transceivers.map(t => ({
            kind: t.receiver.track?.kind || 'unknown',
            direction: t.direction,
            hasTrack: !!t.sender.track,
            mid: t.mid
        })));

        // Use stored transceiver references for reliable access
        console.log('🔄 Using stored transceiver references for media');
        
        if (stream) {
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();
            
            // Handle audio track using stored reference
            if (this.audioTransceiver) {
                if (audioTracks.length > 0) {
                    console.log('🔄 Replacing audio track in stored transceiver');
                    await this.audioTransceiver.sender.replaceTrack(audioTracks[0]);
                    this.audioTransceiver.direction = 'sendrecv';
                    
                    // Setup audio sending monitoring
                    this.setupAudioSendingMonitoring(audioTracks[0]);
                    console.log(`🎤 SENDING AUDIO to peer ${this.peerId.substring(0, 8)} - track enabled: ${audioTracks[0].enabled}`);
                } else {
                    console.log('🔄 Removing audio track from stored transceiver');
                    await this.audioTransceiver.sender.replaceTrack(null);
                    this.audioTransceiver.direction = 'recvonly';
                    console.log(`🎤 STOPPED SENDING AUDIO to peer ${this.peerId.substring(0, 8)}`);
                }
            }
            
            // Handle video track using stored reference
            if (this.videoTransceiver) {
                if (videoTracks.length > 0) {
                    console.log('🔄 Replacing video track in stored transceiver');
                    await this.videoTransceiver.sender.replaceTrack(videoTracks[0]);
                    this.videoTransceiver.direction = 'sendrecv';
                } else {
                    console.log('🔄 Removing video track from stored transceiver');
                    await this.videoTransceiver.sender.replaceTrack(null);
                    this.videoTransceiver.direction = 'recvonly';
                }
            }
            
            this.localStream = stream;
            console.log('✅ Stream set successfully using stored transceivers');
        } else {
            // Remove all tracks using stored references
            if (this.audioTransceiver) {
                console.log('🔄 Removing audio track from stored transceiver');
                await this.audioTransceiver.sender.replaceTrack(null);
                this.audioTransceiver.direction = 'recvonly';
            }
            
            if (this.videoTransceiver) {
                console.log('🔄 Removing video track from stored transceiver');
                await this.videoTransceiver.sender.replaceTrack(null);
                this.videoTransceiver.direction = 'recvonly';
            }
            
            this.localStream = null;
            console.log('✅ All tracks removed using stored transceivers');
        }

        console.log('Updated local media stream for', this.peerId);
        
        // DEBUG: Log final transceivers after changes
        const finalTransceivers = this.connection.getTransceivers();
        console.log(`🔍 Final transceivers after stream change:`, finalTransceivers.map(t => ({
            kind: t.receiver.track?.kind || 'unknown',
            direction: t.direction,
            hasTrack: !!t.sender.track,
            trackId: t.sender.track?.id?.substring(0, 8) || 'none',
            mid: t.mid
        })));
    }

    /**
     * Helper method to set local stream tracks to existing transceivers
     */
    async setLocalStreamToTransceivers(stream) {
        if (stream) {
            const audioTracks = stream.getAudioTracks();
            const videoTracks = stream.getVideoTracks();
            
            // Set audio track to stored audio transceiver
            if (this.audioTransceiver && audioTracks.length > 0) {
                console.log('🔄 Setting audio track to stored audio transceiver');
                await this.audioTransceiver.sender.replaceTrack(audioTracks[0]);
                this.audioTransceiver.direction = 'sendrecv';
                
                // Setup audio sending monitoring
                this.setupAudioSendingMonitoring(audioTracks[0]);
                console.log(`🎤 SENDING AUDIO to peer ${this.peerId.substring(0, 8)} via transceiver - track enabled: ${audioTracks[0].enabled}`);
            }
            
            // Set video track to stored video transceiver
            if (this.videoTransceiver && videoTracks.length > 0) {
                console.log('🔄 Setting video track to stored video transceiver');
                await this.videoTransceiver.sender.replaceTrack(videoTracks[0]);
                this.videoTransceiver.direction = 'sendrecv';
            }
        }
    }

    /**
     * Setup audio data monitoring for received audio tracks
     */
    setupAudioDataMonitoring(audioTrack, trackIndex) {
        console.log(`🎵 Setting up audio data monitoring for track ${trackIndex} from peer ${this.peerId.substring(0, 8)}`);
        
        try {
            // Create audio context for analyzing audio data
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) {
                console.warn('🎵 AudioContext not available - cannot monitor audio data');
                return;
            }
            
            // Create a MediaStream with just this audio track for analysis
            const trackStream = new MediaStream([audioTrack]);
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(trackStream);
            const analyser = audioContext.createAnalyser();
            
            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            source.connect(analyser);
            
            let lastLogTime = 0;
            let totalSamples = 0;
            let samplesWithAudio = 0;
            let maxLevel = 0;
            
            // Monitor audio levels periodically
            const monitorAudio = () => {
                if (audioTrack.readyState === 'ended') {
                    console.log(`🎵 Audio track ${trackIndex} ended, stopping monitoring for peer ${this.peerId.substring(0, 8)}`);
                    audioContext.close();
                    return;
                }
                
                analyser.getByteFrequencyData(dataArray);
                
                // Calculate audio level (0-255)
                const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
                const currentTime = Date.now();
                
                totalSamples++;
                if (average > 5) { // Threshold for detecting audio activity
                    samplesWithAudio++;
                    maxLevel = Math.max(maxLevel, average);
                }
                
                // Log every 5 seconds
                if (currentTime - lastLogTime > 5000) {
                    const audioActivity = totalSamples > 0 ? (samplesWithAudio / totalSamples * 100) : 0;
                    console.log(`🎵 Audio data from peer ${this.peerId.substring(0, 8)} track ${trackIndex}:`, {
                        enabled: audioTrack.enabled,
                        readyState: audioTrack.readyState,
                        muted: audioTrack.muted,
                        currentLevel: Math.round(average),
                        maxLevel: Math.round(maxLevel),
                        activityPercent: Math.round(audioActivity),
                        samplesAnalyzed: totalSamples,
                        hasAudioData: samplesWithAudio > 0
                    });
                    
                    lastLogTime = currentTime;
                    // Reset counters for next period
                    totalSamples = 0;
                    samplesWithAudio = 0;
                    maxLevel = 0;
                }
                
                // Continue monitoring if track is still active
                if (audioTrack.readyState === 'live') {
                    requestAnimationFrame(monitorAudio);
                }
            };
            
            // Start monitoring
            requestAnimationFrame(monitorAudio);
            
            // Track state changes
            audioTrack.addEventListener('ended', () => {
                console.log(`🎵 Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} ended`);
                audioContext.close();
            });
            
            audioTrack.addEventListener('mute', () => {
                console.log(`🎵 Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} muted`);
            });
            
            audioTrack.addEventListener('unmute', () => {
                console.log(`🎵 Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} unmuted`);
            });
            
            console.log(`🎵 Audio monitoring started for track ${trackIndex} from peer ${this.peerId.substring(0, 8)}`);
            
        } catch (error) {
            console.error(`🎵 Failed to setup audio monitoring for track ${trackIndex}:`, error);
        }
    }

    /**
     * Setup audio sending monitoring for outgoing audio tracks
     */
    setupAudioSendingMonitoring(audioTrack) {
        console.log(`🎤 Setting up audio SENDING monitoring to peer ${this.peerId.substring(0, 8)}`);
        
        try {
            // Monitor track state changes
            audioTrack.addEventListener('ended', () => {
                console.log(`🎤 Audio SENDING track ended to peer ${this.peerId.substring(0, 8)}`);
            });
            
            audioTrack.addEventListener('mute', () => {
                console.log(`🎤 Audio SENDING track muted to peer ${this.peerId.substring(0, 8)}`);
            });
            
            audioTrack.addEventListener('unmute', () => {
                console.log(`🎤 Audio SENDING track unmuted to peer ${this.peerId.substring(0, 8)}`);
            });
            
            // Monitor audio input levels if possible
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) {
                console.warn('🎤 AudioContext not available - basic sending monitoring only');
                return;
            }
            
            const trackStream = new MediaStream([audioTrack]);
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(trackStream);
            const analyser = audioContext.createAnalyser();
            
            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            source.connect(analyser);
            
            let lastLogTime = 0;
            let totalSamples = 0;
            let activeSamples = 0;
            let maxSendLevel = 0;
            
            const monitorSending = () => {
                if (audioTrack.readyState === 'ended') {
                    console.log(`🎤 Audio sending track ended, stopping monitoring to peer ${this.peerId.substring(0, 8)}`);
                    audioContext.close();
                    return;
                }
                
                analyser.getByteFrequencyData(dataArray);
                
                const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
                const currentTime = Date.now();
                
                totalSamples++;
                if (average > 5) {
                    activeSamples++;
                    maxSendLevel = Math.max(maxSendLevel, average);
                }
                
                // Log every 5 seconds
                if (currentTime - lastLogTime > 5000) {
                    const sendingActivity = totalSamples > 0 ? (activeSamples / totalSamples * 100) : 0;
                    console.log(`🎤 Audio SENDING to peer ${this.peerId.substring(0, 8)}:`, {
                        trackEnabled: audioTrack.enabled,
                        trackReadyState: audioTrack.readyState,
                        trackMuted: audioTrack.muted,
                        currentSendLevel: Math.round(average),
                        maxSendLevel: Math.round(maxSendLevel),
                        sendingActivityPercent: Math.round(sendingActivity),
                        samplesAnalyzed: totalSamples,
                        audioBeingSent: activeSamples > 0
                    });
                    
                    lastLogTime = currentTime;
                    totalSamples = 0;
                    activeSamples = 0;
                    maxSendLevel = 0;
                }
                
                if (audioTrack.readyState === 'live') {
                    requestAnimationFrame(monitorSending);
                }
            };
            
            requestAnimationFrame(monitorSending);
            console.log(`🎤 Audio sending monitoring started to peer ${this.peerId.substring(0, 8)}`);
            
        } catch (error) {
            console.error(`🎤 Failed to setup audio sending monitoring to peer ${this.peerId.substring(0, 8)}:`, error);
        }
    }

    /**
     * Get remote media stream
     */
    getRemoteStream() {
        return this.remoteStream;
    }

    /**
     * Get local media stream
     */
    getLocalStream() {
        return this.localStream;
    }

    /**
     * Check if connection has video/audio capabilities
     */
    getMediaCapabilities() {
        const capabilities = {
            hasLocalVideo: false,
            hasLocalAudio: false,
            hasRemoteVideo: false,
            hasRemoteAudio: false
        };

        if (this.localStream) {
            capabilities.hasLocalVideo = this.localStream.getVideoTracks().length > 0;
            capabilities.hasLocalAudio = this.localStream.getAudioTracks().length > 0;
        }

        if (this.remoteStream) {
            capabilities.hasRemoteVideo = this.remoteStream.getVideoTracks().length > 0;
            capabilities.hasRemoteAudio = this.remoteStream.getAudioTracks().length > 0;
        }

        return capabilities;
    }

    getStatus() {
        if (this._forcedStatus) {
            return this._forcedStatus;
        }
        // First check if data channel is closed - this indicates disconnection regardless of WebRTC state
        if (this.dataChannel && this.dataChannel.readyState === 'closed') {
            return 'disconnected';
        }
        
        // If we have a WebRTC connection, check its state
        if (this.connection) {
            const connectionState = this.connection.connectionState;
            
            if (connectionState === 'connected') {
                // Connection is established, now check data channel
                if (this.dataChannel && this.dataChannel.readyState === 'open' && this.dataChannelReady) {
                    return 'connected';
                } else if (this.dataChannel && this.dataChannel.readyState === 'open') {
                    return 'connected';
                } else if (this.dataChannel && this.dataChannel.readyState === 'connecting') {
                    return 'channel-connecting';
                } else {
                    return 'connected';
                }
            } else if (connectionState === 'connecting') {
                // Check data channel state even during connection
                if (this.dataChannel && this.dataChannel.readyState === 'connecting') {
                    return 'channel-connecting';
                } else {
                    return 'connecting';
                }
            } else if (connectionState === 'new') {
                return 'connecting'; // Map 'new' to 'connecting' for UI consistency
            } else {
                // Failed, disconnected, closed, etc.
                return connectionState;
            }
        }
        
        // If no connection but we have a data channel (edge case)
        if (this.dataChannel) {
            if (this.dataChannel.readyState === 'connecting') {
                return 'channel-connecting';
            } else if (this.dataChannel.readyState === 'closed') {
                return 'disconnected';
            }
        }
        
        // Default state when just created
        return 'connecting';
    }

    getDetailedStatus() {
        const status = {
            connectionState: this.connection ? this.connection.connectionState : 'no-connection',
            iceConnectionState: this.connection ? this.connection.iceConnectionState : 'no-connection',
            dataChannelState: this.dataChannel ? this.dataChannel.readyState : 'no-channel',
            dataChannelReady: this.dataChannelReady,
            isClosing: this.isClosing,
            overallStatus: this.getStatus()
        };
        return status;
    }

    close() {
        // Set flag to prevent disconnection events during intentional close
        this.isClosing = true;
        
        // Clear any pending timeouts
        if (this.iceCheckingTimeout) {
            clearTimeout(this.iceCheckingTimeout);
            this.iceCheckingTimeout = null;
        }
        
        if (this.connectingTimeout) {
            clearTimeout(this.connectingTimeout);
            this.connectingTimeout = null;
        }
        
        if (this.connection) {
            this.connection.close();
        }
    }
}
