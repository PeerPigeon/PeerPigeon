import { EventEmitter } from './EventEmitter.js';
import { environmentDetector } from './EnvironmentDetector.js';
import DebugLogger from './DebugLogger.js';

/**
 * Manages storage operations, URL handling, and configuration persistence
 */
export class StorageManager extends EventEmitter {
  constructor(mesh) {
    super();
    this.debug = DebugLogger.create('StorageManager');
    this.mesh = mesh;
  }

  loadSignalingUrlFromStorage() {
    // Use environment-aware storage detection
    if (environmentDetector.hasLocalStorage) {
      const savedUrl = localStorage.getItem('pigon-signaling-url');
      if (savedUrl) {
        this.mesh.signalingUrl = savedUrl;
        this.mesh.emit('statusChanged', { type: 'urlLoaded', signalingUrl: savedUrl });
        return savedUrl;
      }
    } else if (environmentDetector.isNodeJS) {
      // In Node.js, we could potentially use file-based storage
      this.debug.log('Local storage not available in Node.js environment');
    }
    return null;
  }

  saveSignalingUrlToStorage(url) {
    if (environmentDetector.hasLocalStorage && url) {
      localStorage.setItem('pigon-signaling-url', url);
    } else if (environmentDetector.isNodeJS) {
      // In Node.js, we could potentially save to a config file
      this.debug.log('Storage not implemented for Node.js environment');
    }
  }

  loadSignalingUrlFromQuery() {
    // Only works in browser and NativeScript environments with location/URL support
    if (!environmentDetector.isBrowser && !environmentDetector.isNativeScript) return this.loadSignalingUrlFromStorage();

    // Check if we have URL search capabilities
    if (typeof URLSearchParams === 'undefined' ||
        (environmentDetector.isBrowser && typeof window === 'undefined') ||
        (environmentDetector.isBrowser && typeof window.location === 'undefined')) {
      return this.loadSignalingUrlFromStorage();
    }

    let searchParams;
    if (environmentDetector.isBrowser) {
      searchParams = new URLSearchParams(window.location.search);
    } else if (environmentDetector.isNativeScript) {
      // NativeScript might not have window.location, fallback to storage
      return this.loadSignalingUrlFromStorage();
    }

    const signalingUrl = searchParams?.get('api') || searchParams?.get('url') || searchParams?.get('signaling');

    if (signalingUrl) {
      // Only emit event if URL is different from current one
      const currentUrl = this.mesh.signalingUrl;
      this.mesh.signalingUrl = signalingUrl;
      this.saveSignalingUrlToStorage(signalingUrl);

      if (currentUrl !== signalingUrl) {
        this.mesh.emit('statusChanged', { type: 'urlLoaded', signalingUrl });
      }
      return signalingUrl;
    }

    // Fallback to localStorage if no URL in query params
    return this.loadSignalingUrlFromStorage();
  }

  validatePeerId(peerId) {
    return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
  }

  saveSettings(settings) {
    if (environmentDetector.hasLocalStorage) {
      localStorage.setItem('pigon-settings', JSON.stringify(settings));
    }
  }

  loadSettings() {
    if (environmentDetector.hasLocalStorage) {
      const saved = localStorage.getItem('pigon-settings');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (error) {
          this.debug.error('Failed to parse saved settings:', error);
        }
      }
    }
    return {};
  }

  clearStorage() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('pigon-signaling-url');
      localStorage.removeItem('pigon-settings');
    }
  }
}
