import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';

/**
 * Local WebSocket Server for PeerPigeon Development
 * 
 * This server provides WebSocket signaling functionality
 * for local development and testing of the PeerPigeon mesh network.
 */

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// In-memory storage for connections and peer data
const connections = new Map(); // peerId -> WebSocket connection
const peerData = new Map();    // peerId -> { peerId, timestamp, data }

// Utility functions
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function validatePeerId(peerId) {
    return typeof peerId === 'string' && /^[a-fA-F0-9]{40}$/.test(peerId);
}

function findClosestPeers(targetPeerId, allPeerIds, maxPeers = 3) {
    if (!targetPeerId || !allPeerIds || allPeerIds.length === 0) {
        return [];
    }
    
    // XOR distance calculation (simplified)
    const distances = allPeerIds.map(peerId => {
        let distance = 0;
        const minLength = Math.min(targetPeerId.length, peerId.length);
        
        for (let i = 0; i < minLength; i++) {
            const xor = parseInt(targetPeerId[i], 16) ^ parseInt(peerId[i], 16);
            distance += xor;
        }
        
        return { peerId, distance };
    });
    
    // Sort by distance and return closest peers
    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, maxPeers).map(item => item.peerId);
}

function getActivePeers(excludePeerId = null) {
    const peers = [];
    for (const [peerId, connection] of connections) {
        if (peerId !== excludePeerId && connection.readyState === WebSocket.OPEN) {
            peers.push(peerId);
        }
    }
    return peers;
}

function sendToConnection(peerId, data) {
    const connection = connections.get(peerId);
    if (connection && connection.readyState === WebSocket.OPEN) {
        try {
            connection.send(JSON.stringify(data));
            return true;
        } catch (error) {
            console.error(`Error sending to ${peerId}:`, error);
            return false;
        }
    }
    return false;
}

function broadcastToClosestPeers(fromPeerId, message, maxPeers = 5) {
    const activePeers = getActivePeers(fromPeerId);
    const closestPeers = findClosestPeers(fromPeerId, activePeers, maxPeers);
    
    console.log(`Broadcasting from ${fromPeerId} to ${closestPeers.length} closest peers`);
    
    closestPeers.forEach(peerId => {
        sendToConnection(peerId, message);
    });
}

function sendToSpecificPeer(targetPeerId, message) {
    return sendToConnection(targetPeerId, message);
}

// Create HTTP server
const server = createServer();

// Create WebSocket server
const wss = new WebSocketServer({ server });

console.log(`🚀 Starting PeerPigeon WebSocket server...`);

wss.on('connection', (ws, req) => {
    let peerId = null;
    
    // Extract peerId from query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryPeerId = url.searchParams.get('peerId');
    
    if (!queryPeerId || !validatePeerId(queryPeerId)) {
        console.log(`❌ Invalid peerId: ${queryPeerId}`);
        ws.close(1008, 'Invalid peerId');
        return;
    }
    
    peerId = queryPeerId;
    
    // Store connection
    connections.set(peerId, ws);
    peerData.set(peerId, {
        peerId,
        timestamp: Date.now(),
        connected: true
    });
    
    console.log(`✅ Peer ${peerId.substring(0, 8)}... connected (${connections.size} total)`);
    
    // Send connection confirmation
    ws.send(JSON.stringify({
        type: 'connected',
        peerId: peerId,
        timestamp: Date.now()
    }));
    
    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            const { type, data: messageData, targetPeerId, maxPeers } = message;
            
            console.log(`📨 Received ${type} from ${peerId.substring(0, 8)}...`);
            
            const responseMessage = {
                type,
                data: messageData,
                fromPeerId: peerId,
                targetPeerId,
                timestamp: Date.now()
            };
            
            // Handle different message types
            switch (type) {
                case 'ping':
                    // Respond with pong
                    ws.send(JSON.stringify({
                        type: 'pong',
                        timestamp: Date.now(),
                        originalTimestamp: messageData?.timestamp
                    }));
                    break;
                    
                case 'announce':
                    // Handle peer announcement
                    peerData.set(peerId, {
                        peerId,
                        timestamp: Date.now(),
                        data: messageData,
                        connected: true
                    });
                    
                    const activePeers = getActivePeers(peerId);
                    console.log(`📢 Announcing ${peerId.substring(0, 8)}... to ${activePeers.length} peers`);
                    
                    // Send peer-discovered messages to other peers
                    activePeers.forEach(otherPeerId => {
                        sendToConnection(otherPeerId, {
                            type: 'peer-discovered',
                            data: { peerId, ...messageData },
                            fromPeerId: 'system',
                            targetPeerId: otherPeerId,
                            timestamp: Date.now()
                        });
                    });
                    
                    // Send existing peers to the new peer
                    activePeers.forEach(existingPeerId => {
                        const existingPeerData = peerData.get(existingPeerId);
                        ws.send(JSON.stringify({
                            type: 'peer-discovered',
                            data: { peerId: existingPeerId, ...existingPeerData?.data },
                            fromPeerId: 'system',
                            targetPeerId: peerId,
                            timestamp: Date.now()
                        }));
                    });
                    break;
                    
                case 'goodbye':
                    // Handle peer disconnect
                    peerData.delete(peerId);
                    broadcastToClosestPeers(peerId, responseMessage);
                    break;
                    
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    // Handle WebRTC signaling
                    if (targetPeerId) {
                        const success = sendToSpecificPeer(targetPeerId, responseMessage);
                        if (!success) {
                            console.log(`⚠️  Failed to send ${type} to ${targetPeerId.substring(0, 8)}... (peer not found)`);
                        }
                    } else {
                        console.log(`⚠️  ${type} message missing targetPeerId`);
                    }
                    break;
                    
                default:
                    // Handle generic messages
                    if (targetPeerId) {
                        sendToSpecificPeer(targetPeerId, responseMessage);
                    } else {
                        broadcastToClosestPeers(peerId, responseMessage, maxPeers || 10);
                    }
                    break;
            }
            
        } catch (error) {
            console.error(`❌ Error handling message from ${peerId?.substring(0, 8)}...:`, error);
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Invalid message format',
                timestamp: Date.now()
            }));
        }
    });
    
    // Handle connection close
    ws.on('close', (code, reason) => {
        console.log(`🔌 Peer ${peerId?.substring(0, 8)}... disconnected (${code}: ${reason})`);
        
        if (peerId) {
            connections.delete(peerId);
            peerData.delete(peerId);
            
            // Notify other peers
            const activePeers = getActivePeers();
            activePeers.forEach(otherPeerId => {
                sendToConnection(otherPeerId, {
                    type: 'peer-disconnected',
                    data: { peerId },
                    fromPeerId: 'system',
                    targetPeerId: otherPeerId,
                    timestamp: Date.now()
                });
            });
        }
        
        console.log(`📊 Active connections: ${connections.size}`);
    });
    
    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${peerId?.substring(0, 8)}...:`, error);
    });
});

// Start server
server.listen(PORT, HOST, () => {
    console.log(`🌐 PeerPigeon WebSocket server running on ws://${HOST}:${PORT}`);
    console.log(`📝 Usage: Connect with ?peerId=<40-char-hex-id>`);
    console.log(`📊 Ready to handle peer connections...`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down WebSocket server...');
    
    // Close all connections
    for (const [peerId, connection] of connections) {
        connection.close(1001, 'Server shutting down');
    }
    
    // Close server
    server.close(() => {
        console.log('✅ WebSocket server closed');
        process.exit(0);
    });
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Export for programmatic use
export { server, wss, connections, peerData };
