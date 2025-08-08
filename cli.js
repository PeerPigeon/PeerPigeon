#!/usr/bin/env node

/**
 * PeerPigeon CLI - Complete with fixed peer connection logic
 */

import { createInterface } from 'readline';
import { PeerPigeonMesh, PeerPigeonServer } from './index.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { request } from 'http';
import { createServer } from 'net';
import DebugLogger from './src/DebugLogger.js';

// Global flag to track WebRTC initialization
let webrtcInitialized = false;

// Disable debug logging by default for cleaner CLI experience
DebugLogger.disableAll();

// Temporarily suppress noisy debug console.log messages
const originalConsoleLog = console.log;
console.log = (...args) => {
  const message = args.join(' ');
  // Suppress specific debug messages that clutter the CLI
  if (message.includes('🚨 SIGNALING CRITICAL') ||
      message.includes('🚨 SWITCH') ||
      message.includes('✅ Loaded unsea')) {
    return;
  }
  originalConsoleLog.apply(console, args);
};

// Debug levels
const DEBUG_LEVELS = {
  OFF: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
  TRACE: 5
};

// Setup global error handlers to prevent CLI freezing
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error('Stack:', error.stack);
  // Don't exit immediately, try to recover
});

process.on('unhandledRejection', (reason, _promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
  // Don't exit immediately, try to recover
});

// Handle termination signals gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT, shutting down gracefully...');
  if (cli) {
    cli.shutdown();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down gracefully...');
  if (cli) {
    cli.shutdown();
  }
  process.exit(0);
});

// Setup WebRTC polyfill for Node.js
async function initializeWebRTC() {
  if (webrtcInitialized) {
    return true;
  }
  
  try {
    // Add timeout to prevent hanging on import
    const importPromise = Promise.all([
      import('ws'),
      import('@koush/wrtc')
    ]);
    
    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('WebRTC import timeout')), 10000);
    });
    
    const [WebSocket, wrtc] = await Promise.race([importPromise, timeoutPromise]);
    
    // Make WebRTC available globally for Node.js
    global.RTCPeerConnection = wrtc.default.RTCPeerConnection;
    global.RTCSessionDescription = wrtc.default.RTCSessionDescription;
    global.RTCIceCandidate = wrtc.default.RTCIceCandidate;
    global.WebSocket = WebSocket.default;
    
    webrtcInitialized = true;
    return true;
  } catch (error) {
    console.error('❌ Failed to load WebRTC dependencies:', error.message);
    console.error('Please ensure ws and @koush/wrtc are installed: npm install ws @koush/wrtc');
    console.error('Stack trace:', error.stack);
    return false;
  }
}

const CONFIG_DIR = join(homedir(), '.peerpigeon');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Simple prompt function with timeout to prevent hanging
function prompt(question, defaultValue = '', timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const timeout = setTimeout(() => {
      rl.close();
      reject(new Error('Prompt timeout - using default value'));
    }, timeoutMs);

    const displayDefault = defaultValue ? ` (${defaultValue})` : '';
    rl.question(`${question}${displayDefault}: `, (answer) => {
      clearTimeout(timeout);
      rl.close();
      resolve(answer.trim() || defaultValue);
    });

    // Handle errors to prevent hanging
    rl.on('error', (error) => {
      clearTimeout(timeout);
      rl.close();
      console.warn('Prompt error, using default:', error.message);
      resolve(defaultValue);
    });
  });
}

// Check if any server is already running on the port
async function checkPortInUse(host = 'localhost', port = 3000) {
  return new Promise((resolve) => {
    const server = createServer();

    server.listen(port, host, () => {
      server.once('close', () => {
        resolve({ inUse: false });
      });
      server.close();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ inUse: true, error: `Port ${port} is already in use` });
      } else {
        resolve({ inUse: false, error: err.message });
      }
    });
  });
}

// Check if PeerPigeon signaling server is running (optional detailed check)
async function checkServerStatus(host = 'localhost', port = 3000) {
  return new Promise((resolve) => {
    const req = request({
      hostname: host,
      port,
      path: '/health',
      method: 'GET',
      timeout: 1000 // Shorter timeout
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const status = JSON.parse(data);
          resolve({
            running: true,
            isPeerPigeon: true,
            status
          });
        } catch (error) {
          resolve({
            running: true,
            isPeerPigeon: false,
            error: 'Non-PeerPigeon server detected'
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({ running: false, error: error.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ running: false, error: 'Request timeout' });
    });

    req.end();
  });
}

class PeerPigeonCLI {
  constructor() {
    this.mesh = null;
    this.ready = false;
    this.config = this.loadConfig();
    this.interactiveRL = null; // Store readline interface for prompt management
    this.debugLevel = DEBUG_LEVELS.OFF; // Default debug level
    this.promptRestoreDebounce = null; // Debounce rapid prompt restore calls
  }

  // Safely restore the prompt to prevent terminal freezing
  safeRestorePrompt() {
    // Don't attempt prompt restoration if not in interactive mode
    if (!this.interactiveRL) {
      return;
    }

    // Debounce rapid calls to prevent issues
    if (this.promptRestoreDebounce) {
      clearTimeout(this.promptRestoreDebounce);
    }
    
    this.promptRestoreDebounce = setTimeout(() => {
      try {
        // Multiple safety checks to prevent hanging
        if (this.interactiveRL && 
            !this.interactiveRL.closed && 
            !this.interactiveRL.paused &&
            this.interactiveRL.line !== undefined) {
          
          // Check if stdin is readable
          if (process.stdin.readable) {
            this.interactiveRL.prompt();
          } else {
            // Fallback: write prompt directly to stdout
            process.stdout.write('pigeon> ');
          }
        }
      } catch (error) {
        console.error('❌ Error restoring prompt:', error.message);
        // Fallback: write prompt directly to stdout
        try {
          process.stdout.write('pigeon> ');
        } catch (fallbackError) {
          // If even this fails, log the error and continue
          console.error('❌ Critical prompt error:', fallbackError.message);
        }
      }
      this.promptRestoreDebounce = null;
    }, 100); // Increased delay for better stability
  }

  // Clean shutdown method
  shutdown() {
    try {
      if (this.promptRestoreDebounce) {
        clearTimeout(this.promptRestoreDebounce);
        this.promptRestoreDebounce = null;
      }

      if (this.interactiveRL && !this.interactiveRL.closed) {
        this.interactiveRL.close();
        this.interactiveRL = null;
      }

      if (this.mesh) {
        try {
          this.mesh.disconnect();
        } catch (meshError) {
          console.error('❌ Error disconnecting mesh:', meshError.message);
        }
        this.mesh = null;
      }
    } catch (error) {
      console.error('❌ Error during shutdown:', error.message);
    }
  }

  loadConfig() {
    try {
      if (existsSync(CONFIG_FILE)) {
        const savedConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
        // Merge with defaults to ensure new properties are added
        return {
          signalingUrl: savedConfig.signalingUrl || null,
          peerId: null, // Don't persist peer ID to avoid duplicate connection issues
          maxPeers: savedConfig.maxPeers || 5, // Same as browser default
          minPeers: savedConfig.minPeers || 0,
          autoDiscovery: savedConfig.autoDiscovery !== undefined ? savedConfig.autoDiscovery : true, // Enable auto discovery like browser
          enableWebDHT: savedConfig.enableWebDHT !== undefined ? savedConfig.enableWebDHT : true, // Enable WebDHT like browser
          enableCrypto: true // Force crypto to be enabled by default (ignore old config)
        };
      }
    } catch (error) {
      console.warn('Warning: Could not load config file');
    }
    return {
      signalingUrl: null,
      peerId: null, // Don't persist peer ID to avoid duplicate connection issues
      maxPeers: 5, // Same as browser default
      minPeers: 0,
      autoDiscovery: true, // Enable auto discovery like browser
      enableWebDHT: true, // Enable WebDHT like browser
      enableCrypto: true // Enable crypto like browser
    };
  }

  saveConfig() {
    try {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.warn('Warning: Could not save config file');
    }
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const symbols = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    console.log(`[${timestamp}] ${symbols[type] || symbols.info} ${message}`);
  }

  setDebugLevel(level) {
    if (typeof level === 'string') {
      level = level.toUpperCase();
      this.debugLevel = DEBUG_LEVELS[level] || DEBUG_LEVELS.OFF;
    } else if (typeof level === 'number') {
      this.debugLevel = Math.max(0, Math.min(5, level));
    }
  }

  debug(message, level = DEBUG_LEVELS.DEBUG) {
    if (this.debugLevel >= level) {
      const timestamp = new Date().toLocaleTimeString();
      const levelNames = ['OFF', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
      const levelName = levelNames[level] || 'DEBUG';
      const symbols = {
        [DEBUG_LEVELS.ERROR]: '🔴',
        [DEBUG_LEVELS.WARN]: '🟡',
        [DEBUG_LEVELS.INFO]: '🔵',
        [DEBUG_LEVELS.DEBUG]: '🟢',
        [DEBUG_LEVELS.TRACE]: '🟣'
      };
      console.log(`[${timestamp}] ${symbols[level]} [${levelName}] ${message}`);
    }
  }

  async initMesh(options) {
    try {
      // Initialize WebRTC first if not already done
      if (!global.RTCPeerConnection) {
        this.log('Initializing WebRTC for Node.js...', 'info');
        const success = await initializeWebRTC();
        if (!success) {
          throw new Error('Failed to initialize WebRTC dependencies');
        }
      }

      // Handle debug level if provided
      if (options.debug !== undefined) {
        this.setDebugLevel(options.debug);
        this.debug('Debug mode enabled', DEBUG_LEVELS.INFO);
      }

      this.log('Creating PeerPigeon mesh...', 'info');
      this.debug('Received options:', DEBUG_LEVELS.DEBUG);
      this.debug(`  peerId: ${options.peerId}`, DEBUG_LEVELS.DEBUG);
      this.debug(`  maxPeers: ${options.maxPeers}`, DEBUG_LEVELS.DEBUG);
      this.debug(`  minPeers: ${options.minPeers}`, DEBUG_LEVELS.DEBUG);
      this.debug(`  autoDiscovery: ${options.autoDiscovery}`, DEBUG_LEVELS.DEBUG);
      this.debug(`  enableWebdht: ${options.enableWebdht}`, DEBUG_LEVELS.DEBUG);
      this.debug(`  enableCrypto: ${options.enableCrypto}`, DEBUG_LEVELS.DEBUG);
      this.debug(`  debug: ${options.debug}`, DEBUG_LEVELS.DEBUG);

      // Generate a cryptographically secure peer ID using PeerPigeonMesh's method
      let freshPeerId = options.peerId;
      if (!freshPeerId) {
        freshPeerId = await PeerPigeonMesh.generatePeerId();
      }
      this.debug(`Generated peer ID: ${freshPeerId}`, DEBUG_LEVELS.TRACE);

      const enableWebDHT = options.enableWebdht !== undefined ? options.enableWebdht : this.config.enableWebDHT;
      const enableCrypto = options.enableCrypto !== undefined ? options.enableCrypto : this.config.enableCrypto;
      const autoDiscovery = options.autoDiscovery !== undefined ? options.autoDiscovery : this.config.autoDiscovery;

      this.debug(`Config values: enableWebDHT=${this.config.enableWebDHT}, enableCrypto=${this.config.enableCrypto}`, DEBUG_LEVELS.DEBUG);
      this.debug(`Final values: enableWebDHT=${enableWebDHT}, enableCrypto=${enableCrypto}, autoDiscovery=${autoDiscovery}`, DEBUG_LEVELS.DEBUG);

      const meshOptions = {
        peerId: freshPeerId, // Use generated unique ID
        maxPeers: options.maxPeers || this.config.maxPeers,
        minPeers: options.minPeers || this.config.minPeers,
        autoDiscovery,
        enableWebDHT,
        enableCrypto,
        ignoreEnvironmentErrors: true // Allow Node.js environment
      };
      this.debug(`Mesh options: ${JSON.stringify(meshOptions, null, 2)}`, DEBUG_LEVELS.TRACE);

      this.mesh = new PeerPigeonMesh(meshOptions);

      if (!this.mesh) {
        throw new Error('Failed to create PeerPigeonMesh instance');
      }

      this.debug('PeerPigeonMesh instance created successfully', DEBUG_LEVELS.TRACE);
      this.log('Setting up event handlers...', 'info');
      this.setupEventHandlers();

      this.log('Initializing mesh network...', 'info');
      
      // Add timeout to mesh initialization to prevent hanging
      const initPromise = this.mesh.init();
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Mesh initialization timeout')), 30000);
      });
      
      await Promise.race([initPromise, timeoutPromise]);
      this.ready = true;
      this.log('Mesh network initialized', 'success');
      this.log(`Using peer ID: ${this.mesh.peerId.substring(0, 8)}...`, 'info');

      // Don't save peer ID to config to ensure fresh ID each session
      if (options.maxPeers) this.config.maxPeers = options.maxPeers;
      if (options.minPeers) this.config.minPeers = options.minPeers;
      this.saveConfig();
    } catch (error) {
      this.log(`Error: ${error.message}`, 'error');
      this.log(`Stack: ${error.stack}`, 'error');
      throw error;
    }
  }

  async connectToSignaling(url) {
    try {
      // Use provided URL, saved config, or default to ws://localhost:3000
      const originalUrl = url;
      url = url || this.config.signalingUrl || 'ws://localhost:3000';
      
      this.debug(`connectToSignaling called with: ${originalUrl}`, DEBUG_LEVELS.DEBUG);
      this.debug(`Using URL: ${url} (from: ${originalUrl ? 'parameter' : this.config.signalingUrl ? 'config' : 'default'})`, DEBUG_LEVELS.DEBUG);

      this.log(`Connecting to signaling server at ${url}...`, 'info');

      // Connect once like browser peers - no aggressive reconnection
      this.debug('Calling mesh.connect()...', DEBUG_LEVELS.TRACE);
      
      // Add timeout to connection to prevent hanging
      const connectPromise = this.mesh.connect(url);
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), 15000);
      });
      
      await Promise.race([connectPromise, timeoutPromise]);
      this.config.signalingUrl = url;
      this.saveConfig();
      this.debug('Connection successful, config saved', DEBUG_LEVELS.TRACE);
      this.log(`Connected to ${url}`, 'success');
    } catch (error) {
      this.debug(`Connection failed: ${error.message}`, DEBUG_LEVELS.ERROR);
      this.log(`Failed to connect: ${error.message}`, 'error');

      // Only prompt for input if automatic connection failed and no saved URL
      if ((url === 'ws://localhost:3000' || !this.config.signalingUrl) && !this.config.signalingUrl) {
        this.log('Automatic connection failed, please provide a signaling server URL', 'info');
        try {
          const newUrl = await prompt('Enter signaling server URL', 'ws://localhost:3000', 15000);
          await this.mesh.connect(newUrl);
          this.config.signalingUrl = newUrl;
          this.saveConfig();
          this.log(`Connected to ${newUrl}`, 'success');
        } catch (promptError) {
          if (promptError.message.includes('timeout')) {
            this.log('Prompt timeout - using default URL ws://localhost:3000', 'warning');
            try {
              await this.mesh.connect('ws://localhost:3000');
              this.config.signalingUrl = 'ws://localhost:3000';
              this.saveConfig();
              this.log('Connected to ws://localhost:3000', 'success');
            } catch (retryError) {
              this.log(`Failed to connect to default URL: ${retryError.message}`, 'error');
              throw retryError;
            }
          } else {
            this.log(`Failed to connect: ${promptError.message}`, 'error');
            throw promptError;
          }
        }
      } else {
        throw error;
      }
    }
  }

  setupEventHandlers() {
    try {
      if (!this.mesh || typeof this.mesh.addEventListener !== 'function') {
        this.log('Warning: Mesh does not support event handling', 'warning');
        return;
      }

      this.debug('Setting up event handlers', DEBUG_LEVELS.TRACE);

      this.mesh.addEventListener('peerConnected', (data) => {
        try {
          this.debug(`Peer connected event: ${data.peerId}`, DEBUG_LEVELS.DEBUG);
          // Clear current line and move cursor to beginning
          process.stdout.write('\r\x1b[K');
          this.log(`🔗 Peer connected: ${data.peerId.substring(0, 8)}...`, 'success');
          // Safely restore the prompt if we're in interactive mode
          this.safeRestorePrompt();
        } catch (error) {
          console.error('❌ Error handling peerConnected event:', error.message);
        }
      });

      this.mesh.addEventListener('peerDisconnected', (data) => {
        try {
          this.debug(`Peer disconnected event: ${data.peerId}, reason: ${data.reason}`, DEBUG_LEVELS.DEBUG);
          // Clear current line and move cursor to beginning
          process.stdout.write('\r\x1b[K');
          this.log(`💔 Peer disconnected: ${data.peerId.substring(0, 8)}... (${data.reason})`, 'warning');
          // Safely restore the prompt if we're in interactive mode
          this.safeRestorePrompt();
        } catch (error) {
          console.error('❌ Error handling peerDisconnected event:', error.message);
        }
      });

      this.mesh.addEventListener('messageReceived', (data) => {
        try {
          this.debug(`Message received from ${data.from}: "${data.content}"`, DEBUG_LEVELS.DEBUG);
          const fromShort = data.from?.substring(0, 8) || 'unknown';
          // Clear current line and move cursor to beginning
          process.stdout.write('\r\x1b[K');
          this.log(`💬 Message from ${fromShort}...: ${data.content}`, 'success');
          // Safely restore the prompt if we're in interactive mode
          this.safeRestorePrompt();
        } catch (error) {
          console.error('❌ Error handling messageReceived event:', error.message);
        }
      });

      this.debug('Event handlers set up successfully', DEBUG_LEVELS.TRACE);
    } catch (error) {
      console.error('❌ Critical error setting up event handlers:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }

  async send(content, target = null) {
    if (!this.mesh) {
      this.log('Mesh not initialized', 'error');
      return;
    }

    this.debug(`Sending message: "${content}" ${target ? `to target ${target}` : 'as broadcast'}`, DEBUG_LEVELS.DEBUG);

    try {
      if (target) {
        this.debug(`Attempting direct message to ${target}`, DEBUG_LEVELS.TRACE);
        const success = this.mesh.sendDirectMessage(target, content);
        if (success) {
          this.debug('Direct message sent successfully', DEBUG_LEVELS.TRACE);
          this.log(`📤 Direct message sent to ${target.substring(0, 8)}...: ${content}`, 'success');
        } else {
          this.debug('Direct message failed to send', DEBUG_LEVELS.WARN);
          this.log(`Failed to send direct message to ${target.substring(0, 8)}...`, 'error');
        }
      } else {
        this.debug('Attempting broadcast message', DEBUG_LEVELS.TRACE);
        const messageId = this.mesh.sendMessage(content);
        this.debug(`Broadcast returned messageId: ${messageId}`, DEBUG_LEVELS.TRACE);
        if (messageId) {
          // Clear current line and show success message
          if (this.interactiveRL) {
            process.stdout.write('\r\x1b[K');
          }
          this.log(`📢 Broadcast message sent: ${content}`, 'success');
          // Safely restore prompt
          this.safeRestorePrompt();
        } else {
          this.debug('Broadcast message failed - no messageId returned', DEBUG_LEVELS.WARN);
          this.log('Failed to send broadcast message', 'error');
        }
      }
    } catch (error) {
      this.debug(`Send error: ${error.message}`, DEBUG_LEVELS.ERROR);
      this.log(`Failed to send message: ${error.message}`, 'error');
    }
  }

  showStatus() {
    try {
      if (!this.mesh) {
        console.log('Mesh not initialized');
        return;
      }

      this.debug('Getting mesh status', DEBUG_LEVELS.DEBUG);
      const status = this.mesh.getStatus();
      this.debug(`Status object: ${JSON.stringify(status, null, 2)}`, DEBUG_LEVELS.TRACE);
      
      console.log('\n📊 Mesh Network Status\n');
      console.log(`Peer ID:      ${status.peerId}`);
      console.log(`Connected:    ${status.connected ? 'Yes' : 'No'}`);
      console.log(`Signaling:    ${status.signalingUrl || 'Not set'}`);
      console.log(`Peers:        ${status.connectedCount}/${status.maxPeers} connected, ${status.discoveredCount} discovered`);
      console.log(`Auto Discovery: ${status.autoDiscovery ? 'Enabled' : 'Disabled'}`);
      console.log(`WebDHT:       ${this.mesh.webDHT ? 'Enabled' : 'Disabled'}`);
      console.log(`Crypto:       ${this.mesh.enableCrypto ? 'Enabled' : 'Disabled'}`);

      if (status.startTime) {
        const uptimeSeconds = Math.floor((Date.now() - status.startTime) / 1000);
        console.log(`Uptime:       ${uptimeSeconds}s`);
      }
      
      this.debug('Status display complete', DEBUG_LEVELS.DEBUG);
    } catch (error) {
      console.error('❌ Error displaying status:', error.message);
      console.error('Stack trace:', error.stack);
      console.log('Unable to retrieve mesh status - mesh may be in an invalid state');
    }
  }

  showPeers() {
    try {
      if (!this.mesh) {
        console.log('Mesh not initialized');
        return;
      }

      this.debug('Getting peer lists from mesh methods', DEBUG_LEVELS.DEBUG);
      
      const connectedPeers = this.mesh.getPeers();
      const discoveredPeers = this.mesh.getDiscoveredPeers();
      
      // Safe JSON stringify that handles BigInt values
      const safeStringify = (obj) => {
        try {
          return JSON.stringify(obj, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value, 2);
        } catch (error) {
          return `[Stringify error: ${error.message}]`;
        }
      };
      
      this.debug(`Connected peers: ${safeStringify(connectedPeers)}`, DEBUG_LEVELS.TRACE);
      this.debug(`Discovered peers: ${safeStringify(discoveredPeers)}`, DEBUG_LEVELS.TRACE);
      
      console.log('\n👥 Connected Peers\n');

      if (!connectedPeers || connectedPeers.length === 0) {
        console.log('No connected peers');
      } else {
        connectedPeers.forEach(peer => {
          try {
            const shortId = peer.peerId.substring(0, 8);
            console.log(`${shortId}... Connected`);
          } catch (peerError) {
            console.log(`[Error displaying peer: ${peerError.message}]`);
          }
        });
      }

      console.log('\n🔍 Discovered Peers\n');
      if (!discoveredPeers || discoveredPeers.length === 0) {
        console.log('No discovered peers');
      } else {
        discoveredPeers.forEach(peer => {
          try {
            const shortId = peer.peerId.substring(0, 8);
            console.log(`${shortId}... ${peer.isConnected ? '(connected)' : '(discovered)'}`);
          } catch (peerError) {
            console.log(`[Error displaying peer: ${peerError.message}]`);
          }
        });
      }
    } catch (error) {
      console.error('❌ Error displaying peers:', error.message);
      console.error('Stack trace:', error.stack);
      console.log('Unable to retrieve peer information - mesh may be in an invalid state');
    }
  }

  disconnect() {
    try {
      if (this.mesh) {
        this.mesh.disconnect();
        this.log('Disconnected from mesh', 'info');
      } else {
        this.log('Mesh not initialized - nothing to disconnect', 'warning');
      }
    } catch (error) {
      console.error('❌ Error during disconnect:', error.message);
      console.error('Stack trace:', error.stack);
      this.log('Disconnect completed with errors', 'warning');
    }
  }
}

// Simple argument parser
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        // Handle boolean values explicitly
        if (nextArg === 'true') {
          options[key] = true;
          i++;
        } else if (nextArg === 'false') {
          options[key] = false;
          i++;
        } else {
          const numValue = parseInt(nextArg);
          options[key] = isNaN(numValue) ? nextArg : numValue;
          i++; // Skip next arg since we used it as value
        }
      } else {
        options[key] = true; // Boolean flag
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        // Handle boolean values explicitly
        if (nextArg === 'true') {
          options[key] = true;
          i++;
        } else if (nextArg === 'false') {
          options[key] = false;
          i++;
        } else {
          const numValue = parseInt(nextArg);
          options[key] = isNaN(numValue) ? nextArg : numValue;
          i++;
        }
      } else {
        options[key] = true;
      }
    } else if (!command) {
      // This is the command if we haven't set one yet
      args.unshift(arg);
      i--;
    } else {
      // This is a positional argument
      if (!options._positional) options._positional = [];
      options._positional.push(arg);
    }
  }

  return { command, options };
}

function showHelp() {
  console.log(`
PeerPigeon CLI - Mesh networking CLI

Usage: 
  node cli.js <command> [options]    # Single command mode
  node cli.js                        # Interactive mode

Commands:
  init [options]            Initialize and connect to mesh network
  send <message>           Send broadcast message to all peers
  status                   Show mesh network status
  peers                    List connected and discovered peers
  server-status [options]  Check if signaling server is running
  server [options]         Start signaling server
  help                     Show this help message

Interactive Mode:
  Run "node cli.js" without arguments to enter interactive mode.
  In interactive mode, you can run multiple commands sequentially.
  Type "exit" or "quit" to leave interactive mode.

Options:
  Server command:
    --port, -p <port>      Server port (default: 3000)
    --host, -h <host>      Server host (default: localhost)
    --max-connections <n>  Maximum connections (default: 3)
    --force, -f            Force start even if server already running

  Init command:
    --url, -u <url>        Signaling server URL
    --peer-id <id>         Custom peer ID
    --max-peers <n>        Maximum peers
    --min-peers <n>        Minimum peers
    --auto-discovery <bool> Auto discovery (true|false)
    --webdht <bool>        WebDHT (true|false)
    --crypto <bool>        Encryption (true|false)
    --debug, -d <level>    Debug level (off, error, warn, info, debug, trace)

  Server-status command:
    --port, -p <port>      Server port (default: 3000)
    --host, -h <host>      Server host (default: localhost)

Examples:
  node cli.js server --port 3000 --max-connections 3
  node cli.js init --url ws://localhost:3000 --max-peers 5
  node cli.js init --peer-id abc123... --webdht true
  node cli.js init --auto-discovery false --crypto true
  node cli.js init --debug info          # Enable info-level debugging
  node cli.js init --debug trace         # Enable verbose trace debugging
  node cli.js send "Hello mesh!"
  node cli.js server-status --port 3000
  node cli.js                # Start interactive mode
`);
}

// Create CLI instance
const cli = new PeerPigeonCLI();
const { command, options } = parseArgs();

// Handle commands
async function handleCommand() {
  try {
    switch (command) {
      case 'init': {
        try {
          await cli.initMesh({
            peerId: options['peer-id'],
            maxPeers: options['max-peers'],
            minPeers: options['min-peers'],
            autoDiscovery: options['auto-discovery'],
            enableWebdht: options.webdht,
            enableCrypto: options.crypto,
            debug: options.debug || options.d
          });
          await cli.connectToSignaling(options.url || options.u);
        } catch (initError) {
          console.error('❌ Initialization failed:', initError.message);
          console.error('Stack trace:', initError.stack);
          process.exit(1);
        }
        break;
      }

      case 'send': {
        try {
          const messageWords = options._positional || [];
          if (messageWords.length === 0) {
            console.error('Error: Message required for send command');
            process.exit(1);
          }
          // Join all words to reconstruct the full message
          const message = messageWords.join(' ').replace(/^"|"$/g, ''); // Remove surrounding quotes if present
          if (!cli.mesh) {
            await cli.initMesh({});
            await cli.connectToSignaling();
          }
          await cli.send(message);
        } catch (sendError) {
          console.error('❌ Send command failed:', sendError.message);
          console.error('Stack trace:', sendError.stack);
          process.exit(1);
        }
        break;
      }

      case 'status':
        cli.showStatus();
        break;

      case 'peers':
        cli.showPeers();
        break;

      case 'server-status': {
        try {
          const host = options.host || options.h || 'localhost';
          const port = options.port || options.p || 3000;

          cli.log(`🔍 Checking server at ${host}:${port}...`, 'info');
          const serverStatus = await checkServerStatus(host, port);

          if (serverStatus.running) {
            cli.log(`🟢 Server is running on ${host}:${port}`, 'success');
            console.log('\nServer Details:');
            console.log(`  Status: ${serverStatus.status?.status || 'unknown'}`);
            console.log(`  Uptime: ${serverStatus.status ? Math.floor(serverStatus.status.uptime) : 'n/a'}s`);
            console.log(`  Connections: ${serverStatus.status?.connections || 'n/a'}`);
            console.log(`  Peers: ${serverStatus.status?.peers || 'n/a'}`);
            console.log(`  Memory: ${serverStatus.status ? Math.round(serverStatus.status.memory.heapUsed / 1024 / 1024) : 'n/a'}MB`);
          } else {
            cli.log(`🔴 No server running on ${host}:${port}`, 'warning');
            if (serverStatus.error) {
              console.log(`Error: ${serverStatus.error}`);
            }
          }
        } catch (statusError) {
          console.error('❌ Server status check failed:', statusError.message);
          console.error('Stack trace:', statusError.stack);
          process.exit(1);
        }
        break;
      }

      case 'server': {
        try {
          const serverHost = options.host || options.h || 'localhost';
          const serverPort = options.port || options.p || 3000;
          const maxConnections = options['max-connections'] || 3;

          if (!options.force && !options.f) {
            cli.log('Checking for existing server...', 'info');
            const portCheck = await checkPortInUse(serverHost, serverPort);

            if (portCheck.inUse) {
              cli.log(`Port ${serverPort} is already in use on ${serverHost}`, 'warning');

              const serverStatus = await checkServerStatus(serverHost, serverPort);
              if (serverStatus.running && serverStatus.isPeerPigeon) {
                console.log('\nPeerPigeon Server Details:');
                console.log(`  Uptime: ${Math.floor(serverStatus.status.uptime)}s`);
                console.log(`  Connections: ${serverStatus.status.connections}`);
                console.log(`  Peers: ${serverStatus.status.peers}`);
              } else {
                console.log('\nAnother service is using this port.');
              }

              console.log('\nUse --force to start anyway, or use a different port.');
              return;
            }
          }

          cli.log('Starting signaling server...', 'info');
          const server = new PeerPigeonServer({
            port: serverPort,
            host: serverHost,
            maxConnections
          });
          await server.start();
          cli.log(`Signaling server running on ${serverHost}:${serverPort}`, 'success');

          process.on('SIGINT', () => {
            console.log('\nShutting down server...');
            try {
              server.stop();
            } catch (stopError) {
              console.error('❌ Error stopping server:', stopError.message);
            }
            process.exit(0);
          });
        } catch (serverError) {
          console.error('❌ Server command failed:', serverError.message);
          console.error('Stack trace:', serverError.stack);
          process.exit(1);
        }
        break;
      }

      case 'help':
      case '--help':
      case '-h':
        try {
          showHelp();
        } catch (helpError) {
          console.error('❌ Error displaying help:', helpError.message);
          console.log('PeerPigeon CLI - Help system unavailable');
        }
        break;

      default:
        try {
          if (!command) {
            showHelp();
          } else {
            console.error(`Error: Unknown command '${command}'`);
            console.error('Use "node cli.js help" for usage information');
            process.exit(1);
          }
        } catch (defaultError) {
          console.error('❌ Error in default command handler:', defaultError.message);
          process.exit(1);
        }
    }
  } catch (error) {
    console.error('❌ Critical command handler error:', error.message);
    console.error('Stack trace:', error.stack);
    cli.log(`Command execution failed: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  cli.disconnect();
  process.exit(0);
});

// Execute the command or start interactive mode
if (command) {
  // Single command mode
  handleCommand();
} else {
  // Interactive mode
  startInteractiveMode();
}

// Interactive mode function
async function startInteractiveMode() {
  console.log('🐦 PeerPigeon CLI - Interactive Mode');
  console.log('Type "help" for available commands or "exit" to quit');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'pigeon> ',
    history: [], // Enable command history
    historySize: 100 // Keep last 100 commands
  });

  // Store readline interface reference for message handling
  cli.interactiveRL = rl;

  rl.prompt();

  rl.on('line', async (line) => {
    try {
      const input = line.trim();

      if (input === 'exit' || input === 'quit') {
        console.log('Goodbye! 🐦');
        try {
          rl.close();
        } catch (closeError) {
          console.error('❌ Error closing readline:', closeError.message);
        }
        process.exit(0);
        return;
      }

      if (input === 'clear') {
        console.clear();
        rl.prompt();
        return;
      }

      if (input === '') {
        rl.prompt();
        return;
      }

      try {
        // Parse the interactive command
        const args = input.split(' ');
        const interactiveCommand = args[0];
        const interactiveOptions = {};
        const positionalArgs = [];

        // Simple parsing for interactive mode
        for (let i = 1; i < args.length; i++) {
          const arg = args[i];
          if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('--') && !nextArg.startsWith('-')) {
              // Handle boolean values explicitly
              if (nextArg === 'true') {
                interactiveOptions[key] = true;
                i++;
              } else if (nextArg === 'false') {
                interactiveOptions[key] = false;
                i++;
              } else {
                const numValue = parseInt(nextArg);
                interactiveOptions[key] = isNaN(numValue) ? nextArg : numValue;
                i++; // Skip next arg since we used it as value
              }
            } else {
              interactiveOptions[key] = true; // Boolean flag
            }
          } else if (arg.startsWith('-') && arg.length === 2) {
            const key = arg.slice(1);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('-')) {
              // Handle boolean values explicitly
              if (nextArg === 'true') {
                interactiveOptions[key] = true;
                i++;
              } else if (nextArg === 'false') {
                interactiveOptions[key] = false;
                i++;
              } else {
                const numValue = parseInt(nextArg);
                interactiveOptions[key] = isNaN(numValue) ? nextArg : numValue;
                i++;
              }
            } else {
              interactiveOptions[key] = true;
            }
          } else {
            positionalArgs.push(arg);
          }
        }

        if (positionalArgs.length > 0) {
          interactiveOptions._positional = positionalArgs;
        }

        // Execute the interactive command
        await executeInteractiveCommand(interactiveCommand, interactiveOptions);
      } catch (parseError) {
        console.error(`❌ Command parsing error: ${parseError.message}`);
        console.error('Stack trace:', parseError.stack);
      }

    } catch (lineError) {
      console.error(`❌ Critical line handler error: ${lineError.message}`);
      console.error('Stack trace:', lineError.stack);
    }

    // Safely restore prompt
    try {
      if (!rl.closed) {
        rl.prompt();
      }
    } catch (promptError) {
      console.error('❌ Error restoring prompt:', promptError.message);
      // Try to create a new prompt
      try {
        process.stdout.write('pigeon> ');
      } catch (fallbackError) {
        console.error('❌ Critical prompt fallback error:', fallbackError.message);
      }
    }
  });

  rl.on('close', () => {
    try {
      console.log('\n👋 Goodbye!');
      cli.shutdown();
      process.exit(0);
    } catch (closeError) {
      console.error('❌ Error during close:', closeError.message);
      process.exit(1);
    }
  });

  // Add error handler for the readline interface
  rl.on('error', (error) => {
    console.error('❌ Readline error:', error.message);
    console.error('The CLI may become unresponsive. Please restart if needed.');
  });
}

// Execute commands in interactive mode
async function executeInteractiveCommand(cmd, opts) {
  try {
    switch (cmd) {
      case 'init': {
        try {
          await cli.initMesh({
            peerId: opts['peer-id'],
            maxPeers: opts['max-peers'],
            minPeers: opts['min-peers'],
            autoDiscovery: opts['auto-discovery'],
            enableWebdht: opts.webdht,
            enableCrypto: opts.crypto,
            debug: opts.debug || opts.d
          });
          await cli.connectToSignaling(opts.url || opts.u);
        } catch (initError) {
          console.error('❌ Interactive init failed:', initError.message);
          console.error('Stack trace:', initError.stack);
        }
        break;
      }

      case 'send': {
        try {
          const messageWords = opts._positional || [];
          if (messageWords.length === 0) {
            console.error('Error: Message required for send command');
            return;
          }
          // Join all words to reconstruct the full message
          const message = messageWords.join(' ').replace(/^"|"$/g, ''); // Remove surrounding quotes if present
          if (!cli.mesh) {
            console.log('Mesh not initialized. Initializing...');
            await cli.initMesh({});
            await cli.connectToSignaling();
          }
          await cli.send(message);
        } catch (sendError) {
          console.error('❌ Interactive send failed:', sendError.message);
          console.error('Stack trace:', sendError.stack);
        }
        break;
      }

      case 'status':
        cli.showStatus();
        break;

      case 'peers':
        cli.showPeers();
        break;

      case 'server-status': {
        try {
          const host = opts.host || opts.h || 'localhost';
          const port = opts.port || opts.p || 3000;

          cli.log(`🔍 Checking server at ${host}:${port}...`, 'info');
          const serverStatus = await checkServerStatus(host, port);

          if (serverStatus.running) {
            cli.log(`🟢 Server is running on ${host}:${port}`, 'success');
            console.log('\nServer Details:');
            console.log(`  Status: ${serverStatus.status?.status || 'unknown'}`);
            console.log(`  Uptime: ${serverStatus.status ? Math.floor(serverStatus.status.uptime) : 'n/a'}s`);
            console.log(`  Connections: ${serverStatus.status?.connections || 'n/a'}`);
            console.log(`  Peers: ${serverStatus.status?.peers || 'n/a'}`);
            console.log(`  Memory: ${serverStatus.status ? Math.round(serverStatus.status.memory.heapUsed / 1024 / 1024) : 'n/a'}MB`);
          } else {
            cli.log(`🔴 No server running on ${host}:${port}`, 'warning');
            if (serverStatus.error) {
              console.log(`Error: ${serverStatus.error}`);
            }
          }
        } catch (statusError) {
          console.error('❌ Interactive server-status failed:', statusError.message);
          console.error('Stack trace:', statusError.stack);
        }
        break;
      }

      case 'connect': {
        try {
          const url = opts._positional?.[0] || opts.url || opts.u;
          if (!url) {
            console.error('Error: URL required for connect command');
            return;
          }
          if (!cli.mesh) {
            console.log('Mesh not initialized. Initializing...');
            await cli.initMesh({});
          }
          await cli.connectToSignaling(url);
        } catch (connectError) {
          console.error('❌ Interactive connect failed:', connectError.message);
          console.error('Stack trace:', connectError.stack);
        }
        break;
      }

      case 'disconnect':
        cli.disconnect();
        break;

      case 'help':
        try {
          showInteractiveHelp();
        } catch (helpError) {
          console.error('❌ Error displaying interactive help:', helpError.message);
          console.log('Interactive help system unavailable');
        }
        break;

      case 'server': {
        try {
          console.log('Note: Server command starts a background process. Use Ctrl+C to stop it.');
          const serverHost = opts.host || opts.h || 'localhost';
          const serverPort = opts.port || opts.p || 3000;
          const maxConnections = opts['max-connections'] || 3;

          if (!opts.force && !opts.f) {
            cli.log('Checking for existing server...', 'info');
            const portCheck = await checkPortInUse(serverHost, serverPort);

            if (portCheck.inUse) {
              cli.log(`Port ${serverPort} is already in use on ${serverHost}`, 'warning');

              const serverStatus = await checkServerStatus(serverHost, serverPort);
              if (serverStatus.running && serverStatus.isPeerPigeon) {
                console.log('\nPeerPigeon Server Details:');
                console.log(`  Uptime: ${Math.floor(serverStatus.status.uptime)}s`);
                console.log(`  Connections: ${serverStatus.status.connections}`);
                console.log(`  Peers: ${serverStatus.status.peers}`);
              } else {
                console.log('\nAnother service is using this port.');
              }

              console.log('\nUse --force to start anyway, or use a different port.');
              return;
            }
          }

          cli.log('Starting signaling server...', 'info');
          const server = new PeerPigeonServer({
            port: serverPort,
            host: serverHost,
            maxConnections
          });
          await server.start();
          cli.log(`Signaling server running on ${serverHost}:${serverPort}`, 'success');
          console.log('Server is running in background. Use Ctrl+C to stop or type "exit" to quit CLI.');
        } catch (serverError) {
          console.error('❌ Interactive server failed:', serverError.message);
          console.error('Stack trace:', serverError.stack);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${cmd}`);
        console.error('Type "help" for available commands');
    }
  } catch (error) {
    console.error('❌ Critical interactive command error:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

function showInteractiveHelp() {
  console.log(`
🐦 PeerPigeon CLI - Interactive Commands

Available commands:
  init [options]                Initialize and connect to mesh network
  connect <url>                 Connect to signaling server
  send <message>               Send broadcast message to all peers
  status                       Show mesh network status
  peers                        List connected and discovered peers
  server-status [options]      Check if signaling server is running
  server [options]             Start signaling server (background)
  disconnect                   Disconnect from mesh network
  clear                        Clear the screen
  help                         Show this help message
  exit, quit                   Exit the CLI

Options (same as command-line mode):
  --port, -p <port>           Server port (default: 3000)
  --host, -h <host>           Server host (default: localhost)
  --max-connections <n>       Maximum connections (default: 3)
  --force, -f                 Force start even if server already running
  --url, -u <url>             Signaling server URL
  --peer-id <id>              Custom peer ID
  --max-peers <n>             Maximum peers
  --min-peers <n>             Minimum peers
  --auto-discovery <bool>     Auto discovery (true|false)
  --webdht <bool>             WebDHT (true|false)
  --crypto <bool>             Encryption (true|false)
  --debug, -d <level>         Debug level (off, error, warn, info, debug, trace)

Examples:
  init --max-peers 5
  init --webdht true --crypto false
  init --auto-discovery false
  init --debug info           # Enable info-level debugging
  init --debug trace          # Enable verbose trace debugging
  connect ws://localhost:3000
  send "Hello from interactive mode!"
  server --port 3001 --max-connections 50
  server-status --port 3000
`);
}
