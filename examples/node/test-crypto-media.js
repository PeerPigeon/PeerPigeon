#!/usr/bin/env node

import { PeerPigeonMesh } from '../../index.js';
import WebSocket from 'ws';
import wrtc from '@koush/wrtc';

// Make WebRTC available globally for Node.js
global.RTCPeerConnection = wrtc.RTCPeerConnection;
global.RTCSessionDescription = wrtc.RTCSessionDescription;
global.RTCIceCandidate = wrtc.RTCIceCandidate;
global.WebSocket = WebSocket;

// Test crypto functionality with media streams
console.log('🔐🎥 PeerPigeon Crypto + Media Test\n');

async function createCryptoPeerWithMedia(peerName, enableMedia = false) {
  const mesh = new PeerPigeonMesh({
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

  // Media events
  mesh.addEventListener('remoteStream', (event) => {
    console.log(`[${peerName}] 🎥 Remote stream received from ${event.peerId.substring(0, 8)}...`);
    const { stream } = event;
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();
    console.log(`[${peerName}] 🎥 Stream has ${audioTracks.length} audio tracks, ${videoTracks.length} video tracks`);
  });

  // Initialize the mesh
  await mesh.init();
  console.log(`[${peerName}] Initialized with ID: ${mesh.peerId.substring(0, 8)}...`);

  if (enableMedia) {
    try {
      console.log(`[${peerName}] Starting media stream...`);
      // Start media stream (this will work in Node.js environment with mock streams)
      await mesh.startMedia({ video: true, audio: true });
      console.log(`[${peerName}] Media stream started successfully`);
    } catch (error) {
      console.log(`[${peerName}] Media stream failed (expected in Node.js): ${error.message}`);
    }
  }

  return mesh;
}

async function testCryptoWithMedia() {
  console.log('Testing crypto key exchange with media-enabled peers...\n');

  // Create two peers - one with media, one without
  const peer1 = await createCryptoPeerWithMedia('CRYPTO-MEDIA-PEER-1', true);
  const peer2 = await createCryptoPeerWithMedia('CRYPTO-PEER-2', false);

  console.log('\nConnecting to signaling server...\n');

  // Connect to signaling server
  await peer1.connect('ws://localhost:3000');
  await peer2.connect('ws://localhost:3000');

  // Wait for connection establishment
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('\nTesting encrypted message exchange with media connection...\n');

  // Test encrypted messaging between peers (one with media, one without)
  try {
    console.log('Testing sendEncryptedMessage with media-enabled peer...');

    const peer1Id = peer1.peerId;
    const peer2Id = peer2.peerId;

    // Send encrypted message from media peer to regular peer
    await peer1.sendEncryptedMessage(peer2Id, 'This is an encrypted message from the media-enabled peer');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send encrypted message from regular peer to media peer
    await peer2.sendEncryptedMessage(peer1Id, 'This is an encrypted message to the media-enabled peer');
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('✅ Encrypted messaging test with media peer completed successfully!');
  } catch (error) {
    console.log(`❌ Encrypted messaging test failed: ${error.message}`);
  }

  // Check crypto status
  console.log('\n--- Crypto Status with Media ---');
  const crypto1Status = peer1.getCryptoStatus();
  const crypto2Status = peer2.getCryptoStatus();

  console.log(`CRYPTO-MEDIA-PEER-1: enabled=${crypto1Status.enabled}, keys=${Object.keys(crypto1Status.peerKeys || {}).length}`);
  console.log(`CRYPTO-PEER-2: enabled=${crypto2Status.enabled}, keys=${Object.keys(crypto2Status.peerKeys || {}).length}`);

  console.log('\n🏁 Crypto + Media test completed, cleaning up...\n');

  // Clean up
  peer1.disconnect();
  peer2.disconnect();

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

testCryptoWithMedia().catch(error => {
  console.error('Crypto + Media test failed:', error);
  process.exit(1);
});
