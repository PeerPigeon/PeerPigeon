#!/usr/bin/env node
/**
 * Basic Distributed Storage Example for PeerPigeon
 *
 * This example demonstrates simple usage of the distributed storage layer.
 * For comprehensive testing, see storage-test.js
 */

import { PeerPigeonMesh } from '../../src/PeerPigeonMesh.js';

async function basicStorageExample() {
  console.log('🐦 PeerPigeon Basic Storage Example');
  console.log('=====================================\n');

  // Initialize the mesh network with storage enabled
  const mesh = new PeerPigeonMesh({
    enableStorage: true,
    enableWebDHT: true,
    enableCrypto: true,
    nodeId: 'basic-example-node'
  });

  try {
    // Wait a moment for initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('1. Storing some data...');
    await mesh.storageManager.store('user:123', { name: 'Alice', age: 30 });
    await mesh.storageManager.store('config:theme', 'dark');
    await mesh.storageManager.store('counter', 42);
    console.log('   ✅ Data stored successfully\n');

    console.log('2. Retrieving data...');
    const user = await mesh.storageManager.retrieve('user:123');
    const theme = await mesh.storageManager.retrieve('config:theme');
    const counter = await mesh.storageManager.retrieve('counter');

    console.log(`   User: ${JSON.stringify(user)}`);
    console.log(`   Theme: ${theme}`);
    console.log(`   Counter: ${counter}\n`);

    console.log('3. Updating data...');
    await mesh.storageManager.update('counter', 100);
    const updatedCounter = await mesh.storageManager.retrieve('counter');
    console.log(`   Updated counter: ${updatedCounter}\n`);

    console.log('4. Listing all keys...');
    const keys = await mesh.storageManager.listKeys();
    console.log(`   Found keys: ${keys.join(', ')}\n`);

    console.log('5. Getting storage statistics...');
    const stats = await mesh.storageManager.getStats();
    console.log(`   Total items: ${stats.itemCount}`);
    console.log(`   Storage size: ${stats.totalSize} bytes\n`);

    console.log('6. Cleaning up...');
    await mesh.storageManager.delete('user:123');
    await mesh.storageManager.delete('config:theme');
    await mesh.storageManager.delete('counter');
    console.log('   ✅ Cleanup complete\n');

    console.log('🎉 Basic storage example completed successfully!');
  } catch (error) {
    console.error('❌ Error in basic storage example:', error.message);
    console.error(error.stack);
  } finally {
    // Clean shutdown
    if (mesh.cleanup) {
      await mesh.cleanup();
    }
    process.exit(0);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the example
basicStorageExample().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
