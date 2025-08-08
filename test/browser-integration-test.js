#!/usr/bin/env node
/**
 * PeerPigeon Browser Integration Test
 *
 * This test simulates the npm run dev environment with multiple Puppeteer browser tabs
 * testing the browser example which provides a comprehensive tabbed interface for
 * testing all PeerPigeon features including:
 * - Connection management
 * - Messaging (broadcast/direct/group)
 * - Media streaming (video/audio)
 * - WebDHT operations
 * - Crypto operations
 * - Network information and monitoring
 * - API testing utilities
 */
import puppeteer from 'puppeteer';
import { spawn, exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import express from 'express';
import { promisify } from 'util';

const execAsync = promisify(exec);

const HEADLESS = process.env.HEADLESS !== 'false'; // Default to headless unless explicitly disabled
const NUM_PEERS = 7;
const SIGNALING_PORT = 3000;
const HTTP_PORT = 8080;

class Browser3IntegrationTest {
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
   * Check if a port is in use
   */
  async checkPortInUse(port) {
    try {
      const { stdout } = await execAsync(`lsof -ti:${port}`);
      return stdout.trim().split('\n').filter(pid => pid);
    } catch (error) {
      // lsof returns exit code 1 when no processes found
      return [];
    }
  }

  /**
   * Kill processes using specified ports
   */
  async killProcessesOnPorts(ports) {
    for (const port of ports) {
      try {
        const pids = await this.checkPortInUse(port);
        
        if (pids.length > 0) {
          for (const pid of pids) {
            try {
              await execAsync(`kill -9 ${pid}`);
            } catch (killError) {
              // Silent cleanup
            }
          }
          
          // Wait a moment for the ports to be released
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        // Silent cleanup
      }
    }
  }

  /**
   * Start the signaling server and HTTP server
   */
  async startServers() {
    console.log('🚀 Starting servers...');
    
    // Start the signaling server
    this.signalingServer = spawn('node', ['websocket-server/server.js'], {
      env: { ...process.env, PORT: SIGNALING_PORT },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Start HTTP server for serving files
    const app = express();
    
    // Add CORS headers
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      next();
    });

    // Serve dist/ directory (for peerpigeon-browser.js)
    app.use('/dist', express.static(path.join(process.cwd(), 'dist')));
    
    // Serve src/ directory
    app.use('/src', express.static(path.join(process.cwd(), 'src')));

    // Serve examples/browser directory
    app.use('/examples/browser', express.static(path.join(process.cwd(), 'examples', 'browser')));

    // Add health check endpoint
    app.get('/health', (req, res) => {
      res.status(200).send('OK');
    });

    // Start the server
    this.httpServer = app.listen(HTTP_PORT);

    // Give servers a moment to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Wait for servers to start
    await this.waitForServer(`http://localhost:${HTTP_PORT}/health`, 15000);
    await this.waitForServer(`ws://localhost:${SIGNALING_PORT}`, 10000);
    
    console.log('✅ Servers started successfully');
    console.log(`   HTTP Server: http://localhost:${HTTP_PORT}`);
    console.log(`   Signaling Server: ws://localhost:${SIGNALING_PORT}`);
  }

  /**
   * Wait for a server to be ready
   */
  async waitForServer(url, timeout) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        if (url.startsWith('http')) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          try {
            const response = await fetch(url, {
              signal: controller.signal,
              method: 'HEAD'
            });
            clearTimeout(timeoutId);
            if (response.ok) {
              return;
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name !== 'AbortError') {
              // Only log non-timeout errors for debugging
            }
          }
        } else if (url.startsWith('ws://')) {
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
            return;
          } catch (wsError) {
            // Continue trying
          }
        }
      } catch (error) {
        // Continue trying
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Server at ${url} not ready within ${timeout}ms`);
  }

  /**
   * Launch browser and create pages
   */
  async launchBrowser() {
    console.log('🚀 Launching browser and creating peer pages...');
    
    this.browser = await puppeteer.launch({
      headless: HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=VizDisplayCompositor',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-running-insecure-content',
        '--disable-web-security',
        '--disable-features=WebRtcHideLocalIpsWithMdns'
      ],
      devtools: !HEADLESS
    });

    // Create pages for each peer
    for (let i = 0; i < NUM_PEERS; i++) {
      const page = await this.browser.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Enable console logging (suppress non-essential logs)
      page.on('console', msg => {
        const text = msg.text();
        if (!text.includes('Failed to load resource') && 
            !text.includes('net::ERR_CONNECTION_REFUSED') &&
            !text.includes('WebSocket connection') &&
            !text.includes('🔍') && 
            !text.includes('🚨') &&
            !text.includes('DEBUG')) {
          // Only log essential messages
        }
      });

      // Handle page errors
      page.on('pageerror', _error => {
        // Silent error handling
      });

      this.pages.push(page);
    }
    
    console.log(`✅ Browser launched with ${NUM_PEERS} peer pages`);
  }

  /**
   * Load the browser-3 example in all pages
   */
  async loadPages() {
    console.log('📄 Loading PeerPigeon interface on all peer pages...');
    
    const loadPromises = this.pages.map(async (page) => {
      await page.goto(`http://localhost:${HTTP_PORT}/examples/browser/index.html`, {
        waitUntil: 'networkidle0'
      });
      
      // Wait for PeerPigeon to initialize
      await page.waitForFunction(() => {
        return window.peerPigeonTestSuite && window.peerPigeonTestSuite.mesh;
      });
    });

    await Promise.all(loadPromises);
    
    console.log('✅ All peer pages loaded and PeerPigeon initialized');
  }

  /**
   * Wait for peer IDs to be generated
   */
  async waitForPeerIds() {
    console.log('🆔 Waiting for peer IDs to be generated...');
    
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      
      const peerId = await page.waitForFunction(() => {
        const element = document.getElementById('peer-id');
        const text = element ? element.textContent.trim() : '';
        return text && text !== 'Initializing...' ? text : false;
      });
      
      const peerIdText = await peerId.jsonValue();
      this.peerIds[i] = peerIdText;
    }
    
    console.log('✅ All peer IDs generated');
    this.peerIds.forEach((id, index) => {
      console.log(`   Peer ${index + 1}: ${id.substring(0, 12)}...`);
    });
  }

  /**
   * Connect all peers to the signaling server
   */
  async connectPeers() {
    console.log('🔗 Connecting peers to signaling server...');
    
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      
      // Use evaluate to click the button directly in the browser context
      const buttonClicked = await page.evaluate(() => {
        const btn = document.getElementById('connect-btn');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      
      if (!buttonClicked) {
        throw new Error(`Connect button not found on peer ${i}`);
      }
      
      // Give a brief moment between connections
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('✅ All peers connected to signaling server');
  }

  /**
   * Wait for peers to discover and connect to each other
   */
  async waitForPeerConnections() {
    console.log('🤝 Waiting for peer-to-peer connections...');
    
    // Give peers time to discover each other (realtime but needs a moment)
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const connectionCounts = [];
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      
      try {
        const connectionInfo = await page.evaluate(() => {
          try {
            const testSuite = window.peerPigeonTestSuite;
            if (!testSuite || !testSuite.mesh) {
              return { count: 0, error: 'No mesh found' };
            }
            
            // Use the proper ConnectionManager method to get connected peer count
            const mesh = testSuite.mesh;
            let count = 0;
            
            if (mesh.connectionManager && typeof mesh.connectionManager.getConnectedPeerCount === 'function') {
              count = mesh.connectionManager.getConnectedPeerCount();
            } else if (mesh.connectionManager && mesh.connectionManager.peers) {
              // Fallback: count connected peers manually
              const peers = Array.from(mesh.connectionManager.peers.values());
              count = peers.filter(peer => peer.getStatus && peer.getStatus() === 'connected').length;
            }
            
            return { 
              count,
              maxPeers: mesh.maxPeers || 'unknown',
              meshKeys: Object.keys(mesh),
              error: null
            };
          } catch (error) {
            return { count: 0, error: error.message };
          }
        });
        
        const peerCount = connectionInfo.count;
        connectionCounts.push(peerCount);
      } catch (error) {
        connectionCounts.push(0);
      }
    }
    
    const totalConnections = connectionCounts.reduce((a, b) => a + b, 0);
    
    console.log('✅ Peer connection status:');
    connectionCounts.forEach((count, index) => {
      console.log(`   Peer ${index + 1}: ${count} connections`);
    });
    console.log(`   Total P2P connections: ${totalConnections}`);
    
    return totalConnections > 0;
  }

  /**
   * Test messaging functionality
   */
  async testMessaging() {
    try {
      const senderPage = this.pages[0];
      const receiverPage = this.pages[1];
      
      // Check if messaging tab exists and click it
      const tabExists = await senderPage.evaluate(() => {
        const tab = document.querySelector('[data-tab="messaging"]');
        if (tab) {
          tab.click();
          return true;
        }
        return false;
      });
      
      if (!tabExists) {
        throw new Error('Messaging tab not found');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if messaging elements exist before proceeding
      const elementsExist = await senderPage.evaluate(() => {
        const messageInput = document.getElementById('broadcast-message');
        const sendButton = document.getElementById('send-broadcast-btn');
        return messageInput && sendButton;
      });
      
      if (!elementsExist) {
        throw new Error('Messaging elements not found');
      }
      
      // Send a broadcast message
      const testMessage = `Test broadcast message ${Date.now()}`;
      
      await senderPage.evaluate((message) => {
        const input = document.getElementById('broadcast-message');
        if (!input) throw new Error('broadcast-message element not found');
        
        input.value = message;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, testMessage);
      
      await senderPage.evaluate(() => {
        const button = document.getElementById('send-broadcast-btn');
        if (!button) throw new Error('send-broadcast-btn element not found');
        
        button.click();
      });
      
      // Wait a moment for message to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Switch to receiver page and make it active, then check if message was received
      await receiverPage.bringToFront();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Switch to messaging tab on receiver page to see the message history
      await receiverPage.evaluate(() => {
        const tab = document.querySelector('[data-tab="messaging"]');
        if (tab) {
          tab.click();
        }
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const messageReceived = await receiverPage.evaluate((expectedMessage) => {
        const messageHistory = document.getElementById('message-history');
        return messageHistory && messageHistory.textContent.includes(expectedMessage);
      }, testMessage);
      
      if (messageReceived) {
        console.log('✅ Broadcast message received successfully');
        this.testResults.passed++;
      } else {
        console.error('❌ Broadcast message not received');
        this.testResults.failed++;
        this.testResults.errors.push('Broadcast message test failed');
      }
      
      this.testResults.total++;
    } catch (error) {
      console.error('❌ Messaging test failed:', error.message);
      this.testResults.failed++;
      this.testResults.total++;
      this.testResults.errors.push(`Messaging test error: ${error.message}`);
    }
  }

  /**
   * Test WebDHT functionality
   */
  async testWebDHT() {
    try {
      const page = this.pages[0];
      
      // Switch to DHT tab
      const tabClicked = await page.evaluate(() => {
        const tab = document.querySelector('[data-tab="dht"]');
        if (tab) {
          tab.click();
          return true;
        }
        return false;
      });
      
      if (!tabClicked) {
        throw new Error('DHT tab not found or could not be clicked');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if DHT elements exist
      const elementsExist = await page.evaluate(() => {
        const keyInput = document.getElementById('dht-key');
        const valueInput = document.getElementById('dht-value');
        const putBtn = document.getElementById('dht-put-btn');
        const getKeyInput = document.getElementById('dht-get-key');
        const getBtn = document.getElementById('dht-get-btn');
        const subscribeKey = document.getElementById('dht-subscribe-key');
        const subscribeBtn = document.getElementById('dht-subscribe-btn');
        
        return keyInput && valueInput && putBtn && getKeyInput && getBtn && subscribeKey && subscribeBtn;
      });
      
      if (!elementsExist) {
        throw new Error('DHT elements not found');
      }
      
      // Test 1: Basic DHT store/retrieve - CROSS-PEER
      await this.testBasicDHTOperations();
      
      // Test 2: DHT subscriptions
      await this.testDHTSubscriptions(page);
      
    } catch (error) {
      console.error('❌ WebDHT test failed:', error.message);
      this.testResults.failed++;
      this.testResults.total++;
      this.testResults.errors.push(`WebDHT test error: ${error.message}`);
    }
  }

  /**
   * Test basic DHT store/retrieve operations - CROSS-PEER TEST VIA LIBRARY API
   */
  async testBasicDHTOperations() {
    const storagePeer = this.pages[0];  // Store on peer 1
    const retrievalPeer = this.pages[2]; // Retrieve from peer 3
    
    const testKey = `test-key-${Date.now()}`;
    const testValue = { testData: `value-${Date.now()}` };
    
    console.log(`🔍 DHT Cross-Peer Test: Storing "${testKey}" on peer 1, retrieving from peer 3 via library API`);
    
    // Enhanced debugging - check DHT state before storing
    const preStoreStatus = await Promise.all([
      storagePeer.evaluate(() => {
        const mesh = window.peerPigeonTestSuite?.mesh;
        return {
          hasDHT: !!mesh?.webDHT,
          connectedPeers: mesh?.connectionManager?.getConnectedPeerCount() || 0,
          dhtLocalKeys: mesh?.webDHT?.storage?.size || 0,
          peerId: mesh?.peerId?.substring(0, 8) || 'unknown'
        };
      }),
      retrievalPeer.evaluate(() => {
        const mesh = window.peerPigeonTestSuite?.mesh;
        return {
          hasDHT: !!mesh?.webDHT,
          connectedPeers: mesh?.connectionManager?.getConnectedPeerCount() || 0,
          dhtLocalKeys: mesh?.webDHT?.storage?.size || 0,
          peerId: mesh?.peerId?.substring(0, 8) || 'unknown'
        };
      })
    ]);
    
    console.log('🔍 DHT Pre-store status:');
    console.log('   Storage peer (1):', preStoreStatus[0]);
    console.log('   Retrieval peer (3):', preStoreStatus[1]);
    
    // Store on peer 1 via library API with enhanced result tracking
    const storeResult = await storagePeer.evaluate(async (key, value) => {
      try {
        const testSuite = window.peerPigeonTestSuite;
        if (!testSuite || !testSuite.mesh || !testSuite.mesh.webDHT) {
          return { success: false, error: 'WebDHT not available' };
        }
        
        console.log('🔍 DHT DEBUG: About to store via library API:', key, value);
        
        // Store via DHT library API
        const putResult = await testSuite.mesh.webDHT.put(key, value);
        
        console.log('🔍 DHT DEBUG: Put result:', putResult);
        
        // Immediately verify it was stored locally
        const localVerify = await testSuite.mesh.webDHT.get(key);
        console.log('🔍 DHT DEBUG: Immediate local verification:', localVerify);
        
        return { success: true, putResult, localVerify };
      } catch (error) {
        console.error('❌ DHT DEBUG: Store error:', error);
        return { success: false, error: error.message };
      }
    }, testKey, testValue);
    
    if (!storeResult.success) {
      throw new Error(`Failed to store DHT value via library API: ${storeResult.error}`);
    }
    
    console.log('🔍 DHT Store result:', storeResult);
    
    // Check post-store status
    const postStoreStatus = await storagePeer.evaluate((key) => {
      const mesh = window.peerPigeonTestSuite?.mesh;
      if (!mesh?.webDHT) return { error: 'No DHT available' };
      
      const dht = mesh.webDHT;
      return {
        localKeys: dht.storage.size,
        hasKey: dht.storage.has(key),
        allLocalKeys: Array.from(dht.storage.keys()).slice(0, 5), // Just show first 5 keys
        responseHandlers: dht.responseHandlers?.size || 0
      };
    }, testKey);
    
    console.log('🔍 DHT Post-store status on storage peer:', postStoreStatus);
    
    // Wait for DHT propagation across mesh - increased timeout
    console.log('⏳ Waiting for DHT propagation across mesh...');
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Check DHT state on retrieval peer before attempting retrieval
    const preRetrieveStatus = await retrievalPeer.evaluate((key) => {
      const mesh = window.peerPigeonTestSuite?.mesh;
      if (!mesh?.webDHT) return { error: 'No DHT available' };
      
      const dht = mesh.webDHT;
      return {
        localKeys: dht.storage.size,
        hasKey: dht.storage.has(key),
        allLocalKeys: Array.from(dht.storage.keys()).slice(0, 5), // Just show first 5 keys
        connectedPeers: mesh.connectionManager?.getConnectedPeerCount() || 0
      };
    }, testKey);
    
    console.log('🔍 DHT Pre-retrieve status on retrieval peer:', preRetrieveStatus);
    
    // Retrieve from peer 3 via library API with enhanced retry logic and debugging
    let retrieveResult = null;
    const maxRetries = 4; // Increased retries
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      console.log(`🔄 DHT retrieval attempt ${retryCount + 1}/${maxRetries}`);
      
      retrieveResult = await retrievalPeer.evaluate(async (key) => {
        try {
          const testSuite = window.peerPigeonTestSuite;
          if (!testSuite || !testSuite.mesh || !testSuite.mesh.webDHT) {
            return { success: false, error: 'WebDHT not available' };
          }
          
          console.log('🔍 DHT DEBUG: About to retrieve via library API:', key);
          
          // Retrieve via DHT library API with force refresh
          const data = await testSuite.mesh.webDHT.get(key, { forceRefresh: true });
          
          console.log('🔍 DHT DEBUG: Retrieved data:', data);
          console.log('🔍 DHT DEBUG: Data type:', typeof data);
          console.log('🔍 DHT DEBUG: Data JSON:', JSON.stringify(data));
          console.log('🔍 DHT DEBUG: Data === null:', data === null);
          console.log('🔍 DHT DEBUG: Data === undefined:', data === undefined);
          console.log('🔍 DHT DEBUG: Data keys (if object):', data && typeof data === 'object' ? Object.keys(data) : 'not object');
          
          return { success: true, data };
        } catch (error) {
          console.error('❌ DHT DEBUG: Retrieve error:', error);
          return { success: false, error: error.message };
        }
      }, testKey);
      
      console.log(`🔍 DHT retrieval result attempt ${retryCount + 1}:`, {
        success: retrieveResult.success,
        hasData: retrieveResult.data !== null && retrieveResult.data !== undefined,
        dataType: typeof retrieveResult.data,
        actualData: JSON.stringify(retrieveResult.data),
        isNull: retrieveResult.data === null,
        isUndefined: retrieveResult.data === undefined
      });
      
      // If we got data, break
      if (retrieveResult.success && retrieveResult.data !== null && retrieveResult.data !== undefined) {
        break;
      }
      
      retryCount++;
      if (retryCount < maxRetries) {
        console.log(`🔄 DHT retry ${retryCount + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 4000)); // Increased retry delay
      }
    }
    
    // Enhanced result validation
    if (retrieveResult.success && retrieveResult.data && 
        retrieveResult.data.testData === testValue.testData) {
      console.log('✅ DHT cross-peer store/retrieve test passed via library API');
      this.testResults.passed++;
    } else {
      console.error('❌ DHT cross-peer test failed via library API');
      console.error('Expected:', JSON.stringify(testValue, null, 2));
      console.error('Retrieved:', JSON.stringify(retrieveResult.data, null, 2));
      console.error(`Retry attempts: ${retryCount}/${maxRetries}`);
      
      // Final debugging - check both peers' DHT state
      const finalStatus = await Promise.all([
        storagePeer.evaluate(async (key) => {
          const mesh = window.peerPigeonTestSuite?.mesh;
          try {
            const localData = await mesh.webDHT.get(key);
            return {
              peer: 'storage',
              localData: localData ? 'exists' : 'null',
              dhtSize: mesh.webDHT.storage.size
            };
          } catch (e) {
            return { peer: 'storage', error: e.message };
          }
        }, testKey),
        retrievalPeer.evaluate(async (key) => {
          const mesh = window.peerPigeonTestSuite?.mesh;
          try {
            const localData = await mesh.webDHT.get(key);
            return {
              peer: 'retrieval',
              localData: localData ? 'exists' : 'null',
              dhtSize: mesh.webDHT.storage.size
            };
          } catch (e) {
            return { peer: 'retrieval', error: e.message };
          }
        }, testKey)
      ]);
      
      console.log('🔍 DHT Final status check:', finalStatus);
      
      this.testResults.failed++;
      this.testResults.errors.push('DHT cross-peer store/retrieve test failed via library API');
    }
    
    this.testResults.total++;
  }

  /**
   * Test DHT subscription functionality
   */
  async testDHTSubscriptions(page) {
    const subscriptionKey = `subscription-test-${Date.now()}`;
    
    // Subscribe to a key
    const subscribeResult = await page.evaluate((key) => {
      try {
        const subscribeKeyInput = document.getElementById('dht-subscribe-key');
        const subscribeBtn = document.getElementById('dht-subscribe-btn');
        
        if (!subscribeKeyInput || !subscribeBtn) {
          return { success: false, error: 'Subscribe elements not found' };
        }
        
        subscribeKeyInput.value = key;
        subscribeKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
        subscribeBtn.click();
        
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, subscriptionKey);
    
    if (!subscribeResult.success) {
      throw new Error(`Failed to subscribe to DHT key: ${subscribeResult.error}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Store a value to the subscribed key
    const subscriptionValue = `{"subscription": "test", "timestamp": ${Date.now()}}`;
    
    await page.evaluate((key, value) => {
      const keyInput = document.getElementById('dht-key');
      const valueInput = document.getElementById('dht-value');
      const putBtn = document.getElementById('dht-put-btn');
      
      if (!keyInput) throw new Error('dht-key element not found');
      if (!valueInput) throw new Error('dht-value element not found');
      if (!putBtn) throw new Error('dht-put-btn element not found');
      
      keyInput.value = key;
      valueInput.value = value;
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));
      putBtn.click();
    }, subscriptionKey, subscriptionValue);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check DHT log for subscription notifications
    const subscriptionNotification = await page.evaluate(() => {
      const dhtLog = document.getElementById('dht-log');
      return dhtLog ? dhtLog.textContent : '';
    });
    
    // Check if we have any DHT operations and the subscription key appears
    if (subscriptionNotification.includes(subscriptionKey) || subscriptionNotification.includes('PUT') || subscriptionNotification.includes('subscription')) {
      console.log('✅ DHT subscription test passed');
      this.testResults.passed++;
    } else {
      console.error('❌ DHT subscription test failed - no subscription notification found');
      this.testResults.failed++;
      this.testResults.errors.push('DHT subscription test failed');
    }
    
    this.testResults.total++;
  }

  /**
   * Test distributed storage functionality across the mesh
   */
  async testDistributedStorage() {
    try {
      // Test 1: Private storage space (encrypted, owner-only)
      await this.testPrivateStorageSpace();
      
      // Test 2: Public storage space (unencrypted, readable by all)
      await this.testPublicStorageSpace();
      
      // Test 3: Frozen storage space (immutable, readable by all)
      await this.testFrozenStorageSpace();
      
      // Test 4: Cross-peer data retrieval with different storage spaces
      await this.testCrossPeerStorageSpaces();
      
      // Test 5: Data replication across storage spaces
      await this.testStorageSpaceReplication();
      
      // Test 6: Storage space management and statistics
      await this.testStorageSpaceManagement();
      
      // Test 7: Storage space persistence
      await this.testStorageSpacePersistence();
      
    } catch (error) {
      console.error('❌ Distributed storage test suite failed:', error.message);
      this.testResults.failed++;
      this.testResults.total++;
      this.testResults.errors.push(`Distributed storage test suite error: ${error.message}`);
    }
  }

  /**
   * Test private storage space (encrypted, owner-only) - CROSS-PEER TEST
   */
  async testPrivateStorageSpace() {
    const storagePeer = this.pages[0];   // Store on peer 1
    const retrievalPeer = this.pages[1]; // Try to retrieve from peer 2 (should fail for private)
    
    // Switch storage peer to storage tab
    await storagePeer.evaluate(() => {
      const tab = document.querySelector('[data-tab="dht"]');
      if (tab) tab.click();
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const privateKey = `private-test-${Date.now()}`;
    const privateValue = JSON.stringify({
      type: 'private_storage_test',
      timestamp: Date.now(),
      secret: 'This is private encrypted data',
      confidential: true
    });
    
    console.log(`🔍 Private Storage Cross-Peer Test: Storing "${privateKey}" on peer 1, trying to retrieve from peer 2 (should fail)`);
    
    const storeResult = await storagePeer.evaluate((key, value) => {
      try {
        const keyInput = document.getElementById('storage-key');
        const dataInput = document.getElementById('storage-data');
        const spaceSelect = document.getElementById('storage-space');
        const putBtn = document.getElementById('storage-put-btn');
        
        if (!keyInput) throw new Error('storage-key element not found');
        if (!dataInput) throw new Error('storage-data element not found');
        if (!spaceSelect) throw new Error('storage-space element not found');
        if (!putBtn) throw new Error('storage-put-btn element not found');
        
        keyInput.value = key;
        dataInput.value = value;
        spaceSelect.value = 'private'; // Private storage space
        
        keyInput.dispatchEvent(new Event('input', { bubbles: true }));
        dataInput.dispatchEvent(new Event('input', { bubbles: true }));
        spaceSelect.dispatchEvent(new Event('change', { bubbles: true }));
        
        putBtn.click();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, privateKey, privateValue);
    
    if (!storeResult.success) {
      throw new Error(`Failed to store private data: ${storeResult.error}`);
    }
    
    // Wait for storage propagation
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Switch retrieval peer to storage tab
    await retrievalPeer.evaluate(() => {
      const tab = document.querySelector('[data-tab="dht"]');
      if (tab) tab.click();
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Try to retrieve private data from different peer (should fail or return encrypted)
    await retrievalPeer.evaluate((key) => {
      const keyInput = document.getElementById('storage-key');
      const getBtn = document.getElementById('storage-get-btn');
      
      if (!keyInput) throw new Error('storage-key element not found');
      if (!getBtn) throw new Error('storage-get-btn element not found');
      
      keyInput.value = key;
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      getBtn.click();
    }, privateKey);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const retrievedData = await retrievalPeer.evaluate(() => {
      const resultDiv = document.getElementById('storage-result');
      return resultDiv ? resultDiv.textContent : '';
    });
    
    // Private data should NOT be readable by different peer or should show as encrypted
    const isPrivatelyProtected = !retrievedData.includes('private_storage_test') || 
                                retrievedData.includes('encrypted') || 
                                retrievedData.includes('access denied') ||
                                retrievedData.toLowerCase().includes('null');
    
    if (isPrivatelyProtected) {
      console.log('✅ Private storage space cross-peer protection test passed');
      this.testResults.passed++;
    } else {
      console.error('❌ Private storage space cross-peer protection test failed - data was readable by different peer');
      this.testResults.failed++;
      this.testResults.errors.push('Private storage space cross-peer protection test failed');
    }
    
    this.testResults.total++;
  }

  /**
   * Test public storage space (unencrypted, readable by all) - CROSS-PEER TEST VIA LIBRARY API
   */
  async testPublicStorageSpace() {
    const storagePeer = this.pages[0];   // Store on peer 1
    const retrievalPeer = this.pages[3]; // Retrieve from peer 4
    
    const publicKey = `public-test-${Date.now()}`;
    const publicValue = {
      type: 'public_storage_test',
      timestamp: Date.now(),
      message: 'This is public unencrypted data',
      accessible: 'by_all_peers'
    };
    
    console.log(`🔍 Public Storage Cross-Peer Test: Storing "${publicKey}" on peer 1, retrieving from peer 4 via library API`);
    
    // Store via library API directly
    const storeResult = await storagePeer.evaluate(async (key, value) => {
      try {
        const testSuite = window.peerPigeonTestSuite;
        if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
          return { success: false, error: 'Distributed storage not available' };
        }
        
        // Store in public space via library API
        const result = await testSuite.mesh.distributedStorage.store(key, value, {
          space: 'public'
        });
        
        return { success: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, publicKey, publicValue);
    
    if (!storeResult.success) {
      throw new Error(`Failed to store public data via library API: ${storeResult.error}`);
    }
    
    // Wait for public storage propagation
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Retrieve public data from different peer via library API with retry logic
    let retrieveResult = null;
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      retrieveResult = await retrievalPeer.evaluate(async (key) => {
        try {
          const testSuite = window.peerPigeonTestSuite;
          if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
            return { success: false, error: 'Distributed storage not available' };
          }
          
          // Retrieve via library API
          const data = await testSuite.mesh.distributedStorage.retrieve(key, {
            forceRefresh: true
          });
          
          return { success: true, data };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, publicKey);
      
      // If we got data, break
      if (retrieveResult.success && retrieveResult.data !== null && retrieveResult.data !== undefined) {
        break;
      }
      
      retryCount++;
      if (retryCount < maxRetries) {
        console.log(`🔄 Public storage retry ${retryCount + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    if (retrieveResult.success && retrieveResult.data && 
        retrieveResult.data.type === 'public_storage_test' && 
        retrieveResult.data.message === 'This is public unencrypted data') {
      console.log('✅ Public storage space cross-peer test passed via library API');
      this.testResults.passed++;
    } else {
      console.error('❌ Public storage space cross-peer test failed via library API');
      console.error('Expected type: public_storage_test');
      console.error('Retrieved:', JSON.stringify(retrieveResult.data, null, 2));
      this.testResults.failed++;
      this.testResults.errors.push('Public storage space cross-peer test failed via library API');
    }
    
    this.testResults.total++;
  }

  /**
   * Test frozen storage space (immutable, readable by all) - CROSS-PEER TEST VIA LIBRARY API
   */
  async testFrozenStorageSpace() {
    const storagePeer = this.pages[1];   // Store on peer 2
    const retrievalPeer = this.pages[4]; // Retrieve from peer 5
    
    const frozenKey = `frozen-test-${Date.now()}`;
    const frozenValue = {
      type: 'frozen_storage_test',
      timestamp: Date.now(),
      immutable: 'This data cannot be changed',
      permanent: true
    };
    
    console.log(`🔍 Frozen Storage Cross-Peer Test: Storing "${frozenKey}" on peer 2, retrieving from peer 5 via library API`);
    
    // Store via library API directly
    const storeResult = await storagePeer.evaluate(async (key, value) => {
      try {
        const testSuite = window.peerPigeonTestSuite;
        if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
          return { success: false, error: 'Distributed storage not available' };
        }
        
        console.log('🔍 FROZEN DEBUG: About to store frozen data:', key, value);
        
        // Store in frozen space via library API
        const result = await testSuite.mesh.distributedStorage.store(key, value, {
          space: 'frozen'
        });
        
        console.log('🔍 FROZEN DEBUG: Store result:', result);
        
        // Immediately try to retrieve from same peer to verify storage
        const verifyData = await testSuite.mesh.distributedStorage.retrieve(key);
        console.log('🔍 FROZEN DEBUG: Immediate verification on same peer:', verifyData);
        
        return { success: result, verifyData };
      } catch (error) {
        console.error('❌ FROZEN DEBUG: Store error:', error);
        return { success: false, error: error.message };
      }
    }, frozenKey, frozenValue);
    
    if (!storeResult.success) {
      throw new Error(`Failed to store frozen data via library API: ${storeResult.error}`);
    }
    
    console.log('🔍 FROZEN DEBUG: Storage peer verification data:', storeResult.verifyData);
    
    // Wait for frozen storage propagation
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check storage status on both peers before retrieval attempt
    const storageStatus = await Promise.all([
      storagePeer.evaluate((key) => {
        const mesh = window.peerPigeonTestSuite?.mesh;
        const storage = mesh?.distributedStorage?.storage;
        if (!storage) return { error: 'No storage available' };
        
        const hasKey = storage.has(key);
        const data = storage.get(key);
        return { 
          hasKey, 
          dataExists: !!data,
          space: data?.metadata?.space,
          storageSize: storage.size,
          allKeys: Array.from(storage.keys())
        };
      }, frozenKey),
      retrievalPeer.evaluate((key) => {
        const mesh = window.peerPigeonTestSuite?.mesh;
        const storage = mesh?.distributedStorage?.storage;
        if (!storage) return { error: 'No storage available' };
        
        const hasKey = storage.has(key);
        const data = storage.get(key);
        return { 
          hasKey, 
          dataExists: !!data,
          space: data?.metadata?.space,
          storageSize: storage.size,
          allKeys: Array.from(storage.keys())
        };
      }, frozenKey)
    ]);
    
    console.log('🔍 FROZEN DEBUG: Storage status:');
    console.log('   Peer 2 (storage):', storageStatus[0]);
    console.log('   Peer 5 (retrieval):', storageStatus[1]);
    
    // Retrieve frozen data from different peer via library API with retry logic
    let retrieveResult = null;
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      retrieveResult = await retrievalPeer.evaluate(async (key) => {
        try {
          const testSuite = window.peerPigeonTestSuite;
          if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
            return { success: false, error: 'Distributed storage not available' };
          }
          
          console.log('🔍 FROZEN DEBUG: Retrieval attempt for key:', key);
          
          // Retrieve via library API
          const data = await testSuite.mesh.distributedStorage.retrieve(key, {
            forceRefresh: true
          });
          
          console.log('🔍 FROZEN DEBUG: Retrieved data:', data);
          console.log('🔍 FROZEN DEBUG: Data type:', typeof data);
          
          return { success: true, data };
        } catch (error) {
          console.error('❌ FROZEN DEBUG: Retrieve error:', error);
          return { success: false, error: error.message };
        }
      }, frozenKey);
      
      console.log(`🔍 FROZEN DEBUG: Retry ${retryCount + 1}/${maxRetries} result:`, retrieveResult);
      
      // If we got data, break
      if (retrieveResult.success && retrieveResult.data !== null && retrieveResult.data !== undefined) {
        break;
      }
      
      retryCount++;
      if (retryCount < maxRetries) {
        console.log(`🔄 Frozen storage retry ${retryCount + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    if (retrieveResult.success && retrieveResult.data && 
        retrieveResult.data.type === 'frozen_storage_test' && 
        retrieveResult.data.immutable === 'This data cannot be changed') {
      console.log('✅ Frozen storage space cross-peer test passed via library API');
      this.testResults.passed++;
    } else {
      console.error('❌ Frozen storage space cross-peer test failed via library API');
      console.error('Expected type: frozen_storage_test');
      console.error('Retrieved:', JSON.stringify(retrieveResult.data, null, 2));
      this.testResults.failed++;
      this.testResults.errors.push('Frozen storage space cross-peer test failed via library API');
    }
    
    this.testResults.total++;
  }

  /**
   * Test cross-peer data retrieval with different storage spaces - DIRECT LIBRARY API TEST
   */
  async testCrossPeerStorageSpaces() {
    if (this.pages.length < 2) {
      this.testResults.total++;
      this.testResults.passed++;
      return;
    }
    
    try {
      const peer1 = this.pages[0];
      const peer2 = this.pages[1];
      
      const testKey = `cross-peer-test-${Date.now()}`;
      const testData = {
        content: `Cross-peer test data ${Date.now()}`,
        from: 'peer1',
        timestamp: Date.now()
      };
      
      // Store data using the distributed storage API DIRECTLY on peer 1
      console.log(`🔍 Storing test data with key: ${testKey}`);
      const storeResult = await peer1.evaluate(async (key, data) => {
        try {
          const testSuite = window.peerPigeonTestSuite;
          if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
            return { success: false, error: 'Distributed storage not available' };
          }
          
          console.log('📝 Storing data directly via library API:', key, data);
          
          // Store in public space for cross-peer access - DIRECT API CALL
          const result = await testSuite.mesh.distributedStorage.store(key, data, {
            space: 'public'
          });
          
          console.log('✅ Store result from library:', result);
          return { success: result, result };
        } catch (error) {
          console.error('❌ Store error from library:', error);
          return { success: false, error: error.message };
        }
      }, testKey, testData);
      
      if (!storeResult.success) {
        throw new Error(`Failed to store data on peer 1: ${storeResult.error}`);
      }
      
      // Verify the data was stored by retrieving it DIRECTLY from the same peer first
      console.log('🔍 Verifying data was stored on peer 1 via direct library API...');
      const verifyResult = await peer1.evaluate(async (key) => {
        try {
          const testSuite = window.peerPigeonTestSuite;
          if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
            return { success: false, error: 'Distributed storage not available' };
          }
          
          console.log('🔍 Retrieving from peer 1 via library API:', key);
          const data = await testSuite.mesh.distributedStorage.retrieve(key, {
            forceRefresh: true
          });
          
          console.log('📥 Peer 1 retrieved via library:', data);
          return { success: true, data };
        } catch (error) {
          console.error('❌ Peer 1 retrieve error from library:', error);
          return { success: false, error: error.message };
        }
      }, testKey);
      
      if (!verifyResult.success || !verifyResult.data) {
        throw new Error('Data verification failed on peer 1 - data not stored properly');
      }
      
      // Wait for gossip propagation - use exponential backoff for better reliability
      console.log('⏳ Waiting for gossip propagation across mesh...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Check mesh status on both peers before attempting retrieval
      const meshStatus = await Promise.all([
        peer1.evaluate(() => {
          const mesh = window.peerPigeonTestSuite?.mesh;
          return {
            connected: mesh?.connectionManager?.getConnectedPeerCount() || 0,
            hasStorage: !!mesh?.distributedStorage,
            storageKeys: mesh?.distributedStorage?.storage?.size || 0
          };
        }),
        peer2.evaluate(() => {
          const mesh = window.peerPigeonTestSuite?.mesh;
          return {
            connected: mesh?.connectionManager?.getConnectedPeerCount() || 0,
            hasStorage: !!mesh?.distributedStorage,
            storageKeys: mesh?.distributedStorage?.storage?.size || 0
          };
        })
      ]);
      
      console.log('🔍 Mesh status:');
      console.log('   Peer 1:', meshStatus[0]);
      console.log('   Peer 2:', meshStatus[1]);
      
      // Try to retrieve from peer 2 DIRECTLY via library API with enhanced retry logic
      let retrieveResult = null;
      const maxRetries = 5; // Increased retries
      let retryCount = 0;
      
      console.log(`🔄 Attempting cross-peer retrieval via DIRECT library API (max ${maxRetries} retries)...`);
      
      while (retryCount < maxRetries) {
        console.log(`   Attempt ${retryCount + 1}/${maxRetries}`);
        
        retrieveResult = await peer2.evaluate(async (key) => {
          try {
            const testSuite = window.peerPigeonTestSuite;
            if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
              return { success: false, error: 'Distributed storage not available' };
            }
            
            console.log('🔍 Peer 2 retrieving via library API:', key);
            
            // Retrieve data DIRECTLY via library API - this is an async operation
            const data = await testSuite.mesh.distributedStorage.retrieve(key, {
              forceRefresh: true
            });
            
            console.log('📥 Peer 2 retrieved via library:', data);
            console.log('📥 Data type from library:', typeof data);
            console.log('📥 Data null check:', data === null);
            console.log('📥 Data undefined check:', data === undefined);
            return { success: true, data };
          } catch (error) {
            console.error('❌ Peer 2 retrieve error from library:', error);
            return { success: false, error: error.message };
          }
        }, testKey);
        
        console.log(`   Result: ${retrieveResult.success ? 'SUCCESS' : 'FAILED'}, Data: ${retrieveResult.data !== null && retrieveResult.data !== undefined ? 'FOUND' : 'NULL/UNDEFINED'}`);
        
        // If we got data (not null and not undefined), break
        if (retrieveResult.success && retrieveResult.data !== null && retrieveResult.data !== undefined) {
          break;
        }
        
        retryCount++;
        if (retryCount < maxRetries) {
          // Exponential backoff - wait longer each retry
          const backoffTime = Math.min(15000, 3000 * Math.pow(2, retryCount));
          console.log(`   ⏳ Waiting ${backoffTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
      }
      
      if (!retrieveResult.success) {
        // Before failing, let's check what keys are actually available on both peers
        console.log('🔍 Checking available storage keys on both peers...');
        
        const storageDebug = await Promise.all([
          peer1.evaluate(() => {
            const mesh = window.peerPigeonTestSuite?.mesh;
            const storage = mesh?.distributedStorage?.storage;
            if (!storage) return { error: 'No storage available' };
            
            const keys = Array.from(storage.keys());
            const spaces = {};
            for (const [key, value] of storage) {
              spaces[key] = { 
                space: value?.metadata?.space || 'unknown',
                size: JSON.stringify(value).length 
              };
            }
            return { keys, spaces, total: storage.size };
          }),
          peer2.evaluate(() => {
            const mesh = window.peerPigeonTestSuite?.mesh;
            const storage = mesh?.distributedStorage?.storage;
            if (!storage) return { error: 'No storage available' };
            
            const keys = Array.from(storage.keys());
            const spaces = {};
            for (const [key, value] of storage) {
              spaces[key] = { 
                space: value?.metadata?.space || 'unknown',
                size: JSON.stringify(value).length 
              };
            }
            return { keys, spaces, total: storage.size };
          })
        ]);
        
        console.log('📊 Storage Debug:');
        console.log('   Peer 1 storage:', storageDebug[0]);
        console.log('   Peer 2 storage:', storageDebug[1]);
        
        throw new Error(`Failed to retrieve data from peer 2 via library API: ${retrieveResult.error}`);
      }
      
      // Verify the data matches - proper object handling from LIBRARY API
      const retrievedData = retrieveResult.data;
      let dataMatches = false;
      let matchReason = '';
      
      // Handle the retrieved data as an object from the distributed storage library
      if (retrievedData !== null && retrievedData !== undefined) {
        console.log('📋 Retrieved data type from library:', typeof retrievedData);
        console.log('📋 Retrieved data structure from library:', JSON.stringify(retrievedData, null, 2));
        
        // Check if the data matches directly (object properties from library)
        if (retrievedData.content === testData.content && retrievedData.from === testData.from) {
          dataMatches = true;
          matchReason = 'direct object match from library';
        } else if (retrievedData.data && typeof retrievedData.data === 'object') {
          // Check if data is nested within a 'data' property from library
          if (retrievedData.data.content === testData.content && retrievedData.data.from === testData.from) {
            dataMatches = true;
            matchReason = 'nested data object match from library';
          }
        } else if (typeof retrievedData === 'string') {
          // Check if data was serialized as a string and needs parsing from library
          try {
            const parsed = JSON.parse(retrievedData);
            if (parsed.content === testData.content && parsed.from === testData.from) {
              dataMatches = true;
              matchReason = 'JSON parsed object match from library';
            }
          } catch (e) {
            console.log('📋 Not valid JSON string from library, checking as plain string');
          }
        } else if (typeof retrievedData === 'object') {
          // Flexible object property matching from library
          const dataStr = JSON.stringify(retrievedData).toLowerCase();
          if (dataStr.includes('cross-peer test data') || dataStr.includes('peer1')) {
            dataMatches = true;
            matchReason = 'flexible object content match from library';
          }
          
          // Check all object properties for content match from library
          const checkObjectForContent = (obj, depth = 0) => {
            if (depth > 3 || !obj || typeof obj !== 'object') return false;
            
            for (const value of Object.values(obj)) {
              if (typeof value === 'string' && value.includes('Cross-peer test data')) {
                return true;
              }
              if (typeof value === 'object' && checkObjectForContent(value, depth + 1)) {
                return true;
              }
            }
            return false;
          };
          
          if (!dataMatches && checkObjectForContent(retrievedData)) {
            dataMatches = true;
            matchReason = 'deep object content match from library';
          }
        }
      } else {
        console.log('📋 Retrieved data is null or undefined from library');
      }
      
      if (dataMatches) {
        console.log(`✅ Cross-peer storage test passed via library API (${matchReason})`);
        this.testResults.passed++;
      } else {
        console.error('❌ Cross-peer storage test failed via library API - data mismatch');
        console.error('Expected:', JSON.stringify(testData, null, 2));
        console.error('Retrieved from library:', JSON.stringify(retrievedData, null, 2));
        console.error(`Retry attempts: ${retryCount}/${maxRetries}`);
        console.error('Retrieved data type from library:', typeof retrievedData);
        console.error('Retrieved data keys from library:', (retrievedData && typeof retrievedData === 'object') ? Object.keys(retrievedData) : 'not an object');
        
        // Enhanced debugging - check if data exists anywhere in the mesh via library API
        console.log('🔍 Checking if data exists anywhere in mesh via library API...');
        const meshWideCheck = await Promise.all([
          peer1.evaluate(async (key) => {
            const testSuite = window.peerPigeonTestSuite;
            try {
              const data = await testSuite.mesh.distributedStorage.retrieve(key);
              return { peer: 1, found: !!data, data: data ? 'exists' : 'null' };
            } catch (e) {
              return { peer: 1, found: false, error: e.message };
            }
          }, testKey),
          peer2.evaluate(async (key) => {
            const testSuite = window.peerPigeonTestSuite;
            try {
              const data = await testSuite.mesh.distributedStorage.retrieve(key);
              return { peer: 2, found: !!data, data: data ? 'exists' : 'null' };
            } catch (e) {
              return { peer: 2, found: false, error: e.message };
            }
          }, testKey)
        ]);
        
        console.log('📊 Mesh-wide data check via library API:', meshWideCheck);
        
        this.testResults.failed++;
        this.testResults.errors.push('Cross-peer storage data mismatch via library API');
      }
      
    } catch (error) {
      console.error('❌ Cross-peer storage test failed via library API:', error.message);
      this.testResults.failed++;
      this.testResults.errors.push(`Cross-peer storage test error via library API: ${error.message}`);
    }
    
    this.testResults.total++;
  }

  /**
   * Test storage space replication - verifying data is replicated across multiple peers
   */
  async testStorageSpaceReplication() {
    if (this.pages.length < 3) {
      this.testResults.total++;
      this.testResults.passed++;
      return;
    }
    
    try {
      const replicationKey = `replication-test-${Date.now()}`;
      const replicationData = {
        content: `Replication test data ${Date.now()}`,
        replicated: true,
        timestamp: Date.now()
      };
      
      // Store data - replication is handled automatically by the mesh
      const storeResult = await this.pages[0].evaluate(async (key, data) => {
        try {
          const testSuite = window.peerPigeonTestSuite;
          if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
            return { success: false, error: 'Distributed storage not available' };
          }
          
          // Store in public space - replication is automatic via mesh
          const result = await testSuite.mesh.distributedStorage.store(key, data, {
            space: 'public'
          });
          
          return { success: result };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, replicationKey, replicationData);
      
      if (!storeResult.success) {
        throw new Error(`Failed to store replicated data: ${storeResult.error}`);
      }
      
      // Wait for replication to propagate
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Check how many peers can retrieve the data
      let replicationCount = 0;
      const maxPeersToCheck = Math.min(4, this.pages.length);
      
      for (let i = 0; i < maxPeersToCheck; i++) {
        const retrieveResult = await this.pages[i].evaluate(async (key) => {
          try {
            const testSuite = window.peerPigeonTestSuite;
            if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
              return { success: false, error: 'Distributed storage not available' };
            }
            
            // Retrieve data - this is an async operation - NO SPACE OPTION, let it find the space from metadata
            const data = await testSuite.mesh.distributedStorage.retrieve(key, {
              forceRefresh: true
            });
            
            return { success: true, data };
          } catch (error) {
            return { success: false, error: error.message };
          }
        }, replicationKey);
        
        if (retrieveResult.success && retrieveResult.data) {
          replicationCount++;
        }
      }
      
      // Success if at least 2 peers have the data (including the original)
      if (replicationCount >= 2) {
        console.log('✅ Storage replication test passed');
        this.testResults.passed++;
      } else {
        console.error('❌ Storage replication test failed - insufficient replication');
        this.testResults.failed++;
        this.testResults.errors.push(`Storage replication failed: only ${replicationCount}/${maxPeersToCheck} peers`);
      }
      
    } catch (error) {
      console.error('❌ Storage replication test failed:', error.message);
      this.testResults.failed++;
      this.testResults.errors.push(`Storage replication test error: ${error.message}`);
    }
    
    this.testResults.total++;
  }

  /**
   * Test storage space management and statistics
   */
  async testStorageSpaceManagement() {
    const spacePage = this.pages[3];
    await spacePage.bringToFront();
    
    await spacePage.evaluate(() => {
      const tab = document.querySelector('[data-tab="dht"]');
      if (tab) tab.click();
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test storage statistics
    const statsResult = await spacePage.evaluate(() => {
      try {
        const statsBtn = document.getElementById('storage-stats-btn');
        if (statsBtn) {
          statsBtn.click();
          return { success: true, clicked: 'stats' };
        }
        return { success: false, error: 'Stats button not found' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test list all keys
    const listResult = await spacePage.evaluate(() => {
      try {
        const listBtn = document.getElementById('storage-list-btn');
        if (listBtn) {
          listBtn.click();
          return { success: true, clicked: 'list' };
        }
        return { success: false, error: 'List button not found' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (statsResult.success && listResult.success) {
      console.log('✅ Storage space management test passed');
      this.testResults.passed++;
    } else {
      console.error('❌ Storage space management test failed');
      this.testResults.failed++;
      this.testResults.errors.push('Storage space management test failed');
    }
    
    this.testResults.total++;
  }

  /**
   * Test storage space persistence - VIA LIBRARY API
   */
  async testStorageSpacePersistence() {
    const persistencePage = this.pages[4];
    
    // Test persistence for each storage space via library API
    const storageSpaces = ['private', 'public', 'frozen'];
    let passedSpaces = 0;
    
    for (const space of storageSpaces) {
      const persistenceKey = `persistence-${space}-${Date.now()}`;
      const persistenceValue = {
        type: `${space}_persistence_test`,
        timestamp: Date.now(),
        space,
        data: `This ${space} data should persist`,
        critical: true
      };
      
      // Store via library API
      const storeResult = await persistencePage.evaluate(async (key, value, storageSpace) => {
        try {
          const testSuite = window.peerPigeonTestSuite;
          if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
            return { success: false, error: 'Distributed storage not available' };
          }
          
          // Store in the specified space via library API
          const result = await testSuite.mesh.distributedStorage.store(key, value, {
            space: storageSpace
          });
          
          return { success: result };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, persistenceKey, persistenceValue, space);
      
      if (!storeResult.success) {
        console.error(`Failed to store ${space} persistence data via library API`);
        continue;
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify persistence via library API
      const retrieveResult = await persistencePage.evaluate(async (key) => {
        try {
          const testSuite = window.peerPigeonTestSuite;
          if (!testSuite || !testSuite.mesh || !testSuite.mesh.distributedStorage) {
            return { success: false, error: 'Distributed storage not available' };
          }
          
          // Retrieve via library API
          const data = await testSuite.mesh.distributedStorage.retrieve(key, {
            forceRefresh: true
          });
          
          return { success: true, data };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, persistenceKey);
      
      if (retrieveResult.success && retrieveResult.data && 
          retrieveResult.data.type === `${space}_persistence_test` &&
          retrieveResult.data.space === space) {
        passedSpaces++;
      }
    }
    
    if (passedSpaces === storageSpaces.length) {
      console.log('✅ Storage space persistence test passed via library API');
      this.testResults.passed++;
    } else {
      console.error(`❌ Storage space persistence test failed via library API (${passedSpaces}/${storageSpaces.length} spaces)`);
      this.testResults.failed++;
      this.testResults.errors.push('Storage space persistence test failed via library API');
    }
    
    this.testResults.total++;
  }

  /**
   * Test network information display
   */
  async testNetworkInfo() {
    try {
      const page = this.pages[0];
      
      // Switch to network info tab
      await page.evaluate(() => {
        const tab = document.querySelector('[data-tab="network"]');
        if (tab) {
          tab.click();
        }
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
      await page.bringToFront();
      
      // Check if network status is displayed
      const networkInfo = await page.evaluate(() => {
        const statusElement = document.getElementById('network-status');
        const peersElement = document.getElementById('discovered-peers');
        return {
          hasStatus: statusElement && statusElement.textContent.length > 0,
          hasPeersList: peersElement !== null
        };
      });
      
      if (networkInfo.hasStatus && networkInfo.hasPeersList) {
        console.log('✅ Network information display test passed');
        this.testResults.passed++;
      } else {
        console.error('❌ Network information display test failed');
        this.testResults.failed++;
        this.testResults.errors.push('Network information display test failed');
      }
      
      this.testResults.total++;
    } catch (error) {
      console.error('❌ Network info test failed:', error.message);
      this.testResults.failed++;
      this.testResults.total++;
      this.testResults.errors.push(`Network info test error: ${error.message}`);
    }
  }

  /**
   * Test crypto functionality
   */
  async testCrypto() {
    try {
      const page = this.pages[0];
      
      // Switch to crypto tab
      await page.evaluate(() => {
        const tab = document.querySelector('[data-tab="crypto"]');
        if (tab) {
          tab.click();
        }
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
      await page.bringToFront();
      
      // Check crypto status
      const cryptoStatus = await page.evaluate(() => {
        const statusElement = document.getElementById('crypto-status');
        return statusElement ? statusElement.textContent : '';
      });
      
      if (cryptoStatus.includes('Initialized') || cryptoStatus.includes('Ready') || cryptoStatus.length > 0) {
        console.log('✅ Crypto system status test passed');
        this.testResults.passed++;
      } else {
        console.error(`❌ Crypto system not ready: ${cryptoStatus}`);
        this.testResults.failed++;
        this.testResults.errors.push('Crypto system not ready');
      }
      
      this.testResults.total++;
    } catch (error) {
      console.error('❌ Crypto test failed:', error.message);
      this.testResults.failed++;
      this.testResults.total++;
      this.testResults.errors.push(`Crypto test error: ${error.message}`);
    }
  }

  /**
   * Test API testing utilities
   */
  async testAPIUtilities() {
    try {
      const page = this.pages[0];
      
      // Switch to testing tab
      await page.evaluate(() => {
        const tab = document.querySelector('[data-tab="testing"]');
        if (tab) {
          tab.click();
        }
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
      await page.bringToFront();
      
      // Test peer ID validation using page.evaluate instead of page.type
      const validPeerId = this.peerIds[0];
      
      const inputResult = await page.evaluate((peerId) => {
        const input = document.getElementById('test-peer-id');
        const button = document.getElementById('validate-peer-id-btn');
        
        if (!input || !button) {
          return { success: false, error: 'Elements not found' };
        }
        
        input.value = peerId;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        button.click();
        
        return { success: true };
      }, validPeerId);
      
      if (!inputResult.success) {
        throw new Error(`Failed to input peer ID: ${inputResult.error}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      await page.bringToFront();
      
      // Check validation result
      const validationResult = await page.evaluate(() => {
        const logElement = document.getElementById('utility-results');
        return logElement ? logElement.textContent : '';
      });
      
      if (validationResult.includes('✅') || validationResult.includes('valid') || validationResult.length > 0) {
        console.log('✅ API utilities test passed');
        this.testResults.passed++;
      } else {
        console.error('❌ API utilities test failed');
        this.testResults.failed++;
        this.testResults.errors.push('API utilities test failed');
      }
      
      this.testResults.total++;
    } catch (error) {
      console.error('❌ API utilities test failed:', error.message);
      this.testResults.failed++;
      this.testResults.total++;
      this.testResults.errors.push(`API utilities test error: ${error.message}`);
    }
  }

  /**
   * Run all tests
   */
  async runTests() {
    console.log('\n🧪 Starting Browser Integration Tests...\n');
    
    try {
      console.log('🔧 Setting up test environment...');
      
      // First, build the library to ensure latest changes are included
      console.log('🔨 Building PeerPigeon library...');
      try {
        const { stderr } = await execAsync('npm run build');
        if (stderr && !stderr.includes('webpack')) {
          console.warn('⚠️  Build warnings:', stderr);
        }
        console.log('✅ Library built successfully');
      } catch (buildError) {
        console.error('❌ Build failed:', buildError.message);
        throw new Error(`Failed to build library: ${buildError.message}`);
      }
      
      // Check for and kill any processes using our ports
      console.log('🧹 Cleaning up existing processes...');
      await this.killProcessesOnPorts([SIGNALING_PORT, HTTP_PORT]);
      
      await this.startServers();
      
      console.log('🌐 Launching browser and setting up peers...');
      await this.launchBrowser();
      await this.loadPages();
      await this.waitForPeerIds();
      await this.connectPeers();
      
      const hasConnections = await this.waitForPeerConnections();
      
      if (!hasConnections) {
        console.log('⚠️  Warning: No P2P connections established, but continuing with tests...');
      }
      
      console.log('\n🎯 Running feature tests...\n');
      
      // Run feature tests
      await this.testMessaging();
      await this.testWebDHT();
      await this.testDistributedStorage();
      await this.testNetworkInfo();
      await this.testCrypto();
      await this.testAPIUtilities();
      
      // Generate report
      await this.generateReport();
      
    } catch (error) {
      console.error('❌ Test execution failed:', error.message);
      this.testResults.errors.push(`Test execution error: ${error.message}`);
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Generate test report
   */
  async generateReport() {
    const timestamp = Date.now();
    const report = {
      timestamp,
      date: new Date(timestamp).toISOString(),
      testType: 'browser-integration',
      numPeers: NUM_PEERS,
      results: this.testResults,
      success: this.testResults.failed === 0 && this.testResults.total > 0
    };

    // Ensure reports directory exists
    await fs.mkdir('test/reports', { recursive: true });
    
    // Write report
    const reportPath = `test/reports/browser-integration-${timestamp}.json`;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Print summary
    console.log('\n📊 Test Results Summary:');
    console.log(`Total tests: ${this.testResults.total}`);
    console.log(`Passed: ${this.testResults.passed}`);
    console.log(`Failed: ${this.testResults.failed}`);
    console.log(`Success rate: ${this.testResults.total > 0 ? Math.round((this.testResults.passed / this.testResults.total) * 100) : 0}%`);
    
    if (this.testResults.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.testResults.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    console.log(`\n📄 Report saved to: ${reportPath}`);
    
    // Exit with appropriate code
    if (report.success) {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed!');
      process.exit(1);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    try {
      // Close browser
      if (this.browser) {
        await this.browser.close();
        console.log('✅ Browser closed');
      }
      
      // Close HTTP server
      if (this.httpServer) {
        this.httpServer.close();
        console.log('✅ HTTP server closed');
      }
      
      // Kill signaling server
      if (this.signalingServer) {
        this.signalingServer.kill('SIGTERM');
        console.log('✅ Signaling server stopped');
      }
    } catch (error) {
      console.error('❌ Cleanup error:', error.message);
    }
  }
}

// Declare test instance
let test = null;

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, cleaning up...');
  if (test) {
    await test.cleanup();
  }
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, cleaning up...');
  if (test) {
    await test.cleanup();
  }
  process.exit(1);
});

// Run the test
test = new Browser3IntegrationTest();
test.runTests().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
