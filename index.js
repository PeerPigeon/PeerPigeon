// Main entry point for PeerPigeon npm package
export { PeerPigeonMesh } from './src/PeerPigeonMesh.js';
export { PeerConnection } from './src/PeerConnection.js';
export { SignalingClient } from './src/SignalingClient.js';
export { WebDHT } from './src/WebDHT.js';
export { DistributedStorageManager } from './src/DistributedStorageManager.js';

// Export debug logger for controlling console output
export { default as DebugLogger } from './src/DebugLogger.js';

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
} from './src/EnvironmentDetector.js';

// Export the WebSocket server class for programmatic use
export { PeerPigeonServer } from './server/index.js';

// Note: PeerPigeon now uses PigeonRTC for cross-platform WebRTC support.
// The WebRTC implementation is automatically initialized when calling
// mesh.init() or environmentDetector.initWebRTCAsync().
// PigeonRTC handles browser native WebRTC and Node.js @koush/wrtc transparently.
