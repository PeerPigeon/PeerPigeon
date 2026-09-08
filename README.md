# PeerPigeon

PeerPigeon is a high-performance, WebRTC-based partial-mesh networking library for Node.js and modern browsers. It provides real-time peer-to-peer communication, XOR distance routing, gossip broadcast dissemination, direct messaging, and local private signaling.

## Features

- **Partial-Mesh Architecture**: Efficient partial-mesh peer graph with automatic discovery, connection healing, and XOR-distance topology optimization.
- **Optimized Gossip Protocol**: Memory-efficient gossip broadcast with cached message deadlines, batched tracking cleanup, and throttled deep sweeps to eliminate CPU and GC thrashing under high throughput.
- **Direct Messaging**: Direct point-to-point messaging over WebRTC data channels.
- **Private Signaling Relay & Dashboard**: Built-in standalone private signaling server with a real-time web dashboard for inspecting peer connections, rooms, and message exchange metrics.
- **Cross-Platform**: Operates seamlessly in Node.js (via native WebRTC or `@koush/wrtc`) and modern browsers.

## Installation

```bash
npm install peerpigeon
```

Or clone and build from source:

```bash
git clone https://github.com/BrandonRaeder/PeerPigeon.git
cd PeerPigeon
npm install
npm run build
```

## Private Signaling Server & Dashboard

PeerPigeon includes a lightweight, standalone signaling relay server that enables completely isolated private networks (e.g. for LAN or private mesh setups) without relying on external public signaling infrastructure.

### Starting the Server

```bash
node scripts/private-signaling-server.mjs
```

By default, the server runs on port `4000`:
- **Signaling Endpoint**: `http://localhost:4000/signaling` (HTTP and WebSocket)
- **Live Dashboard**: `http://localhost:4000/dashboard`

You can customize the port and host via environment variables:

```bash
PORT=4000 HOST=0.0.0.0 node scripts/private-signaling-server.mjs
```

The live dashboard displays connected peers, active rooms/sessions, ICE candidate exchanges, and message rates in real time.

## Quickstart

### Creating a Mesh Node

```javascript
import PeerPigeonMesh from 'peerpigeon';

const mesh = new PeerPigeonMesh({
  networkId: 'my-private-network',
  sessionId: 'room-alpha',
  signalingServer: 'http://localhost:4000/signaling',
  automaticSignalingServer: false,
  minPeers: 3,
  maxPeers: 8,
  autoDiscover: true,
  autoConnect: true,
});

await mesh.start();

mesh.on('peer:connected', (peerId) => {
  console.log(`Connected to peer: ${peerId}`);
});

// Broadcast a message across the gossip mesh
await mesh.broadcast({
  type: 'announcement',
  text: 'Hello from node!',
  timestamp: Date.now(),
});

// Listen for incoming broadcast messages
mesh.on('message', (message) => {
  console.log('Received broadcast:', message);
});
```

### Direct Messaging

```javascript
await mesh.sendDirect(targetPeerId, {
  type: 'ping',
  data: 'direct hello',
});
```

## Gossip Protocol & Performance

PeerPigeon uses a gossip protocol to disseminate state across the partial mesh:
- **Cached Deadlines**: Message retention deadlines are computed once on retention, avoiding quadratic overhead during burst traffic.
- **Batched Tracking Eviction**: Tracking state uses hysteresis headroom thresholds to prevent per-message loop thrashing.
- **Throttled Deep Sweeps**: Periodic background sweeps clean expired message hashes without triggering V8 GC spikes.

## Testing

Run unit and delivery tests:

```bash
npm run test:delivery
```

## License

MIT
