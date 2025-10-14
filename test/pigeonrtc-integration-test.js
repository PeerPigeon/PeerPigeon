/**
 * Test to verify PigeonRTC integration with PeerPigeon
 */

import { environmentDetector, PeerPigeonMesh } from '../index.js';

console.log('🧪 Testing PigeonRTC Integration...\n');

async function testPigeonRTC() {
  try {
    // Test 1: Initialize WebRTC via PigeonRTC
    console.log('Test 1: Initializing PigeonRTC...');
    const initialized = await environmentDetector.initWebRTCAsync();
    
    if (initialized) {
      console.log('✅ PigeonRTC initialized successfully');
    } else {
      console.log('❌ PigeonRTC initialization failed');
      process.exit(1);
    }

    // Test 2: Check if PigeonRTC instance is available
    console.log('\nTest 2: Checking PigeonRTC instance...');
    const pigeonRTC = environmentDetector.getPigeonRTC();
    
    if (pigeonRTC) {
      console.log('✅ PigeonRTC instance available');
      console.log(`   Adapter: ${pigeonRTC.getAdapterName()}`);
      console.log(`   Supported: ${pigeonRTC.isSupported()}`);
    } else {
      console.log('❌ PigeonRTC instance not available');
      process.exit(1);
    }

    // Test 3: Verify hasWebRTC detection
    console.log('\nTest 3: Checking WebRTC capability detection...');
    const hasWebRTC = environmentDetector.hasWebRTC;
    
    if (hasWebRTC) {
      console.log('✅ WebRTC capability detected');
    } else {
      console.log('❌ WebRTC capability not detected');
      process.exit(1);
    }

    // Test 4: Create a PeerConnection using PigeonRTC
    console.log('\nTest 4: Creating RTCPeerConnection via PigeonRTC...');
    try {
      const peerConnection = pigeonRTC.createPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      
      if (peerConnection) {
        console.log('✅ RTCPeerConnection created successfully');
        console.log(`   Connection State: ${peerConnection.connectionState}`);
        console.log(`   Signaling State: ${peerConnection.signalingState}`);
        peerConnection.close();
      } else {
        console.log('❌ Failed to create RTCPeerConnection');
        process.exit(1);
      }
    } catch (error) {
      console.log('❌ Failed to create RTCPeerConnection:', error.message);
      process.exit(1);
    }

    // Test 5: Initialize PeerPigeonMesh (which should use PigeonRTC internally)
    console.log('\nTest 5: Initializing PeerPigeonMesh with PigeonRTC...');
    const mesh = new PeerPigeonMesh({
      maxPeers: 4,
      autoConnect: false // Don't actually connect
    });
    
    await mesh.init();
    
    if (mesh.peerId) {
      console.log('✅ PeerPigeonMesh initialized successfully');
      console.log(`   Peer ID: ${mesh.peerId.substring(0, 16)}...`);
    } else {
      console.log('❌ Failed to initialize PeerPigeonMesh');
      process.exit(1);
    }

    // Test 6: Environment report
    console.log('\nTest 6: Environment Report...');
    const report = environmentDetector.getEnvironmentReport();
    console.log('✅ Environment Report:');
    console.log(`   Runtime: ${JSON.stringify(report.runtime, null, 2)}`);
    console.log(`   WebRTC: ${report.capabilities.webrtc}`);
    console.log(`   Platform: ${report.node?.platform || 'browser'}`);

    console.log('\n🎉 All tests passed! PigeonRTC is working correctly.\n');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testPigeonRTC();
