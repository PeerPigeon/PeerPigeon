# PeerPigeon Hub System

## Overview

PeerPigeon supports a hub system where certain nodes can act as **hubs** - long-standing servers that form their own mesh network while also serving regular peers. This creates a hybrid architecture that combines the benefits of centralized coordination with peer-to-peer connectivity.

## What are Hubs?

**Hubs** are special peers that:
- Run as persistent servers (not browser-based clients)
- Connect to each other on a reserved namespace called `pigeonhub-mesh`
- Still serve regular peers in their application networks
- Can be identified and tracked separately from regular peers
- Provide enhanced stability and routing for the mesh network

**Regular Peers** are:
- Typically browser clients or mobile apps
- Connect on application-specific networks (e.g., 'my-app-network')
- Can discover and connect to both hubs and other regular peers
- May have shorter lifespans (users opening/closing apps)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Signaling Server                         │
│  • Tracks both hubs and regular peers                       │
│  • Routes signaling messages                                │
│  • Maintains network namespaces                             │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   [Hub A]            [Hub B]              [Hub C]
   (pigeonhub-mesh)  (pigeonhub-mesh)   (pigeonhub-mesh)
        │                   │                   │
    ┌───┴───┐           ┌───┴───┐         ┌────┴────┐
  [Peer 1][Peer 2]    [Peer 3][Peer 4]  [Peer 5][Peer 6]
   (app-net)           (app-net)          (app-net)
```

## Hub Namespace: `pigeonhub-mesh`

The `pigeonhub-mesh` namespace is reserved for hub-to-hub connections. When a hub announces on this namespace:

1. The signaling server identifies it as a hub
2. It's registered in the hub registry
3. It receives a list of all other connected hubs
4. Other hubs are notified about this new hub
5. Hubs can then establish WebRTC connections to each other

## Server Configuration

### Creating a Hub Server

```javascript
import { PeerPigeonServer } from './server/index.js';

const hubServer = new PeerPigeonServer({
    port: 3000,
    host: 'localhost',
    isHub: true, // Mark this server as a hub
    maxConnections: 1000,
    cleanupInterval: 30000
});

// Listen for hub events
hubServer.on('hubRegistered', ({ peerId, totalHubs }) => {
    console.log(`New hub registered: ${peerId}, Total: ${totalHubs}`);
});

hubServer.on('hubUnregistered', ({ peerId, totalHubs }) => {
    console.log(`Hub unregistered: ${peerId}, Remaining: ${totalHubs}`);
});

await hubServer.start();
```

### Creating a Regular Server

```javascript
const regularServer = new PeerPigeonServer({
    port: 3001,
    host: 'localhost',
    isHub: false, // Regular signaling server (default)
});

await regularServer.start();
```

## Bootstrap Hub Configuration

**Bootstrap hubs** allow hubs to automatically connect to each other, forming a hub mesh network without manual WebRTC connection setup.

### How Bootstrap Hubs Work

1. A primary hub runs on port 3000 (default) as the bootstrap hub
2. Secondary hubs automatically connect to the bootstrap hub when they start
3. Through the bootstrap hub, all hubs discover each other
4. Hubs can then establish WebRTC connections to create a mesh network

### Creating a Bootstrap Hub (Primary)

```javascript
const bootstrapHub = new PeerPigeonServer({
    port: 3000,
    host: 'localhost',
    isHub: true,
    autoConnect: false // Don't connect to other hubs (this IS the bootstrap)
});

await bootstrapHub.start();
```

### Creating a Hub that Auto-Connects to Bootstrap

```javascript
const secondaryHub = new PeerPigeonServer({
    port: 3001,
    host: 'localhost',
    isHub: true,
    autoConnect: true // Automatically connects to ws://localhost:3000
});

// Listen for bootstrap connection events
secondaryHub.on('bootstrapConnected', ({ uri }) => {
    console.log(`Connected to bootstrap hub: ${uri}`);
});

secondaryHub.on('bootstrapDisconnected', ({ uri }) => {
    console.log(`Disconnected from bootstrap hub: ${uri}`);
});

secondaryHub.on('hubDiscovered', ({ peerId, via }) => {
    console.log(`Discovered hub ${peerId} via ${via}`);
});

await secondaryHub.start();
```

### Custom Bootstrap Hub URIs

```javascript
const hub = new PeerPigeonServer({
    port: 3002,
    isHub: true,
    bootstrapHubs: [
        'ws://hub1.example.com:3000',
        'ws://hub2.example.com:3000'
    ],
    reconnectInterval: 5000, // Reconnect after 5 seconds
    maxReconnectAttempts: 10 // Try up to 10 times
});

await hub.start();
```

### Bootstrap Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bootstrapHubs` | `string[]` | `[]` | Array of bootstrap hub URIs to connect to |
| `autoConnect` | `boolean` | `true` | Automatically connect to bootstrap hubs on start |
| `reconnectInterval` | `number` | `5000` | Milliseconds to wait before reconnection attempt |
| `maxReconnectAttempts` | `number` | `10` | Maximum number of reconnection attempts |
| `hubPeerId` | `string` | auto-generated | Custom peer ID for this hub |

### Bootstrap Hub Network Topology

```
Bootstrap Hub (3000)
        ↑
        ├── Hub 1 (3001)
        ├── Hub 2 (3002)
        └── Hub 3 (3003)

All hubs discover each other through the bootstrap hub
and can establish direct WebRTC connections.
```

### Redundant Bootstrap Hubs

For high availability, you can configure multiple bootstrap hubs:

```javascript
const hub = new PeerPigeonServer({
    port: 3005,
    isHub: true,
    bootstrapHubs: [
        'ws://bootstrap1.example.com:3000',
        'ws://bootstrap2.example.com:3000',
        'ws://bootstrap3.example.com:3000'
    ]
});

await hub.start();
```

If one bootstrap hub goes down, the hub maintains connections to the others.

## Client-Side Usage

### Announcing as a Hub

When a hub client connects to the signaling server:

```javascript
// Connect to signaling server
const ws = new WebSocket('ws://localhost:3000?peerId=' + myPeerId);

// Announce as a hub on the hub mesh namespace
ws.send(JSON.stringify({
    type: 'announce',
    networkName: 'pigeonhub-mesh', // Reserved hub namespace
    data: {
        isHub: true, // Identify as a hub
        hubVersion: '1.0.0',
        capabilities: ['signaling', 'relay', 'storage'],
        region: 'us-east-1'
    }
}));
```

### Announcing as a Regular Peer

```javascript
// Regular peer announcement
ws.send(JSON.stringify({
    type: 'announce',
    networkName: 'my-app-network', // Application-specific network
    data: {
        isHub: false, // Or omit this field
        peerType: 'browser',
        capabilities: ['messaging', 'video']
    }
}));
```

## Hub Discovery

When a hub announces, it automatically receives information about other hubs:

```javascript
ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'peer-discovered') {
        const { peerId, isHub, ...otherData } = message.data;
        
        if (isHub) {
            console.log(`Discovered hub: ${peerId}`);
            // Initiate WebRTC connection to this hub
            connectToHub(peerId);
        } else {
            console.log(`Discovered regular peer: ${peerId}`);
        }
    }
});
```

## API Methods

### Server Methods

#### `isPeerHub(peerId)`
Check if a connected peer is registered as a hub.

```javascript
if (server.isPeerHub(somePeerId)) {
    console.log('This peer is a hub');
}
```

#### `registerHub(peerId, hubInfo)`
Manually register a peer as a hub (usually done automatically).

```javascript
server.registerHub(peerId, {
    region: 'us-west-2',
    capabilities: ['relay']
});
```

#### `unregisterHub(peerId)`
Unregister a hub (usually done automatically on disconnect).

```javascript
server.unregisterHub(peerId);
```

#### `getConnectedHubs(excludePeerId)`
Get a list of all connected hubs.

```javascript
const hubs = server.getConnectedHubs();
hubs.forEach(hub => {
    console.log(`Hub: ${hub.peerId}, Network: ${hub.networkName}`);
});
```

#### `getStats()`
Get server statistics including hub count.

```javascript
const stats = server.getStats();
console.log(`Total hubs: ${stats.hubs}`);
console.log(`Total peers: ${stats.peers}`);
```

#### `getHubStats()`
Get detailed hub statistics including bootstrap connections.

```javascript
const hubStats = server.getHubStats();
console.log(`Connected hubs: ${hubStats.connectedHubs}`);
console.log('Hub list:', hubStats.hubs);
console.log('Bootstrap hubs:', hubStats.bootstrapHubs);
```

#### `connectToBootstrapHubs()`
Manually trigger connection to bootstrap hubs (usually done automatically on start).

```javascript
await server.connectToBootstrapHubs();
```

#### `connectToHub(uri, attemptNumber)`
Connect to a specific hub URI.

```javascript
await server.connectToHub('ws://hub.example.com:3000');
```

#### `disconnectFromBootstrapHubs()`
Disconnect from all bootstrap hubs.

```javascript
server.disconnectFromBootstrapHubs();
```

#### `generatePeerId()`
Generate a random 40-character hex peer ID.

```javascript
const peerId = server.generatePeerId();
console.log(`Generated peer ID: ${peerId}`);
```

## HTTP Endpoints

### `/health`
Health check endpoint with hub information.

```bash
curl http://localhost:3000/health
```

Response:
```json
{
    "status": "healthy",
    "timestamp": "2025-10-03T12:00:00.000Z",
    "uptime": 3600,
    "isHub": true,
    "connections": 50,
    "peers": 48,
    "hubs": 2,
    "networks": 3,
    "memory": {...}
}
```

### `/hubs`
List all connected hubs.

```bash
curl http://localhost:3000/hubs
```

Response:
```json
{
    "timestamp": "2025-10-03T12:00:00.000Z",
    "totalHubs": 3,
    "hubs": [
        {
            "peerId": "abc123...",
            "networkName": "pigeonhub-mesh",
            "registeredAt": 1696334400000,
            "lastActivity": 1696334500000
        }
    ]
}
```

## Events

### Server Events

#### `hubRegistered`
Emitted when a new hub is registered.

```javascript
server.on('hubRegistered', ({ peerId, totalHubs }) => {
    console.log(`Hub ${peerId} registered. Total: ${totalHubs}`);
});
```

#### `hubUnregistered`
Emitted when a hub is unregistered.

```javascript
server.on('hubUnregistered', ({ peerId, totalHubs }) => {
    console.log(`Hub ${peerId} unregistered. Remaining: ${totalHubs}`);
});
```

#### `peerAnnounced`
Emitted when any peer announces (includes `isHub` flag).

```javascript
server.on('peerAnnounced', ({ peerId, networkName, isHub }) => {
    if (isHub) {
        console.log(`Hub announced: ${peerId} on ${networkName}`);
    }
});
```

#### `bootstrapConnected`
Emitted when successfully connected to a bootstrap hub.

```javascript
server.on('bootstrapConnected', ({ uri }) => {
    console.log(`Connected to bootstrap hub: ${uri}`);
});
```

#### `bootstrapDisconnected`
Emitted when disconnected from a bootstrap hub.

```javascript
server.on('bootstrapDisconnected', ({ uri, code, reason }) => {
    console.log(`Disconnected from ${uri}: ${code} - ${reason}`);
});
```

#### `hubDiscovered`
Emitted when another hub is discovered through a bootstrap connection.

```javascript
server.on('hubDiscovered', ({ peerId, via, data }) => {
    console.log(`Discovered hub ${peerId} via ${via}`);
});
```

#### `bootstrapSignaling`
Emitted when WebRTC signaling messages are received from a bootstrap hub.

```javascript
server.on('bootstrapSignaling', ({ type, data, fromPeerId, uri }) => {
    console.log(`Received ${type} from ${fromPeerId} via ${uri}`);
});
```

## Use Cases

### 1. Geographic Distribution
Deploy hubs in different regions that connect to each other, with local peers connecting to their nearest hub.

```
Hub-US-East ←→ Hub-US-West ←→ Hub-Europe
     ↓              ↓              ↓
  [Peers]        [Peers]        [Peers]
```

### 2. Redundancy
Multiple hubs provide redundancy - if one hub goes down, peers can connect to another hub.

### 3. Load Balancing
Distribute peers across multiple hubs to balance load and improve performance.

### 4. Hierarchical Mesh
Create a two-tier mesh where hubs maintain a stable backbone network and peers connect locally.

## Best Practices

1. **Run hubs on reliable infrastructure** - Use dedicated servers, not browser clients
2. **Use meaningful hub identifiers** - Include region, purpose, or capabilities in hub data
3. **Monitor hub health** - Use the `/health` and `/hubs` endpoints for monitoring
4. **Implement hub failover** - Peers should be able to reconnect to a different hub
5. **Separate hub and peer networks** - Hubs use `pigeonhub-mesh`, peers use app-specific names
6. **Track hub statistics** - Use events and stats methods to monitor hub activity

## Security Considerations

- Validate hub announcements to prevent unauthorized hub registration
- Consider authentication for hub-to-hub connections
- Monitor for malicious hubs attempting to disrupt the network
- Implement rate limiting for hub registrations
- Use secure WebSocket connections (wss://) in production

## Migration Guide

If you have an existing PeerPigeon deployment:

1. Update your signaling server to the latest version
2. Identify which nodes should be hubs (usually long-running servers)
3. Configure those nodes with `isHub: true`
4. Have hub clients announce on `pigeonhub-mesh`
5. Regular peers continue using their existing network names
6. No changes needed to peer-to-peer communication

## Example Deployment

```bash
# Hub Server 1 (US East)
PORT=3000 REGION=us-east node hub-server.js

# Hub Server 2 (US West)  
PORT=3001 REGION=us-west node hub-server.js

# Hub Server 3 (Europe)
PORT=3002 REGION=eu-west node hub-server.js

# Signaling Server (monitors all hubs)
PORT=8080 node signaling-server.js
```

## Troubleshooting

### Hubs not connecting to each other

- Verify hubs are announcing on `pigeonhub-mesh` namespace
- Check that `isHub: true` is included in announcement data
- Verify WebRTC connectivity between hubs
- Check firewall rules for hub-to-hub communication

### Hub not registered on server

- Ensure hub announces after connecting
- Verify announcement message includes `isHub: true` or uses `pigeonhub-mesh`
- Check server logs for registration confirmation

### Regular peers connecting to hub namespace

- Peers should NOT use `pigeonhub-mesh` as their network name
- Use application-specific network names for regular peers
- The server will still route messages correctly

## Conclusion

The PeerPigeon hub system provides a flexible way to create stable, scalable peer-to-peer networks. By combining persistent hub nodes with transient peer connections, you can build robust applications that leverage both centralized coordination and decentralized communication.
