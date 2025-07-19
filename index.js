// Main entry point for PeerPigeon npm package
export { PeerPigeonMesh } from './src/PeerPigeonMesh.js';
export { PeerConnection } from './src/PeerConnection.js';
export { SignalingClient } from './src/SignalingClient.js';
export { WebDHT } from './src/WebDHT.js';

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
} from './src/EnvironmentDetector.js';

// Export the WebSocket server class for programmatic use
export { PeerPigeonServer } from './server/index.js';
