import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 3000 });
const rooms = new Map();

console.log('Signaling server starting on ws://localhost:3000');

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      
      if (data.type === 'join') {
        const room = data.namespace || 'global';
        if (!rooms.has(room)) {
          rooms.set(room, new Set());
        }
        rooms.get(room).add(ws);
        ws.room = room;
        ws.peerId = data.id;
        
        console.log(`Peer ${data.id?.substring(0, 8)} joined ${room}`);
        
        // Notify all peers in the room about each other
        rooms.get(room).forEach(peer => {
          if (peer !== ws && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({ 
              type: 'peer', 
              id: data.id 
            }));
            ws.send(JSON.stringify({ 
              type: 'peer', 
              id: peer.peerId 
            }));
          }
        });
      } else if (data.type === 'signal' && data.to) {
        // Forward signaling data between peers
        rooms.get(ws.room)?.forEach(peer => {
          if (peer.peerId === data.to && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({ 
              type: 'signal', 
              from: ws.peerId, 
              signal: data.signal 
            }));
          }
        });
      }
    } catch (e) {
      console.error('Message error:', e);
    }
  });
  
  ws.on('close', () => {
    console.log(`Peer ${ws.peerId?.substring(0, 8)} disconnected`);
    if (ws.room) {
      rooms.get(ws.room)?.delete(ws);
    }
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

console.log('✅ Signaling server ready');
