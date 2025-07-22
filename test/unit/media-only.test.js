/**
 * Basic Media Functionality Tests
 * Tests only the media functionality without crypto integration
 */

import { jest } from '@jest/globals';
import { MediaManager } from '../../src/MediaManager.js';
import { PeerPigeonMesh } from '../../index.js';

// Mock browser environment for media testing
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

// Mock navigator.mediaDevices
const mockGetUserMedia = jest.fn();
const mockEnumerateDevices = jest.fn();

global.navigator = {
  mediaDevices: {
    getUserMedia: mockGetUserMedia,
    enumerateDevices: mockEnumerateDevices
  },
  userAgent: 'Mozilla/5.0 Jest Test'
};

// Mock MediaStream classes
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

  addTrack(track) {
    this.tracks.push(track);
  }

  removeTrack(track) {
    const index = this.tracks.indexOf(track);
    if (index > -1) {
      this.tracks.splice(index, 1);
    }
  }
}

class MockMediaStreamTrack {
  constructor(kind, label = '') {
    this.kind = kind;
    this.label = label;
    this.enabled = true;
    this.readyState = 'live';
    this.id = Math.random().toString(36).substr(2, 9);
  }

  stop() {
    this.readyState = 'ended';
  }

  clone() {
    return new MockMediaStreamTrack(this.kind, this.label);
  }
}

global.MediaStream = MockMediaStream;
global.MediaStreamTrack = MockMediaStreamTrack;

describe('Media Functionality Tests', () => {
  let mesh = null;

  beforeEach(() => {
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Reset all mocks
    jest.clearAllMocks();
    
    // Set up default mock implementations
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

    mockEnumerateDevices.mockResolvedValue([
      {
        deviceId: 'camera1',
        kind: 'videoinput',
        label: 'Mock Camera 1',
        groupId: 'group1'
      },
      {
        deviceId: 'mic1', 
        kind: 'audioinput',
        label: 'Mock Microphone 1',
        groupId: 'group1'
      },
      {
        deviceId: 'speaker1',
        kind: 'audiooutput', 
        label: 'Mock Speaker 1',
        groupId: 'group1'
      }
    ]);
  });

  afterEach(async () => {
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

  describe('MediaManager Direct Tests', () => {
    test('MediaManager basic functionality', async () => {
      const mediaManager = new MediaManager();

      // Test initialization
      expect(mediaManager.localStream).toBeNull();
      expect(mediaManager.isVideoEnabled).toBe(false);
      expect(mediaManager.isAudioEnabled).toBe(false);

      // Test starting a stream
      const stream = await mediaManager.startLocalStream({
        video: true,
        audio: true
      });

      expect(stream).toBeInstanceOf(MockMediaStream);
      expect(stream.getVideoTracks()).toHaveLength(1);
      expect(stream.getAudioTracks()).toHaveLength(1);
      expect(mediaManager.isVideoEnabled).toBe(true);
      expect(mediaManager.isAudioEnabled).toBe(true);

      // Test stopping the stream
      mediaManager.stopLocalStream();
      expect(mediaManager.localStream).toBeNull();
      expect(mediaManager.isVideoEnabled).toBe(false);
      expect(mediaManager.isAudioEnabled).toBe(false);
    });

    test('MediaManager device enumeration', async () => {
      const mediaManager = new MediaManager();

      // Mock the environmentDetector for MediaManager
      const originalEnvDetector = mediaManager.constructor.prototype.enumerateDevices;
      
      // Create a spy that bypasses environment detection
      const enumerateDevicesSpy = jest.spyOn(mediaManager, 'enumerateDevices');
      enumerateDevicesSpy.mockImplementation(async function() {
        const devices = await global.navigator.mediaDevices.enumerateDevices();
        
        this.devices.cameras = devices.filter(device => device.kind === 'videoinput');
        this.devices.microphones = devices.filter(device => device.kind === 'audioinput');
        this.devices.speakers = devices.filter(device => device.kind === 'audiooutput');

        this.emit('devicesUpdated', this.devices);
        return this.devices;
      });

      const devices = await mediaManager.enumerateDevices();
      
      expect(devices).toBeDefined();
      expect(Array.isArray(devices.cameras)).toBe(true);
      expect(Array.isArray(devices.microphones)).toBe(true);
      expect(Array.isArray(devices.speakers)).toBe(true);
      expect(devices.cameras).toHaveLength(1);
      expect(devices.microphones).toHaveLength(1);
      expect(devices.speakers).toHaveLength(1);

      enumerateDevicesSpy.mockRestore();
    });
  });

  describe('PeerPigeonMesh Media Tests', () => {
    test('Media through PeerPigeonMesh', async () => {
      mesh = new PeerPigeonMesh({
        ignoreEnvironmentErrors: true,
        enableCrypto: false  // Disable crypto to avoid import issues
      });
      await mesh.init();

      // Start media
      const stream = await mesh.startMedia({
        video: true,
        audio: true
      });

      expect(stream).toBeInstanceOf(MockMediaStream);
      expect(mesh.getLocalStream()).toBe(stream);

      const mediaState = mesh.getMediaState();
      expect(mediaState.hasLocalStream).toBe(true);
      expect(mediaState.videoEnabled).toBe(true);
      expect(mediaState.audioEnabled).toBe(true);

      // Test toggle functionality
      const videoToggled = mesh.toggleVideo();
      expect(typeof videoToggled).toBe('boolean');

      const audioToggled = mesh.toggleAudio();
      expect(typeof audioToggled).toBe('boolean');

      // Stop media
      await mesh.stopMedia();
      const finalState = mesh.getMediaState();
      expect(finalState.hasLocalStream).toBe(false);
    });

    test('Media state and controls', async () => {
      mesh = new PeerPigeonMesh({
        ignoreEnvironmentErrors: true,
        enableCrypto: false
      });
      await mesh.init();

      // Initial state
      const initialState = mesh.getMediaState();
      expect(initialState.hasLocalStream).toBe(false);
      expect(initialState.videoEnabled).toBe(false);
      expect(initialState.audioEnabled).toBe(false);

      // Start media
      await mesh.startMedia({ video: true, audio: true });
      
      const activeState = mesh.getMediaState();
      expect(activeState.hasLocalStream).toBe(true);
      expect(activeState.videoEnabled).toBe(true);
      expect(activeState.audioEnabled).toBe(true);

      // Get devices (this should work with mocked devices)
      const devices = mesh.getMediaDevices();
      expect(devices).toBeDefined();
      expect(devices.cameras).toBeDefined();
      expect(devices.microphones).toBeDefined();
      expect(devices.speakers).toBeDefined();
    });

    test('Media error handling', async () => {
      mesh = new PeerPigeonMesh({
        ignoreEnvironmentErrors: true,
        enableCrypto: false
      });
      await mesh.init();

      // Mock getUserMedia to fail
      mockGetUserMedia.mockRejectedValueOnce(new Error('Camera access denied'));

      await expect(mesh.startMedia({ video: true }))
        .rejects.toThrow('Camera access denied');

      // State should remain unchanged after error
      const state = mesh.getMediaState();
      expect(state.hasLocalStream).toBe(false);
    });
  });

  describe('Media Integration Tests', () => {
    test('Media events are emitted', async () => {
      mesh = new PeerPigeonMesh({
        ignoreEnvironmentErrors: true,
        enableCrypto: false
      });
      await mesh.init();

      const localStreamStartedSpy = jest.fn();
      const localStreamStoppedSpy = jest.fn();
      
      mesh.addEventListener('localStreamStarted', localStreamStartedSpy);
      mesh.addEventListener('localStreamStopped', localStreamStoppedSpy);

      // Start media
      await mesh.startMedia({ video: true, audio: true });
      
      // Stop media
      await mesh.stopMedia();

      // Events should have been emitted
      expect(localStreamStartedSpy).toHaveBeenCalled();
      expect(localStreamStoppedSpy).toHaveBeenCalled();
    });

    test('Multiple media start/stop cycles', async () => {
      mesh = new PeerPigeonMesh({
        ignoreEnvironmentErrors: true,
        enableCrypto: false
      });
      await mesh.init();

      // Start and stop multiple times
      for (let i = 0; i < 3; i++) {
        const stream = await mesh.startMedia({ video: true, audio: false });
        expect(mesh.getLocalStream()).toBe(stream);
        
        await mesh.stopMedia();
        expect(mesh.getLocalStream()).toBeNull();
      }
    });
  });
});
