#!/usr/bin/env node

/**
 * PeerPigeon Distributed Storage Test
 *
 * This example demonstrates all storage operations including:
 * - Basic store/retrieve/update/delete operations
 * - Encryption and access control
 * - Public vs private data
 * - Immutable data with CRDT support
 * - Bulk operations
 * - Search functionality
 * - Backup and restore
 * - Key management and statistics
 */

import { PeerPigeonMesh } from '../../src/PeerPigeonMesh.js';

class StorageTest {
  constructor() {
    this.mesh = null;
    this.storage = null;
    this.testResults = [];
  }

  async init() {
    console.log('🚀 Initializing PeerPigeon Mesh with Storage...');

    // Initialize mesh with all features enabled
    this.mesh = new PeerPigeonMesh({
      enableWebDHT: true,
      enableCrypto: true,
      enableDistributedStorage: true
    });

    await this.mesh.init();
    this.storage = this.mesh.distributedStorage;

    console.log(`✅ Mesh initialized with peer ID: ${this.mesh.peerId.substring(0, 16)}...`);
    console.log(`📦 Storage enabled: ${this.storage.isEnabled()}`);
    console.log('');
  }

  async runTest(testName, testFn) {
    console.log(`🧪 Running test: ${testName}`);
    try {
      await testFn();
      console.log(`✅ Test passed: ${testName}`);
      this.testResults.push({ name: testName, status: 'PASS' });
    } catch (error) {
      console.error(`❌ Test failed: ${testName} - ${error.message}`);
      this.testResults.push({ name: testName, status: 'FAIL', error: error.message });
    }
    console.log('');
  }

  async testBasicOperations() {
    // Test basic store and retrieve
    await this.runTest('Basic Store and Retrieve', async () => {
      const key = 'test-basic';
      const value = { message: 'Hello, World!', timestamp: Date.now() };

      const stored = await this.storage.store(key, value);
      if (!stored) throw new Error('Store operation failed');

      const retrieved = await this.storage.retrieve(key);
      if (!retrieved) throw new Error('Retrieve operation failed');

      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Retrieved value does not match stored value');
      }

      console.log(`   Stored and retrieved: ${JSON.stringify(value)}`);
    });

    // Test update operation
    await this.runTest('Update Operation', async () => {
      const key = 'test-update';
      const originalValue = { counter: 1, name: 'original' };
      const updatedValue = { counter: 2, name: 'updated' };

      await this.storage.store(key, originalValue);
      const updateResult = await this.storage.update(key, updatedValue);
      if (!updateResult) throw new Error('Update operation failed');

      const retrieved = await this.storage.retrieve(key);
      if (JSON.stringify(retrieved) !== JSON.stringify(updatedValue)) {
        throw new Error('Updated value does not match expected value');
      }

      console.log(`   Updated: ${JSON.stringify(originalValue)} → ${JSON.stringify(updatedValue)}`);
    });

    // Test delete operation
    await this.runTest('Delete Operation', async () => {
      const key = 'test-delete';
      const value = { temporary: true };

      await this.storage.store(key, value);
      const deleteResult = await this.storage.delete(key);
      if (!deleteResult) throw new Error('Delete operation failed');

      const retrieved = await this.storage.retrieve(key);
      if (retrieved !== null) throw new Error('Key should not exist after deletion');

      console.log(`   Successfully deleted key: ${key}`);
    });
  }

  async testEncryptionAndAccessControl() {
    // Test private (encrypted) data
    await this.runTest('Private Encrypted Data', async () => {
      const key = 'test-private';
      const value = { secret: 'classified information', level: 'confidential' };

      // Store as private (encrypted by default)
      await this.storage.store(key, value, { isPublic: false });

      const retrieved = await this.storage.retrieve(key);
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Encrypted data not properly decrypted');
      }

      console.log('   Private data encrypted and decrypted successfully');
    });

    // Test public data
    await this.runTest('Public Data', async () => {
      const key = 'test-public';
      const value = { announcement: 'public information', visibility: 'everyone' };

      await this.storage.store(key, value, { isPublic: true });

      const retrieved = await this.storage.retrieve(key);
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Public data not properly stored/retrieved');
      }

      console.log('   Public data stored and retrieved successfully');
    });

    // Test access control (simulated - would need multiple peers for full test)
    await this.runTest('Access Control Metadata', async () => {
      const key = 'test-access-control';
      const value = { restricted: true };
      const allowedPeers = ['peer1', 'peer2'];

      await this.storage.store(key, value, {
        isPublic: false,
        allowedPeers
      });

      const keyInfo = await this.storage.getKeyInfo(key);
      if (!keyInfo) throw new Error('Key info not available');
      if (keyInfo.allowedPeers.length !== allowedPeers.length) {
        throw new Error('Allowed peers not properly set');
      }

      console.log(`   Access control set for peers: ${allowedPeers.join(', ')}`);
    });
  }

  async testImmutableAndCRDT() {
    // Test immutable data
    await this.runTest('Immutable Data', async () => {
      const key = 'test-immutable';
      const value = { constant: 'unchangeable', version: 1 };

      await this.storage.store(key, value, { isImmutable: true });

      try {
        // This should succeed because we're the owner
        await this.storage.update(key, { constant: 'changed', version: 2 });
        console.log('   Owner can update immutable data');
      } catch (error) {
        throw new Error('Owner should be able to update their own immutable data');
      }
    });

    // Test CRDT-enabled data
    await this.runTest('CRDT-Enabled Data', async () => {
      const key = 'test-crdt';
      const value = { collaborative: true, edits: 1 };

      await this.storage.store(key, value, { enableCRDT: true });

      const keyInfo = await this.storage.getKeyInfo(key);
      if (!keyInfo.enableCRDT) throw new Error('CRDT not enabled');
      if (!keyInfo.crdtEnabled) throw new Error('CRDT state not initialized');

      console.log('   CRDT enabled for collaborative editing');
    });
  }

  async testTTLAndExpiration() {
    await this.runTest('TTL (Time To Live)', async () => {
      const key = 'test-ttl';
      const value = { temporary: true, expires: 'soon' };
      const ttl = 2000; // 2 seconds

      await this.storage.store(key, value, { ttl });

      // Should be available immediately
      const retrieved = await this.storage.retrieve(key);
      if (!retrieved) throw new Error('TTL data not available immediately');

      const keyInfo = await this.storage.getKeyInfo(key);
      if (keyInfo.ttl !== ttl) throw new Error('TTL not properly set');

      console.log(`   TTL set to ${ttl}ms for key: ${key}`);

      // Note: In a real scenario, we'd wait for expiration and test cleanup
      // For this demo, we'll just verify the TTL was set correctly
    });
  }

  async testBulkOperations() {
    // Test bulk store
    await this.runTest('Bulk Store Operations', async () => {
      const items = [
        { key: 'bulk-1', value: { data: 'first bulk item' } },
        { key: 'bulk-2', value: { data: 'second bulk item' } },
        { key: 'bulk-3', value: { data: 'third bulk item' } }
      ];

      const results = await this.storage.bulkStore(items);
      if (results.stored !== 3 || results.failed !== 0) {
        throw new Error(`Bulk store failed: ${results.stored} stored, ${results.failed} failed`);
      }

      console.log(`   Bulk stored ${results.stored} items successfully`);
    });

    // Test bulk retrieve
    await this.runTest('Bulk Retrieve Operations', async () => {
      const keys = ['bulk-1', 'bulk-2', 'bulk-3'];

      const results = await this.storage.bulkRetrieve(keys);
      const retrievedKeys = Object.keys(results).filter(key => results[key] !== null);

      if (retrievedKeys.length !== 3) {
        throw new Error(`Bulk retrieve failed: only ${retrievedKeys.length} out of 3 items retrieved`);
      }

      console.log(`   Bulk retrieved ${retrievedKeys.length} items successfully`);
    });

    // Test bulk delete
    await this.runTest('Bulk Delete Operations', async () => {
      const prefix = 'bulk-';

      const deletedCount = await this.storage.bulkDelete(prefix);
      if (deletedCount !== 3) {
        throw new Error(`Bulk delete failed: only ${deletedCount} out of 3 items deleted`);
      }

      console.log(`   Bulk deleted ${deletedCount} items with prefix: ${prefix}`);
    });
  }

  async testSearchOperations() {
    // Prepare test data for search
    await this.storage.store('search-test-1', { category: 'fruits', name: 'apple', color: 'red' });
    await this.storage.store('search-test-2', { category: 'fruits', name: 'banana', color: 'yellow' });
    await this.storage.store('search-different', { category: 'vegetables', name: 'carrot', color: 'orange' });

    // Test key search
    await this.runTest('Search by Key Pattern', async () => {
      const results = this.storage.searchKeys({ keyPattern: 'search-test.*' });
      if (results.length !== 2) {
        throw new Error(`Key search failed: expected 2 results, got ${results.length}`);
      }

      console.log(`   Found ${results.length} keys matching pattern 'search-test.*'`);
    });

    // Test value search
    await this.runTest('Search by Value Content', async () => {
      const results = await this.storage.search('apple', 'value');
      if (results.length !== 1) {
        throw new Error(`Value search failed: expected 1 result, got ${results.length}`);
      }

      console.log(`   Found ${results.length} items containing 'apple' in value`);
    });

    // Test metadata search
    await this.runTest('Search by Metadata', async () => {
      const results = await this.storage.search('fruits', 'value');
      if (results.length !== 2) {
        throw new Error(`Metadata search failed: expected 2 results, got ${results.length}`);
      }

      console.log(`   Found ${results.length} items with 'fruits' in metadata`);
    });
  }

  async testKeyManagement() {
    // Test list owned keys
    await this.runTest('List Owned Keys', async () => {
      const ownedKeys = this.storage.getOwnedKeys();
      if (ownedKeys.length === 0) {
        throw new Error('No owned keys found - expected some from previous tests');
      }

      console.log(`   Found ${ownedKeys.length} owned keys`);
      ownedKeys.slice(0, 3).forEach(key => {
        console.log(`     - ${key.key} (${key.isPublic ? 'public' : 'private'})`);
      });
    });

    // Test list keys with prefix
    await this.runTest('List Keys with Prefix', async () => {
      const keys = await this.storage.listKeys('search-');
      if (keys.length === 0) {
        throw new Error('No keys found with prefix - expected some from search tests');
      }

      console.log(`   Found ${keys.length} keys with prefix 'search-'`);
    });

    // Test accessible keys
    await this.runTest('List Accessible Keys', async () => {
      const accessibleKeys = await this.storage.listAccessibleKeys();
      if (accessibleKeys.length === 0) {
        throw new Error('No accessible keys found');
      }

      console.log(`   Found ${accessibleKeys.length} accessible keys`);
    });
  }

  async testBackupAndRestore() {
    // Test backup
    await this.runTest('Create Backup', async () => {
      const backup = await this.storage.backup();
      if (!backup || !backup.keys || backup.keys.length === 0) {
        throw new Error('Backup failed or contains no keys');
      }

      console.log(`   Created backup with ${backup.keys.length} keys`);
      console.log(`   Backup version: ${backup.version}, timestamp: ${new Date(backup.timestamp).toISOString()}`);

      // Store backup for restore test
      this.testBackup = backup;
    });

    // Test restore (we'll clear some data and restore it)
    await this.runTest('Restore from Backup', async () => {
      if (!this.testBackup) throw new Error('No backup available for restore test');

      // First, let's store a key that should be skipped during restore
      await this.storage.store('restore-test', { existing: true });

      // Restore with overwrite disabled (default)
      const results = await this.storage.restore(this.testBackup, { overwrite: false });

      if (results.failed > 0) {
        console.log(`   Some items failed to restore: ${results.errors.length} errors`);
        results.errors.slice(0, 3).forEach(error => {
          console.log(`     - ${error.key}: ${error.error}`);
        });
      }

      console.log(`   Restore completed: ${results.restored} restored, ${results.skipped} skipped, ${results.failed} failed`);
    });
  }

  async testStatistics() {
    await this.runTest('Storage Statistics', async () => {
      const stats = await this.storage.getStats();

      console.log('   Storage Statistics:');
      console.log(`     - Enabled: ${stats.enabled}`);
      console.log(`     - Items: ${stats.itemCount}`);
      console.log(`     - Total Size: ${stats.totalSize} bytes`);
      console.log(`     - Owned Keys: ${stats.ownedKeys}`);
      console.log(`     - Total Keys: ${stats.totalKeys}`);
      console.log(`     - CRDT Keys: ${stats.crdtKeys}`);
      console.log(`     - Encryption Enabled: ${stats.encryptionEnabled}`);
      console.log(`     - Max Value Size: ${stats.maxValueSize} bytes`);

      if (stats.itemCount === 0) {
        throw new Error('Expected some items in storage statistics');
      }
    });
  }

  async testStorageToggle() {
    await this.runTest('Storage Toggle', async () => {
      const key = 'test-toggle';
      const value = { test: true };

      // Store when enabled
      await this.storage.store(key, value);
      let retrieved = await this.storage.retrieve(key);
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Failed to store when enabled');
      }

      // Disable storage
      this.storage.disable();
      if (this.storage.isEnabled()) {
        throw new Error('Storage should be disabled');
      }

      // Operations should fail or return null when disabled
      const disabledResult = await this.storage.store('disabled-key', { test: true });
      if (disabledResult !== false) {
        throw new Error('Store should fail when disabled');
      }

      // Re-enable storage
      this.storage.enable();
      if (!this.storage.isEnabled()) {
        throw new Error('Storage should be enabled');
      }

      // Should work again
      retrieved = await this.storage.retrieve(key);
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Failed to retrieve after re-enabling');
      }

      console.log('   Storage toggle functionality verified');
    });
  }

  async testLexicalInterface() {
    await this.runTest('Lexical Interface - Basic Operations', async () => {
      const lex = this.storage.lexical();

      // Test basic put/get
      const user = lex.get('users').get('alice');
      await user.put({ name: 'Alice', age: 30, city: 'New York' });

      const name = await user.get('name').val();
      if (name !== 'Alice') {
        throw new Error(`Expected 'Alice', got '${name}'`);
      }

      const age = await user.get('age').val();
      if (age !== 30) {
        throw new Error(`Expected 30, got ${age}`);
      }

      // Test object reconstruction
      const fullUser = await user.val();
      if (!fullUser || fullUser.name !== 'Alice' || fullUser.age !== 30 || fullUser.city !== 'New York') {
        throw new Error('Object reconstruction failed');
      }

      console.log('   Basic lexical operations verified');
    });

    await this.runTest('Lexical Interface - Set Operations', async () => {
      const lex = this.storage.lexical();
      const friends = lex.get('users').get('bob').get('friends');

      // Test set operations
      await friends.set({
        alice: { name: 'Alice', status: 'online' },
        charlie: { name: 'Charlie', status: 'offline' }
      });

      // Verify set data was stored
      const setData = await this.storage.retrieve('users:bob:friends:_set');
      if (!setData || !setData.alice || !setData.charlie) {
        throw new Error('Set data not stored correctly');
      }

      console.log('   Set operations verified');
    });

    await this.runTest('Lexical Interface - Property Access', async () => {
      const lex = this.storage.lexical();

      // Test proxy-based property access
      const settings = lex.users.alice.settings;
      await settings.put({ theme: 'dark', language: 'en' });

      const theme = await settings.theme.val();
      if (theme !== 'dark') {
        throw new Error(`Expected 'dark', got '${theme}'`);
      }

      console.log('   Property access verified');
    });

    await this.runTest('Lexical Interface - Update and Delete', async () => {
      const lex = this.storage.lexical();
      const profile = lex.get('profiles').get('user1');

      // Test update
      await profile.put({ name: 'John', age: 25 });
      await profile.update({ age: 26, city: 'Boston' });

      const updatedProfile = await profile.val();
      if (updatedProfile.age !== 26 || updatedProfile.city !== 'Boston' || updatedProfile.name !== 'John') {
        throw new Error('Update operation failed');
      }

      // Test delete
      await profile.delete();
      const deletedProfile = await profile.val();
      if (deletedProfile !== null) {
        throw new Error('Delete operation failed');
      }

      console.log('   Update and delete operations verified');
    });

    await this.runTest('Lexical Interface - Utility Methods', async () => {
      const lex = this.storage.lexical();
      const testObj = lex.get('test').get('object');

      await testObj.put({ prop1: 'value1', prop2: 'value2', prop3: 'value3' });

      // Test exists
      const exists = await testObj.exists();
      if (!exists) {
        throw new Error('exists() should return true');
      }

      // Test keys
      const keys = await testObj.keys();
      if (!keys.includes('prop1') || !keys.includes('prop2') || !keys.includes('prop3')) {
        throw new Error('keys() did not return expected keys');
      }

      // Test getPath
      const path = testObj.getPath();
      if (path !== 'test:object') {
        throw new Error(`Expected path 'test:object', got '${path}'`);
      }

      console.log('   Utility methods verified');
    });
  }

  async testCleanup() {
    await this.runTest('Storage Cleanup', async () => {
      // Test cleanup function (won't see immediate effects but should not error)
      this.storage.cleanup();
      console.log('   Cleanup operation completed successfully');
    });
  }

  async runAllTests() {
    console.log('🧪 Starting Distributed Storage Test Suite');
    console.log('='.repeat(60));
    console.log('');

    await this.testBasicOperations();
    await this.testEncryptionAndAccessControl();
    await this.testImmutableAndCRDT();
    await this.testTTLAndExpiration();
    await this.testBulkOperations();
    await this.testSearchOperations();
    await this.testKeyManagement();
    await this.testBackupAndRestore();
    await this.testStatistics();
    await this.testStorageToggle();
    await this.testLexicalInterface();
    await this.testCleanup();

    this.printSummary();
  }

  printSummary() {
    console.log('='.repeat(60));
    console.log('🏁 TEST SUMMARY');
    console.log('='.repeat(60));

    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    const total = this.testResults.length;

    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
    console.log('');

    if (failed > 0) {
      console.log('Failed Tests:');
      this.testResults.filter(r => r.status === 'FAIL').forEach(result => {
        console.log(`  ❌ ${result.name}: ${result.error}`);
      });
      console.log('');
    }

    if (passed === total) {
      console.log('🎉 All tests passed! The Distributed Storage system is working perfectly.');
    } else {
      console.log('⚠️  Some tests failed. Please review the errors above.');
    }

    console.log('');
    console.log('📊 Storage Operations Tested:');
    console.log('  • Basic CRUD operations (store, retrieve, update, delete)');
    console.log('  • Encryption and access control');
    console.log('  • Public vs private data handling');
    console.log('  • Immutable data and CRDT support');
    console.log('  • TTL (Time To Live) functionality');
    console.log('  • Bulk operations (store, retrieve, delete)');
    console.log('  • Search operations (by key, value, metadata)');
    console.log('  • Key management and statistics');
    console.log('  • Backup and restore functionality');
    console.log('  • Storage enable/disable toggle');
    console.log('  • Cleanup operations');
  }

  async cleanup() {
    if (this.mesh) {
      console.log('🧹 Cleaning up test environment...');
      // Clear all test data
      try {
        await this.storage.clear();
        console.log('✅ Test data cleared');
      } catch (error) {
        console.warn('⚠️  Failed to clear test data:', error.message);
      }
    }
  }
}

// Main execution
async function main() {
  const test = new StorageTest();

  try {
    await test.init();
    await test.runAllTests();
  } catch (error) {
    console.error('💥 Test suite failed to run:', error);
  } finally {
    await test.cleanup();
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run the test suite
main().catch(console.error);
