import { EventEmitter } from './EventEmitter.js';
import { environmentDetector } from './EnvironmentDetector.js';

export class MediaManager extends EventEmitter {
    constructor() {
        super();
        this.localStream = null;
        this.isVideoEnabled = false;
        this.isAudioEnabled = false;
        this.devices = {
            cameras: [],
            microphones: [],
            speakers: []
        };
        
        this.constraints = {
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
    }

    /**
     * Initialize media devices and permissions
     */
    async init() {
        // Check if media APIs are available
        if (!environmentDetector.hasGetUserMedia) {
            console.warn('getUserMedia not available in this environment');
            this.emit('error', { type: 'init', error: new Error('getUserMedia not supported') });
            return false;
        }

        try {
            // Enumerate available devices
            await this.enumerateDevices();
            return true;
        } catch (error) {
            console.error('Failed to initialize media manager:', error);
            this.emit('error', { type: 'init', error });
            return false;
        }
    }

    /**
     * Get available media devices
     */
    async enumerateDevices() {
        // Only available in browser environments with media device support
        if (!environmentDetector.isBrowser || typeof navigator.mediaDevices === 'undefined') {
            console.warn('Media device enumeration not available in this environment');
            return;
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            this.devices.cameras = devices.filter(device => device.kind === 'videoinput');
            this.devices.microphones = devices.filter(device => device.kind === 'audioinput');
            this.devices.speakers = devices.filter(device => device.kind === 'audiooutput');
            
            this.emit('devicesUpdated', this.devices);
            return this.devices;
        } catch (error) {
            console.error('Failed to enumerate devices:', error);
            this.emit('error', { type: 'enumerate', error });
            throw error;
        }
    }

    /**
     * Start local media stream with specified constraints
     */
    async startLocalStream(options = {}) {
        const { video = false, audio = false, deviceIds = {} } = options;
        
        try {
            // Stop existing stream first
            if (this.localStream) {
                this.stopLocalStream();
            }

            const constraints = {};
            
            if (video) {
                constraints.video = { ...this.constraints.video };
                if (deviceIds.camera) {
                    constraints.video.deviceId = { exact: deviceIds.camera };
                }
            }
            
            if (audio) {
                constraints.audio = { ...this.constraints.audio };
                if (deviceIds.microphone) {
                    constraints.audio.deviceId = { exact: deviceIds.microphone };
                }
            }

            if (!video && !audio) {
                throw new Error('At least one of video or audio must be enabled');
            }

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.isVideoEnabled = video;
            this.isAudioEnabled = audio;
            
            // Mark stream as local origin to prevent confusion with remote streams
            this.markStreamAsLocal(this.localStream);
            
            console.log('Local media stream started:', {
                video: this.isVideoEnabled,
                audio: this.isAudioEnabled,
                tracks: this.localStream.getTracks().map(track => ({
                    kind: track.kind,
                    enabled: track.enabled,
                    label: track.label
                }))
            });
            
            this.emit('localStreamStarted', {
                stream: this.localStream,
                video: this.isVideoEnabled,
                audio: this.isAudioEnabled
            });
            
            return this.localStream;
        } catch (error) {
            console.error('Failed to start local media stream:', error);
            this.emit('error', { type: 'getUserMedia', error });
            throw error;
        }
    }

    /**
     * Stop local media stream
     */
    stopLocalStream() {
        if (this.localStream) {
            console.log('Stopping local media stream');
            this.localStream.getTracks().forEach(track => {
                track.stop();
            });
            this.localStream = null;
            this.isVideoEnabled = false;
            this.isAudioEnabled = false;
            
            this.emit('localStreamStopped');
        }
    }

    /**
     * Toggle video track on/off
     */
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.emit('videoToggled', { enabled: videoTrack.enabled });
                return videoTrack.enabled;
            }
        }
        return false;
    }

    /**
     * Toggle audio track on/off
     */
    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.emit('audioToggled', { enabled: audioTrack.enabled });
                return audioTrack.enabled;
            }
        }
        return false;
    }

    /**
     * Get current media state
     */
    getMediaState() {
        const state = {
            hasLocalStream: !!this.localStream,
            videoEnabled: false,
            audioEnabled: false,
            devices: this.devices
        };

        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            const audioTrack = this.localStream.getAudioTracks()[0];
            
            state.videoEnabled = videoTrack ? videoTrack.enabled : false;
            state.audioEnabled = audioTrack ? audioTrack.enabled : false;
        }

        return state;
    }

    /**
     * Check if browser supports required APIs
     */
    static checkSupport() {
        const support = {
            getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
            enumerateDevices: !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices),
            webRTC: !!(window.RTCPeerConnection)
        };
        
        support.fullSupport = support.getUserMedia && support.enumerateDevices && support.webRTC;
        return support;
    }

    /**
     * Get media permissions status
     */
    async getPermissions() {
        try {
            const permissions = {};
            
            if (navigator.permissions) {
                permissions.camera = await navigator.permissions.query({ name: 'camera' });
                permissions.microphone = await navigator.permissions.query({ name: 'microphone' });
            }
            
            return permissions;
        } catch (error) {
            console.warn('Could not check media permissions:', error);
            return {};
        }
    }

    /**
     * Mark stream as local origin to prevent confusion with remote streams
     */
    markStreamAsLocal(stream) {
        if (!stream) return;
        
        try {
            Object.defineProperty(stream, '_peerPigeonOrigin', {
                value: 'local',
                writable: false,
                enumerable: false,
                configurable: false
            });

            console.log(`🔒 Stream ${stream.id} marked as local origin in MediaManager`);
        } catch (error) {
            console.warn('Could not mark stream as local origin:', error);
        }
    }
}
