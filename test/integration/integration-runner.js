#!/usr/bin/env node

/**
 * Integration Tests for PeerPigeon
 * Tests peer-to-peer connectivity, message routing, and mesh formation
 */

import { PeerPigeonMesh } from '../../index.js';
import WebSocket from 'ws';
import wrtc from '@koush/wrtc';

// Make WebRTC available globally for Node.js
global.RTCPeerConnection = wrtc.RTCPeerConnection;
global.RTCSessionDescription = wrtc.RTCSessionDescription;
global.RTCIceCandidate = wrtc.RTCIceCandidate;
global.WebSocket = WebSocket;

class IntegrationTestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.signalingUrl = 'ws://localhost:3000';
  }

  test(name, testFn, timeout = 15000) {
    this.tests.push({ name, testFn, timeout });
  }

  async run() {
    console.log('🧪 Running Integration Tests\n');
    console.log('⚠️  Note: These tests require a running signaling server (npm run server)\n');

    // Check if signaling server is available
    const serverAvailable = await this.checkSignalingServer();
    if (!serverAvailable) {
      console.log('❌ Signaling server not available at', this.signalingUrl);
      console.log('   Please run: npm run server');
      return false;
    }

    console.log('✅ Signaling server is available\n');

    for (const { name, testFn, timeout } of this.tests) {
      try {
        process.stdout.write(`  ${name}... `);

        // Create a timeout promise
        const timeoutPromise = new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout);
        });

        // Race the test against the timeout
        await Promise.race([testFn(), timeoutPromise]);

        console.log('✅ PASS');
        this.passed++;
      } catch (error) {
        console.log('❌ FAIL');
        console.log(`    Error: ${error.message}`);
        this.failed++;
      }
    }

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }

  async checkSignalingServer() {
    return new Promise((resolve) => {
      const ws = new WebSocket(this.signalingUrl);

      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  async createTestPeer(name, options = {}) {
    const mesh = new PeerPigeonMesh({
      ignoreEnvironmentErrors: true,
      ...options
    });

    await mesh.init();
    return mesh;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const runner = new IntegrationTestRunner();

runner.test('Single peer connection to signaling server', async () => {
  const peer = await runner.createTestPeer('TestPeer');

  let connected = false;
  peer.addEventListener('statusChanged', (event) => {
    if (event.type === 'connected') {
      connected = true;
    }
  });

  await peer.connect(runner.signalingUrl);

  // Wait a bit for connection
  await runner.sleep(2000);

  if (!connected) {
    throw new Error('Peer did not connect to signaling server');
  }

  peer.disconnect();
});

runner.test('Two peer mesh formation', async () => {
  const peer1 = await runner.createTestPeer('Peer1');
  const peer2 = await runner.createTestPeer('Peer2');

  let peer1Connected = false;
  let peer2Connected = false;
  let peersConnected = false;

  peer1.addEventListener('statusChanged', (event) => {
    if (event.type === 'connected') peer1Connected = true;
  });

  peer2.addEventListener('statusChanged', (event) => {
    if (event.type === 'connected') peer2Connected = true;
  });

  peer1.addEventListener('peerConnected', () => {
    peersConnected = true;
  });

  // Connect both peers
  await peer1.connect(runner.signalingUrl);
  await peer2.connect(runner.signalingUrl);

  // Wait for signaling connections
  await runner.sleep(2000);

  if (!peer1Connected || !peer2Connected) {
    throw new Error('Peers did not connect to signaling server');
  }

  // Wait for peer-to-peer connection
  await runner.sleep(5000);

  if (!peersConnected) {
    throw new Error('Peers did not connect to each other');
  }

  peer1.disconnect();
  peer2.disconnect();
});

runner.test('Message broadcasting', async () => {
  const peer1 = await runner.createTestPeer('Peer1');
  const peer2 = await runner.createTestPeer('Peer2');

  let messageReceived = false;
  const testMessage = 'Hello from integration test!';

  peer2.addEventListener('messageReceived', (event) => {
    if (event.content === testMessage) {
      messageReceived = true;
    }
  });

  // Connect both peers
  await peer1.connect(runner.signalingUrl);
  await peer2.connect(runner.signalingUrl);

  // Wait for connections
  await runner.sleep(5000);

  // Send message from peer1
  peer1.sendMessage(testMessage);

  // Wait for message to propagate
  await runner.sleep(2000);

  if (!messageReceived) {
    throw new Error('Message was not received by peer2');
  }

  peer1.disconnect();
  peer2.disconnect();
});

runner.test('Crypto integration', async () => {
  const peer1 = await runner.createTestPeer('CryptoPeer1', { enableCrypto: true });
  const peer2 = await runner.createTestPeer('CryptoPeer2', { enableCrypto: true });

  // Verify crypto is enabled
  const status1 = peer1.getCryptoStatus();
  const status2 = peer2.getCryptoStatus();

  if (!status1.enabled || !status2.enabled) {
    throw new Error('Crypto is not enabled on test peers');
  }

  // Test self-encryption (benchmark style)
  const testMessage = 'Crypto integration test message';
  const encrypted = await peer1.encryptMessage(testMessage);
  const decrypted = await peer1.decryptMessage(encrypted);

  if (decrypted !== testMessage) {
    throw new Error(`Decrypted message "${decrypted}" does not match original "${testMessage}"`);
  }

  peer1.disconnect();
  peer2.disconnect();
});

runner.test('WebDHT integration', async () => {
  const peer1 = await runner.createTestPeer('DHTPeer1', { enableWebDHT: true });
  const peer2 = await runner.createTestPeer('DHTPeer2', { enableWebDHT: true });

  // Connect peers
  await peer1.connect(runner.signalingUrl);
  await peer2.connect(runner.signalingUrl);

  // Wait for connections
  await runner.sleep(5000);

  // Test DHT operations
  const testKey = 'integration-test-key';
  const testValue = { message: 'DHT integration test', timestamp: Date.now() };

  // Store value with peer1
  const stored = await peer1.dhtPut(testKey, testValue);
  if (!stored) {
    throw new Error('Failed to store value in DHT');
  }

  // Wait for replication
  await runner.sleep(2000);

  // Retrieve value with peer2
  const retrieved = await peer2.dhtGet(testKey);
  if (!retrieved || retrieved.message !== testValue.message) {
    throw new Error('Failed to retrieve value from DHT or value mismatch');
  }

  peer1.disconnect();
  peer2.disconnect();
});

runner.test('Peer discovery and optimization', async () => {
  const peer1 = await runner.createTestPeer('DiscoveryPeer1');
  const peer2 = await runner.createTestPeer('DiscoveryPeer2');
  const peer3 = await runner.createTestPeer('DiscoveryPeer3');

  // Connect all peers
  await peer1.connect(runner.signalingUrl);
  await peer2.connect(runner.signalingUrl);
  await peer3.connect(runner.signalingUrl);

  // Wait for discovery
  await runner.sleep(5000);

  // Check that peer1 discovered the other peers
  const discovered = peer1.getDiscoveredPeers();
  if (discovered.length < 2) {
    throw new Error(`Expected at least 2 discovered peers, got ${discovered.length}`);
  }

  peer1.disconnect();
  peer2.disconnect();
  peer3.disconnect();
});

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runner.run().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

export { runner as integrationTests };
