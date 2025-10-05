# Bootstrap Hub Implementation - Summary

## Overview

Added automatic bootstrap hub connectivity for PeerPigeon hubs. Hubs can now automatically connect to a primary bootstrap hub (default port 3000) or custom bootstrap URIs, enabling automatic hub mesh network formation.

## Changes Made

### 1. Server Configuration

#### New Constructor Options:
```javascript
{
    isHub: true,                    // Enable hub mode
    bootstrapHubs: [],              // Array of bootstrap hub URIs
    autoConnect: true,              // Auto-connect to bootstrap hubs
    reconnectInterval: 5000,        // Reconnection delay in ms
    maxReconnectAttempts: 10,       // Max reconnection attempts
    hubPeerId: 'auto-generated'     // Custom hub peer ID (optional)
}
```

### 2. New Server Properties

- `this.bootstrapHubs` - Array of bootstrap hub URIs
- `this.autoConnect` - Whether to auto-connect on start
- `this.reconnectInterval` - Time between reconnection attempts
- `this.maxReconnectAttempts` - Maximum reconnection attempts
- `this.hubPeerId` - This hub's peer ID (auto-generated if not provided)
- `this.bootstrapConnections` - Map of bootstrap URI → connection info

### 3. New Methods

#### `generatePeerId()`
Generates a random 40-character hexadecimal peer ID.

#### `connectToBootstrapHubs()`
Initiates connections to all configured bootstrap hubs. Called automatically on `start()` if `autoConnect` is true.

#### `connectToHub(uri, attemptNumber = 0)`
Connects to a specific bootstrap hub URI. Handles:
- WebSocket connection establishment
- Automatic hub announcement on `pigeonhub-mesh`
- Reconnection on failure with exponential backoff
- Self-connection prevention

#### `announceToHub(ws)`
Sends hub announcement message to a bootstrap hub:
```javascript
{
    type: 'announce',
    networkName: 'pigeonhub-mesh',
    data: {
        isHub: true,
        port: this.port,
        host: this.host,
        capabilities: ['signaling', 'relay']
    }
}
```

#### `handleBootstrapMessage(uri, message)`
Processes messages from bootstrap hubs:
- `connected` - Connection acknowledgment
- `peer-discovered` - Other hub discovery
- `peer-disconnected` - Hub disconnection
- `offer/answer/ice-candidate` - WebRTC signaling
- `pong` - Heartbeat response

#### `disconnectFromBootstrapHubs()`
Closes all bootstrap hub connections. Called automatically on `stop()`.

### 4. New Events

#### `bootstrapConnected`
Emitted when successfully connected to a bootstrap hub.
```javascript
{ uri: 'ws://localhost:3000' }
```

#### `bootstrapDisconnected`
Emitted when disconnected from a bootstrap hub.
```javascript
{ uri: 'ws://localhost:3000', code: 1000, reason: 'Normal closure' }
```

#### `hubDiscovered`
Emitted when another hub is discovered through a bootstrap connection.
```javascript
{ peerId: 'abc123...', via: 'ws://localhost:3000', data: {...} }
```

#### `bootstrapSignaling`
Emitted when WebRTC signaling messages are received from a bootstrap hub.
```javascript
{ type: 'offer', data: {...}, fromPeerId: 'def456...', uri: 'ws://localhost:3000' }
```

### 5. Enhanced Methods

#### `start()`
Now automatically connects to bootstrap hubs after server starts if `isHub: true` and `autoConnect: true`.

#### `stop()`
Now disconnects from all bootstrap hubs before shutting down.

#### `getStats()`
Now includes bootstrap hub connection statistics:
```javascript
{
    ...existing stats,
    hubPeerId: 'abc123...',
    bootstrapHubs: {
        total: 2,
        connected: 1
    }
}
```

#### `getHubStats()`
Now includes detailed bootstrap hub information:
```javascript
{
    ...existing stats,
    bootstrapHubs: [
        {
            uri: 'ws://localhost:3000',
            connected: true,
            lastAttempt: 1696334400000,
            attemptNumber: 0
        }
    ]
}
```

## Usage Examples

### Example 1: Bootstrap Hub (Primary)
```javascript
const bootstrap = new PeerPigeonServer({
    port: 3000,
    isHub: true,
    autoConnect: false  // This IS the bootstrap, don't connect to others
});

await bootstrap.start();
```

### Example 2: Secondary Hub (Auto-connect)
```javascript
const hub = new PeerPigeonServer({
    port: 3001,
    isHub: true,
    autoConnect: true  // Automatically connects to ws://localhost:3000
});

hub.on('bootstrapConnected', ({ uri }) => {
    console.log(`Connected to ${uri}`);
});

hub.on('hubDiscovered', ({ peerId }) => {
    console.log(`Discovered hub: ${peerId}`);
});

await hub.start();
```

### Example 3: Custom Bootstrap URIs
```javascript
const hub = new PeerPigeonServer({
    port: 3002,
    isHub: true,
    bootstrapHubs: [
        'ws://hub1.example.com:3000',
        'ws://hub2.example.com:3000'
    ],
    reconnectInterval: 3000,
    maxReconnectAttempts: 5
});

await hub.start();
```

## Network Topology

### Single Bootstrap Hub
```
Bootstrap Hub (3000)
        ↑
        ├── Hub 1 (3001)
        ├── Hub 2 (3002)
        └── Hub 3 (3003)
```

### Redundant Bootstrap Hubs
```
Bootstrap 1 (3000) ←→ Hub A (3005)
Bootstrap 2 (3001) ←→ Hub A (3005)
Bootstrap 3 (3002) ←→ Hub A (3005)
```

## Automatic Features

### 1. **Connection Management**
- Automatic connection on start
- Self-connection prevention
- Connection health monitoring

### 2. **Reconnection Logic**
- Automatic reconnection on disconnect
- Exponential backoff with configurable interval
- Maximum attempt limit to prevent infinite loops

### 3. **Hub Discovery**
- Automatic announcement to bootstrap hub
- Reception of peer-discovered messages for other hubs
- Event emission for application-level handling

### 4. **Cleanup**
- Automatic disconnection on server stop
- Cancellation of pending reconnection timers
- Proper WebSocket closure

## Benefits

1. **Zero Configuration**: Secondary hubs automatically find port 3000
2. **Easy Setup**: Just set `isHub: true` and `autoConnect: true`
3. **Redundancy**: Support for multiple bootstrap hubs
4. **Resilience**: Automatic reconnection with backoff
5. **Discovery**: Hubs automatically discover each other
6. **Monitoring**: Events for connection state tracking

## Files Modified

1. **server/index.js**
   - Added WebSocket client import
   - Added bootstrap configuration options
   - Added `generatePeerId()` method
   - Added bootstrap connection methods
   - Enhanced `start()` and `stop()` methods
   - Enhanced `getStats()` and `getHubStats()` methods

2. **HUB_SYSTEM.md**
   - Added "Bootstrap Hub Configuration" section
   - Added bootstrap methods to API documentation
   - Added bootstrap events documentation

3. **examples/bootstrap-hub-example.js** (NEW)
   - Comprehensive examples of bootstrap hub usage
   - Single bootstrap network example
   - Redundant bootstrap network example
   - Configuration examples

## Migration Guide

### For Existing Hubs

If you have existing hub deployments, you can add bootstrap connectivity:

**Before:**
```javascript
const hub = new PeerPigeonServer({
    port: 3001,
    isHub: true
});
await hub.start();
```

**After:**
```javascript
const hub = new PeerPigeonServer({
    port: 3001,
    isHub: true,
    autoConnect: true  // Add this line
});
await hub.start();
// Hub now automatically connects to ws://localhost:3000
```

### Disable Auto-Connect

To maintain existing behavior without bootstrap connections:

```javascript
const hub = new PeerPigeonServer({
    port: 3001,
    isHub: true,
    autoConnect: false  // Explicitly disable
});
```

## Testing

Run the example to test bootstrap hub functionality:

```bash
node examples/bootstrap-hub-example.js
```

This will:
1. Start a bootstrap hub on port 3000
2. Start three secondary hubs on ports 3001-3003
3. Display connection statistics
4. Show hub discovery events
5. Demonstrate automatic reconnection

## Future Enhancements

Potential future improvements:
- WebRTC data channel connections between hubs
- Hub load balancing
- Geographic hub routing
- Hub health monitoring
- Metrics and analytics
- Hub authentication/authorization

## Conclusion

The bootstrap hub system enables seamless hub mesh network formation with minimal configuration. Hubs can now automatically discover and connect to each other, creating a robust and scalable infrastructure for PeerPigeon applications.
