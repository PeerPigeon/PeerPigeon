#!/usr/bin/env node
/**
 * Simple test to verify WebDHT pending subscriptions work correctly
 * This test creates two mesh instances and tests subscription before key creation
 */

import { PeerPigeonMesh } from '../src/PeerPigeonMesh.js';

async function testPendingSubscriptions() {
  console.log('🧪 Testing WebDHT Pending Subscriptions...\n');

  // Create two mesh instances
  const mesh1 = new PeerPigeonMesh({
    peerId: 'test-peer-1',
    enableWebDHT: true,
    signalingServerUrl: 'ws://localhost:3000',
    maxConnections: 10
  });

  const mesh2 = new PeerPigeonMesh({
    peerId: 'test-peer-2',
    enableWebDHT: true,
    signalingServerUrl: 'ws://localhost:3000',
    maxConnections: 10
  });

  let subscriptionTriggered = false;
  let receivedValue = null;
  let isNewKey = false;

  try {
    // Initialize both meshes
    await mesh1.init();
    await mesh2.init();

    // Set up subscription listener on mesh2
    mesh2.addEventListener('dhtValueChanged', (data) => {
      console.log('📡 DHT Value Changed:', data);
      subscriptionTriggered = true;
      receivedValue = data.newValue;
      isNewKey = data.isNewKey;
    });

    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('✅ Step 1: Subscribe to non-existent key on mesh2');
    const testKey = 'future-key-' + Date.now();

    // Subscribe to a key that doesn't exist yet
    const currentValue = await mesh2.dhtSubscribe(testKey);
    console.log(`   Current value: ${currentValue} (should be null)`);

    if (currentValue !== null) {
      throw new Error('Expected null for non-existent key');
    }

    console.log('✅ Step 2: Create the key on mesh1');
    const testValue = 'Hello from the future!';

    await new Promise(resolve => setTimeout(resolve, 500));

    // Create the key on mesh1
    const putResult = await mesh1.dhtPut(testKey, testValue);
    console.log(`   Put result: ${putResult}`);

    console.log('✅ Step 3: Wait for subscription notification...');

    // Wait for the subscription to be triggered
    // eslint-disable-next-line no-unmodified-loop-condition
    for (let attempts = 0; attempts < 10 && !subscriptionTriggered; attempts++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`   Waiting... (${attempts + 1}/10)`);
    }

    if (subscriptionTriggered) {
      console.log('🎉 SUCCESS: Pending subscription worked!');
      console.log(`   Received value: ${receivedValue}`);
      console.log(`   Is new key: ${isNewKey}`);

      if (receivedValue === testValue && isNewKey) {
        console.log('✅ All checks passed!');
        return true;
      } else {
        console.log('❌ Value or new key flag incorrect');
        return false;
      }
    } else {
      console.log('❌ FAILED: Subscription was not triggered');
      return false;
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  } finally {
    // Cleanup
    await mesh1.disconnect();
    await mesh2.disconnect();
    console.log('\n🧹 Cleanup completed');
  }
}

// Run the test
testPendingSubscriptions()
  .then(success => {
    console.log(success ? '\n🎉 TEST PASSED' : '\n❌ TEST FAILED');
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });
