#!/usr/bin/env node

/**
 * Test that peers on the same hub discover and connect to each other
 */

import { PeerPigeonServer } from '../server/index.js';
import { PeerPigeonMesh } from '../src/PeerPigeonMesh.js';

async function main() {
    console.log('🧪 Testing Same-Hub Peer Discovery\n');
    console.log('=' .repeat(60));
    
    // Start a single hub
    console.log('\n📡 Starting Hub...');
    const hub = new PeerPigeonServer({
        port: 3000,
        host: 'localhost',
        isHub: false, // Regular signaling server, not a hub in the mesh
    });
    
    await hub.start();
    console.log('✅ Hub running on port 3000\n');
    
    // Wait for hub to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create Peer 1
    console.log('👤 Creating Peer 1...');
    const peer1 = new PeerPigeonMesh({
        networkName: 'test-network',
        ignoreEnvironmentErrors: true
    });
    
    let peer1DiscoveredPeer2 = false;
    let peer2DiscoveredPeer1 = false;
    let peer1ConnectedToPeer2 = false;
    let peer2ConnectedToPeer1 = false;
    
    peer1.on('peerDiscovered', ({ peerId }) => {
        console.log(`✅ Peer 1 discovered: ${peerId.substring(0, 8)}...`);
        peer1DiscoveredPeer2 = true;
    });
    
    peer1.on('peerConnected', ({ peerId }) => {
        console.log(`🤝 Peer 1 connected to: ${peerId.substring(0, 8)}...`);
        peer1ConnectedToPeer2 = true;
    });
    
    await peer1.init();
    await peer1.connect('ws://localhost:3000');
    console.log(`✅ Peer 1 connected (ID: ${peer1.peerId.substring(0, 8)}...)\n`);
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create Peer 2
    console.log('👤 Creating Peer 2...');
    const peer2 = new PeerPigeonMesh({
        networkName: 'test-network',
        ignoreEnvironmentErrors: true
    });
    
    peer2.on('peerDiscovered', ({ peerId }) => {
        console.log(`✅ Peer 2 discovered: ${peerId.substring(0, 8)}...`);
        peer2DiscoveredPeer1 = true;
    });
    
    peer2.on('peerConnected', ({ peerId }) => {
        console.log(`🤝 Peer 2 connected to: ${peerId.substring(0, 8)}...`);
        peer2ConnectedToPeer1 = true;
    });
    
    await peer2.init();
    await peer2.connect('ws://localhost:3000');
    console.log(`✅ Peer 2 connected (ID: ${peer2.peerId.substring(0, 8)}...)\n`);
    
    // Wait for peer discovery and connection
    console.log('⏳ Waiting for peer discovery and connection...');
    
    const startTime = Date.now();
    const timeout = 15000;
    
    while (!peer1DiscoveredPeer2 || !peer2DiscoveredPeer1 || !peer1ConnectedToPeer2 || !peer2ConnectedToPeer1) {
        if (Date.now() - startTime > timeout) {
            console.error('\n❌ Timeout waiting for peer discovery/connection!');
            console.error(`   Peer 1 discovered Peer 2: ${peer1DiscoveredPeer2}`);
            console.error(`   Peer 2 discovered Peer 1: ${peer2DiscoveredPeer1}`);
            console.error(`   Peer 1 connected to Peer 2: ${peer1ConnectedToPeer2}`);
            console.error(`   Peer 2 connected to Peer 1: ${peer2ConnectedToPeer1}`);
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (peer1DiscoveredPeer2 && peer2DiscoveredPeer1 && peer1ConnectedToPeer2 && peer2ConnectedToPeer1) {
        console.log('\n✅ SUCCESS! Peers on the same hub discovered and connected to each other!');
    } else if (peer1DiscoveredPeer2 && peer2DiscoveredPeer1) {
        console.log('\n⚠️  PARTIAL SUCCESS! Peers discovered each other but connection failed.');
    } else {
        console.log('\n❌ FAILED! Peers did not discover or connect to each other.');
    }
    
    // Show final status
    console.log('\n📊 Final Status:');
    console.log(`   Hub: ${hub.connections.size} connections`);
    console.log(`   Peer 1 discovered peers: ${peer1.discoveredPeers?.size || 0}`);
    console.log(`   Peer 2 discovered peers: ${peer2.discoveredPeers?.size || 0}`);
    console.log(`   Peer 1 connected peers: ${peer1.connectionManager?.getConnectedPeerCount() || 0}`);
    console.log(`   Peer 2 connected peers: ${peer2.connectionManager?.getConnectedPeerCount() || 0}`);
    
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await peer1.disconnect();
    await peer2.disconnect();
    await hub.stop();
    
    console.log('✅ Test complete!\n');
    process.exit(peer1DiscoveredPeer2 && peer2DiscoveredPeer1 && peer1ConnectedToPeer2 && peer2ConnectedToPeer1 ? 0 : 1);
}

main().catch(error => {
    console.error('❌ Test error:', error);
    process.exit(1);
});
