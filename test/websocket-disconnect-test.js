#!/usr/bin/env node

/**
 * Test that peers remain connected when websocket disconnects
 * This verifies that WebRTC peer-to-peer connections persist
 * even when the signaling server connection is lost
 */

import { PeerPigeonMesh } from '../src/PeerPigeonMesh.js';
import { PeerPigeonServer } from '../server/index.js';

console.log('🧪 Testing WebSocket disconnect behavior...\n');

// Start signaling server
console.log('1️⃣ Starting signaling server...');
const server = new PeerPigeonServer({
    port: 3555,
    host: '0.0.0.0'
});
await server.start();
console.log('✅ Server started on port 3555\n');

await new Promise(r => setTimeout(r, 1000));

// Create two peers
console.log('2️⃣ Creating Peer A and Peer B...');
const peerA = new PeerPigeonMesh({
    debug: true,
    maxPeers: 10,
    ignoreEnvironmentErrors: true
});

const peerB = new PeerPigeonMesh({
    debug: true,
    maxPeers: 10,
    ignoreEnvironmentErrors: true
});

// Initialize peers
await peerA.init();
await peerB.init();
console.log(`✅ Peer A initialized: ${peerA.peerId.substring(0, 8)}...`);
console.log(`✅ Peer B initialized: ${peerB.peerId.substring(0, 8)}...\n`);

// Track peer connection status
let peersConnected = false;
peerA.on('peerConnected', (event) => {
    if (event.peerId === peerB.peerId) {
        console.log('✅ Peer A connected to Peer B via WebRTC\n');
        peersConnected = true;
    }
});

// Track WebSocket disconnections
let peerAWebSocketDisconnected = false;
let peerBWebSocketDisconnected = false;

peerA.on('statusChanged', (event) => {
    if (event.type === 'disconnected') {
        console.log('⚠️  Peer A WebSocket disconnected');
        peerAWebSocketDisconnected = true;
    }
});

peerB.on('statusChanged', (event) => {
    if (event.type === 'disconnected') {
        console.log('⚠️  Peer B WebSocket disconnected');
        peerBWebSocketDisconnected = true;
    }
});

// Connect both peers to server
console.log('3️⃣ Connecting peers to signaling server...');
await peerA.connect('ws://localhost:3555');
await peerB.connect('ws://localhost:3555');
console.log('✅ Both peers connected to signaling server\n');

// Wait for peer discovery and connection
console.log('4️⃣ Waiting for peers to discover each other...');
await new Promise(r => setTimeout(r, 5000));

if (!peersConnected) {
    console.error('❌ TEST FAILED: Peers did not connect to each other');
    await server.stop();
    process.exit(1);
}

// Check peer connections before server shutdown
const connectedPeersBefore = peerA.connectionManager.getConnectedPeers();
console.log(`5️⃣ Peer A has ${connectedPeersBefore.length} connected peer(s) before WebSocket disconnect`);

// Stop the signaling server to simulate WebSocket disconnect
console.log('\n6️⃣ Stopping signaling server to disconnect WebSockets...');
await server.stop();
console.log('✅ Signaling server stopped\n');

// Wait for WebSocket disconnection to be detected
console.log('7️⃣ Waiting for WebSocket disconnection to be detected...');
await new Promise(r => setTimeout(r, 3000));

if (!peerAWebSocketDisconnected || !peerBWebSocketDisconnected) {
    console.warn('⚠️  WARNING: WebSocket disconnection not detected on both peers');
}

// Check if peers are still connected via WebRTC
const connectedPeersAfter = peerA.connectionManager.getConnectedPeers();
console.log(`\n8️⃣ Peer A has ${connectedPeersAfter.length} connected peer(s) after WebSocket disconnect`);

// Test messaging between peers (should work without signaling server)
console.log('\n9️⃣ Testing P2P messaging without signaling server...');
let messageReceived = false;
peerB.on('messageReceived', (event) => {
    if (event.from === peerA.peerId && event.content && event.content.text === 'Hello without signaling!') {
        console.log('✅ Message received from Peer A to Peer B (P2P works!)');
        messageReceived = true;
    }
});

await peerA.sendDirectMessage(peerB.peerId, { text: 'Hello without signaling!' });
await new Promise(r => setTimeout(r, 2000));

// Verify results
console.log('\n🎯 TEST RESULTS:');
console.log('================');
console.log(`Peers connected before WebSocket disconnect: ${connectedPeersBefore.length > 0 ? '✅' : '❌'}`);
console.log(`WebSocket disconnected on both peers: ${peerAWebSocketDisconnected && peerBWebSocketDisconnected ? '✅' : '❌'}`);
console.log(`Peers still connected after WebSocket disconnect: ${connectedPeersAfter.length > 0 ? '✅' : '❌'}`);
console.log(`P2P messaging works without signaling server: ${messageReceived ? '✅' : '❌'}`);

const testPassed = 
    connectedPeersBefore.length > 0 &&
    connectedPeersAfter.length > 0 &&
    connectedPeersBefore.length === connectedPeersAfter.length &&
    messageReceived;

if (testPassed) {
    console.log('\n✅ TEST PASSED: Peers remain connected when WebSocket disconnects!');
} else {
    console.log('\n❌ TEST FAILED: Peers disconnected when WebSocket disconnected');
}

// Cleanup
console.log('\n🧹 Cleaning up...');
peerA.disconnect();
peerB.disconnect();

console.log('✅ Test complete\n');
process.exit(testPassed ? 0 : 1);
