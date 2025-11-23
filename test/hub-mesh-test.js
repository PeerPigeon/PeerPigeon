#!/usr/bin/env node

/**
 * Test Hub P2P Mesh Formation
 * 
 * This test demonstrates:
 * 1. Multiple hubs starting up and registering as bootstrap nodes
 * 2. Hubs forming a P2P mesh using PeerPigeonMesh with XOR routing
 * 3. Hubs migrating from WebSocket to P2P-only communication
 * 4. Client peer signaling being relayed through the P2P hub mesh
 */

import { PeerPigeonServer } from '../server/index.js';

const PORTS = [3000, 3001, 3002];
const TEST_DURATION = 30000; // 30 seconds
const hubs = [];

console.log('🚀 Starting Hub P2P Mesh Test\n');
console.log(`Creating ${PORTS.length} hubs that will form a P2P mesh...\n`);

async function startHub(port, bootstrapHubs = []) {
    const hub = new PeerPigeonServer({
        port,
        host: '0.0.0.0',
        isHub: true,
        hubMeshNamespace: 'pigeonhub-mesh',
        autoConnect: true,
        bootstrapHubs,
        hubMeshMaxPeers: 3,
        hubMeshMinPeers: 2,
        meshMigrationDelay: 5000 // 5 seconds after mesh is ready
    });

    // Track events
    let stats = {
        port,
        peerConnections: 0,
        p2pConnections: 0,
        hubsDiscovered: 0,
        meshReady: false,
        migrated: false
    };

    hub.on('started', ({ host, port }) => {
        console.log(`✅ Hub ${port} started`);
    });

    hub.on('hubRegistered', ({ peerId, totalHubs }) => {
        stats.hubsDiscovered = totalHubs;
        console.log(`🏢 Hub ${port}: Discovered hub ${peerId.substring(0, 8)}... (${totalHubs} total)`);
    });

    hub.on('hubP2PConnected', ({ hubPeerId }) => {
        stats.p2pConnections++;
        console.log(`🔗 Hub ${port}: P2P connection with ${hubPeerId.substring(0, 8)}... (${stats.p2pConnections} total)`);
    });

    hub.on('hubMeshReady', ({ p2pConnections, totalHubs }) => {
        stats.meshReady = true;
        console.log(`✅ Hub ${port}: MESH READY! ${p2pConnections} P2P connections, ${totalHubs} total hubs`);
    });

    hub.on('hubMeshMigrated', ({ migratedCount, p2pConnections }) => {
        stats.migrated = true;
        console.log(`🔄 Hub ${port}: MIGRATED to P2P-only! Closed ${migratedCount} WebSocket connections`);
    });

    hub.on('bootstrapConnected', ({ uri }) => {
        console.log(`🔗 Hub ${port}: Connected to bootstrap ${uri}`);
    });

    hub.on('bootstrapDisconnected', ({ uri, code, reason }) => {
        console.log(`🔌 Hub ${port}: Disconnected from bootstrap ${uri} (${code}: ${reason})`);
    });

    hub.on('hubDiscovered', ({ peerId }) => {
        console.log(`🔍 Hub ${port}: Discovered hub ${peerId.substring(0, 8)}...`);
    });

    hub.on('error', (error) => {
        console.error(`❌ Hub ${port} error:`, error.message);
    });

    await hub.start();
    return { hub, stats };
}

async function runTest() {
    try {
        // Start first hub (bootstrap)
        console.log('🏢 Starting Hub 1 (port 3000) - Bootstrap hub...\n');
        const hub1 = await startHub(3000);
        hubs.push(hub1);
        
        // Wait a bit for first hub to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Start second hub, connecting to first
        console.log('\n🏢 Starting Hub 2 (port 3001) - Connecting to bootstrap...\n');
        const hub2 = await startHub(3001, ['ws://localhost:3000']);
        hubs.push(hub2);

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Start third hub, connecting to first
        console.log('\n🏢 Starting Hub 3 (port 3002) - Connecting to bootstrap...\n');
        const hub3 = await startHub(3002, ['ws://localhost:3000']);
        hubs.push(hub3);

        console.log('\n⏳ Waiting for hub mesh to form and migrate to P2P...\n');
        
        // Monitor for completion
        let checkInterval = setInterval(() => {
            const readyCount = hubs.filter(h => h.stats.meshReady).length;
            const migratedCount = hubs.filter(h => h.stats.migrated).length;
            
            console.log(`📊 Status: ${readyCount}/${hubs.length} mesh ready, ${migratedCount}/${hubs.length} migrated`);
            
            // Check if all are migrated
            if (migratedCount === hubs.length) {
                console.log('\n✅ ALL HUBS MIGRATED TO P2P!\n');
                clearInterval(checkInterval);
                printFinalStats();
            }
        }, 3000);

        // Set timeout for test completion
        setTimeout(() => {
            clearInterval(checkInterval);
            console.log('\n⏰ Test duration reached\n');
            printFinalStats();
        }, TEST_DURATION);

    } catch (error) {
        console.error('❌ Test failed:', error);
        cleanup();
        process.exit(1);
    }
}

function printFinalStats() {
    console.log('═══════════════════════════════════════════');
    console.log('           FINAL TEST RESULTS              ');
    console.log('═══════════════════════════════════════════\n');

    hubs.forEach(({ hub, stats }) => {
        console.log(`Hub ${stats.port}:`);
        console.log(`  • Hubs discovered: ${stats.hubsDiscovered}`);
        console.log(`  • P2P connections: ${stats.p2pConnections}`);
        console.log(`  • Mesh ready: ${stats.meshReady ? '✅' : '❌'}`);
        console.log(`  • Migrated to P2P: ${stats.migrated ? '✅' : '❌'}`);
        
        if (hub.hubMesh) {
            const connectedPeers = hub.hubMesh.getConnectedPeers();
            console.log(`  • Current P2P peers: ${connectedPeers.length}`);
        }
        console.log('');
    });

    console.log('═══════════════════════════════════════════\n');
    
    // Check success criteria
    const allReady = hubs.every(h => h.stats.meshReady);
    const allMigrated = hubs.every(h => h.stats.migrated);
    
    if (allReady && allMigrated) {
        console.log('✅ TEST PASSED: All hubs formed P2P mesh and migrated from WebSocket!\n');
    } else if (allReady) {
        console.log('⚠️  TEST PARTIAL: Mesh formed but not all hubs migrated\n');
    } else {
        console.log('❌ TEST FAILED: Not all hubs reached mesh ready state\n');
    }

    cleanup();
}

async function cleanup() {
    console.log('🧹 Cleaning up...\n');
    
    for (const { hub, stats } of hubs) {
        try {
            await hub.stop();
            console.log(`✅ Hub ${stats.port} stopped`);
        } catch (error) {
            console.error(`❌ Error stopping hub ${stats.port}:`, error.message);
        }
    }

    console.log('\n✅ Cleanup complete');
    process.exit(0);
}

// Handle cleanup on interrupt
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Interrupted by user\n');
    cleanup();
});

process.on('SIGTERM', cleanup);

// Run the test
runTest().catch(error => {
    console.error('❌ Fatal error:', error);
    cleanup();
});
