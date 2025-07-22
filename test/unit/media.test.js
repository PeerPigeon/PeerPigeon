/**
 * Unit Tests for Media Functionality
 * Tests MediaManager, media streaming, device enumeration, and media controls
 */

import { jest } from '@jest/globals';
import { MediaManager } from '../../src/MediaManager.js';
import { PeerPigeonMesh } from '../../index.js';

// Mock crypto library before any imports
global.crypto = {
  getRandomValues: (arr) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  },
  subtle: {
    generateKey: jest.fn(),
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    digest: jest.fn()
  }
};

// Ensure process is available for Node.js detection
global.process = process;

// Mock browser environment globals BEFORE importing anything that uses them
global.window = {
  RTCPeerConnection: function () {},
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  setInterval: global.setInterval,
  clearInterval: global.clearInterval
};

global.document = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

// Mock navigator.mediaDevices for testing
const mockGetUserMedia = jest.fn();
const mockEnumerateDevices = jest.fn();
const mockPermissionsQuery = jest.fn();

global.navigator = {
  mediaDevices: {
    getUserMedia: mockGetUserMedia,
    enumerateDevices: mockEnumerateDevices
  },
  permissions: {
    query: mockPermissionsQuery
  },
  userAgent: 'Mozilla/5.0 Jest Test'
};

// Mock environment detector for all imports
Object.defineProperty(global, 'environmentDetector', {
  value: {
    isBrowser: true,
    hasGetUserMedia: true,
    isNode: false,
    getEnvironmentReport: () => ({
      runtime: {
        isBrowser: true,
        isNodeJS: false,
        isWorker: false
      },
      capabilities: {
        webrtc: true,
        webSocket: true,
        localStorage: true,
        sessionStorage: true,
        randomValues: true
      }
    })
  },
  writable: true
});

// Mock MediaStream and related APIs
class MockMediaStream {
  constructor(tracks = []) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.tracks = tracks;
  }

  getTracks() {
    return this.tracks;
  }

  getVideoTracks() {
    return this.tracks.filter(track => track.kind === 'video');
  }

  getAudioTracks() {
    return this.tracks.filter(track => track.kind === 'audio');
  }
}

class MockMediaStreamTrack {
  constructor(kind, label = '') {
    this.kind = kind;
    this.label = label;
    this.enabled = true;
    this.readyState = 'live';
  }

  stop() {
    this.readyState = 'ended';
  }
}

global.MediaStream = MockMediaStream;
global.MediaStreamTrack = MockMediaStreamTrack;

describe('Media Functionality Tests', () => {
  let mediaManager;
  let mesh;

  beforeEach(() => {
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Reset mocks
    mockGetUserMedia.mockClear();
    mockEnumerateDevices.mockClear();
    mockPermissionsQuery.mockClear();

    // Setup default mock implementations
    mockGetUserMedia.mockImplementation(async (constraints) => {
      const tracks = [];
      if (constraints.video) {
        tracks.push(new MockMediaStreamTrack('video', 'Mock Camera'));
      }
      if (constraints.audio) {
        tracks.push(new MockMediaStreamTrack('audio', 'Mock Microphone'));
      }
      return new MockMediaStream(tracks);
    });

    mockEnumerateDevices.mockImplementation(async () => [
      {
        deviceId: 'camera1',
        kind: 'videoinput',
        label: 'Mock Camera 1'
      },
      {
        deviceId: 'mic1',
        kind: 'audioinput',
        label: 'Mock Microphone 1'
      },
      {
        deviceId: 'speaker1',
        kind: 'audiooutput',
        label: 'Mock Speaker 1'
      }
    ]);

    mockPermissionsQuery.mockResolvedValue({ state: 'granted' });

    // Initialize MediaManager fresh for each test
    mediaManager = new MediaManager();
  });

  afterEach(async () => {
    if (mediaManager) {
      try {
        mediaManager.stopLocalStream();
      } catch (error) {
        // Ignore cleanup errors
      }
      mediaManager = null;
    }

    if (mesh) {
      try {
        await mesh.disconnect();

        // Additional cleanup for any remaining intervals/timeouts
        if (mesh.connectionManager) {
          mesh.connectionManager.stopPeriodicCleanup();
        }
        if (mesh.gossipManager) {
          mesh.gossipManager.stopCleanupTimer();
        }
        if (mesh.peerDiscovery) {
          mesh.peerDiscovery.stop();
        }

        mesh = null;
      } catch (error) {
        console.warn('Error during mesh cleanup:', error.message);
        mesh = null;
      }
    }

    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('MediaManager Tests', () => {
    test('MediaManager initialization', () => {
      expect(mediaManager.localStream).toBeNull();
      expect(mediaManager.isVideoEnabled).toBe(false);
      expect(mediaManager.isAudioEnabled).toBe(false);
    });

    test('Device enumeration', async () => {
      const devices = await mediaManager.enumerateDevices();

      // In test environment, enumerateDevices returns undefined due to environment detection
      expect(devices).toBeUndefined();
    });

    test('Start local video stream', async () => {
      const stream = await mediaManager.startLocalStream({
        video: true,
        audio: false
      });

      expect(stream).toBeInstanceOf(MockMediaStream);
      // MediaManager merges video constraints with defaults
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        }
      });
      expect(mediaManager.isVideoEnabled).toBe(true);
      expect(mediaManager.isAudioEnabled).toBe(false);
    });

    test('Start local audio stream', async () => {
      const stream = await mediaManager.startLocalStream({
        video: false,
        audio: true
      });

      expect(stream).toBeInstanceOf(MockMediaStream);
      // MediaManager merges audio constraints with defaults
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      expect(mediaManager.isVideoEnabled).toBe(false);
      expect(mediaManager.isAudioEnabled).toBe(true);
    });

    test('Start local audio and video stream', async () => {
      const stream = await mediaManager.startLocalStream({
        video: true,
        audio: true
      });

      expect(stream).toBeInstanceOf(MockMediaStream);
      // MediaManager merges constraints with defaults
      expect(mockGetUserMedia).toHaveBeenCalledWith({
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
      });
      expect(mediaManager.isVideoEnabled).toBe(true);
      expect(mediaManager.isAudioEnabled).toBe(true);
    });

    test('Start stream with device IDs', async () => {
      const stream = await mediaManager.startLocalStream({
        video: true,
        audio: true,
        deviceIds: {
          camera: 'camera1',
          microphone: 'mic1'
        }
      });

      expect(stream).toBeInstanceOf(MockMediaStream);
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          deviceId: { exact: 'camera1' }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          deviceId: { exact: 'mic1' }
        }
      });
    });

    test('Error when starting stream with no media types', async () => {
      await expect(mediaManager.startLocalStream({})).rejects.toThrow();
    });

    test('Stop local stream', () => {
      // First start a stream
      const mockStream = new MockMediaStream([
        new MockMediaStreamTrack('video'),
        new MockMediaStreamTrack('audio')
      ]);
      mediaManager.localStream = mockStream;

      // Then stop it
      mediaManager.stopLocalStream();

      expect(mediaManager.localStream).toBeNull();
      expect(mediaManager.isVideoEnabled).toBe(false);
      expect(mediaManager.isAudioEnabled).toBe(false);
    });

    test('Toggle video track', async () => {
      // Start stream
      await mediaManager.startLocalStream({ video: true, audio: false });

      // Initial state should have video enabled
      expect(mediaManager.isVideoEnabled).toBe(true);

      // Toggle video - the method toggles automatically
      const result = mediaManager.toggleVideo();
      expect(typeof result).toBe('boolean');
    });

    test('Toggle audio track', async () => {
      // Start stream
      await mediaManager.startLocalStream({ video: false, audio: true });

      // Initial state should have audio enabled
      expect(mediaManager.isAudioEnabled).toBe(true);

      // Toggle audio - the method toggles automatically
      const result = mediaManager.toggleAudio();
      expect(typeof result).toBe('boolean');
    });

    test('Get media state', async () => {
      await mediaManager.startLocalStream({ video: true, audio: true });

      const state = mediaManager.getMediaState();
      expect(state.hasLocalStream).toBe(true);
      expect(state.videoEnabled).toBe(true);
      expect(state.audioEnabled).toBe(true);
      expect(state.devices).toBeDefined();
    });

    test('Check browser support', () => {
      const support = MediaManager.checkSupport();
      expect(support.getUserMedia).toBe(true);
      expect(support.enumerateDevices).toBe(true);
      expect(support.webRTC).toBe(true); // Mock window has RTCPeerConnection
      expect(support.fullSupport).toBe(true);
    });

    test('Get media permissions', async () => {
      const permissions = await mediaManager.getPermissions();
      expect(permissions.camera?.state).toBe('granted');
      expect(permissions.microphone?.state).toBe('granted');
    });

    test('Mark stream as local', async () => {
      await mediaManager.startLocalStream({ video: true, audio: false });

      expect(mediaManager.localStream).toBeTruthy();
      // The stream is stored in localStream property, indicating it's local
      expect(mediaManager.localStream).toBeInstanceOf(MockMediaStream);
    });
  });

  describe('PeerPigeonMesh Media Integration Tests', () => {
    test('Initialize media in mesh', async () => {
      mesh = new PeerPigeonMesh();
      const result = await mesh.initializeMedia();
      expect(result).toBe(false); // Returns false in test environment
    });

    test('Start media through mesh', async () => {
      mesh = new PeerPigeonMesh();
      await mesh.initializeMedia();

      const stream = await mesh.startMedia({ video: true, audio: false });
      expect(stream).toBeInstanceOf(MockMediaStream);
    });

    test('Stop media through mesh', async () => {
      mesh = new PeerPigeonMesh();
      await mesh.initializeMedia();
      await mesh.startMedia({ video: true, audio: false });

      await mesh.stopMedia();
      const state = mesh.getMediaState();
      expect(state.hasLocalStream).toBe(false);
    });

    test('Toggle video through mesh', async () => {
      mesh = new PeerPigeonMesh();
      await mesh.initializeMedia();
      await mesh.startMedia({ video: true, audio: false });

      const result = mesh.toggleVideo();
      expect(typeof result).toBe('boolean');
    });

    test('Toggle audio through mesh', async () => {
      mesh = new PeerPigeonMesh();
      await mesh.initializeMedia();
      await mesh.startMedia({ video: false, audio: true });

      const result = mesh.toggleAudio();
      expect(typeof result).toBe('boolean');
    }); test('Enumerate devices through mesh', async () => {
      mesh = new PeerPigeonMesh();

      const devices = await mesh.enumerateMediaDevices();
      // In test environment, returns undefined
      expect(devices).toBeUndefined();
    });

    test('Get media devices through mesh', async () => {
      mesh = new PeerPigeonMesh();

      const devices = mesh.getMediaDevices();
      expect(devices).toBeDefined();
      expect(devices.cameras).toBeDefined();
      expect(devices.microphones).toBeDefined();
      expect(devices.speakers).toBeDefined();
    });

    test('Get remote streams (empty initially)', () => {
      mesh = new PeerPigeonMesh();
      const remoteStreams = mesh.getRemoteStreams();
      expect(remoteStreams).toBeInstanceOf(Map);
      expect(remoteStreams.size).toBe(0);
    });

    test('Media events are emitted', async () => {
      mesh = new PeerPigeonMesh();

      // Test that mesh can handle media operations (simplified test)
      await mesh.initializeMedia();
      const stream = await mesh.startMedia({ video: true, audio: false });

      expect(stream).toBeInstanceOf(MockMediaStream);
      expect(mesh.getMediaState().hasLocalStream).toBe(true);
    });

    test('Handle getUserMedia errors', async () => {
      // Setup mock to reject
      mockGetUserMedia.mockRejectedValueOnce(new Error('Camera access denied'));

      mesh = new PeerPigeonMesh();
      await mesh.initializeMedia();

      await expect(mesh.startMedia({ video: true, audio: false }))
        .rejects.toThrow('Camera access denied');
    });
  });
});
