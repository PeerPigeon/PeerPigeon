import { PeerPigeonMesh } from '../src/PeerPigeonMesh.js';

async function testDistributedPersistentStorage() {
  console.log('🧪 Testing Distributed Storage with Persistence...');

  try {
    // Create a mesh instance
    const mesh = new PeerPigeonMesh({
      enableWebDHT: true,
      enableCrypto: true,
      enableDistributedStorage: true
    });

    await mesh.init();

    // Check if distributed storage is available
    if (!mesh.distributedStorage) {
      throw new Error('Distributed storage not available');
    }

    console.log('\n💾 Test 1: Verify persistent storage type');
    const storageType = mesh.distributedStorage.getPersistentStorageType();
    console.log(`✅ Storage type: ${storageType}`);

    console.log('\n💾 Test 2: Store data with persistence');
    await mesh.distributedStorage.store('persistent-test-key', {
      message: 'This should persist!',
      timestamp: Date.now()
    });
    console.log('✅ Data stored successfully');

    console.log('\n💾 Test 3: Retrieve data');
    const retrieved = await mesh.distributedStorage.retrieve('persistent-test-key');
    console.log('✅ Data retrieved:', JSON.stringify(retrieved));

    console.log('\n💾 Test 4: Check storage stats');
    const stats = await mesh.distributedStorage.getStorageStats();
    console.log('✅ Storage stats:', stats);

    console.log('\n💾 Test 5: List persistent keys');
    const persistentKeys = await mesh.distributedStorage.getPersistentKeys();
    console.log(`✅ Found ${persistentKeys.length} persistent keys:`, persistentKeys);

    console.log('\n💾 Test 6: Clear persistent storage');
    const cleared = await mesh.distributedStorage.clearPersistentStorage();
    console.log(`✅ Persistent storage cleared: ${cleared}`);

    console.log('\n🎉 All distributed persistent storage tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testDistributedPersistentStorage();
