# Distributed Storage Layer

The Distributed Storage Layer is an optional extension to PeerPigeon's WebDHT that provides encrypted, access-controlled storage with optional immutability and CRDT (Conflict-free Replicated Data Type) support for collaborative editing.

## Features

- **Encrypted Storage**: Data is encrypted for originating peers when marked as private
- **Access Control**: Fine-grained permissions for reading private data
- **Optional Public Access**: Data can be marked as publicly readable
- **Optional Immutability**: Data can be made immutable for non-owners with CRDT support
- **Collaborative Editing**: CRDT-based conflict resolution for multi-peer editing
- **Event-Driven**: Real-time notifications for data changes

## Quick Start

### Enable Distributed Storage

```javascript
import { PeerPigeonMesh } from 'peerpigeon';

const mesh = new PeerPigeonMesh({
  enableCrypto: true,    // Required for encryption
  enableWebDHT: true     // Required for distributed storage
});

// Initialize crypto for encryption
await mesh.cryptoManager.init();

// Connect to the network
await mesh.connect('ws://your-signaling-server');

// Access the distributed storage
const storage = mesh.distributedStorage;
```

## API Reference

### Storing Data

#### `store(key, value, options)`

Store data in the distributed storage layer.

```javascript
// Store private encrypted data
await storage.store('user:profile', {
  name: 'Alice',
  email: 'alice@example.com'
}, {
  isPublic: false,      // Private (encrypted)
  isImmutable: false,   // Mutable for owner
  ttl: 3600000         // 1 hour TTL
});

// Store public data
await storage.store('app:config', {
  version: '1.0.0',
  features: ['chat', 'files']
}, {
  isPublic: true,       // Public (not encrypted)
  isImmutable: true     // Immutable for other peers
});

// Store collaborative document with CRDT
await storage.store('doc:shared', {
  title: 'Shared Document',
  content: 'Initial content'
}, {
  isPublic: true,
  isImmutable: false,
  enableCRDT: true      // Enable collaborative editing
});
```

**Options:**
- `isPublic` (boolean): Whether data is publicly readable (default: false)
- `isImmutable` (boolean): Whether data is immutable for other peers (default: false)
- `enableCRDT` (boolean): Enable CRDT for collaborative editing (default: false)
- `ttl` (number): Time to live in milliseconds (default: null - no expiration)
- `allowedPeers` (Array<string>): Specific peers allowed to read private data

### Retrieving Data

#### `retrieve(key, options)`

Retrieve data from the distributed storage layer.

```javascript
// Retrieve data
const data = await storage.retrieve('user:profile');

// Force refresh from network
const freshData = await storage.retrieve('user:profile', {
  forceRefresh: true
});
```

**Options:**
- `forceRefresh` (boolean): Force refresh from network instead of using cache

### Updating Data

#### `update(key, newValue, options)`

Update existing data. Only allowed for owners or for mutable data with CRDT enabled.

```javascript
// Update as owner
await storage.update('user:profile', {
  name: 'Alice Smith',
  email: 'alice.smith@example.com'
});

// Collaborative update with CRDT
await storage.update('doc:shared', {
  title: 'Updated Document',
  content: 'New content from collaborator'
}, {
  forceCRDTMerge: true
});
```

**Options:**
- `forceCRDTMerge` (boolean): Force CRDT merge even if not owner

### Access Control

#### `grantAccess(key, peerId)`

Grant read access to a specific peer for private data (owner only).

```javascript
await storage.grantAccess('user:profile', otherPeer.peerId);
```

#### `revokeAccess(key, peerId)`

Revoke read access from a specific peer for private data (owner only).

```javascript
await storage.revokeAccess('user:profile', otherPeer.peerId);
```

### Subscriptions

#### `subscribe(key)`

Subscribe to changes for a storage key.

```javascript
// Subscribe to changes
const currentValue = await storage.subscribe('user:profile');

// Listen for updates
storage.addEventListener('dataUpdated', (event) => {
  if (event.key === 'user:profile') {
    console.log('Profile updated:', event);
  }
});
```

#### `unsubscribe(key)`

Unsubscribe from changes for a storage key.

```javascript
await storage.unsubscribe('user:profile');
```

### Data Management

#### `delete(key)`

Delete data (owner only). Creates a tombstone to mark the data as deleted.

```javascript
await storage.delete('user:profile');
```

#### `getOwnedKeys()`

Get a list of all keys owned by this peer.

```javascript
const ownedKeys = storage.getOwnedKeys();
console.log('Owned keys:', ownedKeys);
```

#### `getStats()`

Get storage statistics.

```javascript
const stats = storage.getStats();
console.log('Storage stats:', stats);
```

## Events

The distributed storage manager emits various events that you can listen to:

```javascript
// Data stored
mesh.addEventListener('storageDataStored', (event) => {
  console.log('Data stored:', event.key);
});

// Data retrieved
mesh.addEventListener('storageDataRetrieved', (event) => {
  console.log('Data retrieved:', event.key);
});

// Data updated
mesh.addEventListener('storageDataUpdated', (event) => {
  console.log('Data updated:', event.key, 'version:', event.version);
});

// Data deleted
mesh.addEventListener('storageDataDeleted', (event) => {
  console.log('Data deleted:', event.key);
});

// Access granted
mesh.addEventListener('storageAccessGranted', (event) => {
  console.log('Access granted for:', event.key, 'to:', event.peerId);
});

// Access revoked
mesh.addEventListener('storageAccessRevoked', (event) => {
  console.log('Access revoked for:', event.key, 'from:', event.peerId);
});
```

## Use Cases

### 1. User Profiles and Settings

Store encrypted user profiles and settings that can be accessed across devices:

```javascript
// Store encrypted user profile
await storage.store('user:profile', userProfile, {
  isPublic: false,
  isImmutable: false
});

// Update settings
await storage.update('user:settings', newSettings);
```

### 2. Public Configuration

Store public application configuration that all peers can read:

```javascript
// Store public config
await storage.store('app:config', config, {
  isPublic: true,
  isImmutable: true
});

// All peers can read this
const config = await storage.retrieve('app:config');
```

### 3. Collaborative Documents

Enable real-time collaborative editing with CRDT:

```javascript
// Create collaborative document
await storage.store('doc:shared', document, {
  isPublic: true,
  enableCRDT: true
});

// Multiple peers can edit
await storage.update('doc:shared', updatedDocument, {
  forceCRDTMerge: true
});
```

### 4. Selective Sharing

Share private data with specific peers:

```javascript
// Store private data
await storage.store('file:secret', fileData, {
  isPublic: false
});

// Grant access to specific peer
await storage.grantAccess('file:secret', trustedPeer.peerId);
```

## CRDT Implementation

The distributed storage layer includes a simplified CRDT implementation for collaborative editing:

- **Last-Write-Wins**: Default conflict resolution based on timestamps
- **Object Merging**: For object values, properties are merged
- **Vector Clocks**: Track causality between operations
- **Operation Log**: Maintains history of changes for conflict resolution

For more sophisticated CRDT needs, you can extend the `mergeCRDTOperations` method or implement custom conflict resolution logic.

## Security Considerations

1. **Encryption**: Private data is encrypted using the peer's key pair
2. **Access Control**: Read permissions are enforced at the application layer
3. **Data Integrity**: All data includes metadata with owner information
4. **Replay Protection**: Message nonces prevent replay attacks (when crypto is enabled)

## Performance Considerations

1. **Value Size Limits**: Default maximum value size is 1MB
2. **CRDT Operation History**: Limited to last 100 operations per key
3. **TTL Cleanup**: Expired data is automatically cleaned up
4. **Caching**: Retrieved data is cached locally for performance

## Configuration

You can configure the distributed storage manager by modifying its config:

```javascript
// Access the storage config
const config = storage.config;

// Modify settings
config.maxValueSize = 2 * 1024 * 1024; // 2MB
config.conflictResolution = 'crdt-merge';
config.encryptionEnabled = true;
```

## Integration with WebDHT

The distributed storage layer is built on top of PeerPigeon's WebDHT:

- Storage keys are prefixed with `storage:` in the DHT
- Utilizes DHT's replication and fault tolerance
- Leverages DHT's subscription system for real-time updates
- Uses DHT's XOR distance routing for optimal peer selection

This ensures that your stored data benefits from the same distributed, fault-tolerant properties as the underlying DHT while adding the additional features of encryption, access control, and collaborative editing.
