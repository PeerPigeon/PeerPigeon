/**
 * Integration Tests for PeerPigeon
 * Tests core functionality without requiring external signaling server
 */

import { jest } from '@jest/globals';
import { PeerPigeonMesh } from '../../index.js';

describe('PeerPigeon Integration Tests', () => {
  let meshInstances = [];

  beforeEach(() => {
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Clean up all mesh instances
    for (const mesh of meshInstances) {
      if (mesh) {
        mesh.disconnect();
      }
    }
    meshInstances = [];
    jest.clearAllMocks();
    jest.restoreAllMocks();
    
    // Give some time for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  async function createTestPeer(name, options = {}) {
    const mesh = new PeerPigeonMesh({
      ignoreEnvironmentErrors: true,
      ...options
    });
    
    await mesh.init();
    meshInstances.push(mesh);
    return mesh;
  }

  test('Mesh initialization and configuration', async () => {
    const peer = await createTestPeer('TestPeer');
    
    expect(peer.peerId).toBeTruthy();
    expect(peer.peerId.length).toBe(40);
    
    const status = peer.getStatus();
    expect(status.peerId).toBeTruthy();
    expect(typeof status.connected).toBe('boolean');
    expect(typeof status.connectedCount).toBe('number');
  });

  test('Crypto integration with mesh', async () => {
    const peer1 = await createTestPeer('CryptoPeer1', { enableCrypto: true });
    const peer2 = await createTestPeer('CryptoPeer2', { enableCrypto: true });
    
    // Verify crypto is enabled
    const status1 = peer1.getCryptoStatus();
    const status2 = peer2.getCryptoStatus();
    
    expect(status1.enabled).toBe(true);
    expect(status2.enabled).toBe(true);
    expect(status1.initialized).toBe(true);
    expect(status2.initialized).toBe(true);
  });

  test('WebDHT integration with mesh', async () => {
    const peer = await createTestPeer('DHTPeer', { enableWebDHT: true });
    
    expect(peer.isDHTEnabled()).toBe(true);
    
    const stats = peer.getDHTStats();
    expect(stats).toBeTruthy();
    expect(typeof stats).toBe('object');
  });

  test('Environment detection integration', async () => {
    const peer = await createTestPeer('EnvPeer');
    
    const report = peer.getEnvironmentReport();
    expect(report).toBeTruthy();
    expect(report.runtime).toBeTruthy();
    expect(report.capabilities).toBeTruthy();
    
    const capabilities = peer.getCapabilities();
    expect(typeof capabilities).toBe('object');
    
    const runtimeInfo = peer.getRuntimeInfo();
    expect(typeof runtimeInfo).toBe('object');
  });

  test('Message validation and error handling', async () => {
    const peer = await createTestPeer('ValidationPeer');
    
    // Test invalid peer ID for direct message
    const result1 = peer.sendDirectMessage('invalid-id', 'test message');
    expect(result1).toBe(null);
    
    // Test empty target
    const result2 = peer.sendDirectMessage('', 'test message');
    expect(result2).toBe(null);
    
    const result3 = peer.sendDirectMessage(null, 'test message');
    expect(result3).toBe(null);
  });

  test('Mesh cleanup and resource management', async () => {
    const peer = await createTestPeer('CleanupPeer', { enableCrypto: true, enableWebDHT: true });
    
    // Verify initialization
    expect(peer.getCryptoStatus().enabled).toBe(true);
    expect(peer.isDHTEnabled()).toBe(true);
    
    // Test disconnect
    peer.disconnect();
    
    const status = peer.getStatus();
    expect(status.connected).toBe(false);
    
    // Disconnect should not throw (already called above)
    expect(() => peer.disconnect()).not.toThrow();
  });

  test('Configuration persistence and validation', async () => {
    const peer = await createTestPeer('ConfigPeer');
    
    // Test maxPeers configuration
    const maxPeers = peer.setMaxPeers(5);
    expect(maxPeers).toBe(5);
    
    // Test bounds validation
    const tooMany = peer.setMaxPeers(100);
    expect(tooMany).toBe(50);
    
    // Test minPeers configuration
    const minPeers = peer.setMinPeers(2);
    expect(minPeers).toBe(2);
    
    // Test XOR routing toggle
    peer.setXorRouting(true);
    expect(peer.xorRouting).toBe(true);
    
    peer.setXorRouting(false);
    expect(peer.xorRouting).toBe(false);
  });
});
