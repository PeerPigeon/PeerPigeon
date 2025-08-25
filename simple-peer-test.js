import { randomBytes } from 'crypto';
import { PeerPigeonMesh } from './src/PeerPigeonMesh.js';

/**
 * Simple PeerPigeon Test Script
 * 
 * Uses PeerPigeon exactly as intended - no reinventing the wheel!
 * 
 * Usage: node simple-peer-test.js [ws://localhost:3000]
 */

const WEBSOCKET_URL = process.argv[2] || 'ws://localhost:3000';

// Generate a random 40-character hex peer ID
function generatePeerId() {
  return randomBytes(20).toString('hex');
}

// Main execution function
async function main() {
  console.log('🚀 Starting PeerPigeon mesh...');
  
  const peerId = generatePeerId();
  console.log(`🔗 Peer ID: ${peerId.substring(0, 8)}...`);

  // Create PeerPigeon mesh - let it handle everything!
  const mesh = new PeerPigeonMesh({
    peerId,
    signalingServerUrl: WEBSOCKET_URL,
    maxPeers: 10,
    enableCrypto: false
  });

  // Set up event listeners to see what's happening
  mesh.on('connected', () => {
    console.log('✅ Connected to mesh network');
  });

  mesh.on('peerDiscovered', (data) => {
    console.log(`👋 Discovered peer: ${data.peerId.substring(0, 8)}...`);
  });

  mesh.on('peerConnected', (data) => {
    console.log(`🤝 Connected to peer: ${data.peerId.substring(0, 8)}...`);
  });

  mesh.on('peerDisconnected', (data) => {
    console.log(`👋 Peer disconnected: ${data.peerId.substring(0, 8)}...`);
  });

  mesh.on('messageReceived', (data) => {
    console.log(`💬 Message from ${data.from.substring(0, 8)}...: ${data.content}`);
  });

  // Connect to mesh
  try {
    // Initialize the mesh first (this sets up signalingClient and other components)
    await mesh.init();
    console.log('🔧 Mesh initialized successfully');
    
    // Then connect to the signaling server
    await mesh.connect(WEBSOCKET_URL);
    console.log('🎉 Successfully joined mesh network');
  } catch (error) {
    console.error('❌ Failed to connect:', error);
    return;
  }

  // Send periodic test messages
  setInterval(async () => {
    if (mesh.connected) {
      const message = `Hello from ${peerId.substring(0, 8)} at ${new Date().toLocaleTimeString()}`;
      try {
        await mesh.sendMessage(message);
        console.log(`📤 Sent: ${message}`);
      } catch (error) {
        console.error('❌ Failed to send message:', error);
      }
    }
  }, 30000);

  // Status updates
  setInterval(() => {
    const connectedPeers = mesh.getPeers();
    const discoveredPeers = mesh.getDiscoveredPeers();
    
    console.log('📊 Status:');
    console.log(`   Connected: ${mesh.connected}`);
    console.log(`   Discovered: ${discoveredPeers.length} peers`);
    console.log(`   Connected: ${connectedPeers.length} peers`);
    
    if (connectedPeers.length > 0) {
      connectedPeers.forEach(peer => {
        console.log(`     ✅ ${peer.peerId.substring(0, 8)}...`);
      });
    }
  }, 10000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    try {
      await mesh.disconnect();
      console.log('👋 Disconnected cleanly');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
    process.exit(0);
  });

  console.log('💡 Run multiple instances to see automatic peer discovery and connection!');
}

// Start the application
main().catch(error => {
  console.error('❌ Failed to start:', error);
  process.exit(1);
});