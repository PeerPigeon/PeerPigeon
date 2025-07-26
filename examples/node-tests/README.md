# Node.js Examples for PeerPigeon

This directory contains Node.js examples demonstrating various PeerPigeon features.

## Examples

### Basic Storage Example (`basic-storage-example.js`)

A simple demonstration of core storage operations perfect for getting started:

- Store, retrieve, update, and delete data
- List all stored keys  
- View storage statistics
- Clean shutdown handling

#### Running the Basic Example

```bash
cd examples/node
npm run basic-example
```

### Storage Test (`storage-test.js`)

A comprehensive test suite that demonstrates all distributed storage operations:

- **Basic Operations**: Store, retrieve, update, delete
- **Encryption & Access Control**: Private encrypted data, public data, peer access lists  
- **Advanced Features**: Immutable data, CRDT support, TTL expiration
- **Bulk Operations**: Bulk store, retrieve, and delete
- **Search**: Search by key patterns, value content, and metadata
- **Management**: Key listing, statistics, backup/restore
- **Configuration**: Enable/disable storage, cleanup operations

#### Running the Storage Test

```bash
cd examples/node
npm run storage-test
```

Or directly:

```bash
node storage-test.js
```

#### Expected Output

The test will run through all storage operations and provide detailed output:

```
🚀 Initializing PeerPigeon Mesh with Storage...
✅ Mesh initialized with peer ID: abcd1234...
📦 Storage enabled: true

🧪 Running test: Basic Store and Retrieve
   Stored and retrieved: {"message":"Hello, World!","timestamp":1234567890}
✅ Test passed: Basic Store and Retrieve

🧪 Running test: Update Operation
   Updated: {"counter":1,"name":"original"} → {"counter":2,"name":"updated"}
✅ Test passed: Update Operation

... (continues with all tests)

🏁 TEST SUMMARY
================================================
Total Tests: 18
✅ Passed: 18
❌ Failed: 0
Success Rate: 100.0%

🎉 All tests passed! The Distributed Storage system is working perfectly.
```

### Basic Example (`basic-example.js`)

A simple example showing basic PeerPigeon mesh functionality (to be created).

## Requirements

- Node.js 16.0.0 or higher
- ES Modules support (using `"type": "module"` in package.json)

## Features Demonstrated

The examples show how to use PeerPigeon's distributed storage system with:

1. **WebDHT Integration**: Distributed hash table for data persistence
2. **Encryption**: Automatic encryption for private data using the crypto manager
3. **Access Control**: Fine-grained permissions for data access
4. **CRDT Support**: Conflict-free replicated data types for collaborative editing
5. **Search Capabilities**: Flexible search across keys, values, and metadata
6. **Bulk Operations**: Efficient batch processing of multiple items
7. **Backup/Restore**: Data portability and recovery features

## Architecture

Each example initializes a PeerPigeon mesh with the required features:

```javascript
const mesh = new PeerPigeonMesh({
  enableWebDHT: true,        // Distributed hash table
  enableCrypto: true,        // Encryption/decryption
  enableDistributedStorage: true  // Optional storage layer
});
```

The distributed storage manager provides a high-level API over the WebDHT with additional features like encryption, access control, and search capabilities.
