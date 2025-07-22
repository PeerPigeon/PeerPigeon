/**
 * EnvironmentDetector - Utility for detecting runtime environment and capabilities
 * Provides comprehensive environment detection for browser, Node.js, Worker contexts
 */
export class EnvironmentDetector {
  constructor() {
    this._cache = new Map();
    this._init();
  }

  _init() {
    // Pre-compute common detections to avoid repeated checks
    this._cache.set('isBrowser', this._detectBrowser());
    this._cache.set('isNodeJS', this._detectNodeJS());
    this._cache.set('isWorker', this._detectWorker());
    this._cache.set('isServiceWorker', this._detectServiceWorker());
    this._cache.set('isWebWorker', this._detectWebWorker());
    this._cache.set('isSharedWorker', this._detectSharedWorker());
    this._cache.set('isDeno', this._detectDeno());
    this._cache.set('isBun', this._detectBun());
  }

  // Primary environment detection
  _detectBrowser() {
    return typeof window !== 'undefined' &&
               typeof document !== 'undefined' &&
               typeof navigator !== 'undefined';
  }

  _detectNodeJS() {
    return typeof process !== 'undefined' &&
               process.versions != null &&
               process.versions.node != null;
  }

  _detectDeno() {
    return typeof Deno !== 'undefined';
  }

  _detectBun() {
    return typeof Bun !== 'undefined';
  }

  _detectWorker() {
    return typeof importScripts !== 'undefined' ||
               this._detectServiceWorker() ||
               this._detectWebWorker() ||
               this._detectSharedWorker();
  }

  _detectServiceWorker() {
    return typeof globalThis.ServiceWorkerGlobalScope !== 'undefined' &&
               typeof self !== 'undefined' &&
               self instanceof globalThis.ServiceWorkerGlobalScope;
  }

  _detectWebWorker() {
    return typeof globalThis.DedicatedWorkerGlobalScope !== 'undefined' &&
               typeof self !== 'undefined' &&
               self instanceof globalThis.DedicatedWorkerGlobalScope;
  }

  _detectSharedWorker() {
    return typeof globalThis.SharedWorkerGlobalScope !== 'undefined' &&
               typeof self !== 'undefined' &&
               self instanceof globalThis.SharedWorkerGlobalScope;
  }

  // Public getters
  get isBrowser() {
    return this._cache.get('isBrowser');
  }

  get isNodeJS() {
    return this._cache.get('isNodeJS');
  }

  get isWorker() {
    return this._cache.get('isWorker');
  }

  get isServiceWorker() {
    return this._cache.get('isServiceWorker');
  }

  get isWebWorker() {
    return this._cache.get('isWebWorker');
  }

  get isSharedWorker() {
    return this._cache.get('isSharedWorker');
  }

  get isDeno() {
    return this._cache.get('isDeno');
  }

  get isBun() {
    return this._cache.get('isBun');
  }

  get isServer() {
    return this.isNodeJS || this.isDeno || this.isBun;
  }

  get isClient() {
    return this.isBrowser || this.isWorker;
  }

  // WebRTC capability detection
  get hasWebRTC() {
    if (this.isBrowser) {
      return typeof RTCPeerConnection !== 'undefined' ||
                   typeof webkitRTCPeerConnection !== 'undefined' ||
                   typeof mozRTCPeerConnection !== 'undefined';
    }
    if (this.isNodeJS) {
      // Check for Node.js WebRTC implementations or globally injected WebRTC
      return (typeof global !== 'undefined' &&
                   typeof global.RTCPeerConnection !== 'undefined') ||
                   typeof RTCPeerConnection !== 'undefined';
    }
    return false;
  }

  get hasDataChannel() {
    return this.hasWebRTC && this.isBrowser;
  }

  get hasGetUserMedia() {
    if (!this.isBrowser) return false;
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ||
               !!(navigator.getUserMedia ||
                  navigator.webkitGetUserMedia ||
                  navigator.mozGetUserMedia ||
                  navigator.msGetUserMedia);
  }

  // WebSocket capability detection
  get hasWebSocket() {
    if (this.isBrowser || this.isWorker) {
      return typeof WebSocket !== 'undefined';
    }
    if (this.isNodeJS) {
      // Check for globally injected WebSocket first
      if (typeof global !== 'undefined' && typeof global.WebSocket !== 'undefined') {
        return true;
      }
      if (typeof WebSocket !== 'undefined') {
        return true;
      }

      try {
        // Try ES module import first
        if (typeof require !== 'undefined') {
          require.resolve('ws');
          return true;
        } else {
          // In ES modules, we can't easily check if a package is available
          // without actually importing it, so we'll assume it might be available
          return false; // Conservative approach
        }
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  // Storage capability detection
  get hasLocalStorage() {
    if (!this.isBrowser) return false;
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  get hasSessionStorage() {
    if (!this.isBrowser) return false;
    try {
      const test = '__storage_test__';
      sessionStorage.setItem(test, test);
      sessionStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  get hasIndexedDB() {
    if (!this.isBrowser) return false;
    return typeof indexedDB !== 'undefined';
  }

  get hasCookies() {
    if (!this.isBrowser) return false;
    return typeof document !== 'undefined' &&
               typeof document.cookie === 'string';
  }

  // Network and connectivity detection
  get hasNetworkInformation() {
    if (!this.isBrowser) return false;
    return typeof navigator !== 'undefined' &&
               'connection' in navigator;
  }

  get isOnline() {
    if (this.isBrowser) {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    }
    return true; // Assume online for server environments
  }

  get networkType() {
    if (this.hasNetworkInformation) {
      return navigator.connection.effectiveType || 'unknown';
    }
    return 'unknown';
  }

  // Crypto capabilities
  get hasCrypto() {
    if (this.isBrowser || this.isWorker) {
      return typeof crypto !== 'undefined' &&
                   typeof crypto.subtle !== 'undefined';
    }
    if (this.isNodeJS) {
      try {
        if (typeof require !== 'undefined') {
          require('crypto');
          return true;
        } else {
          // In ES modules, crypto is a built-in Node.js module
          return typeof process !== 'undefined' && process.versions.node;
        }
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  get hasRandomValues() {
    if (this.isBrowser || this.isWorker) {
      return typeof crypto !== 'undefined' &&
                   typeof crypto.getRandomValues === 'function';
    }
    if (this.isNodeJS) {
      try {
        if (typeof require !== 'undefined') {
          const crypto = require('crypto');
          return typeof crypto.randomBytes === 'function';
        } else {
          // In ES modules, crypto is a built-in Node.js module
          return typeof process !== 'undefined' && process.versions.node;
        }
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  // Performance and timing
  get hasPerformanceNow() {
    return typeof performance !== 'undefined' &&
               typeof performance.now === 'function';
  }

  get hasHighResolutionTime() {
    if (this.isNodeJS) {
      return typeof process.hrtime === 'function' ||
                   typeof process.hrtime.bigint === 'function';
    }
    return this.hasPerformanceNow;
  }

  // Browser-specific detection
  getBrowserInfo() {
    if (!this.isBrowser) return null;

    const userAgent = navigator.userAgent;
    const browsers = {
      chrome: /Chrome\/(\d+)/.exec(userAgent),
      firefox: /Firefox\/(\d+)/.exec(userAgent),
      safari: /Safari\/(\d+)/.exec(userAgent) && !/Chrome/.test(userAgent),
      edge: /Edge\/(\d+)/.exec(userAgent),
      ie: /MSIE (\d+)/.exec(userAgent) || /Trident.*rv:(\d+)/.exec(userAgent)
    };

    for (const [browser, match] of Object.entries(browsers)) {
      if (match) {
        return {
          name: browser,
          version: match[1] || 'unknown'
        };
      }
    }

    return { name: 'unknown', version: 'unknown' };
  }

  // Node.js-specific detection
  getNodeInfo() {
    if (!this.isNodeJS) return null;

    return {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      versions: process.versions
    };
  }

  // Device and platform detection
  getPlatformInfo() {
    if (this.isBrowser) {
      return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        languages: navigator.languages || [navigator.language],
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
        hardwareConcurrency: navigator.hardwareConcurrency || 1
      };
    }

    if (this.isNodeJS) {
      return this.getNodeInfo();
    }

    return null;
  }

  // Feature detection for specific APIs
  hasFeature(feature) {
    const features = {
      // WebRTC
      webrtc: () => this.hasWebRTC,
      datachannel: () => this.hasDataChannel,
      getusermedia: () => this.hasGetUserMedia,

      // WebSocket
      websocket: () => this.hasWebSocket,

      // Storage
      localstorage: () => this.hasLocalStorage,
      sessionstorage: () => this.hasSessionStorage,
      indexeddb: () => this.hasIndexedDB,
      cookies: () => this.hasCookies,

      // Crypto
      crypto: () => this.hasCrypto,
      randomvalues: () => this.hasRandomValues,

      // Performance
      performance: () => this.hasPerformanceNow,
      hrtime: () => this.hasHighResolutionTime,

      // Network
      networkinfo: () => this.hasNetworkInformation,
      online: () => this.isOnline,

      // Workers
      webworker: () => typeof Worker !== 'undefined',
      serviceworker: () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      sharedworker: () => typeof SharedWorker !== 'undefined'
    };

    const featureCheck = features[feature.toLowerCase()];
    return featureCheck ? featureCheck() : false;
  }

  // Get comprehensive environment report
  getEnvironmentReport() {
    return {
      runtime: {
        isBrowser: this.isBrowser,
        isNodeJS: this.isNodeJS,
        isWorker: this.isWorker,
        isServiceWorker: this.isServiceWorker,
        isWebWorker: this.isWebWorker,
        isSharedWorker: this.isSharedWorker,
        isDeno: this.isDeno,
        isBun: this.isBun,
        isServer: this.isServer,
        isClient: this.isClient
      },
      capabilities: {
        webrtc: this.hasWebRTC,
        dataChannel: this.hasDataChannel,
        getUserMedia: this.hasGetUserMedia,
        webSocket: this.hasWebSocket,
        localStorage: this.hasLocalStorage,
        sessionStorage: this.hasSessionStorage,
        indexedDB: this.hasIndexedDB,
        cookies: this.hasCookies,
        crypto: this.hasCrypto,
        randomValues: this.hasRandomValues,
        performance: this.hasPerformanceNow,
        networkInfo: this.hasNetworkInformation
      },
      platform: this.getPlatformInfo(),
      browser: this.getBrowserInfo(),
      node: this.getNodeInfo(),
      network: {
        online: this.isOnline,
        type: this.networkType
      }
    };
  }

  // Static method for quick environment check
  static detect() {
    return new EnvironmentDetector();
  }

  // Static method for single feature check
  static hasFeature(feature) {
    const detector = new EnvironmentDetector();
    return detector.hasFeature(feature);
  }
}

// Export singleton instance for convenience
export const environmentDetector = new EnvironmentDetector();

// Export individual detection functions for tree-shaking
export const isBrowser = () => environmentDetector.isBrowser;
export const isNodeJS = () => environmentDetector.isNodeJS;
export const isWorker = () => environmentDetector.isWorker;
export const hasWebRTC = () => environmentDetector.hasWebRTC;
export const hasWebSocket = () => environmentDetector.hasWebSocket;
export const getEnvironmentReport = () => environmentDetector.getEnvironmentReport();
