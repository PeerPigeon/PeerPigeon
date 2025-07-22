/**
 * Jest Test Setup
 * Global configuration and utilities for tests
 */

// Import Jest globals for ES modules
import { jest } from '@jest/globals';

// Increase timeout for integration tests involving WebRTC
jest.setTimeout(30000);

// Store original console methods for restoration
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

// Suppress console output during tests (optional - can be removed for debugging)
global.suppressConsole = () => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
};

global.restoreConsole = () => {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
};

// Track open handles for cleanup
const openHandles = new Set();

// Mock WebRTC APIs for unit tests in Node.js environment
global.RTCPeerConnection = class MockRTCPeerConnection {
  constructor() {
    this.localDescription = null;
    this.remoteDescription = null;
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.onconnectionstatechange = null;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }

  createDataChannel(label) {
    return {
      label,
      readyState: 'connecting',
      send: jest.fn(),
      close: jest.fn(),
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null
    };
  }

  addIceCandidate() {
    return Promise.resolve();
  }

  close() {}
};

global.RTCDataChannel = class MockRTCDataChannel {
  constructor(label) {
    this.label = label;
    this.readyState = 'connecting';
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }

  send() {}
  close() {}
};

// Global cleanup function for tests
global.cleanupTest = () => {
  // Clear all timers
  clearInterval();
  clearTimeout();
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  // Clear any remaining handles
  openHandles.forEach(handle => {
    try {
      if (handle && typeof handle.close === 'function') {
        handle.close();
      }
      if (handle && typeof handle.destroy === 'function') {
        handle.destroy();
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });
  openHandles.clear();
};

// Global test utilities
global.addHandle = (handle) => {
  openHandles.add(handle);
};

global.removeHandle = (handle) => {
  openHandles.delete(handle);
};

// Clean up after each test
afterEach(() => {
  global.cleanupTest();
});

// Final cleanup
process.on('exit', () => {
  global.cleanupTest();
});

// Mock WebSocket for signaling tests
global.WebSocket = class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    
    // Simulate connection after next tick
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 0);
  }

  send(data) {
    // Mock send functionality
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
};

// Suppress console.log in tests unless explicitly needed
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: console.error // Keep error logging for debugging
};
