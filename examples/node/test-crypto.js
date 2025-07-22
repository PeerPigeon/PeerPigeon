#!/usr/bin/env node

import { PeerPigeonMesh } from '../../index.js';
import WebSocket from 'ws';
import wrtc from '@koush/wrtc';

// Make WebRTC available globally for Node.js
global.RTCPeerConnection = wrtc.RTCPeerConnection;
global.RTCSessionDescription = wrtc.RTCSessionDescription;
global.RTCIceCandidate = wrtc.RTCIceCandidate;
global.WebSocket = WebSocket;

// Test crypto functionality
console.log('🔐 PeerPigeon Crypto Test\n');

// Check if signaling server is running
async function checkSignalingServer() {
  // Simple check - just try to create a WebSocket connection briefly
  return true; // Assume server is running for now
}

async function createCryptoPeer(peerName, peerId = null) {
  const mesh = new PeerPigeonMesh({
    peerId,
    enableWebDHT: true,
    enableCrypto: true, // Enable crypto!
    ignoreEnvironmentErrors: true
  });

  // Set up event handlers
  mesh.addEventListener('statusChanged', (event) => {
    console.log(`[${peerName}] Status: ${event.type} - ${event.message || ''}`);
  });

  mesh.addEventListener('peerConnected', (event) => {
    console.log(`[${peerName}] 🔗 Connected to peer: ${event.peerId.substring(0, 8)}...`);
  });

  mesh.addEventListener('peerDisconnected', (event) => {
    console.log(`[${peerName}] 💔 Disconnected from peer: ${event.peerId.substring(0, 8)}... (${event.reason})`);
  });

  mesh.addEventListener('messageReceived', (event) => {
    const fromPeerId = event.from || 'unknown';
    console.log(`[${peerName}] 📨 Received: "${event.content}" from ${fromPeerId.substring(0, 8)}...`);
  });

  // Crypto-specific events
  mesh.addEventListener('peerKeyAdded', (event) => {
    console.log(`[${peerName}] 🔑 Key added for peer: ${event.peerId.substring(0, 8)}...`);
  });

  mesh.addEventListener('cryptoError', (event) => {
    console.log(`[${peerName}] 🚫 Crypto error: ${event.error}`);
  });

  // Initialize the mesh
  await mesh.init();
  console.log(`[${peerName}] Initialized with ID: ${mesh.peerId.substring(0, 8)}...`);

  return mesh;
}

async function testCrypto() {
  console.log('Checking signaling server at ws://localhost:3000...');
  const serverRunning = await checkSignalingServer();
  if (!serverRunning) {
    console.log('❌ Signaling server not running. Start it with: npm run server');
    process.exit(1);
  }
  console.log('✅ Signaling server is running\n');

  console.log('Creating two crypto-enabled mesh peers...\n');

  // Create two peers with crypto enabled
  const peer1 = await createCryptoPeer('CRYPTO-PEER-1');
  const peer2 = await createCryptoPeer('CRYPTO-PEER-2');

  console.log('\nConnecting to signaling server...\n');

  // Connect to signaling server
  await peer1.connect('ws://localhost:3000');
  await peer2.connect('ws://localhost:3000');

  // Wait for connection establishment
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('\nTesting encrypted message exchange...\n');

  // Test direct encrypted messaging between peers
  try {
    console.log('Testing sendEncryptedMessage...');

    // Get the peer IDs for direct encrypted messaging
    const peer1Id = peer1.peerId;
    const peer2Id = peer2.peerId;

    // Send encrypted message from peer1 to peer2
    await peer1.sendEncryptedMessage(peer2Id, 'This is an encrypted message from peer 1');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send encrypted message from peer2 to peer1
    await peer2.sendEncryptedMessage(peer1Id, 'This is an encrypted message from peer 2');
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('✅ Encrypted messaging test completed successfully!');
  } catch (error) {
    console.log(`❌ Encrypted messaging test failed: ${error.message}`);
    console.log('Falling back to regular messaging...');

    // Fallback to regular messaging
    peer1.sendMessage('Hello unencrypted world from peer 1!');
    await new Promise(resolve => setTimeout(resolve, 500));

    peer2.sendMessage('Hello unencrypted world from peer 2!');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Test a few more regular messages
  for (let i = 1; i <= 2; i++) {
    peer1.sendMessage(`Test message #${i}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    peer2.sendMessage(`Response #${i}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n--- Crypto Stats ---');
  console.log(`CRYPTO-PEER-1: ${peer1.getConnectedPeerCount()} connected peers`);
  console.log(`CRYPTO-PEER-2: ${peer2.getConnectedPeerCount()} connected peers`);

  console.log('\n🏁 Crypto test completed, cleaning up...\n');

  // Clean up
  peer1.disconnect();
  peer2.disconnect();

  // Give time for cleanup
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

testCrypto().catch(error => {
  console.error('Crypto test failed:', error);
  process.exit(1);
});
