/**
 * Browser-specific PigeonRTC implementation
 * This is a simplified version that only includes browser-compatible code
 */

// Simple RTCAdapter base class
export class RTCAdapter {
  getRTCPeerConnection() {
    throw new Error('getRTCPeerConnection must be implemented by adapter');
  }

  getRTCSessionDescription() {
    throw new Error('getRTCSessionDescription must be implemented by adapter');
  }

  getRTCIceCandidate() {
    throw new Error('getRTCIceCandidate must be implemented by adapter');
  }

  getMediaStream() {
    return null;
  }

  isSupported() {
    throw new Error('isSupported must be implemented by adapter');
  }

  getName() {
    throw new Error('getName must be implemented by adapter');
  }

  async initialize() {
    // Default implementation does nothing
  }

  async getUserMedia(_constraints) {
    throw new Error('getUserMedia not supported by this adapter');
  }

  async getDisplayMedia(_constraints) {
    throw new Error('getDisplayMedia not supported by this adapter');
  }
}

// Browser RTCAdapter
export class BrowserRTCAdapter extends RTCAdapter {
  constructor() {
    super();
    this._checkSupport();
  }

  _checkSupport() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return;
    }

    this.hasRTCPeerConnection = !!(
      window.RTCPeerConnection ||
      window.webkitRTCPeerConnection ||
      window.mozRTCPeerConnection
    );

    this.hasGetUserMedia = !!(
      navigator.mediaDevices?.getUserMedia ||
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia
    );

    this.hasGetDisplayMedia = !!(
      navigator.mediaDevices?.getDisplayMedia
    );
  }

  getRTCPeerConnection() {
    if (typeof window === 'undefined') {
      throw new Error('BrowserRTCAdapter requires a browser environment');
    }

    return window.RTCPeerConnection ||
           window.webkitRTCPeerConnection ||
           window.mozRTCPeerConnection;
  }

  getRTCSessionDescription() {
    if (typeof window === 'undefined') {
      throw new Error('BrowserRTCAdapter requires a browser environment');
    }

    return window.RTCSessionDescription ||
           window.mozRTCSessionDescription;
  }

  getRTCIceCandidate() {
    if (typeof window === 'undefined') {
      throw new Error('BrowserRTCAdapter requires a browser environment');
    }

    return window.RTCIceCandidate ||
           window.mozRTCIceCandidate;
  }

  getMediaStream() {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.MediaStream || window.webkitMediaStream;
  }

  isSupported() {
    return typeof window !== 'undefined' && this.hasRTCPeerConnection;
  }

  getName() {
    return 'BrowserRTCAdapter';
  }

  async getUserMedia(constraints) {
    if (typeof navigator === 'undefined') {
      throw new Error('getUserMedia requires a browser environment');
    }

    if (navigator.mediaDevices?.getUserMedia) {
      return await navigator.mediaDevices.getUserMedia(constraints);
    }

    const getUserMedia = navigator.getUserMedia ||
                        navigator.webkitGetUserMedia ||
                        navigator.mozGetUserMedia;

    if (!getUserMedia) {
      throw new Error('getUserMedia is not supported in this browser');
    }

    return new Promise((resolve, reject) => {
      getUserMedia.call(navigator, constraints, resolve, reject);
    });
  }

  async getDisplayMedia(constraints) {
    if (typeof navigator === 'undefined') {
      throw new Error('getDisplayMedia requires a browser environment');
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('getDisplayMedia is not supported in this browser');
    }

    return await navigator.mediaDevices.getDisplayMedia(constraints);
  }
}

// Simplified PigeonRTC class for browser
export class PigeonRTC {
  constructor(options = {}) {
    this.adapter = options.adapter || null;
    this.initialized = false;
  }

  async initialize(options = {}) {
    if (this.initialized) {
      return;
    }

    if (options.adapter) {
      this.adapter = options.adapter;
    }

    if (!this.adapter) {
      this.adapter = new BrowserRTCAdapter();
    }

    await this.adapter.initialize();
    this.initialized = true;
  }

  _ensureInitialized() {
    if (!this.initialized || !this.adapter) {
      throw new Error('PigeonRTC not initialized. Call initialize() first.');
    }
  }

  getRTCPeerConnection() {
    this._ensureInitialized();
    return this.adapter.getRTCPeerConnection();
  }

  getRTCSessionDescription() {
    this._ensureInitialized();
    return this.adapter.getRTCSessionDescription();
  }

  getRTCIceCandidate() {
    this._ensureInitialized();
    return this.adapter.getRTCIceCandidate();
  }

  getMediaStream() {
    this._ensureInitialized();
    return this.adapter.getMediaStream();
  }

  createPeerConnection(config) {
    this._ensureInitialized();
    const RTCPeerConnection = this.adapter.getRTCPeerConnection();
    return new RTCPeerConnection(config);
  }

  createSessionDescription(init) {
    this._ensureInitialized();
    const RTCSessionDescription = this.adapter.getRTCSessionDescription();
    return new RTCSessionDescription(init);
  }

  createIceCandidate(init) {
    this._ensureInitialized();
    const RTCIceCandidate = this.adapter.getRTCIceCandidate();
    return new RTCIceCandidate(init);
  }

  async getUserMedia(constraints) {
    this._ensureInitialized();
    return await this.adapter.getUserMedia(constraints);
  }

  async getDisplayMedia(constraints) {
    this._ensureInitialized();
    return await this.adapter.getDisplayMedia(constraints);
  }

  isSupported() {
    return this.adapter ? this.adapter.isSupported() : false;
  }

  getAdapterName() {
    return this.adapter ? this.adapter.getName() : 'None';
  }
}

export async function createPigeonRTC(options = {}) {
  const rtc = new PigeonRTC(options);
  await rtc.initialize(options);
  return rtc;
}

export default createPigeonRTC;
