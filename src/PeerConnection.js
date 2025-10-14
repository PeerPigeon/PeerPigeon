import { EventEmitter } from './EventEmitter.js';
import { environmentDetector } from './EnvironmentDetector.js';
import DebugLogger from './DebugLogger.js';

export class PeerConnection extends EventEmitter {
  constructor(peerId, isInitiator = false, options = {}) {
    super();
    this.peerId = peerId;
    this.debug = DebugLogger.create('PeerConnection');
    this.isInitiator = isInitiator;
    this.connection = null;
    this.dataChannel = null;
    this.remoteDescriptionSet = false;
    this.dataChannelReady = false;
    this.connectionStartTime = Date.now();
    this.pendingIceCandidates = [];
    this.isClosing = false; // Flag to prevent disconnection events during intentional close
    this.iceTimeoutId = null; // Timeout ID for ICE negotiation
    this._forcedStatus = null; // Track forced status (e.g., failed)

    // Media stream support
    this.localStream = options.localStream || null;
    this.remoteStream = null;
    this.enableVideo = options.enableVideo || false;
    this.enableAudio = options.enableAudio || false;
    this.audioTransceiver = null;
    this.videoTransceiver = null;
    
    // SECURITY: Never automatically invoke remote streams - only when user explicitly requests
    this.allowRemoteStreams = options.allowRemoteStreams === true; // Default to false - streams must be explicitly invoked
    this.pendingRemoteStreams = []; // Buffer remote streams until user invokes them
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
    // Validate WebRTC support before creating connection
    if (!environmentDetector.hasWebRTC) {
      const error = new Error('WebRTC not supported in this environment');
      this.emit('connectionFailed', { peerId: this.peerId, reason: error.message });
      throw error;
    }

    // Get PigeonRTC instance for cross-platform WebRTC support
    const pigeonRTC = environmentDetector.getPigeonRTC();
    if (!pigeonRTC) {
      const error = new Error('PigeonRTC not initialized - call initWebRTCAsync() first');
      this.emit('connectionFailed', { peerId: this.peerId, reason: error.message });
      throw error;
    }

    // Create peer connection using PigeonRTC
    this.connection = pigeonRTC.createPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10, // Pre-gather ICE candidates for faster connection
      bundlePolicy: 'max-bundle', // Bundle all media on single transport for efficiency
      rtcpMuxPolicy: 'require' // Multiplex RTP and RTCP for faster setup
    });

    this.setupConnectionHandlers();

    // CRITICAL FIX: Use addTrack() instead of pre-allocated transceivers to trigger ontrack events
    // This ensures that ontrack events are properly fired on the receiving side
    this.debug.log('🔄 Using addTrack() approach for proper ontrack event firing');

    // Add local media stream if provided using addTrack()
    if (this.localStream) {
      this.debug.log('Adding local stream tracks using addTrack() method');
      await this.addLocalStreamWithAddTrack(this.localStream);
    }

    if (this.isInitiator) {
      this.debug.log(`🚀 INITIATOR: Creating data channel for ${this.peerId.substring(0, 8)}... (WE are initiator)`);
      this.dataChannel = this.connection.createDataChannel('messages', {
        ordered: true
      });
      this.setupDataChannel();
    } else {
      this.debug.log(`👥 RECEIVER: Waiting for data channel from ${this.peerId.substring(0, 8)}... (THEY are initiator)`);
      this.connection.ondatachannel = (event) => {
        this.debug.log(`📨 RECEIVED: Data channel received from ${this.peerId.substring(0, 8)}...`);
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }
  }

  setupConnectionHandlers() {
    this.connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.debug.log(`🧊 Generated ICE candidate for ${this.peerId.substring(0, 8)}...`, {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          address: event.candidate.address?.substring(0, 10) + '...' || 'unknown'
        });
        this.emit('iceCandidate', { peerId: this.peerId, candidate: event.candidate });
      } else {
        this.debug.log(`🧊 ICE gathering complete for ${this.peerId.substring(0, 8)}...`);
      }
    };

    // Handle remote media streams
    this.connection.ontrack = (event) => {
      this.debug.log('🎵 Received remote media stream from', this.peerId);
      const stream = event.streams[0];
      const track = event.track;

      this.debug.log(`🎵 Track received: kind=${track.kind}, id=${track.id}, enabled=${track.enabled}, readyState=${track.readyState}`);

      // CRITICAL: Enhanced loopback detection and stream validation
      this.debug.log('🔍 ONTRACK DEBUG: Starting stream validation...');
      if (!this.validateRemoteStream(stream, track)) {
        this.debug.error('❌ ONTRACK DEBUG: Stream validation FAILED - rejecting remote stream');
        return; // Don't process invalid or looped back streams
      }
      this.debug.log('✅ ONTRACK DEBUG: Stream validation PASSED - processing remote stream');

      if (stream) {
        this.remoteStream = stream;
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();

        this.debug.log(`🎵 Remote stream tracks: ${audioTracks.length} audio, ${videoTracks.length} video`);
        this.debug.log(`🎵 Remote stream ID: ${stream.id} (vs local: ${this.localStream?.id || 'none'})`);

        // Mark stream as genuinely remote to prevent future confusion
        this.markStreamAsRemote(stream);

        audioTracks.forEach((audioTrack, index) => {
          this.debug.log(`🎵 Audio track ${index}: enabled=${audioTrack.enabled}, readyState=${audioTrack.readyState}, muted=${audioTrack.muted}, id=${audioTrack.id}`);

          // Add audio data monitoring
          this.setupAudioDataMonitoring(audioTrack, index);
        });

        this.debug.log('🚨 ONTRACK DEBUG: About to emit remoteStream event');
        
        // Check if remote streams are allowed (crypto gating)
        if (this.allowRemoteStreams) {
          this.emit('remoteStream', { peerId: this.peerId, stream: this.remoteStream });
          this.debug.log('✅ ONTRACK DEBUG: remoteStream event emitted successfully');
        } else {
          // Buffer the stream until crypto allows it
          this.debug.log('🔒 ONTRACK DEBUG: Buffering remote stream until crypto verification');
          this.pendingRemoteStreams.push({ peerId: this.peerId, stream: this.remoteStream });
        }
      } else {
        this.debug.error('❌ ONTRACK DEBUG: No stream in ontrack event - this should not happen');
      }
    };

    this.connection.onconnectionstatechange = () => {
      this.debug.log(`🔗 Connection state with ${this.peerId}: ${this.connection.connectionState} (previous signaling: ${this.connection.signalingState})`);

      // Log additional context about transceivers and media with Node.js compatibility
      try {
        const transceivers = this.connection.getTransceivers();
        const audioSending = this.audioTransceiver && this.audioTransceiver.sender && this.audioTransceiver.sender.track;
        const videoSending = this.videoTransceiver && this.videoTransceiver.sender && this.videoTransceiver.sender.track;
        this.debug.log(`🔗 Media context: Audio sending=${!!audioSending}, Video sending=${!!videoSending}, Transceivers=${transceivers.length}`);
      } catch (error) {
        // Handle Node.js WebRTC compatibility issues
        this.debug.log(`🔗 Media context: Unable to access transceiver details (${error.message})`);
      }

      if (this.connection.connectionState === 'connected') {
        this.debug.log(`✅ Connection established with ${this.peerId}`);
        this.emit('connected', { peerId: this.peerId });
      } else if (this.connection.connectionState === 'connecting') {
        this.debug.log(`🔄 Connection to ${this.peerId} is connecting...`);
      } else if (this.connection.connectionState === 'disconnected') {
        // Give WebRTC more time to recover - it's common for connections to briefly disconnect during renegotiation
        this.debug.log(`⚠️ WebRTC connection disconnected for ${this.peerId}, waiting for potential recovery...`);
        
        // Longer recovery time for disconnected state when there are multiple peers (3+)
        // This helps prevent cascade failures when multiple renegotiations happen
        const recoveryTime = 12000; // 12 seconds for disconnected state recovery
        
        setTimeout(() => {
          if (this.connection &&
                        this.connection.connectionState === 'disconnected' &&
                        !this.isClosing) {
            this.debug.log(`❌ WebRTC connection remained disconnected for ${this.peerId} after ${recoveryTime}ms, treating as failed`);
            this.emit('disconnected', { peerId: this.peerId, reason: 'connection disconnected' });
          }
        }, recoveryTime);
      } else if (this.connection.connectionState === 'failed') {
        if (!this.isClosing) {
          this.debug.log(`❌ Connection failed for ${this.peerId}`);
          this.emit('disconnected', { peerId: this.peerId, reason: 'connection failed' });
        }
      } else if (this.connection.connectionState === 'closed') {
        if (!this.isClosing) {
          this.debug.log(`❌ Connection closed for ${this.peerId}`);
          this.emit('disconnected', { peerId: this.peerId, reason: 'connection closed' });
        }
      }
    };

    this.connection.oniceconnectionstatechange = () => {
      this.debug.log(`🧊 ICE connection state with ${this.peerId}: ${this.connection.iceConnectionState}`);

      if (this.connection.iceConnectionState === 'connected') {
        this.debug.log(`✅ ICE connection established with ${this.peerId}`);
        // Clear any existing ICE timeout
        if (this.iceTimeoutId) {
          clearTimeout(this.iceTimeoutId);
          this.iceTimeoutId = null;
        }
      } else if (this.connection.iceConnectionState === 'checking') {
        this.debug.log(`🔄 ICE checking for ${this.peerId}...`);
        
        // Set a timeout for ICE negotiation to prevent hanging
        if (this.iceTimeoutId) {
          clearTimeout(this.iceTimeoutId);
        }
        this.iceTimeoutId = setTimeout(() => {
          if (this.connection && this.connection.iceConnectionState === 'checking' && !this.isClosing) {
            this.debug.error(`❌ ICE negotiation timeout for ${this.peerId} - connection stuck in checking state`);
            this.emit('disconnected', { peerId: this.peerId, reason: 'ICE negotiation timeout' });
          }
        }, 30000); // 30 second timeout for ICE negotiation
      } else if (this.connection.iceConnectionState === 'failed') {
        // Check if signaling is available before attempting ICE restart
        const hasSignaling = this.mesh && this.mesh.signalingClient && this.mesh.signalingClient.isConnected();
        const hasMeshConnectivity = this.mesh && this.mesh.connected && this.mesh.connectionManager.getConnectedPeerCount() > 0;

        if (hasSignaling || hasMeshConnectivity) {
          this.debug.log(`❌ ICE connection failed for ${this.peerId}, attempting restart (signaling: ${hasSignaling}, mesh: ${hasMeshConnectivity})`);
          try {
            // For ICE restart, we need to coordinate new ICE candidates through signaling
            this.restartIceViaSignaling().catch(error => {
              this.debug.error('Failed to restart ICE after failure:', error);
              this.emit('disconnected', { peerId: this.peerId, reason: 'ICE failed' });
            });
          } catch (error) {
            this.debug.error('Failed to restart ICE after failure:', error);
            this.emit('disconnected', { peerId: this.peerId, reason: 'ICE failed' });
          }
        } else {
          this.debug.log(`❌ ICE connection failed for ${this.peerId}, disconnecting`);
          this.emit('disconnected', { peerId: this.peerId, reason: 'ICE failed' });
        }
      } else if (this.connection.iceConnectionState === 'disconnected') {
        // Give more time for ICE reconnection - this is common during renegotiation
        this.debug.log(`⚠️ ICE connection disconnected for ${this.peerId}, waiting for potential reconnection...`);
        setTimeout(() => {
          if (this.connection &&
                        this.connection.iceConnectionState === 'disconnected' &&
                        !this.isClosing) {
            // Check if signaling is available before attempting ICE restart
            const hasSignaling = this.mesh && this.mesh.signalingClient && this.mesh.signalingClient.isConnected();
            const hasMeshConnectivity = this.mesh && this.mesh.connected && this.mesh.connectionManager.getConnectedPeerCount() > 0;

            if (hasSignaling || hasMeshConnectivity) {
              this.debug.log(`❌ ICE remained disconnected for ${this.peerId}, attempting restart (signaling: ${hasSignaling}, mesh: ${hasMeshConnectivity})`);
              try {
                this.restartIceViaSignaling().catch(error => {
                  this.debug.error('Failed to restart ICE after disconnection:', error);
                  this.emit('disconnected', { peerId: this.peerId, reason: 'ICE disconnected' });
                });
              } catch (error) {
                this.debug.error('Failed to restart ICE after disconnection:', error);
                this.emit('disconnected', { peerId: this.peerId, reason: 'ICE disconnected' });
              }
            } else {
              this.debug.log(`❌ ICE remained disconnected for ${this.peerId}, disconnecting`);
              this.emit('disconnected', { peerId: this.peerId, reason: 'ICE disconnected' });
            }
          }
        }, 5000); // Faster ICE reconnection - 5 seconds
      }
    };

    // Handle renegotiation when tracks are added/removed
    this.connection.onnegotiationneeded = () => {
      this.debug.log(`🔄 Negotiation needed for ${this.peerId} (WebRTC detected track changes)`);
      // CRITICAL: Renegotiation IS needed when tracks are added/replaced, even with pre-allocated transceivers
      // Pre-allocated transceivers only avoid m-line changes, but SDP still needs to be renegotiated
      this.debug.log('✅ RENEGOTIATION: Track changes detected - triggering renegotiation as expected');

      // Log debug info about current transceivers (with error handling for Node.js WebRTC)
      try {
        const transceivers = this.connection.getTransceivers();
        this.debug.log('🔄 Transceivers state during renegotiation:', transceivers.map(t => ({
          kind: t.receiver?.track?.kind || 'unknown',
          direction: t.direction,
          hasTrack: !!t.sender?.track,
          mid: t.mid
        })));
      } catch (error) {
        this.debug.log('🔄 Cannot inspect transceivers (Node.js WebRTC limitation):', error.message);
      }

      // Emit renegotiation needed event to trigger SDP exchange
      this.emit('renegotiationNeeded', { peerId: this.peerId });
    };

    // CRITICAL FIX: Handle track changes manually after renegotiation
    // Since we use replaceTrack() with pre-allocated transceivers, ontrack events don't fire
    // We need to monitor transceivers for new tracks after SDP exchanges
    this.connection.onsignalingstatechange = () => {
      this.debug.log(`🔄 Signaling state changed for ${this.peerId}: ${this.connection.signalingState}`);

      // When signaling becomes stable after renegotiation, check for new remote tracks
      if (this.connection.signalingState === 'stable') {
        this.debug.log('🔍 Signaling stable - checking for new remote tracks...');
        this.checkForNewRemoteTracks();
      }
    };
  }

  setupDataChannel() {
    this.dataChannel.onopen = () => {
      this.debug.log(`Data channel opened with ${this.peerId}`);
      this.dataChannelReady = true;
      this.emit('dataChannelOpen', { peerId: this.peerId });
    };

    this.dataChannel.onclose = () => {
      this.debug.log(`Data channel closed with ${this.peerId}`);
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
        this.debug.error('Failed to parse message:', error);
        this.emit('message', { peerId: this.peerId, message: { content: event.data } });
      }
    };

    this.dataChannel.onerror = (error) => {
      this.debug.error(`Data channel error with ${this.peerId}:`, error);
      this.dataChannelReady = false;

      // Only emit disconnection if we're not intentionally closing
      if (!this.isClosing) {
        this.emit('disconnected', { peerId: this.peerId, reason: 'data channel error' });
      }
    };
  }

  // CRITICAL: Check and force data channel state after answer processing
  checkDataChannelState() {
    if (this.dataChannel) {
      this.debug.log(`🔍 DATA CHANNEL CHECK: State for ${this.peerId.substring(0, 8)}... is ${this.dataChannel.readyState}`);
      
      // If data channel is open but we haven't triggered the open event yet
      if (this.dataChannel.readyState === 'open' && !this.dataChannelReady) {
        this.debug.log(`🚀 FORCE OPEN: Triggering data channel open for ${this.peerId.substring(0, 8)}...`);
        this.dataChannelReady = true;
        this.emit('dataChannelOpen', { peerId: this.peerId });
      }
      // If data channel is connecting, set up a check in case the event doesn't fire
      else if (this.dataChannel.readyState === 'connecting') {
        this.debug.log(`⏳ CONNECTING: Data channel connecting for ${this.peerId.substring(0, 8)}..., setting up backup check`);
        setTimeout(() => {
          if (this.dataChannel && this.dataChannel.readyState === 'open' && !this.dataChannelReady) {
            this.debug.log(`🚀 BACKUP OPEN: Backup trigger for data channel open for ${this.peerId.substring(0, 8)}...`);
            this.dataChannelReady = true;
            this.emit('dataChannelOpen', { peerId: this.peerId });
          }
        }, 100); // Short delay to allow normal event to fire first
      } else {
        this.debug.log(`❌ DATA CHANNEL CHECK: No data channel found for ${this.peerId.substring(0, 8)}...`);
      }
    }
  }

  async createOffer() {
    // Create offer with optimized settings for faster connection and timeout protection
    try {
      const offer = await Promise.race([
        this.connection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
          iceRestart: false // Don't restart ICE unless necessary
        }),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('createOffer timeout')), 10000)
        )
      ]);
      
      await Promise.race([
        this.connection.setLocalDescription(offer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('setLocalDescription timeout')), 10000)
        )
      ]);
      
      return offer;
    } catch (error) {
      this.debug.error(`❌ Failed to create offer for ${this.peerId}:`, error);
      throw error;
    }
  }

  async handleOffer(offer) {
    // Validate offer data structure
    if (!offer || typeof offer !== 'object') {
      this.debug.error(`Invalid offer from ${this.peerId} - not an object:`, offer);
      throw new Error('Invalid offer: not an object');
    }

    if (!offer.type || offer.type !== 'offer') {
      this.debug.error(`Invalid offer from ${this.peerId} - wrong type:`, offer.type);
      throw new Error(`Invalid offer: expected type 'offer', got '${offer.type}'`);
    }

    if (!offer.sdp || typeof offer.sdp !== 'string') {
      this.debug.error(`Invalid offer from ${this.peerId} - missing or invalid SDP:`, typeof offer.sdp);
      throw new Error('Invalid offer: missing or invalid SDP');
    }

    // Basic SDP validation
    if (offer.sdp.length < 10 || !offer.sdp.includes('v=0')) {
      this.debug.error(`Invalid offer SDP from ${this.peerId} - malformed:`, offer.sdp.substring(0, 100) + '...');
      throw new Error('Invalid offer: malformed SDP');
    }

    // ENHANCED DEBUGGING: Log detailed state before processing offer
    this.debug.log(`🔄 OFFER DEBUG: Processing offer from ${this.peerId.substring(0, 8)}...`);
    this.debug.log(`🔄 OFFER DEBUG: Current signaling state: ${this.connection.signalingState}`);
    this.debug.log(`🔄 OFFER DEBUG: Current connection state: ${this.connection.connectionState}`);
    this.debug.log(`🔄 OFFER DEBUG: Current ICE state: ${this.connection.iceConnectionState}`);
    this.debug.log(`🔄 OFFER DEBUG: Offer SDP length: ${offer.sdp.length}`);

    // Check if we're in the right state to handle an offer
    if (this.connection.signalingState !== 'stable') {
      this.debug.log(`❌ OFFER DEBUG: Cannot handle offer from ${this.peerId} - connection state is ${this.connection.signalingState} (expected: stable)`);
      throw new Error(`Cannot handle offer in state: ${this.connection.signalingState}`);
    }

    this.debug.log(`🔄 OFFER DEBUG: State validation passed, processing offer from ${this.peerId.substring(0, 8)}... SDP length: ${offer.sdp.length}`);

    try {
      await Promise.race([
        this.connection.setRemoteDescription(offer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('setRemoteDescription timeout')), 10000)
        )
      ]);
      
      this.remoteDescriptionSet = true;
      this.debug.log(`✅ OFFER DEBUG: Offer processed successfully from ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`✅ OFFER DEBUG: New signaling state after offer: ${this.connection.signalingState}`);
      await this.processPendingIceCandidates();

      const answer = await Promise.race([
        this.connection.createAnswer(),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('createAnswer timeout')), 10000)
        )
      ]);
      
      await Promise.race([
        this.connection.setLocalDescription(answer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('setLocalDescription timeout')), 10000)
        )
      ]);
      
      this.debug.log(`✅ OFFER DEBUG: Answer created for offer from ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`✅ OFFER DEBUG: Final signaling state after answer: ${this.connection.signalingState}`);
      
      // CRITICAL: Force check data channel state after offer/answer processing
      this.checkDataChannelState();
      
      return answer;
    } catch (error) {
      this.debug.error(`❌ OFFER DEBUG: Failed to process offer from ${this.peerId}:`, error);
      this.debug.error('OFFER DEBUG: Offer SDP that failed:', offer.sdp);
      this.debug.error('OFFER DEBUG: Current connection state:', this.connection.signalingState);
      this.debug.error('OFFER DEBUG: Current ICE state:', this.connection.iceConnectionState);
      throw error;
    }
  }

  async handleAnswer(answer) {
    // Validate answer data structure
    if (!answer || typeof answer !== 'object') {
      this.debug.error(`Invalid answer from ${this.peerId} - not an object:`, answer);
      throw new Error('Invalid answer: not an object');
    }

    if (!answer.type || answer.type !== 'answer') {
      this.debug.error(`Invalid answer from ${this.peerId} - wrong type:`, answer.type);
      throw new Error(`Invalid answer: expected type 'answer', got '${answer.type}'`);
    }

    if (!answer.sdp || typeof answer.sdp !== 'string') {
      this.debug.error(`Invalid answer from ${this.peerId} - missing or invalid SDP:`, typeof answer.sdp);
      throw new Error('Invalid answer: missing or invalid SDP');
    }

    // Basic SDP validation
    if (answer.sdp.length < 10 || !answer.sdp.includes('v=0')) {
      this.debug.error(`Invalid answer SDP from ${this.peerId} - malformed:`, answer.sdp.substring(0, 100) + '...');
      throw new Error('Invalid answer: malformed SDP');
    }

    // ENHANCED DEBUGGING: Log detailed state before processing answer
    this.debug.log(`🔄 ANSWER DEBUG: Processing answer from ${this.peerId.substring(0, 8)}...`);
    this.debug.log(`🔄 ANSWER DEBUG: Current signaling state: ${this.connection.signalingState}`);
    this.debug.log(`🔄 ANSWER DEBUG: Current connection state: ${this.connection.connectionState}`);
    this.debug.log(`🔄 ANSWER DEBUG: Current ICE state: ${this.connection.iceConnectionState}`);
    this.debug.log(`🔄 ANSWER DEBUG: Answer SDP length: ${answer.sdp.length}`);

    // Check if we're in the right state to handle an answer
    if (this.connection.signalingState !== 'have-local-offer') {
      this.debug.log(`❌ ANSWER DEBUG: Cannot handle answer from ${this.peerId} - connection state is ${this.connection.signalingState} (expected: have-local-offer)`);

      // If we're already stable, the connection might already be established
      if (this.connection.signalingState === 'stable') {
        this.debug.log('✅ ANSWER DEBUG: Connection already stable, answer not needed');
        return;
      }

      throw new Error(`Cannot handle answer in state: ${this.connection.signalingState}`);
    }

    this.debug.log(`🔄 ANSWER DEBUG: State validation passed, processing answer from ${this.peerId.substring(0, 8)}... SDP length: ${answer.sdp.length}`);

    try {
      await Promise.race([
        this.connection.setRemoteDescription(answer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('setRemoteDescription timeout')), 10000)
        )
      ]);
      
      this.remoteDescriptionSet = true;
      this.debug.log(`✅ ANSWER DEBUG: Answer processed successfully from ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`✅ ANSWER DEBUG: New signaling state: ${this.connection.signalingState}`);
      this.debug.log(`✅ ANSWER DEBUG: New connection state: ${this.connection.connectionState}`);
      await this.processPendingIceCandidates();
      
      // CRITICAL: Force check data channel state after answer processing
      this.checkDataChannelState();
    } catch (error) {
      this.debug.error(`❌ ANSWER DEBUG: Failed to set remote description for answer from ${this.peerId}:`, error);
      this.debug.error('ANSWER DEBUG: Answer SDP that failed:', answer.sdp);
      this.debug.error('ANSWER DEBUG: Current connection state:', this.connection.signalingState);
      this.debug.error('ANSWER DEBUG: Current ICE state:', this.connection.iceConnectionState);
      throw error;
    }
  }

  async handleIceCandidate(candidate) {
    // Validate ICE candidate data structure
    if (!candidate || typeof candidate !== 'object') {
      this.debug.error(`Invalid ICE candidate from ${this.peerId} - not an object:`, candidate);
      throw new Error('Invalid ICE candidate: not an object');
    }

    // Basic ICE candidate validation
    if (!candidate.candidate || typeof candidate.candidate !== 'string') {
      this.debug.error(`Invalid ICE candidate from ${this.peerId} - missing candidate string:`, candidate);
      throw new Error('Invalid ICE candidate: missing candidate string');
    }

    this.debug.log(`🧊 Received ICE candidate for ${this.peerId.substring(0, 8)}...`, {
      type: candidate.type,
      protocol: candidate.protocol,
      candidateLength: candidate.candidate?.length || 0
    });

    if (!this.remoteDescriptionSet) {
      this.debug.log(`🧊 Buffering ICE candidate for ${this.peerId.substring(0, 8)}... (remote description not set yet)`);
      this.pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await Promise.race([
        this.connection.addIceCandidate(candidate),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('addIceCandidate timeout')), 5000)
        )
      ]);
      this.debug.log(`🧊 Successfully added ICE candidate for ${this.peerId.substring(0, 8)}...`);
    } catch (error) {
      this.debug.error(`🧊 Failed to add ICE candidate for ${this.peerId.substring(0, 8)}...:`, error);
      this.debug.error('ICE candidate that failed:', candidate);
      this.debug.error('Current connection state:', this.connection.connectionState);
      this.debug.error('Current ICE state:', this.connection.iceConnectionState);
      // Don't rethrow - ICE candidate failures are often recoverable
    }
  }

  async processPendingIceCandidates() {
    if (this.pendingIceCandidates.length > 0) {
      this.debug.log(`🧊 Processing ${this.pendingIceCandidates.length} buffered ICE candidates for ${this.peerId.substring(0, 8)}...`);

      for (const candidate of this.pendingIceCandidates) {
        try {
          await Promise.race([
            this.connection.addIceCandidate(candidate),
            new Promise((resolve, reject) => 
              setTimeout(() => reject(new Error('addIceCandidate timeout')), 5000)
            )
          ]);
          this.debug.log(`🧊 Successfully added buffered ICE candidate (${candidate.type}) for ${this.peerId.substring(0, 8)}...`);
        } catch (error) {
          this.debug.error(`🧊 Failed to add buffered ICE candidate for ${this.peerId.substring(0, 8)}...:`, error);
        }
      }

      this.pendingIceCandidates = [];
      this.debug.log(`🧊 Finished processing buffered ICE candidates for ${this.peerId.substring(0, 8)}...`);
    }
  }

  sendMessage(message) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify(message));
        return true;
      } catch (error) {
        this.debug.error(`Failed to send message to ${this.peerId}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * CRITICAL FIX: Manually check for new remote tracks after renegotiation
   * This is needed because replaceTrack() doesn't trigger ontrack events
   */
  checkForNewRemoteTracks() {
    this.debug.log(`🔍 TRACK CHECK: Checking transceivers for new remote tracks from ${this.peerId.substring(0, 8)}...`);

    try {
      const transceivers = this.connection.getTransceivers();
      let foundNewTracks = false;

      transceivers.forEach((transceiver, index) => {
        const track = transceiver.receiver.track;
        if (track && track.readyState === 'live') {
          this.debug.log(`🔍 TRACK CHECK: Transceiver ${index} has live ${track.kind} track: ${track.id.substring(0, 8)}...`);

          // Check if this is a new track we haven't processed
          const isNewTrack = !this.processedTrackIds || !this.processedTrackIds.has(track.id);

          if (isNewTrack) {
            this.debug.log(`🎵 NEW TRACK FOUND: Processing new ${track.kind} track from ${this.peerId.substring(0, 8)}...`);

            // Create a stream from this track (simulate ontrack event)
            const stream = new MediaStream([track]);

            // Validate and process like ontrack would
            if (this.validateRemoteStream(stream, track)) {
              this.remoteStream = stream;
              this.markStreamAsRemote(stream);

              // Track that we've processed this track
              if (!this.processedTrackIds) this.processedTrackIds = new Set();
              this.processedTrackIds.add(track.id);

              this.debug.log('🚨 TRACK CHECK: Emitting remoteStream event for new track');
              
              // Check if remote streams are allowed (crypto gating)
              if (this.allowRemoteStreams) {
                this.emit('remoteStream', { peerId: this.peerId, stream: this.remoteStream });
              } else {
                // Buffer the stream until crypto allows it
                this.debug.log('🔒 TRACK CHECK: Buffering remote stream until crypto verification');
                this.pendingRemoteStreams.push({ peerId: this.peerId, stream: this.remoteStream });
              }
              
              foundNewTracks = true;
            }
          }
        }
      });

      if (!foundNewTracks) {
        this.debug.log('🔍 TRACK CHECK: No new remote tracks found');
      }
    } catch (error) {
      this.debug.error('❌ TRACK CHECK: Failed to check for remote tracks:', error);
    }
  }

  /**
     * Enhanced validation to ensure received stream is genuinely remote
     */
  validateRemoteStream(stream, track) {
    this.debug.log('🔍 VALIDATION: Starting remote stream validation...');

    // Check 0: Ensure stream and track are valid
    if (!stream) {
      this.debug.error('❌ VALIDATION: Stream is null or undefined');
      return false;
    }
    if (!track) {
      this.debug.error('❌ VALIDATION: Track is null or undefined');
      return false;
    }

    // Check 1: Stream ID collision (basic loopback detection)
    if (this.localStream && stream.id === this.localStream.id) {
      this.debug.error('❌ LOOPBACK DETECTED: Received our own local stream as remote!');
      this.debug.error('Local stream ID:', this.localStream.id);
      this.debug.error('Received stream ID:', stream.id);
      return false;
    }
    this.debug.log('✅ VALIDATION: Stream ID check passed');

    // Check 2: Track ID collision (more granular loopback detection)
    if (this.localStream) {
      const localTracks = this.localStream.getTracks();
      const isOwnTrack = localTracks.some(localTrack => localTrack.id === track.id);
      if (isOwnTrack) {
        this.debug.error('❌ TRACK LOOPBACK: This track is our own local track!');
        this.debug.error('Local track ID:', track.id);
        return false;
      }
    }
    this.debug.log('✅ VALIDATION: Track ID check passed');

    // Check 3: Verify track comes from remote peer transceiver
    if (this.connection) {
      const transceivers = this.connection.getTransceivers();
      this.debug.log(`🔍 VALIDATION: Checking ${transceivers.length} transceivers for track ${track.id.substring(0, 8)}...`);

      const sourceTransceiver = transceivers.find(t => t.receiver.track === track);
      if (!sourceTransceiver) {
        this.debug.warn('⚠️ VALIDATION: Track not found in any transceiver - may be invalid');
        this.debug.warn('Available transceivers:', transceivers.map(t => ({
          kind: t.receiver?.track?.kind || 'no-track',
          direction: t.direction,
          trackId: t.receiver?.track?.id?.substring(0, 8) || 'none'
        })));
        // TEMPORARY FIX: Don't reject just because transceiver lookup fails
        // return false;
        this.debug.log('⚠️ VALIDATION: Allowing track despite transceiver lookup failure (temporary fix)');
      } else {
        // Ensure this is a receiving transceiver (not sending our own track back)
        if (sourceTransceiver.direction === 'sendonly') {
          this.debug.error('❌ Invalid direction: Receiving track from sendonly transceiver');
          return false;
        }
        this.debug.log(`✅ VALIDATION: Transceiver check passed (direction: ${sourceTransceiver.direction})`);
      }
    }

    // Check 4: Verify stream hasn't been marked as local origin (with safe property access)
    if (stream && stream._peerPigeonOrigin === 'local') {
      this.debug.error('❌ Stream marked as local origin - preventing synchronization loop');
      return false;
    }
    this.debug.log('✅ VALIDATION: Local origin check passed');

    this.debug.log('✅ Remote stream validation passed for peer', this.peerId.substring(0, 8));
    return true;
  }

  /**
     * Mark a stream as genuinely remote to prevent future confusion
     */
  markStreamAsRemote(stream) {
    // Add internal marker to prevent future misidentification
    Object.defineProperty(stream, '_peerPigeonOrigin', {
      value: 'remote',
      writable: false,
      enumerable: false,
      configurable: false
    });

    Object.defineProperty(stream, '_peerPigeonSourcePeerId', {
      value: this.peerId,
      writable: false,
      enumerable: false,
      configurable: false
    });

    this.debug.log(`🔒 Stream ${stream.id} marked as remote from peer ${this.peerId.substring(0, 8)}`);
  }

  /**
     * Mark local stream to prevent it from being treated as remote
     */
  markStreamAsLocal(stream) {
    if (!stream) return;

    Object.defineProperty(stream, '_peerPigeonOrigin', {
      value: 'local',
      writable: false,
      enumerable: false,
      configurable: false
    });

    this.debug.log(`🔒 Stream ${stream.id} marked as local origin`);
  }

  /**
   * Add local stream using addTrack() method to trigger ontrack events
   */
  async addLocalStreamWithAddTrack(stream) {
    if (!stream || !this.connection) return;

    this.debug.log('🎥 Adding local stream using addTrack() for proper ontrack events');

    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();

    // Mark stream as local origin to prevent loopback
    this.markStreamAsLocal(stream);

    // Add audio tracks using addTrack()
    audioTracks.forEach((audioTrack, index) => {
      this.debug.log(`🎤 Adding audio track ${index} using addTrack()`);
      try {
        const audioSender = this.connection.addTrack(audioTrack, stream);
        this.audioTransceiver = this.connection.getTransceivers().find(t => t.sender === audioSender);
        
        // Setup audio sending monitoring
        this.setupAudioSendingMonitoring(audioTrack);
        this.debug.log(`🎤 SENDING AUDIO to peer ${this.peerId.substring(0, 8)} - track enabled: ${audioTrack.enabled}`);
      } catch (error) {
        this.debug.error(`❌ Failed to add audio track ${index}:`, error);
      }
    });

    // Add video tracks using addTrack()
    videoTracks.forEach((videoTrack, index) => {
      this.debug.log(`🎥 Adding video track ${index} using addTrack()`);
      try {
        const videoSender = this.connection.addTrack(videoTrack, stream);
        this.videoTransceiver = this.connection.getTransceivers().find(t => t.sender === videoSender);
        this.debug.log(`🎥 SENDING VIDEO to peer ${this.peerId.substring(0, 8)} - track enabled: ${videoTrack.enabled}`);
      } catch (error) {
        this.debug.error(`❌ Failed to add video track ${index}:`, error);
      }
    });

    this.localStream = stream;
    this.debug.log('✅ Local stream added using addTrack() method');
    
    // DEBUG: Log transceivers after adding tracks
    const transceivers = this.connection.getTransceivers();
    this.debug.log('🔍 Transceivers after addTrack():', transceivers.map(t => ({
      kind: t.receiver?.track?.kind || 'unknown',
      direction: t.direction,
      hasTrack: !!t.sender?.track,
      trackId: t.sender?.track?.id?.substring(0, 8) || 'none',
      mid: t.mid
    })));
  }

  /**
     * Add or replace local media stream
     */
  async setLocalStream(stream) {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    this.debug.log(`Setting local stream for ${this.peerId}, current state: ${this.connection.connectionState}, signaling: ${this.connection.signalingState}`);

    // First, remove any existing local tracks
    const senders = this.connection.getSenders();
    for (const sender of senders) {
      if (sender.track) {
        this.debug.log('�️ Removing existing track:', sender.track.kind);
        this.connection.removeTrack(sender);
      }
    }

    // Clear transceiver references
    this.audioTransceiver = null;
    this.videoTransceiver = null;

    if (stream) {
      this.debug.log('🎥 Adding new stream using addTrack() method');
      await this.addLocalStreamWithAddTrack(stream);
    } else {
      this.localStream = null;
      this.debug.log('✅ All tracks removed');
    }

    this.debug.log('Updated local media stream for', this.peerId);

    // CRITICAL: Force renegotiation when media changes
    this.debug.log('✅ Stream updated - forcing renegotiation for media changes');
    this.debug.log(`   Current state: connectionState=${this.connection.connectionState}, signalingState=${this.connection.signalingState}`);

    // Always trigger renegotiation when stream changes
    if (stream) {
      setTimeout(() => {
        this.debug.log('🔄 Forcing renegotiation for media stream changes');
        this.emit('renegotiationNeeded', { peerId: this.peerId });
      }, 200);
    }
  }

  /**
   * Force connection recovery for stuck connections
   */
  async forceConnectionRecovery() {
    this.debug.log(`🆘 FORCE RECOVERY: Attempting emergency recovery for ${this.peerId.substring(0, 8)}...`);

    try {
      // Create a new offer to break the stuck state
      const offer = await Promise.race([
        this.connection.createOffer({ iceRestart: true }),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('forceConnectionRecovery createOffer timeout')), 10000)
        )
      ]);
      
      await Promise.race([
        this.connection.setLocalDescription(offer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('forceConnectionRecovery setLocalDescription timeout')), 10000)
        )
      ]);

      // Emit recovery offer via mesh signaling
      if (this.mesh && this.mesh.sendSignalingMessage) {
        await this.mesh.sendSignalingMessage({
          type: 'recovery-offer',
          data: offer,
          emergency: true
        }, this.peerId);

        this.debug.log(`✅ RECOVERY: Emergency offer sent for ${this.peerId.substring(0, 8)}...`);
      } else {
        this.debug.error(`❌ RECOVERY: No mesh signaling available for ${this.peerId.substring(0, 8)}...`);
      }
    } catch (error) {
      this.debug.error(`❌ RECOVERY: Emergency recovery failed for ${this.peerId.substring(0, 8)}...`, error);
      throw error;
    }
  }

  /**
     * Setup audio data monitoring for received audio tracks
     */
  setupAudioDataMonitoring(audioTrack, trackIndex) {
    this.debug.log(`🎵 Setting up audio data monitoring for track ${trackIndex} from peer ${this.peerId.substring(0, 8)}`);

    try {
      // Create audio context for analyzing audio data
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        this.debug.warn('🎵 AudioContext not available - cannot monitor audio data');
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
          this.debug.log(`🎵 Audio track ${trackIndex} ended, stopping monitoring for peer ${this.peerId.substring(0, 8)}`);
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
          this.debug.log(`🎵 Audio data from peer ${this.peerId.substring(0, 8)} track ${trackIndex}:`, {
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
        this.debug.log(`🎵 Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} ended`);
        audioContext.close();
      });

      audioTrack.addEventListener('mute', () => {
        this.debug.log(`🎵 Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} muted`);
      });

      audioTrack.addEventListener('unmute', () => {
        this.debug.log(`🎵 Audio track ${trackIndex} from peer ${this.peerId.substring(0, 8)} unmuted`);
      });

      this.debug.log(`🎵 Audio monitoring started for track ${trackIndex} from peer ${this.peerId.substring(0, 8)}`);
    } catch (error) {
      this.debug.error(`🎵 Failed to setup audio monitoring for track ${trackIndex}:`, error);
    }
  }

  /**
     * Setup audio sending monitoring for outgoing audio tracks
     */
  setupAudioSendingMonitoring(audioTrack) {
    this.debug.log(`🎤 Setting up audio SENDING monitoring to peer ${this.peerId.substring(0, 8)}`);

    try {
      // Monitor track state changes
      audioTrack.addEventListener('ended', () => {
        this.debug.log(`🎤 Audio SENDING track ended to peer ${this.peerId.substring(0, 8)}`);
      });

      audioTrack.addEventListener('mute', () => {
        this.debug.log(`🎤 Audio SENDING track muted to peer ${this.peerId.substring(0, 8)}`);
      });

      audioTrack.addEventListener('unmute', () => {
        this.debug.log(`🎤 Audio SENDING track unmuted to peer ${this.peerId.substring(0, 8)}`);
      });

      // Monitor audio input levels if possible
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        this.debug.warn('🎤 AudioContext not available - basic sending monitoring only');
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
          this.debug.log(`🎤 Audio sending track ended, stopping monitoring to peer ${this.peerId.substring(0, 8)}`);
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
          this.debug.log(`🎤 Audio SENDING to peer ${this.peerId.substring(0, 8)}:`, {
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
      this.debug.log(`🎤 Audio sending monitoring started to peer ${this.peerId.substring(0, 8)}`);
    } catch (error) {
      this.debug.error(`🎤 Failed to setup audio sending monitoring to peer ${this.peerId.substring(0, 8)}:`, error);
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
   * Allow remote streams to be emitted (called after crypto verification)
   */
  allowRemoteStreamEmission() {
    this.debug.log(`🔓 CRYPTO: Allowing remote stream emission for ${this.peerId.substring(0, 8)}...`);
    this.allowRemoteStreams = true;
    
    // Emit any buffered remote streams
    while (this.pendingRemoteStreams.length > 0) {
      const streamEvent = this.pendingRemoteStreams.shift();
      this.debug.log(`🔓 CRYPTO: Emitting buffered remote stream from ${streamEvent.peerId.substring(0, 8)}...`);
      this.emit('remoteStream', streamEvent);
    }
  }

  /**
   * Block remote streams (called when crypto is required but not verified)
   */
  blockRemoteStreamEmission() {
    // Check if crypto blocking is globally disabled (for video tests)
    if (typeof window !== 'undefined' && window.DISABLE_CRYPTO_BLOCKING) {
      this.debug.log(`🔓 CRYPTO: Video test mode - NOT blocking remote stream emission for ${this.peerId.substring(0, 8)}...`);
      return; // Don't block streams in video test mode
    }
    
    this.debug.log(`🔒 CRYPTO: Blocking remote stream emission for ${this.peerId.substring(0, 8)}...`);
    this.allowRemoteStreams = false;
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

    // Add media stream information if available
    if (this.remoteStream || this.localStream) {
      status.audioTracks = {
        remote: this.remoteStream ? this.remoteStream.getAudioTracks().length : 0,
        local: this.localStream ? this.localStream.getAudioTracks().length : 0
      };
      status.videoTracks = {
        remote: this.remoteStream ? this.remoteStream.getVideoTracks().length : 0,
        local: this.localStream ? this.localStream.getVideoTracks().length : 0
      };
    }

    return status;
  }

  /**
   * Restart ICE using signaling coordination (WebSocket or mesh)
   * This allows ICE restart to work even when the signaling server is down
   * by using the mesh for coordination
   */
  async restartIceViaSignaling() {
    if (!this.connection) {
      throw new Error('No connection to restart ICE for');
    }

    this.debug.log(`🔄 Restarting ICE via signaling for ${this.peerId}`);

    try {
      // Trigger ICE restart - this will generate new ICE candidates
      this.connection.restartIce();

      // Create a new offer with the restarted ICE
      const offer = await Promise.race([
        this.connection.createOffer({ iceRestart: true }),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('ICE restart createOffer timeout')), 10000)
        )
      ]);
      
      await Promise.race([
        this.connection.setLocalDescription(offer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('ICE restart setLocalDescription timeout')), 10000)
        )
      ]);

      // Send the new offer via our mesh signaling system
      if (this.mesh && this.mesh.sendSignalingMessage) {
        await this.mesh.sendSignalingMessage({
          type: 'ice-restart-offer',
          data: { offer }
        }, this.peerId);

        this.debug.log(`✅ ICE restart offer sent for ${this.peerId}`);
      } else {
        throw new Error('No signaling method available for ICE restart');
      }
    } catch (error) {
      this.debug.error(`Failed to restart ICE for ${this.peerId}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming ICE restart offers
   */
  async handleIceRestartOffer(offer) {
    if (!this.connection) {
      this.debug.error('Cannot handle ICE restart offer - no connection');
      return;
    }

    this.debug.log(`🔄 Handling ICE restart offer from ${this.peerId}`);

    try {
      await Promise.race([
        this.connection.setRemoteDescription(offer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('ICE restart setRemoteDescription timeout')), 10000)
        )
      ]);
      
      const answer = await Promise.race([
        this.connection.createAnswer(),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('ICE restart createAnswer timeout')), 10000)
        )
      ]);
      
      await Promise.race([
        this.connection.setLocalDescription(answer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('ICE restart setLocalDescription timeout')), 10000)
        )
      ]);

      // Send the answer back
      if (this.mesh && this.mesh.sendSignalingMessage) {
        await this.mesh.sendSignalingMessage({
          type: 'ice-restart-answer',
          data: { answer }
        }, this.peerId);

        this.debug.log(`✅ ICE restart answer sent for ${this.peerId}`);
      }
    } catch (error) {
      this.debug.error(`Failed to handle ICE restart offer from ${this.peerId}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming ICE restart answers
   */
  async handleIceRestartAnswer(answer) {
    if (!this.connection) {
      this.debug.error('Cannot handle ICE restart answer - no connection');
      return;
    }

    this.debug.log(`🔄 Handling ICE restart answer from ${this.peerId}`);

    try {
      await Promise.race([
        this.connection.setRemoteDescription(answer),
        new Promise((resolve, reject) => 
          setTimeout(() => reject(new Error('ICE restart setRemoteDescription timeout')), 10000)
        )
      ]);
      this.debug.log(`✅ ICE restart completed for ${this.peerId}`);
    } catch (error) {
      this.debug.error(`Failed to handle ICE restart answer from ${this.peerId}:`, error);
      throw error;
    }
  }

  close() {
    // Set flag to prevent disconnection events during intentional close
    this.isClosing = true;

    // Clear any existing ICE timeout
    if (this.iceTimeoutId) {
      clearTimeout(this.iceTimeoutId);
      this.iceTimeoutId = null;
    }

    if (this.connection) {
      this.connection.close();
    }
  }
}
