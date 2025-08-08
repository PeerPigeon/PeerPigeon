#!/usr/bin/env node
/**
 * Manual Video Streaming Test
 * 
 * Sets up 7 peer connections with fake media devices and allows manual control
 * of video streaming. This test provides a complete environment where you can
 * manually trigger streaming between peers.
 */
import puppeteer from 'puppeteer';
import { spawn, exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import express from 'express';
import { promisify } from 'util';
import readline from 'readline';

const execAsync = promisify(exec);

const HEADLESS = process.env.HEADLESS !== 'false'; // Default to headless unless explicitly disabled
const SIGNALING_PORT = 3000;
const HTTP_PORT = 8080;

class ManualVideoTest {
  constructor() {
    this.signalingServer = null;
    this.httpServer = null;
    this.browser = null;
    this.pages = [];
    this.peerIds = [];
    this.rl = null;
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
    this.signalingServer = spawn('node', ['websocket-server/server.js'], {
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

    console.log('✅ Servers started successfully');
    console.log(`   HTTP Server: http://localhost:${HTTP_PORT}`);
    console.log(`   Signaling Server: ws://localhost:${SIGNALING_PORT}`);
  }

  /**
   * Launch browser with fake media support and proper device enumeration
   */
  async launchBrowser(numPeers = 7) {
    console.log(`🚀 Launching browser with ${numPeers} peers for manual video streaming...`);
    
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
        '--use-file-for-fake-video-capture=/dev/null',
        '--allow-running-insecure-content',
        '--disable-web-security',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        // Additional arguments for better fake media support
        '--enable-fake-capture-devices',
        '--autoplay-policy=no-user-gesture-required',
        // Ensure fake devices are enumerable
        '--fake-device-for-media-stream',
        '--force-fake-ui-for-media-stream'
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
        // Log important messages
        if (text.includes('🎥') || text.includes('📡') || text.includes('Media') || text.includes('Stream') || 
            text.includes('Device') || text.includes('fake') || text.includes('Fake') ||
            text.includes('getUserMedia') || text.includes('enumerateDevices') ||
            msg.type() === 'error') {
          console.log(`[Peer ${i + 1}] ${msg.type()}: ${text}`);
        }
      });

      // Handle page errors
      page.on('pageerror', error => {
        console.error(`[Peer ${i + 1}] Page error:`, error.message);
      });

      // Mock fake media devices with proper enumeration
      await page.evaluateOnNewDocument(() => {
        // Create fake devices that will be enumerated
        const fakeDevices = [
          {
            deviceId: 'fake-video-device-1',
            kind: 'videoinput',
            label: 'Fake Camera 1',
            groupId: 'fake-group-1'
          },
          {
            deviceId: 'fake-video-device-2', 
            kind: 'videoinput',
            label: 'Fake Camera 2',
            groupId: 'fake-group-2'
          },
          {
            deviceId: 'fake-audio-device-1',
            kind: 'audioinput',
            label: 'Fake Microphone 1',
            groupId: 'fake-group-1'
          },
          {
            deviceId: 'fake-audio-device-2',
            kind: 'audioinput', 
            label: 'Fake Microphone 2',
            groupId: 'fake-group-2'
          },
          {
            deviceId: 'fake-audio-output-1',
            kind: 'audiooutput',
            label: 'Fake Speaker 1',
            groupId: 'fake-group-1'
          }
        ];

        // Override enumerateDevices to return fake devices
        const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = async function() {
          console.log('🎥 Fake enumerateDevices called, returning fake devices:', fakeDevices.length);
          return Promise.resolve(fakeDevices.map(device => ({
            deviceId: device.deviceId,
            kind: device.kind,
            label: device.label,
            groupId: device.groupId,
            toJSON: () => device
          })));
        };

        // Override getUserMedia to provide consistent fake streams
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async function (constraints) {
          console.log('🎥 Fake getUserMedia called with constraints:', constraints);
          
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
            
            // Add text overlay
            ctx.fillStyle = 'white';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Fake Video Stream', canvas.width / 2, canvas.height / 2 - 20);
            ctx.fillText(`Frame: ${frameCount}`, canvas.width / 2, canvas.height / 2 + 20);
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
          oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4 note
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
            audioTracks: combinedStream.getAudioTracks().length,
            constraints: constraints
          });
          
          return combinedStream;
        };

        console.log('🎥 Fake media devices and getUserMedia configured');
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
      await page.goto(`http://localhost:${HTTP_PORT}/examples/browser/index.html`, {
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
   * Enable remote stream reception on all peers
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
   * Wait for encryption keys to be exchanged
   */
  async waitForEncryptionKeyExchange(timeout = 30000) {
    console.log('🔑 Waiting for encryption key exchange on direct connections...');
    
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
                return false;
              }
            });
            
            return {
              ready: connectionsWithKeys.length === directConnections.length && directConnections.length > 0,
              keysExchangedCount: connectionsWithKeys.length,
              directConnectionCount: directConnections.length
            };
          });
          
          if (!keyExchangeStatus.ready) {
            allKeysExchanged = false;
            break;
          }
        } catch (error) {
          allKeysExchanged = false;
          break;
        }
      }
      
      if (allKeysExchanged) {
        console.log('✅ All encryption keys exchanged on direct connections!');
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('❌ Timeout waiting for encryption key exchange to complete');
    return false;
  }

  /**
   * Start media streaming on a specific peer
   */
  async startStreamingOnPeer(peerIndex) {
    if (peerIndex < 1 || peerIndex > this.pages.length) {
      console.log(`❌ Invalid peer index. Please use 1-${this.pages.length}`);
      return false;
    }

    const page = this.pages[peerIndex - 1];
    console.log(`🎥 Starting video streaming on Peer ${peerIndex}...`);

    try {
      // Switch to media tab
      await page.evaluate(() => {
        const tab = document.querySelector('[data-tab="media"]');
        if (tab) tab.click();
      });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Enable video and audio
      await page.evaluate(() => {
        const videoCheckbox = document.getElementById('enable-video');
        const audioCheckbox = document.getElementById('enable-audio');
        if (videoCheckbox) videoCheckbox.checked = true;
        if (audioCheckbox) audioCheckbox.checked = true;
      });

      // Check available devices
      const deviceInfo = await page.evaluate(async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          return {
            total: devices.length,
            video: devices.filter(d => d.kind === 'videoinput').length,
            audio: devices.filter(d => d.kind === 'audioinput').length,
            devices: devices.map(d => ({
              kind: d.kind,
              label: d.label,
              deviceId: d.deviceId.substring(0, 8) + '...'
            }))
          };
        } catch (error) {
          return { error: error.message };
        }
      });

      console.log(`📱 Peer ${peerIndex} detected devices:`, deviceInfo);

      // Click start media button
      const result = await page.evaluate(() => {
        const btn = document.getElementById('start-media-btn');
        if (!btn) return { error: 'Start media button not found' };
        if (btn.disabled) return { error: 'Start media button is disabled' };
        
        btn.click();
        return { success: true };
      });

      if (result.error) {
        console.log(`❌ Failed to start streaming on Peer ${peerIndex}: ${result.error}`);
        return false;
      }

      // Wait and verify
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const status = await page.evaluate(() => {
        const statusEl = document.getElementById('media-status');
        return statusEl ? statusEl.textContent : 'No status found';
      });

      console.log(`📊 Peer ${peerIndex} status: ${status}`);
      
      if (status.includes('Local stream active')) {
        console.log(`✅ Video streaming started successfully on Peer ${peerIndex}`);
        return true;
      } else {
        console.log(`❌ Video streaming failed to start on Peer ${peerIndex}`);
        return false;
      }

    } catch (error) {
      console.log(`❌ Error starting streaming on Peer ${peerIndex}:`, error.message);
      return false;
    }
  }

  /**
   * Stop media streaming on a specific peer
   */
  async stopStreamingOnPeer(peerIndex) {
    if (peerIndex < 1 || peerIndex > this.pages.length) {
      console.log(`❌ Invalid peer index. Please use 1-${this.pages.length}`);
      return false;
    }

    const page = this.pages[peerIndex - 1];
    console.log(`🛑 Stopping video streaming on Peer ${peerIndex}...`);

    try {
      const result = await page.evaluate(() => {
        const btn = document.getElementById('stop-media-btn');
        if (!btn) return { error: 'Stop media button not found' };
        if (btn.disabled) return { error: 'Stop media button is disabled' };
        
        btn.click();
        return { success: true };
      });

      if (result.error) {
        console.log(`❌ Failed to stop streaming on Peer ${peerIndex}: ${result.error}`);
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`✅ Video streaming stopped on Peer ${peerIndex}`);
      return true;

    } catch (error) {
      console.log(`❌ Error stopping streaming on Peer ${peerIndex}:`, error.message);
      return false;
    }
  }

  /**
   * Check remote streams on a specific peer
   */
  async checkRemoteStreamsOnPeer(peerIndex) {
    if (peerIndex < 1 || peerIndex > this.pages.length) {
      console.log(`❌ Invalid peer index. Please use 1-${this.pages.length}`);
      return;
    }

    const page = this.pages[peerIndex - 1];
    
    const streamInfo = await page.evaluate(() => {
      const remoteContainer = document.getElementById('remote-videos-container');
      if (!remoteContainer) return { count: 0, streams: [] };
      
      const streamElements = remoteContainer.querySelectorAll('.remote-video-item');
      const streams = Array.from(streamElements).map(element => {
        const video = element.querySelector('video');
        const title = element.querySelector('.video-title');
        
        return {
          peerId: element.getAttribute('data-peer-id'),
          hasVideo: video && video.srcObject !== null,
          videoTracks: video && video.srcObject ? video.srcObject.getVideoTracks().length : 0,
          audioTracks: video && video.srcObject ? video.srcObject.getAudioTracks().length : 0,
          title: title ? title.textContent : 'Unknown',
          playing: video ? !video.paused : false
        };
      });
      
      return {
        count: streamElements.length,
        streams
      };
    });

    console.log(`📺 Peer ${peerIndex} is receiving ${streamInfo.count} remote streams:`);
    streamInfo.streams.forEach((stream, index) => {
      console.log(`   Stream ${index + 1}: From ${stream.peerId.substring(0, 8)}... (${stream.videoTracks}V/${stream.audioTracks}A) ${stream.playing ? '▶️' : '⏸️'}`);
    });

    return streamInfo;
  }

  /**
   * Show mesh topology
   */
  async showMeshTopology() {
    console.log('\n🕸️ Current Mesh Topology:');
    
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
          directConnections: directConnections.map(conn => ({
            peerId: conn.peerId.substring(0, 8),
            status: conn.getStatus(),
            dataChannelReady: conn.dataChannelReady
          }))
        };
      });
      
      console.log(`   Peer ${i + 1} (${peerInfo.peerId}): ${peerInfo.directConnections.length} direct connections`);
      peerInfo.directConnections.forEach(conn => {
        console.log(`     └─ ${conn.peerId} (${conn.status}, DC: ${conn.dataChannelReady})`);
      });
    }
  }

  /**
   * Interactive command loop
   */
  async startInteractiveMode() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\n🎮 Manual Video Streaming Test - Interactive Mode');
    console.log('==================================================');
    console.log('Available commands:');
    console.log('  start <peer>     - Start video streaming on peer (1-7)');
    console.log('  stop <peer>      - Stop video streaming on peer (1-7)');
    console.log('  check <peer>     - Check remote streams on peer (1-7)');
    console.log('  topology         - Show mesh topology');
    console.log('  status           - Show all peer streaming status');
    console.log('  help             - Show this help');
    console.log('  exit             - Exit the test');
    console.log('');

    const prompt = () => {
      this.rl.question('> ', async (input) => {
        const [command, ...args] = input.trim().split(' ');
        
        switch (command.toLowerCase()) {
          case 'start':
            const startPeer = parseInt(args[0]);
            if (startPeer) {
              await this.startStreamingOnPeer(startPeer);
            } else {
              console.log('Usage: start <peer_number>');
            }
            break;
            
          case 'stop':
            const stopPeer = parseInt(args[0]);
            if (stopPeer) {
              await this.stopStreamingOnPeer(stopPeer);
            } else {
              console.log('Usage: stop <peer_number>');
            }
            break;
            
          case 'check':
            const checkPeer = parseInt(args[0]);
            if (checkPeer) {
              await this.checkRemoteStreamsOnPeer(checkPeer);
            } else {
              console.log('Usage: check <peer_number>');
            }
            break;
            
          case 'topology':
            await this.showMeshTopology();
            break;
            
          case 'status':
            console.log('\n📊 All Peer Status:');
            for (let i = 1; i <= this.pages.length; i++) {
              await this.checkRemoteStreamsOnPeer(i);
            }
            break;
            
          case 'help':
            console.log('\nAvailable commands:');
            console.log('  start <peer>     - Start video streaming on peer (1-7)');
            console.log('  stop <peer>      - Stop video streaming on peer (1-7)');
            console.log('  check <peer>     - Check remote streams on peer (1-7)');
            console.log('  topology         - Show mesh topology');
            console.log('  status           - Show all peer streaming status');
            console.log('  help             - Show this help');
            console.log('  exit             - Exit the test');
            break;
            
          case 'exit':
          case 'quit':
            console.log('👋 Exiting...');
            await this.cleanup();
            process.exit(0);
            break;
            
          default:
            if (command) {
              console.log(`Unknown command: ${command}. Type 'help' for available commands.`);
            }
        }
        
        prompt();
      });
    };

    prompt();
  }

  /**
   * Setup the test environment
   */
  async setup() {
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
      await this.launchBrowser(7);
      await this.loadPages();
      await this.waitForPeerIds();
      await this.connectPeers();
      
      const hasConnections = await this.waitForPeerConnections();
      
      if (!hasConnections) {
        throw new Error('No P2P connections established');
      }
      
      const keysExchanged = await this.waitForEncryptionKeyExchange();
      
      if (!keysExchanged) {
        console.log('⚠️  Encryption keys not fully exchanged, but continuing...');
      }
      
      await this.enableRemoteStreamReceptionOnAllPeers();
      
      console.log('✅ Test environment setup complete!');
      console.log('');
      
      await this.showMeshTopology();
      
      return true;
      
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    try {
      if (this.rl) {
        this.rl.close();
      }
      
      if (this.browser) {
        await this.browser.close();
        console.log('✅ Browser closed');
      }
      
      if (this.httpServer) {
        this.httpServer.close();
        console.log('✅ HTTP server closed');
      }
      
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
async function main() {
  test = new ManualVideoTest();
  const setupSuccess = await test.setup();
  
  if (setupSuccess) {
    await test.startInteractiveMode();
  } else {
    console.error('❌ Failed to setup test environment');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Manual video test failed:', error);
  process.exit(1);
});
