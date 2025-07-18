# PeerPigeon <img src="examples/browser/assets/images/favicon.png" alt="PeerPigeon Logo" width="32" height="32" align="right">

**A WebRTC-based peer-to-peer mesh networking library with intelligent routing, gossip protocol messaging, and automated peer management.**

[![npm version](https://badge.fury.io/js/peerpigeon.svg)](https://badge.fury.io/js/peerpigeon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **📊 Viewing Diagrams**: This README contains Mermaid diagrams. For proper visualization in VS Code, install the [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) extension.

## 🌟 Features

- **🕸️ True Mesh Networking**: Gossip protocol ensures messages reach all peers, not just direct connections
- **📐 XOR Distance Routing**: Kademlia-inspired peer selection for optimal network topology  
- **🧠 Smart Eviction Strategy**: Automatically replaces distant peers with closer ones to optimize mesh topology
- **🔍 Auto-Discovery**: Seamlessly connects to peers as they join the network
- **⚡ WebSocket Signaling**: Real-time bidirectional communication for optimal performance
- **�️ Distributed Hash Table (WebDHT)**: Store and retrieve data across the mesh with automatic replication
- **🎥 Media Streaming**: Built-in support for audio/video streaming between peers
- **💬 Messaging System**: Direct messages and broadcast gossip protocol messaging
- **🔧 Modular Architecture**: Clean separation of concerns with event-driven components
- **💰 Cost-Optimized**: XOR-based routing reduces signaling server costs by ~95%
- **🛡️ Memory Safe**: Comprehensive cleanup prevents memory leaks in long-running applications

## 🏗️ Architecture Overview

```mermaid
graph TB
    subgraph Browser[Browser Environment]
        UI[User Interface] --> App[PeerPigeonMesh]
        
        App --> SC[SignalingClient]
        App --> PD[PeerDiscovery]
        App --> CM[ConnectionManager]
        App --> EM[EvictionManager]
        App --> GM[GossipManager]
        App --> MO[MeshOptimizer]
        
        CM --> PC1[PeerConnection A]
        CM --> PC2[PeerConnection B]
        CM --> PC3[PeerConnection ...]
        
        GM --> PC1
        GM --> PC2
        GM --> PC3
    end
    
    subgraph Network[Network Layer]
        PC1 -.->|WebRTC Data Channel| PA[Peer A]
        PC2 -.->|WebRTC Data Channel| PB[Peer B]
        PC3 -.->|WebRTC Data Channel| PC[Peer ...]
    end
    
    subgraph Signaling[Signaling Infrastructure]
        SC -->|HTTP/WebSocket| SS[Signaling Server]
        SS --> DB[(Message Storage)]
    end
    
    style App fill:#e1f5fe,color:#000000
    style GM fill:#e8f5e8,color:#000000
    style EM fill:#fff3e0,color:#000000
    style PD fill:#fce4ec,color:#000000
```

> **Note**: If diagrams don't display, install the [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) extension in VS Code.

## 🚀 Quick Start

### Installation

```bash
# Install PeerPigeon from npm
npm install peerpigeon
```

### Basic Setup

```javascript
import { PeerPigeonMesh } from 'peerpigeon';

// Create mesh instance
const mesh = new PeerPigeonMesh({
    enableWebDHT: true, // Enable distributed hash table (default: true)
    peerId: 'custom-peer-id' // Optional: provide custom peer ID
});

// Initialize and connect
await mesh.init();
await mesh.connect('ws://localhost:3000'); // Your signaling server URL
```

### Starting a WebSocket Server

#### Option 1: Programmatic Server Setup (Recommended)

```javascript
import { PeerPigeonServer } from 'peerpigeon';

// Create and start the server
const server = new PeerPigeonServer({
    port: 3000,
    host: 'localhost',
    maxConnections: 1000,
    cleanupInterval: 60000, // 1 minute
    peerTimeout: 300000     // 5 minutes
});

// Start the server
await server.start();

// Listen for events
server.on('peerConnected', ({ peerId, totalConnections }) => {
    console.log(`Peer ${peerId} connected. Total: ${totalConnections}`);
});

server.on('peerDisconnected', ({ peerId, totalConnections }) => {
    console.log(`Peer ${peerId} disconnected. Total: ${totalConnections}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
});
```

#### Option 2: Standalone Server

```bash
# Run the standalone server (from npm package)
npm start

# Or run directly with custom configuration
PORT=8080 HOST=0.0.0.0 npm start
```

### Messaging Examples

```javascript
// Send a broadcast message to all peers
const messageId = mesh.sendMessage('Hello, mesh network!');

// Send a direct message to a specific peer
const directMessageId = mesh.sendDirectMessage('target-peer-id', 'Private message');

// Listen for incoming messages
mesh.addEventListener('messageReceived', (data) => {
    console.log(`Message from ${data.from}: ${data.content}`);
    console.log(`Direct message: ${data.direct}`);
});
```

### WebDHT (Distributed Hash Table) Examples

```javascript
// Store data in the distributed hash table
await mesh.dhtPut('user-settings', { theme: 'dark', language: 'en' });

// Retrieve data from the DHT
const settings = await mesh.dhtGet('user-settings');

// Subscribe to changes
await mesh.dhtSubscribe('shared-counter');
mesh.addEventListener('dhtValueChanged', (data) => {
    console.log(`Key ${data.key} changed to:`, data.newValue);
});

// Update a value and notify subscribers
await mesh.dhtUpdate('shared-counter', 42);
```

### Media Streaming Examples

```javascript
// Start local video stream
const stream = await mesh.startMedia({ video: true, audio: true });

// Toggle media
mesh.toggleVideo(); // Enable/disable video
mesh.toggleAudio(); // Enable/disable audio

// Get media devices
const devices = await mesh.enumerateMediaDevices();
console.log('Available cameras:', devices.cameras);
console.log('Available microphones:', devices.microphones);

// Listen for remote streams
mesh.addEventListener('remoteStream', (data) => {
    const { peerId, stream } = data;
    const videoElement = document.createElement('video');
    videoElement.srcObject = stream;
    videoElement.play();
});
```

### Event Handling Examples

```javascript
// Connection events
mesh.addEventListener('connected', () => {
    console.log('Connected to signaling server');
});

mesh.addEventListener('peerConnected', (data) => {
    console.log(`Peer connected: ${data.peerId}`);
});

mesh.addEventListener('peerDisconnected', (data) => {
    console.log(`Peer disconnected: ${data.peerId}, reason: ${data.reason}`);
});

// Status monitoring
mesh.addEventListener('statusChanged', (data) => {
    console.log(`Status: ${data.type} - ${data.message}`);
});
```

### Configuration Examples

```javascript
// Adjust mesh topology
mesh.setMaxPeers(5);     // Maximum peer connections
mesh.setMinPeers(2);     // Minimum peer connections
mesh.setXorRouting(true); // Enable XOR-based routing
mesh.setEvictionStrategy(true); // Enable smart peer eviction

// Get current status
const status = mesh.getStatus();
console.log('Connected peers:', status.connectedCount);
console.log('Discovered peers:', status.discoveredCount);
```

### Local Development Server

**Option 1: Using npm package (Recommended)**
```bash
# Install PeerPigeon globally or in your project
npm install peerpigeon

# Start the signaling server
npm start

# Or with custom configuration
PORT=8080 HOST=0.0.0.0 npm start

# Serve the browser examples using the built-in server
npm run dev
```

**Option 2: From source (for development)**
```bash
# Clone the repository
git clone https://github.com/draeder/peerpigeon.git
cd peerpigeon

# Start the WebSocket signaling server
npm start

# Serve the browser examples
npm run dev
```

#### Navigate to http://localhost:8080/examples/browser/

###### Test with query parameters
http://localhost:8080/examples/browser/?api=ws://localhost:3000

## 🔄 System Flow Diagrams

### Peer Discovery & Connection Flow

```mermaid
sequenceDiagram
    participant A as Peer A
    participant B as Peer B  
    participant C as Peer C
    participant S as Signaling Server
    
    Note over A,C: Network Formation
    A->>S: announce (peerId, timestamp)
    B->>S: announce (peerId, timestamp)
    C->>S: announce (peerId, timestamp)
    
    S->>A: peer-discovered (B, C)
    S->>B: peer-discovered (A, C)
    S->>C: peer-discovered (A, B)
    
    Note over A,C: Smart Connection Logic
    A->>A: shouldInitiate(B)? (A > B lexicographically)
    A->>B: WebRTC offer (if true)
    B->>A: WebRTC answer
    
    A->>B: ICE candidate
    B->>A: ICE candidate
    Note over A,B: ✅ WebRTC Data Channel Ready
    
    Note over A,C: Topology Optimization
    C->>A: connection request
    A->>A: at capacity? should evict?
    A->>B: eviction notice (if applicable)
    Note over A,C: ✅ Connection established
```

### Gossip Protocol Message Flow

```mermaid
flowchart TD
    Send[User sends message] --> CreateMsg["Create gossip message<br/>with ID, TTL=10"]
    CreateMsg --> StoreLocal["Store in seen messages<br/>to prevent loops"]
    StoreLocal --> EmitLocal[Emit to local UI]
    EmitLocal --> Broadcast[Send to all connected peers]
    
    Receive[Receive gossip message] --> CheckSeen{Already seen this message?}
    CheckSeen -->|Yes| Drop[Drop message]
    CheckSeen -->|No| CheckTTL{TTL > 0?}
    CheckTTL -->|No| Drop
    CheckTTL -->|Yes| CheckLoop{Sender in our path?}
    CheckLoop -->|Yes| Drop
    CheckLoop -->|No| Process[Process message]
    
    Process --> StoreSeen[Store in seen messages]
    StoreSeen --> EmitReceived[Emit to local UI]
    EmitReceived --> DecrementTTL["TTL--, add to path"]
    DecrementTTL --> Propagate["Forward to other peers<br/>except sender"]
    
    Propagate --> End[Message delivered]
    Drop --> End
    
    style Send fill:#e8f5e8,color:#000000
    style Receive fill:#e1f5fe,color:#000000
    style Drop fill:#ffebee,color:#000000
    style End fill:#f3e5f5,color:#000000
```

### Peer Connection & Isolation Prevention

```mermaid
flowchart TD
    Discover[Peer Discovered] --> ShouldInit{Should we initiate connection?}
    
    ShouldInit --> CheckLex["Lexicographic rule:<br/>our ID > target ID?"]
    CheckLex -->|Yes| Connect[Initiate Connection]
    CheckLex -->|No| CheckIsolation{Are we isolated?}
    
    CheckIsolation -->|No connections| IsolationOverride["Override lexicographic rule<br/>to prevent isolation"]
    CheckIsolation -->|Has connections| Wait[Wait for peer to initiate to us]
    
    IsolationOverride --> NaturalInitiator{Can initiate to natural targets?}
    NaturalInitiator -->|Yes| ConnectNatural["Connect to peer where<br/>we're natural initiator"]
    NaturalInitiator -->|No| ConnectClosest["Connect to closest peer<br/>by XOR distance"]
    
    ConnectNatural --> Connect
    ConnectClosest --> Connect
    
    Connect --> WebRTC["WebRTC Handshake<br/>via signaling server"]
    WebRTC --> Success{Connection successful?}
    
    Success -->|Yes| CheckCapacity{At peer capacity?}
    Success -->|No| RetryLater["Retry with<br/>exponential backoff"]
    
    CheckCapacity -->|No| Maintain[Maintain connection]
    CheckCapacity -->|Yes| ConsiderEviction["Should evict<br/>existing peer?"]
    
    ConsiderEviction -->|No| Maintain
    ConsiderEviction -->|Yes| EvictFarthest["Evict farthest peer<br/>by XOR distance"]
    
    EvictFarthest --> Maintain
    Wait --> End[End]
    RetryLater --> End
    Maintain --> End
    
    style Discover fill:#e1f5fe,color:#000000
    style IsolationOverride fill:#fff3e0,color:#000000
    style EvictFarthest fill:#ffebee,color:#000000
    style Maintain fill:#e8f5e8,color:#000000
```

### Smart Eviction Strategy

```mermaid
flowchart TD
    NewPeer[Incoming Connection Request] --> AtCapacity{At maximum peer capacity?}
    
    AtCapacity -->|No| Accept[Accept Connection]
    AtCapacity -->|Yes| CalcDistance["Calculate XOR distance<br/>from our peer ID"]
    
    CalcDistance --> FindFarthest["Find currently farthest<br/>connected peer"]
    FindFarthest --> Compare["New peer closer<br/>than farthest peer?"]
    
    Compare -->|No| Reject["Reject connection<br/>not worth evicting for"]
    Compare -->|Yes| SendEviction["Send eviction notice<br/>to farthest peer"]
    
    SendEviction --> DisconnectFarthest[Disconnect farthest peer]
    DisconnectFarthest --> AcceptNew[Accept new peer connection]
    
    AcceptNew --> OptimalTopology["Maintain optimal<br/>mesh topology"]
    
    Accept --> End[Connection Complete]
    Reject --> End
    OptimalTopology --> End
    
    style NewPeer fill:#e1f5fe,color:#000000
    style SendEviction fill:#fff3e0,color:#000000
    style DisconnectFarthest fill:#ffebee,color:#000000
    style AcceptNew fill:#e8f5e8,color:#000000
```

## � API Reference

### PeerPigeonServer Class

When importing the server class, you can create and configure it programmatically:

```javascript
import { PeerPigeonServer } from 'peerpigeon';

const server = new PeerPigeonServer(options);
```

#### Constructor Options

- **`port`** (number) - Server port (default: 3000)
- **`host`** (string) - Server host (default: 'localhost')
- **`maxConnections`** (number) - Maximum concurrent connections (default: 1000)
- **`cleanupInterval`** (number) - Cleanup interval in ms (default: 60000)
- **`peerTimeout`** (number) - Peer timeout in ms (default: 300000)
- **`corsOrigin`** (string) - CORS origin (default: '*')
- **`maxMessageSize`** (number) - Max message size in bytes (default: 1MB)

#### Methods

- **`await server.start()`** - Start the server
- **`await server.stop()`** - Stop the server
- **`server.getStats()`** - Get server statistics
- **`server.getPeers()`** - Get list of connected peers

#### Events

- **`started`** - Server started
- **`stopped`** - Server stopped
- **`peerConnected`** - Peer connected
- **`peerDisconnected`** - Peer disconnected
- **`peerAnnounced`** - Peer announced
- **`peerGoodbye`** - Peer said goodbye
- **`error`** - Server error

#### Example: Custom Server Configuration

```javascript
import { PeerPigeonServer } from 'peerpigeon';

const server = new PeerPigeonServer({
    port: 8080,
    maxConnections: 500,
    cleanupInterval: 30000
});

server.on('peerConnected', ({ peerId, totalConnections }) => {
    console.log(`New peer: ${peerId}, Total: ${totalConnections}`);
});

await server.start();
```

### Client Library Exports

```javascript
import { PeerPigeonMesh, PeerPigeonServer } from 'peerpigeon';
```

- **`PeerPigeonMesh`** - Main mesh networking class (browser)
- **`PeerPigeonServer`** - WebSocket signaling server class (Node.js)
- **`PeerConnection`** - WebRTC peer connection wrapper
- **`SignalingClient`** - WebSocket signaling client
- **`WebDHT`** - Distributed hash table implementation

## �📚 Core Components

### PeerPigeonMesh
Central coordinator that manages all mesh networking functionality and orchestrates the component interactions.

```javascript
const mesh = new PeerPigeonMesh();
await mesh.init();
await mesh.connect('wss://your-signaling-server.com');

// Send message to entire network via gossip protocol
const messageId = mesh.sendMessage('Hello mesh network!');

// Get network status
const status = mesh.getStatus();
console.log(`Connected to ${status.connectedCount}/${status.maxPeers} peers`);

// Configure mesh behavior
mesh.setMaxPeers(10);
mesh.setAutoDiscovery(true);
mesh.setEvictionStrategy(true);
```

### PeerDiscovery
Manages peer discovery and implements smart connection logic with isolation prevention.

**Key Features:**
- **Lexicographic connection rule** prevents connection race conditions
- **Isolation override** ensures peers with no connections can still connect
- **XOR distance sorting** prioritizes closer peers for optimal topology
- **Connection attempt tracking** prevents duplicate connection attempts

```javascript
// Example of isolation override logic
if (currentConnectionCount === 0 && discoveredPeers.length > 0) {
    // Override lexicographic rule to prevent isolation
    // Priority: natural initiators > closest peer by XOR distance
}
```

### ConnectionManager
Manages WebRTC peer connections, handles signaling, and routes messages to appropriate handlers.

**Responsibilities:**
- WebRTC connection establishment and management
- Message routing to GossipManager and EvictionManager
- Connection state tracking and cleanup
- Retry logic with exponential backoff
- Race condition prevention

### GossipManager
Implements gossip protocol for reliable message propagation across the entire mesh network.

**Protocol Features:**
- **TTL (Time To Live)**: Messages expire after 10 hops to prevent infinite loops
- **Seen message tracking**: Prevents duplicate message processing
- **Path tracking**: Detects and prevents routing loops
- **Broadcast guarantee**: Messages reach all peers, not just direct connections

```javascript
// Gossip message structure
{
    id: 'unique-message-id',
    type: 'gossip',
    subtype: 'chat',
    content: 'Hello network!',
    from: 'sender-peer-id',
    timestamp: Date.now(),
    ttl: 10,
    path: ['sender-peer-id', 'relay-peer-id', ...]
}
```

### EvictionManager
Implements smart peer eviction for optimal mesh topology using XOR distance calculations.

**Eviction Strategy:**
- Only evicts when at maximum peer capacity
- Calculates XOR distances to determine peer relationships
- Evicts farthest peer when a closer one wants to connect
- Sends eviction notices before disconnecting peers
- No cooldown periods - focuses purely on topology optimization

### MeshOptimizer
Handles periodic mesh optimization and provides debugging utilities.

**Optimization Features:**
- Periodic connectivity analysis
- Force connection to all discovered peers (for testing)
- Mesh topology evaluation and recommendations

## ⚙️ Configuration & API

The PeerPigeonMesh API provides methods for configuration, network management, messaging, and debugging. It is designed to be intuitive and event-driven.

### Initialization & Connection
Methods to initialize the mesh and manage the connection to the signaling server.

```javascript
// Initialize the mesh with a new, cryptographically secure peer ID.
// This must be called before any other method.
await mesh.init();

// Connect to the signaling server to join the mesh network.
await mesh.connect(signalingUrl);

// Disconnect from the signaling server and all connected peers.
mesh.disconnect();
```

### Configuration
Configure the behavior of the mesh network. These setters can be called at any time.

```javascript
// Set the maximum number of concurrent peer connections.
// Default: 3, Min: 1, Max: 50
mesh.setMaxPeers(10);

// Set the minimum number of connections to maintain for network health.
// Default: 2, Min: 0, Max: 49
mesh.setMinPeers(2);

// Enable or disable automatic connection to newly discovered peers.
// Default: true
mesh.setAutoDiscovery(true);

// Enable or disable the smart eviction strategy to optimize topology.
// Default: true
mesh.setEvictionStrategy(true);

// Enable or disable XOR distance-based routing for peer selection.
// Default: true
mesh.setXorRouting(true);

// Enable or disable the WebDHT (Distributed Hash Table) functionality.
// When disabled, all DHT methods will throw errors with helpful messages.
// Default: true (enabled)
// Can only be set during initialization in constructor options
const mesh = new PeerPigeonMesh({ enableWebDHT: false }); // Disable DHT

// Set the signaling connection type. Currently only 'websocket' is supported.
// Default: 'websocket'
mesh.setConnectionType('websocket');
```

### Network & Peer Information
Retrieve information about the network state and connected peers.

```javascript
// Get a comprehensive status object with the current state of the mesh.
// See "Status Object Structure" below for details.
const status = mesh.getStatus();

// Get the number of currently connected peers.
const count = mesh.getConnectedPeerCount();

// Get an array of peer IDs for all connected peers.
const peers = mesh.getPeers();

// Get an array of peer IDs for all discovered but not-yet-connected peers.
const discovered = mesh.getDiscoveredPeers();

// Check if the mesh can accept new incoming connections (i.e., not at maxPeers).
const canAccept = mesh.canAcceptMorePeers();

// Check if a peer is currently connected.
const isConnected = mesh.hasPeer(peerId);
```

### Messaging
Send messages to other peers in the network.

```javascript
// Broadcast a message to the entire mesh network using the gossip protocol.
// Returns a unique ID for the message.
const messageId = mesh.sendMessage(content);
```

### Manual Peer Management
Manually control connections to specific peers.
```

### Event System

```javascript
// === Connection Events ===
mesh.addEventListener('peerConnected', (event) => {
    console.log(`✅ Peer connected: ${event.peerId.substring(0, 8)}...`);
});

mesh.addEventListener('peerDisconnected', (event) => {
    console.log(`❌ Peer disconnected: ${event.peerId.substring(0, 8)}... (${event.reason})`);
});

mesh.addEventListener('peerDiscovered', (event) => {
    console.log(`🔍 Peer discovered: ${event.peerId.substring(0, 8)}...`);
});

// === Messaging Events ===
mesh.addEventListener('messageReceived', (event) => {
    console.log(`💬 Message from ${event.from.substring(0, 8)}...: "${event.content}"`);
    console.log(`   Direct: ${event.direct}, Hops: ${event.hops || 0}`);
});

// === Network Events ===
mesh.addEventListener('peerEvicted', (event) => {
    console.log(`🔄 Peer evicted: ${event.peerId.substring(0, 8)}... (${event.reason})`);
});

mesh.addEventListener('statusChanged', (event) => {
    console.log(`📊 Status: ${event.type} - ${event.message}`);
});

mesh.addEventListener('peersUpdated', () => {
    console.log(`📈 Peer list updated - Connected: ${mesh.getConnectedPeerCount()}`);
});
```

### Status Object Structure

```javascript
const status = mesh.getStatus();
// Returns:
{
    peerId: "abc123...",              // Our peer ID
    connected: true,                  // Connected to signaling server
    connectedCount: 3,                // Number of connected peers
    discoveredCount: 5,               // Number of discovered peers
    maxPeers: 10,                     // Maximum peer limit
    minPeers: 2,                      // Minimum peer target
    autoDiscovery: true,              // Auto-discovery enabled
    evictionStrategy: true,           // Smart eviction enabled
    xorRouting: true,                 // XOR-based routing enabled
    connectionType: "websocket",      // Current signaling method
    signalingUrl: "wss://...",        // Signaling server URL
    uptime: 120000                    // Milliseconds since connection
}
```

## 🌐 Network Topology & XOR Routing

### XOR Distance Calculation

PeerPigeon uses XOR distance (inspired by Kademlia DHT) to determine peer relationships:

```javascript
// Example XOR distance calculation
function calculateXorDistance(peerId1, peerId2) {
    let distance = 0n;
    for (let i = 0; i < Math.min(peerId1.length, peerId2.length); i += 2) {
        const byte1 = parseInt(peerId1.substr(i, 2), 16);
        const byte2 = parseInt(peerId2.substr(i, 2), 16);
        const xor = byte1 ^ byte2;
        distance = (distance << 8n) | BigInt(xor);
    }
    return distance;
}

// Peer A: 0x1234abcd...
// Peer B: 0x1345cdef...
// XOR:    0x0071661e... (smaller = closer)
```

### Topology Example

```mermaid
graph TB
    subgraph MeshNetwork[Mesh Network with XOR Distance Optimization]
        A[Peer A: 0x1234...]
        B[Peer B: 0x1345...]  
        C[Peer C: 0x5678...]
        D[Peer D: 0x9ABC...]
        E[Peer E: 0x9BCD...]
    end
    
    A -->|Direct connection XOR small| B
    A -->|Direct connection XOR medium| C
    A -.->|Would connect if capacity| D
    
    B -->|Direct connection XOR small| A
    B -->|Direct connection XOR large| C
    
    C -->|Direct connection XOR medium| A
    C -->|Direct connection XOR large| B
    C -.->|Would evict B for| D
    
    D -.->|Very close XOR distance| E
    D -->|Would connect to| C
    
    E -.->|Very close XOR distance| D
    E -->|Would evict distant peer to connect to D| D
    
    style A fill:#e1f5fe,color:#000000
    style B fill:#e8f5e8,color:#000000
    style C fill:#fff3e0,color:#000000
    style D fill:#fce4ec,color:#000000
    style E fill:#f3e5f5,color:#000000
```

### XOR Distance Benefits

1. **Optimal Peer Selection**: Peers with smaller XOR distances are preferred for connections
2. **Efficient Message Routing**: Gossip protocol naturally routes through relevant connections  
3. **Scalable Discovery**: New peers only notify the closest existing peers, reducing overhead
4. **Network Resilience**: Multiple paths through the mesh ensure message delivery
5. **Cost Optimization**: Reduces signaling server load by ~95% through smart peer targeting

### Isolation Prevention

The isolation prevention mechanism ensures network connectivity:

```javascript
// Isolation override logic in PeerDiscovery
if (currentConnectionCount === 0 && discoveredPeers.length > 0) {
    // Step 1: Try to connect to peers where we're the natural initiator
    const naturalInitiators = discoveredPeers.filter(peerId => this.peerId > peerId);
    
    if (naturalInitiators.length > 0) {
        // Connect to natural targets first
        return naturalInitiators.includes(targetPeerId);
    }
    
    // Step 2: If no natural targets, connect to closest peer by XOR distance
    const sortedByDistance = discoveredPeers.sort((a, b) => {
        const distA = calculateXorDistance(this.peerId, a);
        const distB = calculateXorDistance(this.peerId, b);
        return distA < distB ? -1 : 1;
    });
    
    return sortedByDistance[0] === targetPeerId;
}
```

## 🔗 WebSocket Signaling

PeerPigeon uses WebSocket signaling for real-time, bidirectional communication:

### WebSocket Signaling - Real-time Communication
- **Real-time delivery**: Instant bidirectional message delivery 
- **Cost-efficient**: Persistent connections reduce connection overhead
- **Modern browsers**: Chrome, Firefox, Safari, Edge with full support
- **Use case**: Production applications requiring real-time performance

```javascript
// WebSocket signaling is used by default
const mesh = new PeerPigeonMesh();
await mesh.connect('wss://your-websocket-server.com');

// WebSocket connection automatically handles:
// - Real-time peer discovery notifications
// - WebRTC signaling message delivery
// - Bidirectional communication
// - Connection state management
```

### WebSocket Protocol Messages

The WebSocket signaling supports these message types:

| Message Type | Purpose | Data Structure |
|--------------|---------|----------------|
| `announce` | Peer joins network | `{peerId, timestamp}` |
| `goodbye` | Peer leaves network | `{peerId, timestamp}` |
| `offer` | WebRTC connection offer | `{type: 'offer', data: RTCSessionDescription, targetPeerId}` |
| `answer` | WebRTC connection answer | `{type: 'answer', data: RTCSessionDescription, targetPeerId}` |
| `ice-candidate` | ICE candidate exchange | `{type: 'ice-candidate', data: RTCIceCandidate, targetPeerId}` |
| `cleanup` | Remove processed messages | `{type: 'cleanup', reason}` |

## 🚀 Deployment Options

### Option 1: Custom Signaling Server

Implement your own signaling server with these required endpoints:

```typescript
// Required endpoints for custom signaling server

// WebSocket connection endpoint
wss://your-server.com/signaling?peerId={peerId}

// WebSocket message format for all signaling messages:
{
    "type": "offer|answer|ice-candidate|announce|goodbye|ping",
    "data": "message-specific-data",
    "fromPeerId": "sender-peer-id",
    "targetPeerId": "recipient-peer-id", // optional for broadcasts
    "timestamp": 1234567890
}
```

### Option 2: Development/Testing Setup

For local development and testing:

```bash
For local development and testing:

```bash
# Serve with npm (preferred)
npm run dev

# Or with Node.js http-server
npm install -g http-server
http-server -p 8080
```

# Use query parameters to pre-configure signaling
open "http://localhost:8080/examples/browser/?api=wss://your-signaling-server.com/dev"
```

**Development Features:**
- Browser debugging tools integration
- Console logging with peer ID prefixes
- Global mesh access via `window.peerPigeonMesh`
- Force connection utilities for testing
- Real-time peer discovery and connection monitoring

## 🌐 Browser Compatibility & Requirements

### Required Browser Features
- **WebRTC**: RTCPeerConnection and RTCDataChannel support
- **ES6 Modules**: Dynamic imports and module syntax  
- **Crypto API**: For cryptographically secure peer ID generation
- **WebSocket API**: For real-time signaling communication

### Supported Browsers & Versions

| Browser | Minimum Version | WebRTC Support | WebSocket Support | Status |
|---------|----------------|----------------|-------------------|---------|
| **Chrome** | 80+ | ✅ Full | ✅ Yes | **Recommended** |
| **Firefox** | 75+ | ✅ Full | ✅ Yes | **Recommended** |
| **Safari** | 14+ | ✅ Full | ✅ Yes | **Supported** |
| **Edge** | 80+ | ✅ Full | ✅ Yes | **Supported** |
| **Mobile Chrome** | 80+ | ✅ Full | ✅ Yes | **Supported** |
| **Mobile Safari** | 14+ | ✅ Full | ✅ Yes | **Supported** |

### Feature Detection

PeerPigeon automatically detects browser capabilities:

```javascript
// Automatic capability detection
const mesh = new PeerPigeonMesh();
await mesh.init(); // Detects WebRTC, WebSocket support

// Check detected capabilities
const status = mesh.getStatus();
console.log('Connection type:', status.connectionType); // 'websocket'
console.log('WebRTC support:', mesh.hasWebRTCSupport());
console.log('WebSocket support:', mesh.hasWebSocketSupport());
```

## ⚡ Performance & Scalability

### Network Efficiency
- **Gossip TTL**: Messages expire after 10 hops to prevent network flooding
- **XOR Routing**: Only relevant peers receive discovery notifications (~95% reduction)
- **Connection Limits**: Configurable peer limits prevent resource exhaustion
- **Smart Eviction**: Maintains optimal topology without unnecessary reconnections

### Performance Metrics
Based on testing with browser networks:

| Network Size | Avg Connection Time | Message Delivery | Memory Usage |
|--------------|-------------------|------------------|--------------|
| 2-5 peers | < 2 seconds | 100% success | ~5MB per peer |
| 6-10 peers | 2-4 seconds | 99.8% success | ~8MB per peer |
| 11-15 peers | 3-6 seconds | 99.5% success | ~12MB per peer |

### Best Practices for Performance

1. **Optimal Peer Limits**
   ```javascript
   // For most applications
   mesh.setMaxPeers(8);  // Sweet spot for connectivity vs resources
   mesh.setMinPeers(3);  // Ensures network resilience
   ```

2. **Enable All Optimizations**
   ```javascript
   mesh.setEvictionStrategy(true);  // Maintains optimal topology
   mesh.setXorRouting(true);        // Reduces signaling overhead
   mesh.setAutoDiscovery(true);     // Handles connections automatically
   ```

3. **Monitor Connection Health**
   ```javascript
   mesh.addEventListener('statusChanged', (event) => {
       if (event.type === 'warning') {
           console.warn('Network issue:', event.message);
           // Implement reconnection logic
       }
   });
   ```

## 🔒 Security Considerations

### Built-in Security Features
- **Peer ID Generation**: Uses `crypto.getRandomValues()` for cryptographically secure peer IDs
- **WebRTC Encryption**: Built-in DTLS encryption for all peer-to-peer communication
- **Input Validation**: All peer IDs and messages are validated before processing
- **Message Limits**: TTL and size limits prevent abuse and resource exhaustion

### Deployment Security

#### Signaling Server Security
```bash
# Always use HTTPS/WSS for signaling endpoints
https://your-signaling-server.com/signaling  # ✅ Secure
http://your-signaling-server.com/signaling   # ❌ Insecure

# Implement rate limiting
POST /signaling
X-Rate-Limit: 100 requests per minute per IP
```

### Security Best Practices

1. **Validate All Inputs**
   ```javascript
   // PeerPigeon automatically validates:
   // - Peer ID format (hexadecimal, correct length)
   // - Message content (type, size limits)
   // - WebRTC message structure
   ```

2. **Implement Application-Level Security**
   ```javascript
   // Add your own message authentication
   mesh.addEventListener('messageReceived', (event) => {
       if (!validateMessageSignature(event.content, event.from)) {
           console.warn('Ignoring message with invalid signature');
           return;
       }
       // Process trusted message
   });
   ```

3. **Monitor for Abuse**
   ```javascript
   // Track message frequency per peer
   const messageRates = new Map();
   mesh.addEventListener('messageReceived', (event) => {
       const rate = trackMessageRate(event.from);
       if (rate > MAX_MESSAGES_PER_MINUTE) {
           mesh.disconnectPeer(event.from, 'rate limit exceeded');
       }
   });
   ```

## 🛠️ Development & Debugging

### Running Tests

```bash
# Install development dependencies
npm install

# Start local development server
npm run dev
# or
npx http-server -p 8080

# Open multiple browser tabs for testing
open http://localhost:8080/examples/browser/
open http://localhost:8080/examples/browser/
open http://localhost:8080/examples/browser/
```

### Debugging Tools

#### Built-in Debugging
```javascript
// Global mesh access in browser
window.peerPigeonMesh.getStatus();           // Network status
window.peerPigeonMesh.getPeers();            // Connected peers
window.peerPigeonMesh.getDiscoveredPeers();  // Discovered peers
window.peerPigeonMesh.debugConnectivity();   // Detailed connectivity info

// Force connections for testing
window.peerPigeonMesh.forceConnectToAllPeers();

// Component access
window.peerPigeonSignaling;    // SignalingClient instance
window.getPeerPigeonState();   // Complete application state
```

#### Browser Developer Tools
1. **Console Logs**: Detailed connection and message flow with peer ID prefixes
2. **Network Tab**: Monitor signaling server communication patterns
3. **WebRTC Internals**: Chrome's `chrome://webrtc-internals/` for connection debugging
4. **Application Tab**: LocalStorage inspection for persistent state

#### Debugging Common Issues

**Connection Problems:**
```javascript
// Check connection prerequisites
console.log('Signaling connected:', mesh.getStatus().connected);
console.log('Discovered peers:', mesh.getDiscoveredPeers().length);
console.log('Connection attempts:', mesh.getConnectionAttempts());

// Force retry connections
mesh.getDiscoveredPeers().forEach(peer => {
    if (!mesh.hasPeer(peer.peerId)) {
        mesh.connectToPeer(peer.peerId);
    }
});
```

**Message Delivery Issues:**
```javascript
// Check gossip protocol state
mesh.addEventListener('messageReceived', (event) => {
    console.log('Message path:', event.path);
    console.log('TTL remaining:', event.ttl);
    console.log('Seen messages:', mesh.gossipManager.seenMessages.size);
});
```

### Testing Scenarios

#### Multi-Tab Testing
```bash
# Open 3-5 browser tabs
for i in {1..5}; do
    open "http://localhost:8080/examples/browser/?debug=true&tab=$i"
done
```

#### Network Partition Testing
```javascript
// Simulate network partition
mesh.disconnectPeer(specificPeerId, 'testing partition');

// Wait and observe reconnection behavior
setTimeout(() => {
    console.log('Network recovered, connections:', mesh.getConnectedPeerCount());
}, 10000);
```

#### Load Testing
```javascript
// Send messages rapidly to test gossip protocol
setInterval(() => {
    mesh.sendMessage(`Load test message ${Date.now()}`);
}, 1000);
```

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Development Setup
```bash
# Fork and clone the repository
git clone https://github.com/your-username/pigon.git
cd pigon

# Create a feature branch
git checkout -b feature/amazing-improvement

# Make your changes and test thoroughly
npm run dev
# Test with multiple browser instances

# Commit with descriptive messages
git commit -m "Add isolation prevention to peer discovery

- Implements lexicographic override when peer has no connections
- Prioritizes natural initiators over XOR distance
- Prevents permanent isolation in small networks
- Adds comprehensive logging for debugging"

# Push and create pull request
git push origin feature/amazing-improvement
```

### Contribution Guidelines

1. **Test with Multiple Peers**: Always test changes with 3-5 browser instances
2. **Maintain Backward Compatibility**: Don't break existing API contracts
3. **Add Comprehensive Logging**: Use consistent peer ID prefixes in logs
4. **Update Documentation**: Include code examples and explanations
5. **Follow Code Style**: Use consistent formatting and naming conventions

### Areas for Contribution
- **Performance Optimization**: Improve connection speed and memory usage
- **Security Enhancements**: Add message authentication and rate limiting
- **Testing Framework**: Automated testing for mesh network scenarios
- **Mobile Optimization**: Improve performance on mobile browsers
- **Documentation**: Examples, tutorials, and API improvements

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Kademlia DHT**: Inspired the XOR distance routing algorithm ([Paper](https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf))
- **WebRTC Community**: For providing the foundation of peer-to-peer communication
- **Gossip Protocols**: Epidemic algorithms research for reliable message propagation
- **Open Source Community**: For feedback, testing, and continuous improvement

---

**Quick Links:**
- [Live Demo](http://localhost:8080/examples/browser/) (after starting local server)
- [API Documentation](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)  
- [GitHub Issues](https://github.com/danrayadev/pigon/issues)
- [Contributing Guidelines](CONTRIBUTING.md)
