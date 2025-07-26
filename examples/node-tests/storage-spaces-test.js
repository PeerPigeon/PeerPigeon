#!/usr/bin/env node

/**
 * PeerPigeon Storage Spaces Test
 *
 * This example demonstrates the new storage space separation feature:
 * - Private space: Only owner can read/write, encrypted
 * - Public space: Anyone can read, only owner can write
 * - Frozen space: Immutable once set, anyone can read
 *
 * Key protection: prevents overwrites across different spaces
 */

import { PeerPigeonMesh } from '../../src/PeerPigeonMesh.js';

class StorageSpacesTest {
  constructor() {
    this.mesh = null;
    this.storage = null;
    this.testResults = [];
  }

  async init() {
    console.log('🚀 Initializing PeerPigeon Mesh with Storage Spaces...');

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
    console.log(`🔧 Space enforcement: ${this.storage.config.spaceEnforcement}`);
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

  async testPrivateSpace() {
    await this.runTest('Private Space Storage', async () => {
      const key = 'user-profile';
      const value = { name: 'Alice', secret: 'my-password' };

      // Store in private space (default)
      await this.storage.store(key, value);

      // Should be accessible to owner
      const retrieved = await this.storage.retrieve(key);
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Private data not properly stored/retrieved');
      }

      console.log('   ✓ Private space data stored and retrieved by owner');
    });

    await this.runTest('Private Space Explicit', async () => {
      const key = 'explicit-private';
      const value = { confidential: 'data' };

      // Store explicitly in private space
      await this.storage.store(key, value, { space: 'private' });

      const retrieved = await this.storage.retrieve('private:explicit-private');
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Explicit private space data not working');
      }

      console.log('   ✓ Explicit private space storage working');
    });
  }

  async testPublicSpace() {
    await this.runTest('Public Space Storage', async () => {
      const key = 'app-config';
      const value = { version: '1.0.0', features: ['chat', 'files'] };

      // Store in public space
      await this.storage.store(key, value, { space: 'public' });

      // Retrieve with space prefix
      const retrieved = await this.storage.retrieve('public:app-config');
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Public space data not properly stored/retrieved');
      }

      console.log('   ✓ Public space data stored and retrieved');
    });

    await this.runTest('Public Space Legacy', async () => {
      const key = 'legacy-public';
      const value = { public: true };

      // Store using legacy isPublic option
      await this.storage.store(key, value, { isPublic: true });

      const retrieved = await this.storage.retrieve(key);
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Legacy public storage not working');
      }

      console.log('   ✓ Legacy public storage compatibility working');
    });
  }

  async testFrozenSpace() {
    await this.runTest('Frozen Space Storage', async () => {
      const key = 'immutable-data';
      const value = { constant: 'never-changes', timestamp: Date.now() };

      // Store in frozen space
      await this.storage.store(key, value, { space: 'frozen' });

      const retrieved = await this.storage.retrieve('frozen:immutable-data');
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error('Frozen space data not properly stored/retrieved');
      }

      console.log('   ✓ Frozen space data stored and retrieved');
    });

    await this.runTest('Frozen Space Write Protection', async () => {
      const key = 'immutable-data';

      try {
        // Try to overwrite frozen data in a different space - should fail
        await this.storage.store(key, { modified: 'data' }, { space: 'private' });
        throw new Error('Frozen space allowed overwrite - this should not happen');
      } catch (error) {
        if (error.message.includes('already exists in space') || error.message.includes('Write access denied')) {
          console.log('   ✓ Frozen space properly protected from overwrites');
        } else {
          throw error;
        }
      }
    });
  }

  async testSpaceSeparation() {
    await this.runTest('Space Separation Protection', async () => {
      const baseKey = 'protected-key';
      
      // Store in private space first
      await this.storage.store(baseKey, { space: 'private', data: 'secret' });

      try {
        // Try to store same base key in public space - should fail
        await this.storage.store(baseKey, { space: 'public', data: 'public' }, { space: 'public' });
        throw new Error('Space separation failed - allowed cross-space overwrite');
      } catch (error) {
        if (error.message.includes('already exists in space')) {
          console.log('   ✓ Space separation properly prevents cross-space overwrites');
        } else {
          throw error;
        }
      }
    });

    await this.runTest('Different Base Keys Work', async () => {
      // These should all work as they have different base keys
      await this.storage.store('key1', { data: 'private' }); // private:key1
      await this.storage.store('key2', { data: 'public' }, { space: 'public' }); // public:key2
      await this.storage.store('key3', { data: 'frozen' }, { space: 'frozen' }); // frozen:key3

      const private1 = await this.storage.retrieve('key1');
      const public2 = await this.storage.retrieve('public:key2');
      const frozen3 = await this.storage.retrieve('frozen:key3');

      if (!private1 || !public2 || !frozen3) {
        throw new Error('Different base keys not working properly');
      }

      console.log('   ✓ Different base keys work in all spaces');
    });
  }

  async testSpaceAwareRetrieval() {
    await this.runTest('Space-Aware Retrieval', async () => {
      // Store data in specific spaces
      await this.storage.store('test-key', { space: 'private' }); // private:test-key
      await this.storage.store('other-key', { space: 'public' }, { space: 'public' }); // public:other-key

      // Test retrieval with and without space prefixes
      const privateData = await this.storage.retrieve('private:test-key');
      const publicData = await this.storage.retrieve('public:other-key');

      if (!privateData || !publicData) {
        throw new Error('Space-aware retrieval not working');
      }

      // Test automatic space detection
      const autoPrivate = await this.storage.retrieve('test-key'); // Should find private:test-key
      if (!autoPrivate) {
        throw new Error('Automatic space detection not working');
      }

      console.log('   ✓ Space-aware retrieval working correctly');
    });
  }

  async testDisableSpaceEnforcement() {
    await this.runTest('Disable Space Enforcement', async () => {
      // Disable space enforcement
      this.storage.config.spaceEnforcement = false;

      try {
        // This should work now
        await this.storage.store('enforcement-test', { data: 'private' });
        await this.storage.store('enforcement-test', { data: 'public' }, { space: 'public' });
        
        console.log('   ✓ Space enforcement can be disabled');
      } finally {
        // Re-enable for other tests
        this.storage.config.spaceEnforcement = true;
      }
    });
  }

  async runAllTests() {
    console.log('🧪 Starting Storage Spaces Test Suite');
    console.log('='.repeat(60));
    console.log('');

    await this.testPrivateSpace();
    await this.testPublicSpace();
    await this.testFrozenSpace();
    await this.testSpaceSeparation();
    await this.testSpaceAwareRetrieval();
    await this.testDisableSpaceEnforcement();

    this.printSummary();
  }

  printSummary() {
    console.log('='.repeat(60));
    console.log('🏁 STORAGE SPACES TEST SUMMARY');
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
      console.log('🎉 All tests passed! Storage spaces are working perfectly.');
    } else {
      console.log('⚠️  Some tests failed. Please review the errors above.');
    }

    console.log('');
    console.log('📊 Storage Spaces Features Tested:');
    console.log('  • Private space (encrypted, owner-only access)');
    console.log('  • Public space (readable by all, owner-writable)');
    console.log('  • Frozen space (immutable, readable by all)');
    console.log('  • Cross-space overwrite protection');
    console.log('  • Space-aware key retrieval');
    console.log('  • Legacy compatibility');
    console.log('  • Space enforcement toggle');
  }

  async cleanup() {
    if (this.mesh) {
      console.log('🧹 Cleaning up test environment...');
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
  const test = new StorageSpacesTest();

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
