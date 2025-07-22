import { WebSocketServer, WebSocket } from 'ws';
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
    const stalePeers = [];
    
    for (const [peerId, connection] of connections) {
        if (peerId !== excludePeerId) {
            if (connection.readyState === WebSocket.OPEN && isConnectionAlive(connection)) {
                peers.push(peerId);
            } else {
                // Mark stale connections for cleanup
                stalePeers.push(peerId);
            }
        }
    }
    
    // Clean up stale connections
    stalePeers.forEach(peerId => {
        console.log(`🧹 Cleaning up stale connection: ${peerId.substring(0, 8)}...`);
        connections.delete(peerId);
        peerData.delete(peerId);
    });
    
    return peers;
}

function isConnectionAlive(connection) {
    if (!connection || connection.readyState !== WebSocket.OPEN) {
        return false;
    }
    
    // Check if we've received a recent pong or if this is a fresh connection
    const now = Date.now();
    const lastPong = connection.lastPong || connection.connectedAt || now;
    const timeSinceLastPong = now - lastPong;
    
    // Consider connection dead if no pong for more than 12 minutes (since we ping every 9 minutes)
    return timeSinceLastPong < 720000; // 12 minutes
}

function pingConnection(peerId, connection) {
    if (connection.readyState === WebSocket.OPEN) {
        try {
            connection.ping();
            return true;
        } catch (error) {
            console.log(`🏓 Failed to ping ${peerId.substring(0, 8)}...:`, error.message);
            cleanupPeer(peerId);
            return false;
        }
    }
    return false;
}

function sendToConnection(peerId, data) {
    const connection = connections.get(peerId);
    if (connection && connection.readyState === WebSocket.OPEN) {
        try {
            connection.send(JSON.stringify(data));
            return true;
        } catch (error) {
            console.error(`Error sending to ${peerId}:`, error);
            // Clean up failed connection
            cleanupPeer(peerId);
            return false;
        }
    } else if (connection && (connection.readyState === WebSocket.CLOSED || connection.readyState === WebSocket.CLOSING)) {
        // Clean up closed connection
        cleanupPeer(peerId);
    }
    return false;
}

function cleanupPeer(peerId) {
    const wasConnected = connections.has(peerId);
    connections.delete(peerId);
    peerData.delete(peerId);
    
    if (wasConnected) {
        console.log(`🧹 Cleaned up peer: ${peerId.substring(0, 8)}...`);
        
        // Notify other peers about disconnection
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

// Periodic cleanup of stale connections
setInterval(() => {
    const totalConnections = connections.size;
    const activePeers = getActivePeers(); // This will clean up stale connections
    const cleanedUp = totalConnections - connections.size;
    
    if (cleanedUp > 0) {
        console.log(`🧹 Periodic cleanup: removed ${cleanedUp} stale connections, ${connections.size} active`);
    }
}, 30000); // Clean up every 30 seconds

// DHT-based heartbeat ping every 9 minutes (540 seconds)
// Use DHT logic to select a SINGLE peer to do the pinging instead of server pinging all
setInterval(() => {
    const activePeers = Array.from(connections.keys());
    
    if (activePeers.length === 0) {
        console.log(`🏓 No peers to ping`);
        return;
    }
    
    // Use XOR distance to select the peer closest to a deterministic target
    // This ensures the same peer is consistently selected across intervals
    const pingTarget = '0000000000000000000000000000000000000000'; // Deterministic target for ping selection
    const selectedPeer = selectPeerForPing(pingTarget, activePeers);
    
    if (selectedPeer) {
        const connection = connections.get(selectedPeer);
        console.log(`🏓 DHT-selected peer ${selectedPeer.substring(0, 8)}... for heartbeat ping (${activePeers.length} total peers)`);
        
        if (!pingConnection(selectedPeer, connection)) {
            console.log(`🧹 DHT-selected peer ${selectedPeer.substring(0, 8)}... failed ping, cleaned up`);
        }
    }
}, 540000); // Ping every 9 minutes (540 seconds)

// DHT-based peer selection for ping duty
function selectPeerForPing(target, peerIds) {
    if (!peerIds || peerIds.length === 0) return null;
    
    // Use XOR distance to find the peer closest to the target
    let closestPeer = null;
    let closestDistance = Infinity;
    
    for (const peerId of peerIds) {
        const distance = calculateXORDistance(target, peerId);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestPeer = peerId;
        }
    }
    
    return closestPeer;
}

// XOR distance calculation for DHT peer selection
function calculateXORDistance(id1, id2) {
    let distance = 0;
    const minLength = Math.min(id1.length, id2.length);
    
    for (let i = 0; i < minLength; i++) {
        const xor = parseInt(id1[i], 16) ^ parseInt(id2[i], 16);
        distance += xor;
    }
    
    return distance;
}

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
    
    // Check if peerId is already connected
    if (connections.has(peerId)) {
        const existingConnection = connections.get(peerId);
        if (existingConnection.readyState === WebSocket.OPEN) {
            console.log(`⚠️  Peer ${peerId.substring(0, 8)}... already connected, closing duplicate`);
            ws.close(1008, 'Peer already connected');
            return;
        } else {
            // Clean up stale connection
            console.log(`🔄 Replacing stale connection for ${peerId.substring(0, 8)}...`);
            cleanupPeer(peerId);
        }
    }
    
    // Store connection
    connections.set(peerId, ws);
    peerData.set(peerId, {
        peerId,
        timestamp: Date.now(),
        connected: true
    });
    
    // Set up connection metadata
    ws.connectedAt = Date.now();
    ws.lastPong = Date.now();
    
    // Set up pong handler for heartbeat
    ws.on('pong', () => {
        ws.lastPong = Date.now();
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
                    
                    // Get active peers with immediate validation
                    const activePeers = getActivePeers(peerId);
                    
                    // Double-check each active peer with a quick ping test
                    const validatedPeers = [];
                    for (const otherPeerId of activePeers) {
                        const connection = connections.get(otherPeerId);
                        if (connection && isConnectionAlive(connection)) {
                            validatedPeers.push(otherPeerId);
                        } else {
                            console.log(`� Found dead connection during announce: ${otherPeerId.substring(0, 8)}...`);
                            cleanupPeer(otherPeerId);
                        }
                    }
                    
                    console.log(`�📢 Announcing ${peerId.substring(0, 8)}... to ${validatedPeers.length} validated peers`);
                    
                    // Send peer-discovered messages to validated peers only
                    validatedPeers.forEach(otherPeerId => {
                        sendToConnection(otherPeerId, {
                            type: 'peer-discovered',
                            data: { peerId, ...messageData },
                            fromPeerId: 'system',
                            targetPeerId: otherPeerId,
                            timestamp: Date.now()
                        });
                    });
                    
                    // Send existing validated peers to the new peer
                    validatedPeers.forEach(existingPeerId => {
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
            cleanupPeer(peerId);
        }
        
        console.log(`📊 Active connections: ${connections.size}`);
    });
    
    // Handle connection errors
    ws.on('error', (error) => {
        console.error(`❌ WebSocket error for ${peerId?.substring(0, 8)}...:`, error);
        
        // Clean up errored connection
        if (peerId && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
            cleanupPeer(peerId);
        }
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
