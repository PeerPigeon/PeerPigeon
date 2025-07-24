import { Application } from '@nativescript/core';
import { PeerPigeonMesh } from 'peerpigeon';

// NativeScript PeerPigeon Example
console.log('🔮 Starting NativeScript PeerPigeon Example');

let mesh;
let peerId;

// Initialize PeerPigeon when app launches
Application.on(Application.launchEvent, (_args) => {
  console.log('📱 NativeScript app launched');
  initializePeerPigeon();
});

// Cleanup when app exits
Application.on(Application.exitEvent, () => {
  console.log('📱 NativeScript app exiting');
  if (mesh) {
    mesh.disconnect();
  }
});

async function initializePeerPigeon() {
  try {
    console.log('🚀 Initializing PeerPigeon...');

    // Create mesh instance with basic configuration
    mesh = new PeerPigeonMesh({
      enableWebDHT: true,
      enableCrypto: false // Disable crypto for simplicity in this example
    });

    // Set up event listeners
    setupEventListeners();

    // Initialize the mesh
    await mesh.init();
    peerId = mesh.peerId;
    console.log(`✅ PeerPigeon initialized with ID: ${peerId.substring(0, 8)}...`);

    // Connect to signaling server
    // Replace with your signaling server URL
    const signalingUrl = 'wss://your-signaling-server.com';
    await mesh.connect(signalingUrl);

    console.log('🌐 Connected to signaling server');
  } catch (error) {
    console.error('❌ Failed to initialize PeerPigeon:', error);

    // Log environment info for debugging
    const report = mesh?.environmentReport;
    if (report) {
      console.log('🔍 Environment Report:', JSON.stringify(report, null, 2));
    }
  }
}

function setupEventListeners() {
  // Connection events
  mesh.addEventListener('connected', () => {
    console.log('🔗 Connected to mesh network');
  });

  mesh.addEventListener('disconnected', (data) => {
    console.log('🔌 Disconnected from mesh network:', data.reason);
  });

  // Peer events
  mesh.addEventListener('peerConnected', (data) => {
    console.log(`👋 Peer connected: ${data.peerId.substring(0, 8)}...`);
    console.log(`📊 Total peers: ${mesh.getConnectedPeers().length}`);
  });

  mesh.addEventListener('peerDisconnected', (data) => {
    console.log(`👋 Peer disconnected: ${data.peerId.substring(0, 8)}...`);
    console.log(`📊 Total peers: ${mesh.getConnectedPeers().length}`);
  });

  // Message events
  mesh.addEventListener('messageReceived', (data) => {
    console.log(`📨 Message from ${data.fromPeerId.substring(0, 8)}...:`, data.message);

    // Echo the message back
    if (data.message.type === 'ping') {
      sendMessage(data.fromPeerId, { type: 'pong', timestamp: Date.now() });
    }
  });

  // Error events
  mesh.addEventListener('error', (data) => {
    console.error('❌ Mesh error:', data.error);
  });

  // Status events
  mesh.addEventListener('statusChanged', (data) => {
    console.log('📈 Status changed:', data);
  });
}

// Send a message to a specific peer or broadcast
async function sendMessage(targetPeerId, message) {
  try {
    if (targetPeerId) {
      await mesh.sendMessage(targetPeerId, message);
      console.log(`📤 Message sent to ${targetPeerId.substring(0, 8)}...`);
    } else {
      // Broadcast to all peers
      const peers = mesh.getConnectedPeers();
      for (const peer of peers) {
        await mesh.sendMessage(peer.peerId, message);
      }
      console.log(`📡 Message broadcast to ${peers.length} peers`);
    }
  } catch (error) {
    console.error('❌ Failed to send message:', error);
  }
}

// Example: Send a ping message every 30 seconds
setInterval(() => {
  if (mesh && mesh.connected) {
    const peers = mesh.getConnectedPeers();
    if (peers.length > 0) {
      const randomPeer = peers[Math.floor(Math.random() * peers.length)];
      sendMessage(randomPeer.peerId, {
        type: 'ping',
        timestamp: Date.now(),
        from: 'NativeScript'
      });
    }
  }
}, 30000);

// Example: Log mesh status every 60 seconds
setInterval(() => {
  if (mesh) {
    const peers = mesh.getConnectedPeers();
    console.log(`📊 Mesh Status - Connected: ${mesh.connected}, Peers: ${peers.length}`);

    if (peers.length > 0) {
      console.log(`👥 Connected to: ${peers.map(p => p.peerId.substring(0, 8)).join(', ')}...`);
    }
  }
}, 60000);

// Export functions for potential UI integration
export {
  mesh,
  sendMessage,
  initializePeerPigeon
};
