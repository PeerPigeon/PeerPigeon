# PeerPigeon <img src="examples/browser/assets/images/favicon.png" alt="PeerPigeon Logo" width="32" height="32" align="right">

**WebRTC-based peer-to-peer mesh networking with intelligent routing, encrypted storage, and media streaming.**

[![npm version](https://badge.fury.io/js/peerpigeon.svg)](https://badge.fury.io/js/peerpigeon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 14](https://img.shields.io/badge/node-%3E%3D14-brightgreen.svg)](https://nodejs.org)

PeerPigeon is a production-ready library for building decentralized applications with true mesh networking, encrypted distributed storage, and selective media streaming. It handles peer discovery, connection management, and message routing automatically.

> **⚠️ IMPORTANT: Local Testing Requirement**  
> When testing on `localhost`, WebRTC connections require **media permissions** (microphone/camera) due to browser security.  
> **Solution**: Click the "Media" tab in the browser example and grant permissions, or see [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) for details.  
> This is **NOT required** for production HTTPS deployments.

## ✨ Key Features

- **🕸️ True Mesh Networking** - Gossip protocol + XOR distance routing (Kademlia-inspired)
- **🌐 Network Namespaces** - Isolated peer networks with automatic global fallback
- **🗄️ Distributed Storage** - Encrypted, CRDT-enabled storage across the mesh
- **🎥 Selective Streaming** - Efficient audio/video streaming with bandwidth management
- **🏢 Hub System** - Connect multiple signaling servers for global peer discovery
- **🔐 End-to-End Encryption** - Built-in crypto for secure communication
- **💰 Cost Optimized** - Smart routing reduces server costs by ~95%
- **📱 Multi-Platform** - Browser, Node.js, NativeScript support

## 🚀 Quick Start

### Installation

```bash
npm install peerpigeon
```

### Basic Usage

```javascript
import { PeerPigeonMesh } from 'peerpigeon';

// Create and connect
const mesh = new PeerPigeonMesh({ enableWebDHT: true, enableCrypto: true });
await mesh.init();
await mesh.connect('ws://localhost:3000');

// Send messages
mesh.sendMessage('Hello, mesh!');

// Listen for messages
mesh.on('messageReceived', ({ from, content }) => {
  console.log(`${from}: ${content}`);
});
```

### Run Signaling Server

```bash
# Start both hub and HTTP server for testing
npm run dev

# Or run them separately:
npm run dev:hub   # Just the signaling hub
npm run dev:http  # Just the HTTP server

# Custom port
PORT=8080 npm run hub
```

### Local Testing

For localhost testing, you need to grant media permissions:

1. Open browser example: `http://localhost:8080/`
2. Go to **Media** tab
3. Click **Start Media** button
4. Allow microphone/camera access

See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) for full details.

## 📚 Examples

### Distributed Storage

```javascript
// Store encrypted data across the mesh
await mesh.storage.put('myKey', { data: 'value' });

// Retrieve from any peer
const value = await mesh.storage.get('myKey');

// Storage spaces for organization
const chatSpace = mesh.storage.getSpace('chat');
await chatSpace.put('message1', { text: 'Hello!' });
```

### Selective Media Streaming

```javascript
// Get local media
const stream = await navigator.mediaDevices.getUserMedia({ 
  video: true, 
  audio: true 
});

// Selective streaming to specific peers
mesh.media.addLocalStream(stream, 'camera');
mesh.media.streamToPeer('peer-id-1', 'camera', { video: true, audio: true });
mesh.media.streamToPeer('peer-id-2', 'camera', { video: false, audio: true }); // Audio only

// Receive streams
mesh.media.on('remoteStreamAdded', ({ peerId, stream, label }) => {
  videoElement.srcObject = stream;
});
```

### Network Namespaces

```javascript
// Create isolated networks
const gameMesh = new PeerPigeonMesh({ networkName: 'game-lobby-1' });
const chatMesh = new PeerPigeonMesh({ networkName: 'chat-room-5' });

// Peers in different networks won't see each other
await gameMesh.connect('ws://localhost:3000');
await chatMesh.connect('ws://localhost:3000');
```

### Hub System (Multi-Server)

```javascript
// Server 1 (bootstrap hub on port 3000)
const hub1 = new PeerPigeonServer({ 
  port: 3000, 
  isHub: true 
});
await hub1.start();

// Server 2 connects to hub1
const hub2 = new PeerPigeonServer({ 
  port: 3001, 
  isHub: true,
  bootstrapHubs: ['ws://localhost:3000']
});
await hub2.start();

// Peers on hub2 can discover peers on hub1!
```

## 📖 Documentation

### Core Guides
- **[API Documentation](docs/API_DOCUMENTATION.md)** - Complete API reference
- **[CLI Guide](docs/CLI_README.md)** - Command-line interface
- **[Network Namespaces](docs/NETWORK_NAMESPACES.md)** - Isolated peer networks
- **[Selective Streaming](docs/SELECTIVE_STREAMING_GUIDE.md)** - Media streaming optimization

### Hub System
- **[Hub System Overview](docs/HUB_SYSTEM.md)** - Multi-server mesh architecture
- **[Hub Quick Reference](docs/HUB_QUICK_REF.md)** - Quick start guide for hubs
- **[Hub Scripts](docs/HUB_SCRIPTS.md)** - Hub automation scripts
- **[Bootstrap Hubs](docs/BOOTSTRAP_HUBS.md)** - Hub discovery and connection

### Examples
- **[Browser Examples](examples/browser/)** - Web applications
- **[Node.js Examples](examples/node/)** - Server-side usage
- **[NativeScript Examples](examples/nativescript/)** - Mobile apps

## 🏗️ Architecture

PeerPigeon uses a modular architecture with smart routing:

```
┌─────────────────────────────────────────────┐
│          PeerPigeonMesh (Core)             │
├─────────────────────────────────────────────┤
│  • SignalingClient    • PeerDiscovery      │
│  • ConnectionManager  • EvictionManager    │
│  • GossipManager      • MeshOptimizer      │
│  • StorageManager     • MediaManager       │
└─────────────────────────────────────────────┘
           │                    │
           ▼                    ▼
  ┌──────────────┐      ┌──────────────┐
  │  WebSocket   │      │   WebRTC     │
  │  Signaling   │      │ DataChannel  │
  └──────────────┘      └──────────────┘
```

**Key Components:**
- **XOR Distance Routing** - Kademlia-inspired peer selection
- **Gossip Protocol** - Reliable message propagation
- **Smart Eviction** - Automatically optimizes mesh topology
- **CRDT Storage** - Conflict-free distributed data structures

## 🔧 Advanced Configuration

```javascript
const mesh = new PeerPigeonMesh({
  // Core options
  peerId: 'custom-peer-id',           // Custom peer ID (40-char hex)
  networkName: 'my-network',          // Network namespace (default: 'global')
  allowGlobalFallback: true,          // Allow fallback to global network
  
  // Features (all enabled by default)
  enableWebDHT: true,                 // Distributed hash table
  enableCrypto: true,                 // Encryption & key management
  
  // Connection settings
  maxPeers: 3,                        // Max concurrent connections
  minPeers: 2,                        // Min connections to maintain
  autoConnect: true,                  // Auto-connect on join
  autoDiscovery: true,                // Auto-discover peers
  
  // Topology optimization
  evictionStrategy: true,             // Smart peer eviction
  xorRouting: true                    // XOR distance-based routing
});
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Browser integration tests
npm run test:browser
npm run test:browser:visual  # With visible browser

# Video streaming tests
npm run test:video
npm run test:video:visual    # With visible browser
```

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our [GitHub repository](https://github.com/PeerPigeon/PeerPigeon).

## 📄 License

MIT © Daniel Raeder

## 🔗 Links

- **GitHub**: [github.com/PeerPigeon/PeerPigeon](https://github.com/PeerPigeon/PeerPigeon)
- **npm**: [npmjs.com/package/peerpigeon](https://www.npmjs.com/package/peerpigeon)
- **Issues**: [github.com/PeerPigeon/PeerPigeon/issues](https://github.com/PeerPigeon/PeerPigeon/issues)

---

**Built with ❤️ for the decentralized web**
