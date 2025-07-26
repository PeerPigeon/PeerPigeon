/**
 * PeerPigeon Debug Configuration Example
 *
 * This example shows how to configure the debug logging system
 * to control console output from PeerPigeon modules.
 */

import { PeerPigeonMesh, DebugLogger } from './index.js';

// ============================================================================
// Debug Configuration Examples
// ============================================================================

// 1. Enable all debugging (shows all console output)
// DebugLogger.enableAll();

// 2. Enable specific modules only
DebugLogger.enableModules([
  'GossipManager', // Message propagation debugging
  'ConnectionManager', // Connection management debugging
  'PeerConnection' // WebRTC connection debugging
]);

// 3. Enable individual modules
// DebugLogger.enable('PeerPigeonMesh');
// DebugLogger.enable('SignalingHandler');
// DebugLogger.enable('WebDHT');

// 4. Disable all debugging (default state - no console output)
// DebugLogger.disableAll();

// 5. Disable specific modules
// DebugLogger.disable('DistributedStorageManager');
// DebugLogger.disable('CryptoManager');

// 6. Configure using options object
DebugLogger.configure({
  // First disable all, then enable specific ones
  disableAll: true,
  enable: [
    'PeerPigeonMesh',
    'GossipManager',
    'ConnectionManager'
  ]
});

// ============================================================================
// Create and Use PeerPigeon with Debug Configuration
// ============================================================================

const mesh = new PeerPigeonMesh({
  signalingUrl: 'ws://localhost:3000',
  minPeers: 2,
  maxPeers: 10,
  autoConnect: true
});

// ============================================================================
// Runtime Debug Control Examples
// ============================================================================

// You can change debug settings at runtime
setTimeout(() => {
  console.log('Current debug state:', DebugLogger.getState());

  // Enable more debugging after 5 seconds
  DebugLogger.enable('WebDHT');
  DebugLogger.enable('DistributedStorageManager');

  console.log('Available modules:', DebugLogger.getModules());
}, 5000);

// ============================================================================
// Event Handlers (these will show debug output based on configuration)
// ============================================================================

mesh.on('ready', (peerId) => {
  console.log(`🚀 Mesh ready! Peer ID: ${peerId}`);

  // Test different functionality that will show debug output
  mesh.broadcastMessage('Hello from debug example!');
});

mesh.on('peerConnected', (peerId) => {
  console.log(`👋 Peer connected: ${peerId}`);
});

mesh.on('messageReceived', (message) => {
  console.log('📨 Message received:', message);
});

// Start the mesh
mesh.connect();

// ============================================================================
// Example Debug Output Control in Production
// ============================================================================

// For production, you might want to conditionally enable debugging
const isDevelopment = process.env.NODE_ENV === 'development';
const debugFromQuery = new URLSearchParams(window?.location?.search || '').get('debug');

if (isDevelopment || debugFromQuery) {
  // Enable debugging in development or when ?debug=true
  if (debugFromQuery) {
    // Parse debug modules from query: ?debug=GossipManager,ConnectionManager
    const modules = debugFromQuery.split(',').filter(m => m && m !== 'true');
    if (modules.length > 0) {
      DebugLogger.enableModules(modules);
    } else {
      DebugLogger.enableAll();
    }
  } else {
    DebugLogger.enableAll();
  }

  console.log('🐛 Debug mode enabled:', DebugLogger.getState());
}

// ============================================================================
// Available Modules for Debugging
// ============================================================================

/*
Available debug modules:

Core Components:
- PeerPigeonMesh        - Main mesh instance and lifecycle
- ConnectionManager - Peer connection management
- PeerConnection        - Individual WebRTC connections
- SignalingHandler      - Signaling message processing
- SignalingClient       - WebSocket signaling client

Networking & Discovery:
- GossipManager        - Message propagation and gossip protocol
- PeerDiscovery        - Peer discovery and announcement
- MeshOptimizer        - Network topology optimization
- EvictionManager      - Peer eviction strategies

Data & Storage:
- WebDHT              - Distributed hash table operations
- DistributedStorageManager - P2P storage layer
- StorageManager      - Local storage management

Security & Media:
- CryptoManager       - End-to-end encryption
- MediaManager        - Audio/video stream management

Utilities:
- CleanupManager      - Resource cleanup and garbage collection
- EnvironmentDetector - Runtime environment detection
- EventEmitter        - Event system
- TimerUtils          - Timer utilities

Usage patterns:

// Debug everything
DebugLogger.enableAll();

// Debug networking only
DebugLogger.enableModules(['GossipManager', 'ConnectionManager', 'PeerConnection']);

// Debug storage only
DebugLogger.enableModules(['WebDHT', 'DistributedStorageManager', 'StorageManager']);

// Debug security only
DebugLogger.enableModules(['CryptoManager']);

// Production - no debugging (default)
DebugLogger.disableAll();
*/
