#!/usr/bin/env node
/**
 * Manual Video Streaming Test for PeerPigeon
 *
 * Sets up 7 peer connections and waits for manual invocation of video streams.
 * This allows you to test video streaming scenarios interactively.
 *
 * Usage:
 *   node test/manual-video-streaming-test.js
 *
 * Once peers are connected, use the browser interface to manually:
 * - Start/stop video streams on any peer
 * - Test different streaming scenarios
 * - Debug mesh topology and stream propagation
 */
import puppeteer from 'puppeteer';
import { spawn, exec } from 'child_process';
import path from 'path';
import express from 'express';
import { promisify } from 'util';

const execAsync = promisify(exec);

const HEADLESS = process.env.HEADLESS !== 'false'; // Default to headless unless explicitly disabled
const SIGNALING_PORT = 3000;
const HTTP_PORT = 8080;

class ManualVideoStreamingTest {
  constructor() {
    this.signalingServer = null;
    this.httpServer = null;
    this.browser = null;
    this.pages = [];
    this.peerIds = [];
  }

  /**
   * Check if a port is in use and kill the process using it
   */
  async killProcessesOnPorts(ports) {
    for (const port of ports) {
      try {
        const { stdout } = await execAsync(`lsof -ti:${port}`);
        if (stdout.trim()) {
          const pids = stdout.trim().split('\n');
          for (const pid of pids) {
            try {
              await execAsync(`kill -9 ${pid}`);
              console.log(`✅ Killed process ${pid} on port ${port}`);
            } catch (killError) {
              console.log(`⚠️  Could not kill process ${pid}: ${killError.message}`);
            }
          }
        }
      } catch (error) {
        // Port is free
      }
    }
  }

  /**
   * Start the required servers
   */
  async startServers() {
    console.log('🚀 Starting servers...');
    
    // Start signaling server
    this.signalingServer = spawn('node', ['server/start.js'], {
      stdio: 'pipe',
      env: { ...process.env, PORT: SIGNALING_PORT }
    });

    this.signalingServer.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('WebSocket server listening')) {
        console.log('✅ Signaling server started');
      }
    });

    this.signalingServer.stderr.on('data', (data) => {
      const output = data.toString();
      if (!output.includes('DeprecationWarning')) {
        console.error('Signaling server error:', output);
      }
    });

    // Start HTTP server for serving files
    const app = express();
    
    // CORS headers
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
   * Launch browser with fake media support
   */
  async launchBrowser(numPeers = 7) {
    console.log(`🚀 Launching browser with ${numPeers} peers for manual video streaming testing...`);
    
    this.browser = await puppeteer.launch({
      headless: HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=VizDisplayCompositor',
        // CRITICAL: Fake media device arguments for testing
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--use-file-for-fake-video-capture=/dev/null', // Use system null device
        '--allow-running-insecure-content',
        '--disable-web-security',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        // Additional arguments for better fake media support
        '--enable-fake-capture-devices',
        '--autoplay-policy=no-user-gesture-required'
      ],
      devtools: !HEADLESS
    });

    // Create pages for each peer
    for (let i = 0; i < numPeers; i++) {
      const page = await this.browser.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Enable console logging for debugging
      page.on('console', msg => {
        const text = msg.text();
        // Log ALL debug messages for media and renegotiation
        if (text.includes('🎥') || text.includes('📡') || text.includes('Media') || text.includes('Stream') || 
            text.includes('ONTRACK') || text.includes('remoteStream') || text.includes('CRYPTO') ||
            text.includes('renegotiation') || text.includes('Renegotiation') || text.includes('🔄') ||
            text.includes('setLocalStream') || text.includes('replaceTrack') || text.includes('transceiver') ||
            msg.type() === 'error') {
          console.log(`[Peer ${i + 1}] ${msg.type()}: ${text}`);
        }
      });

      // Handle page errors
      page.on('pageerror', error => {
        console.error(`[Peer ${i + 1}] Page error:`, error.message);
      });

      // Handle failed requests to identify 404s
      page.on('requestfailed', request => {
        console.error(`[Peer ${i + 1}] Request failed: ${request.url()} - ${request.failure()?.errorText}`);
      });

      // Handle response errors including 404s
      page.on('response', response => {
        if (!response.ok()) {
          console.error(`[Peer ${i + 1}] HTTP ${response.status()}: ${response.url()}`);
        }
      });

      // Mock fake media devices to ensure consistent fake streams
      await page.evaluateOnNewDocument(() => {
        // Override getUserMedia to provide consistent fake streams
        navigator.mediaDevices.getUserMedia = async function (constraints) {
          console.log('🎥 Mock getUserMedia called with constraints:', constraints);
          
          // Create a canvas for fake video
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext('2d');
          
          // Draw animated fake video content
          let frameCount = 0;
          const drawFrame = () => {
            frameCount++;
            // Create animated gradient background
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, `hsl(${(frameCount * 2) % 360}, 70%, 50%)`);
            gradient.addColorStop(1, `hsl(${(frameCount * 2 + 180) % 360}, 70%, 50%)`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Add text overlay with peer identification
            ctx.fillStyle = 'white';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`Peer ${window.location.href.includes('?') ? new URLSearchParams(window.location.search).get('peer') || 'Unknown' : 'Unknown'}`, canvas.width / 2, canvas.height / 2 - 40);
            ctx.fillText('Fake Video Stream', canvas.width / 2, canvas.height / 2);
            ctx.fillText(`Frame: ${frameCount}`, canvas.width / 2, canvas.height / 2 + 30);
            ctx.fillText(`Time: ${Date.now()}`, canvas.width / 2, canvas.height / 2 + 60);
            
            requestAnimationFrame(drawFrame);
          };
          drawFrame();
          
          // Get stream from canvas
          const videoStream = canvas.captureStream(30); // 30 FPS
          
          // Create fake audio context and stream
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          const dest = audioCtx.createMediaStreamDestination();
          
          oscillator.connect(gain);
          gain.connect(dest);
          oscillator.frequency.setValueAtTime(440 + (Math.random() * 200), audioCtx.currentTime); // Random frequency for each peer
          gain.gain.setValueAtTime(0.1, audioCtx.currentTime); // Low volume
          oscillator.start();
          
          const audioStream = dest.stream;
          
          // Combine streams based on constraints
          const combinedStream = new MediaStream();
          
          if (constraints.video) {
            videoStream.getVideoTracks().forEach(track => {
              track.label = 'Fake Video Track';
              combinedStream.addTrack(track);
            });
          }
          
          if (constraints.audio) {
            audioStream.getAudioTracks().forEach(track => {
              track.label = 'Fake Audio Track';
              combinedStream.addTrack(track);
            });
          }
          
          console.log('🎥 Fake media stream created:', {
            videoTracks: combinedStream.getVideoTracks().length,
            audioTracks: combinedStream.getAudioTracks().length
          });
          
          return combinedStream;
        };
      });

      this.pages.push(page);
    }
    
    console.log(`✅ Browser launched with ${numPeers} peer pages`);
  }

  /**
   * Load the browser example in all pages
   */
  async loadPages() {
    console.log('📄 Loading PeerPigeon interface on all peer pages...');
    
    const loadPromises = this.pages.map(async (page, index) => {
      // Add peer identifier to URL for better fake video identification
      await page.goto(`http://localhost:${HTTP_PORT}/examples/browser/index.html?peer=${index + 1}`, {
        waitUntil: 'networkidle0'
      });
      
      // Wait for PeerPigeon to initialize
      await page.waitForFunction(() => {
        return window.peerPigeonTestSuite && window.peerPigeonTestSuite.mesh;
      });
      
      console.log(`✅ Peer ${index + 1} loaded and initialized`);
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
      
      const buttonClicked = await page.evaluate(() => {
        const btn = document.getElementById('connect-btn');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      
      if (!buttonClicked) {
        throw new Error(`Connect button not found on peer ${i + 1}`);
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
    
    // Give peers time to discover each other
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
            
            const mesh = testSuite.mesh;
            let count = 0;
            
            if (mesh.connectionManager && typeof mesh.connectionManager.getConnectedPeerCount === 'function') {
              count = mesh.connectionManager.getConnectedPeerCount();
            } else if (mesh.connectionManager && mesh.connectionManager.peers) {
              const peers = Array.from(mesh.connectionManager.peers.values());
              count = peers.filter(peer => peer.getStatus && peer.getStatus() === 'connected').length;
            }
            
            return { count, error: null };
          } catch (error) {
            return { count: 0, error: error.message };
          }
        });
        
        connectionCounts.push(connectionInfo.count);
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
   * Enable remote stream reception on all peers for all their connections
   * This is critical for video streaming tests to work
   */
  async enableRemoteStreamReceptionOnAllPeers() {
    console.log('🔓 Enabling remote stream reception on all peers...');
    
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      
      const result = await page.evaluate(() => {
        if (!window.peerPigeonTestSuite?.mesh?.connectionManager) {
          return { error: 'No ConnectionManager found' };
        }
        
        const connections = window.peerPigeonTestSuite.mesh.connectionManager.getAllConnections();
        let enabledCount = 0;
        
        for (const connection of connections) {
          if (connection.allowRemoteStreamEmission) {
            connection.allowRemoteStreamEmission();
            enabledCount++;
            console.log(`🔓 Enabled remote streams from ${connection.peerId.substring(0, 8)}...`);
          }
        }
        
        return { 
          enabledCount, 
          totalConnections: connections.length,
          success: true 
        };
      });
      
      if (result.error) {
        console.log(`⚠️ Peer ${i + 1}: ${result.error}`);
      } else {
        console.log(`✅ Peer ${i + 1}: Enabled remote streams for ${result.enabledCount}/${result.totalConnections} connections`);
      }
    }
    
    console.log('✅ Remote stream reception enabled on all peers');
  }

  /**
   * Wait for encryption keys to be exchanged between directly connected peers
   * This happens after data channels are open and is required for encrypted streaming
   */
  async waitForEncryptionKeyExchange(timeout = 30000) {
    console.log('🔐 Waiting for encryption key exchange on direct connections...');
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      let allKeysExchanged = true;
      
      for (let i = 0; i < this.pages.length; i++) {
        try {
          const keyExchangeStatus = await this.pages[i].evaluate(() => {
            if (!window.peerPigeonTestSuite?.mesh?.connectionManager || !window.peerPigeonTestSuite?.mesh?.cryptoManager) {
              return { ready: false, error: 'ConnectionManager or CryptoManager not available' };
            }
            
            const connections = window.peerPigeonTestSuite.mesh.connectionManager.getAllConnections();
            const directConnections = connections.filter(conn => conn.getStatus() === 'connected');
            
            const connectionsWithKeys = directConnections.filter(conn => {
              try {
                const hasKeys = window.peerPigeonTestSuite.mesh.cryptoManager && 
                               window.peerPigeonTestSuite.mesh.cryptoManager.peerKeys && 
                               window.peerPigeonTestSuite.mesh.cryptoManager.peerKeys.get(conn.peerId);
                return hasKeys;
              } catch (error) {
                console.error(`Error checking keys for peer ${conn.peerId}:`, error);
                return false;
              }
            });
            
            return {
              ready: connectionsWithKeys.length === directConnections.length && directConnections.length > 0,
              keysExchangedCount: connectionsWithKeys.length,
              directConnectionCount: directConnections.length,
              totalConnectionCount: connections.length
            };
          });
          
          if (!keyExchangeStatus.ready) {
            allKeysExchanged = false;
            console.log(`⏳ Peer ${i + 1}: ${keyExchangeStatus.keysExchangedCount}/${keyExchangeStatus.directConnectionCount} encryption keys exchanged`);
            break;
          }
        } catch (error) {
          allKeysExchanged = false;
          console.log(`⚠️ Error checking encryption keys for Peer ${i + 1}:`, error.message);
          break;
        }
      }
      
      if (allKeysExchanged) {
        console.log('✅ All encryption keys exchanged on direct connections!');
        console.log('🔐 Encrypted streams can now be started manually');
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('❌ Timeout waiting for encryption key exchange to complete');
    return false;
  }

  /**
   * Debug mesh topology to understand direct vs indirect connections
   */
  async debugMeshTopology() {
    console.log('\n🕸️ Debugging Mesh Topology...');
    
    const topology = {};
    
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      
      const peerInfo = await page.evaluate(() => {
        if (!window.peerPigeonTestSuite?.mesh?.connectionManager) {
          return { error: 'No ConnectionManager found' };
        }
        
        const connections = window.peerPigeonTestSuite.mesh.connectionManager.getAllConnections();
        const directConnections = connections.filter(conn => conn.getStatus() === 'connected');
        
        return {
          peerId: window.peerPigeonTestSuite.mesh.peerId.substring(0, 8),
          fullPeerId: window.peerPigeonTestSuite.mesh.peerId,
          directConnections: directConnections.map(conn => ({
            peerId: conn.peerId.substring(0, 8),
            fullPeerId: conn.peerId,
            status: conn.getStatus(),
            dataChannelReady: conn.dataChannelReady
          }))
        };
      });
      
      topology[`Peer ${i + 1}`] = peerInfo;
    }
    
    console.log('🕸️ Mesh Topology:');
    Object.entries(topology).forEach(([peerName, info]) => {
      if (info.error) {
        console.log(`   ${peerName}: ${info.error}`);
      } else {
        console.log(`   ${peerName} (${info.peerId}): directly connected to ${info.directConnections.length} peers`);
        info.directConnections.forEach(conn => {
          console.log(`     └─ ${conn.peerId} (${conn.status}, dataChannel: ${conn.dataChannelReady})`);
        });
      }
    });
    
    return topology;
  }

  /**
   * Monitor stream activities across all peers
   */
  async monitorStreams() {
    console.log('\n📊 Starting stream monitoring...');
    
    setInterval(async () => {
      const streamStats = [];
      
      for (let i = 0; i < this.pages.length; i++) {
        try {
          const stats = await this.pages[i].evaluate(() => {
            // Check local stream status
            const localStatus = document.getElementById('media-status');
            const hasLocalStream = localStatus && !localStatus.textContent.includes('No active media stream');
            
            // Check remote streams
            const remoteContainer = document.getElementById('remote-videos-container');
            const remoteStreams = remoteContainer ? remoteContainer.querySelectorAll('.remote-video-item') : [];
            
            return {
              peerId: window.peerPigeonTestSuite?.mesh?.peerId?.substring(0, 8) || 'Unknown',
              hasLocalStream,
              remoteStreamCount: remoteStreams.length,
              remoteStreams: Array.from(remoteStreams).map(item => ({
                peerId: item.getAttribute('data-peer-id')?.substring(0, 8) || 'Unknown',
                hasVideo: item.querySelector('video')?.srcObject !== null
              }))
            };
          });
          
          streamStats.push({ peer: i + 1, ...stats });
        } catch (error) {
          streamStats.push({ peer: i + 1, error: error.message });
        }
      }
      
      // Only log if there are active streams
      const hasActiveStreams = streamStats.some(stat => stat.hasLocalStream || stat.remoteStreamCount > 0);
      
      if (hasActiveStreams) {
        console.log('\n📊 Stream Status Update:');
        streamStats.forEach(stat => {
          if (stat.error) {
            console.log(`   Peer ${stat.peer}: Error - ${stat.error}`);
          } else {
            const localStatus = stat.hasLocalStream ? '🔴 Broadcasting' : '⚫ Silent';
            const remoteStatus = stat.remoteStreamCount > 0 ? `📺 Receiving ${stat.remoteStreamCount} streams` : '📺 No incoming streams';
            console.log(`   Peer ${stat.peer} (${stat.peerId}): ${localStatus} | ${remoteStatus}`);
            
            if (stat.remoteStreams.length > 0) {
              stat.remoteStreams.forEach(remote => {
                console.log(`     └─ From ${remote.peerId}: ${remote.hasVideo ? '✅ Video active' : '❌ No video'}`);
              });
            }
          }
        });
      }
    }, 5000); // Update every 5 seconds
  }

  /**
   * Setup manual test environment
   */
  async setupManualTest() {
    console.log('\n🎮 Setting up Manual Video Streaming Test Environment...\n');
    
    try {
      console.log('🔧 Setting up test environment...');
      
      // Build the library first
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
      
      // Clean up existing processes
      console.log('🧹 Cleaning up existing processes...');
      await this.killProcessesOnPorts([SIGNALING_PORT, HTTP_PORT]);
      
      await this.startServers();
      
      console.log('🌐 Launching browser and setting up peers...');
      await this.launchBrowser(7); // Use 7 peers
      await this.loadPages();
      await this.waitForPeerIds();
      await this.connectPeers();
      
      const hasConnections = await this.waitForPeerConnections();
      
      if (!hasConnections) {
        throw new Error('No P2P connections established');
      }
      
      // Wait for encryption key exchange on direct connections
      const keysExchanged = await this.waitForEncryptionKeyExchange();
      
      if (!keysExchanged) {
        console.log('⚠️ Warning: Encryption keys not fully exchanged, but continuing...');
      }
      
      // CRITICAL: Enable remote stream reception on all peers for all connections
      await this.enableRemoteStreamReceptionOnAllPeers();
      
      // Show mesh topology
      await this.debugMeshTopology();
      
      // Start monitoring streams
      this.monitorStreams();
      
      console.log('\n🎉 Manual Video Streaming Test Environment Ready!\n');
      console.log('📋 Instructions:');
      console.log('   1. Seven browser windows should be open (unless running headless)');
      console.log('   2. Each window represents a peer in the mesh network');
      console.log('   3. Use the browser interface to manually:');
      console.log('      • Click "Media" tab on any peer');
      console.log('      • Enable video/audio checkboxes');
      console.log('      • Click "Start Media" to begin streaming');
      console.log('      • Watch for streams to appear in other peers');
      console.log('   4. Test different scenarios:');
      console.log('      • 1:1 streaming (one peer broadcasts)');
      console.log('      • 1:many streaming (one broadcaster, multiple receivers)');
      console.log('      • many:many streaming (multiple peers broadcasting)');
      console.log('   5. Monitor the console for stream status updates');
      console.log('\n🌐 Access URLs:');
      this.pages.forEach((_, index) => {
        console.log(`   Peer ${index + 1}: http://localhost:${HTTP_PORT}/examples/browser/index.html?peer=${index + 1}`);
      });
      console.log('\n⏹️  Press Ctrl+C to stop the test environment\n');
      
      // Keep the process alive
      return new Promise((_resolve) => {
        // The process will be kept alive until manually terminated
      });
      
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      await this.cleanup();
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

// Handle process termination
let test = null;

process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, cleaning up...');
  if (test) {
    await test.cleanup();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, cleaning up...');
  if (test) {
    await test.cleanup();
  }
  process.exit(0);
});

// Run the manual test setup
test = new ManualVideoStreamingTest();
test.setupManualTest().catch(error => {
  console.error('❌ Manual video streaming test setup failed:', error);
  process.exit(1);
});
