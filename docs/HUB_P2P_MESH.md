# Hub P2P Mesh System

## Overview

PeerPigeon hubs now form a **true peer-to-peer mesh network** using WebRTC connections with XOR-based routing for efficient partial mesh topology. This system automatically migrates from WebSocket connections to P2P connections once the mesh is established, reducing server load and improving scalability.

## Key Features

### 🔗 Automatic P2P Mesh Formation
- All hubs register as bootstrap nodes
- Hubs form P2P connections on the `pigeonhub-mesh` namespace
- Uses XOR distance routing for optimal partial mesh topology
- Maintains `minPeers` to `maxPeers` connections per hub

### 📊 XOR Routing for Partial Mesh
- Each hub maintains connections to the closest peers by XOR distance
- Default: 2-3 P2P connections per hub (configurable)
- Ensures efficient routing while minimizing connection overhead
- Automatic peer selection based on peer ID proximity

### 🔄 WebSocket to P2P Migration
- Hubs initially connect via WebSocket for signaling
- Once P2P mesh is established, WebSocket connections are closed
- Automatic migration after configurable delay (default: 10 seconds)
- Maintains client connections via WebSocket (only hub-to-hub migrates to P2P)

### 🌐 Client Signal Relaying
- Client signaling messages are relayed through the P2P hub mesh
- XOR routing ensures efficient path finding
- Transparent to client applications
- Automatic fallback to WebSocket if P2P is unavailable

## Architecture

```
Initial State (WebSocket):
┌──────────┐    WS     ┌──────────┐    WS     ┌──────────┐
│  Hub A   │◄─────────►│  Hub B   │◄─────────►│  Hub C   │
│ (3000)   │           │ (3001)   │           │ (3002)   │
└────┬─────┘           └────┬─────┘           └────┬─────┘
     │                      │                      │
   Clients              Clients                Clients

After P2P Migration:
┌──────────┐    P2P    ┌──────────┐    P2P    ┌──────────┐
│  Hub A   │◄─────────►│  Hub B   │◄─────────►│  Hub C   │
│ (3000)   │    WebRTC │ (3001)   │    WebRTC │ (3002)   │
└────┬─────┘           └────┬─────┘           └────┬─────┘
     │ WS                   │ WS                   │ WS
   Clients              Clients                Clients
   (unchanged)          (unchanged)            (unchanged)
```

## Configuration

### Hub Server with P2P Mesh

```javascript
import { PeerPigeonServer } from './server/index.js';

const hubServer = new PeerPigeonServer({
    port: 3000,
    host: '0.0.0.0',
    isHub: true,
    
    // Hub mesh configuration
    hubMeshNamespace: 'pigeonhub-mesh',  // Namespace for hub mesh
    hubMeshMaxPeers: 3,                  // Max P2P connections (partial mesh)
    hubMeshMinPeers: 2,                  // Min P2P connections before migration
    
    // Bootstrap configuration
    bootstrapHubs: [],                   // Auto-discover from port 3000
    autoConnect: true,                   // Auto-connect to bootstrap
    
    // Migration timing
    meshMigrationDelay: 10000,           // Wait 10s before closing WebSockets
    
    // Connection limits
    maxConnections: 1000,
    cleanupInterval: 30000
});

// Listen for P2P mesh events
hubServer.on('hubP2PConnected', ({ hubPeerId }) => {
    console.log(`P2P connection established with hub: ${hubPeerId}`);
});

hubServer.on('hubMeshReady', ({ p2pConnections, totalHubs }) => {
    console.log(`Hub mesh ready! ${p2pConnections} P2P connections`);
});

hubServer.on('hubMeshMigrated', ({ migratedCount, p2pConnections }) => {
    console.log(`Migrated to P2P: ${migratedCount} WebSocket connections closed`);
});

hubServer.on('hubP2PDisconnected', ({ hubPeerId }) => {
    console.log(`P2P connection lost with hub: ${hubPeerId}`);
});

await hubServer.start();
```

### Starting Multiple Hubs

#### Primary Hub (Bootstrap Node)
```bash
PORT=3000 npm run hub
```

#### Secondary Hubs
```bash
# Hub automatically connects to bootstrap on port 3000
PORT=3001 npm run hub
PORT=3002 npm run hub
PORT=3003 npm run hub
```

#### With Custom Bootstrap Hubs
```bash
BOOTSTRAP_HUBS=ws://hub1.example.com:3000,ws://hub2.example.com:3001 PORT=3002 npm run hub
```

## How It Works

### 1. Hub Initialization
When a hub starts with `isHub: true`:
1. Creates a `PeerPigeonMesh` instance for P2P connections
2. Connects to its own signaling server
3. Announces on the `pigeonhub-mesh` namespace
4. Begins discovering other hubs

### 2. Bootstrap Connection
1. Hub connects to bootstrap hub(s) via WebSocket
2. Announces itself as a hub
3. Receives list of other hubs
4. Maintains WebSocket for initial signaling

### 3. P2P Mesh Formation
1. Hubs use WebSocket signaling to establish WebRTC connections
2. XOR routing determines optimal peer selection
3. Each hub maintains 2-3 P2P connections (configurable)
4. Partial mesh topology forms automatically

### 4. Mesh Readiness Check
Mesh is considered ready when:
- Hub has ≥ `hubMeshMinPeers` P2P connections, OR
- Hub has P2P connections to all available hubs (if less than minPeers exist)

### 5. WebSocket Migration
Once mesh is ready (after `meshMigrationDelay`):
1. Direct hub-to-hub WebSocket connections are closed
2. Bootstrap WebSocket connections are closed
3. All hub-to-hub communication switches to P2P
4. Client WebSocket connections remain active

### 6. Client Signal Relaying
When a client on Hub A needs to signal a peer on Hub C:
1. Client sends signal to Hub A via WebSocket
2. Hub A relays signal through P2P mesh using XOR routing
3. Hub C receives signal and forwards to local client via WebSocket
4. Process is transparent to clients

## XOR Routing Algorithm

The system uses XOR distance to determine peer proximity:

```javascript
// XOR distance calculation
function xorDistance(peerId1, peerId2) {
    let distance = 0;
    for (let i = 0; i < peerId1.length; i++) {
        const xor = parseInt(peerId1[i], 16) ^ parseInt(peerId2[i], 16);
        distance += xor;
    }
    return distance;
}

// Find closest peers
function findClosestPeers(targetPeerId, allPeerIds, maxPeers = 3) {
    return allPeerIds
        .map(id => ({ id, distance: xorDistance(targetPeerId, id) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxPeers)
        .map(item => item.id);
}
```

## Event Flow

### Hub Startup
```
1. Hub starts
2. initializeHubMesh() creates PeerPigeonMesh
3. Hub connects to local signaling server
4. connectToBootstrapHubs() establishes WebSocket connections
5. Hub announces on pigeonhub-mesh namespace
```

### P2P Connection Established
```
1. Hub discovers another hub via signaling
2. PeerPigeonMesh initiates WebRTC connection
3. 'hubP2PConnected' event fires
4. checkMeshReadiness() evaluates if mesh is ready
```

### Mesh Ready → Migration
```
1. Mesh reaches minimum P2P connections
2. 'hubMeshReady' event fires
3. Timer starts (default 10 seconds)
4. migrateToP2POnly() closes WebSocket connections
5. 'hubMeshMigrated' event fires
6. Hub-to-hub communication now fully P2P
```

### Client Signal Relay
```
1. Client sends signal to local hub (WebSocket)
2. Hub checks if target is local
3. If not local:
   - forwardSignalToHubMesh() finds closest hubs
   - Signal sent via P2P to 1-2 closest hubs
   - Receiving hub forwards to target client (WebSocket)
```

## Benefits

### Scalability
- **Reduced WebSocket connections**: Hub-to-hub connections migrate to P2P
- **Partial mesh**: O(log N) connections instead of O(N²) full mesh
- **Efficient routing**: XOR distance ensures optimal paths

### Reliability
- **Automatic failover**: Multiple P2P paths available
- **Bootstrap reconnection**: Hubs reconnect if P2P connections fail
- **Graceful degradation**: Falls back to WebSocket if P2P unavailable

### Performance
- **Direct P2P**: Lower latency for hub-to-hub communication
- **Reduced server load**: No centralized bottleneck
- **Efficient routing**: Messages take shortest XOR path

### Simplicity
- **Automatic**: No manual configuration required
- **Transparent**: Clients don't need to know about hub mesh
- **Self-organizing**: Mesh forms and optimizes automatically

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `isHub` | `false` | Enable hub mode |
| `hubMeshNamespace` | `'pigeonhub-mesh'` | Namespace for hub P2P mesh |
| `hubMeshMaxPeers` | `3` | Max P2P connections per hub |
| `hubMeshMinPeers` | `2` | Min P2P connections before migration |
| `meshMigrationDelay` | `10000` | Delay before closing WebSockets (ms) |
| `bootstrapHubs` | `[]` | Array of bootstrap hub URIs |
| `autoConnect` | `true` | Auto-connect to bootstrap hubs |
| `reconnectInterval` | `5000` | Bootstrap reconnection delay (ms) |
| `maxReconnectAttempts` | `10` | Max bootstrap reconnection attempts |

## Monitoring

### Events

- `hubP2PConnected`: P2P connection established with another hub
- `hubP2PDisconnected`: P2P connection lost
- `hubMeshReady`: P2P mesh has sufficient connections
- `hubMeshMigrated`: WebSocket connections closed, fully P2P
- `hubDiscovered`: New hub discovered via bootstrap
- `bootstrapConnected`: Connected to bootstrap hub
- `bootstrapDisconnected`: Disconnected from bootstrap hub

### Status Endpoint

```bash
curl http://localhost:3000/health
```

Response includes:
- `isHub`: Whether this is a hub server
- `connections`: Total WebSocket connections
- `hubs`: Number of registered hubs
- Additional hub mesh statistics

## Best Practices

### Network Size
- **Small (2-5 hubs)**: Use `maxPeers: 2-3` for partial mesh
- **Medium (6-20 hubs)**: Use `maxPeers: 3-4` for balanced routing
- **Large (20+ hubs)**: Use `maxPeers: 4-5` for redundancy

### Migration Delay
- **Fast networks**: `5000-10000ms` (5-10 seconds)
- **Slow networks**: `15000-30000ms` (15-30 seconds)
- **Production**: `10000ms` (default) is recommended

### Bootstrap Strategy
- Run 1-2 dedicated bootstrap hubs on well-known ports
- Other hubs auto-discover and form P2P mesh
- Bootstrap hubs should be most stable/reliable servers

### Firewall Configuration
- WebSocket ports must be accessible (default: 3000-3099)
- WebRTC requires STUN/TURN for NAT traversal
- Consider using TURN servers for production deployments

## Troubleshooting

### Hubs not forming P2P connections
- Check that `isHub: true` is set on all hubs
- Verify `hubMeshNamespace` is the same across all hubs
- Ensure bootstrap hubs are reachable
- Check firewall rules for WebRTC connections

### WebSocket connections not closing
- Verify P2P connections are established (`hubP2PConnected` events)
- Check that mesh reached minimum connections
- Increase `meshMigrationDelay` if connections are slow to establish

### Client signals not being relayed
- Ensure P2P mesh is ready (`hubMeshReady` event)
- Check that target hub is in the P2P mesh
- Verify XOR routing is working (check logs)

## Example: 3-Hub Network

```bash
# Terminal 1: Bootstrap hub
PORT=3000 npm run hub

# Terminal 2: Secondary hub
PORT=3001 npm run hub

# Terminal 3: Tertiary hub
PORT=3002 npm run hub
```

Expected behavior:
1. Hub 3000 starts, waiting for connections
2. Hub 3001 starts, connects to 3000 via WebSocket
3. Hub 3002 starts, connects to 3000 via WebSocket
4. All hubs discover each other through bootstrap
5. P2P connections form (using XOR routing):
   - Hub 3000 ↔ Hub 3001 (P2P)
   - Hub 3001 ↔ Hub 3002 (P2P)
   - Hub 3000 ↔ Hub 3002 (P2P or indirect via 3001)
6. After 10 seconds, WebSocket connections close
7. All hub-to-hub communication now via P2P
8. Clients can connect to any hub, signals relayed via P2P mesh

## See Also

- [Hub System Documentation](./HUB_SYSTEM.md)
- [Bootstrap Hubs Documentation](./BOOTSTRAP_HUBS.md)
- [Network Namespaces](./NETWORK_NAMESPACES.md)
- [XOR Routing in Distributed Systems](https://en.wikipedia.org/wiki/Kademlia)
