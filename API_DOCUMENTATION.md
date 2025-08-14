# PeerPigeon API Documentation

**Version**: Complete API reference for all exposed methods and event listeners  
**Generated**: August 1, 2025

## Table of Contents

1. [Main Classes](#main-classes)
2. [PeerPigeonMesh](#peerpigeonmesh) - Main mesh network class
3. [PeerConnection](#peerconnection) - Individual peer connection management
4. [SignalingClient](#signalingclient) - WebSocket signaling
5. [MediaManager](#mediamanager) - Media stream management
6. [WebDHT](#webdht) - Low-level Distributed Hash Table
7. [DistributedStorageManager](#distributedstoragemanager) - High-level distributed storage with encryption
8. [CryptoManager](#cryptomanager) - Encryption management
9. [GossipManager](#gossipmanager) - Message propagation
10. [DebugLogger](#debuglogger) - Debug logging system
11. [Environment Detection](#environment-detection) - Runtime environment utilities
12. [Event System](#event-system) - Event listener documentation
13. [Server Classes](#server-classes) - PeerPigeonServer for hosting signaling

---

## Main Classes

### Exported Classes
- `PeerPigeonMesh` - Main mesh network orchestrator
- `PeerConnection` - Individual WebRTC peer connection
- `SignalingClient` - WebSocket signaling client
- `WebDHT` - Low-level Distributed Hash Table for raw key-value storage
- `DistributedStorageManager` - High-level distributed storage with encryption and access control
- `DebugLogger` - Debug logging system
- `EnvironmentDetector` - Runtime environment detection
- `PeerPigeonServer` - WebSocket signaling server

---

## PeerPigeonMesh

The main class for creating and managing a mesh network of peers.

### Constructor

```javascript
new PeerPigeonMesh(options = {})
```

**Parameters:**
- `options.peerId` (string, optional) - Custom peer ID (40-character hex string)
- `options.enableWebDHT` (boolean, default: true) - Enable low-level distributed hash table
- `options.enableCrypto` (boolean, default: true) - Enable encryption features
- `options.maxPeers` (number, default: 3) - Maximum number of peer connections
- `options.minPeers` (number, default: 2) - Minimum number of peer connections
- `options.autoDiscovery` (boolean, default: true) - Automatic peer discovery
- `options.evictionStrategy` (boolean, default: true) - Peer eviction for optimization
- `options.xorRouting` (boolean, default: true) - XOR distance-based routing

### Core Methods

#### `async init()`
Initialize the mesh network and all subsystems.

**Returns:** `Promise<void>`  
**Throws:** Error if initialization fails  
**Events:** Emits `initialized` status change

```javascript
const mesh = new PeerPigeonMesh();
await mesh.init();
```

#### `async connect(signalingUrl)`
Connect to a signaling server to join the mesh network.

**Parameters:**
- `signalingUrl` (string) - WebSocket URL of signaling server

**Returns:** `Promise<void>`  
**Throws:** Error if connection fails  
**Events:** Emits `connected` when successful

```javascript
await mesh.connect('wss://signaling.example.com');
```

#### `disconnect()`
Disconnect from the mesh network and clean up all connections.

**Returns:** `void`  
**Events:** Emits `disconnected`

```javascript
mesh.disconnect();
```

### Configuration Methods

#### `setMaxPeers(maxPeers)`
Set the maximum number of simultaneous peer connections.

**Parameters:**
- `maxPeers` (number) - Maximum peer limit

**Returns:** `void`  
**Events:** Emits `statusChanged` with setting update

#### `setMinPeers(minPeers)`
Set the minimum number of peer connections to maintain.

**Parameters:**
- `minPeers` (number) - Minimum peer requirement

**Returns:** `void`  
**Events:** Emits `statusChanged` with setting update

#### `setAutoDiscovery(enabled)`
Enable or disable automatic peer discovery.

**Parameters:**
- `enabled` (boolean) - Auto-discovery state

**Returns:** `void`  
**Events:** Emits `statusChanged` with setting update

#### `setEvictionStrategy(enabled)`
Enable or disable peer eviction for mesh optimization.

**Parameters:**
- `enabled` (boolean) - Eviction strategy state

**Returns:** `void`  
**Events:** Emits `statusChanged` with setting update

#### `setXorRouting(enabled)`
Enable or disable XOR distance-based routing.

**Parameters:**
- `enabled` (boolean) - XOR routing state

**Returns:** `void`  
**Events:** Emits `statusChanged` with setting update

### Network Information Methods

#### `getStatus()`
Get comprehensive mesh network status.

**Returns:** `Object`
```javascript
{
  peerId: string,           // This peer's ID
  connected: boolean,       // Connection to signaling server
  connectedCount: number,   // Number of connected peers
  discoveredCount: number,  // Number of discovered peers
  maxPeers: number,        // Maximum peer limit
  minPeers: number,        // Minimum peer requirement
  autoDiscovery: boolean,  // Auto-discovery enabled
  evictionStrategy: boolean, // Eviction enabled
  xorRouting: boolean,     // XOR routing enabled
  signalingUrl: string,    // Current signaling URL
  uptime: number          // Connection uptime in ms
}
```

#### `getConnectedPeerCount()`
Get the number of currently connected peers.

**Returns:** `number`

#### `getPeers()`
Get all peer connection objects.

**Returns:** `Map<string, PeerConnection>` - Map of peer ID to PeerConnection

#### `getConnectedPeerIds()`
Get array of connected peer IDs.

**Returns:** `string[]` - Array of peer IDs

#### `getDiscoveredPeers()`
Get information about all discovered peers.

**Returns:** `Array<Object>`
```javascript
[{
  peerId: string,        // Peer ID
  discoveredAt: number   // Discovery timestamp
}]
```

#### `canAcceptMorePeers()`
Check if mesh can accept additional peer connections.

**Returns:** `boolean`

#### `hasPeer(peerId)`
Check if a specific peer is connected.

**Parameters:**
- `peerId` (string) - Peer ID to check

**Returns:** `boolean`

### Messaging Methods

#### `sendMessage(content)`
Send a broadcast message to all peers via gossip protocol.

**Parameters:**
- `content` (any) - Message content (string, object, etc.)

**Returns:** `string|null` - Message ID if sent successfully, null on error  
**Events:** Triggers `messageReceived` for all peers in network

```javascript
const messageId = mesh.sendMessage("Hello mesh network!");
const messageId2 = mesh.sendMessage({ type: "data", value: 42 });
```

#### `sendDirectMessage(targetPeerId, content)`
Send a direct message to a specific peer via gossip routing.

**Parameters:**
- `targetPeerId` (string) - Destination peer ID
- `content` (any) - Message content

**Returns:** `string|null` - Message ID if sent successfully, null on error  
**Events:** Triggers `messageReceived` for target peer

```javascript
const messageId = mesh.sendDirectMessage(peerId, "Hello specific peer!");
```

### Media Management Methods

#### `async initializeMedia()`
Initialize media subsystem and enumerate devices.

**Returns:** `Promise<boolean>` - Success status  
**Events:** Emits `mediaError` on failure

#### `async startMedia(options = {})`
Start local media stream (camera/microphone).

**Parameters:**
- `options.video` (boolean, default: false) - Enable video
- `options.audio` (boolean, default: false) - Enable audio
- `options.deviceIds.camera` (string, optional) - Specific camera device ID
- `options.deviceIds.microphone` (string, optional) - Specific microphone device ID

**Returns:** `Promise<MediaStream>` - Local media stream  
**Throws:** Error if media access fails  
**Events:** Emits `localStreamStarted`

```javascript
// Start audio and video
const stream = await mesh.startMedia({ video: true, audio: true });

// Start with specific devices
const stream2 = await mesh.startMedia({
  video: true,
  audio: true,
  deviceIds: {
    camera: 'camera-device-id',
    microphone: 'mic-device-id'
  }
});
```

#### `async stopMedia()`
Stop local media stream and remove from all peer connections.

**Returns:** `Promise<void>`  
**Events:** Emits `localStreamStopped`

#### `toggleVideo()`
Toggle video track on/off.

**Returns:** `boolean` - New video state

#### `toggleAudio()`
Toggle audio track on/off.

**Returns:** `boolean` - New audio state

#### `getMediaState()`
Get current media stream state.

**Returns:** `Object`
```javascript
{
  hasStream: boolean,      // Has local stream
  isVideoEnabled: boolean, // Video track enabled
  isAudioEnabled: boolean, // Audio track enabled
  videoDeviceId: string,   // Active video device
  audioDeviceId: string    // Active audio device
}
```

#### `getMediaDevices()`
Get available media devices.

**Returns:** `Object`
```javascript
{
  cameras: MediaDeviceInfo[],     // Video input devices
  microphones: MediaDeviceInfo[], // Audio input devices
  speakers: MediaDeviceInfo[]     // Audio output devices
}
```

#### `async enumerateMediaDevices()`
Refresh and get available media devices.

**Returns:** `Promise<Object>` - Device information (same format as getMediaDevices)  
**Events:** Emits `devicesUpdated`

#### `getLocalStream()`
Get the current local media stream.

**Returns:** `MediaStream|null` - Local stream or null if not started

#### `getRemoteStreams()`
Get all remote media streams from connected peers.

**Returns:** `Array<Object>`
```javascript
[{
  peerId: string,      // Source peer ID
  stream: MediaStream  // Remote media stream
}]
```

### Distributed Hash Table (WebDHT) Methods

#### `async dhtPut(key, value, options = {})`
Store a key-value pair in the distributed hash table.

**Parameters:**
- `key` (string) - Storage key
- `value` (any) - Value to store
- `options.ttl` (number, optional) - Time to live in milliseconds
- `options.space` (string, optional) - Storage space ('private', 'public', 'frozen')

**Returns:** `Promise<void>`  
**Events:** Emits `dhtValueChanged`

```javascript
await mesh.dhtPut('user:profile', { name: 'Alice', age: 30 });
await mesh.dhtPut('temp:data', value, { ttl: 60000 }); // Expires in 1 minute
```

#### `async dhtGet(key, options = {})`
Retrieve a value from the distributed hash table.

**Parameters:**
- `key` (string) - Storage key
- `options.timeout` (number, optional) - Request timeout in milliseconds

**Returns:** `Promise<any>` - Retrieved value or null if not found

```javascript
const profile = await mesh.dhtGet('user:profile');
```

#### `async dhtUpdate(key, value, options = {})`
Update an existing key in the distributed hash table.

**Parameters:**
- `key` (string) - Storage key
- `value` (any) - New value
- `options.merge` (boolean, default: false) - Merge objects instead of replace

**Returns:** `Promise<void>`  
**Events:** Emits `dhtValueChanged`

#### `async dhtDelete(key)`
Delete a key from the distributed hash table.

**Parameters:**
- `key` (string) - Storage key to delete

**Returns:** `Promise<boolean>` - True if deleted, false if not found  
**Events:** Emits `dhtValueChanged`

#### `async dhtSubscribe(key)`
Subscribe to changes on a specific key.

**Parameters:**
- `key` (string) - Storage key to monitor

**Returns:** `Promise<void>`  
**Events:** Will emit `dhtValueChanged` when key changes

```javascript
await mesh.dhtSubscribe('shared:document');
mesh.addEventListener('dhtValueChanged', (data) => {
  if (data.key === 'shared:document') {
    console.log('Document updated:', data.newValue);
  }
});
```

#### `async dhtUnsubscribe(key)`
Unsubscribe from changes on a specific key.

**Parameters:**
- `key` (string) - Storage key to stop monitoring

**Returns:** `Promise<void>`

### Encryption Methods (when enableCrypto: true)

#### `async sendEncryptedBroadcast(content, groupId = null)`
Send an encrypted broadcast message.

**Parameters:**
- `content` (any) - Message content to encrypt
- `groupId` (string, optional) - Group encryption key ID

**Returns:** `Promise<string|null>` - Message ID if sent successfully

#### `async decryptMessage(encryptedData)`
Decrypt a received encrypted message.

**Parameters:**
- `encryptedData` (Object) - Encrypted message data

**Returns:** `Promise<any>` - Decrypted content

#### `async exchangeKeysWithPeer(peerId)`
Exchange encryption keys with a specific peer.

**Parameters:**
- `peerId` (string) - Peer ID to exchange keys with

**Returns:** `Promise<void>`

#### `async addPeerKey(peerId, publicKey)`
Add a peer's public key for encryption.

**Parameters:**
- `peerId` (string) - Peer ID
- `publicKey` (string) - Peer's public key

**Returns:** `Promise<void>`

#### `getPublicKey()`
Get this peer's public key.

**Returns:** `string|null` - Public key if crypto is initialized

### Utility Methods

#### `async cleanupStaleSignalingData()`
Manually clean up stale signaling data.

**Returns:** `Promise<void>`

#### `forceConnectToAllPeers()`
Force connection attempts to all discovered peers.

**Returns:** `number` - Number of connection attempts made

#### `debugConnectivity()`
Log detailed connectivity debug information.

**Returns:** `void`

#### `getPeerStateSummary()`
Get summary of all peer connection states.

**Returns:** `Object`
```javascript
{
  total: number,
  connected: number,
  connecting: number,
  failed: number,
  states: { [peerId]: string }
}
```

#### `startConnectionMonitoring()`
Start periodic connection health monitoring.

**Returns:** `void`  
**Events:** Emits `connectionStats` periodically

#### `stopConnectionMonitoring()`
Stop connection health monitoring.

**Returns:** `void`

#### Static `validatePeerId(peerId)`
Validate a peer ID format.

**Parameters:**
- `peerId` (string) - Peer ID to validate

**Returns:** `boolean` - True if valid 40-character hex string

#### Static `async generatePeerId()`
Generate a new random peer ID.

**Returns:** `Promise<string>` - New 40-character hex peer ID

---

## PeerConnection

Manages individual WebRTC peer-to-peer connections.

### Constructor

```javascript
new PeerConnection(peerId, isInitiator = false, options = {})
```

**Parameters:**
- `peerId` (string) - Remote peer ID
- `isInitiator` (boolean) - Whether this peer initiates the connection
- `options.localStream` (MediaStream, optional) - Local media stream
- `options.enableVideo` (boolean, default: false) - Enable video
- `options.enableAudio` (boolean, default: false) - Enable audio

### Methods

#### `async createConnection()`
Create and configure the RTCPeerConnection.

**Returns:** `Promise<void>`  
**Throws:** Error if WebRTC not supported  
**Events:** Various connection state events

#### `async createOffer()`
Create an SDP offer for connection initiation.

**Returns:** `Promise<RTCSessionDescription>` - SDP offer  
**Events:** May emit `iceCandidate` events

#### `async handleOffer(offer)`
Handle incoming SDP offer and create answer.

**Parameters:**
- `offer` (RTCSessionDescription) - Remote SDP offer

**Returns:** `Promise<RTCSessionDescription>` - SDP answer  
**Events:** May emit `iceCandidate` events

#### `async handleAnswer(answer)`
Handle incoming SDP answer.

**Parameters:**
- `answer` (RTCSessionDescription) - Remote SDP answer

**Returns:** `Promise<void>`

#### `async handleIceCandidate(candidate)`
Handle incoming ICE candidate.

**Parameters:**
- `candidate` (RTCIceCandidate) - ICE candidate

**Returns:** `Promise<void>`

#### `sendMessage(message)`
Send a message over the data channel.

**Parameters:**
- `message` (any) - Message to send

**Returns:** `boolean` - True if sent successfully  
**Events:** Triggers `message` event on remote peer

#### `async setLocalStream(stream)`
Set or update the local media stream.

**Parameters:**
- `stream` (MediaStream|null) - Media stream or null to remove

**Returns:** `Promise<void>`  
**Events:** May trigger renegotiation

#### `getRemoteStream()`
Get the remote media stream.

**Returns:** `MediaStream|null` - Remote stream or null

#### `getLocalStream()`
Get the local media stream.

**Returns:** `MediaStream|null` - Local stream or null

#### `getMediaCapabilities()`
Get detailed media capabilities.

**Returns:** `Object`
```javascript
{
  hasLocalVideo: boolean,   // Has local video track
  hasLocalAudio: boolean,   // Has local audio track
  hasRemoteVideo: boolean,  // Has remote video track
  hasRemoteAudio: boolean,  // Has remote audio track
  canSendVideo: boolean,    // Can send video
  canSendAudio: boolean,    // Can send audio
  canReceiveVideo: boolean, // Can receive video
  canReceiveAudio: boolean  // Can receive audio
}
```

#### `getStatus()`
Get simplified connection status.

**Returns:** `string` - 'connected', 'connecting', 'failed', 'closed', etc.

#### `getDetailedStatus()`
Get detailed connection status.

**Returns:** `Object`
```javascript
{
  connectionState: string,    // RTCPeerConnection state
  iceConnectionState: string, // ICE connection state
  dataChannelState: string,   // Data channel state
  dataChannelReady: boolean,  // Data channel ready for messages
  isClosing: boolean,         // Connection is closing
  overallStatus: string       // Overall status assessment
}
```

#### `close()`
Close the peer connection and clean up resources.

**Returns:** `void`  
**Events:** Emits `disconnected`

### Events

- `connected` - Connection established
- `disconnected` - Connection closed
- `message` - Data channel message received
- `remoteStream` - Remote media stream received
- `iceCandidate` - ICE candidate generated
- `connectionFailed` - Connection failed
- `dataChannelOpen` - Data channel opened
- `dataChannelClosed` - Data channel closed

---

## SignalingClient

Manages WebSocket connection to signaling server.

### Constructor

```javascript
new SignalingClient(peerId, maxPeers = 10, mesh = null)
```

**Parameters:**
- `peerId` (string) - This peer's ID
- `maxPeers` (number) - Maximum peers to announce
- `mesh` (PeerPigeonMesh, optional) - Reference to mesh

### Methods

#### `async connect(websocketUrl)`
Connect to WebSocket signaling server.

**Parameters:**
- `websocketUrl` (string) - WebSocket server URL

**Returns:** `Promise<void>`  
**Throws:** Error if connection fails  
**Events:** Emits `connected` when successful

#### `disconnect()`
Disconnect from signaling server.

**Returns:** `void`  
**Events:** Emits `disconnected`

#### `async sendSignalingMessage(message)`
Send a signaling message to server.

**Parameters:**
- `message` (Object) - Message object with type and data

**Returns:** `Promise<Object>` - Server response  
**Throws:** Error if send fails

#### `isConnected()`
Check if connected to signaling server.

**Returns:** `boolean`

#### `getConnectionStats()`
Get connection statistics.

**Returns:** `Object`
```javascript
{
  connected: boolean,
  lastPingTime: number,
  lastPongTime: number,
  reconnectAttempts: number
}
```

#### `triggerKeepAlivePingCheck()`
Force immediate keep-alive ping check.

**Returns:** `void`

### Events

- `connected` - Connected to signaling server
- `disconnected` - Disconnected from signaling server
- `signalingMessage` - Signaling message received
- `statusChanged` - Status update
- `error` - Connection error

---

## MediaManager

Manages local media streams and devices.

### Constructor

```javascript
new MediaManager()
```

### Methods

#### `async init()`
Initialize media system and enumerate devices.

**Returns:** `Promise<boolean>` - Success status

#### `async enumerateDevices()`
Get available media devices.

**Returns:** `Promise<Object>`
```javascript
{
  cameras: MediaDeviceInfo[],
  microphones: MediaDeviceInfo[],
  speakers: MediaDeviceInfo[]
}
```

#### `async startLocalStream(options = {})`
Start local media stream.

**Parameters:**
- `options.video` (boolean) - Enable video
- `options.audio` (boolean) - Enable audio
- `options.deviceIds.camera` (string, optional) - Camera device ID
- `options.deviceIds.microphone` (string, optional) - Microphone device ID

**Returns:** `Promise<MediaStream>` - Local media stream

#### `stopLocalStream()`
Stop local media stream.

**Returns:** `void`

#### `toggleVideo()`
Toggle video track on/off.

**Returns:** `boolean` - New video state

#### `toggleAudio()`
Toggle audio track on/off.

**Returns:** `boolean` - New audio state

#### `getMediaState()`
Get current media state.

**Returns:** `Object`
```javascript
{
  hasStream: boolean,
  isVideoEnabled: boolean,
  isAudioEnabled: boolean,
  videoDeviceId: string,
  audioDeviceId: string
}
```

#### Static `checkSupport()`
Check browser media API support.

**Returns:** `Object`
```javascript
{
  getUserMedia: boolean,
  enumerateDevices: boolean,
  mediaDevices: boolean
}
```

#### `async getPermissions()`
Get media permissions status.

**Returns:** `Promise<Object>`
```javascript
{
  camera: 'granted' | 'denied' | 'prompt',
  microphone: 'granted' | 'denied' | 'prompt'
}
```

### Events

- `localStreamStarted` - Local stream started
- `localStreamStopped` - Local stream stopped
- `devicesUpdated` - Device list updated
- `error` - Media error

---

## WebDHT

**Low-level Distributed Hash Table for raw key-value storage across the mesh network.**

The WebDHT provides a Kademlia-style distributed hash table for storing arbitrary key-value pairs across the mesh. This is a low-level storage system that provides basic DHT operations without encryption or access control.

**Use WebDHT for:**
- Simple key-value storage across the mesh
- Raw data that doesn't need encryption
- Building custom storage solutions
- Direct DHT operations

**For encrypted storage with access control, use DistributedStorageManager instead.**

### Constructor

```javascript
new WebDHT(mesh)
```

**Parameters:**
- `mesh` (PeerPigeonMesh) - Reference to mesh network

### Methods

#### `async put(key, value, options = {})`
Store a key-value pair.

**Parameters:**
- `key` (string) - Storage key
- `value` (any) - Value to store
- `options.ttl` (number, optional) - Time to live in ms
- `options.replicas` (number, optional) - Number of replicas

**Returns:** `Promise<void>`

#### `async get(key, options = {})`
Retrieve a value by key.

**Parameters:**
- `key` (string) - Storage key
- `options.timeout` (number, optional) - Request timeout

**Returns:** `Promise<any>` - Retrieved value or null

#### `async update(key, value, options = {})`
Update an existing key.

**Parameters:**
- `key` (string) - Storage key
- `value` (any) - New value
- `options.merge` (boolean) - Merge with existing value

**Returns:** `Promise<void>`

#### `async delete(key)`
Delete a key.

**Parameters:**
- `key` (string) - Storage key

**Returns:** `Promise<boolean>` - True if deleted

#### `async subscribe(key)`
Subscribe to key changes.

**Parameters:**
- `key` (string) - Storage key

**Returns:** `Promise<void>`

#### `async unsubscribe(key)`
Unsubscribe from key changes.

**Parameters:**
- `key` (string) - Storage key

**Returns:** `Promise<void>`

#### `getStorageStats()`
Get storage statistics.

**Returns:** `Object`
```javascript
{
  localKeys: number,
  subscriptions: number,
  totalSize: number,
  peerCount: number
}
```

### Events

- `valueChanged` - DHT value changed
- `keyAdded` - New key added
- `keyDeleted` - Key deleted
- `subscriptionAdded` - Subscription added
- `subscriptionRemoved` - Subscription removed

---

## DistributedStorageManager

**High-level distributed storage with encryption, access control, and advanced features.**

The DistributedStorageManager provides a sophisticated storage layer on top of WebDHT that includes encryption, access control, storage spaces, and collaborative editing features. It uses WebDHT as its storage backend but provides a much richer API.

**Use DistributedStorageManager for:**
- Encrypted data storage
- Access control and permissions
- Public/private/frozen storage spaces
- Collaborative editing with CRDT support
- Application-level data storage

**Note:** DistributedStorageManager uses WebDHT as its backend storage but they are conceptually separate:
- WebDHT: Raw key-value storage across the mesh
- DistributedStorageManager: High-level storage with encryption and features

High-level distributed storage with encryption and access control.

### Constructor

```javascript
new DistributedStorageManager(mesh)
```

**Parameters:**
- `mesh` (PeerPigeonMesh) - Reference to mesh network

### Methods

#### `async store(key, value, options = {})`
Store data with encryption and access control.

**Parameters:**
- `key` (string) - Storage key
- `value` (any) - Data to store
- `options.space` (string) - Storage space ('private', 'public', 'frozen')
- `options.encrypt` (boolean) - Encrypt data
- `options.ttl` (number) - Time to live
- `options.immutable` (boolean) - Make immutable

**Returns:** `Promise<string>` - Storage key ID

#### `async retrieve(keyId, options = {})`
Retrieve stored data.

**Parameters:**
- `keyId` (string) - Storage key ID
- `options.decrypt` (boolean) - Decrypt data

**Returns:** `Promise<any>` - Retrieved data or null

#### `async update(keyId, value, options = {})`
Update stored data.

**Parameters:**
- `keyId` (string) - Storage key ID
- `value` (any) - New data
- `options.merge` (boolean) - Merge with existing

**Returns:** `Promise<void>`

#### `async delete(keyId)`
Delete stored data.

**Parameters:**
- `keyId` (string) - Storage key ID

**Returns:** `Promise<boolean>` - True if deleted

#### `async grantAccess(keyId, peerId, permissions = ['read'])`
Grant access to another peer.

**Parameters:**
- `keyId` (string) - Storage key ID
- `peerId` (string) - Peer to grant access
- `permissions` (string[]) - Permissions array

**Returns:** `Promise<void>`

#### `async revokeAccess(keyId, peerId)`
Revoke peer access.

**Parameters:**
- `keyId` (string) - Storage key ID
- `peerId` (string) - Peer to revoke access

**Returns:** `Promise<void>`

#### `async subscribe(keyId)`
Subscribe to data changes.

**Parameters:**
- `keyId` (string) - Storage key ID

**Returns:** `Promise<void>`

#### `async unsubscribe(keyId)`
Unsubscribe from data changes.

**Parameters:**
- `keyId` (string) - Storage key ID

**Returns:** `Promise<void>`

#### `getStorageInterface()`
Get lexical storage interface (GUN-like API).

**Returns:** `LexicalStorageInterface` - Chainable storage interface

```javascript
// Usage example
const storage = mesh.distributedStorage.getStorageInterface();
await storage.get('users').get('alice').put({ name: 'Alice', age: 30 });
const name = await storage.get('users').get('alice').get('name').val();
```

### Events

- `dataStored` - Data stored
- `dataRetrieved` - Data retrieved
- `dataUpdated` - Data updated
- `dataDeleted` - Data deleted
- `accessGranted` - Access granted
- `accessRevoked` - Access revoked

---

## CryptoManager

Encryption and key management (when enableCrypto: true).

### Constructor

```javascript
new CryptoManager()
```

### Methods

#### `async init(options = {})`
Initialize crypto system.

**Parameters:**
- `options.alias` (string, optional) - User alias for persistent identity
- `options.password` (string, optional) - User password
- `options.generateKeypair` (boolean, default: true) - Generate keypair

**Returns:** `Promise<Object>` - Generated keypair

#### `async createOrAuthenticateUser(alias, password)`
Create or authenticate user with persistent identity.

**Parameters:**
- `alias` (string) - User alias
- `password` (string) - User password

**Returns:** `Promise<Object>` - User credentials

#### `async encrypt(data, recipientPublicKey)`
Encrypt data for a specific recipient.

**Parameters:**
- `data` (any) - Data to encrypt
- `recipientPublicKey` (string) - Recipient's public key

**Returns:** `Promise<Object>` - Encrypted data package

#### `async decrypt(encryptedData, senderPublicKey)`
Decrypt received data.

**Parameters:**
- `encryptedData` (Object) - Encrypted data package
- `senderPublicKey` (string) - Sender's public key

**Returns:** `Promise<any>` - Decrypted data

#### `async sign(data)`
Sign data with private key.

**Parameters:**
- `data` (any) - Data to sign

**Returns:** `Promise<string>` - Digital signature

#### `async verify(data, signature, publicKey)`
Verify digital signature.

**Parameters:**
- `data` (any) - Original data
- `signature` (string) - Digital signature
- `publicKey` (string) - Signer's public key

**Returns:** `Promise<boolean>` - True if valid

#### `getPublicKey()`
Get this peer's public key.

**Returns:** `string|null` - Public key

#### `addPeerKey(peerId, publicKey)`
Add a peer's public key.

**Parameters:**
- `peerId` (string) - Peer ID
- `publicKey` (string) - Peer's public key

**Returns:** `void`

#### `getPeerKey(peerId)`
Get a peer's public key.

**Parameters:**
- `peerId` (string) - Peer ID

**Returns:** `string|null` - Peer's public key

#### `getStats()`
Get encryption statistics.

**Returns:** `Object`
```javascript
{
  messagesEncrypted: number,
  messagesDecrypted: number,
  encryptionTime: number,
  decryptionTime: number,
  keyExchanges: number
}
```

### Events

- `cryptoReady` - Crypto system initialized
- `cryptoError` - Crypto error
- `peerKeyAdded` - Peer key added
- `userAuthenticated` - User authenticated

---

## GossipManager

Message propagation across the mesh network.

### Constructor

```javascript
new GossipManager(mesh, connectionManager)
```

### Methods

#### `broadcastMessage(content, messageType = 'chat')`
Broadcast message to all peers.

**Parameters:**
- `content` (any) - Message content
- `messageType` (string) - Message type

**Returns:** `string|null` - Message ID

#### `sendDirectMessage(targetPeerId, content, subtype = 'dm')`
Send direct message to specific peer.

**Parameters:**
- `targetPeerId` (string) - Target peer ID
- `content` (any) - Message content
- `subtype` (string) - Message subtype

**Returns:** `string|null` - Message ID

#### `handleGossipMessage(message, fromPeerId)`
Handle incoming gossip message.

**Parameters:**
- `message` (Object) - Gossip message
- `fromPeerId` (string) - Sender peer ID

**Returns:** `Promise<void>`

### Events

- `messageReceived` - Message received
- `messagePropagated` - Message propagated
- `messageExpired` - Message expired

---

## DebugLogger

Configurable debug logging system.

### Static Methods

#### `create(moduleName)`
Create debug logger for a module.

**Parameters:**
- `moduleName` (string) - Module name

**Returns:** `Object` - Logger with log/warn/error methods

```javascript
const debug = DebugLogger.create('MyModule');
debug.log('This is a debug message');
debug.warn('This is a warning');
debug.error('This is an error');
```

#### `enable(moduleName)`
Enable debugging for specific module.

**Parameters:**
- `moduleName` (string) - Module to enable

**Returns:** `void`

#### `enableAll()`
Enable debugging for all modules.

**Returns:** `void`

#### `disable(moduleName)`
Disable debugging for specific module.

**Parameters:**
- `moduleName` (string) - Module to disable

**Returns:** `void`

#### `disableAll()`
Disable debugging for all modules.

**Returns:** `void`

#### `isEnabled(moduleName)`
Check if debugging is enabled for module.

**Parameters:**
- `moduleName` (string) - Module to check

**Returns:** `boolean`

#### `listModules()`
Get list of all registered modules.

**Returns:** `string[]` - Array of module names

#### `getState()`
Get current debugging state.

**Returns:** `Object`
```javascript
{
  globalEnabled: boolean,
  enabledModules: string[],
  disabledModules: string[]
}
```

### Logger Methods

Each logger instance returned by `create()` has these methods:

#### `log(...args)`
Log debug information.

#### `warn(...args)`
Log warning.

#### `error(...args)`
Log error.

#### `info(...args)`
Log info (alias for log).

#### `debug(...args)`
Log debug (alias for log).

---

## Environment Detection

Runtime environment detection utilities.

### EnvironmentDetector Class

#### Properties

- `isBrowser` (boolean) - Running in browser
- `isNodeJS` (boolean) - Running in Node.js
- `isWorker` (boolean) - Running in web worker
- `isServiceWorker` (boolean) - Running in service worker
- `isWebWorker` (boolean) - Running in dedicated worker
- `isSharedWorker` (boolean) - Running in shared worker
- `isDeno` (boolean) - Running in Deno
- `isBun` (boolean) - Running in Bun
- `isNativeScript` (boolean) - Running in NativeScript
- `hasWebRTC` (boolean) - WebRTC APIs available
- `hasWebSocket` (boolean) - WebSocket APIs available
- `hasLocalStorage` (boolean) - localStorage available
- `hasGetUserMedia` (boolean) - getUserMedia available
- `hasRandomValues` (boolean) - crypto.getRandomValues available

#### Methods

#### `getEnvironmentReport()`
Get comprehensive environment report.

**Returns:** `Object`
```javascript
{
  runtime: {
    isBrowser: boolean,
    isNodeJS: boolean,
    isWorker: boolean,
    // ... other runtime flags
  },
  capabilities: {
    webrtc: boolean,
    webSocket: boolean,
    localStorage: boolean,
    // ... other capabilities
  },
  browser: {
    name: string,
    version: string,
    userAgent: string
  },
  // ... other environment details
}
```

### Exported Functions

#### `isBrowser()`
Check if running in browser.

**Returns:** `boolean`

#### `isNodeJS()`
Check if running in Node.js.

**Returns:** `boolean`

#### `isWorker()`
Check if running in worker context.

**Returns:** `boolean`

#### `hasWebRTC()`
Check if WebRTC APIs are available.

**Returns:** `boolean`

#### `hasWebSocket()`
Check if WebSocket APIs are available.

**Returns:** `boolean`

#### `getEnvironmentReport()`
Get environment report (same as class method).

**Returns:** `Object`

---

## Event System

All classes extend EventEmitter and support event listening.

### EventEmitter Methods

#### `addEventListener(event, callback)`
Add event listener.

**Parameters:**
- `event` (string) - Event name
- `callback` (Function) - Event handler

**Returns:** `void`

#### `removeEventListener(event, callback)`
Remove event listener.

**Parameters:**
- `event` (string) - Event name
- `callback` (Function) - Event handler to remove

**Returns:** `void`

#### `emit(event, data)`
Emit an event (internal use).

**Parameters:**
- `event` (string) - Event name
- `data` (any) - Event data

**Returns:** `void`

### Standard Node.js EventEmitter Compatible Methods

#### `on(event, callback)`
Add event listener (alias for `addEventListener`).

**Parameters:**
- `event` (string) - Event name
- `callback` (Function) - Event handler

**Returns:** `EventEmitter` - Returns this for method chaining

**Example:**
```javascript
mesh.on('peerConnected', (data) => {
    console.log('Peer connected:', data.peerId);
}).on('messageReceived', (data) => {
    console.log('Message:', data.content);
});
```

#### `off(event, callback)`
Remove event listener (alias for `removeEventListener`).

**Parameters:**
- `event` (string) - Event name
- `callback` (Function) - Event handler to remove

**Returns:** `EventEmitter` - Returns this for method chaining

#### `once(event, callback)`
Add one-time event listener that automatically removes itself after being called once.

**Parameters:**
- `event` (string) - Event name
- `callback` (Function) - Event handler

**Returns:** `EventEmitter` - Returns this for method chaining

**Example:**
```javascript
mesh.once('connected', () => {
    console.log('Connected to mesh!');
    // This listener will be automatically removed after first execution
});
```

#### `removeAllListeners([event])`
Remove all listeners for an event, or all listeners if no event is specified.

**Parameters:**
- `event` (string, optional) - Event name. If omitted, removes all listeners for all events

**Returns:** `EventEmitter` - Returns this for method chaining

**Example:**
```javascript
// Remove all listeners for 'peerConnected' event
mesh.removeAllListeners('peerConnected');

// Remove all listeners for all events
mesh.removeAllListeners();
```

#### `listeners(event)`
Get array of listeners for an event.

**Parameters:**
- `event` (string) - Event name

**Returns:** `Function[]` - Array of listener functions

**Example:**
```javascript
const peerConnectedListeners = mesh.listeners('peerConnected');
console.log(`${peerConnectedListeners.length} listeners for peerConnected`);
```

#### `listenerCount(event)`
Get the number of listeners for an event.

**Parameters:**
- `event` (string) - Event name

**Returns:** `number` - Number of listeners

**Example:**
```javascript
const count = mesh.listenerCount('messageReceived');
console.log(`${count} message listeners`);
```

#### `eventNames()`
Get array of event names that have listeners.

**Returns:** `string[]` - Array of event names

**Example:**
```javascript
const events = mesh.eventNames();
console.log('Events with listeners:', events);
```

### Usage Examples

#### Basic Event Handling with Standard Methods

```javascript
import { PeerPigeonMesh } from 'peerpigeon';

const mesh = new PeerPigeonMesh({
  peerId: 'unique-peer-id',
  maxPeers: 5
});

// Using standard .on() method with chaining
mesh
  .on('connected', () => {
    console.log('🔗 Connected to mesh network');
  })
  .on('peerConnected', (data) => {
    console.log(`👋 Peer joined: ${data.peerId}`);
  })
  .on('messageReceived', (data) => {
    console.log(`💬 Message from ${data.from}: ${data.content}`);
  });

// One-time listener for initialization
mesh.once('initialized', () => {
  console.log('🎉 Mesh is ready!');
  // This listener will automatically be removed after first call
});

await mesh.init();
await mesh.connect('ws://localhost:3000');
```

#### Advanced Event Management

```javascript
// Store reference to listeners for later removal
const messageHandler = (data) => {
  console.log('Message:', data.content);
};

const peerHandler = (data) => {
  console.log('Peer event:', data.peerId);
};

// Add multiple listeners
mesh
  .on('messageReceived', messageHandler)
  .on('peerConnected', peerHandler)
  .on('peerDisconnected', peerHandler);

// Check listener counts
console.log(`Message listeners: ${mesh.listenerCount('messageReceived')}`);
console.log(`Active events: ${mesh.eventNames()}`);

// Remove specific listener
mesh.off('messageReceived', messageHandler);

// Remove all listeners for an event
mesh.removeAllListeners('peerConnected');

// Remove all listeners for all events
mesh.removeAllListeners();
```

#### Error Handling and Cleanup

```javascript
// Set up error handling
mesh.on('error', (error) => {
  console.error('Mesh error:', error);
});

// Clean up on shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  
  // Remove all event listeners to prevent memory leaks
  mesh.removeAllListeners();
  
  // Disconnect from mesh
  mesh.disconnect();
  process.exit(0);
});
```

#### Compatibility with Both Styles

```javascript
// You can mix and match both styles as needed
mesh.addEventListener('connected', legacyHandler); // Traditional style
mesh.on('disconnected', modernHandler);           // Standard style

// Both work the same way
mesh.removeEventListener('connected', legacyHandler);
mesh.off('disconnected', modernHandler);
```

### Main Events by Class

#### PeerPigeonMesh Events

- `initialized` - Mesh initialized
- `connected` - Connected to signaling server
- `disconnected` - Disconnected from signaling server
- `peerConnected` - Peer connected
- `peerDisconnected` - Peer disconnected
- `peerDiscovered` - Peer discovered
- `peerEvicted` - Peer evicted
- `messageReceived` - Message received
- `remoteStream` - Remote media stream received
- `localStreamStarted` - Local stream started
- `localStreamStopped` - Local stream stopped
- `mediaError` - Media error
- `dhtValueChanged` - DHT value changed
- `statusChanged` - Status update
- `peersUpdated` - Peer list updated
- `connectionStats` - Connection statistics
- `cryptoReady` - Crypto system ready
- `cryptoError` - Crypto error
- `peerKeyAdded` - Peer key added
- `userAuthenticated` - User authenticated
- `storageDataStored` - Storage data stored
- `storageDataRetrieved` - Storage data retrieved
- `storageDataUpdated` - Storage data updated
- `storageDataDeleted` - Storage data deleted
- `storageAccessGranted` - Storage access granted
- `storageAccessRevoked` - Storage access revoked

#### PeerConnection Events

- `connected` - Connection established
- `disconnected` - Connection closed
- `message` - Data channel message
- `remoteStream` - Remote media stream
- `iceCandidate` - ICE candidate generated
- `connectionFailed` - Connection failed
- `dataChannelOpen` - Data channel opened
- `dataChannelClosed` - Data channel closed

#### SignalingClient Events

- `connected` - Connected to server
- `disconnected` - Disconnected from server
- `signalingMessage` - Signaling message received
- `statusChanged` - Status update
- `error` - Connection error

#### MediaManager Events

- `localStreamStarted` - Stream started
- `localStreamStopped` - Stream stopped
- `devicesUpdated` - Device list updated
- `error` - Media error

#### WebDHT Events

- `valueChanged` - DHT value changed
- `keyAdded` - Key added
- `keyDeleted` - Key deleted
- `subscriptionAdded` - Subscription added
- `subscriptionRemoved` - Subscription removed

#### CryptoManager Events

- `cryptoReady` - System ready
- `cryptoError` - Crypto error
- `peerKeyAdded` - Peer key added
- `userAuthenticated` - User authenticated

#### GossipManager Events

- `messageReceived` - Message received
- `messagePropagated` - Message propagated
- `messageExpired` - Message expired

---

## Server Classes

### PeerPigeonServer

WebSocket signaling server for hosting mesh networks.

#### Constructor

```javascript
new PeerPigeonServer(options = {})
```

**Parameters:**
- `options.port` (number, default: 3000) - Server port
- `options.host` (string, default: 'localhost') - Server host
- `options.maxPeers` (number, default: 100) - Maximum peers
- `options.cleanupInterval` (number, default: 300000) - Cleanup interval in ms

#### Methods

#### `start()`
Start the signaling server.

**Returns:** `Promise<void>`

#### `stop()`
Stop the signaling server.

**Returns:** `Promise<void>`

#### `getStats()`
Get server statistics.

**Returns:** `Object`
```javascript
{
  connectedPeers: number,
  totalConnections: number,
  messagesProcessed: number,
  uptime: number
}
```

#### `broadcastToAll(message)`
Broadcast message to all connected peers.

**Parameters:**
- `message` (Object) - Message to broadcast

**Returns:** `number` - Number of peers reached

#### `broadcastToOthers(senderPeerId, message)`
Broadcast to all peers except sender.

**Parameters:**
- `senderPeerId` (string) - Sender peer ID
- `message` (Object) - Message to broadcast

**Returns:** `number` - Number of peers reached

#### Events

- `peerConnected` - Peer connected to server
- `peerDisconnected` - Peer disconnected from server
- `messageReceived` - Message received from peer
- `error` - Server error

---

## Usage Examples

### Basic Mesh Network

```javascript
import { PeerPigeonMesh } from 'peerpigeon';

const mesh = new PeerPigeonMesh({
  maxPeers: 5,
  enableWebDHT: true
});

await mesh.init();

// Connect to signaling server
await mesh.connect('wss://signaling.example.com');

// Listen for events
mesh.addEventListener('peerConnected', (data) => {
  console.log('Peer connected:', data.peerId);
});

mesh.addEventListener('messageReceived', (data) => {
  console.log('Message:', data.content, 'from:', data.from);
});

// Send messages
mesh.sendMessage('Hello mesh network!');
mesh.sendDirectMessage(peerId, 'Hello specific peer!');
```

### Media Streaming

```javascript
// Start video call
const stream = await mesh.startMedia({ 
  video: true, 
  audio: true 
});

// Handle remote streams
mesh.addEventListener('remoteStream', (data) => {
  const videoElement = document.getElementById('remoteVideo');
  videoElement.srcObject = data.stream;
});

// Toggle media
mesh.toggleVideo();
mesh.toggleAudio();

// Stop media
await mesh.stopMedia();
```

### Distributed Storage

```javascript
// Store data
await mesh.dhtPut('user:profile', {
  name: 'Alice',
  age: 30,
  interests: ['music', 'technology']
});

// Retrieve data
const profile = await mesh.dhtGet('user:profile');
console.log('Profile:', profile);

// Subscribe to changes
await mesh.dhtSubscribe('shared:document');
mesh.addEventListener('dhtValueChanged', (data) => {
  if (data.key === 'shared:document') {
    console.log('Document updated:', data.newValue);
  }
});

// Update data
await mesh.dhtUpdate('shared:document', newContent);
```

### Encryption

```javascript
const mesh = new PeerPigeonMesh({ enableCrypto: true });
await mesh.init();

// Send encrypted message
const messageId = await mesh.sendEncryptedBroadcast({
  type: 'secret',
  data: 'This is encrypted!'
});

// Handle encrypted messages
mesh.addEventListener('messageReceived', async (data) => {
  if (data.encrypted) {
    const decrypted = await mesh.decryptMessage(data.content);
    console.log('Decrypted:', decrypted);
  }
});
```

### Debug Logging

```javascript
import { DebugLogger } from 'peerpigeon';

// Enable debugging for specific modules
DebugLogger.enable('PeerPigeonMesh');
DebugLogger.enable('ConnectionManager');

// Or enable all debugging
DebugLogger.enableAll();

// Create custom logger
const debug = DebugLogger.create('MyApp');
debug.log('Application started');
```

---

This completes the comprehensive API documentation for PeerPigeon. All exposed methods, events, and their parameters are documented with usage examples.
