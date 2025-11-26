// Browser entry point that bundles UnSEA crypto library
// This file is used by esbuild to create a self-contained browser bundle

// Force automated test flag early so PeerConnection can apply optimized ICE/STUN settings
if (typeof globalThis !== 'undefined' && globalThis.AUTOMATED_TEST === undefined) {
  // Allow overriding by page scripts; do not clobber if already set
  globalThis.AUTOMATED_TEST = typeof window !== 'undefined' && window.AUTOMATED_TEST === true ? true : false;
}

// Import UnSEA directly from node_modules (esbuild will bundle it)
import * as UnSEA from 'unsea';

// Import browser-specific PigeonRTC (avoids Node.js dependencies)
import { createPigeonRTC, PigeonRTC, BrowserRTCAdapter, RTCAdapter } from './PigeonRTC-browser.js';

// Import only browser-compatible components
import { PeerPigeonMesh as PeerPigeonMeshClass } from '../src/PeerPigeonMesh.js';
export { PeerPigeonMeshClass as PeerPigeonMesh };
export { PeerConnection } from '../src/PeerConnection.js';
export { SignalingClient } from '../src/SignalingClient.js';
export { WebDHT } from '../src/WebDHT.js';
export { DistributedStorageManager } from '../src/DistributedStorageManager.js';

// Export debug logger for controlling console output
export { default as DebugLogger } from '../src/DebugLogger.js';

// Export environment detection utilities
export {
  EnvironmentDetector,
  environmentDetector,
  isBrowser,
  isNodeJS,
  isWorker,
  hasWebRTC,
  hasWebSocket,
  getEnvironmentReport,
  initWebRTCAsync
} from '../src/EnvironmentDetector.js';

// Make UnSEA available globally for the existing dynamic import logic
// This allows the CryptoManager to detect and use the bundled version
if (typeof globalThis !== 'undefined') {
  globalThis.__PEERPIGEON_UNSEA__ = UnSEA;
  globalThis.__PEERPIGEON_PIGEONRTC__ = {
    createPigeonRTC,
    PigeonRTC,
    BrowserRTCAdapter,
    RTCAdapter,
    default: createPigeonRTC
  };
}

// Also set it on window for browser compatibility
if (typeof window !== 'undefined') {
  window.__PEERPIGEON_UNSEA__ = UnSEA;
  window.__PEERPIGEON_PIGEONRTC__ = {
    createPigeonRTC,
    PigeonRTC,
    BrowserRTCAdapter,
    RTCAdapter,
    default: createPigeonRTC
  };
  
  // Make PeerPigeonMesh available globally for <script> tag usage
  window.PeerPigeonMesh = PeerPigeonMeshClass;
}

console.log('🔐 PeerPigeon browser bundle loaded with embedded UnSEA crypto and PigeonRTC');
