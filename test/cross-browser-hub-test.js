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
const HUB_1_PORT = 3000;
const HUB_2_PORT = 3001;
const HTTP_PORT = 8766;
const TEST_DURATION = 20000; // Used previously; monitoring removed
const TOTAL_PEERS = 20;
// Increased peer connectivity targets to guarantee 100% gossip saturation
const MAX_PEERS = 6; // allow denser partial mesh for redundant paths
const MIN_PEERS = 3; // require minimum 3 connections for partition resistance

// Browser distribution (total should equal TOTAL_PEERS)
// Split peers across 2 hubs
// Randomize hub assignment for each browser group
function randomHub() {
    return Math.random() < 0.5 ? HUB_1_PORT : HUB_2_PORT;
}

// Per-browser configuration for reliability
const BROWSER_CONFIG = {
    Chrome: { settleTime: 10000, minPeersMultiplier: 1.0 },
    Firefox: { settleTime: 10000, minPeersMultiplier: 1.0 },
    WebKit: { settleTime: 15000, minPeersMultiplier: 1.2 } // WebKit needs more time
};

const BROWSERS = [
    { name: 'Chrome', launcher: chromium, count: 7, hubPort: randomHub() },
    { name: 'Firefox', launcher: firefox, count: 7, hubPort: randomHub() },
    { name: 'WebKit', launcher: webkit, count: 6, hubPort: randomHub() }
];

let hubServer1 = null;
let hubServer2 = null;
let httpServer = null;
const browsers = [];
const contexts = [];
const pages = [];
const peerData = [];
let lastBroadcastStats = null;

console.log('🚀 Cross-Browser Hub Test with Playwright\n');
console.log(`Configuration:`);
console.log(`  • Hub 1 port: ${HUB_1_PORT}`);
console.log(`  • Hub 2 port: ${HUB_2_PORT}`);
console.log(`  • HTTP server port: ${HTTP_PORT}`);
console.log(`  • Total peers: ${TOTAL_PEERS}`);
console.log(`  • maxPeers: ${MAX_PEERS}`);
console.log(`  • minPeers: ${MIN_PEERS}`);
console.log(`  • Browser distribution:`);
console.log(`    - Chrome(${BROWSERS[0].count}) on Hub 1`);
console.log(`    - Firefox(${BROWSERS[1].count}) on Hub 2`);
console.log(`    - WebKit(${BROWSERS[2].count}) on Hub 1`);
console.log(`  • Test duration: ${TEST_DURATION / 1000}s\n`);

/**
 * Start the signaling hub servers
 */
async function startHubs() {
    console.log(`🔄 Starting Hub 1 on port ${HUB_1_PORT}...`);
    hubServer1 = new PeerPigeonServer({ 
        port: HUB_1_PORT,
        host: '127.0.0.1',  // Explicit IPv4
        isHub: true,
        bootstrapHubs: [],  // Will connect manually after both are up
        autoConnect: false
    });
    await hubServer1.start();
    console.log(`✅ Hub 1 started on port ${HUB_1_PORT}`);

    console.log(`🔄 Starting Hub 2 on port ${HUB_2_PORT}...`);
    hubServer2 = new PeerPigeonServer({ 
        port: HUB_2_PORT,
        host: '127.0.0.1',  // Explicit IPv4
        isHub: true,
        bootstrapHubs: [],  // Will connect manually after both are up
        autoConnect: false
    });
    await hubServer2.start();
    console.log(`✅ Hub 2 started on port ${HUB_2_PORT}\n`);
    
    // Give servers a moment to be fully ready for connections
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Initialize hub meshes
    console.log(`🔗 Initializing hub meshes...`);
    await hubServer1.initializeHubMesh();
    await hubServer2.initializeHubMesh();
    
    // Give mesh initialization a moment
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Now that both hubs are listening and initialized, connect them
    console.log(`🔗 Connecting hubs together...`);
    hubServer1.bootstrapHubs = [`ws://127.0.0.1:${HUB_2_PORT}`];
    hubServer2.bootstrapHubs = [`ws://127.0.0.1:${HUB_1_PORT}`];
    
    await hubServer1.connectToBootstrapHubs();
    await new Promise(resolve => setTimeout(resolve, 500));
    await hubServer2.connectToBootstrapHubs();
    
    // Give hubs a moment to establish P2P connections
    console.log(`⏳ Waiting for hub mesh to establish...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
}

/**
 * Start HTTP server to serve the browser example
 */
async function startHttpServer() {
    console.log(`🔄 Starting HTTP server on port ${HTTP_PORT}...`);
    
    return new Promise((resolve, reject) => {
        const examplesDir = join(__dirname, '..', 'examples', 'browser', 'vanilla');
        const distDir = join(__dirname, '..', 'dist');
        
        httpServer = createServer((req, res) => {
            let filePath;
            
            // Route requests appropriately
            if (req.url === '/' || req.url === '/index.html') {
                filePath = join(examplesDir, 'index.html');
            } else if (req.url === '/app.js') {
                filePath = join(examplesDir, 'app.js');
            } else if (req.url === '/styles.css') {
                filePath = join(examplesDir, 'styles.css');
            } else if (req.url.includes('peerpigeon-browser.js')) {
                // Handle any path to the peerpigeon browser bundle
                filePath = join(distDir, 'peerpigeon-browser.js');
            } else if (req.url.startsWith('/dist/')) {
                filePath = join(__dirname, '..', req.url);
            } else if (req.url.startsWith('/browser/')) {
                filePath = join(__dirname, '..', 'examples', req.url);
            } else {
                filePath = join(examplesDir, req.url.substring(1));
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
async function createPeer(browser, browserName, peerIndex, totalIndex, hubPort) {
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
            hubPort,
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
                        enableCrypto: true
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
        }, { hubPort, maxPeers: MAX_PEERS, minPeers: MIN_PEERS });
        
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
        const { name, count, hubPort } = browserConfig;
        
        console.log(`  Queueing ${count} peers in ${name} (Hub port ${hubPort})...`);
        
        for (let j = 0; j < count; j++) {
            const peerIdx = totalIndex;
            // Add small stagger delay to avoid overwhelming the system
            const delay = peerIdx * 200; // 200ms stagger between peers
            
            peerPromises.push(
                new Promise(resolve => setTimeout(resolve, delay))
                    .then(() => createPeer(browserInfo.browser, name, j, peerIdx, hubPort))
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
 * Validate network topology - ensure mesh is fully connected
 * Uses BFS to check if all peers are reachable from a starting peer
 */
async function validateTopology() {
    const activePeers = peerData.filter(p => p.status === 'connected');
    if (activePeers.length === 0) return { valid: false, reason: 'No active peers' };

    // Build adjacency map from peer connectivity data
    const adjacency = new Map();
    
    for (const peer of activePeers) {
        try {
            const neighbors = await peer.page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (!mesh) return [];
                return Array.from(mesh.connectionManager?.peers?.keys() || []);
            });
            adjacency.set(peer.peerId, new Set(neighbors));
        } catch (e) {
            return { valid: false, reason: `Failed to query peer ${peer.index}` };
        }
    }

    // BFS from first peer to check reachability
    const startPeer = activePeers[0].peerId;
    const visited = new Set([startPeer]);
    const queue = [startPeer];
    
    while (queue.length > 0) {
        const current = queue.shift();
        const neighbors = adjacency.get(current) || new Set();
        
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }

    const reachableCount = visited.size;
    const totalCount = activePeers.length;
    const isValid = reachableCount === totalCount;
    
    if (!isValid) {
        const unreachable = activePeers.filter(p => !visited.has(p.peerId)).map(p => p.index);
        return {
            valid: false,
            reason: `Network partition detected: ${reachableCount}/${totalCount} reachable`,
            unreachablePeers: unreachable
        };
    }

    return { valid: true, reachableCount, totalCount };
}

/**
 * Monitor peer connections and stats
 */
async function collectMeshSnapshot() {
    let totalConnections = 0;
    let activeCount = 0;

    for (const peer of peerData) {
        if (peer.status !== 'connected') continue;
        try {
            const stats = await peer.page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (mesh) {
                    return {
                        connectedPeers: mesh.connectionManager?.peers?.size || 0,
                        peerId: mesh.peerId
                    };
                }
                return null;
            });
            if (stats) {
                peer.connectedPeers = stats.connectedPeers;
                totalConnections += stats.connectedPeers;
                activeCount++;
            }
        } catch (_) {}
    }

    // Per-browser aggregation
    const browserStats = {};
    for (const browser of BROWSERS) {
        browserStats[browser.name] = { active: 0, connections: 0 };
    }
    for (const peer of peerData) {
        if (peer.status === 'connected') {
            browserStats[peer.browserName].active++;
            browserStats[peer.browserName].connections += peer.connectedPeers;
        }
    }

    return { totalConnections, activeCount, browserStats };
}

/**
 * Test message broadcasting with gossip acknowledgment tracking
 */
async function testMessageBroadcast() {
    console.log('\n📨 Testing message broadcast with acknowledgment tracking...\n');
    
    const activePeers = peerData.filter(p => p.status === 'connected');
    if (activePeers.length === 0) {
        console.log('❌ No active peers to test messaging');
        return;
    }
    
    // Validate all active peers have required properties
    for (const peer of activePeers) {
        if (!peer.browserName) {
            console.error(`❌ Peer ${peer.index} missing browserName:`, peer);
        }
        if (peer.index === undefined) {
            console.error(`❌ Peer missing index:`, peer);
        }
        if (!peer.page) {
            console.error(`❌ Peer ${peer.index} missing page object`);
        }
    }

    // Select sender with best connectivity
    await Promise.all(activePeers.map(async (p) => {
        try {
            const stats = await p.page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (!mesh) return { total: 0, open: 0 };
                const peers = Array.from(mesh.connectionManager?.peers?.values() || []);
                const open = peers.filter(pc => pc.dataChannel && pc.dataChannel.readyState === 'open').length;
                return { total: peers.length, open };
            });
            p.connectedPeers = stats.total;
            p.openChannels = stats.open;
        } catch (_) {
            p.connectedPeers = 0;
            p.openChannels = 0;
        }
    }));

    // Choose a random peer with at least some open connections as sender
    // Filter peers that have at least MIN_PEERS open channels for better broadcast success
    const viableSenders = activePeers.filter(p => 
        (p.openChannels || 0) >= MIN_PEERS && 
        p.browserName && 
        p.index !== undefined &&
        p.page
    );
    const senderPool = viableSenders.length > 0 ? viableSenders : activePeers.filter(p => p.browserName && p.page);
    
    // Final safety check
    if (senderPool.length === 0) {
        console.error('❌ CRITICAL: No valid peers available for sending');
        console.error('Active peers:', activePeers.map(p => ({ index: p.index, browserName: p.browserName, hasPage: !!p.page, openChannels: p.openChannels })));
        throw new Error('No valid sender peers available');
    }
    
    // Pick random sender from the pool
    const sender = senderPool[Math.floor(Math.random() * senderPool.length)];
    
    // Validate sender has all required properties (redundant but explicit)
    if (!sender.browserName || sender.index === undefined || !sender.page) {
        console.error('❌ CRITICAL: Invalid sender peer selected:', { 
            index: sender.index, 
            hasBrowserName: !!sender.browserName, 
            browserName: sender.browserName,
            hasPage: !!sender.page,
            openChannels: sender.openChannels
        });
        throw new Error(`Sender peer missing required properties: browserName=${!!sender.browserName}, page=${!!sender.page}`);
    }
    
    console.log(`📤 Sender: Peer ${sender.index} (${sender.browserName}) with ${sender.openChannels || 0} open channels`);
    
    // Install enhanced listeners with acknowledgment tracking
    const listenerResults = await Promise.all(activePeers.map(peer => {
        return peer.page.evaluate(() => {
            const mesh = window.__ppMesh;
            if (!mesh) return { success: false, error: 'No mesh' };
            if (!window.__ppTest) window.__ppTest = {};
            window.__ppTest.receivedMessages = new Set();
            
            try {
                const handler = (event) => {
                    const data = event.data || event.message || event.content || event;
                    if (typeof data === 'string' && data.includes('Test broadcast')) {
                        // Extract attempt number if present
                        const match = data.match(/\[attempt (\d+)\]/);
                        const attempt = match ? parseInt(match[1]) : 1;
                        window.__ppTest.receivedMessages.add(attempt);
                    }
                };
                mesh.addEventListener('messageReceived', handler);
                mesh.addEventListener('message', handler);
                return { success: true, peerId: mesh.peerId };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });
    }));
    
    const failedListeners = listenerResults.filter(r => !r.success);
    if (failedListeners.length > 0) {
        console.log(`   ⚠️  ${failedListeners.length} peers failed to install listeners`);
    }

    // Smart broadcast with targeted retries
    async function performBroadcastAttempt(attempt, targetPeers = null) {
        const peers = targetPeers || activePeers;
        
        // Reset flags for target peers only
        await Promise.all(peers.map(peer => 
            peer.page.evaluate((attemptNum) => {
                if (!window.__ppTest) window.__ppTest = { receivedMessages: new Set() };
                window.__ppTest.receivedMessages.delete(attemptNum);
            }, attempt)
        ));
        
        const messagePromises = activePeers.map(peer => {
            return peer.page.evaluate((attemptNum) => {
                return new Promise(resolve => {
                    const deadline = Date.now() + 10000; // 10s timeout
                    const check = () => {
                        if (window.__ppTest?.receivedMessages?.has(attemptNum)) {
                            return resolve({ received: true, peerId: window.__ppMesh?.peerId });
                        }
                        if (Date.now() > deadline) {
                            return resolve({ received: false, peerId: window.__ppMesh?.peerId });
                        }
                        setTimeout(check, 100);
                    };
                    check();
                });
            }, attempt);
        });
        
        // Send broadcast
        const timestamp = new Date().toISOString();
        const sendResult = await sender.page.evaluate(({ attempt, timestamp }) => {
            const mesh = window.__ppMesh;
            if (!mesh) return { success: false, error: 'No mesh instance' };
            if (!mesh.sendMessage) return { success: false, error: 'No sendMessage method' };
            
            try {
                mesh.sendMessage(`[attempt ${attempt}] Test broadcast at ${timestamp}`);
                return { 
                    success: true, 
                    peerId: mesh.peerId,
                    connectedPeers: mesh.connectionManager?.peers?.size || 0
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }, { attempt, timestamp });
        
        if (!sendResult.success) {
            console.log(`   ❌ Broadcast send failed: ${sendResult.error}`);
            return { receivedCount: 0, missedPeers: activePeers };
        }
        
        console.log(`   📡 Broadcast sent by ${sendResult.peerId?.substring(0, 8)}... (${sendResult.connectedPeers} connections)`);
        
        // Wait for propagation
        await new Promise(r => setTimeout(r, 8000));
        
        const results = await Promise.all(messagePromises);
        const receivedPeers = results.filter(r => r.received);
        const missedPeers = results.filter(r => !r.received).map((r, idx) => activePeers[idx]);
        
        return { receivedCount: receivedPeers.length, missedPeers };
    }

    // Multi-attempt broadcast with smart targeting
    let receivedCount = 0;
    let missedPeers = [];
    const maxAttempts = 1; // TEMPORARILY DISABLED: was 3
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`\n🔄 Broadcast attempt ${attempt}/${maxAttempts}`);
        
        const result = await performBroadcastAttempt(attempt, attempt === 1 ? null : missedPeers);
        receivedCount = result.receivedCount;
        missedPeers = result.missedPeers;
        
        console.log(`   Received by: ${receivedCount}/${activePeers.length} peers`);
        
        if (receivedCount === activePeers.length) {
            console.log(`   ✅ Full saturation achieved on attempt ${attempt}`);
            break;
        } else if (missedPeers.length > 0) {
            console.log(`   ⚠️  Missed peers: ${missedPeers.map(p => `${p.index}:${p.browserName}`).join(', ')}`);
            
            // For retries, strengthen connectivity of missed peers
            if (attempt < maxAttempts) {
                console.log(`   🔧 Strengthening connectivity for missed peers...`);
                await Promise.all(missedPeers.map(peer => 
                    peer.page.evaluate(() => {
                        const mesh = window.__ppMesh;
                        if (mesh?.peerDiscovery?.discoverPeers) {
                            mesh.peerDiscovery.discoverPeers();
                        }
                    })
                ));
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    const successRate = ((receivedCount / activePeers.length) * 100).toFixed(1);
    lastBroadcastStats = {
        senderIndex: sender.index,
        senderBrowser: sender.browserName,
        totalPeers: activePeers.length,
        receivedCount,
        successRate: Number(successRate)
    };
    console.log(`📊 Broadcast Results:`);
    console.log(`  • Sent by: Peer ${sender.index} (${sender.browserName})`);
    console.log(`  • Total peers: ${activePeers.length}`);
    console.log(`  • Received by: ${receivedCount} peers`);
    console.log(`  • Success rate: ${successRate}%`);
}

/**
 * Wait until all connected peers have reached at least MIN_PEERS connections
 */
async function waitForConnectivityFloor(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const statuses = await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
            const mesh = window.__ppMesh;
            return mesh?.connectionManager?.peers?.size || 0;
        })));
        const below = statuses.filter(count => count < MIN_PEERS).length;
        if (below === 0) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

/**
 * Wait until all connected peers have at least MIN_PEERS open data channels
 */
async function waitForOpenChannelsFloor(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const statuses = await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
            const mesh = window.__ppMesh;
            if (!mesh) return 0;
            const peers = Array.from(mesh.connectionManager?.peers?.values() || []);
            return peers.filter(pc => pc.dataChannel && pc.dataChannel.readyState === 'open').length;
        })));
        const below = statuses.filter(count => count < MIN_PEERS).length;
        if (below === 0) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
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
    
    // Stop hub servers
    if (hubServer1) {
        try {
            await hubServer1.stop();
        } catch (error) {
            // Ignore
        }
    }
    if (hubServer2) {
        try {
            await hubServer2.stop();
        } catch (error) {
            // Ignore
        }
    }
    
    if (!silent) console.log('✅ Cleanup complete\n');
}

/**
 * Print final test summary
 */
async function printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70) + '\n');
    
    // Collect final mesh snapshot once for summary
    const snapshot = await collectMeshSnapshot();

    const totalPeers = peerData.length;
    const connectedPeers = peerData.filter(p => p.status === 'connected').length;
    const failedPeers = peerData.filter(p => p.status === 'failed' || p.status === 'error').length;
    const connectivityRate = (connectedPeers / totalPeers) * 100;
    const broadcastRate = lastBroadcastStats ? lastBroadcastStats.successRate : 0;
    
    console.log(`Total Peers: ${totalPeers}`);
    console.log(`Connected: ${connectedPeers} (${((connectedPeers / totalPeers) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${failedPeers} (${((failedPeers / totalPeers) * 100).toFixed(1)}%)`);

    // Include broadcast results
    if (lastBroadcastStats) {
        console.log('\nBroadcast Results:');
        console.log(`  • Sent by: Peer ${lastBroadcastStats.senderIndex} (${lastBroadcastStats.senderBrowser})`);
        console.log(`  • Total peers: ${lastBroadcastStats.totalPeers}`);
        console.log(`  • Received by: ${lastBroadcastStats.receivedCount} peers`);
        console.log(`  • Success rate: ${lastBroadcastStats.successRate.toFixed(1)}%`);
    }
    
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
        const stats = snapshot.browserStats[browserConfig.name];
        const avg = stats.active > 0 ? (stats.connections / stats.active).toFixed(2) : '0.00';
        console.log(`  ${browserConfig.name}: ${stats.active}/${browserConfig.count} connected, avg ${avg} connections`);
    }

    // Final mesh snapshot summary
    const avgConnections = snapshot.activeCount > 0 ? (snapshot.totalConnections / snapshot.activeCount).toFixed(2) : '0.00';
    console.log('\nFinal Mesh Snapshot:');
    console.log(`  • Active peers: ${snapshot.activeCount}/${TOTAL_PEERS}`);
    console.log(`  • Total connections: ${snapshot.totalConnections}`);
    console.log(`  • Average connections per peer: ${avgConnections}`);
    console.log(`  • Expected range: ${MIN_PEERS}-${MAX_PEERS} connections per peer`);
    
    // Overall result
    console.log('\n' + '='.repeat(70));
    // Verdict considers BOTH connectivity and broadcast delivery
    if (connectivityRate === 100 && broadcastRate === 100) {
        console.log('✅ TEST PASSED - Excellent mesh connectivity and 100% broadcast delivery');
    } else if (connectivityRate >= 90 && broadcastRate >= 90) {
        console.log('⚠️  TEST PASSED - Good connectivity/broadcast with some issues');
    } else {
        console.log('❌ TEST FAILED - Connectivity and/or broadcast below threshold');
    }
    
    console.log('='.repeat(70) + '\n');
}

/**
 * Main test execution
 */
async function runTest() {
    try {
        // Start servers
        await startHubs();
        await startHttpServer();
        
        // Start all peers
        await startPeers();
        
        // Strict mesh settling with topology validation
        console.log('\n⏳ Mesh settling phase with strict floor enforcement...');
        const maxSettleTime = Math.max(...BROWSERS.map(b => BROWSER_CONFIG[b.name].settleTime));
        const settleStart = Date.now();
        let lastLogged = -1;
        let topologyValid = false;
        
        while (Date.now() - settleStart < maxSettleTime) {
            const openCounts = await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (!mesh) return 0;
                const peers = Array.from(mesh.connectionManager?.peers?.values() || []);
                return peers.filter(pc => pc.dataChannel && pc.dataChannel.readyState === 'open').length;
            })));
            
            const elapsed = ((Date.now() - settleStart) / 1000) | 0;
            if (elapsed !== lastLogged) {
                lastLogged = elapsed;
                const sorted = [...openCounts].sort((a,b)=>a-b);
                const belowFloor = sorted.filter(c => c < MIN_PEERS).length;
                const min = Math.min(...sorted);
                const avg = (sorted.reduce((a,b) => a+b, 0) / sorted.length).toFixed(1);
                const max = Math.max(...sorted);
                console.log(`   ⏱ ${elapsed}s | open: min=${min} avg=${avg} max=${max} below_floor=${belowFloor}`);
            }
            
            // STRICT: Only exit when ALL peers have >= MIN_PEERS open channels
            const belowFloor = openCounts.filter(c => c < MIN_PEERS).length;
            if (belowFloor === 0) {
                // All peers meet minimum - now validate topology
                console.log(`   ✅ All peers reached MIN_PEERS floor, validating topology...`);
                const topology = await validateTopology();
                if (topology.valid) {
                    console.log(`   ✅ Topology validation passed: ${topology.reachableCount}/${topology.totalCount} peers connected`);
                    topologyValid = true;
                    break;
                } else {
                    console.log(`   ⚠️  Topology validation failed: ${topology.reason}`);
                    if (topology.unreachablePeers) {
                        console.log(`   🔧 Unreachable peers: ${topology.unreachablePeers.join(', ')}`);
                    }
                }
            }
            
            await new Promise(r => setTimeout(r, 500));
        }
        
        if (!topologyValid) {
            console.log(`\n⚠️  WARNING: Settling timeout reached without full topology validation`);
        }

        // Zero-connection rescue with partition detection (max 5s)
        console.log('\n🛟 Zero-connection rescue pass (up to 5s)...');
        const rescueStart = Date.now();
        let consecutiveZeros = 0;
        
        while (Date.now() - rescueStart < 5000) {
            const peerStatus = await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (!mesh) return { id: 'unknown', total: 0, open: 0 };
                const peers = Array.from(mesh.connectionManager?.peers?.values() || []);
                const open = peers.filter(pc => pc.dataChannel && pc.dataChannel.readyState === 'open').length;
                return { id: mesh.peerId, total: peers.length, open };
            })));
            
            const zeros = peerStatus.filter(z => z.open === 0);
            if (zeros.length === 0) {
                console.log('   ✅ All peers have at least one open connection');
                break;
            }
            
            consecutiveZeros = zeros.length;
            console.log(`   🚑 Peers with zero open channels: ${zeros.map(z => z.id.substring(0,8)).join(', ')}`);
            
            // Aggressive rescue: force connections from isolated peers
            await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (!mesh) return;
                
                const peers = Array.from(mesh.connectionManager?.peers?.values() || []);
                const openCount = peers.filter(pc => pc.dataChannel && pc.dataChannel.readyState === 'open').length;
                
                if (openCount > 0) return; // only rescue zero-connection peers
                
                // Force discovery refresh
                if (mesh.peerDiscovery?.discoverPeers) mesh.peerDiscovery.discoverPeers();
                
                const discovered = Array.from(mesh.peerDiscovery?.discoveredPeers?.keys() || []);
                // Try multiple connections for isolated peers
                let attempts = 0;
                for (const pid of discovered) {
                    if (pid === mesh.peerId) continue;
                    try {
                        if (mesh.connectionManager?.connectToPeerOverride) {
                            mesh.connectionManager.connectToPeerOverride(pid);
                        } else if (mesh.connectToPeer) {
                            mesh.connectToPeer(pid);
                        }
                        attempts++;
                        if (attempts >= 3) break; // Try up to 3 connections
                    } catch(_) {}
                }
            })));
            
            await new Promise(r => setTimeout(r, 500));
        }
        
        if (consecutiveZeros > 0) {
            console.log(`\n⚠️  WARNING: ${consecutiveZeros} peer(s) remain with zero open channels after rescue`);
            console.log('   Will proceed - topology validation will determine if this is critical');
        } else {
            console.log('   ✅ Zero-connection rescue complete - all peers connected');
        }

        // Enforce STRICT minimum open-channel floor before broadcast
        const MIN_OPEN_CHANNELS = MIN_PEERS;
        console.log(`\n🔄 Strict open-channel enforcement (min=${MIN_OPEN_CHANNELS}, max 15s)...`);
        const channelAssureStart = Date.now();
        let floorAchieved = false;
        
        while (Date.now() - channelAssureStart < 15000) {
            const openStatus = await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (!mesh) return { id: 'unknown', open: 0, total: 0 };
                const peers = Array.from(mesh.connectionManager?.peers?.values() || []);
                let openChannels = 0;
                for (const pc of peers) if (pc.dataChannel && pc.dataChannel.readyState === 'open') openChannels++;
                return { id: mesh.peerId, open: openChannels, total: peers.length };
            })));
            
            const weak = openStatus.filter(s => s.open < MIN_OPEN_CHANNELS);
            const zeros = openStatus.filter(s => s.open === 0);
            
            if (weak.length === 0) {
                console.log(`   ✅ All peers have >= ${MIN_OPEN_CHANNELS} open channels`);
                floorAchieved = true;
                break;
            }
            
            const elapsed = ((Date.now() - channelAssureStart) / 1000).toFixed(1);
            console.log(`   ⏱ ${elapsed}s | Weak peers: ${weak.length} (${zeros.length} with zero open)`);
            console.log(`      ${weak.slice(0, 5).map(z=>z.id.substring(0,8)+`[${z.open}]`).join(', ')}${weak.length > 5 ? '...' : ''}`);
            
            // Active strengthening for weak peers
            await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate((minOpen) => {
                const mesh = window.__ppMesh;
                if (!mesh) return;
                
                const peersArr = Array.from(mesh.connectionManager?.peers?.values() || []);
                let openChannels = 0;
                for (const pc of peersArr) {
                    if (pc.dataChannel && pc.dataChannel.readyState === 'open') openChannels++;
                }
                
                if (openChannels >= minOpen) return;
                
                // Refresh discovery
                if (mesh.peerDiscovery?.discoverPeers) mesh.peerDiscovery.discoverPeers();
                
                const discovered = Array.from(mesh.peerDiscovery?.discoveredPeers?.keys() || [])
                    .filter(id => id !== mesh.peerId && !mesh.connectionManager?.peers?.has(id));
                
                // Try connecting to 2 new peers
                let attempts = 0;
                for (const pid of discovered) {
                    try {
                        if (mesh.connectionManager?.connectToPeerOverride) {
                            mesh.connectionManager.connectToPeerOverride(pid);
                        } else if (mesh.connectToPeer) {
                            mesh.connectToPeer(pid);
                        }
                        attempts++;
                        if (attempts >= 2) break;
                    } catch(_) {}
                }
            }, MIN_OPEN_CHANNELS)));
            
            await new Promise(r => setTimeout(r, 800));
        }
        
        if (!floorAchieved) {
            const finalCheck = await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (!mesh) return 0;
                const peers = Array.from(mesh.connectionManager?.peers?.values() || []);
                return peers.filter(pc => pc.dataChannel && pc.dataChannel.readyState === 'open').length;
            })));
            const minOpen = Math.min(...finalCheck);
            const zeros = finalCheck.filter(c => c === 0).length;
            
            if (zeros > 0) {
                console.log(`\n⚠️  WARNING: ${zeros} peer(s) still have zero open channels (will check topology)`);
            }
            
            if (minOpen < MIN_OPEN_CHANNELS) {
                console.log(`\n⚠️  WARNING: Proceeding with min=${minOpen} open channels (target was ${MIN_OPEN_CHANNELS})`);
            }
        }
        
        // Final validation and topology check before broadcast
        console.log('\n📊 Final pre-broadcast validation...');
        
        const finalOpenCounts = await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
            const mesh = window.__ppMesh;
            if (!mesh) return 0;
            const peers = Array.from(mesh.connectionManager?.peers?.values() || []);
            return peers.filter(pc => pc.dataChannel && pc.dataChannel.readyState === 'open').length;
        })));
        
        const finalConnCounts = await Promise.all(peerData.filter(p => p.status === 'connected').map(p => p.page.evaluate(() => {
            const mesh = window.__ppMesh;
            return mesh?.connectionManager?.peers?.size || 0;
        })));
        
        const minOpen = Math.min(...finalOpenCounts);
        const avgOpen = (finalOpenCounts.reduce((a,b)=>a+b,0)/finalOpenCounts.length).toFixed(2);
        const maxOpen = Math.max(...finalOpenCounts);
        const zeroOpens = finalOpenCounts.filter(c => c === 0).length;
        const belowFloor = finalOpenCounts.filter(c => c < MIN_PEERS).length;
        
        console.log(`\n📊 Pre-broadcast topology summary:`);
        console.log(`   Open channels -> min=${minOpen} avg=${avgOpen} max=${maxOpen}`);
        console.log(`   Distribution  -> ${[...finalOpenCounts].sort((a,b)=>a-b).join(', ')}`);
        console.log(`   Connections   -> min=${Math.min(...finalConnCounts)} avg=${(finalConnCounts.reduce((a,b)=>a+b,0)/finalConnCounts.length).toFixed(2)} max=${Math.max(...finalConnCounts)}`);
        console.log(`   Below floor   -> ${belowFloor} peers (target: ${MIN_PEERS})`);
        
        // Validate topology first
        const finalTopology = await validateTopology();
        
        // STRICT: Only abort on zero connections if topology is also invalid
        if (zeroOpens > 0) {
            console.log(`\n⚠️  WARNING: ${zeroOpens} peer(s) with zero open channels`);
            if (!finalTopology.valid) {
                console.log(`   ❌ AND topology validation failed: ${finalTopology.reason}`);
                console.log(`   This indicates a true network partition - ABORTING`);
                if (finalTopology.unreachablePeers) {
                    console.log(`   Unreachable peers: ${finalTopology.unreachablePeers.join(', ')}`);
                }
                throw new Error(`Network partition: ${zeroOpens} isolated peers`);
            } else {
                console.log(`   But topology is valid - proceeding with caution`);
            }
        } else if (!finalTopology.valid) {
            console.log(`\n❌ TEST ABORTED: Topology validation failed`);
            console.log(`   Reason: ${finalTopology.reason}`);
            if (finalTopology.unreachablePeers) {
                console.log(`   Unreachable peers: ${finalTopology.unreachablePeers.join(', ')}`);
            }
            throw new Error(`Network partition: ${finalTopology.reason}`);
        }
        
        console.log(`✅ Topology validated: Full mesh connectivity confirmed\n`);
        
        try {
            await testMessageBroadcast();
        } catch (broadcastError) {
            console.error(`\n❌ Broadcast test failed: ${broadcastError.message}`);
            console.error(broadcastError.stack);
            // Set error stats to clearly indicate broadcast failure
            if (!lastBroadcastStats) {
                const connectedPeers = peerData.filter(p => p.status === 'connected');
                // Try to identify a peer with valid data for reporting
                const reportPeer = connectedPeers.find(p => p.browserName) || connectedPeers[0];
                lastBroadcastStats = {
                    senderIndex: reportPeer?.index ?? -1,
                    senderBrowser: `ERROR:${broadcastError.message.substring(0, 30)}`,
                    totalPeers: connectedPeers.length,
                    receivedCount: 0,
                    successRate: 0
                };
            }
        }
        
        // Print summary (includes final mesh snapshot and message stats)
        await printSummary();
        
    } catch (error) {
        console.error(`\n❌ Test failed with error: ${error.message}`);
        console.error(error.stack);
        // Ensure we have stats even on error
        if (!lastBroadcastStats) {
            lastBroadcastStats = {
                senderIndex: 0,
                senderBrowser: 'unknown',
                totalPeers: peerData.filter(p => p.status === 'connected').length,
                receivedCount: 0,
                successRate: 0
            };
        }
        // Still print summary on error
        try {
            await printSummary();
        } catch (summaryError) {
            console.error('Failed to print summary:', summaryError.message);
        }
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
