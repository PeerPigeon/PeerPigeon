# PeerPigeon API Documentation

## Table of Contents

1. [PeerPigeonMesh](#peerpigeonmesh)
2. [Constructor Options](#constructor-options)
3. [Core Methods](#core-methods)
4. [Messaging](#messaging)
5. [WebDHT (Distributed Hash Table)](#webdht-distributed-hash-table)
6. [Media Streaming](#media-streaming)
7. [Configuration](#configuration)
8. [Status and Monitoring](#status-and-monitoring)
9. [Events](#events)
10. [Static Methods](#static-methods)
11. [Error Handling](#error-handling)

## PeerPigeonMesh

The main class that provides peer-to-peer mesh networking with WebRTC, gossip protocol messaging, and distributed hash table functionality.

### Constructor Options

```javascript
const mesh = new PeerPigeonMesh(options);
```

**Parameters:**
- `options` (object, optional): Configuration options
  - `peerId` (string, optional): Pre-generated 40-character hex peer ID
  - `enableWebDHT` (boolean, optional): Enable distributed hash table (default: true)

**Examples:**
```javascript
// Basic mesh with auto-generated peer ID
const mesh = new PeerPigeonMesh();

// Mesh with custom peer ID
const mesh = new PeerPigeonMesh({ 
    peerId: 'a1b2c3d4e5f6789012345678901234567890abcd' 
});

// Mesh with WebDHT disabled
const mesh = new PeerPigeonMesh({ enableWebDHT: false });
```

### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `peerId` | `string` | `null` | 40-character hex peer identifier |
| `connected` | `boolean` | `false` | Connected to signaling server |
| `maxPeers` | `number` | `3` | Maximum concurrent peer connections |
| `minPeers` | `number` | `2` | Minimum connections to maintain |
| `autoDiscovery` | `boolean` | `true` | Enable automatic peer discovery |
| `evictionStrategy` | `boolean` | `true` | Enable smart peer eviction |
| `xorRouting` | `boolean` | `true` | Enable XOR-based routing optimization |
| `enableWebDHT` | `boolean` | `true` | Enable distributed hash table |

## Core Methods

### `async init()`

Initializes the mesh and generates a unique peer ID if not provided.

```javascript
await mesh.init();
console.log('Mesh initialized with peer ID:', mesh.peerId);
```

**Returns:** `Promise<void>`  
**Throws:** `Error` if initialization fails

---

### `async connect(signalingUrl)`

Connects to the signaling server and announces presence to the network.

```javascript
await mesh.connect('wss://api.example.com/websocket');
```

**Parameters:**
- `signalingUrl` (string): WebSocket URL (ws:// or wss://)

**Returns:** `Promise<void>`  
**Throws:** `Error` if connection fails

---

### `disconnect()`

Disconnects from the signaling server and closes all peer connections.

```javascript
mesh.disconnect();
```

**Returns:** `void`

---

### `connectToPeer(peerId)`

Attempts to connect to a specific peer by ID.

```javascript
mesh.connectToPeer('target-peer-id');
```

**Parameters:**
- `peerId` (string): Target peer's 40-character hex ID

**Returns:** `void`  
**Throws:** `Error` if peer ID is invalid or is own peer ID

## Messaging

### `sendMessage(content)`

Sends a broadcast message to all peers using gossip protocol.

```javascript
const messageId = mesh.sendMessage('Hello, mesh network!');
const objectMessage = mesh.sendMessage({ type: 'update', data: { count: 42 } });
```

**Parameters:**
- `content` (string|object): Message content

**Returns:** `string|null` - Message ID if sent successfully, null on error

---

### `sendDirectMessage(targetPeerId, content)`

Sends a direct message to a specific peer.

```javascript
const messageId = mesh.sendDirectMessage('target-peer-id', 'Private message');
```

**Parameters:**
- `targetPeerId` (string): Destination peer's ID
- `content` (string|object): Message content

**Returns:** `string|null` - Message ID if sent successfully, null on error

## WebDHT (Distributed Hash Table)

### `async dhtPut(key, value, options)`

Stores a key-value pair in the distributed hash table.

```javascript
await mesh.dhtPut('user-settings', { theme: 'dark' });
await mesh.dhtPut('temp-data', 'value', { ttl: 300000 }); // 5 minutes TTL
```

**Parameters:**
- `key` (string): Storage key
- `value` (any): Value to store
- `options` (object, optional): Storage options
  - `ttl` (number): Time-to-live in milliseconds

**Returns:** `Promise<boolean>` - True if stored successfully  
**Throws:** `Error` if WebDHT is disabled or not initialized

---

### `async dhtGet(key, options)`

Retrieves a value from the distributed hash table.

```javascript
const value = await mesh.dhtGet('user-settings');
const withSubscribe = await mesh.dhtGet('live-data', { subscribe: true });
```

**Parameters:**
- `key` (string): Key to retrieve
- `options` (object, optional): Retrieval options
  - `subscribe` (boolean): Subscribe to future changes

**Returns:** `Promise<any>` - Stored value or null if not found  
**Throws:** `Error` if WebDHT is disabled or not initialized

---

### `async dhtSubscribe(key)`

Subscribes to changes for a key in the DHT.

```javascript
const currentValue = await mesh.dhtSubscribe('shared-counter');
```

**Parameters:**
- `key` (string): Key to subscribe to

**Returns:** `Promise<any>` - Current value  
**Throws:** `Error` if WebDHT is disabled or not initialized

---

### `async dhtUnsubscribe(key)`

Unsubscribes from changes for a key in the DHT.

```javascript
await mesh.dhtUnsubscribe('shared-counter');
```

**Parameters:**
- `key` (string): Key to unsubscribe from

**Returns:** `Promise<void>`  
**Throws:** `Error` if WebDHT is disabled or not initialized

---

### `async dhtUpdate(key, newValue, options)`

Updates a key's value and notifies subscribers.

```javascript
await mesh.dhtUpdate('shared-counter', 42);
```

**Parameters:**
- `key` (string): Key to update
- `newValue` (any): New value
- `options` (object, optional): Update options

**Returns:** `Promise<boolean>` - True if updated successfully  
**Throws:** `Error` if WebDHT is disabled or not initialized

---

### `getDHTStats()`

Returns DHT statistics.

```javascript
const stats = mesh.getDHTStats();
console.log('Stored keys:', stats.storedKeys);
console.log('Active subscriptions:', stats.activeSubscriptions);
```

**Returns:** `object` - DHT statistics or error object

---

### `isDHTEnabled()`

Checks if WebDHT is enabled.

```javascript
if (mesh.isDHTEnabled()) {
    await mesh.dhtPut('key', 'value');
}
```

**Returns:** `boolean` - True if WebDHT is enabled

## Media Streaming

### `async initializeMedia()`

Initializes media subsystem.

```javascript
await mesh.initializeMedia();
```

**Returns:** `Promise<void>`

---

### `async startMedia(options)`

Starts local media stream and shares with connected peers.

```javascript
const stream = await mesh.startMedia({ video: true, audio: true });
const videoOnly = await mesh.startMedia({ video: true, audio: false });
```

**Parameters:**
- `options` (object): Media options
  - `video` (boolean): Enable video
  - `audio` (boolean): Enable audio
  - `deviceIds` (object): Specific device IDs

**Returns:** `Promise<MediaStream>` - Local media stream

---

### `async stopMedia()`

Stops the local media stream.

```javascript
await mesh.stopMedia();
```

**Returns:** `Promise<void>`

---

### `toggleVideo()`

Toggles video on/off.

```javascript
const isEnabled = mesh.toggleVideo();
```

**Returns:** `boolean` - New video state

---

### `toggleAudio()`

Toggles audio on/off.

```javascript
const isEnabled = mesh.toggleAudio();
```

**Returns:** `boolean` - New audio state

---

### `getMediaState()`

Gets current media state.

```javascript
const state = mesh.getMediaState();
console.log('Video enabled:', state.video);
console.log('Audio enabled:', state.audio);
```

**Returns:** `object` - Media state object

---

### `async enumerateMediaDevices()`

Lists available media devices.

```javascript
const devices = await mesh.enumerateMediaDevices();
console.log('Cameras:', devices.cameras);
console.log('Microphones:', devices.microphones);
```

**Returns:** `Promise<object>` - Available devices

---

### `getLocalStream()`

Gets the current local media stream.

```javascript
const stream = mesh.getLocalStream();
if (stream) {
    videoElement.srcObject = stream;
}
```

**Returns:** `MediaStream|null` - Local stream or null

---

### `getRemoteStreams()`

Gets remote streams from all connected peers.

```javascript
const remoteStreams = mesh.getRemoteStreams();
remoteStreams.forEach((stream, peerId) => {
    console.log(`Stream from ${peerId}:`, stream);
});
```

**Returns:** `Map<string, MediaStream>` - Map of peer IDs to streams

## Configuration

### `setMaxPeers(maxPeers)`

Sets maximum number of peer connections.

```javascript
mesh.setMaxPeers(5);
```

**Parameters:**
- `maxPeers` (number): Maximum peers (1-50)

**Returns:** `number` - Actual max peers set

---

### `setMinPeers(minPeers)`

Sets minimum number of peer connections.

```javascript
mesh.setMinPeers(2);
```

**Parameters:**
- `minPeers` (number): Minimum peers

**Returns:** `number` - Actual min peers set

---

### `setXorRouting(enabled)`

Enables or disables XOR-based routing optimization.

```javascript
mesh.setXorRouting(true);
```

**Parameters:**
- `enabled` (boolean): Enable XOR routing

**Returns:** `void`

---

### `setAutoDiscovery(enabled)`

Enables or disables automatic peer discovery.

```javascript
mesh.setAutoDiscovery(true);
```

**Parameters:**
- `enabled` (boolean): Enable auto-discovery

**Returns:** `void`

---

### `setEvictionStrategy(enabled)`

Enables or disables smart peer eviction.

```javascript
mesh.setEvictionStrategy(true);
```

**Parameters:**
- `enabled` (boolean): Enable eviction strategy

**Returns:** `void`

## Status and Monitoring

### `getStatus()`

Gets current mesh status.

```javascript
const status = mesh.getStatus();
console.log('Connected peers:', status.connectedCount);
console.log('Discovered peers:', status.discoveredCount);
console.log('Mesh settings:', {
    maxPeers: status.maxPeers,
    minPeers: status.minPeers,
    xorRouting: status.xorRouting
});
```

**Returns:** `object` - Status object with mesh state

---

### `getPeers()`

Gets list of connected peers.

```javascript
const peers = mesh.getPeers();
peers.forEach(peer => {
    console.log(`Peer ${peer.peerId}: ${peer.status}`);
});
```

**Returns:** `Array<object>` - Array of peer objects

---

### `getDiscoveredPeers()`

Gets list of discovered peers (connected and disconnected).

```javascript
const discovered = mesh.getDiscoveredPeers();
discovered.forEach(peer => {
    console.log(`Peer ${peer.peerId}: connected=${peer.isConnected}`);
});
```

**Returns:** `Array<object>` - Array of discovered peer objects

---

### `getConnectedPeerCount()`

Gets number of connected peers.

```javascript
const count = mesh.getConnectedPeerCount();
console.log(`Connected to ${count} peers`);
```

**Returns:** `number` - Count of connected peers

---

### `canAcceptMorePeers()`

Checks if mesh can accept more peer connections.

```javascript
if (mesh.canAcceptMorePeers()) {
    console.log('Ready for more connections');
}
```

**Returns:** `boolean` - True if can accept more peers

## Events

### Event Listeners

```javascript
mesh.addEventListener(eventName, callback);
```

### Connection Events

#### `connected`
Emitted when connected to signaling server.

```javascript
mesh.addEventListener('connected', () => {
    console.log('Connected to signaling server');
});
```

#### `disconnected`
Emitted when disconnected from signaling server.

```javascript
mesh.addEventListener('disconnected', () => {
    console.log('Disconnected from signaling server');
});
```

#### `peerConnected`
Emitted when a peer connects.

```javascript
mesh.addEventListener('peerConnected', (data) => {
    console.log(`Peer connected: ${data.peerId}`);
});
```

#### `peerDisconnected`
Emitted when a peer disconnects.

```javascript
mesh.addEventListener('peerDisconnected', (data) => {
    console.log(`Peer disconnected: ${data.peerId}, reason: ${data.reason}`);
});
```

#### `peerDiscovered`
Emitted when a new peer is discovered.

```javascript
mesh.addEventListener('peerDiscovered', (data) => {
    console.log(`New peer discovered: ${data.peerId}`);
});
```

#### `peerEvicted`
Emitted when a peer is evicted for optimization.

```javascript
mesh.addEventListener('peerEvicted', (data) => {
    console.log(`Peer evicted: ${data.fromPeerId}, reason: ${data.reason}`);
});
```

### Messaging Events

#### `messageReceived`
Emitted when a message is received.

```javascript
mesh.addEventListener('messageReceived', (data) => {
    console.log(`Message from ${data.from}: ${data.content}`);
    console.log(`Direct message: ${data.direct}`);
    console.log(`Message type: ${data.type}`);
});
```

### WebDHT Events

#### `dhtValueChanged`
Emitted when a subscribed DHT value changes.

```javascript
mesh.addEventListener('dhtValueChanged', (data) => {
    console.log(`DHT key ${data.key} changed to:`, data.newValue);
    console.log(`Timestamp: ${data.timestamp}`);
});
```

### Media Events

#### `localStreamStarted`
Emitted when local media stream starts.

```javascript
mesh.addEventListener('localStreamStarted', (data) => {
    console.log('Local stream started:', data.stream);
});
```

#### `localStreamStopped`
Emitted when local media stream stops.

```javascript
mesh.addEventListener('localStreamStopped', () => {
    console.log('Local stream stopped');
});
```

#### `remoteStream`
Emitted when a remote peer starts streaming.

```javascript
mesh.addEventListener('remoteStream', (data) => {
    console.log(`Remote stream from ${data.peerId}:`, data.stream);
});
```

#### `mediaError`
Emitted when a media error occurs.

```javascript
mesh.addEventListener('mediaError', (data) => {
    console.error('Media error:', data.error);
});
```

### Status Events

#### `statusChanged`
Emitted when mesh status changes.

```javascript
mesh.addEventListener('statusChanged', (data) => {
    console.log(`Status: ${data.type} - ${data.message}`);
    // data.type can be: 'info', 'warning', 'error', 'connecting', 'connected', 'disconnected'
});
```

#### `peersUpdated`
Emitted when peer list changes.

```javascript
mesh.addEventListener('peersUpdated', () => {
    console.log('Peer list updated');
    updateUI();
});
```

#### `connectionStats`
Emitted periodically with connection statistics.

```javascript
mesh.addEventListener('connectionStats', (stats) => {
    console.log('Connection stats:', stats);
});
```

## Static Methods

### `PeerPigeonMesh.validatePeerId(peerId)`

Validates a peer ID format.

```javascript
const isValid = PeerPigeonMesh.validatePeerId('a1b2c3d4e5f6789012345678901234567890abcd');
console.log('Valid peer ID:', isValid);
```

**Parameters:**
- `peerId` (string): Peer ID to validate

**Returns:** `boolean` - True if valid 40-character hex string

---

### `PeerPigeonMesh.generatePeerId()`

Generates a new random peer ID.

```javascript
const peerId = await PeerPigeonMesh.generatePeerId();
console.log('Generated peer ID:', peerId);
```

**Returns:** `Promise<string>` - 40-character hex peer ID

## Error Handling

### Common Error Scenarios

```javascript
try {
    await mesh.init();
    await mesh.connect('wss://signaling-server.com');
} catch (error) {
    console.error('Mesh initialization failed:', error.message);
}

// WebDHT errors
try {
    await mesh.dhtPut('key', 'value');
} catch (error) {
    if (error.message.includes('WebDHT is disabled')) {
        console.log('WebDHT is not enabled');
    }
}

// Media errors
mesh.addEventListener('mediaError', (data) => {
    console.error('Media error:', data.error.message);
    // Handle different error types
    if (data.error.name === 'NotAllowedError') {
        console.log('User denied media access');
    }
});
```

### Error Types

- **Connection Errors**: WebSocket connection failures
- **WebDHT Errors**: DHT operations when disabled/uninitialized
- **Media Errors**: Camera/microphone access issues
- **Validation Errors**: Invalid peer IDs or parameters
- **Network Errors**: Signaling server communication failures

## Advanced Usage

### Debugging Methods

```javascript
// Force cleanup of invalid peers
const cleanedCount = mesh.forceCleanupInvalidPeers();

// Get detailed peer state summary
const summary = mesh.getPeerStateSummary();

// Debug connectivity issues
mesh.debugConnectivity();

// Manual signaling data cleanup
await mesh.cleanupStaleSignalingData();
```

### Performance Monitoring

```javascript
// Monitor connection health
mesh.startConnectionMonitoring();

// Get detailed status
const status = mesh.getStatus();
console.log('Mesh performance:', {
    connectedPeers: status.connectedCount,
    discoveredPeers: status.discoveredCount,
    isOptimal: status.connectedCount >= status.minPeers
});
```

Manually initiate a connection to a specific peer.

```javascript
await mesh.connectToPeer('a1b2c3d4e5f6789012345678901234567890abcd');
```

**Parameters:**
- `targetPeerId` (string): 40-character SHA-1 hash of target peer

**Returns:** `Promise<void>`

**Notes:** 
- Only initiates if this peer should be the initiator (lexicographic comparison)
- Respects maxPeers limit and eviction strategy

---

#### `sendMessage(content)`

Broadcasts a message to all connected peers via the gossip protocol.

```javascript
const messageId = mesh.sendMessage('Hello mesh network!');
console.log('Message sent to network:', messageId);
```

**Parameters:**
- `content` (string): The message content to broadcast

**Returns:** `string` - Unique message ID for tracking

**Notes:** 
- Uses gossip protocol to reach all peers in the network
- Messages propagate with TTL=10 to prevent infinite loops
- Seen messages are tracked to prevent duplicate processing

---

#### `setMaxPeers(maxPeers)`

Sets the maximum number of concurrent peer connections.

```javascript
const actualMax = mesh.setMaxPeers(8);
console.log('Max peers set to:', actualMax);
```

**Parameters:**
- `maxPeers` (number): Maximum peer limit (1-50)

**Returns:** `number` - The actual value set (clamped to valid range)

---

#### `setMinPeers(minPeers)`

Sets the minimum number of connections to maintain.

```javascript
const actualMin = mesh.setMinPeers(2);
console.log('Min peers set to:', actualMin);
```

**Parameters:**
- `minPeers` (number): Minimum peer target (0-49)

**Returns:** `number` - The actual value set (clamped to valid range)

---

#### `setConnectionType(connectionType)`

Sets the signaling connection type (WebSocket-only implementation).

```javascript
mesh.setConnectionType('websocket'); // Default and only supported type
```

**Parameters:**
- `connectionType` (string): Connection type ('websocket' - others are ignored)

**Returns:** `string` - The connection type

**Notes:** 
- WebSocket-only implementation
- Other values are logged and ignored

```javascript
const sentCount = mesh.sendMessage('Hello, mesh network!');
console.log(`Message sent to ${sentCount} peers`);
```

**Parameters:**
- `content` (string): Message content to broadcast

**Returns:** `number` - Count of peers that received the message

---

#### `setMaxPeers(maxPeers)`

Sets the maximum number of concurrent peer connections.

```javascript
const actualMax = mesh.setMaxPeers(20);
console.log(`Max peers set to: ${actualMax}`);
```

**Parameters:**
- `maxPeers` (number): Maximum connections (1-50)

**Returns:** `number` - Actual max peers value (clamped to valid range)

**Side Effects:** Disconnects excess peers if current connections exceed new limit

---

#### `setAutoDiscovery(enabled)`

Enables or disables automatic peer discovery.

```javascript
mesh.setAutoDiscovery(false); // Disable auto-discovery
```

**Parameters:**
- `enabled` (boolean): Whether to enable auto-discovery

**Returns:** `void`

---

#### `setEvictionStrategy(enabled)`

Enables or disables the smart eviction strategy.

```javascript
mesh.setEvictionStrategy(true); // Enable smart eviction
```

**Parameters:**
- `enabled` (boolean): Whether to enable eviction strategy

**Returns:** `void`

---

#### `getStatus()`

Returns current mesh status and statistics.

```javascript
const status = mesh.getStatus();
console.log(status);
// {
//   peerId: "a1b2c3...",
//   connected: true,
//   polling: true,
//   connectedCount: 5,
//   maxPeers: 10,
//   discoveredCount: 8,
//   autoDiscovery: true,
//   evictionStrategy: true
// }
```

**Returns:** `Object` with status information

---

#### `getPeers()`

Returns information about all connected peers.

```javascript
const peers = mesh.getPeers();
peers.forEach(peer => {
    console.log(`${peer.peerId}: ${peer.status}`);
});
```

**Returns:** `Array<Object>` with peer information:
- `peerId` (string): Peer identifier
- `status` (string): Connection status ('ready', 'connected', 'connecting', etc.)
- `isInitiator` (boolean): Whether this peer initiated the connection
- `connectionStartTime` (number): Timestamp when connection started

---

#### `getDiscoveredPeers()`

Returns information about all discovered peers in the network.

```javascript
const discovered = mesh.getDiscoveredPeers();
discovered.forEach(peer => {
    console.log(`${peer.peerId}: distance ${peer.distance}`);
});
```

**Returns:** `Array<Object>` with discovered peer information:
- `peerId` (string): Peer identifier
- `timestamp` (number): When peer was last seen
- `distance` (BigInt): XOR distance from this peer
- `isConnected` (boolean): Whether currently connected
- `isConnecting` (boolean): Whether connection attempt in progress

---

#### `validatePeerId(peerId)`

Validates a peer ID format.

```javascript
const isValid = mesh.validatePeerId('a1b2c3d4e5f6789012345678901234567890abcd');
console.log(isValid); // true
```

**Parameters:**
- `peerId` (string): Peer ID to validate

**Returns:** `boolean` - Whether the peer ID is a valid 40-character hex string

---

#### `removeDiscoveredPeer(peerId)`

Removes a peer from the discovered peers list and disconnects if connected.

```javascript
mesh.removeDiscoveredPeer('a1b2c3d4e5f6789012345678901234567890abcd');
```

**Parameters:**
- `peerId` (string): Peer ID to remove

**Returns:** `void`

---

### Advanced Methods

#### `calculateXorDistance(peerId1, peerId2)`

Calculates XOR distance between two peer IDs.

```javascript
const distance = mesh.calculateXorDistance(mesh.peerId, targetPeerId);
console.log(`Distance: ${distance}`);
```

**Parameters:**
- `peerId1` (string): First peer ID
- `peerId2` (string): Second peer ID

**Returns:** `BigInt` - XOR distance between the peers

---

#### `async evictPeer(peerId, reason)`

Manually evict a connected peer.

```javascript
await mesh.evictPeer('a1b2c3d4...', 'manual eviction');
```

**Parameters:**
- `peerId` (string): Peer to evict
- `reason` (string): Reason for eviction

**Returns:** `Promise<void>`

---

## PeerPigeonUI

Browser interface for the mesh network.

### Constructor

```javascript
const ui = new PeerPigeonUI(mesh);
```

**Parameters:**
- `mesh` (PeerPigeonMesh): Mesh instance to control

### Methods

#### `updateUI()`

Refreshes the user interface with current mesh state.

```javascript
ui.updateUI();
```

**Returns:** `void`

---

#### `addMessage(sender, content, type)`

Adds a message to the UI message log.

```javascript
ui.addMessage('System', 'Connected to mesh', 'info');
ui.addMessage('a1b2c3...', 'Hello world!');
ui.addMessage('You', 'Response message', 'own');
```

**Parameters:**
- `sender` (string): Message sender identifier
- `content` (string): Message content
- `type` (string, optional): Message type ('info', 'error', 'warning', 'own')

**Returns:** `void`

---

#### `connectToPeer(peerId)`

UI wrapper for connecting to a peer.

```javascript
ui.connectToPeer('a1b2c3d4e5f6789012345678901234567890abcd');
```

**Parameters:**
- `peerId` (string): Target peer ID

**Returns:** `void`

---

#### `removeDiscoveredPeer(peerId)`

UI wrapper for removing a discovered peer.

```javascript
ui.removeDiscoveredPeer('a1b2c3d4e5f6789012345678901234567890abcd');
```

**Parameters:**
- `peerId` (string): Peer ID to remove

**Returns:** `void`

---

### Static Methods

#### `PeerPigeonMesh.validatePeerId(peerId)`

Static method to validate a peer ID format without creating a mesh instance.

```javascript
const isValid = PeerPigeonMesh.validatePeerId('a1b2c3d4e5f6789012345678901234567890abcd');
console.log(isValid); // true

// Use before creating mesh with custom peer ID
if (PeerPigeonMesh.validatePeerId(customPeerId)) {
    const mesh = new PeerPigeonMesh({ peerId: customPeerId });
}
```

**Parameters:**
- `peerId` (string): Peer ID to validate

**Returns:** `boolean` - Whether the peer ID is a valid 40-character SHA-1 hex string

---

#### `PeerPigeonMesh.generatePeerId()`

Static method to generate a new random peer ID.

```javascript
const newPeerId = await PeerPigeonMesh.generatePeerId();
console.log(newPeerId); // "a1b2c3d4e5f6789012345678901234567890abcd"

// Use for creating mesh with pre-generated ID
const mesh = new PeerPigeonMesh({ peerId: newPeerId });
```

**Returns:** `Promise<string>` - A new 40-character SHA-1 hex string

---

## Events

The mesh uses an event-driven architecture for loose coupling between components.

### Event Registration

```javascript
// Add event listener
mesh.addEventListener('eventName', (data) => {
    console.log('Event received:', data);
});

// Remove event listener
mesh.removeEventListener('eventName', callbackFunction);
```

### Available Events

#### `statusChanged`

Emitted when mesh connection status changes.

```javascript
mesh.addEventListener('statusChanged', (data) => {
    console.log(`Status: ${data.type}`, data.message);
});
```

**Event Data:**
- `type` (string): Status type ('connecting', 'connected', 'disconnected', 'error', 'info', 'warning')
- `message` (string, optional): Status message
- Additional type-specific properties

---

#### `peerDiscovered`

Emitted when a new peer announces itself to the network.

```javascript
mesh.addEventListener('peerDiscovered', (data) => {
    console.log(`Discovered peer: ${data.peerId}`);
});
```

**Event Data:**
- `peerId` (string): Discovered peer identifier

---

#### `peerConnected`

Emitted when a WebRTC connection is successfully established.

```javascript
mesh.addEventListener('peerConnected', (data) => {
    console.log(`Connected to: ${data.peerId}`);
});
```

**Event Data:**
- `peerId` (string): Connected peer identifier

---

#### `peerDisconnected`

Emitted when a peer connection is closed.

```javascript
mesh.addEventListener('peerDisconnected', (data) => {
    console.log(`${data.peerId} disconnected: ${data.reason}`);
});
```

**Event Data:**
- `peerId` (string): Disconnected peer identifier
- `reason` (string): Reason for disconnection

---

#### `messageReceived`

Emitted when a message is received from a peer.

```javascript
mesh.addEventListener('messageReceived', (data) => {
    console.log(`Message from ${data.from}: ${data.content}`);
});
```

**Event Data:**
- `from` (string): Sender peer identifier
- `content` (string): Message content

---

#### `peerEvicted`

Emitted when this peer is evicted by another peer.

```javascript
mesh.addEventListener('peerEvicted', (data) => {
    console.log(`Evicted by ${data.fromPeerId}: ${data.reason}`);
});
```

**Event Data:**
- `fromPeerId` (string): Peer that initiated eviction
- `reason` (string): Eviction reason

---

#### `peersUpdated`

Emitted when the peer list changes (connections, disconnections, discoveries).

```javascript
mesh.addEventListener('peersUpdated', () => {
    console.log('Peer list updated');
    ui.updateDiscoveredPeers();
});
```

**Event Data:** None

---

## Signaling Protocol

The signaling protocol uses HTTP POST for sending messages and HTTP GET for polling.

### Message Format

All signaling messages follow this structure:

```json
{
  "peerId": "sender-peer-id",
  "type": "message-type",
  "data": { /* type-specific data */ },
  "targetPeerId": "optional-target-peer",
  "timestamp": 1234567890,
  "maxPeers": 10
}
```

### Message Types

#### `announce`

Notifies the network that a peer has joined.

```json
{
  "type": "announce",
  "data": {
    "peerId": "a1b2c3d4..."
  }
}
```

#### `goodbye`

Notifies the network that a peer is leaving.

```json
{
  "type": "goodbye", 
  "data": {
    "peerId": "a1b2c3d4...",
    "timestamp": 1234567890
  }
}
```

#### `offer`

WebRTC connection offer with session description.

```json
{
  "type": "offer",
  "targetPeerId": "target-peer-id",
  "data": {
    "type": "offer",
    "sdp": "v=0\r\no=..."
  }
}
```

#### `answer`

WebRTC connection answer with session description.

```json
{
  "type": "answer",
  "targetPeerId": "target-peer-id", 
  "data": {
    "type": "answer",
    "sdp": "v=0\r\na=..."
  }
}
```

#### `ice-candidate`

ICE candidate for WebRTC connection establishment.

```json
{
  "type": "ice-candidate",
  "targetPeerId": "target-peer-id",
  "data": {
    "candidate": "candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host",
    "sdpMLineIndex": 0,
    "sdpMid": "0"
  }
}
```

#### `cleanup`

Request to remove processed signaling data.

```json
{
  "type": "cleanup",
  "targetPeerId": "target-peer-id",
  "data": {
    "reason": "connection_established",
    "timestamp": 1234567890
  }
}
```

---

## Configuration

### Environment Variables (Server)

| Variable | Default | Description |
|----------|---------|-------------|
| `MESSAGES_TABLE_NAME` | `pigion-messages` | DynamoDB table name |
| `TTL_SECONDS` | `300` | Message time-to-live in seconds |
| `MAX_MESSAGES_PER_POLL` | `50` | Maximum messages per poll request |

### Mesh Configuration

```javascript
const mesh = new PeerPigeonMesh();

// Connection limits
mesh.maxPeers = 15;                    // 1-50, default: 10

// Auto-discovery behavior  
mesh.autoDiscovery = true;             // default: true
mesh.evictionStrategy = true;          // default: true

// Advanced settings (read-only)
mesh.pollingInterval = 2000;           // Polling frequency (ms)
mesh.connectionTimeout = 30000;        // Connection timeout (ms)
mesh.retryDelay = 1000;               // Retry delay base (ms)
```

### Browser Compatibility Requirements

- **ES6 Modules**: Dynamic imports and module syntax
- **WebRTC**: RTCPeerConnection and data channels
- **Crypto API**: SubtleCrypto for SHA-1 hashing
- **Fetch API**: HTTP requests with CORS support
- **Modern JavaScript**: Async/await, BigInt, Map/Set collections

### Performance Considerations

- **Memory Usage**: ~1MB per 10 connected peers
- **Bandwidth**: ~100 bytes/second per peer for keep-alive
- **CPU Usage**: Minimal except during connection establishment
- **Storage**: No persistent local storage used

## Module Structure

PeerPigeon is organized into modular components:

- **`src/PeerPigeonMesh.js`** - Core mesh networking engine
- **`src/SignalingClient.js`** - Signaling server communication
- **`src/EventEmitter.js`** - Event handling utility
- **`examples/browser/ui.js`** - Browser UI component
- **`examples/browser/app.js`** - Application orchestrator

### Direct Imports

```javascript
// Import core mesh functionality from npm package
import { PeerPigeonMesh } from 'peerpigeon';

// Import signaling client separately if needed (for custom implementations)
import { SignalingClient } from 'peerpigeon';

// Import browser UI components (from source for examples)
import { PeerPigeonUI } from './examples/browser/ui.js';
```
