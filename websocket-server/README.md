# PeerPigeon WebSocket Server

A local WebSocket server for PeerPigeon development and testing.

## Features

- WebSocket-based peer signaling
- XOR distance-based peer discovery
- WebRTC signaling message routing
- In-memory peer storage
- Real-time peer announcements
- Graceful connection handling

## Quick Start

### 1. Install Dependencies

```bash
cd websocket-server
npm install
```

### 2. Start the Server

```bash
npm start
```

The server will start on `ws://localhost:3000` by default.

### 3. Connect from Browser

Update your browser application to connect to the local server:

```javascript
const mesh = new PeerPigeonMesh();
await mesh.connect('ws://localhost:3000');
```

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: localhost)

### Example Usage

```bash
# Start on custom port
PORT=8080 npm start

# Start on all interfaces
HOST=0.0.0.0 npm start
```

## API

### Connection

Connect with a valid 40-character hex peer ID:

```
ws://localhost:3000?peerId=abc123def456...
```

### Message Types

#### Peer Announcement
```json
{
  "type": "announce",
  "data": { "peerId": "abc123..." }
}
```

#### WebRTC Signaling
```json
{
  "type": "offer",
  "data": { "sdp": "..." },
  "targetPeerId": "def456..."
}
```

#### Keep-Alive
```json
{
  "type": "ping",
  "data": { "timestamp": 1234567890 }
}
```

### Response Messages

#### Connection Confirmation
```json
{
  "type": "connected",
  "peerId": "abc123...",
  "timestamp": 1234567890
}
```

#### Peer Discovery
```json
{
  "type": "peer-discovered",
  "data": { "peerId": "def456..." },
  "fromPeerId": "system",
  "targetPeerId": "abc123...",
  "timestamp": 1234567890
}
```

#### Pong Response
```json
{
  "type": "pong",
  "timestamp": 1234567890,
  "originalTimestamp": 1234567885
}
```

## Testing

### Manual Testing

You can test the server using a WebSocket client:

```javascript
const ws = new WebSocket('ws://localhost:3000?peerId=1234567890abcdef1234567890abcdef12345678');

ws.onopen = () => {
    console.log('Connected');
    
    // Send announcement
    ws.send(JSON.stringify({
        type: 'announce',
        data: { peerId: '1234567890abcdef1234567890abcdef12345678' }
    }));
};

ws.onmessage = (event) => {
    console.log('Received:', JSON.parse(event.data));
};
```

### Browser Testing

1. Open `examples/browser/index.html` in multiple browser tabs
2. Update the WebSocket URL to `ws://localhost:3000`
3. Click "Connect" in each tab
4. Watch peers discover each other

## Development

### Watch Mode

For development with automatic restarts:

```bash
npm run dev
```

### Logging

The server provides detailed logging:

- ✅ Peer connections
- 📨 Message routing
- 📢 Peer announcements
- 🔌 Disconnections
- ❌ Errors

## Architecture

```
Browser Client 1    Browser Client 2    Browser Client N
       |                   |                   |
       v                   v                   v
    WebSocket           WebSocket           WebSocket
       |                   |                   |
       +-------------------+-------------------+
                           |
                    Local WebSocket Server
                           |
                    In-Memory Storage
                    (peers, connections)
```

## Comparison with AWS

| Feature | Local Server | AWS WebSocket |
|---------|-------------|---------------|
| Cost | Free | Pay per message |
| Scalability | Single machine | Auto-scaling |
| Persistence | In-memory | DynamoDB |
| Deployment | Local only | Global |
| Development | Instant | Deploy cycle |

## Troubleshooting

### Common Issues

1. **Connection Refused**: Check if server is running on correct port
2. **Invalid Peer ID**: Ensure peer ID is 40-character hex string
3. **Message Not Delivered**: Check if target peer is connected
4. **Server Won't Start**: Check if port is already in use

### Debug Commands

```bash
# Check if port is in use
lsof -i :3000

# Kill process on port
kill -9 $(lsof -t -i:3000)

# Check server logs
npm start | grep "ERROR"
```

## License

MIT - Same as PeerPigeon main project
