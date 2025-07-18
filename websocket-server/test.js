#!/usr/bin/env node

/**
 * WebSocket Server Test Script
 * 
 * This script tests the local WebSocket server with multiple simulated peers.
 */

import { WebSocket } from 'ws';

// Configuration
const SERVER_URL = 'ws://localhost:3000';
const NUM_PEERS = 3;
const TEST_DURATION = 10000; // 10 seconds

// Generate a random 40-character hex peer ID
function generatePeerId() {
    return Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

// Create a test peer
function createTestPeer(peerId, delay = 0) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const ws = new WebSocket(`${SERVER_URL}?peerId=${peerId}`);
            
            ws.on('open', () => {
                console.log(`✅ Peer ${peerId.substring(0, 8)}... connected`);
                
                // Send announcement
                ws.send(JSON.stringify({
                    type: 'announce',
                    data: { peerId }
                }));
                
                // Send periodic pings
                const pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'ping',
                            data: { timestamp: Date.now() }
                        }));
                    } else {
                        clearInterval(pingInterval);
                    }
                }, 5000);
                
                resolve({ ws, peerId, pingInterval });
            });
            
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log(`📨 Peer ${peerId.substring(0, 8)}... received: ${message.type}`);
                    
                    if (message.type === 'peer-discovered') {
                        console.log(`🔍 Peer ${peerId.substring(0, 8)}... discovered: ${message.data.peerId.substring(0, 8)}...`);
                    }
                } catch (error) {
                    console.error(`❌ Parse error for ${peerId.substring(0, 8)}...:`, error);
                }
            });
            
            ws.on('close', () => {
                console.log(`🔌 Peer ${peerId.substring(0, 8)}... disconnected`);
            });
            
            ws.on('error', (error) => {
                console.error(`❌ Peer ${peerId.substring(0, 8)}... error:`, error.message);
            });
        }, delay);
    });
}

// Main test function
async function runTest() {
    console.log(`🚀 Starting WebSocket server test with ${NUM_PEERS} peers`);
    console.log(`📡 Server URL: ${SERVER_URL}`);
    console.log(`⏱️  Test duration: ${TEST_DURATION / 1000} seconds`);
    console.log('');
    
    // Create multiple test peers with staggered connections
    const peers = [];
    for (let i = 0; i < NUM_PEERS; i++) {
        const peerId = generatePeerId();
        const delay = i * 1000; // 1 second between connections
        
        console.log(`🔄 Creating peer ${i + 1}/${NUM_PEERS}: ${peerId.substring(0, 8)}... (delay: ${delay}ms)`);
        
        try {
            const peer = await createTestPeer(peerId, delay);
            peers.push(peer);
        } catch (error) {
            console.error(`❌ Failed to create peer ${peerId.substring(0, 8)}...:`, error);
        }
    }
    
    console.log(`\n📊 Created ${peers.length} peers, running test for ${TEST_DURATION / 1000} seconds...`);
    console.log('');
    
    // Wait for test duration
    await new Promise(resolve => setTimeout(resolve, TEST_DURATION));
    
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    peers.forEach(({ ws, peerId, pingInterval }) => {
        clearInterval(pingInterval);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'goodbye',
                data: { peerId }
            }));
            ws.close();
        }
    });
    
    console.log('✅ Test completed!');
    process.exit(0);
}

// Handle errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Run the test
runTest().catch(console.error);
