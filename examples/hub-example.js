/**
 * PeerPigeon Hub Example
 * 
 * This example demonstrates how to set up and use PeerPigeon hubs.
 * Hubs are long-standing servers that:
 * 1. Connect to each other on the 'pigeonhub-mesh' namespace
 * 2. Still serve regular peers in their own networks
 * 3. Can be identified and tracked separately from regular peers
 */

import { PeerPigeonServer } from '../server/index.js';

// Example 1: Create a regular signaling server
async function createRegularServer() {
    const server = new PeerPigeonServer({
        port: 3000,
        host: 'localhost',
        isHub: false // Regular server
    });

    server.on('peerConnected', ({ peerId, totalConnections }) => {
        console.log(`Peer connected: ${peerId.substring(0, 8)}... (Total: ${totalConnections})`);
    });

    server.on('peerAnnounced', ({ peerId, networkName, isHub }) => {
        if (isHub) {
            console.log(`🏢 Hub announced: ${peerId.substring(0, 8)}... on network: ${networkName}`);
        } else {
            console.log(`📱 Peer announced: ${peerId.substring(0, 8)}... on network: ${networkName}`);
        }
    });

    server.on('peerDisconnected', ({ peerId, totalConnections }) => {
        console.log(`Peer disconnected: ${peerId.substring(0, 8)}... (Remaining: ${totalConnections})`);
    });

    await server.start();
    console.log('Regular server started');
    return server;
}

// Example 2: Create a hub server
async function createHubServer() {
    const hubServer = new PeerPigeonServer({
        port: 3001,
        host: 'localhost',
        isHub: true // This is a hub server
    });

    // Listen for hub registration events
    hubServer.on('hubRegistered', ({ peerId, totalHubs }) => {
        console.log(`🏢 New hub registered: ${peerId.substring(0, 8)}... (Total hubs: ${totalHubs})`);
    });

    hubServer.on('hubUnregistered', ({ peerId, totalHubs }) => {
        console.log(`🏢 Hub unregistered: ${peerId.substring(0, 8)}... (Remaining hubs: ${totalHubs})`);
    });

    hubServer.on('peerAnnounced', ({ peerId, networkName, isHub }) => {
        if (isHub) {
            console.log(`🏢 Hub peer announced: ${peerId.substring(0, 8)}... on network: ${networkName}`);
        } else {
            console.log(`📱 Regular peer announced: ${peerId.substring(0, 8)}... on network: ${networkName}`);
        }
    });

    await hubServer.start();
    console.log('Hub server started');
    return hubServer;
}

// Example 3: Get hub statistics
async function displayHubStats(server) {
    const stats = server.getStats();
    const hubStats = server.getHubStats();

    console.log('\n📊 Server Statistics:');
    console.log(`  Is Hub Server: ${stats.isHub}`);
    console.log(`  Total Connections: ${stats.connections}`);
    console.log(`  Total Peers: ${stats.peers}`);
    console.log(`  Total Hubs: ${stats.hubs}`);
    console.log(`  Networks: ${stats.networks}`);
    console.log(`  Uptime: ${Math.floor(stats.uptime / 1000)}s`);

    console.log('\n🏢 Hub Statistics:');
    console.log(`  Total Hubs: ${hubStats.totalHubs}`);
    console.log(`  Connected Hubs: ${hubStats.connectedHubs}`);
    
    if (hubStats.hubs.length > 0) {
        console.log('  Hub List:');
        hubStats.hubs.forEach(hub => {
            console.log(`    - ${hub.peerId.substring(0, 8)}... (network: ${hub.networkName})`);
        });
    }
}

// Example 4: Client-side hub announcement
function clientAnnounceAsHub() {
    // When a client connects to the signaling server and wants to identify as a hub:
    const announceMessage = {
        type: 'announce',
        networkName: 'pigeonhub-mesh', // Special namespace for hubs
        data: {
            isHub: true, // Identify as a hub
            // Add any additional hub metadata
            hubVersion: '1.0.0',
            capabilities: ['signaling', 'relay', 'storage']
        }
    };
    
    // Send this message via WebSocket
    // ws.send(JSON.stringify(announceMessage));
    
    console.log('Hub announcement message:', announceMessage);
}

// Example 5: Client-side regular peer announcement
function clientAnnounceAsPeer() {
    // When a regular peer connects:
    const announceMessage = {
        type: 'announce',
        networkName: 'my-app-network', // Regular application network
        data: {
            isHub: false, // Or omit this field
            // Add any peer metadata
            peerType: 'browser',
            capabilities: ['messaging', 'video']
        }
    };
    
    // Send this message via WebSocket
    // ws.send(JSON.stringify(announceMessage));
    
    console.log('Peer announcement message:', announceMessage);
}

// Example 6: Discover other hubs
function discoverOtherHubs() {
    // When a hub announces on 'pigeonhub-mesh', it will receive notifications about other hubs
    // Listen for 'peer-discovered' messages where isHub === true
    
    console.log(`
When a hub connects to the signaling server and announces on 'pigeonhub-mesh':
1. It will receive a list of all other hubs already on that network
2. All other hubs will be notified about this new hub
3. The server tracks all hubs separately from regular peers
4. Hubs can then establish WebRTC connections to each other
    `);
}

// Main execution
async function main() {
    console.log('=== PeerPigeon Hub Example ===\n');

    // Create servers
    console.log('Creating servers...\n');
    const regularServer = await createRegularServer();
    const hubServer = await createHubServer();

    // Display stats after a moment
    setTimeout(async () => {
        console.log('\n--- Regular Server Stats ---');
        await displayHubStats(regularServer);
        
        console.log('\n--- Hub Server Stats ---');
        await displayHubStats(hubServer);

        console.log('\n--- Client Examples ---');
        clientAnnounceAsHub();
        clientAnnounceAsPeer();
        discoverOtherHubs();

        // Cleanup
        console.log('\n\nShutting down servers...');
        await regularServer.stop();
        await hubServer.stop();
        console.log('Done!');
    }, 2000);
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { createRegularServer, createHubServer, displayHubStats };
