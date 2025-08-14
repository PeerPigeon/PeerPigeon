#!/usr/bin/env node

/**
 * Example demonstrating the new standard EventEmitter methods
 * Shows both traditional and Node.js-style event handling
 */

import { PeerPigeonMesh } from '../index.js';

console.log('🐦 PeerPigeon Standard Event Methods Demo\n');

// Create mesh instance
const mesh = new PeerPigeonMesh({
  peerId: `demo-${Date.now()}`,
  maxPeers: 3,
  enableWebDHT: true,
  enableCrypto: true
});

// Traditional style event handling
console.log('📝 Setting up traditional event listeners...');
mesh.addEventListener('connected', () => {
  console.log('🔗 [Traditional] Connected to signaling server');
});

// Standard Node.js style with method chaining
console.log('⛓️  Setting up standard event listeners with chaining...');
mesh
  .on('statusChanged', (data) => {
    console.log(`📊 [Standard] Status: ${data.type}${data.message ? ' - ' + data.message : ''}`);
  })
  .on('peerConnected', (data) => {
    console.log(`👋 [Standard] Peer connected: ${data.peerId.substring(0, 8)}...`);
    console.log(`📈 Total connected peers: ${mesh.getConnectedPeers().length}`);
  })
  .on('peerDisconnected', (data) => {
    console.log(`💔 [Standard] Peer disconnected: ${data.peerId.substring(0, 8)}... (${data.reason})`);
  })
  .on('messageReceived', (data) => {
    console.log(`💬 [Standard] Message from ${data.from.substring(0, 8)}...: "${data.content}"`);
  });

// One-time listeners
console.log('🎯 Setting up one-time listeners...');
mesh.once('initialized', () => {
  console.log('🎉 [Once] Mesh initialized - this will only be logged once!');
});

// Demonstrate listener management
console.log('🧮 Demonstrating listener management...');

const temporaryHandler = (data) => {
  console.log(`⏰ [Temporary] Status update: ${data.type}`);
};

// Add and immediately remove a temporary listener
mesh.on('statusChanged', temporaryHandler);
console.log(`📊 Status listeners before removal: ${mesh.listenerCount('statusChanged')}`);

mesh.off('statusChanged', temporaryHandler);
console.log(`📊 Status listeners after removal: ${mesh.listenerCount('statusChanged')}`);

// Show all active event names
console.log(`🏷️  Active event types: ${mesh.eventNames().join(', ')}\n`);

// Initialize mesh
console.log('🚀 Initializing mesh...');
try {
  await mesh.init();
  console.log('✅ Mesh initialization complete');
  
  // Try to connect to a signaling server
  console.log('🔌 Attempting to connect to signaling server...');
  try {
    await mesh.connect('ws://localhost:3000');
    console.log('✅ Connected to signaling server');
    
    // Send a test message after a short delay
    setTimeout(() => {
      console.log('📤 Sending test broadcast message...');
      mesh.sendMessage('Hello from the standard events demo!');
    }, 2000);
    
    // Demonstrate cleanup after 10 seconds
    setTimeout(() => {
      console.log('\n🧹 Demonstrating cleanup...');
      console.log(`📊 Events with listeners before cleanup: ${mesh.eventNames()}`);
      
      // Remove all listeners for messageReceived
      mesh.removeAllListeners('messageReceived');
      console.log('🗑️  Removed all messageReceived listeners');
      
      console.log(`📊 Events with listeners after cleanup: ${mesh.eventNames()}`);
      console.log('👋 Demo complete - disconnecting...');
      
      mesh.disconnect();
      process.exit(0);
    }, 10000);
    
  } catch (connectError) {
    console.log('⚠️  Could not connect to signaling server (this is expected if no server is running)');
    console.log('💡 To test with a real connection, start a server with: node cli.js server');
    
    // Still demonstrate the events work
    setTimeout(() => {
      console.log('\n🧹 Demonstrating cleanup without connection...');
      console.log(`📊 Active events: ${mesh.eventNames()}`);
      mesh.removeAllListeners();
      console.log('🗑️  Removed all listeners');
      console.log('👋 Demo complete');
      process.exit(0);
    }, 3000);
  }
  
} catch (error) {
  console.error('❌ Error during mesh initialization:', error.message);
  process.exit(1);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received interrupt signal, cleaning up...');
  mesh.removeAllListeners();
  mesh.disconnect();
  process.exit(0);
});
