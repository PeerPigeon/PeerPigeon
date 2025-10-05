# PeerPigeon Documentation

Complete documentation for PeerPigeon - a WebRTC-based peer-to-peer mesh networking library.

## 📚 Core Documentation

### Getting Started
- **[Main README](../README.md)** - Quick start and overview
- **[API Documentation](API_DOCUMENTATION.md)** - Complete API reference
- **[CLI Guide](CLI_README.md)** - Command-line interface usage

### Advanced Features
- **[Network Namespaces](NETWORK_NAMESPACES.md)** - Create isolated peer networks
- **[Selective Streaming](SELECTIVE_STREAMING_GUIDE.md)** - Optimize media streaming bandwidth
- **[Hub System Overview](HUB_SYSTEM.md)** - Multi-server mesh architecture
- **[Hub Quick Reference](HUB_QUICK_REF.md)** - Quick start for hub deployment
- **[Hub Scripts](HUB_SCRIPTS.md)** - Automation scripts for hubs
- **[Bootstrap Hubs](BOOTSTRAP_HUBS.md)** - Hub discovery and federation

## 📖 Guides by Topic

### Messaging & Communication
- **Gossip Protocol** - Reliable broadcast messaging (see API_DOCUMENTATION.md)
- **Direct Messaging** - Peer-to-peer communication (see API_DOCUMENTATION.md)
- **Event System** - Standard Node.js EventEmitter API (see API_DOCUMENTATION.md)

### Storage & Data
- **WebDHT** - Low-level distributed hash table (see API_DOCUMENTATION.md)
- **DistributedStorageManager** - High-level encrypted storage (see API_DOCUMENTATION.md)
- **Storage Spaces** - Organized data namespaces (see API_DOCUMENTATION.md)
- **CRDT Support** - Conflict-free collaborative editing (see API_DOCUMENTATION.md)

### Media & Streaming
- **Media Manager** - Audio/video stream management (see API_DOCUMENTATION.md)
- **Selective Streaming** - Bandwidth optimization (see SELECTIVE_STREAMING_GUIDE.md)
- **Stream Controls** - Dynamic stream management (see API_DOCUMENTATION.md)

### Network Architecture
- **XOR Distance Routing** - Kademlia-inspired topology (see API_DOCUMENTATION.md)
- **Mesh Optimization** - Automatic peer selection (see API_DOCUMENTATION.md)
- **Eviction Strategy** - Smart peer replacement (see API_DOCUMENTATION.md)
- **Network Namespaces** - Isolated networks (see NETWORK_NAMESPACES.md)

### Server & Infrastructure
- **Signaling Server** - WebSocket server setup (see API_DOCUMENTATION.md)
- **Hub System** - Multi-server federation (see HUB_SYSTEM.md)
- **Bootstrap Hubs** - Hub discovery (see BOOTSTRAP_HUBS.md)
- **CLI Tools** - Command-line utilities (see CLI_README.md)

## 🔧 Reference Documents

### Migration & Maintenance
- **[Migration Complete](MIGRATION_COMPLETE.md)** - WebSocket server migration notes
- **[Test Cleanup](TEST_CLEANUP_COMPLETE.md)** - Test suite cleanup notes

## 💡 Examples

### Code Examples
- **[Browser Examples](../examples/browser/)** - Web application examples
- **[Node.js Examples](../examples/node/)** - Server-side examples
- **[NativeScript Examples](../examples/nativescript/)** - Mobile app examples

### Quick Examples

#### Basic Mesh Setup
```javascript
import { PeerPigeonMesh } from 'peerpigeon';

const mesh = new PeerPigeonMesh({ enableWebDHT: true });
await mesh.init();
await mesh.connect('ws://localhost:3000');
```

#### Message Broadcasting
```javascript
mesh.sendMessage('Hello, everyone!');
mesh.on('messageReceived', ({ from, content }) => {
  console.log(`${from}: ${content}`);
});
```

#### Distributed Storage
```javascript
await mesh.storage.put('key', { data: 'value' });
const value = await mesh.storage.get('key');
```

#### Media Streaming
```javascript
const stream = await navigator.mediaDevices.getUserMedia({ video: true });
mesh.media.addLocalStream(stream, 'camera');
mesh.media.streamToPeer('peer-id', 'camera', { video: true, audio: true });
```

## 🔗 External Resources

- **GitHub Repository**: [github.com/draeder/peerpigeon](https://github.com/draeder/peerpigeon)
- **npm Package**: [npmjs.com/package/peerpigeon](https://www.npmjs.com/package/peerpigeon)
- **Issue Tracker**: [github.com/draeder/peerpigeon/issues](https://github.com/draeder/peerpigeon/issues)

## 📝 License

All documentation is provided under the MIT License.

---

**Need help?** Check out the examples or open an issue on GitHub!
