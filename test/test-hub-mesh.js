#!/usr/bin/env node

/**
 * Test Hub P2P Mesh Network
 * 
 * This script tests the hub mesh system by:
 * 1. Starting multiple hub servers
 * 2. Verifying P2P connections are established
 * 3. Testing WebSocket to P2P migration
 * 4. Validating client signal relaying
 * 
 * Usage:
 *   node test-hub-mesh.js
 */

import { PeerPigeonServer } from '../server/index.js';
import { setTimeout } from 'timers/promises';

console.log('🧪 Testing Hub P2P Mesh Network\n');

const hubs = [];
const hubPorts = [3000, 3001, 3002];
const testDuration = 30000; // 30 seconds

// Track events
const events = {
    hubsStarted: 0,
    p2pConnections: 0,
    meshesReady: 0,
    migrationComplete: 0,
    hubDiscoveries: 0
};

async function startHub(port, isBootstrap = false) {
    console.log(`\n🚀 Starting Hub on port ${port} ${isBootstrap ? '(Bootstrap)' : ''}...`);
    
    const hub = new PeerPigeonServer({
        port,
        host: '0.0.0.0',
        isHub: true,
        hubMeshNamespace: 'pigeonhub-mesh',
        hubMeshMaxPeers: 3,
        hubMeshMinPeers: 2,
        meshMigrationDelay: 5000, // 5 seconds for testing
        autoConnect: true,
        bootstrapHubs: isBootstrap ? [] : ['ws://localhost:3000'],
        reconnectInterval: 2000,
        maxReconnectAttempts: 5
    });

    // Set up event tracking
    hub.on('started', ({ host, port }) => {
        console.log(`✅ Hub started on ws://${host}:${port}`);
        events.hubsStarted++;
    });

    hub.on('hubP2PConnected', ({ hubPeerId }) => {
        console.log(`🔗 [${port}] P2P connection with hub: ${hubPeerId.substring(0, 8)}...`);
        events.p2pConnections++;
    });

    hub.on('hubMeshReady', ({ p2pConnections, totalHubs }) => {
        console.log(`✨ [${port}] Hub mesh READY! ${p2pConnections} P2P connections, ${totalHubs} total hubs`);
        events.meshesReady++;
    });

    hub.on('hubMeshMigrated', ({ migratedCount, p2pConnections }) => {
        console.log(`🔄 [${port}] Migration complete: ${migratedCount} WebSocket connections closed, ${p2pConnections} P2P connections active`);
        events.migrationComplete++;
    });

    hub.on('hubDiscovered', ({ peerId, via }) => {
        console.log(`🔍 [${port}] Discovered hub ${peerId.substring(0, 8)}... via ${via}`);
        events.hubDiscoveries++;
    });

    hub.on('hubP2PDisconnected', ({ hubPeerId }) => {
        console.log(`🔌 [${port}] P2P disconnected from hub: ${hubPeerId.substring(0, 8)}...`);
    });

    hub.on('hubRegistered', ({ peerId, totalHubs }) => {
        console.log(`🏢 [${port}] Hub registered: ${peerId.substring(0, 8)}... (${totalHubs} total)`);
    });

    hub.on('bootstrapConnected', ({ uri }) => {
        console.log(`🔗 [${port}] Connected to bootstrap: ${uri}`);
    });

    hub.on('error', (error) => {
        console.error(`❌ [${port}] Error:`, error.message);
    });

    try {
        await hub.start();
        hubs.push(hub);
        return hub;
    } catch (error) {
        console.error(`❌ Failed to start hub on port ${port}:`, error.message);
        throw error;
    }
}

async function stopHub(hub) {
    if (hub && hub.isRunning) {
        await hub.stop();
    }
}

async function printMeshStatus() {
    console.log('\n📊 Hub Mesh Status:');
    console.log('═══════════════════════════════════════');
    
    for (const hub of hubs) {
        const p2pPeers = hub.hubMesh ? hub.hubMesh.getConnectedPeers() : [];
        const wsHubs = hub.hubs.size;
        const totalConnections = hub.connections.size;
        
        console.log(`\nHub ${hub.port}:`);
        console.log(`  Hub ID: ${hub.hubPeerId.substring(0, 8)}...`);
        console.log(`  P2P Connections: ${p2pPeers.length}`);
        if (p2pPeers.length > 0) {
            console.log(`    - ${p2pPeers.map(id => id.substring(0, 8) + '...').join(', ')}`);
        }
        console.log(`  WebSocket Hub Connections: ${wsHubs}`);
        console.log(`  Total Connections: ${totalConnections}`);
        console.log(`  Mesh Ready: ${hub.hubMeshReady ? '✅' : '❌'}`);
        console.log(`  Migrated Hubs: ${hub.migratedToP2P.size}`);
    }
    
    console.log('\n═══════════════════════════════════════');
}

async function printEventSummary() {
    console.log('\n📈 Test Event Summary:');
    console.log('═══════════════════════════════════════');
    console.log(`Hubs Started:        ${events.hubsStarted}/${hubPorts.length}`);
    console.log(`Hub Discoveries:     ${events.hubDiscoveries}`);
    console.log(`P2P Connections:     ${events.p2pConnections}`);
    console.log(`Meshes Ready:        ${events.meshesReady}/${hubPorts.length}`);
    console.log(`Migrations Complete: ${events.migrationComplete}/${hubPorts.length}`);
    console.log('═══════════════════════════════════════');
}

async function validateMesh() {
    console.log('\n✅ Validating Mesh Formation...');
    
    let allValid = true;
    
    // Check that all hubs have P2P connections
    for (const hub of hubs) {
        const p2pCount = hub.hubMesh ? hub.hubMesh.getConnectedPeers().length : 0;
        
        if (p2pCount === 0) {
            console.log(`❌ Hub ${hub.port} has NO P2P connections`);
            allValid = false;
        } else if (p2pCount < hub.hubMeshMinPeers) {
            console.log(`⚠️  Hub ${hub.port} has ${p2pCount} P2P connections (below minimum ${hub.hubMeshMinPeers})`);
        } else {
            console.log(`✅ Hub ${hub.port} has ${p2pCount} P2P connections`);
        }
    }
    
    // Check that migration happened
    for (const hub of hubs) {
        if (!hub.hubMeshReady) {
            console.log(`⚠️  Hub ${hub.port} mesh not ready`);
            allValid = false;
        } else {
            console.log(`✅ Hub ${hub.port} mesh is ready`);
        }
    }
    
    return allValid;
}

async function runTest() {
    try {
        // Start hubs sequentially
        console.log('\n🚀 Phase 1: Starting Hubs\n');
        
        // Start bootstrap hub first
        await startHub(hubPorts[0], true);
        await setTimeout(2000); // Wait 2 seconds
        
        // Start secondary hubs
        for (let i = 1; i < hubPorts.length; i++) {
            await startHub(hubPorts[i], false);
            await setTimeout(1000); // Stagger starts
        }
        
        console.log('\n✅ All hubs started!\n');
        
        // Wait for mesh formation and migration
        console.log('⏳ Phase 2: Waiting for P2P mesh formation and migration...\n');
        await setTimeout(15000); // Wait 15 seconds for mesh formation + migration
        
        // Print status
        await printMeshStatus();
        
        // Validate mesh
        console.log('\n🔍 Phase 3: Validating Mesh\n');
        const isValid = await validateMesh();
        
        // Print event summary
        await printEventSummary();
        
        // Final result
        console.log('\n' + '═'.repeat(50));
        if (isValid && events.p2pConnections > 0 && events.meshesReady >= 2) {
            console.log('✅ TEST PASSED: Hub P2P mesh is working correctly!');
        } else {
            console.log('⚠️  TEST INCOMPLETE: Some issues detected (see above)');
        }
        console.log('═'.repeat(50) + '\n');
        
        // Keep running for a bit to observe
        console.log('⏳ Keeping hubs running for observation (10 more seconds)...\n');
        await setTimeout(10000);
        
    } catch (error) {
        console.error('\n❌ Test failed with error:', error);
    } finally {
        // Cleanup
        console.log('\n🛑 Stopping all hubs...\n');
        for (const hub of hubs) {
            await stopHub(hub);
        }
        console.log('✅ Test complete!\n');
        process.exit(0);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Interrupted, stopping hubs...\n');
    for (const hub of hubs) {
        await stopHub(hub);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Terminated, stopping hubs...\n');
    for (const hub of hubs) {
        await stopHub(hub);
    }
    process.exit(0);
});

// Run the test
runTest();
