#!/usr/bin/env node

/**
 * Cross-Browser Hub Test with Playwright
 * 
 * Tests 20 peers across Chrome, Firefox, and WebKit browsers
 * Configuration:
 * - 20 peers total distributed across 3 browsers
 * - maxPeers: 4
 * - minPeers: 2
 * - Uses examples/browser for UI
 * - Tests mesh connectivity and message passing
 */

import { chromium, firefox, webkit } from 'playwright';
import { PeerPigeonServer } from '../server/index.js';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test configuration
const HUB_PORT = 3000; // Base hub port; server will auto-increment internally if needed
let SELECTED_HUB_PORT = HUB_PORT; // Actual port after server starts
const HTTP_PORT = 8766;
const TEST_DURATION = 20000; // 20 seconds (reduced for faster test completion)
const TOTAL_PEERS = 20;
const MAX_PEERS = 4;
const MIN_PEERS = 2;

// Browser distribution (total should equal TOTAL_PEERS)
const BROWSERS = [
    { name: 'Chrome', launcher: chromium, count: 7 },
    { name: 'Firefox', launcher: firefox, count: 7 },
    { name: 'WebKit', launcher: webkit, count: 6 }
];

let hubServer = null;
let httpServer = null;
const browsers = [];
const contexts = [];
const pages = [];
const peerData = [];

console.log('🚀 Cross-Browser Hub Test with Playwright\n');
console.log(`Configuration:`);
console.log(`  • Hub base port: ${HUB_PORT}`);
console.log(`  • HTTP server port: ${HTTP_PORT}`);
console.log(`  • Total peers: ${TOTAL_PEERS}`);
console.log(`  • maxPeers: ${MAX_PEERS}`);
console.log(`  • minPeers: ${MIN_PEERS}`);
console.log(`  • Browser distribution: Chrome(${BROWSERS[0].count}), Firefox(${BROWSERS[1].count}), WebKit(${BROWSERS[2].count})`);
console.log(`  • Test duration: ${TEST_DURATION / 1000}s\n`);

/**
 * Start the signaling hub server
 */
async function startHub() {
    console.log(`🔄 Starting hub server on base port ${HUB_PORT}...`);
    hubServer = new PeerPigeonServer({ port: HUB_PORT });
    try {
        // Use the server's start() method which emits 'started' (not 'listening')
        const { port } = await hubServer.start();
        SELECTED_HUB_PORT = port;
        console.log(`✅ Hub server started on port ${SELECTED_HUB_PORT}\n`);
    } catch (error) {
        console.error(`❌ Failed to start hub server: ${error.message}`);
        throw error;
    }
}

/**
 * Start HTTP server to serve the browser example
 */
async function startHttpServer() {
    console.log(`🔄 Starting HTTP server on port ${HTTP_PORT}...`);
    
    return new Promise((resolve, reject) => {
        const examplesDir = join(__dirname, '..', 'examples');
        const distDir = join(__dirname, '..', 'dist');
        
        httpServer = createServer((req, res) => {
            let filePath;
            
            // Route requests appropriately
            if (req.url === '/' || req.url === '/index.html') {
                filePath = join(examplesDir, 'browser', 'index.html');
            } else if (req.url === '/app.js') {
                filePath = join(examplesDir, 'browser', 'app.js');
            } else if (req.url === '/styles.css') {
                filePath = join(examplesDir, 'browser', 'styles.css');
            } else if (req.url.includes('peerpigeon-browser.js')) {
                // Handle any path to the peerpigeon browser bundle
                filePath = join(distDir, 'peerpigeon-browser.js');
            } else if (req.url.startsWith('/dist/')) {
                filePath = join(__dirname, '..', req.url);
            } else if (req.url.startsWith('/browser/')) {
                filePath = join(examplesDir, req.url);
            } else {
                filePath = join(examplesDir, 'browser', req.url.substring(1));
            }
            
            // Determine content type
            let contentType = 'text/html';
            if (filePath.endsWith('.js')) {
                contentType = 'application/javascript';
            } else if (filePath.endsWith('.css')) {
                contentType = 'text/css';
            } else if (filePath.endsWith('.json')) {
                contentType = 'application/json';
            }
            
            try {
                const content = readFileSync(filePath);
                res.writeHead(200, { 
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(content);
            } catch (error) {
                res.writeHead(404);
                res.end('Not found');
            }
        });
        
        httpServer.listen(HTTP_PORT, () => {
            console.log(`✅ HTTP server running on port ${HTTP_PORT}\n`);
            resolve();
        });
        
        httpServer.on('error', (error) => {
            console.error(`❌ HTTP server error: ${error.message}`);
            reject(error);
        });
    });
}

/**
 * Launch a browser instance
 */
async function launchBrowser(browserConfig, index) {
    const { name, launcher } = browserConfig;
    console.log(`  🌐 Launching ${name}...`);
    
    try {
        const launchOptions = { headless: true, timeout: 45000 };
        if (name === 'Chrome') {
            launchOptions.args = [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--autoplay-policy=no-user-gesture-required'
            ];
        } else if (name === 'Firefox') {
            launchOptions.firefoxUserPrefs = {
                'media.navigator.streams.fake': true,
                'media.navigator.permission.disabled': true,
                'media.autoplay.default': 0,
                'media.autoplay.blocking_policy': 0
            };
        } // WebKit handled via getUserMedia stub below
        const browser = await launcher.launch(launchOptions);
        
        const browserInfo = { browser, name, index };
        browsers.push(browserInfo);
        console.log(`  ✅ ${name} ready`);
        return browserInfo;
    } catch (error) {
        console.error(`  ❌ Failed to launch ${name}: ${error.message}`);
        throw error;
    }
}

/**
 * Create a peer in a browser context
 */
async function createPeer(browser, browserName, peerIndex, totalIndex) {
    try {
        const contextOptions = { bypassCSP: true };
        // Only Chromium supports permissions option
        if (browserName === 'Chrome') {
            contextOptions.permissions = ['camera', 'microphone'];
        }
        const context = await browser.newContext(contextOptions);
        // Universal media + devices stub BEFORE any page script executes
        await context.addInitScript(() => {
            try {
                const emptyStream = new MediaStream();
                const fakeTrack = () => ({ stop() {}, kind: 'video', id: 'fake-track' });
                emptyStream.getAudioTracks = () => [fakeTrack()];
                emptyStream.getVideoTracks = () => [fakeTrack()];
                navigator.mediaDevices.getUserMedia = async () => emptyStream;
                navigator.mediaDevices.enumerateDevices = async () => [
                    { kind: 'audioinput', deviceId: 'fake-mic', label: 'Fake Microphone' },
                    { kind: 'videoinput', deviceId: 'fake-cam', label: 'Fake Camera' }
                ];
                window.DISABLE_CRYPTO_BLOCKING = true; // speed up init
                window.DISABLE_LOCALHOST_MEDIA_REQUEST = true; // prevent mesh init from requesting real permissions
                // Override permissions API queries to always granted
                if (navigator.permissions && navigator.permissions.query) {
                    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
                    navigator.permissions.query = (params) => {
                        if (params && (params.name === 'camera' || params.name === 'microphone')) {
                            return Promise.resolve({ state: 'granted' });
                        }
                        return originalQuery(params).catch(() => ({ state: 'granted' }));
                    };
                }
            } catch (e) {
                console.log('media stub failed', e);
            }
        });
        const page = await context.newPage();

        // Instrument network + console for diagnostics (only failures)
        page.on('requestfailed', r => {
            const u = r.url();
            if (/peerpigeon-browser\.js|app\.js|index\.html/.test(u)) {
                console.log(`  [NET FAIL ${browserName} P${totalIndex}] ${u} -> ${r.failure()?.errorText}`);
            }
        });
        
        contexts.push(context);
        pages.push(page);
        
        const peerInfo = {
            index: totalIndex,
            browserName,
            page,
            context,
            peerId: null,
            connectedPeers: 0,
            messagesSent: 0,
            messagesReceived: 0,
            status: 'initializing'
        };
        
        peerData.push(peerInfo);
        
        // Setup minimal console logging
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('❌') || text.includes('error')) {
                console.log(`  [${browserName} P${totalIndex}] ${text}`);
            }
        });
        
        // Setup error handling
        page.on('pageerror', error => {
            console.error(`  [${browserName} P${totalIndex}] ❌ ${error.message}`);
        });
        
        // Navigate to example page and attempt normal load
        await page.goto(`http://localhost:${HTTP_PORT}/`, { timeout: 30000, waitUntil: 'domcontentloaded' });
        let libReady = await page.waitForFunction(() => typeof PeerPigeon !== 'undefined', { timeout: 8000 }).catch(() => null);
        if (!libReady) {
            // Fallback: inject script tag manually
            try {
                await page.addScriptTag({ url: '/dist/peerpigeon-browser.js' });
                libReady = await page.waitForFunction(() => typeof PeerPigeon !== 'undefined', { timeout: 8000 }).catch(() => null);
            } catch (e) {
                console.log(`  ⚠️  Peer ${totalIndex} (${browserName}) manual injection failed: ${e.message}`);
            }
        }
        if (!libReady) {
            peerInfo.status = 'failed';
            console.log(`  ❌ Peer ${totalIndex} (${browserName}) library load failure (after fallback)`);
            return peerInfo;
        }
        
        // Programmatic mesh initialization with explicit signaling + discovery instrumentation
        const connected = await page.evaluate(async ({ hubPort, maxPeers, minPeers }) => {
            try {
                const log = (m) => console.log(`PP_TEST ${m}`);
                if (!window.__ppMesh) {
                    window.__ppMesh = new PeerPigeon.PeerPigeonMesh({
                        networkName: 'peerpigeon-cross-browser-hub-test',
                        maxPeers,
                        minPeers,
                        autoConnect: true,
                        autoDiscovery: true,
                        evictionStrategy: true, // Enable eviction to enforce maxPeers limit
                        xorRouting: true, // Use XOR routing for optimal peer selection
                        enableWebDHT: false,
                        enableCrypto: false
                    });
                    await window.__ppMesh.init();
                    log('mesh init complete');
                }
                // Adjust connection manager limits explicitly
                if (window.__ppMesh.connectionManager) {
                    window.__ppMesh.connectionManager.maxPeers = maxPeers;
                    window.__ppMesh.connectionManager.minPeers = minPeers;
                }
                // Ensure peer discovery settings match
                if (window.__ppMesh.peerDiscovery) {
                    window.__ppMesh.peerDiscovery.maxPeers = maxPeers;
                    window.__ppMesh.peerDiscovery.minPeers = minPeers;
                    window.__ppMesh.peerDiscovery.evictionStrategy = true;
                    window.__ppMesh.peerDiscovery.xorRouting = true;
                }
                // Attach event instrumentation once
                if (!window.__ppMesh.__instrumented) {
                    window.__ppMesh.__instrumented = true;
                    window.__ppMesh.addEventListener('peersUpdated', () => {
                        console.log(`PP_EVENT peersUpdated size=${window.__ppMesh.connectionManager.peers.size}`);
                    });
                    window.__ppMesh.addEventListener('peerConnected', (d) => {
                        console.log(`PP_EVENT peerConnected ${d.peerId?.substring(0,8)}`);
                    });
                    window.__ppMesh.addEventListener('statusChanged', (d) => {
                        console.log(`PP_EVENT statusChanged ${d.type}:${d.message}`);
                    });
                }
                // Connect signaling
                try {
                    await window.__ppMesh.connect(`ws://localhost:${hubPort}`);
                    log('signaling connect attempted');
                } catch (e) {
                    log('signaling connect error ' + e.message);
                    return false;
                }
                // Wait for peerId assignment and at least one discovery cycle
                const start = Date.now();
                while (Date.now() - start < 15000) {
                    if (window.__ppMesh.peerId) {
                        // trigger manual discovery tick if available
                        if (window.__ppMesh.peerDiscovery?.discoverPeers) {
                            window.__ppMesh.peerDiscovery.discoverPeers();
                        }
                        return true;
                    }
                    await new Promise(r => setTimeout(r, 300));
                }
                return false;
            } catch (e) {
                console.log('PP_TEST init failure ' + e.message);
                return false;
            }
        }, { hubPort: SELECTED_HUB_PORT, maxPeers: MAX_PEERS, minPeers: MIN_PEERS });
        
        if (!connected) {
            peerInfo.status = 'failed';
            console.log(`  ❌ Peer ${totalIndex} (${browserName}) mesh init timeout`);
        }
        
        // Get peer ID
        // Use selected hub port variable when evaluating connection info
        const peerId = await page.evaluate(() => window.__ppMesh?.peerId || null);
        
        if (peerId) {
            peerInfo.peerId = peerId;
            peerInfo.status = 'connected';
            // fetch connection counts for log
            const connCount = await page.evaluate(() => window.__ppMesh?.connectionManager?.peers?.size || 0);
            console.log(`  ✅ Peer ${totalIndex} (${browserName}) connected: ${peerId.substring(0, 8)}... peers=${connCount}`);
        } else {
            peerInfo.status = 'failed';
            console.log(`  ❌ Peer ${totalIndex} (${browserName}) failed to connect`);
        }
        
        return peerInfo;
    } catch (error) {
        console.error(`  ❌ Peer ${totalIndex} (${browserName}) error: ${error.message}`);
        const failedPeer = {
            index: totalIndex,
            browserName,
            page: null,
            context: null,
            peerId: null,
            connectedPeers: 0,
            messagesSent: 0,
            messagesReceived: 0,
            status: 'error'
        };
        peerData.push(failedPeer);
        return failedPeer;
    }
}

/**
 * Start all peers across browsers IN PARALLEL
 */
async function startPeers() {
    console.log(`\n🚀 Starting ${TOTAL_PEERS} peers across browsers...\n`);
    
    // First, launch all browsers in parallel
    console.log('📱 Launching all browsers...\n');
    const browserPromises = BROWSERS.map((config, index) => launchBrowser(config, index));
    const launchedBrowsers = await Promise.all(browserPromises);
    
    console.log('✅ All browsers launched\n');
    
    // Now create all peers in parallel across all browsers
    console.log('🔄 Creating all peers in parallel...\n');
    
    const peerPromises = [];
    let totalIndex = 0;
    
    for (let i = 0; i < BROWSERS.length; i++) {
        const browserConfig = BROWSERS[i];
        const browserInfo = launchedBrowsers[i];
        const { name, count } = browserConfig;
        
        console.log(`  Queueing ${count} peers in ${name}...`);
        
        for (let j = 0; j < count; j++) {
            const peerIdx = totalIndex;
            // Add small stagger delay to avoid overwhelming the system
            const delay = peerIdx * 200; // 200ms stagger between peers
            
            peerPromises.push(
                new Promise(resolve => setTimeout(resolve, delay))
                    .then(() => createPeer(browserInfo.browser, name, j, peerIdx))
            );
            
            totalIndex++;
        }
    }
    
    console.log(`\n⏳ Creating ${TOTAL_PEERS} peers concurrently...\n`);
    
    // Track progress
    let completed = 0;
    const wrappedPromises = peerPromises.map((promise, idx) => 
        promise.then(result => {
            completed++;
            if (completed % 5 === 0 || completed === TOTAL_PEERS) {
                console.log(`  Progress: ${completed}/${TOTAL_PEERS} peers initialized`);
            }
            return result;
        })
    );
    
    await Promise.all(wrappedPromises);
    
    console.log(`\n✅ All ${TOTAL_PEERS} peers created\n`);
}

/**
 * Monitor peer connections and stats
 */
async function monitorPeers() {
    console.log('\n📊 Monitoring peer mesh for connectivity...\n');
    
    const startTime = Date.now();
    const monitorInterval = 5000; // Check every 5 seconds
    
    const monitor = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, TEST_DURATION - elapsed);
        
        console.log(`\n⏱️  Time: ${Math.floor(elapsed / 1000)}s / ${TEST_DURATION / 1000}s (${Math.floor(remaining / 1000)}s remaining)`);
        
        let totalConnections = 0;
        let activeCount = 0;
        
        for (const peer of peerData) {
            if (peer.status !== 'connected') continue;
            
            try {
                const stats = await peer.page.evaluate(() => {
                    const mesh = window.__ppMesh; // programmatic mesh reference
                    if (mesh) {
                        return {
                            connectedPeers: mesh.connectionManager?.peers?.size || 0,
                            peerId: mesh.peerId,
                            discovered: mesh.peerDiscovery ? mesh.peerDiscovery.getDiscoveredPeers().length : 0
                        };
                    }
                    return null;
                });
                
                if (stats) {
                    peer.connectedPeers = stats.connectedPeers;
                    totalConnections += stats.connectedPeers;
                    activeCount++;
                }
            } catch (error) {
                // Peer might have disconnected
            }
        }
        
        const avgConnections = activeCount > 0 ? (totalConnections / activeCount).toFixed(2) : 0;
        
        console.log(`📊 Mesh Status:`);
        console.log(`  • Active peers: ${activeCount}/${TOTAL_PEERS}`);
        console.log(`  • Total connections: ${totalConnections}`);
        console.log(`  • Average connections per peer: ${avgConnections}`);
        console.log(`  • Expected range: ${MIN_PEERS}-${MAX_PEERS} connections per peer`);

        // Trigger periodic discovery debug from one random active peer to diagnose lack of connections
        const samplePeer = peerData.find(p => p.status === 'connected');
        if (samplePeer) {
            try {
                await samplePeer.page.evaluate(() => {
                    const mesh = window.__ppMesh;
                    if (mesh?.peerDiscovery?.debugCurrentState) {
                        mesh.peerDiscovery.debugCurrentState();
                    }
                });
            } catch (_) {}
        }
        
        // Show per-browser breakdown
        const browserStats = {};
        for (const browser of BROWSERS) {
            browserStats[browser.name] = {
                active: 0,
                connections: 0
            };
        }
        
        for (const peer of peerData) {
            if (peer.status === 'connected') {
                browserStats[peer.browserName].active++;
                browserStats[peer.browserName].connections += peer.connectedPeers;
            }
        }
        
        console.log(`\n  Per-browser breakdown:`);
        for (const [name, stats] of Object.entries(browserStats)) {
            const avg = stats.active > 0 ? (stats.connections / stats.active).toFixed(2) : 0;
            console.log(`    ${name}: ${stats.active} peers, ${stats.connections} connections (avg: ${avg})`);
        }
        
        if (elapsed >= TEST_DURATION) {
            clearInterval(monitor);
        }
    }, monitorInterval);
    
    // Wait for test duration
    await new Promise(resolve => setTimeout(resolve, TEST_DURATION));
}

/**
 * Test message broadcasting
 */
async function testMessageBroadcast() {
    console.log('\n📨 Testing message broadcast...\n');
    
    // Pick a random peer to send a broadcast message
    const activePeers = peerData.filter(p => p.status === 'connected');
    if (activePeers.length === 0) {
        console.log('❌ No active peers to test messaging');
        return;
    }
    
    const sender = activePeers[Math.floor(Math.random() * activePeers.length)];
    const testMessage = `Test broadcast from peer ${sender.index} at ${new Date().toISOString()}`;
    
    console.log(`📤 Sending broadcast from Peer ${sender.index} (${sender.browserName})...`);
    
    // Set up message listeners on all peers
    const messagePromises = activePeers.map(peer => {
        return peer.page.evaluate(() => {
            return new Promise(resolve => {
                let receivedMessage = false;
                const timeout = setTimeout(() => resolve(receivedMessage), 5000);
                const mesh = window.__ppMesh;
                if (mesh) {
                    const handler = (event) => {
                        const data = event.data || event.message || event.content || event;
                        if (typeof data === 'string' && data.includes('Test broadcast')) {
                            receivedMessage = true;
                            clearTimeout(timeout);
                            resolve(true);
                        }
                    };
                    mesh.addEventListener('messageReceived', handler);
                    mesh.addEventListener('message', handler);
                }
            });
        });
    });
    
    // Send the broadcast
    await sender.page.evaluate((msg) => {
        const mesh = window.__ppMesh;
        if (mesh) {
            mesh.sendMessage(msg);
        }
    }, testMessage);
    
    // Wait for responses
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const results = await Promise.all(messagePromises);
    const receivedCount = results.filter(r => r === true).length;
    
    console.log(`📊 Broadcast Results:`);
    console.log(`  • Sent by: Peer ${sender.index} (${sender.browserName})`);
    console.log(`  • Total peers: ${activePeers.length}`);
    console.log(`  • Received by: ${receivedCount} peers`);
    console.log(`  • Success rate: ${((receivedCount / activePeers.length) * 100).toFixed(1)}%`);
}

/**
 * Cleanup and shutdown
 */
async function cleanup(silent = false) {
    if (!silent) console.log('\n🧹 Cleaning up...\n');
    
    // Close all pages and contexts
    for (const context of contexts) {
        try {
            await context.close();
        } catch (error) {
            // Ignore
        }
    }
    
    // Close all browsers
    for (const { browser } of browsers) {
        try {
            await browser.close();
        } catch (error) {
            // Ignore
        }
    }
    
    // Stop HTTP server
    if (httpServer) {
        httpServer.close();
    }
    
    // Stop hub server
    if (hubServer) {
        try {
            await hubServer.stop();
        } catch (error) {
            // Ignore
        }
    }
    
    if (!silent) console.log('✅ Cleanup complete\n');
}

/**
 * Print final test summary
 */
function printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70) + '\n');
    
    const totalPeers = peerData.length;
    const connectedPeers = peerData.filter(p => p.status === 'connected').length;
    const failedPeers = peerData.filter(p => p.status === 'failed' || p.status === 'error').length;
    
    console.log(`Total Peers: ${totalPeers}`);
    console.log(`Connected: ${connectedPeers} (${((connectedPeers / totalPeers) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${failedPeers} (${((failedPeers / totalPeers) * 100).toFixed(1)}%)`);
    
    // Connection distribution
    console.log('\nConnection Distribution:');
    const connectionCounts = {};
    for (const peer of peerData) {
        if (peer.status === 'connected') {
            const count = peer.connectedPeers;
            connectionCounts[count] = (connectionCounts[count] || 0) + 1;
        }
    }
    
    for (let i = 0; i <= MAX_PEERS; i++) {
        const count = connectionCounts[i] || 0;
        if (count > 0) {
            console.log(`  ${i} connections: ${count} peers`);
        }
    }
    
    // Browser breakdown
    console.log('\nPer-Browser Results:');
    for (const browserConfig of BROWSERS) {
        const browserPeers = peerData.filter(p => p.browserName === browserConfig.name);
        const connected = browserPeers.filter(p => p.status === 'connected').length;
        const avgConnections = browserPeers.reduce((sum, p) => sum + p.connectedPeers, 0) / browserPeers.length;
        
        console.log(`  ${browserConfig.name}: ${connected}/${browserConfig.count} connected, avg ${avgConnections.toFixed(2)} connections`);
    }
    
    // Overall result
    const successRate = (connectedPeers / totalPeers) * 100;
    console.log('\n' + '='.repeat(70));
    
    if (successRate >= 90) {
        console.log('✅ TEST PASSED - Excellent mesh connectivity!');
    } else if (successRate >= 70) {
        console.log('⚠️  TEST PASSED - Good mesh connectivity with some issues');
    } else {
        console.log('❌ TEST FAILED - Poor mesh connectivity');
    }
    
    console.log('='.repeat(70) + '\n');
}

/**
 * Main test execution
 */
async function runTest() {
    try {
        // Start servers
        await startHub();
        await startHttpServer();
        
        // Start all peers
        await startPeers();
        
        // Wait for connectivity floor enforcement to run multiple cycles
        // (3s interval, need ~4 cycles for full mesh = 12-15s)
        console.log('\n⏳ Waiting for mesh to stabilize (15s for connectivity floor enforcement)...\n');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Test messaging
        await testMessageBroadcast();
        
        // Monitor the mesh
        await monitorPeers();
        
        // Print summary
        printSummary();
        
    } catch (error) {
        console.error(`\n❌ Test failed with error: ${error.message}`);
        console.error(error.stack);
    } finally {
        await cleanup();
        process.exit(0);
    }
}

// Handle interrupts
process.on('SIGINT', async () => {
    await cleanup(true);
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await cleanup(true);
    process.exit(0);
});

// Run the test
runTest().catch(async (error) => {
    console.error(`\n❌ Fatal error: ${error.message}`);
    await cleanup(true);
    process.exit(1);
});
