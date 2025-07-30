#!/usr/bin/env node

// Simple test to verify maxPeers enforcement works correctly
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const express = require('express');
const path = require('path');

const HTTP_PORT = 8081;
const SIGNALING_PORT = 3001;
const NUM_PEERS = 5; // 5 peers to test maxPeers=3 enforcement

class MaxPeersTest {
  constructor() {
    this.signalingServer = null;
    this.httpServer = null;
    this.browser = null;
    this.pages = [];
  }

  async startServers() {
    console.log('🚀 Starting servers...');

    // Start signaling server
    this.signalingServer = spawn('node', ['websocket-server/server.js'], {
      stdio: 'pipe',
      env: { ...process.env, PORT: SIGNALING_PORT }
    });

    // Start Express HTTP server
    const app = express();

    // Enable CORS
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    app.use('/src', express.static(path.join(process.cwd(), 'src')));
    app.use('/examples/browser', express.static(path.join(process.cwd(), 'examples', 'browser')));
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    this.httpServer = app.listen(HTTP_PORT, () => {
      console.log(`✅ Express server started on port ${HTTP_PORT}`);
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ Servers started successfully');
  }

  async initializeBrowser() {
    console.log(`🌐 Initializing browser with ${NUM_PEERS} tabs...`);
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });

    for (let i = 0; i < NUM_PEERS; i++) {
      const page = await this.browser.newPage();

      await page.goto(`http://localhost:${HTTP_PORT}/examples/browser/index.html?api=ws://localhost:${SIGNALING_PORT}`);
      await page.waitForSelector('#peer-id', { timeout: 30000 });

      await page.evaluate((signalingUrl) => {
        if (window.peerPigeonUI && window.peerPigeonUI.setSignalingServer) {
          window.peerPigeonUI.setSignalingServer(signalingUrl);
        }
      }, `ws://localhost:${SIGNALING_PORT}`);

      this.pages.push(page);
      console.log(`📄 Page ${i + 1} initialized`);

      await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log('✅ Browser initialized with all pages');
  }

  async connectAllPeers() {
    console.log('🔗 Connecting all peers to signaling server...');
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      await page.bringToFront();

      await page.waitForSelector('#connect-btn', { visible: true, timeout: 5000 });
      await page.click('#connect-btn');

      await page.waitForFunction(() => {
        const status = document.querySelector('#status');
        return status && status.textContent === 'Connected';
      }, { timeout: 30000 });

      console.log(`✅ Peer ${i + 1} connected to signaling server`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    console.log('✅ All peers connected to signaling server');
  }

  async waitForPeerDiscovery() {
    console.log('🔍 Waiting for peer discovery...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const connectedCount = await page.$eval('#connected-peers-count', el =>
        parseInt(el.textContent) || 0
      );
      console.log(`🔍 Peer ${i + 1}: connected to ${connectedCount} peers`);
    }
    console.log('✅ Peer discovery phase completed');
  }

  async testMaxPeersEnforcement() {
    console.log('🧪 Testing maxPeers enforcement...');

    // Step 1: Check initial connections (should be limited to 3)
    console.log('\n📊 INITIAL CONNECTION COUNTS (maxPeers=3):');
    let allWithinLimit = true;

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const connectedCount = await page.$eval('#connected-peers-count', el =>
        parseInt(el.textContent) || 0
      );

      const status = connectedCount <= 3 ? '✅' : '❌';
      console.log(`  ${status} Peer ${i + 1}: ${connectedCount}/3 connections`);

      if (connectedCount > 3) {
        allWithinLimit = false;
      }
    }

    if (!allWithinLimit) {
      throw new Error('Some peers exceeded maxPeers=3 limit');
    }

    // Step 2: Change maxPeers to 2 and verify eviction
    console.log('\n🔧 Changing maxPeers to 2 and testing eviction...');
    const testPage = this.pages[0];
    await testPage.bringToFront();

    await testPage.click('#settings-toggle');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await testPage.click('#max-peers', { clickCount: 3 });
    await testPage.type('#max-peers', '2');

    // Wait for eviction to take effect
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if peer 1 now has <= 2 connections
    const newConnectionCount = await testPage.$eval('#connected-peers-count', el =>
      parseInt(el.textContent) || 0
    );

    console.log(`📊 Peer 1 after setting maxPeers=2: ${newConnectionCount}/2 connections`);

    if (newConnectionCount > 2) {
      throw new Error(`Peer 1 has ${newConnectionCount} connections but maxPeers=2`);
    }

    // Step 3: Change maxPeers to 4 and verify more connections can be made
    console.log('\n🔧 Changing maxPeers to 4 and testing expansion...');

    await testPage.click('#max-peers', { clickCount: 3 });
    await testPage.type('#max-peers', '4');

    // Wait for new connections to be established
    await new Promise(resolve => setTimeout(resolve, 5000));

    const finalConnectionCount = await testPage.$eval('#connected-peers-count', el =>
      parseInt(el.textContent) || 0
    );

    console.log(`📊 Peer 1 after setting maxPeers=4: ${finalConnectionCount}/4 connections`);

    console.log('\n✅ MaxPeers enforcement test PASSED');
    return true;
  }

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

  async run() {
    try {
      await this.startServers();
      await this.initializeBrowser();
      await this.connectAllPeers();
      await this.waitForPeerDiscovery();
      await this.testMaxPeersEnforcement();

      console.log('\n🎉 MaxPeers test completed successfully!');
      await this.cleanup();
      process.exit(0);
    } catch (error) {
      console.error('❌ MaxPeers test failed:', error.message);
      await this.cleanup();
      process.exit(1);
    }
  }
}

// Run the test
const test = new MaxPeersTest();
test.run();
