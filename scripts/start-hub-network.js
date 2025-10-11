#!/usr/bin/env node

/**
 * Start a Network of PeerPigeon Hubs
 * 
 * This script starts multiple hubs that automatically connect to each other:
 * - Bootstrap hub on port 3000
 * - Secondary hubs on ports 3001, 3002, 3003
 * 
 * Usage:
 *   node scripts/start-hub-network.js
 *   HUB_COUNT=5 node scripts/start-hub-network.js
 *   HUB_MESH_NAMESPACE=custom-mesh node scripts/start-hub-network.js
 */

import { PeerPigeonServer } from '../server/index.js';

// Configuration
const HUB_COUNT = parseInt(process.env.HUB_COUNT) || 4; // Bootstrap + 3 secondary
const START_PORT = parseInt(process.env.START_PORT) || 3000;
const HOST = process.env.HOST || 'localhost';
const HUB_MESH_NAMESPACE = process.env.HUB_MESH_NAMESPACE || 'pigeonhub-mesh';

console.log('╔════════════════════════════════════════════╗');
console.log('║    PeerPigeon Hub Network Startup          ║');
console.log('╚════════════════════════════════════════════╝\n');

console.log(`📋 Configuration:`);
console.log(`  Total Hubs: ${HUB_COUNT}`);
console.log(`  Start Port: ${START_PORT}`);
console.log(`  Host: ${HOST}`);
console.log(`  Hub Mesh Namespace: ${HUB_MESH_NAMESPACE}`);
console.log('');

const hubs = [];

// Create bootstrap hub
async function createBootstrapHub() {
    console.log(`\n🏢 Creating Bootstrap Hub (Port ${START_PORT})...`);
    
    const hub = new PeerPigeonServer({
        port: START_PORT,
        host: HOST,
        isHub: true,
        hubMeshNamespace: HUB_MESH_NAMESPACE,
        autoConnect: false
    });

    setupHubEvents(hub, 'Bootstrap', START_PORT);
    await hub.start();
    hubs.push(hub);
    
    return hub;
}

// Create secondary hub
async function createSecondaryHub(port) {
    console.log(`\n🌐 Creating Secondary Hub (Port ${port})...`);
    
    const hub = new PeerPigeonServer({
        port,
        host: HOST,
        isHub: true,
        hubMeshNamespace: HUB_MESH_NAMESPACE,
        autoConnect: true,
        bootstrapHubs: [`ws://${HOST}:${START_PORT}`]
    });

    setupHubEvents(hub, `Hub-${port}`, port);
    await hub.start();
    hubs.push(hub);
    
    return hub;
}

// Setup event listeners for a hub
function setupHubEvents(hub, name, port) {
    hub.on('started', ({ host, port }) => {
        console.log(`  ✅ ${name} started on ws://${host}:${port}`);
    });

    hub.on('peerConnected', ({ peerId }) => {
        console.log(`  [${name}] ✅ Peer: ${peerId.substring(0, 8)}...`);
    });

    hub.on('hubRegistered', ({ peerId, totalHubs }) => {
        console.log(`  [${name}] 🏢 Hub registered: ${peerId.substring(0, 8)}... (Total: ${totalHubs})`);
    });

    hub.on('bootstrapConnected', ({ uri }) => {
        console.log(`  [${name}] 🔗 Connected to bootstrap: ${uri}`);
    });

    hub.on('bootstrapDisconnected', ({ uri }) => {
        console.log(`  [${name}] 🔌 Lost bootstrap connection: ${uri}`);
    });

    hub.on('hubDiscovered', ({ peerId }) => {
        console.log(`  [${name}] 🔍 Discovered hub: ${peerId.substring(0, 8)}...`);
    });

    hub.on('error', (error) => {
        console.error(`  [${name}] ❌ Error:`, error.message);
    });
}

// Display network statistics
function displayNetworkStats() {
    console.log('\n' + '═'.repeat(60));
    console.log('📊 NETWORK STATISTICS');
    console.log('═'.repeat(60));
    
    let totalConnections = 0;
    let totalPeers = 0;
    let totalHubs = 0;
    let totalNetworks = 0;
    
    hubs.forEach((hub, index) => {
        const stats = hub.getStats();
        const hubStats = hub.getHubStats();
        const port = START_PORT + index;
        const name = index === 0 ? 'Bootstrap' : `Hub-${port}`;
        
        console.log(`\n${name} (Port ${port}):`);
        console.log(`  Connections: ${stats.connections}`);
        console.log(`  Peers: ${stats.peers}`);
        console.log(`  Hubs: ${stats.hubs}`);
        console.log(`  Networks: ${stats.networks}`);
        
        if (hubStats.bootstrapHubs.length > 0) {
            const connected = hubStats.bootstrapHubs.filter(h => h.connected).length;
            console.log(`  Bootstrap Connections: ${connected}/${hubStats.bootstrapHubs.length}`);
        }
        
        totalConnections += stats.connections;
        totalPeers += stats.peers;
        totalHubs = Math.max(totalHubs, stats.hubs);
        totalNetworks = Math.max(totalNetworks, stats.networks);
    });
    
    console.log('\n' + '─'.repeat(60));
    console.log(`Total Active Hubs: ${hubs.length}`);
    console.log(`Total Connections: ${totalConnections}`);
    console.log(`Unique Hubs Registered: ${totalHubs}`);
    console.log('═'.repeat(60) + '\n');
}

// Display network topology
function displayTopology() {
    console.log('\n' + '═'.repeat(60));
    console.log('🌐 NETWORK TOPOLOGY');
    console.log('═'.repeat(60));
    console.log(`\nBootstrap Hub (${START_PORT})`);
    console.log('        ↑');
    
    for (let i = 1; i < hubs.length; i++) {
        const port = START_PORT + i;
        const connector = i === hubs.length - 1 ? '└──' : '├──';
        console.log(`        ${connector} Hub ${i} (${port})`);
    }
    
    console.log('\nAll hubs are connected through the bootstrap hub.');
    console.log('═'.repeat(60) + '\n');
}

// Main startup sequence
async function startNetwork() {
    try {
        // Start bootstrap hub
        await createBootstrapHub();
        
        // Wait a moment for bootstrap to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Start secondary hubs
        for (let i = 1; i < HUB_COUNT; i++) {
            const port = START_PORT + i;
            await createSecondaryHub(port);
            
            // Small delay between hub starts
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Wait for connections to establish
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Display topology and initial stats
        displayTopology();
        displayNetworkStats();
        
        console.log('✅ Hub network is running!');
        console.log('💡 Press Ctrl+C to stop all hubs\n');
        
        // Periodic stats updates
        setInterval(() => {
            displayNetworkStats();
        }, 30000); // Every 30 seconds
        
    } catch (error) {
        console.error('❌ Failed to start hub network:', error);
        await shutdownNetwork();
        process.exit(1);
    }
}

// Shutdown all hubs
async function shutdownNetwork() {
    console.log('\n\n🛑 Shutting down hub network...\n');
    
    for (let i = 0; i < hubs.length; i++) {
        const port = START_PORT + i;
        const name = i === 0 ? 'Bootstrap' : `Hub-${port}`;
        
        try {
            console.log(`  Stopping ${name}...`);
            await hubs[i].stop();
            console.log(`  ✅ ${name} stopped`);
        } catch (error) {
            console.error(`  ❌ Error stopping ${name}:`, error.message);
        }
    }
    
    console.log('\n✅ All hubs stopped\n');
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
    await shutdownNetwork();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await shutdownNetwork();
    process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught Exception:', error);
    await shutdownNetwork();
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    await shutdownNetwork();
    process.exit(1);
});

// Start the network
startNetwork();
