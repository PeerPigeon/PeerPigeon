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
    this.iceCheckingTimeout = null; // Timeout for ICE checking state
    this.connectingTimeout = null; // Timeout for stuck connecting state
    this.dataChannelHealthMonitor = null; // Health monitoring for data channel when signaling is unavailable
    this.isClosing = false; // Flag to prevent disconnection events during intentional close
    this._forcedStatus = null; // Track forced status (e.g., failed)

    // Media stream support
    this.localStream = options.localStream || null;
    this.remoteStream = null;
    this.enableVideo = options.enableVideo || false;
    this.enableAudio = options.enableAudio || false;
    this.audioTransceiver = null;
    this.videoTransceiver = null;
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

    this.connection = new RTCPeerConnection({
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

    // ALWAYS pre-allocate transceivers for audio and video to enable future media streaming
    // This ensures connections can handle media even if no media stream is available initially
    this.debug.log('🔄 Pre-allocating audio and video transceivers for future media capability');

    // Always add audio transceiver
    this.audioTransceiver = this.connection.addTransceiver('audio', {
      direction: 'sendrecv'
    });

    // Always add video transceiver
    this.videoTransceiver = this.connection.addTransceiver('video', {
      direction: 'sendrecv'
    });

    // Add local media stream if provided
    if (this.localStream) {
      this.debug.log('Adding local stream tracks to existing transceivers');
      await this.setLocalStreamToTransceivers(this.localStream);
    }

    if (this.isInitiator) {
      this.dataChannel = this.connection.createDataChannel('messages', {
        ordered: true
      });
      this.setupDataChannel();
    } else {
      this.connection.ondatachannel = (event) => {
        this.debug.log('Received data channel from', this.peerId);
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
        this.emit('remoteStream', { peerId: this.peerId, stream: this.remoteStream });
        this.debug.log('✅ ONTRACK DEBUG: remoteStream event emitted successfully');
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
        // Clear any pending timeouts
        if (this.connectingTimeout) {
          clearTimeout(this.connectingTimeout);
          this.connectingTimeout = null;
        }
        this.debug.log(`✅ Connection established with ${this.peerId}`);
        this.emit('connected', { peerId: this.peerId });
      } else if (this.connection.connectionState === 'connecting') {
        this.debug.log(`🔄 Connection to ${this.peerId} is connecting...`);
        // Add timeout for stuck connecting state
        if (this.connectingTimeout) {
          clearTimeout(this.connectingTimeout);
        }
        this.connectingTimeout = setTimeout(() => {
          if (this.connection && this.connection.connectionState === 'connecting' && !this.isClosing) {
            this.debug.log(`⏰ Connection stuck in connecting state for ${this.peerId}, treating as failed`);
            this.emit('disconnected', { peerId: this.peerId, reason: 'connection timeout' });
          }
        }, 5000); // Faster timeout - 5 seconds for connecting state
      } else if (this.connection.connectionState === 'disconnected') {
        // Give WebRTC more time to recover - it's common for connections to briefly disconnect during renegotiation
        this.debug.log(`⚠️ WebRTC connection disconnected for ${this.peerId}, waiting for potential recovery...`);
        setTimeout(() => {
          if (this.connection &&
                        this.connection.connectionState === 'disconnected' &&
                        !this.isClosing) {
            this.debug.log(`❌ WebRTC connection remained disconnected for ${this.peerId}, treating as failed`);
            this.emit('disconnected', { peerId: this.peerId, reason: 'connection disconnected' });
          }
        }, 3000); // Faster recovery - 3 seconds for disconnected state
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
        // Clear any pending timeout
        if (this.iceCheckingTimeout) {
          clearTimeout(this.iceCheckingTimeout);
          this.iceCheckingTimeout = null;
        }
        this.debug.log(`✅ ICE connection established with ${this.peerId}`);
      } else if (this.connection.iceConnectionState === 'checking') {
        this.debug.log(`🔄 ICE checking for ${this.peerId}...`);
        // Set a timeout for ICE checking state - if it takes too long, only restart if signaling is available
        if (this.iceCheckingTimeout) {
          clearTimeout(this.iceCheckingTimeout);
        }
        this.iceCheckingTimeout = setTimeout(() => {
          if (this.connection && this.connection.iceConnectionState === 'checking') {
            // Check if signaling is available before attempting ICE restart
            const hasSignaling = this.mesh && this.mesh.signalingClient && this.mesh.signalingClient.isConnected();
            const hasMeshConnectivity = this.mesh && this.mesh.connected && this.mesh.connectionManager.getConnectedPeerCount() > 0;

            if (hasSignaling || hasMeshConnectivity) {
              this.debug.log(`⏰ ICE checking timeout for ${this.peerId}, attempting restart (signaling: ${hasSignaling}, mesh: ${hasMeshConnectivity})`);
              try {
                this.restartIceViaSignaling().catch(error => {
                  this.debug.error('Failed to restart ICE:', error);
                  this.emit('disconnected', { peerId: this.peerId, reason: 'ICE restart failed' });
                });
              } catch (error) {
                this.debug.error('Failed to restart ICE:', error);
                this.emit('disconnected', { peerId: this.peerId, reason: 'ICE restart failed' });
              }
            } else {
              this.debug.log(`⏰ ICE checking timeout for ${this.peerId}, but no signaling available - keeping connection alive`);
              // Don't disconnect - peer connection may still work without signaling server
            }
          }
        }, 10000); // Faster ICE checking timeout - 10 seconds
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
          this.debug.log(`❌ ICE connection failed for ${this.peerId}, but no signaling available - monitoring data channel`);
          // Don't immediately disconnect - monitor data channel health instead
          this.monitorDataChannelHealth();
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
              this.debug.log(`❌ ICE remained disconnected for ${this.peerId}, but no signaling available - monitoring data channel`);
              // Monitor data channel health instead of immediately disconnecting
              this.monitorDataChannelHealth();
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

        // Handle internal ping messages for health monitoring
        if (message.type === 'ping') {
          this.debug.log(`📡 Received health ping from ${this.peerId}, responding with pong`);
          try {
            const pongMessage = {
              type: 'pong',
              timestamp: Date.now(),
              originalTimestamp: message.timestamp,
              from: this.mesh?.peerId || 'unknown'
            };
            this.dataChannel.send(JSON.stringify(pongMessage));
          } catch (error) {
            this.debug.error('Failed to send pong response:', error);
          }
          return; // Don't emit this as a regular message
        }

        // Handle pong responses (optional logging)
        if (message.type === 'pong') {
          this.debug.log(`📡 Received health pong from ${this.peerId}`);
          return; // Don't emit this as a regular message
        }

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

  async createOffer() {
    // Create offer with optimized settings for faster connection
    const offer = await this.connection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
      iceRestart: false // Don't restart ICE unless necessary
    });
    await this.connection.setLocalDescription(offer);
    return offer;
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
      await this.connection.setRemoteDescription(offer);
      this.remoteDescriptionSet = true;
      this.debug.log(`✅ OFFER DEBUG: Offer processed successfully from ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`✅ OFFER DEBUG: New signaling state after offer: ${this.connection.signalingState}`);
      await this.processPendingIceCandidates();

      const answer = await this.connection.createAnswer();
      await this.connection.setLocalDescription(answer);
      this.debug.log(`✅ OFFER DEBUG: Answer created for offer from ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`✅ OFFER DEBUG: Final signaling state after answer: ${this.connection.signalingState}`);
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
      await this.connection.setRemoteDescription(answer);
      this.remoteDescriptionSet = true;
      this.debug.log(`✅ ANSWER DEBUG: Answer processed successfully from ${this.peerId.substring(0, 8)}...`);
      this.debug.log(`✅ ANSWER DEBUG: New signaling state: ${this.connection.signalingState}`);
      this.debug.log(`✅ ANSWER DEBUG: New connection state: ${this.connection.connectionState}`);
      await this.processPendingIceCandidates();
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
      await this.connection.addIceCandidate(candidate);
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
          await this.connection.addIceCandidate(candidate);
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
              this.emit('remoteStream', { peerId: this.peerId, stream: this.remoteStream });
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
     * Add or replace local media stream
     */
  async setLocalStream(stream) {
    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    this.debug.log(`Setting local stream for ${this.peerId}, current state: ${this.connection.connectionState}, signaling: ${this.connection.signalingState}`);

    // DEBUG: Log current transceivers before any changes
    const transceivers = this.connection.getTransceivers();
    this.debug.log('🔍 Current transceivers before stream change:', transceivers.map(t => ({
      kind: t.receiver.track?.kind || 'unknown',
      direction: t.direction,
      hasTrack: !!t.sender.track,
      mid: t.mid
    })));

    // Use stored transceiver references for reliable access
    this.debug.log('🔄 Using stored transceiver references for media');

    if (stream) {
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();

      // Mark stream as local origin to prevent loopback
      this.markStreamAsLocal(stream);

      // Handle audio track using stored reference
      if (this.audioTransceiver) {
        if (audioTracks.length > 0) {
          this.debug.log('🔄 Replacing audio track in stored transceiver');
          await this.audioTransceiver.sender.replaceTrack(audioTracks[0]);
          this.audioTransceiver.direction = 'sendrecv';

          // Setup audio sending monitoring
          this.setupAudioSendingMonitoring(audioTracks[0]);
          this.debug.log(`🎤 SENDING AUDIO to peer ${this.peerId.substring(0, 8)} - track enabled: ${audioTracks[0].enabled}`);
        } else {
          this.debug.log('🔄 Removing audio track from stored transceiver');
          await this.audioTransceiver.sender.replaceTrack(null);
          this.audioTransceiver.direction = 'recvonly';
          this.debug.log(`🎤 STOPPED SENDING AUDIO to peer ${this.peerId.substring(0, 8)}`);
        }
      }

      // Handle video track using stored reference
      if (this.videoTransceiver) {
        if (videoTracks.length > 0) {
          this.debug.log('🔄 Replacing video track in stored transceiver');
          await this.videoTransceiver.sender.replaceTrack(videoTracks[0]);
          this.videoTransceiver.direction = 'sendrecv';
        } else {
          this.debug.log('🔄 Removing video track from stored transceiver');
          await this.videoTransceiver.sender.replaceTrack(null);
          this.videoTransceiver.direction = 'recvonly';
        }
      }

      this.localStream = stream;
      this.debug.log('✅ Stream set successfully using stored transceivers');
    } else {
      // Remove all tracks using stored references
      if (this.audioTransceiver) {
        this.debug.log('🔄 Removing audio track from stored transceiver');
        await this.audioTransceiver.sender.replaceTrack(null);
        this.audioTransceiver.direction = 'recvonly';
      }

      if (this.videoTransceiver) {
        this.debug.log('🔄 Removing video track from stored transceiver');
        await this.videoTransceiver.sender.replaceTrack(null);
        this.videoTransceiver.direction = 'recvonly';
      }

      this.localStream = null;
      this.debug.log('✅ All tracks removed using stored transceivers');
    }

    this.debug.log('Updated local media stream for', this.peerId);

    // DEBUG: Log final transceivers after changes
    const finalTransceivers = this.connection.getTransceivers();
    this.debug.log('🔍 Final transceivers after stream change:', finalTransceivers.map(t => ({
      kind: t.receiver?.track?.kind || 'unknown',
      direction: t.direction,
      hasTrack: !!t.sender?.track,
      trackId: t.sender?.track?.id?.substring(0, 8) || 'none',
      mid: t.mid
    })));

    // AGGRESSIVE FIX: Force immediate renegotiation if connection is stuck
    if (this.connection.signalingState === 'have-local-offer') {
      this.debug.log('🆘 FORCE RENEGOTIATION: Connection stuck in \'have-local-offer\' - forcing immediate renegotiation');

      // Force renegotiation event
      this.emit('renegotiationNeeded', { peerId: this.peerId });

      // Also try direct renegotiation as backup
      setTimeout(() => {
        if (this.connection.signalingState === 'have-local-offer') {
          this.debug.log('🆘 EMERGENCY: Still stuck after forced renegotiation - attempting direct recovery');
          this.forceConnectionRecovery().catch(err => {
            this.debug.error('❌ EMERGENCY: Direct recovery failed', err);
          });
        }
      }, 5000);
    } else {
      // Normal renegotiation for stable connections
      this.debug.log('✅ RENEGOTIATION: Triggering normal renegotiation for media changes');
      this.emit('renegotiationNeeded', { peerId: this.peerId });
    }

    // CRITICAL: Force renegotiation when media changes
    this.debug.log('✅ Stream updated - forcing renegotiation for media changes');
    this.debug.log(`   Current state: connectionState=${this.connection.connectionState}, signalingState=${this.connection.signalingState}`);

    // Always trigger renegotiation when stream changes, regardless of connection state
    if (stream) {
      setTimeout(() => {
        this.debug.log('🔄 Forcing renegotiation for media stream changes');
        this.emit('renegotiationNeeded', { peerId: this.peerId });
      }, 200); // Increased delay to ensure replaceTrack completes
    }
  }

  /**
   * Force connection recovery for stuck connections
   */
  async forceConnectionRecovery() {
    this.debug.log(`🆘 FORCE RECOVERY: Attempting emergency recovery for ${this.peerId.substring(0, 8)}...`);

    try {
      // Create a new offer to break the stuck state
      const offer = await this.connection.createOffer({ iceRestart: true });
      await this.connection.setLocalDescription(offer);

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
     * Helper method to set local stream tracks to existing transceivers
     */
  async setLocalStreamToTransceivers(stream) {
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();

      // Set audio track to stored audio transceiver
      if (this.audioTransceiver && audioTracks.length > 0) {
        this.debug.log('🔄 Setting audio track to stored audio transceiver');
        await this.audioTransceiver.sender.replaceTrack(audioTracks[0]);
        this.audioTransceiver.direction = 'sendrecv';

        // Setup audio sending monitoring
        this.setupAudioSendingMonitoring(audioTracks[0]);
        this.debug.log(`🎤 SENDING AUDIO to peer ${this.peerId.substring(0, 8)} via transceiver - track enabled: ${audioTracks[0].enabled}`);
      }

      // Set video track to stored video transceiver
      if (this.videoTransceiver && videoTracks.length > 0) {
        this.debug.log('🔄 Setting video track to stored video transceiver');
        await this.videoTransceiver.sender.replaceTrack(videoTracks[0]);
        this.videoTransceiver.direction = 'sendrecv';
      }
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
   * Monitor data channel health when ICE connection is problematic but signaling is unavailable
   * This allows peer connections to survive signaling server outages
   */
  monitorDataChannelHealth() {
    if (this.dataChannelHealthMonitor) {
      clearTimeout(this.dataChannelHealthMonitor);
    }

    this.debug.log(`📡 Monitoring data channel health for ${this.peerId} (signaling unavailable)`);

    // Test data channel by sending a ping message
    const testDataChannel = () => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open' || this.isClosing) {
        this.debug.log(`❌ Data channel not available for ${this.peerId}, disconnecting`);
        this.emit('disconnected', { peerId: this.peerId, reason: 'data channel unavailable' });
        return;
      }

      try {
        // Send a small ping message to test connectivity
        const pingMessage = {
          type: 'ping',
          timestamp: Date.now(),
          from: this.mesh?.peerId || 'unknown'
        };

        this.dataChannel.send(JSON.stringify(pingMessage));
        this.debug.log(`✅ Data channel ping sent to ${this.peerId} - connection appears healthy`);

        // Schedule next health check in 30 seconds
        this.dataChannelHealthMonitor = setTimeout(testDataChannel, 30000);
      } catch (error) {
        this.debug.error(`❌ Data channel ping failed for ${this.peerId}:`, error);
        this.emit('disconnected', { peerId: this.peerId, reason: 'data channel ping failed' });
      }
    };

    // Start monitoring after a short delay
    this.dataChannelHealthMonitor = setTimeout(testDataChannel, 5000);
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
      const offer = await this.connection.createOffer({ iceRestart: true });
      await this.connection.setLocalDescription(offer);

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
      await this.connection.setRemoteDescription(offer);
      const answer = await this.connection.createAnswer();
      await this.connection.setLocalDescription(answer);

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
      await this.connection.setRemoteDescription(answer);
      this.debug.log(`✅ ICE restart completed for ${this.peerId}`);
    } catch (error) {
      this.debug.error(`Failed to handle ICE restart answer from ${this.peerId}:`, error);
      throw error;
    }
  }

  /**
   * Stop data channel health monitoring
   */
  stopDataChannelHealthMonitoring() {
    if (this.dataChannelHealthMonitor) {
      clearTimeout(this.dataChannelHealthMonitor);
      this.dataChannelHealthMonitor = null;
      this.debug.log(`📡 Stopped data channel health monitoring for ${this.peerId}`);
    }
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

    // Stop data channel health monitoring
    this.stopDataChannelHealthMonitoring();

    if (this.connection) {
      this.connection.close();
    }
  }
}
