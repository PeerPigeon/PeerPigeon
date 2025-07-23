/**
 * Unit Tests for PeerPigeonMesh
 * Tests core mesh functionality, peer management, and message routing
 */

import * as jestGlobals from '@jest/globals';
import { PeerPigeonMesh } from '../../index.js';

const { jest } = jestGlobals;

describe('PeerPigeonMesh Unit Tests', () => {
  let mesh;

  beforeEach(() => {
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (mesh) {
      mesh.disconnect();
      mesh = null;
    }
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('PeerPigeonMesh initialization', async () => {
    mesh = new PeerPigeonMesh({
      ignoreEnvironmentErrors: true
    });

    await mesh.init();

    expect(mesh.peerId).toBeTruthy();
    expect(mesh.peerId.length).toBe(40);
    expect(/^[a-fA-F0-9]{40}$/.test(mesh.peerId)).toBe(true);
  });

  test('Peer ID validation', () => {
    const validId = 'a1b2c3d4e5f6789012345678901234567890abcd';
    const invalidId = 'invalid-peer-id';

    expect(PeerPigeonMesh.validatePeerId(validId)).toBe(true);
    expect(PeerPigeonMesh.validatePeerId(invalidId)).toBe(false);
    expect(PeerPigeonMesh.validatePeerId(null)).toBe(false);
    expect(PeerPigeonMesh.validatePeerId('')).toBe(false);
  });

  test('Configuration methods', async () => {
    mesh = new PeerPigeonMesh({
      ignoreEnvironmentErrors: true
    });
    await mesh.init();

    // Test maxPeers
    const maxPeers = mesh.setMaxPeers(5);
    expect(maxPeers).toBe(5);

    // Test bounds
    const tooMany = mesh.setMaxPeers(100);
    expect(tooMany).toBe(50);

    // Test minPeers
    const minPeers = mesh.setMinPeers(2);
    expect(minPeers).toBe(2);

    // Test XOR routing
    mesh.setXorRouting(true);
    expect(mesh.xorRouting).toBe(true);

    mesh.setXorRouting(false);
    expect(mesh.xorRouting).toBe(false);
  });

  test('Status and information methods', async () => {
    mesh = new PeerPigeonMesh({
      ignoreEnvironmentErrors: true
    });
    await mesh.init();

    const status = mesh.getStatus();
    expect(status.peerId).toBeTruthy();
    expect(typeof status.connected).toBe('boolean');
    expect(typeof status.connectedCount).toBe('number');
    expect(typeof status.maxPeers).toBe('number');
    expect(typeof status.minPeers).toBe('number');
  });

  test('Environment validation', async () => {
    mesh = new PeerPigeonMesh({
      ignoreEnvironmentErrors: true
    });

    const report = mesh.getEnvironmentReport();
    expect(report).toBeTruthy();
    expect(report.runtime).toBeTruthy();
    expect(report.capabilities).toBeTruthy();

    const capabilities = mesh.getCapabilities();
    expect(typeof capabilities).toBe('object');

    const runtimeInfo = mesh.getRuntimeInfo();
    expect(typeof runtimeInfo).toBe('object');
  });

  test('Crypto initialization', async () => {
    mesh = new PeerPigeonMesh({
      enableCrypto: true,
      ignoreEnvironmentErrors: true
    });
    await mesh.init();

    const status = mesh.getCryptoStatus();
    expect(status.enabled).toBe(true);
    expect(status.initialized).toBe(true);
    expect(status.publicKey).toBeTruthy();
  });

  test('WebDHT functionality', async () => {
    mesh = new PeerPigeonMesh({
      enableWebDHT: true,
      ignoreEnvironmentErrors: true
    });
    await mesh.init();

    expect(mesh.isDHTEnabled()).toBe(true);

    const stats = mesh.getDHTStats();
    expect(stats).toBeTruthy();
  });

  test('Cleanup functionality', async () => {
    mesh = new PeerPigeonMesh({
      ignoreEnvironmentErrors: true
    });
    await mesh.init();

    // Test disconnect
    mesh.disconnect();

    const status = mesh.getStatus();
    expect(status.connected).toBe(false);
  });

  test('Message validation', async () => {
    mesh = new PeerPigeonMesh({
      ignoreEnvironmentErrors: true
    });
    await mesh.init();

    // Test invalid peer ID for direct message
    const result = mesh.sendDirectMessage('invalid-id', 'test message');
    expect(result).toBe(null);

    // Test empty target
    const result2 = mesh.sendDirectMessage('', 'test message');
    expect(result2).toBe(null);

    const result3 = mesh.sendDirectMessage(null, 'test message');
    expect(result3).toBe(null);
  });
});
