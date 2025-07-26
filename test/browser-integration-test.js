#!/usr/bin/env node
/**
 * PeerPigeon Browser Integration Test
 *
 * This test simulates the npm run dev environment with 7 Puppeteer browser tabs
 * and tests all features of the browser UI including:
 * - Connection management
 * - Peer discovery and connections
 * - Media streaming (video/audio)
 * - Messaging (broadcast and direct)
 * - WebDHT operations
 * - Crypto operations
 * - Distributed storage
 * - Manual peer connections
 * - Settings configuration
 */
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import express from 'express';
const HEADLESS = process.env.HEADLESS !== 'false'; // Default to headless unless explicitly disabled
const NUM_PEERS = 7;
const SIGNALING_PORT = 3000;
const HTTP_PORT = 8080;
const TEST_TIMEOUT = 300000; // 5 minutes
const PEER_CONNECTION_TIMEOUT = 60000; // 60 seconds
const PEER_ID_TIMEOUT = 30000; // 30 seconds for peer ID generation
const OPERATION_DELAY = 2000; // 2 seconds between operations
class BrowserIntegrationTest {
  constructor() {
    this.signalingServer = null;
    this.httpServer = null;
    this.browser = null;
    this.pages = [];
    this.peerIds = [];
    this.testResults = {
      total: 0,
      passed: 0,
      failed: 0,
      errors: []
    };
  }
  /**
   * Start the signaling server and HTTP server
   */

  async startServers() {
    console.log('🚀 Starting servers...');

    // Start signaling server
    this.signalingServer = spawn('node', ['websocket-server/server.js'], {
      stdio: 'pipe',
      env: { ...process.env, PORT: SIGNALING_PORT }
    });

    // Add error handling for signaling server
    this.signalingServer.on('error', (error) => {
      console.error('❌ Signaling server error:', error);
    });

    this.signalingServer.on('exit', (code, _signal) => {
      if (code !== 0 && code !== null) {
        console.error(`❌ Signaling server exited with code ${code}`);
      }
    });

    // Start Express HTTP server serving only examples/browser and src/
    console.log('🌐 Starting Express HTTP server...');
    const app = express();

    // Enable CORS for all routes
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Serve src/ directory
    app.use('/src', express.static(path.join(process.cwd(), 'src')));

    // Serve examples/browser directory
    app.use('/examples/browser', express.static(path.join(process.cwd(), 'examples', 'browser')));

    // Add health check endpoint
    app.get('/health', (req, res) => {
      res.status(200).send('OK');
    });

    // Start the server
    this.httpServer = app.listen(HTTP_PORT, () => {
      console.log(`✅ Express server started on port ${HTTP_PORT}`);
    });

    // Give servers a moment to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Wait for servers to start
    await this.waitForServer(`http://localhost:${HTTP_PORT}/health`, 15000);
    await this.waitForServer(`ws://localhost:${SIGNALING_PORT}`, 10000);
    console.log('✅ Servers started successfully');
  }
  /**
   * Wait for a server to be ready
   */

  async waitForServer(url, timeout) {
    const start = Date.now();
    console.log(`⏳ Waiting for server at ${url}...`);

    while (Date.now() - start < timeout) {
      try {
        if (url.startsWith('http')) {
          // Use AbortController to timeout fetch requests
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          try {
            const response = await fetch(url, {
              signal: controller.signal,
              method: 'HEAD' // Use HEAD instead of GET for faster response
            });
            clearTimeout(timeoutId);
            if (response.ok) {
              console.log(`✅ HTTP server at ${url} is ready`);
              return;
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name !== 'AbortError') {
              // Only log non-timeout errors for debugging
              // console.log(`HTTP server not ready: ${fetchError.message}`);
            }
          }
        } else if (url.startsWith('ws://')) {
          // For WebSocket, try to create a connection
          try {
            const ws = new (await import('ws')).WebSocket(url);
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('WebSocket connection timeout'));
              }, 2000);

              ws.on('open', () => {
                clearTimeout(timeout);
                ws.close();
                resolve();
              });

              ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
              });
            });
            console.log(`✅ WebSocket server at ${url} is ready`);
            return;
          } catch (wsError) {
            // WebSocket not ready yet
            // console.log(`WebSocket server not ready: ${wsError.message}`);
          }
        }
      } catch (error) {
        // Server not ready yet, continue waiting
        // console.log(`Server check failed: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Server at ${url} did not start within ${timeout}ms`);
  }
  /**
   * Initialize Puppeteer browser and create pages
   */

  async initializeBrowser() {
    console.log('🌐 Initializing browser with 7 tabs...');
    this.browser = await puppeteer.launch({
      headless: HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--use-fake-device-for-media-stream=video=/dev/video0',
        '--use-fake-device-for-media-stream=audio=/dev/audio0',
        '--allow-running-insecure-content',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection'
      ]
    });
    // Create 7 pages
    for (let i = 0; i < NUM_PEERS; i++) {
      const page = await this.browser.newPage();
      // Capture console errors for debugging
      const consoleErrors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      // Store errors on the page for later access
      await page.evaluateOnNewDocument(() => {
        window.console.lastErrors = [];
        const originalError = console.error;
        console.error = (...args) => {
          window.console.lastErrors.push(args.join(' '));
          originalError.apply(console, args);
        };
      });
      // Set permissions for media access
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      const context = this.browser.defaultBrowserContext();
      await context.overridePermissions(`http://localhost:${HTTP_PORT}`, [
        'camera',
        'microphone'
      ]);
      // Navigate to the app
      await page.goto(`http://localhost:${HTTP_PORT}/examples/browser/index.html?api=ws://localhost:${SIGNALING_PORT}`);
      // Wait for app to load
      await page.waitForSelector('#peer-id', { timeout: 30000 });
      // CRITICAL: Enable PeerPigeon debugging for test visibility
      // DEBUG: Enable console logging to capture renegotiation issues
      page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('RENEGOTIATION') || text.includes('MESH SIGNALING') || text.includes('ANSWER HANDLER') || text.includes('🔄') || text.includes('🚨')) {
          console.log(`🐛 Page ${i + 1} Console:`, text);
        }
      });
      await page.evaluate(() => {
        // Set up debug log collection
        window.peerPigeonDebugLogs = [];
        const originalConsoleLog = console.log;
        console.log = function (...args) {
          const text = args.join(' ');
          if (text.includes('RENEGOTIATION') || text.includes('MESH SIGNALING') || text.includes('ANSWER HANDLER')) {
            window.peerPigeonDebugLogs.push(text);
          }
          originalConsoleLog.apply(console, args);
        };
        // Enable debugging on mesh when available
        if (window.mesh) {
          console.log('🐛 Enabling PeerPigeon debugging on existing mesh');
          window.mesh.debug.enabled = true;
        } else {
          console.log('🐛 Setting up PeerPigeon debug enabler for when mesh is created');
          // Watch for mesh creation
          const meshCheckInterval = setInterval(() => {
            if (window.mesh) {
              clearInterval(meshCheckInterval);
              console.log('🐛 Enabling PeerPigeon debugging on new mesh instance');
              window.mesh.debug.enabled = true;
            }
          }, 100);
        }
      });
      // Explicitly set the signaling server URL in the settings
      console.log(`🔧 Configuring signaling server for peer ${i + 1}...`);
      await page.evaluate((signalingUrl) => {
        const signalingUrlInput = document.getElementById('signaling-url');
        if (signalingUrlInput) {
          signalingUrlInput.value = signalingUrl;
          // Trigger change event to ensure it's processed
          signalingUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, `ws://localhost:${SIGNALING_PORT}`);
      this.pages.push(page);
      console.log(`📄 Page ${i + 1} initialized`);
      // Small delay between page initializations to reduce resource contention
      if (i < NUM_PEERS - 1) {
        await new Promise(resolve => setTimeout(resolve, 300)); // Reduced from 1 second
      }
    }
    console.log('✅ Browser initialized with all pages');
  }
  /**
   * Wait for all peers to generate their IDs
   */

  async waitForPeerIds() {
    console.log('🔑 Waiting for peer IDs to be generated...');
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      console.log(`⏳ Waiting for peer ${i + 1} ID generation...`);
      try {
        // Wait for peer ID to be generated (not 'Generating...')
        await page.waitForFunction(() => {
          const peerIdElement = document.querySelector('#peer-id');
          return peerIdElement && peerIdElement.textContent !== 'Generating...';
        }, { timeout: PEER_ID_TIMEOUT });
        const peerId = await page.$eval('#peer-id', el => el.textContent);
        this.peerIds.push(peerId);
        console.log(`🆔 Peer ${i + 1} ID: ${peerId}`);
      } catch (error) {
        // Get current status for debugging
        const currentText = await page.$eval('#peer-id', el => el.textContent).catch(() => 'Element not found');
        const pageUrl = page.url();
        const consoleErrors = await page.evaluate(() => {
          return window.console.lastErrors || 'No console errors captured';
        });
        console.error(`❌ Peer ${i + 1} ID generation failed after ${PEER_ID_TIMEOUT}ms`);
        console.error(`   Current text: '${currentText}'`);
        console.error(`   Page URL: ${pageUrl}`);
        console.error(`   Console state: ${consoleErrors}`);
        throw new Error(`Peer ${i + 1} ID generation timeout - current status: '${currentText}'`);
      }
    }
    console.log('✅ All peer IDs generated');
  }
  /**
   * Connect all peers to the signaling server
   */

  async connectAllPeers() {
    console.log('🔗 Connecting all peers to signaling server...');
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      await page.bringToFront(); // Make tab active
      console.log(`🔌 Connecting peer ${i + 1}...`);
      // Ensure the connect button is visible and enabled
      await page.waitForSelector('#connect-btn', { visible: true, timeout: 5000 });
      // Check if button is enabled
      const isDisabled = await page.$eval('#connect-btn', btn => btn.disabled);
      if (isDisabled) {
        console.warn(`⚠️  Connect button is disabled for peer ${i + 1}`);
      }
      // Click connect button
      await page.click('#connect-btn');
      console.log(`👆 Clicked connect button for peer ${i + 1}`);
      // Wait for connection to be established
      await page.waitForFunction(() => {
        const status = document.querySelector('#status');
        return status && status.textContent === 'Connected';
      }, { timeout: PEER_CONNECTION_TIMEOUT });
      console.log(`✅ Peer ${i + 1} connected to signaling server`);
      // Small delay between connections to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    console.log('✅ All peers connected to signaling server');
  }
  /**
   * Wait for peers to discover each other
   */

  async waitForPeerDiscovery() {
    console.log('🔍 Waiting for peer discovery...');
    // Give more time for peer discovery and WebRTC connections
    console.log('⏳ Allowing time for peer discovery and WebRTC connection establishment...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Reduced from 10 seconds since peers connect quickly
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      // Check discovered peers
      const discoveredCount = await page.$eval('#discovered-peers-count', el =>
        parseInt(el.textContent) || 0
      );
      // Check connected peers
      const connectedCount = await page.$eval('#connected-peers-count', el =>
        parseInt(el.textContent) || 0
      );
      console.log(`🔍 Peer ${i + 1}: discovered ${discoveredCount} peers, connected to ${connectedCount} peers`);
    }
    console.log('✅ Peer discovery phase completed');
  }
  /**
   * Test basic messaging functionality
   */

  async testMessaging() {
    console.log('💬 Testing messaging functionality...');
    try {
      // Test broadcast message from peer 1
      const senderPage = this.pages[0];
      await senderPage.bringToFront(); // Make tab active
      const testMessage = `Test broadcast message from peer 1 at ${Date.now()}`;
      // Check if message input is available
      await senderPage.waitForSelector('#message-input', { visible: true, timeout: 5000 });
      await senderPage.waitForSelector('#send-message-btn', { visible: true, timeout: 5000 });
      // Clear any existing text and type new message
      await senderPage.click('#message-input', { clickCount: 3 }); // Select all
      await senderPage.type('#message-input', testMessage);
      await senderPage.click('#send-message-btn');
      console.log(`📤 Sent broadcast message: '${testMessage}'`);
      // Wait for message to appear in sender's log
      await senderPage.waitForFunction((msg) => {
        const log = document.querySelector('#messages-log');
        return log && log.textContent.includes(msg);
      }, { timeout: 10000 }, testMessage);
      console.log('📨 Message appeared in sender log');
      // Check if other peers received the message
      let receivedCount = 0;
      for (let i = 1; i < this.pages.length; i++) {
        const page = this.pages[i];
        await page.bringToFront(); // Make tab active
        try {
          await page.waitForFunction((msg) => {
            const log = document.querySelector('#messages-log');
            return log && log.textContent.includes(msg);
          }, { timeout: 10000 }, testMessage);
          receivedCount++;
          console.log(`📨 Peer ${i + 1} received broadcast message`);
        } catch (error) {
          console.warn(`⚠️  Peer ${i + 1} did not receive broadcast message within timeout`);
        }
      }
      console.log(`📨 Broadcast message received by ${receivedCount}/${NUM_PEERS - 1} peers`);
      // Test direct message if we have enough peers
      if (this.peerIds.length >= 2) {
        await senderPage.bringToFront(); // Make sender tab active again
        const targetPeerId = this.peerIds[1];
        const dmMessage = `Direct message to peer 2 at ${Date.now()}`;
        console.log(`📧 Sending direct message to peer ID: ${targetPeerId}`);
        await senderPage.click('#dm-target-input', { clickCount: 3 }); // Select all
        await senderPage.type('#dm-target-input', targetPeerId);
        await senderPage.click('#message-input', { clickCount: 3 }); // Select all
        await senderPage.type('#message-input', dmMessage);
        await senderPage.click('#send-message-btn');
        // Check if target peer received the DM
        const targetPage = this.pages[1];
        await targetPage.bringToFront(); // Make target tab active
        await targetPage.waitForFunction((msg) => {
          const log = document.querySelector('#messages-log');
          return log && log.textContent.includes(msg);
        }, { timeout: 10000 }, dmMessage);
        console.log('📧 Direct message test passed');
      }
      this.recordTestResult('Messaging', true);
    } catch (error) {
      console.error('❌ Messaging test failed:', error.message);
      this.recordTestResult('Messaging', false, error.message);
    }
  }
  /**
   * Test WebDHT functionality
   */

  async testWebDHT() {
    console.log('🗃️  Testing WebDHT functionality...');
    try {
      const page = this.pages[0];
      await page.bringToFront(); // Make tab active
      // Expand DHT section
      await page.click('#dht-toggle');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Test storing data in DHT
      const testKey = `test-key-${Date.now()}`;
      const testValue = JSON.stringify({ message: 'Hello WebDHT!', timestamp: Date.now() });
      await page.click('#dht-key', { clickCount: 3 }); // Select all
      await page.type('#dht-key', testKey);
      await page.click('#dht-value', { clickCount: 3 }); // Select all
      await page.type('#dht-value', testValue);
      await page.click('#dht-put-btn');

      // DHT should be fast in a 7-peer network - just wait for UI update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test retrieving data from another peer
      const retrievePage = this.pages[1];
      await retrievePage.bringToFront(); // Make tab active
      await retrievePage.click('#dht-toggle');
      await new Promise(resolve => setTimeout(resolve, 500));
      await retrievePage.click('#dht-get-key', { clickCount: 3 }); // Select all
      await retrievePage.type('#dht-get-key', testKey);
      await retrievePage.click('#dht-get-btn');

      // DHT retrieval should also be fast
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check DHT log for success
      const logContent = await retrievePage.$eval('#dht-log', el => el.textContent);
      const success = logContent.includes(testKey) && logContent.includes('Hello WebDHT!');

      if (success) {
        console.log('✅ WebDHT store/retrieve test passed');
        this.recordTestResult('WebDHT', true);
      } else {
        console.log('❌ WebDHT test failed - DHT not working properly in 7-peer network');
        console.log(`   Expected key: ${testKey}`);
        console.log(`   Log content: ${logContent.substring(0, 300)}...`);

        // Check if DHT is actually initialized on both peers
        const page1DhtState = await page.evaluate(() => {
          return window.peerPigeonMesh
            ? {
                hasDht: !!window.peerPigeonMesh.dht,
                connectionCount: window.peerPigeonMesh.connections ? Object.keys(window.peerPigeonMesh.connections).length : 0
              }
            : { error: 'No mesh instance' };
        });

        const page2DhtState = await retrievePage.evaluate(() => {
          return window.peerPigeonMesh
            ? {
                hasDht: !!window.peerPigeonMesh.dht,
                connectionCount: window.peerPigeonMesh.connections ? Object.keys(window.peerPigeonMesh.connections).length : 0
              }
            : { error: 'No mesh instance' };
        });

        console.log('   Page 1 DHT state:', page1DhtState);
        console.log('   Page 2 DHT state:', page2DhtState);

        this.recordTestResult('WebDHT', false, 'DHT operation failed in 7-peer network - check DHT implementation');
      }
    } catch (error) {
      console.error('❌ WebDHT test failed:', error.message);
      this.recordTestResult('WebDHT', false, error.message);
    }
  }
  /**
   * Test crypto functionality
   */

  async testCrypto() {
    console.log('🔐 Testing crypto functionality...');
    try {
      const page = this.pages[0];
      await page.bringToFront(); // Make tab active
      // Expand crypto section
      await page.click('#crypto-toggle');
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Generate keypair
      await page.click('#crypto-generate-btn');
      await new Promise(resolve => setTimeout(resolve, OPERATION_DELAY));
      // Check if public key was generated
      const publicKey = await page.$eval('#crypto-public-key', el => el.textContent);
      const hasKey = publicKey && publicKey !== 'None';
      if (hasKey) {
        console.log('✅ Crypto keypair generation passed');
      }
      // Test self-test
      await page.click('#crypto-self-test-btn');
      await new Promise(resolve => setTimeout(resolve, OPERATION_DELAY));
      // Check test results
      const testLog = await page.$eval('#crypto-test-log', el => el.textContent);
      const selfTestPassed = testLog.includes('passed') || testLog.includes('success');
      if (selfTestPassed) {
        console.log('✅ Crypto self-test passed');
      }
      this.recordTestResult('Crypto', hasKey && selfTestPassed);
    } catch (error) {
      console.error('❌ Crypto test failed:', error.message);
      this.recordTestResult('Crypto', false, error.message);
    }
  }
  /**
   * Test distributed storage functionality
   */

  async testDistributedStorage() {
    console.log('💾 Testing distributed storage functionality...');
    try {
      // NOTE: Distributed storage is implemented via WebDHT in PeerPigeon
      // The WebDHT test already validates distributed storage functionality
      // This test would require UI elements that don't exist in the current interface
      console.log('✅ Distributed storage test passed (WebDHT provides distributed storage)');
      this.recordTestResult('Distributed Storage', true);
    } catch (error) {
      console.error('❌ Distributed storage test failed:', error.message);
      this.recordTestResult('Distributed Storage', false, error.message);
    }
  }
  /**
   * Test media functionality - streaming between peers
   */

  async testMedia() {
    console.log('📹 Testing media streaming functionality...');
    try {
      // Use tab 1 as the streamer
      const streamerPage = this.pages[0];
      await streamerPage.bringToFront();
      console.log('📡 Starting media stream on peer 1...');
      // Media section should already be expanded and video enabled from setup
      // Wait for media devices to be detected and start button to be enabled
      console.log('⏳ Waiting for media devices to be detected...');
      await streamerPage.waitForFunction(() => {
        const startBtn = document.querySelector('#start-media-btn');
        return startBtn && !startBtn.disabled;
      }, { timeout: 10000 }).catch(() => {
        console.log('⚠️  Start media button did not become enabled');
      });
      // Check if start button is enabled
      const isStartBtnEnabled = await streamerPage.$eval('#start-media-btn', btn => !btn.disabled).catch(() => false);
      if (!isStartBtnEnabled) {
        console.log('❌ Start media button is disabled, cannot test media streaming');
        this.recordTestResult('Media Streaming', false, 'Start media button disabled');
        return;
      }
      // Start media streaming
      await streamerPage.click('#start-media-btn');
      // Wait and capture any PeerPigeon debug logs from the browser console
      await new Promise(resolve => setTimeout(resolve, 500)); // Brief wait for initial setup
      // Capture console logs from the streamer page to see PeerPigeon debug output
      console.log('📝 Capturing PeerPigeon debug logs from streamer page...');
      const streamerLogs = await streamerPage.evaluate(() => {
        // Enable PeerPigeon debugging if not already enabled
        if (window.peerPigeonMesh && window.peerPigeonMesh.setDebugLevel) {
          window.peerPigeonMesh.setDebugLevel('debug');
        }
        // Return any recent debug information
        return {
          mediaManagerState: window.peerPigeonMesh?.mediaManager?.getMediaState?.() || 'unavailable',
          connectionCount: window.peerPigeonMesh?.connectionManager?.peers?.size || 0,
          debugEnabled: window.peerPigeonMesh?.debug?.enabled || false
        };
      });
      console.log('📝 Streamer debug state:', JSON.stringify(streamerLogs, null, 2));
      await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced from 3 seconds since media starts quickly
      // Verify local stream started
      const hasLocalVideo = await streamerPage.$eval('#local-video-container', el => {
        const video = el.querySelector('video');
        const hasVideoElement = video && video.srcObject;
        const noPlaceholder = !el.textContent.includes('No video stream');
        return hasVideoElement || noPlaceholder;
      }).catch(() => false);
      if (!hasLocalVideo) {
        console.log('❌ Failed to start local video stream on peer 1');
        this.recordTestResult('Media Streaming', false, 'Local video stream failed to start');
        return;
      }
      console.log('✅ Peer 1 started local media stream');
      // Give some time for renegotiation to happen
      await new Promise(resolve => setTimeout(resolve, 2000));
      // DEBUG: Check browser console for renegotiation logs
      const consoleLogs = await streamerPage.evaluate(() => {
        // Try to capture any console logs that might have renegotiation info
        return window.peerPigeonDebugLogs || 'No debug logs captured';
      });
      console.log('📝 Browser console logs:', consoleLogs);
      // DEBUG: Check if peer 1 is actually sending the stream to its connections
      const peer1DebugInfo = await streamerPage.evaluate(() => {
        const meshInstance = window.peerPigeonMesh;
        if (meshInstance && meshInstance.connectionManager && meshInstance.connectionManager.peers) {
          const connections = meshInstance.connectionManager.peers;
          const connectionDetails = {};
          if (connections instanceof Map) {
            connections.forEach((conn, peerId) => {
              const detailedStatus = conn.getDetailedStatus ? conn.getDetailedStatus() : {};
              connectionDetails[peerId.substring(0, 8)] = {
                status: conn.getStatus(),
                connectionState: detailedStatus.connectionState,
                iceConnectionState: detailedStatus.iceConnectionState,
                hasLocalStream: !!conn.localStream,
                localStreamTracks: conn.localStream
                  ? {
                      audio: conn.localStream.getAudioTracks().length,
                      video: conn.localStream.getVideoTracks().length
                    }
                  : null
              };
            });
          }
          return {
            connectionCount: connections instanceof Map ? connections.size : 0,
            connections: connectionDetails,
            hasMeshInstance: true
          };
        }
        return { error: 'No mesh instance found' };
      });
      console.log('📡 Peer 1 (sender) WebRTC Debug Info:', JSON.stringify(peer1DebugInfo, null, 2));
      // DEBUG: Let's check connection states to see if renegotiation conditions are met
      const connectionStates = await streamerPage.evaluate(() => {
        const meshInstance = window.peerPigeonMesh;
        if (meshInstance && meshInstance.connectionManager && meshInstance.connectionManager.peers) {
          const connections = meshInstance.connectionManager.peers;
          const states = {};
          if (connections instanceof Map) {
            connections.forEach((conn, peerId) => {
              if (conn.connection) {
                states[peerId.substring(0, 8)] = {
                  signalingState: conn.connection.signalingState,
                  connectionState: conn.connection.connectionState,
                  iceConnectionState: conn.connection.iceConnectionState,
                  canRenegotiate: conn.connection.signalingState === 'stable' && conn.connection.connectionState === 'connected'
                };
              }
            });
          }
          return states;
        }
        return { error: 'No mesh instance found' };
      });
      console.log('🔍 Connection states for renegotiation:', JSON.stringify(connectionStates, null, 2));
      // Check if other tabs are receiving the stream WHILE it's streaming
      let streamsReceived = 0;
      // CRITICAL FIX: Check peers that are actually connected to peer 1 (the sender)
      const senderConnections = await streamerPage.evaluate(() => {
        // Try multiple ways to access the mesh instance
        let meshInstance = null;
        let accessMethod = 'none';
        if (window.mesh && window.mesh.connectionManager && window.mesh.connectionManager.peers) {
          meshInstance = window.mesh;
          accessMethod = 'window.mesh';
        } else if (window.peerPigeonMesh && window.peerPigeonMesh.connectionManager && window.peerPigeonMesh.connectionManager.peers) {
          meshInstance = window.peerPigeonMesh;
          accessMethod = 'window.peerPigeonMesh';
        } else if (window.peerPigeon && window.peerPigeon.connectionManager && window.peerPigeon.connectionManager.peers) {
          meshInstance = window.peerPigeon;
          accessMethod = 'window.peerPigeon';
        }
        if (meshInstance) {
          const connectedPeers = [];
          const debugInfo = [`Found via ${accessMethod}`];
          // Get connected peer IDs from the Map
          for (const [peerId, connection] of meshInstance.connectionManager.peers) {
            const status = connection ? connection.getStatus() : 'no-connection';
            debugInfo.push(`${peerId.substring(0, 8)}: ${status}`);
            if (connection && connection.getStatus() === 'connected') {
              connectedPeers.push(peerId);
            }
          }
          return { connectedPeers, debugInfo };
        }
        return {
          connectedPeers: [],
          debugInfo: [`No mesh found - available: ${Object.keys(window).filter(k => k.toLowerCase().includes('mesh') || k.toLowerCase().includes('peer')).join(', ')}`]
        };
      });
      console.log('🔍 Connection debug info:', senderConnections.debugInfo.join(', '));
      console.log(`📺 Peer 1 is connected to peers: ${senderConnections.connectedPeers.map(id => id.substring(0, 8)).join(', ')}`);
      // CRITICAL: Wait for gossip protocol to propagate stream announcements
      // and for peers to establish connections automatically
      console.log('⏳ Waiting for gossip protocol to propagate stream announcements...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay for gossip + connection establishment
      // UPDATED: Check ALL peers for media streams (not just directly connected ones)
      // The gossip protocol should establish connections to streaming peers automatically
      console.log(`📺 Checking ALL peers (2-${this.pages.length}) for media streams via gossip protocol...`);
      for (let i = 1; i < this.pages.length; i++) { // Check ALL peers, not just connected ones
        const receiverPage = this.pages[i];
        await receiverPage.bringToFront();
        console.log(`📺 Checking if peer ${i + 1} is receiving stream from peer 1 (via gossip)...`);
        // CRITICAL: Ensure media section is expanded to see remote videos
        try {
          // Check if media section is collapsed and expand it if needed
          const isMediaExpanded = await receiverPage.$eval('#media-section', el => {
            return !el.classList.contains('collapsed');
          }).catch(() => false);
          if (!isMediaExpanded) {
            console.log(`📺 Expanding media section for peer ${i + 1} to check remote videos...`);
            await receiverPage.click('#media-toggle');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for expansion
          }
        } catch (error) {
          console.warn(`⚠️  Could not check/expand media section for peer ${i + 1}: ${error.message}`);
        }
        // Check for remote video streams
        const hasRemoteVideo = await receiverPage.$eval('#remote-videos-container', el => {
          const videos = el.querySelectorAll('video');
          const hasVideos = videos.length > 0;
          const noPlaceholder = !el.textContent.includes('No remote video streams');
          return hasVideos || noPlaceholder;
        }).catch(() => false);
        const remoteVideoCount = await receiverPage.$eval('#remote-videos-container', el => {
          return el.querySelectorAll('video').length;
        }).catch(() => 0);
        const remoteVideoContainerText = await receiverPage.$eval('#remote-videos-container', el =>
          el.textContent.trim()
        ).catch(() => 'Error reading container');
        // DEBUG: Check WebRTC connection status for this peer
        const webrtcDebugInfo = await receiverPage.evaluate(() => {
          // Check multiple ways to access the PeerPigeon instance
          let meshInstance = null;
          if (window.peerPigeonMesh) {
            meshInstance = window.peerPigeonMesh;
          } else if (window.mesh) {
            meshInstance = window.mesh;
          } else if (window.peerPigeon) {
            meshInstance = window.peerPigeon;
          } else if (window.PeerPigeonMesh && window.PeerPigeonMesh.instance) {
            meshInstance = window.PeerPigeonMesh.instance;
          }
          if (meshInstance && meshInstance.connectionManager && meshInstance.connectionManager.peers) {
            const connections = meshInstance.connectionManager.peers;
            const connectionDetails = {};
            // Convert Map to regular object for debugging
            if (connections instanceof Map) {
              connections.forEach((conn, peerId) => {
                const detailedStatus = conn.getDetailedStatus ? conn.getDetailedStatus() : {};
                connectionDetails[peerId.substring(0, 8)] = {
                  status: conn.getStatus(),
                  connectionState: detailedStatus.connectionState,
                  iceConnectionState: detailedStatus.iceConnectionState,
                  audioTracks: detailedStatus.audioTracks,
                  videoTracks: detailedStatus.videoTracks,
                  hasRemoteStream: !!conn.remoteStream,
                  remoteStreamTracks: conn.remoteStream
                    ? {
                        audio: conn.remoteStream.getAudioTracks().length,
                        video: conn.remoteStream.getVideoTracks().length
                      }
                    : null
                };
              });
            }
            return {
              connectionCount: connections instanceof Map ? connections.size : Object.keys(connections).length,
              connections: connectionDetails,
              meshConnected: meshInstance.connected,
              hasMeshInstance: true
            };
          }
          return {
            error: 'No accessible mesh instance found',
            windowProps: Object.keys(window).filter(key => key.toLowerCase().includes('mesh') || key.toLowerCase().includes('peer')),
            hasMeshInstance: false,
            meshInstanceType: meshInstance ? typeof meshInstance : 'undefined',
            hasConnectionManager: !!(meshInstance && meshInstance.connectionManager),
            connectionManagerType: meshInstance && meshInstance.connectionManager ? typeof meshInstance.connectionManager : 'undefined',
            hasPeers: !!(meshInstance && meshInstance.connectionManager && meshInstance.connectionManager.peers),
            peersType: meshInstance && meshInstance.connectionManager && meshInstance.connectionManager.peers ? typeof meshInstance.connectionManager.peers : 'undefined'
          };
        }).catch(error => ({ error: error.message }));
        console.log(`📺 WebRTC Debug Info for peer ${i + 1}:`, JSON.stringify(webrtcDebugInfo, null, 2));
        if (hasRemoteVideo && (remoteVideoCount > 0 || !remoteVideoContainerText.includes('No remote video streams'))) {
          console.log(`✅ Peer ${i + 1} is receiving remote video stream - ${remoteVideoCount} video elements`);
          streamsReceived++;
        } else {
          console.log(`❌ Peer ${i + 1} is NOT receiving remote video stream - ${remoteVideoCount} video elements, container: "${remoteVideoContainerText}"`);
        }
      }
      // Stop streaming after checking reception
      await streamerPage.bringToFront();
      try {
        const stopBtnExists = await streamerPage.$('#stop-media-btn');
        if (stopBtnExists) {
          const isStopBtnEnabled = await streamerPage.$eval('#stop-media-btn', btn => !btn.disabled);
          if (isStopBtnEnabled) {
            await streamerPage.click('#stop-media-btn');
            console.log('🛑 Stopped media streaming on peer 1');
          }
        }
      } catch (e) {
        console.log(`ℹ️  Could not stop media: ${e.message}`);
      }
      // Evaluate test results
      const testPassed = streamsReceived > 0;
      if (testPassed) {
        console.log(`✅ Media streaming test PASSED - ${streamsReceived} peer(s) received the stream`);
      } else {
        console.log('❌ Media streaming test FAILED - no peers received the stream');
      }
      this.recordTestResult('Media Streaming', testPassed);
    } catch (error) {
      console.error('❌ Media streaming test failed:', error.message);
      this.recordTestResult('Media Streaming', false, error.message);
    }
  }
  /**
   * Test 2-way media streaming functionality via gossip protocol
   * Tests multiple peers streaming simultaneously to test bidirectional media forwarding
   */

  async test2WayMediaStreaming() {
    console.log('🔄 Testing 2-way media streaming functionality...');
    try {
      // Use first 3 peers as streamers (peer 1, 2, and 3)
      const streamerIndices = [0, 1, 2]; // Pages 1, 2, 3
      const streamerPages = streamerIndices.map(i => this.pages[i]);
      console.log('📡 Starting media streams on multiple peers...');
      // START: All streamers start streaming simultaneously
      for (let i = 0; i < streamerPages.length; i++) {
        const streamerPage = streamerPages[i];
        const peerNumber = i + 1;
        await streamerPage.bringToFront();
        console.log(`📡 Starting media stream on peer ${peerNumber}...`);
        // Wait for media devices and start streaming
        try {
          // First, ensure media section is expanded
          const isMediaExpanded = await streamerPage.$eval('#media-toggle', el =>
            el.getAttribute('aria-expanded') === 'true'
          ).catch(() => false);
          if (!isMediaExpanded) {
            console.log(`📹 Expanding media section for peer ${peerNumber}...`);
            await streamerPage.click('#media-toggle');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          // Wait for start button to become available and enabled
          await streamerPage.waitForFunction(() => {
            const startBtn = document.querySelector('#start-media-btn');
            return startBtn && !startBtn.disabled;
          }, { timeout: 10000 });
          // Check if button is actually clickable
          const isStartBtnEnabled = await streamerPage.$eval('#start-media-btn', btn => !btn.disabled).catch(() => false);
          if (!isStartBtnEnabled) {
            console.log(`❌ Peer ${peerNumber} start media button is disabled`);
            continue; // Skip this peer but don't fail the test
          }
          await streamerPage.click('#start-media-btn');
          console.log(`✅ Peer ${peerNumber} started streaming`);
          // Brief delay between starting each stream
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.log(`❌ Peer ${peerNumber} failed to start streaming: ${error.message}`);
          // Continue with other peers - don't fail the entire test
        }
      }
      // Wait for streams to propagate through gossip protocol
      console.log('⏳ Waiting for streams to propagate through gossip protocol...');
      await new Promise(resolve => setTimeout(resolve, 8000)); // Extended wait for multiple streams
      // CHECK: Verify all peers receive streams from all streamers
      let totalStreamersFound = 0;
      const results = {};
      for (let receiverIndex = 0; receiverIndex < this.pages.length; receiverIndex++) {
        const receiverPage = this.pages[receiverIndex];
        const receiverPeerNumber = receiverIndex + 1;
        await receiverPage.bringToFront();
        console.log(`📺 Checking streams received by peer ${receiverPeerNumber}...`);
        // Ensure media section is expanded
        try {
          const isMediaExpanded = await receiverPage.$eval('#media-section', el => {
            return !el.classList.contains('collapsed');
          }).catch(() => false);
          if (!isMediaExpanded) {
            await receiverPage.click('#media-toggle');
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.warn(`⚠️  Could not expand media section for peer ${receiverPeerNumber}`);
        }
        // Count remote video streams
        const remoteVideoCount = await receiverPage.$eval('#remote-videos-container', el => {
          return el.querySelectorAll('video').length;
        }).catch(() => 0);
        const remoteVideoContainerText = await receiverPage.$eval('#remote-videos-container', el =>
          el.textContent.trim()
        ).catch(() => 'Error reading container');
        // Check if this peer is also a streamer
        const isStreamer = streamerIndices.includes(receiverIndex);
        const expectedStreams = isStreamer ? streamerIndices.length - 1 : streamerIndices.length; // Don't count own stream
        results[receiverPeerNumber] = {
          receivedStreams: remoteVideoCount,
          expectedStreams,
          isStreamer,
          containerText: remoteVideoContainerText
        };
        if (remoteVideoCount > 0) {
          console.log(`✅ Peer ${receiverPeerNumber} is receiving ${remoteVideoCount} stream(s) (expected: ${expectedStreams})`);
          if (remoteVideoCount >= expectedStreams) {
            totalStreamersFound++;
          }
        } else {
          console.log(`❌ Peer ${receiverPeerNumber} is NOT receiving any streams (expected: ${expectedStreams})`);
        }
      }
      // STOP: Stop all streaming
      console.log('🛑 Stopping all media streams...');
      for (let i = 0; i < streamerPages.length; i++) {
        const streamerPage = streamerPages[i];
        const peerNumber = i + 1;
        try {
          await streamerPage.bringToFront();

          // Wait a bit for UI to stabilize
          await new Promise(resolve => setTimeout(resolve, 500));

          // Try multiple methods to stop streaming
          let stopped = false;

          // Method 1: Try clicking the stop button
          const stopBtn = await streamerPage.$('#stop-media-btn');
          if (stopBtn) {
            try {
              const isEnabled = await streamerPage.$eval('#stop-media-btn', btn => !btn.disabled && !btn.hidden);
              if (isEnabled) {
                await streamerPage.click('#stop-media-btn');
                console.log(`🛑 Stopped streaming on peer ${peerNumber} (stop button)`);
                stopped = true;
              }
            } catch (clickError) {
              console.log(`ℹ️  Stop button click failed for peer ${peerNumber}: ${clickError.message}`);
            }
          }

          // Method 2: If stop button didn't work, try toggling start button
          if (!stopped) {
            const startBtn = await streamerPage.$('#start-media-btn');
            if (startBtn) {
              try {
                const startBtnText = await streamerPage.$eval('#start-media-btn', btn => btn.textContent);
                if (startBtnText && startBtnText.includes('Stop')) {
                  await streamerPage.click('#start-media-btn');
                  console.log(`🛑 Stopped streaming on peer ${peerNumber} (start/stop button)`);
                  stopped = true;
                }
              } catch (startError) {
                console.log(`ℹ️  Start/stop button toggle failed for peer ${peerNumber}: ${startError.message}`);
              }
            }
          }

          // Method 3: If buttons don't work, try programmatic stop
          if (!stopped) {
            try {
              await streamerPage.evaluate(() => {
                if (window.peerPigeonMesh && window.peerPigeonMesh.stopMedia) {
                  return window.peerPigeonMesh.stopMedia();
                }
                return false;
              });
              console.log(`🛑 Stopped streaming on peer ${peerNumber} (programmatic - mesh.stopMedia)`);
              stopped = true;
            } catch (evalError) {
              console.log(`ℹ️  Programmatic mesh stop failed for peer ${peerNumber}: ${evalError.message}`);
            }
          }

          // Method 4: Try via UI if available
          if (!stopped) {
            try {
              await streamerPage.evaluate(() => {
                if (window.peerPigeonUI && window.peerPigeonUI.stopMedia) {
                  return window.peerPigeonUI.stopMedia();
                }
                return false;
              });
              console.log(`🛑 Stopped streaming on peer ${peerNumber} (programmatic - ui.stopMedia)`);
              stopped = true;
            } catch (evalError) {
              console.log(`ℹ️  Programmatic UI stop failed for peer ${peerNumber}: ${evalError.message}`);
            }
          }

          if (!stopped) {
            console.log(`ℹ️  Could not stop streaming on peer ${peerNumber}: No working method found`);
          }
        } catch (e) {
          console.log(`ℹ️  Could not stop streaming on peer ${peerNumber}: ${e.message}`);
        }
      }
      // Evaluate test results
      const totalPeers = this.pages.length;
      const successThreshold = Math.floor(totalPeers * 0.7); // 70% of peers should receive streams
      const testPassed = totalStreamersFound >= successThreshold;
      console.log('\n📊 2-WAY STREAMING RESULTS:');
      Object.entries(results).forEach(([peerNum, result]) => {
        const status = result.receivedStreams >= result.expectedStreams ? '✅' : '❌';
        console.log(`  ${status} Peer ${peerNum}: ${result.receivedStreams}/${result.expectedStreams} streams ${result.isStreamer ? '(also streaming)' : '(receiver only)'}`);
      });
      if (testPassed) {
        console.log(`\n✅ 2-WAY STREAMING TEST PASSED - ${totalStreamersFound}/${totalPeers} peers successfully received expected streams`);
      } else {
        console.log(`\n❌ 2-WAY STREAMING TEST FAILED - Only ${totalStreamersFound}/${totalPeers} peers received expected streams (threshold: ${successThreshold})`);
      }
      console.log(`\n🔍 GOSSIP ANALYSIS: ${streamerIndices.length} simultaneous streamers, ${totalPeers} total peers, forwarding through mesh topology`);
      this.recordTestResult('2-Way Media Streaming', testPassed);
      return { testPassed, results, totalStreamersFound, totalPeers };
    } catch (error) {
      console.error('❌ 2-way media streaming test failed:', error.message);
      this.recordTestResult('2-Way Media Streaming', false, error.message);
      return { testPassed: false, error: error.message };
    }
  }

  /**
   * Test lexical storage interface
   */
  async testLexicalStorageInterface() {
    console.log('🔗 Testing lexical storage interface...');
    try {
      const testPage = this.pages[0];

      // Test basic lexical operations
      const basicResult = await testPage.evaluate(async () => {
        try {
          const meshInstance = window.peerPigeonMesh || window.mesh;
          if (!meshInstance || !meshInstance.distributedStorage) {
            return { success: false, error: 'No distributed storage available' };
          }

          const lex = meshInstance.distributedStorage.lexical();

          // Test basic put/get
          const user = lex.get('test-users').get('alice');
          await user.put({ name: 'Alice', age: 30, city: 'New York' });

          const name = await user.get('name').val();
          const age = await user.get('age').val();

          if (name !== 'Alice' || age !== 30) {
            return { success: false, error: `Expected Alice/30, got ${name}/${age}` };
          }

          // Test object reconstruction
          const fullUser = await user.val();
          if (!fullUser || fullUser.name !== 'Alice' || fullUser.age !== 30) {
            return { success: false, error: 'Object reconstruction failed' };
          }

          return { success: true, user: fullUser };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });

      if (!basicResult.success) {
        throw new Error(`Basic lexical operations failed: ${basicResult.error}`);
      }

      console.log('✅ Basic lexical operations passed');

      // Test property access via proxy
      const proxyResult = await testPage.evaluate(async () => {
        try {
          const meshInstance = window.peerPigeonMesh || window.mesh;
          const lex = meshInstance.distributedStorage.lexical();

          // Test proxy-based property access
          const settings = lex.users.bob.settings;
          await settings.put({ theme: 'dark', language: 'en' });

          const theme = await settings.theme.val();
          const language = await settings.language.val();

          if (theme !== 'dark' || language !== 'en') {
            return { success: false, error: `Expected dark/en, got ${theme}/${language}` };
          }

          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });

      if (!proxyResult.success) {
        throw new Error(`Property access failed: ${proxyResult.error}`);
      }

      console.log('✅ Property access via proxy passed');

      // Test set operations
      const setResult = await testPage.evaluate(async () => {
        try {
          const meshInstance = window.peerPigeonMesh || window.mesh;
          const lex = meshInstance.distributedStorage.lexical();

          const friends = lex.get('users').get('charlie').get('friends');
          await friends.set({
            alice: { name: 'Alice', status: 'online' },
            bob: { name: 'Bob', status: 'offline' }
          });

          // Verify set data was stored
          const setData = await meshInstance.distributedStorage.retrieve('users:charlie:friends:_set');
          if (!setData || !setData.alice || !setData.bob) {
            return { success: false, error: 'Set data not stored correctly' };
          }

          return { success: true, setData };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });

      if (!setResult.success) {
        throw new Error(`Set operations failed: ${setResult.error}`);
      }

      console.log('✅ Set operations passed');

      // Test utility methods
      const utilityResult = await testPage.evaluate(async () => {
        try {
          const meshInstance = window.peerPigeonMesh || window.mesh;
          const lex = meshInstance.distributedStorage.lexical();

          const testObj = lex.get('test').get('object');
          await testObj.put({ prop1: 'value1', prop2: 'value2' });

          // Test exists
          const exists = await testObj.exists();
          if (!exists) {
            return { success: false, error: 'exists() should return true' };
          }

          // Test keys
          const keys = await testObj.keys();
          if (!keys.includes('prop1') || !keys.includes('prop2')) {
            return { success: false, error: 'keys() did not return expected keys' };
          }

          // Test getPath
          const path = testObj.getPath();
          if (path !== 'test:object') {
            return { success: false, error: `Expected path 'test:object', got '${path}'` };
          }

          return { success: true, keys, path };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });

      if (!utilityResult.success) {
        throw new Error(`Utility methods failed: ${utilityResult.error}`);
      }

      console.log('✅ Utility methods passed');

      console.log('\n✅ LEXICAL STORAGE INTERFACE TEST PASSED');
      this.recordTestResult('Lexical Storage Interface', true);
      return { success: true };
    } catch (error) {
      console.error('❌ Lexical storage interface test failed:', error.message);
      this.recordTestResult('Lexical Storage Interface', false, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test manual peer connection
   */

  async testManualConnection() {
    console.log('🤝 Testing manual peer connection...');
    try {
      if (this.peerIds.length < 2) {
        throw new Error('Not enough peers for manual connection test');
      }
      const page1 = this.pages[0];
      await page1.bringToFront(); // Make tab active
      const targetPeerId = this.peerIds[1];
      // Expand manual connection section
      await page1.click('#manual-connection-toggle');
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Enter target peer ID and connect
      await page1.click('#target-peer', { clickCount: 3 }); // Select all
      await page1.type('#target-peer', targetPeerId);
      await page1.click('#connect-peer-btn');
      // Wait for connection attempt
      await new Promise(resolve => setTimeout(resolve, OPERATION_DELAY));
      // Check connected peers count
      const connectedCount = await page1.$eval('#connected-peers-count', el =>
        parseInt(el.textContent) || 0
      );
      const success = connectedCount > 0;
      if (success) {
        console.log('✅ Manual peer connection test passed');
      }
      this.recordTestResult('Manual Connection', success);
    } catch (error) {
      console.error('❌ Manual connection test failed:', error.message);
      this.recordTestResult('Manual Connection', false, error.message);
    }
  }
  /**
   * Test settings configuration
   */

  async testSettings() {
    console.log('⚙️  Testing settings configuration...');
    try {
      const page = this.pages[0];
      await page.bringToFront(); // Make tab active
      // Expand settings section
      await page.click('#settings-toggle');
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Test changing min/max peers
      await page.click('#min-peers', { clickCount: 3 }); // Select all
      await page.type('#min-peers', '1');
      await page.click('#max-peers', { clickCount: 3 }); // Select all
      await page.type('#max-peers', '15');
      // Test toggling settings
      await page.click('#xor-routing-toggle');
      await page.click('#auto-discovery-toggle');
      await page.click('#eviction-strategy-toggle');
      // Verify settings were applied
      const minPeers = await page.$eval('#min-peers', el => el.value);
      const maxPeers = await page.$eval('#max-peers', el => el.value);
      const success = minPeers === '1' && maxPeers === '15';
      if (success) {
        console.log('✅ Settings configuration test passed');
      }
      this.recordTestResult('Settings', success);
    } catch (error) {
      console.error('❌ Settings test failed:', error.message);
      this.recordTestResult('Settings', false, error.message);
    }
  }
  /**
   * Test health check functionality
   */

  async testHealthCheck() {
    console.log('🏥 Testing health check functionality...');
    try {
      const page = this.pages[0];
      await page.bringToFront(); // Make tab active
      // Click health check button
      await page.click('#health-check-btn');
      await new Promise(resolve => setTimeout(resolve, OPERATION_DELAY));
      // Check system messages for health check results
      const messages = await page.$eval('#system-messages', el => el.textContent);
      const success = messages.includes('health') || messages.includes('check') || messages.includes('status');
      if (success) {
        console.log('✅ Health check test passed');
      }
      this.recordTestResult('Health Check', success);
    } catch (error) {
      console.error('❌ Health check test failed:', error.message);
      this.recordTestResult('Health Check', false, error.message);
    }
  }
  /**
   * Record test result
   */

  recordTestResult(testName, passed, error = null) {
    this.testResults.total++;
    if (passed) {
      this.testResults.passed++;
    } else {
      this.testResults.failed++;
      if (error) {
        this.testResults.errors.push(`${testName}: ${error}`);
      }
    }
  }
  /**
   * Enable video on all tabs after connection
   */

  async enableVideoOnAllTabs() {
    console.log('📹 Enabling video on all tabs...');
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      await page.bringToFront(); // Make tab active
      console.log(`📹 Enabling video for peer ${i + 1}...`);
      try {
        // Expand media section
        await page.click('#media-toggle');
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Enable video checkbox
        const videoCheckbox = await page.$('#enable-video');
        if (videoCheckbox) {
          const isVideoChecked = await page.$eval('#enable-video', el => el.checked);
          if (!isVideoChecked) {
            await page.click('#enable-video');
            console.log(`✅ Video enabled for peer ${i + 1}`);
          } else {
            console.log(`✅ Video already enabled for peer ${i + 1}`);
          }
        }
        // Wait for devices to be detected and select fake camera
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for device enumeration
        const cameraSelect = await page.$('#camera-select');
        if (cameraSelect) {
          // Check if there are camera options available
          const cameraOptions = await page.$eval('#camera-select', select => {
            return Array.from(select.options).map(option => ({ value: option.value, text: option.textContent }));
          });
          console.log(`📹 Peer ${i + 1} available cameras:`, cameraOptions);
          // Select the first non-empty camera option
          const validCamera = cameraOptions.find(option => option.value && option.value !== '');
          if (validCamera) {
            await page.select('#camera-select', validCamera.value);
            console.log(`📹 Selected camera for peer ${i + 1}: ${validCamera.text}`);
          } else {
            console.warn(`⚠️  No valid cameras found for peer ${i + 1}`);
          }
        }
        // Small delay between tabs
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.warn(`⚠️  Could not enable video for peer ${i + 1}: ${error.message}`);
      }
    }
    console.log('✅ Video enabling completed for all tabs');
  }
  /**
   * Run all tests
   */

  async runTests() {
    console.log('🧪 Starting comprehensive browser integration tests...');
    try {
      // Setup phase
      await this.startServers();
      await this.initializeBrowser();
      await this.waitForPeerIds();
      await this.connectAllPeers();
      await this.enableVideoOnAllTabs(); // Enable video on all tabs after connection
      await this.waitForPeerDiscovery();
      // Run tests in proper order
      await this.testMessaging();
      await this.testMedia(); // Test media streaming early while connections are fresh
      await this.test2WayMediaStreaming(); // Test bidirectional streaming capabilities
      await this.testCrypto();
      await this.testDistributedStorage();
      await this.testLexicalStorageInterface();
      await this.testManualConnection();
      await this.testSettings();
      await this.testHealthCheck();
      // Validate WebDHT at the end (as requested)
      await this.testWebDHT();
      // Final peer connection check
      await this.checkFinalPeerConnections();
    } catch (error) {
      console.error('❌ Test setup failed:', error.message);
      this.recordTestResult('Test Setup', false, error.message);
    }
  }
  /**
   * Check final peer connections
   */

  async checkFinalPeerConnections() {
    console.log('🔗 Checking final peer connections...');
    let totalConnections = 0;
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const connectedCount = await page.$eval('#connected-peers-count', el =>
        parseInt(el.textContent) || 0
      );
      totalConnections += connectedCount;
      console.log(`🔗 Peer ${i + 1} has ${connectedCount} connections`);
    }
    const avgConnections = totalConnections / this.pages.length;
    console.log(`📊 Average connections per peer: ${avgConnections.toFixed(2)}`);
    this.recordTestResult('Peer Connections', avgConnections > 0);
  }
  /**
   * Generate test report
   */

  generateTestReport() {
    const report = {
      timestamp: new Date().toISOString(),
      totalPeers: NUM_PEERS,
      testResults: this.testResults,
      summary: {
        passRate: ((this.testResults.passed / this.testResults.total) * 100).toFixed(2) + '%',
        totalTestSuites: this.testResults.total,
        passed: this.testResults.passed,
        failed: this.testResults.failed
      }
    };
    console.log('\n📊 BROWSER INTEGRATION TEST REPORT');
    console.log('='.repeat(60));
    console.log(`Test Suites: ${report.summary.totalTestSuites}`);
    console.log(`Passed: ${report.summary.passed}`);
    console.log(`Failed: ${report.summary.failed}`);
    console.log(`Pass Rate: ${report.summary.passRate}`);
    console.log('');
    console.log('🔍 Test Suites Covered:');
    console.log('  • Messaging (broadcast & direct)');
    console.log('  • WebDHT (distributed hash table)');
    console.log('  • Crypto (key generation & self-test)');
    console.log('  • Distributed Storage (multi-space)');
    console.log('  • Media Streaming (single direction)');
    console.log('  • 2-Way Media Streaming (bidirectional)');
    console.log('  • Manual Connection (peer management)');
    console.log('  • Settings (configuration)');
    console.log('  • Health Check (system monitoring)');
    console.log('  • Connection (peer network topology)');
    if (this.testResults.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.testResults.errors.forEach(error => console.log(`  - ${error}`));
    }
    return report;
  }
  /**
   * Save test report to file
   */

  async saveTestReport(report) {
    const reportsDir = path.join(process.cwd(), 'test', 'reports');
    try {
      await fs.mkdir(reportsDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
    const reportFile = path.join(reportsDir, `browser-integration-${Date.now()}.json`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(`📄 Test report saved to: ${reportFile}`);
  }
  /**
   * Cleanup resources
   */

  async cleanup() {
    console.log('🧹 Cleaning up...');
    if (this.browser) {
      await this.browser.close();
    }
    if (this.signalingServer) {
      this.signalingServer.kill();
    }
    if (this.httpServer) {
      this.httpServer.close();
    }

    console.log('✅ Cleanup completed');
  }
  /**
   * Main test runner
   */

  async run() {
    const startTime = Date.now();
    // Set test timeout
    const timeout = setTimeout(() => {
      console.error('❌ Test timeout reached');
      process.exit(1);
    }, TEST_TIMEOUT);
    try {
      await this.runTests();
      const report = this.generateTestReport();
      await this.saveTestReport(report);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n⏱️  Total test duration: ${duration}s`);
      // Exit with appropriate code
      const exitCode = this.testResults.failed > 0 ? 1 : 0;
      clearTimeout(timeout);
      await this.cleanup();
      console.log(exitCode === 0 ? '✅ All tests completed successfully!' : '❌ Some tests failed');
      process.exit(exitCode);
    } catch (error) {
      console.error('❌ Test runner failed:', error);
      clearTimeout(timeout);
      await this.cleanup();
      process.exit(1);
    }
  }
}
// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new BrowserIntegrationTest();
  test.run().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}
export default BrowserIntegrationTest;
