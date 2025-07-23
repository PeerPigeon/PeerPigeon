/**
 * Unit Tests for CryptoManager
 * Tests encryption, decryption, key generation, and signing functionality
 */

import * as jestGlobals from '@jest/globals';
import { CryptoManager } from '../../src/CryptoManager.js';
const { jest } = jestGlobals;

describe('CryptoManager Unit Tests', () => {
  let crypto;

  beforeEach(() => {
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (crypto) {
      crypto.reset?.();
      crypto = null;
    }
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('CryptoManager initialization', async () => {
    crypto = new CryptoManager();
    await crypto.init({ generateKeypair: true });

    expect(crypto.initialized).toBe(true);
    expect(crypto.encryptionEnabled).toBe(true);
    expect(crypto.keypair).toBeTruthy();
    expect(crypto.keypair.pub).toBeTruthy();
    expect(crypto.keypair.epub).toBeTruthy();
  });

  test('Key pair generation', async () => {
    crypto = new CryptoManager();
    await crypto.init({ generateKeypair: true });

    const publicKey = crypto.getPublicKey();
    expect(typeof publicKey).toBe('string');
    expect(publicKey.length).toBeGreaterThan(0);
  });

  test('Self-test functionality', async () => {
    crypto = new CryptoManager();
    await crypto.init({ generateKeypair: true });

    const results = await crypto.runSelfTest();
    expect(results.keypairGeneration).toBe(true);
    expect(results.encryption).toBe(true);
    expect(results.decryption).toBe(true);
    expect(results.signing).toBe(true);
    expect(results.verification).toBe(true);
  });

  test('Peer key management', async () => {
    const crypto1 = new CryptoManager();
    const crypto2 = new CryptoManager();

    await crypto1.init({ generateKeypair: true });
    await crypto2.init({ generateKeypair: true });

    // Add crypto2's key to crypto1
    const success = crypto1.addPeerKey('peer2', {
      pub: crypto2.keypair.pub,
      epub: crypto2.keypair.epub
    });

    expect(success).toBe(true);
    expect(crypto1.peerKeys.has('peer2')).toBe(true);

    const storedKey = crypto1.peerKeys.get('peer2');
    expect(storedKey.pub).toBe(crypto2.keypair.pub);
    expect(storedKey.epub).toBe(crypto2.keypair.epub);

    // Cleanup
    crypto1.reset?.();
    crypto2.reset?.();
  });

  test('Message encryption/decryption', async () => {
    const crypto1 = new CryptoManager();
    const crypto2 = new CryptoManager();

    await crypto1.init({ generateKeypair: true });
    await crypto2.init({ generateKeypair: true });

    // Add each other's keys
    crypto1.addPeerKey('peer2', {
      pub: crypto2.keypair.pub,
      epub: crypto2.keypair.epub
    });
    crypto2.addPeerKey('peer1', {
      pub: crypto1.keypair.pub,
      epub: crypto1.keypair.epub
    });

    const testMessage = 'Hello, encrypted world!';

    // Encrypt with crypto1
    const encrypted = await crypto1.encryptForPeer(testMessage, 'peer2');
    expect(encrypted.encrypted).toBe(true);
    expect(encrypted.data).toBeTruthy();

    // Decrypt with crypto2
    const decrypted = await crypto2.decryptFromPeer(encrypted);
    expect(decrypted).toBe(testMessage);

    // Cleanup
    crypto1.reset?.();
    crypto2.reset?.();
  });

  test('Export/import functionality', async () => {
    crypto = new CryptoManager();
    await crypto.init({ generateKeypair: true });

    const exported = crypto.exportPublicKey();
    expect(exported).toBeTruthy();
    expect(exported.pub).toBeTruthy();
    expect(exported.epub).toBeTruthy();
    expect(exported.algorithm).toBeTruthy();
    expect(exported.created).toBeTruthy();
  });

  test('Reset functionality', async () => {
    crypto = new CryptoManager();
    await crypto.init({ generateKeypair: true });

    crypto.addPeerKey('test', { pub: 'test-key', epub: 'test-epub' });
    expect(crypto.peerKeys.size).toBe(1);

    crypto.reset();
    expect(crypto.initialized).toBe(false);
    expect(crypto.encryptionEnabled).toBe(false);
    expect(crypto.peerKeys.size).toBe(0);
  });
});
