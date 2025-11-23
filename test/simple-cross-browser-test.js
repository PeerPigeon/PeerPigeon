#!/usr/bin/env node

/**
 * Simple Cross-Browser Test - No Playwright freezing
 * Uses puppeteer which we know works
 */

import puppeteer from 'puppeteer';
import { PeerPigeonServer } from '../server/index.js';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HUBS = [
    { port: 3000, name: 'Hub A' },
    { port: 3001, name: 'Hub B' },
    { port: 3002, name: 'Hub C' }
];

const HTTP_PORT = 8765;
const TEST_DURATION = 30000;
const PEER_COUNT = 20;

const hubs = [];
const browsers = [];
const pages = [];

console.log('🚀 Simple Cross-Browser Hub Mesh Test (Puppeteer)\n');
console.log(`  • 3 Hubs on 'pigeonhub-mesh' namespace`);
console.log(`  • ${PEER_COUNT} Peers on 'test-network' namespace`);
console.log(`  • Headless Chrome with fake media\n`);

const TEST_HTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>PeerPigeon Test</title>
</head>
<body>
    <h2>Peer Test</h2>
    <div id="status"></div>
    <script src="/dist/peerpigeon-browser.js"></script>
    <script>
        let mesh = null;
        let peerId = null;
        let connectedPeers = new Set();
        
        async function startPeer(hubUrl, networkName, peerName) {
            try {
                mesh = new window.PeerPigeonMesh({
                    networkName: networkName,
                    maxPeers: 5,
                    autoConnect: true,
                    autoDiscovery: true,
                    xorRouting: true
                });
                
                mesh.on('statusChanged', (event) => {
                    if (event.type === 'initialized') {
                        peerId = event.peerId;
                        console.log('Initialized:', peerId);
                    }
                });
                
                mesh.on('peerConnected', (event) => {
                    connectedPeers.add(event.peerId);
                    console.log('Connected to:', event.peerId, 'Total:', connectedPeers.size);
                });
                
                mesh.on('peerDisconnected', (event) => {
                    connectedPeers.delete(event.peerId);
                });
                
                await mesh.init();
                await mesh.connect(hubUrl);
                
                window.peerStats = {
                    peerId,
                    peerName,
                    hubUrl,
                    networkName,
                    getStats: () => ({
                        peerId,
                        peerName,
                        connectedPeers: connectedPeers.size,
                        isConnected: mesh.connected
                    })
                };
                
                console.log('Peer ready:', peerName);
            } catch (error) {
                console.error('Error:', error.message);
            }
        }
        
        window.startPeer = startPeer;
    </script>
</body>
</html>`;

async function startHub(port, isBootstrap = false) {
    const hub = new PeerPigeonServer({
        port,
        isHub: true,
        hubMeshNamespace: 'pigeonhub-mesh',
        autoConnect: true,
        bootstrapHubs: isBootstrap ? [] : ['ws://localhost:3000'],
        hubMeshMaxPeers: 3
    });
    await hub.start();
    console.log(`✅ Hub ${HUBS.find(h => h.port === port).name} (port ${port})`);
    return hub;
}

async function startHttpServer() {
    return new Promise((resolve) => {
        const server = createServer((req, res) => {
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(TEST_HTML);
            } else if (req.url === '/dist/peerpigeon-browser.js') {
                try {
                    const bundle = readFileSync(join(__dirname, '../dist/peerpigeon-browser.js'));
                    res.writeHead(200, { 'Content-Type': 'application/javascript' });
                    res.end(bundle);
                } catch (error) {
                    res.writeHead(404);
                    res.end('Bundle not found');
                }
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });
        server.listen(HTTP_PORT, () => {
            console.log(`✅ HTTP server (port ${HTTP_PORT})\n`);
            resolve(server);
        });
    });
}

async function cleanup() {
    console.log('\n🧹 Cleaning up...\n');
    for (const page of pages) {
        try { await page.close(); } catch (e) {}
    }
    for (const browser of browsers) {
        try { await browser.close(); } catch (e) {}
    }
    for (const hub of hubs) {
        try { await hub.stop(); } catch (e) {}
    }
}

async function runTest() {
    let httpServer;
    const timeout = setTimeout(() => {
        console.log('\n⏰ TEST TIMEOUT\n');
        cleanup().then(() => process.exit(1));
    }, TEST_DURATION + 20000);
    
    try {
        console.log('📡 Starting servers...\n');
        httpServer = await startHttpServer();
        
        for (let i = 0; i < HUBS.length; i++) {
            const hub = await startHub(HUBS[i].port, i === 0);
            hubs.push(hub);
            await new Promise(r => setTimeout(r, 1000));
        }
        
        console.log('\n⏳ Waiting for hub mesh (10s)...\n');
        await new Promise(r => setTimeout(r, 10000));
        
        console.log('🌐 Launching browser and creating peers...\n');
        
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });
        browsers.push(browser);
        console.log('✅ Browser launched\n');
        
        for (let i = 0; i < PEER_COUNT; i++) {
            const hubIndex = i % HUBS.length;
            const hubPort = HUBS[hubIndex].port;
            const hubName = HUBS[hubIndex].name;
            const peerName = `Peer-${i + 1}-${hubName}`;
            
            try {
                const page = await browser.newPage();
                await page.goto(`http://localhost:${HTTP_PORT}`);
                await page.waitForFunction(() => window.PeerPigeonMesh !== undefined, { timeout: 10000 });
                await page.evaluate(
                    ({ hubUrl, networkName, peerName }) => {
                        return window.startPeer(hubUrl, networkName, peerName);
                    },
                    {
                        hubUrl: `ws://localhost:${hubPort}`,
                        networkName: 'test-network',
                        peerName
                    }
                );
                await page.waitForFunction(() => window.peerStats !== undefined, { timeout: 10000 });
                pages.push(page);
                console.log(`  ✅ ${peerName} → ${hubName}`);
            } catch (error) {
                console.error(`  ❌ ${peerName}: ${error.message}`);
            }
            
            await new Promise(r => setTimeout(r, 300));
        }
        
        console.log(`\n✅ ${pages.length} peers created\n`);
        console.log(`⏳ Running test (${TEST_DURATION / 1000}s)...\n`);
        
        const startTime = Date.now();
        const monitorInterval = setInterval(async () => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            let totalConnections = 0;
            let activePeers = 0;
            
            for (const page of pages) {
                try {
                    const stats = await page.evaluate(() => {
                        return window.peerStats ? window.peerStats.getStats() : null;
                    });
                    if (stats) {
                        totalConnections += stats.connectedPeers;
                        activePeers++;
                    }
                } catch (e) {}
            }
            
            const avgConnections = activePeers > 0 ? (totalConnections / activePeers).toFixed(1) : 0;
            console.log(`📊 [${elapsed}s] ${activePeers} peers, avg ${avgConnections} connections`);
        }, 10000);
        
        await new Promise(r => setTimeout(r, TEST_DURATION));
        clearInterval(monitorInterval);
        
        console.log('\n📊 Collecting final stats...\n');
        let totalConnections = 0;
        let activePeers = 0;
        const byHub = {};
        
        for (const page of pages) {
            try {
                const stats = await page.evaluate(() => {
                    return window.peerStats ? window.peerStats.getStats() : null;
                });
                if (stats) {
                    totalConnections += stats.connectedPeers;
                    activePeers++;
                    
                    const hubPort = stats.hubUrl.split(':').pop();
                    const hubName = HUBS.find(h => h.port === parseInt(hubPort))?.name || 'Unknown';
                    if (!byHub[hubName]) byHub[hubName] = { count: 0, connections: 0 };
                    byHub[hubName].count++;
                    byHub[hubName].connections += stats.connectedPeers;
                }
            } catch (e) {}
        }
        
        const avgConnections = activePeers > 0 ? (totalConnections / activePeers).toFixed(2) : 0;
        
        console.log('═'.repeat(80));
        console.log('                           TEST RESULTS');
        console.log('═'.repeat(80));
        console.log(`Total Peers: ${activePeers}/${pages.length}`);
        console.log(`Average Connections: ${avgConnections}`);
        console.log(`\nBy Hub:`);
        Object.entries(byHub).forEach(([hubName, stats]) => {
            const avg = (stats.connections / stats.count).toFixed(1);
            console.log(`  ${hubName}: ${stats.count} peers, avg ${avg} connections`);
        });
        console.log(`\nArchitecture:`);
        console.log(`  • Hubs: 'pigeonhub-mesh' namespace (P2P relay)`);
        console.log(`  • Peers: 'test-network' namespace (cross-hub)`);
        
        if (activePeers > 0 && avgConnections >= 2) {
            console.log('\n✅ TEST PASSED: Cross-hub mesh working!');
        } else if (totalConnections > 0) {
            console.log('\n⚠️  TEST PARTIAL: Some connections established');
        } else {
            console.log('\n❌ TEST FAILED: No connections');
        }
        console.log('═'.repeat(80) + '\n');
        
        clearTimeout(timeout);
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        clearTimeout(timeout);
    } finally {
        await cleanup();
        if (httpServer) httpServer.close();
        console.log('✅ Test complete\n');
        process.exit(0);
    }
}

process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Interrupted\n');
    await cleanup();
    process.exit(0);
});

runTest();
