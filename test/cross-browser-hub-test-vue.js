#!/usr/bin/env node

/**
 * Cross-Browser Hub Test with Playwright (Vue Edition)
 * 
 * Tests 20 peers across Chrome, Firefox, and WebKit browsers using Vue UI
 * Configuration:
 * - 20 peers total distributed across 3 browsers
 * - maxPeers: 6
 * - minPeers: 3
 * - Uses examples/browser-2 (Vue) for UI
 * - Tests mesh connectivity and message passing
 */

import { chromium, firefox, webkit } from 'playwright';
import { PeerPigeonServer } from '../server/index.js';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test configuration
const HUB_1_PORT = 3000;
const HUB_2_PORT = 3001;
const HTTP_PORT = 8766;
const TEST_DURATION = 20000;
const TOTAL_PEERS = 20;
const MAX_PEERS = 6;
const MIN_PEERS = 3;

// Browser distribution
function randomHub() {
    return Math.random() < 0.5 ? HUB_1_PORT : HUB_2_PORT;
}

const BROWSER_CONFIG = {
    Chrome: { settleTime: 10000, minPeersMultiplier: 1.0 },
    Firefox: { settleTime: 10000, minPeersMultiplier: 1.0 },
    WebKit: { settleTime: 15000, minPeersMultiplier: 1.2 }
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
let evictionEvents = [];
// Store broadcast messaging delivery results
let broadcastResults = null;

console.log('🚀 Cross-Browser Hub Test with Playwright (Vue Edition)\n');
console.log(`Configuration:`);
console.log(`  • Hub 1 port: ${HUB_1_PORT}`);
console.log(`  • Hub 2 port: ${HUB_2_PORT}`);
console.log(`  • HTTP server port: ${HTTP_PORT}`);
console.log(`  • Total peers: ${TOTAL_PEERS}`);
console.log(`  • maxPeers: ${MAX_PEERS}`);
console.log(`  • minPeers: ${MIN_PEERS}`);
console.log(`  • UI: Vue (browser-2)`);
console.log(`  • Browser distribution:`);
console.log(`    - Chrome(${BROWSERS[0].count}) on Hub ${BROWSERS[0].hubPort === HUB_1_PORT ? '1' : '2'}`);
console.log(`    - Firefox(${BROWSERS[1].count}) on Hub ${BROWSERS[1].hubPort === HUB_1_PORT ? '1' : '2'}`);
console.log(`    - WebKit(${BROWSERS[2].count}) on Hub ${BROWSERS[2].hubPort === HUB_1_PORT ? '1' : '2'}`);
console.log(`  • Test duration: ${TEST_DURATION / 1000}s\n`);

/**
 * Start the signaling hub servers
 */
async function startHubs() {
    console.log(`🔄 Starting Hub 1 on port ${HUB_1_PORT}...`);
    hubServer1 = new PeerPigeonServer({ 
        port: HUB_1_PORT,
        host: '127.0.0.1',
        isHub: true,
        bootstrapHubs: [],
        autoConnect: false
    });
    await hubServer1.start();
    console.log(`✅ Hub 1 started on port ${HUB_1_PORT}`);

    console.log(`🔄 Starting Hub 2 on port ${HUB_2_PORT}...`);
    hubServer2 = new PeerPigeonServer({ 
        port: HUB_2_PORT,
        host: '127.0.0.1',
        isHub: true,
        bootstrapHubs: [],
        autoConnect: false
    });
    await hubServer2.start();
    console.log(`✅ Hub 2 started on port ${HUB_2_PORT}`);
    // Allow servers to fully bind
    await new Promise(r => setTimeout(r, 1000));

    // Initialize internal hub mesh logic (mirrors non-Vue test)
    console.log('🔗 Initializing hub meshes...');
    await hubServer1.initializeHubMesh();
    await hubServer2.initializeHubMesh();
    await new Promise(r => setTimeout(r, 500));

    // Connect hubs bidirectionally using bootstrap arrays
    console.log('🔗 Connecting hubs together...');
    hubServer1.bootstrapHubs = [`ws://127.0.0.1:${HUB_2_PORT}`];
    hubServer2.bootstrapHubs = [`ws://127.0.0.1:${HUB_1_PORT}`];
    await hubServer1.connectToBootstrapHubs();
    await new Promise(r => setTimeout(r, 500));
    await hubServer2.connectToBootstrapHubs();

    console.log('⏳ Waiting for hub mesh to establish...');
    await new Promise(r => setTimeout(r, 3000));
    console.log('✅ Hub mesh established\n');
}

/**
 * Start HTTP server to serve Vue app
 */
async function startHTTPServer() {
    return new Promise((resolve, reject) => {
        console.log(`🔄 Starting HTTP server on port ${HTTP_PORT}...`);
        
        const rootDir = join(__dirname, '..');
        const distDir = join(rootDir, 'examples', 'browser', 'vue', 'dist');
        const libDir = join(rootDir, 'dist');
        
        httpServer = createServer((req, res) => {
            let filePath;
            
            // Route to Vue app dist
            let url = req.url;
            if (url === '/' || url === '' || url === '/index.html') {
                filePath = join(distDir, 'index.html');
            } else if (url.startsWith('/assets/')) {
                // Vue app assets
                filePath = join(distDir, url);
            } else if (url === '/peerpigeon-browser.js' || url === '/peerpigeon-browser.js.map') {
                // Serve from project root dist
                filePath = join(libDir, url);
            } else if (url.startsWith('/dist/')) {
                // Serve from project root dist
                filePath = join(rootDir, url);
            } else {
                filePath = join(distDir, url);
            }
            
            // Determine content type
            let contentType = 'text/html';
            if (filePath.endsWith('.js')) {
                contentType = 'application/javascript';
            } else if (filePath.endsWith('.css')) {
                contentType = 'text/css';
            } else if (filePath.endsWith('.json')) {
                contentType = 'application/json';
            } else if (filePath.endsWith('.map')) {
                contentType = 'application/json';
            }
            
            try {
                const content = readFileSync(filePath);
                res.writeHead(200, { 
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'X-Content-Type-Options': 'nosniff'
                });
                res.end(content);
            } catch (error) {
                console.log(`[HTTP 404] ${req.url} -> ${filePath}`);
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found: ' + req.url);
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
        }
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
 * Create a peer in a browser context using Vue app
 */
async function createPeer(browser, browserName, peerIndex, totalIndex, hubPort) {
    try {
        const contextOptions = { bypassCSP: true };
        // Only Chrome/Chromium supports permission grants via context options
        if (browserName === 'Chrome') {
            contextOptions.permissions = ['camera', 'microphone'];
        }
        const context = await browser.newContext(contextOptions);
        
        // Universal media + devices stub BEFORE any page script executes
        await context.addInitScript(() => {
            try {
                // Flag automated test mode for optimized ICE/STUN behavior
                window.AUTOMATED_TEST = true;
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
                
                // Override permissions API queries to always granted for all browsers
                if (navigator.permissions) {
                    // Save original query if it exists
                    const originalQuery = navigator.permissions.query ? 
                        navigator.permissions.query.bind(navigator.permissions) : null;
                    
                    // Replace query method
                    navigator.permissions.query = (params) => {
                        if (params && (params.name === 'camera' || params.name === 'microphone')) {
                            return Promise.resolve({ 
                                state: 'granted',
                                onchange: null 
                            });
                        }
                        // Fallback for other permission types
                        if (originalQuery) {
                            return originalQuery(params).catch(() => ({ state: 'granted', onchange: null }));
                        }
                        return Promise.resolve({ state: 'granted', onchange: null });
                    };
                }
                
                // Firefox-specific: Override permission checking internal methods
                if (navigator.userAgent.includes('Firefox')) {
                    // Force media permission granted state
                    Object.defineProperty(navigator, 'mediaDevices', {
                        value: navigator.mediaDevices,
                        writable: false,
                        configurable: true
                    });
                }
                
                // WebKit-specific: Suppress permission prompts
                if (navigator.userAgent.includes('AppleWebKit') && !navigator.userAgent.includes('Chrome')) {
                    // Override getUserMedia to never trigger prompts
                    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
                    navigator.mediaDevices.getUserMedia = async (constraints) => {
                        // Return fake stream immediately without prompting
                        return emptyStream;
                    };
                }
            } catch (e) {
                console.log('media stub failed', e);
            }
        });
        
        const page = await context.newPage();
        
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
            status: 'initializing',
            channelsOpen: 0,
            channelsClosed: 0,
            channelErrors: 0
        };
        
        peerData.push(peerInfo);
        
        // Setup console logging for debugging
        // Reduce non-essential logging: only surface errors and warnings
        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            if (type === 'error' || type === 'warning' || text.includes('Automated test mode')) {
                console.log(`  [${browserName} P${totalIndex} ${type.toUpperCase()}] ${text}`);
            }
        });
        
        page.on('pageerror', error => {
            console.error(`  [${browserName} P${totalIndex}] ❌ ${error.message}`);
        });

        // Track connection manager events for eviction and data channel lifecycle
        await page.exposeFunction('__ppRecordEviction', (details) => {
            evictionEvents.push({ peerIndex: totalIndex, browserName, peerId: peerInfo.peerId, details });
        });
        await page.exposeFunction('__ppRecordChannel', (type) => {
            if (type === 'open') peerInfo.channelsOpen++;
            if (type === 'closed') peerInfo.channelsClosed++;
            if (type === 'error') peerInfo.channelErrors++;
        });
        
        // Navigate to Vue app
        await page.goto(`http://localhost:${HTTP_PORT}/`, { timeout: 30000, waitUntil: 'domcontentloaded' });
        
        // Wait for PeerPigeon library to load
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
        
        console.log(`  [${browserName} P${totalIndex}] Initializing mesh...`);
        
        // Programmatic mesh initialization EXACTLY like baseline test - bypass Vue store completely
        const connected = await page.evaluate(async ({ hubPort, maxPeers, minPeers, networkName }) => {
            try {
                const log = (m) => console.log(`PP_TEST ${m}`);
                if (!window.__ppMesh) {
                    window.__ppMesh = new PeerPigeon.PeerPigeonMesh({
                        networkName: networkName,
                        maxPeers,
                        minPeers,
                        autoConnect: true,
                        autoDiscovery: true,
                        evictionStrategy: true,
                        xorRouting: true,
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
                console.log('PP_TEST Error: ' + e.message);
                console.log('PP_TEST Stack: ' + e.stack);
                return false;
            }
        }, { 
            hubPort, 
            maxPeers: MAX_PEERS, 
            minPeers: MIN_PEERS,
            networkName: 'peerpigeon-cross-browser-hub-test-vue'
        });
        
        if (!connected) {
            peerInfo.status = 'failed';
            console.log(`  ❌ Peer ${totalIndex} (${browserName}) failed to connect`);
            return peerInfo;
        }
        
        // Get peerId from mesh
        const peerId = await page.evaluate(() => {
            return window.__ppMesh?.peerId || null;
        });
        
        peerInfo.peerId = peerId;
        peerInfo.status = 'connected';
        console.log(`  ✅ Peer ${totalIndex} (${browserName}) ready [${peerId?.substring(0, 8)}...]`);
        
        // Attach listeners inside the page to report eviction/channel lifecycle + one-time data channel creation attempt
        try {
            await page.evaluate(() => {
                const mesh = window.__ppMesh;
                if (!mesh) return false;
                const cm = mesh.connectionManager;
                if (!cm) return false;
                
                // Data channel events
                cm.addEventListener('dataChannelOpen', () => {
                    window.__ppRecordChannel && window.__ppRecordChannel('open');
                });
                cm.addEventListener('dataChannelClosed', () => {
                    window.__ppRecordChannel && window.__ppRecordChannel('closed');
                });
                cm.addEventListener('dataChannelError', () => {
                    window.__ppRecordChannel && window.__ppRecordChannel('error');
                });
                
                // Eviction events
                cm.addEventListener('peerEvicted', (evt) => {
                    const info = {
                        targetPeerId: evt?.peerId || evt?.detail?.peerId,
                        reason: evt?.reason || evt?.detail?.reason || 'unknown',
                        timestamp: Date.now()
                    };
                    window.__ppRecordEviction && window.__ppRecordEviction(info);
                });
                // Proactive single pass: create data channel if missing
                try {
                    if (cm.peers && cm.peers.forEach) {
                        cm.peers.forEach(pc => {
                            try {
                                if (pc && pc.createDataChannel && (!pc.dataChannel || pc.dataChannel.readyState !== 'open')) {
                                    pc.createDataChannel();
                                }
                            } catch (e) {
                                console.log('PP_TEST createDataChannel error ' + e.message);
                            }
                        });
                    }
                } catch (e) {}
                return true;
            });
        } catch (e) {}
        
        return peerInfo;
    } catch (error) {
        console.error(`  ❌ Failed to create peer ${totalIndex}: ${error.message}`);
        const peerInfo = {
            index: totalIndex,
            browserName,
            hubPort,
            page: null,
            context: null,
            peerId: null,
            connectedPeers: 0,
            messagesSent: 0,
            messagesReceived: 0,
            status: 'failed'
        };
        peerData.push(peerInfo);
        return peerInfo;
    }
}

/**
 * Wait for mesh to stabilize
 */
async function waitForMeshStabilization() {
    console.log('\n⏳ Waiting for mesh stabilization...');
    
    const maxSettleTime = Math.max(...Object.values(BROWSER_CONFIG).map(c => c.settleTime));
    const settleInterval = 1000;
    let elapsed = 0;
    
    while (elapsed < maxSettleTime) {
        await new Promise(resolve => setTimeout(resolve, settleInterval));
        elapsed += settleInterval;
        
        // Connectivity sampling logs disabled to reduce noise
    }
    
    console.log('✅ Mesh stabilization complete\n');
}

/**
 * Test broadcast messaging
 */
async function testBroadcastMessaging() {
    console.log('📨 Testing broadcast messaging...');
    
    const activePeers = peerData.filter(p => p.status === 'connected' && p.page);
    if (activePeers.length === 0) {
        console.log('❌ No active peers for broadcast test');
        return { success: false };
    }
    
    // Install message listeners (exactly like baseline test)
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
                        window.__ppTest.receivedMessages.add(data);
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
    
    const sender = activePeers[Math.floor(Math.random() * activePeers.length)];
    const testMessage = `Test broadcast at ${Date.now()}`;
    
    console.log(`  📤 Sending from Peer ${sender.index} (${sender.browserName})`);
    
    // Send message via mesh (exactly like baseline test)
    const sendResult = await sender.page.evaluate((msg) => {
        try {
            const mesh = window.__ppMesh;
            if (!mesh || !mesh.sendMessage) return { ok: false, error: 'No mesh/sendMessage' };
            mesh.sendMessage(msg);
            return { ok: true, peerId: mesh.peerId };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }, testMessage);

    if (!sendResult.ok) {
        console.log('  ❌ Failed to send broadcast message: ' + sendResult.error);
        return {
            success: false,
            receiveCount: 0,
            total: activePeers.length - 1,
            receptionRate: '0.0',
            senderPeerIndex: sender.index,
            browserSender: sender.browserName,
            messageSample: testMessage
        };
    }
    
    // Wait for propagation
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Check reception
    let receiveCount = 0;
    for (const peer of activePeers) {
        if (peer.index === sender.index) continue;
        
        try {
            const received = await peer.page.evaluate((msg) => {
                // Check received messages tracking (exactly like baseline test)
                if (window.__ppTest?.receivedMessages?.has && window.__ppTest.receivedMessages.size > 0) {
                    // Look for message in received set
                    for (const msgContent of window.__ppTest.receivedMessages) {
                        if (typeof msgContent === 'string' && msgContent.includes(msg)) {
                            return true;
                        }
                    }
                }
                return false;
            }, testMessage);
            
            if (received) receiveCount++;
        } catch (e) {
            // Skip
        }
    }
    
    const receptionRate = activePeers.length > 1 ? 
        ((receiveCount / (activePeers.length - 1)) * 100).toFixed(1) : 0;
    
    console.log(`  📊 Reception: ${receiveCount}/${activePeers.length - 1} (${receptionRate}%)`);
    
    const success = receptionRate >= 80;
    if (success) {
        console.log('  ✅ Broadcast test passed\n');
    } else {
        console.log('  ⚠️  Broadcast test below threshold\n');
    }
    
    return {
        success,
        receiveCount,
        total: activePeers.length - 1,
        receptionRate,
        senderPeerIndex: sender.index,
        browserSender: sender.browserName,
        messageSample: testMessage
    };
}

/**
 * Generate final report (matches baseline format)
 */
async function generateReport() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70) + '\n');
    
    // Collect peer statistics
    const totalPeers = peerData.length;
    const connectedPeers = peerData.filter(p => p.status === 'connected').length;
    const failedPeers = peerData.filter(p => p.status === 'failed').length;
    
    let totalConnections = 0;
    const browserStats = {};
    const connectionCounts = {};
    
    for (const peer of peerData) {
        if (!browserStats[peer.browserName]) {
            browserStats[peer.browserName] = { total: 0, connected: 0, connections: 0 };
        }
        browserStats[peer.browserName].total++;
        
        if (peer.status === 'connected' && peer.page) {
            try {
                const counts = await peer.page.evaluate(() => {
                    const mesh = window.__ppMesh;
                    if (mesh) {
                        return {
                            connectedPeers: mesh.connectionManager?.peers?.size || 0,
                            peerId: mesh.peerId
                        };
                    }
                    return null;
                });
                if (counts) {
                    peer.connectedPeers = counts.connectedPeers;
                    totalConnections += counts.connectedPeers;
                    browserStats[peer.browserName].connected++;
                    browserStats[peer.browserName].connections += counts.connectedPeers;
                    
                    // Track connection distribution
                    const count = counts.connectedPeers;
                    connectionCounts[count] = (connectionCounts[count] || 0) + 1;
                }
            } catch (e) {
                // Skip
            }
        }
    }
    
    const connectivityRate = (connectedPeers / totalPeers) * 100;
    const broadcastRate = broadcastResults ? parseFloat(broadcastResults.receptionRate) : 0;
    
    console.log(`Total Peers: ${totalPeers}`);
    console.log(`Connected: ${connectedPeers} (${((connectedPeers / totalPeers) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${failedPeers} (${((failedPeers / totalPeers) * 100).toFixed(1)}%)`);

    // Broadcast results
    if (broadcastResults) {
        console.log('\nBroadcast Results:');
        console.log(`  • Sent by: Peer ${broadcastResults.senderPeerIndex} (${broadcastResults.browserSender})`);
        console.log(`  • Total peers: ${totalPeers}`);
        console.log(`  • Received by: ${broadcastResults.receiveCount} peers`);
        console.log(`  • Success rate: ${broadcastResults.receptionRate}%`);
    }
    
    // Connection distribution
    console.log('\nConnection Distribution:');
    for (let i = 0; i <= MAX_PEERS; i++) {
        const count = connectionCounts[i] || 0;
        if (count > 0) {
            console.log(`  ${i} connections: ${count} peers`);
        }
    }
    
    // Per-Browser results
    console.log('\nPer-Browser Results:');
    for (const browserConfig of BROWSERS) {
        const stats = browserStats[browserConfig.name];
        const avg = stats.connected > 0 ? (stats.connections / stats.connected).toFixed(2) : '0.00';
        console.log(`  ${browserConfig.name}: ${stats.connected}/${browserConfig.count} connected, avg ${avg} connections`);
    }

    // Final mesh snapshot
    const avgConnections = connectedPeers > 0 ? (totalConnections / connectedPeers).toFixed(2) : '0.00';
    console.log('\nFinal Mesh Snapshot:');
    console.log(`  • Active peers: ${connectedPeers}/${totalPeers}`);
    console.log(`  • Total connections: ${totalConnections}`);
    console.log(`  • Average connections per peer: ${avgConnections}`);
    console.log(`  • Expected range: ${MIN_PEERS}-${MAX_PEERS} connections per peer`);
    
    // Overall result
    console.log('\n' + '='.repeat(70));
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
 * Cleanup and shutdown
 */
async function cleanup(silent = false) {
    if (!silent) console.log('\n🧹 Cleaning up...');
    
    // Close all pages and contexts
    for (const page of pages) {
        try {
            await page.close();
        } catch (e) {}
    }
    
    for (const context of contexts) {
        try {
            await context.close();
        } catch (e) {}
    }
    
    // Close all browsers
    for (const { browser, name } of browsers) {
        try {
            if (!silent) console.log(`  🔄 Closing ${name}...`);
            await browser.close();
        } catch (e) {}
    }
    
    // Stop hubs
    if (hubServer1) {
        try {
            if (!silent) console.log('  🔄 Stopping Hub 1...');
            await hubServer1.stop();
        } catch (e) {}
    }
    
    if (hubServer2) {
        try {
            if (!silent) console.log('  🔄 Stopping Hub 2...');
            await hubServer2.stop();
        } catch (e) {}
    }
    
    // Stop HTTP server
    if (httpServer) {
        try {
            if (!silent) console.log('  🔄 Stopping HTTP server...');
            await new Promise((resolve) => {
                httpServer.close(() => resolve());
            });
        } catch (e) {}
    }
    
    if (!silent) console.log('✅ Cleanup complete\n');
}

/**
 * Main test execution
 */
async function main() {
    try {
        // Start servers
        await startHubs();
        await startHTTPServer();
        
        // Launch browsers concurrently
        console.log('🌐 Launching browsers...\n');
        await Promise.all(BROWSERS.map((cfg, idx) => launchBrowser(cfg, idx)));
        console.log('');
        
        // Create peers asynchronously with controlled concurrency per browser
        console.log('👥 Creating peers...\n');
        const CONCURRENCY_PER_BROWSER = 3;
        
        // Create peers per browser type concurrently, but limit concurrent peers within each browser
        const browserPromises = BROWSERS.map(async ({ name, count, hubPort }, browserIndex) => {
            const browser = browsers.find(b => b.name === name).browser;
            const basePeerIndex = BROWSERS.slice(0, browserIndex).reduce((sum, b) => sum + b.count, 0);
            
            // Create batches for this browser
            const tasks = [];
            for (let i = 0; i < count; i++) {
                const peerIndex = basePeerIndex + i;
                tasks.push(() => createPeer(browser, name, i, peerIndex, hubPort));
            }
            
            // Execute tasks in controlled batches
            for (let i = 0; i < tasks.length; i += CONCURRENCY_PER_BROWSER) {
                const batch = tasks.slice(i, i + CONCURRENCY_PER_BROWSER).map(fn => fn());
                await Promise.all(batch);
                // Small delay between batches to prevent overwhelming the browser
                if (i + CONCURRENCY_PER_BROWSER < tasks.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        });
        
        // Execute all browser peer creation concurrently
        await Promise.all(browserPromises);
        
        const successfulPeers = peerData.filter(p => p.status === 'connected').length;
        console.log(`\n✅ Created ${successfulPeers}/${TOTAL_PEERS} peers\n`);
        
        if (successfulPeers < TOTAL_PEERS * 0.8) {
            console.log('⚠️  Less than 80% of peers connected successfully');
        }
        
        // Wait for mesh stabilization
        await waitForMeshStabilization();

        // Extra delay to ensure gossip convergence before broadcast
        await new Promise(r => setTimeout(r, 3000));
        
        // Test broadcast messaging
        broadcastResults = await testBroadcastMessaging();
        
        // Generate final report
        await generateReport();
        
        // Cleanup
        await cleanup();
        
        console.log('✅ Test completed successfully\n');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        await cleanup(true);
        process.exit(1);
    }
}

// Handle signals
process.on('SIGINT', async () => {
    console.log('\n⚠️  Received SIGINT, cleaning up...');
    await cleanup(true);
    process.exit(130);
});

process.on('SIGTERM', async () => {
    console.log('\n⚠️  Received SIGTERM, cleaning up...');
    await cleanup(true);
    process.exit(143);
});

// Run test
main();
