#!/usr/bin/env node

/**
 * Node.js Test for PeerPigeon Mesh Networking
 * Demonstrates P2P mesh functionality in Node.js environment
 * 
 * Prerequisites:
 * - npm install ws @koush/wrtc
 * - Start signaling server: npm run server
 */

import { PeerPigeonMesh } from '../../index.js';
import WebSocket from 'ws';
import wrtc from '@koush/wrtc';

// Make WebRTC available globally for Node.js
global.RTCPeerConnection = wrtc.RTCPeerConnection;
global.RTCSessionDescription = wrtc.RTCSessionDescription;
global.RTCIceCandidate = wrtc.RTCIceCandidate;
global.WebSocket = WebSocket;

const SIGNALING_URL = 'ws://localhost:3000';
const TEST_DURATION = 30000; // 30 seconds

console.log('� PeerPigeon Node.js Mesh Test\n');

async function createPeer(peerName, peerId = null) {
    const mesh = new PeerPigeonMesh({
        peerId,
        enableWebDHT: true,
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

    // Initialize the mesh
    await mesh.init();
    console.log(`[${peerName}] Initialized with ID: ${mesh.peerId.substring(0, 8)}...`);

    // Display environment info
    const envReport = mesh.getEnvironmentReport();
    console.log(`[${peerName}] Environment: Node.js ${envReport.node?.version}, WebRTC: ${envReport.capabilities.webrtc}, WebSocket: ${envReport.capabilities.webSocket}`);

    return mesh;
}

async function runTest() {
    try {
        console.log('Creating two mesh peers...\n');

        // Create two peers
        const peer1 = await createPeer('PEER-1');
        const peer2 = await createPeer('PEER-2');

        console.log('\nConnecting to signaling server...\n');

        // Connect both peers to signaling server
        await peer1.connect(SIGNALING_URL);
        await peer2.connect(SIGNALING_URL);

        // Wait for connections to establish
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('\nTesting message exchange...\n');

        // Test messaging
        let messageCount = 0;
        const sendMessage = () => {
            messageCount++;
            const message = `Hello from Node.js test #${messageCount}`;
            
            if (messageCount % 2 === 1) {
                console.log(`[PEER-1] 📤 Sending: "${message}"`);
                peer1.sendMessage(message);
            } else {
                console.log(`[PEER-2] 📤 Sending: "${message}"`);
                peer2.sendMessage(message);
            }
        };

        // Send messages every 3 seconds
        const messageInterval = setInterval(sendMessage, 3000);
        sendMessage(); // Send first message immediately

        // Test DHT functionality
        setTimeout(async () => {
            console.log('\nTesting DHT functionality...\n');
            try {
                await peer1.dhtPut('test-key', { data: 'Hello from Node.js DHT!', timestamp: Date.now() });
                console.log('[PEER-1] 📝 Stored data in DHT');
                
                const value = await peer2.dhtGet('test-key');
                console.log(`[PEER-2] 📖 Retrieved from DHT:`, value);
            } catch (error) {
                console.error('DHT test failed:', error.message);
            }
        }, 5000);

        // Display stats periodically
        const statsInterval = setInterval(() => {
            const peer1ConnectedCount = peer1.getConnectedPeerCount();
            const peer2ConnectedCount = peer2.getConnectedPeerCount();
            console.log('\n--- Stats ---');
            console.log(`PEER-1: ${peer1ConnectedCount} connected peers`);
            console.log(`PEER-2: ${peer2ConnectedCount} connected peers`);
        }, 10000);

        // Run test for specified duration
        setTimeout(() => {
            console.log('\n🏁 Test completed, cleaning up...\n');
            clearInterval(messageInterval);
            clearInterval(statsInterval);
            
            peer1.disconnect();
            peer2.disconnect();
            
            process.exit(0);
        }, TEST_DURATION);

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Check if signaling server is running
console.log(`Checking signaling server at ${SIGNALING_URL}...`);
const testWs = new WebSocket(SIGNALING_URL);
testWs.on('open', () => {
    testWs.close();
    console.log('✅ Signaling server is running\n');
    runTest();
});
testWs.on('error', () => {
    console.error('❌ Signaling server not running. Start it with: npm run server');
    process.exit(1);
});
