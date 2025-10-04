/**
 * Bootstrap Hub Example
 * 
 * This example demonstrates how to set up a network of hubs using bootstrap connections.
 * Hubs automatically connect to each other through the bootstrap hub(s) on port 3000.
 */

import { PeerPigeonServer } from '../server/index.js';

// Example 1: Create the primary bootstrap hub on port 3000
async function createBootstrapHub() {
    console.log('=== Creating Bootstrap Hub (Port 3000) ===\n');
    
    const bootstrapHub = new PeerPigeonServer({
        port: 3000,
        host: 'localhost',
        isHub: true,
        // No bootstrap hubs to connect to - this is the primary hub
        autoConnect: false
    });

    bootstrapHub.on('hubRegistered', ({ peerId, totalHubs }) => {
        console.log(`[Bootstrap] Hub registered: ${peerId.substring(0, 8)}... (Total: ${totalHubs})`);
    });

    bootstrapHub.on('peerConnected', ({ peerId }) => {
        console.log(`[Bootstrap] Peer connected: ${peerId.substring(0, 8)}...`);
    });

    await bootstrapHub.start();
    console.log('[Bootstrap] Hub ready and waiting for connections\n');
    return bootstrapHub;
}

// Example 2: Create a hub that connects to the bootstrap hub (default port 3000)
async function createSecondaryHub(port) {
    console.log(`\n=== Creating Secondary Hub (Port ${port}) ===\n`);
    
    const hub = new PeerPigeonServer({
        port,
        host: 'localhost',
        isHub: true,
        // Automatically connects to port 3000 if not specified
        autoConnect: true
    });

    hub.on('bootstrapConnected', ({ uri }) => {
        console.log(`[Hub ${port}] ✅ Connected to bootstrap hub: ${uri}`);
    });

    hub.on('bootstrapDisconnected', ({ uri, code, reason }) => {
        console.log(`[Hub ${port}] 🔌 Disconnected from ${uri}: ${code} - ${reason}`);
    });

    hub.on('hubDiscovered', ({ peerId, via }) => {
        console.log(`[Hub ${port}] 🏢 Discovered hub ${peerId.substring(0, 8)}... via ${via}`);
    });

    hub.on('hubRegistered', ({ peerId, totalHubs }) => {
        console.log(`[Hub ${port}] Hub registered: ${peerId.substring(0, 8)}... (Total: ${totalHubs})`);
    });

    await hub.start();
    return hub;
}

// Example 3: Create a hub with custom bootstrap URIs
async function createHubWithCustomBootstrap(port, bootstrapUris) {
    console.log(`\n=== Creating Hub with Custom Bootstrap (Port ${port}) ===\n`);
    
    const hub = new PeerPigeonServer({
        port,
        host: 'localhost',
        isHub: true,
        bootstrapHubs: bootstrapUris, // Custom bootstrap hub URIs
        autoConnect: true,
        reconnectInterval: 3000, // Reconnect after 3 seconds
        maxReconnectAttempts: 5  // Try up to 5 times
    });

    hub.on('bootstrapConnected', ({ uri }) => {
        console.log(`[Hub ${port}] ✅ Connected to bootstrap hub: ${uri}`);
    });

    hub.on('bootstrapDisconnected', ({ uri }) => {
        console.log(`[Hub ${port}] 🔌 Lost connection to ${uri}, will retry...`);
    });

    hub.on('hubDiscovered', ({ peerId }) => {
        console.log(`[Hub ${port}] 🏢 Discovered another hub: ${peerId.substring(0, 8)}...`);
    });

    await hub.start();
    return hub;
}

// Example 4: Display hub statistics with bootstrap info
async function displayBootstrapStats(server, name) {
    const stats = server.getStats();
    const hubStats = server.getHubStats();

    console.log(`\n📊 Statistics for ${name}:`);
    console.log(`  Port: ${stats.port}`);
    console.log(`  Hub Peer ID: ${stats.hubPeerId?.substring(0, 8)}...`);
    console.log(`  Total Connections: ${stats.connections}`);
    console.log(`  Registered Hubs: ${stats.hubs}`);
    console.log(`  Bootstrap Connections: ${stats.bootstrapHubs.connected}/${stats.bootstrapHubs.total}`);
    
    if (hubStats.bootstrapHubs.length > 0) {
        console.log(`  Bootstrap Hubs:`);
        hubStats.bootstrapHubs.forEach(hub => {
            const status = hub.connected ? '✅' : '❌';
            console.log(`    ${status} ${hub.uri} (attempts: ${hub.attemptNumber})`);
        });
    }
}

// Example 5: Create a multi-hub network
async function createHubNetwork() {
    console.log('=== Creating Hub Network ===\n');

    // Start bootstrap hub on port 3000
    const bootstrap = await createBootstrapHub();

    // Wait a moment for bootstrap to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start secondary hubs that auto-connect to port 3000
    const hub1 = await createSecondaryHub(3001);
    const hub2 = await createSecondaryHub(3002);
    const hub3 = await createSecondaryHub(3003);

    // Wait for connections to establish
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Display statistics
    await displayBootstrapStats(bootstrap, 'Bootstrap Hub (3000)');
    await displayBootstrapStats(hub1, 'Hub 1 (3001)');
    await displayBootstrapStats(hub2, 'Hub 2 (3002)');
    await displayBootstrapStats(hub3, 'Hub 3 (3003)');

    console.log('\n=== Hub Network Topology ===');
    console.log('Bootstrap Hub (3000)');
    console.log('    ↑');
    console.log('    ├── Hub 1 (3001)');
    console.log('    ├── Hub 2 (3002)');
    console.log('    └── Hub 3 (3003)');

    return { bootstrap, hub1, hub2, hub3 };
}

// Example 6: Multiple bootstrap hubs for redundancy
async function createRedundantHubNetwork() {
    console.log('\n\n=== Creating Redundant Hub Network ===\n');

    // Create two bootstrap hubs
    const bootstrap1 = new PeerPigeonServer({
        port: 3000,
        host: 'localhost',
        isHub: true,
        autoConnect: false
    });
    await bootstrap1.start();

    const bootstrap2 = new PeerPigeonServer({
        port: 3001,
        host: 'localhost',
        isHub: true,
        autoConnect: false
    });
    await bootstrap2.start();

    console.log('Bootstrap hubs started\n');

    // Create a hub that connects to BOTH bootstrap hubs
    const redundantHub = await createHubWithCustomBootstrap(3005, [
        'ws://localhost:3000',
        'ws://localhost:3001'
    ]);

    await new Promise(resolve => setTimeout(resolve, 2000));

    await displayBootstrapStats(redundantHub, 'Redundant Hub (3005)');

    console.log('\n=== Redundant Topology ===');
    console.log('Bootstrap Hub 1 (3000) ←→ Redundant Hub (3005)');
    console.log('Bootstrap Hub 2 (3001) ←→ Redundant Hub (3005)');

    return { bootstrap1, bootstrap2, redundantHub };
}

// Main execution
async function main() {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║   PeerPigeon Bootstrap Hub Example        ║');
    console.log('╚════════════════════════════════════════════╝\n');

    try {
        // Create hub network
        const network = await createHubNetwork();

        // Wait to observe the network
        console.log('\n\nNetwork running... (press Ctrl+C to stop)');
        
        // Optional: Create redundant network after a delay
        setTimeout(async () => {
            try {
                await createRedundantHubNetwork();
            } catch (error) {
                console.error('Error creating redundant network:', error);
            }
        }, 5000);

        // Keep running until interrupted
        process.on('SIGINT', async () => {
            console.log('\n\n🛑 Shutting down hub network...');
            
            await network.bootstrap.stop();
            await network.hub1.stop();
            await network.hub2.stop();
            await network.hub3.stop();
            
            console.log('✅ All hubs stopped');
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Configuration examples
function printConfigurationExamples() {
    console.log('\n\n=== Configuration Examples ===\n');

    console.log('1. Bootstrap Hub (Primary):');
    console.log(`
const bootstrap = new PeerPigeonServer({
    port: 3000,
    isHub: true,
    autoConnect: false  // Don't connect to other hubs
});
    `);

    console.log('2. Secondary Hub (Auto-connect to port 3000):');
    console.log(`
const hub = new PeerPigeonServer({
    port: 3001,
    isHub: true,
    autoConnect: true  // Automatically connects to ws://localhost:3000
});
    `);

    console.log('3. Hub with Custom Bootstrap URIs:');
    console.log(`
const hub = new PeerPigeonServer({
    port: 3002,
    isHub: true,
    bootstrapHubs: [
        'ws://hub1.example.com:3000',
        'ws://hub2.example.com:3000'
    ],
    reconnectInterval: 5000,
    maxReconnectAttempts: 10
});
    `);

    console.log('4. Hub with Custom Peer ID:');
    console.log(`
const hub = new PeerPigeonServer({
    port: 3003,
    isHub: true,
    hubPeerId: 'a1b2c3d4e5f6789012345678901234567890abcd'
});
    `);
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export {
    createBootstrapHub,
    createSecondaryHub,
    createHubWithCustomBootstrap,
    displayBootstrapStats,
    createHubNetwork,
    createRedundantHubNetwork,
    printConfigurationExamples
};
