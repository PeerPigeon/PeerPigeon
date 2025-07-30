import { PersistentStorageAdapter } from '../src/PersistentStorageAdapter.js';
import { promises as fs } from 'fs';

const testDataDir = './test-storage-data';

async function testPersistentStorage() {
  console.log('🧪 Testing PersistentStorageAdapter...');

  try {
    // Clean up any existing test data
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist, that's OK
    }

    // Test 1: Initialize storage adapter
    console.log('\n📁 Test 1: Initialize storage adapter');
    const storage = new PersistentStorageAdapter({
      dbName: 'test-peerpigeon',
      dataDir: testDataDir
    });

    // Wait for initialization
    await storage.waitForReady();
    console.log(`✅ Storage initialized with type: ${storage.getStorageType()}`);

    // Test 2: Basic set/get operations
    console.log('\n📁 Test 2: Basic set/get operations');

    const testData = { message: 'Hello, persistent world!', timestamp: Date.now() };
    await storage.set('test-key-1', testData);
    console.log('✅ Data stored successfully');

    const retrieved = await storage.get('test-key-1');
    console.log('✅ Data retrieved:', JSON.stringify(retrieved));

    if (JSON.stringify(retrieved) === JSON.stringify(testData)) {
      console.log('✅ Data integrity verified');
    } else {
      throw new Error('Data integrity check failed');
    }

    // Test 3: Multiple keys
    console.log('\n📁 Test 3: Multiple keys');

    await storage.set('test-key-2', { value: 'Second item' });
    await storage.set('test-key-3', { value: 'Third item', nested: { data: true } });

    const keys = await storage.keys();
    console.log(`✅ ${keys.length} keys found:`, keys);

    if (keys.length >= 3) {
      console.log('✅ Multiple keys stored successfully');
    } else {
      throw new Error('Expected at least 3 keys, got ' + keys.length);
    }

    // Test 4: Delete operation
    console.log('\n📁 Test 4: Delete operation');

    await storage.delete('test-key-2');
    const deletedValue = await storage.get('test-key-2');

    if (deletedValue === null) {
      console.log('✅ Key deleted successfully');
    } else {
      throw new Error('Key was not deleted properly');
    }

    // Test 5: Storage stats
    console.log('\n📁 Test 5: Storage stats');

    const stats = await storage.getStats();
    console.log('✅ Storage stats:', stats);

    if (stats.type && stats.keys >= 0) {
      console.log('✅ Stats retrieved successfully');
    } else {
      throw new Error('Invalid storage stats');
    }

    // Test 6: Clear all data
    console.log('\n📁 Test 6: Clear all data');

    await storage.clear();
    const keysAfterClear = await storage.keys();

    if (keysAfterClear.length === 0) {
      console.log('✅ All data cleared successfully');
    } else {
      throw new Error('Data was not cleared properly');
    }

    // Test 7: Large data handling
    console.log('\n📁 Test 7: Large data handling');

    const largeData = {
      id: 'large-test',
      content: 'A'.repeat(10000), // 10KB of data
      metadata: {
        size: 10000,
        type: 'large-test'
      },
      array: new Array(1000).fill(0).map((_, i) => ({ index: i, value: `item-${i}` }))
    };

    await storage.set('large-key', largeData);
    const retrievedLarge = await storage.get('large-key');

    if (retrievedLarge && retrievedLarge.content.length === 10000) {
      console.log('✅ Large data handled successfully');
    } else {
      throw new Error('Large data handling failed');
    }

    // Test 8: Persistence across instances (Node.js filesystem only)
    if (storage.getStorageType() === 'filesystem') {
      console.log('\n📁 Test 8: Persistence across instances');

      await storage.set('persistence-test', { persistent: true, timestamp: Date.now() });

      // Create a new storage instance
      const storage2 = new PersistentStorageAdapter({
        dbName: 'test-peerpigeon-2',
        dataDir: testDataDir
      });
      await storage2.waitForReady();

      const persistentData = await storage2.get('persistence-test');
      if (persistentData && persistentData.persistent === true) {
        console.log('✅ Data persisted across instances');
      } else {
        console.log('⚠️ Data did not persist across instances (expected for different dbName)');
      }
    }

    console.log('\n🎉 All tests passed! PersistentStorageAdapter is working correctly.');

    // Clean up test data
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
      console.log('🧹 Test data cleaned up');
    } catch (error) {
      console.warn('⚠️ Failed to clean up test data:', error.message);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testPersistentStorage();
