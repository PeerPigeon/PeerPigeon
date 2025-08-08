// Browser entry point that bundles UnSEA crypto library
// This file is used by esbuild to create a self-contained browser bundle

// Import UnSEA directly from node_modules (esbuild will bundle it)
import * as UnSEA from 'unsea';

// Import only browser-compatible components
export { PeerPigeonMesh } from '../src/PeerPigeonMesh.js';
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
  getEnvironmentReport
} from '../src/EnvironmentDetector.js';

// Make UnSEA available globally for the existing dynamic import logic
// This allows the CryptoManager to detect and use the bundled version
if (typeof globalThis !== 'undefined') {
  globalThis.__PEERPIGEON_UNSEA__ = UnSEA;
}

// Also set it on window for browser compatibility
if (typeof window !== 'undefined') {
  window.__PEERPIGEON_UNSEA__ = UnSEA;
}

console.log('🔐 PeerPigeon browser bundle loaded with embedded UnSEA crypto');
