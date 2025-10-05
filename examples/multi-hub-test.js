#!/usr/bin/env node

/**
 * Multi-Hub Cross-Peer Connection Test
 * 
 * This example demonstrates:
 * 1. Starting multiple hubs (Hub A on 3000, Hub B on 3001)
 * 2. Hub B connects to Hub A as bootstrap
 * 3. Peers connect to different hubs
 * 4. Peers discover each other across hubs
 * 
 * Usage:
 *   node examples/multi-hub-test.js
 */

import { PeerPigeonServer } from '../server/index.js';
import { PeerPigeonMesh } from '../index.js';

// Setup WebRTC for Node.js
async function setupWebRTC() {
    try {
        const [WebSocket, wrtc] = await Promise.all([
            import('ws'),
            import('@koush/wrtc')
        ]);
        
        global.RTCPeerConnection = wrtc.default.RTCPeerConnection;
        global.RTCSessionDescription = wrtc.default.RTCSessionDescription;
        global.RTCIceCandidate = wrtc.default.RTCIceCandidate;
        global.WebSocket = WebSocket.default;
        
        return true;
    } catch (error) {
        console.error('❌ Failed to setup WebRTC:', error);
        return false;
    }
}

async function main() {
    console.log('🚀 Multi-Hub Cross-Peer Connection Test\n');
    
    // Initialize WebRTC
    if (!await setupWebRTC()) {
        process.exit(1);
    }
    
    // Start Hub A (Bootstrap Hub on port 3000)
    console.log('📡 Starting Hub A (Bootstrap) on port 3000...');
    const hubA = new PeerPigeonServer({
        port: 3000,
        host: 'localhost',
        isHub: true,
        autoConnect: false // This is the bootstrap hub, no need to connect
    });
    
    await hubA.start();
    console.log('✅ Hub A running\n');
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Start Hub B (connects to Hub A on port 3000)
    console.log('📡 Starting Hub B on port 3001 (bootstrapping to Hub A)...');
    const hubB = new PeerPigeonServer({
        port: 3001,
        host: 'localhost',
        isHub: true,
        bootstrapHubs: ['ws://localhost:3000'], // Connect to Hub A
        autoConnect: true
    });
    
    await hubB.start();
    console.log('✅ Hub B running\n');
    
    // Wait for hub connection to establish
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create Peer 1 connected to Hub A
    console.log('👤 Creating Peer 1 (connected to Hub A on port 3000)...');
    const peer1 = new PeerPigeonMesh({
        networkName: 'test-network',
        ignoreEnvironmentErrors: true
    });
    
    let peer1Discovered = false;
    let peer2Discovered = false;
    
    peer1.on('peer-discovered', ({ peerId }) => {
        console.log(`✅ Peer 1 DISCOVERED EVENT: ${peerId.substring(0, 8)}...`);
        peer2Discovered = true;
    });
    
    peer1.on('peerDiscovered', ({ peerId }) => {
        console.log(`✅ Peer 1 peerDiscovered EVENT: ${peerId.substring(0, 8)}...`);
        peer2Discovered = true;
    });
    
    peer1.on('peer-connected', ({ peerId }) => {
        console.log(`🤝 Peer 1 CONNECTED to peer: ${peerId.substring(0, 8)}...`);
    });
    
    peer1.on('peerConnected', ({ peerId }) => {
        console.log(`🤝 Peer 1 peerConnected to peer: ${peerId.substring(0, 8)}...`);
    });
    
    await peer1.init();
    await peer1.connect('ws://localhost:3000');
    console.log(`✅ Peer 1 connected (ID: ${peer1.peerId.substring(0, 8)}...)\n`);
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create Peer 2 connected to Hub B
    console.log('👤 Creating Peer 2 (connected to Hub B on port 3001)...');
    const peer2 = new PeerPigeonMesh({
        networkName: 'test-network',
        ignoreEnvironmentErrors: true
    });
    
    peer2.on('peer-discovered', ({ peerId }) => {
        console.log(`✅ Peer 2 DISCOVERED EVENT: ${peerId.substring(0, 8)}...`);
        peer1Discovered = true;
    });
    
    peer2.on('peerDiscovered', ({ peerId }) => {
        console.log(`✅ Peer 2 peerDiscovered EVENT: ${peerId.substring(0, 8)}...`);
        peer1Discovered = true;
    });
    
    peer2.on('peer-connected', ({ peerId }) => {
        console.log(`🤝 Peer 2 CONNECTED to peer: ${peerId.substring(0, 8)}...`);
    });
    
    peer2.on('peerConnected', ({ peerId }) => {
        console.log(`🤝 Peer 2 peerConnected to peer: ${peerId.substring(0, 8)}...`);
    });
    
    await peer2.init();
    await peer2.connect('ws://localhost:3001');
    console.log(`✅ Peer 2 connected (ID: ${peer2.peerId.substring(0, 8)}...)\n`);
    
    // Wait for peer discovery
    console.log('⏳ Waiting for cross-hub peer discovery...');
    
    // Wait up to 10 seconds for discovery
    const startTime = Date.now();
    const timeout = 10000;
    
    while (!peer1Discovered || !peer2Discovered) {
        if (Date.now() - startTime > timeout) {
            console.error('❌ Timeout waiting for peer discovery!');
            console.error(`   Peer 1 discovered Peer 2: ${peer1Discovered}`);
            console.error(`   Peer 2 discovered Peer 1: ${peer2Discovered}`);
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (peer1Discovered && peer2Discovered) {
        console.log('\n✅ SUCCESS! Peers on different hubs discovered each other!');
    } else {
        console.log('\n❌ FAILED! Peers did not discover each other.');
    }
    
    // Show final status
    console.log('\n📊 Final Status:');
    console.log(`   Hub A: ${hubA.connections.size} connections`);
    console.log(`   Hub B: ${hubB.connections.size} connections`);
    console.log(`   Peer 1 discovered peers: ${peer1.discoveredPeers.size}`);
    console.log(`   Peer 2 discovered peers: ${peer2.discoveredPeers.size}`);
    
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await peer1.disconnect();
    await peer2.disconnect();
    await hubB.stop();
    await hubA.stop();
    
    console.log('✅ Test complete!');
    process.exit(peer1Discovered && peer2Discovered ? 0 : 1);
}

main().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});
