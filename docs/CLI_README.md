# PeerPigeon CLI

A comprehensive command-line interface for PeerPigeon mesh networking.

## Installation

```bash
npm install -g peerpigeon-cli
```

Or use directly with npx:

```bash
npx peerpigeon-cli --help
```

## Quick Start

### 1. Start a Signaling Server

```bash
peerpigeon server --port 3000
```

### 2. Initialize and Connect to Mesh

```bash
# Interactive mode
peerpigeon init --url wss://localhost:3000 --interactive

# Or connect and send a message
peerpigeon init --url wss://localhost:3000
peerpigeon send "Hello mesh network!"
```

### 3. Interactive Mode

Start an interactive session with automatic connection:

```bash
peerpigeon interactive
```

## Commands

### Core Commands

#### `peerpigeon init [options]`
Initialize and connect to mesh network.

**Options:**
- `-u, --url <url>` - Signaling server URL
- `-p, --peer-id <id>` - Custom peer ID
- `--max-peers <n>` - Maximum peers (default: 3)
- `--min-peers <n>` - Minimum peers (default: 2)
- `--no-auto-discovery` - Disable auto discovery
- `--enable-webdht` - Enable WebDHT
- `--enable-crypto` - Enable encryption
- `-i, --interactive` - Start interactive mode

```bash
peerpigeon init --url wss://signaling.example.com --max-peers 5 --interactive
```

#### `peerpigeon send <message>`
Send broadcast message to all peers.

```bash
peerpigeon send "Hello everyone!"
peerpigeon send '{"type": "data", "value": 42}'
```

#### `peerpigeon dm <peerId> <message>`
Send direct message to specific peer.

```bash
peerpigeon dm abc12345... "Hello specific peer!"
```

### Status and Information

#### `peerpigeon status`
Show mesh network status.

```bash
peerpigeon status
```

**Output:**
```
📊 Mesh Network Status

Peer ID:      abc123def456...
Connected:    Yes
Signaling:    wss://localhost:3000
Peers:        2/3 connected, 5 discovered
Auto Discovery: Enabled
Eviction:     Enabled
XOR Routing:  Enabled
WebDHT:       Enabled
Crypto:       Disabled
Uptime:       120s
```

#### `peerpigeon peers`
List connected and discovered peers.

```bash
peerpigeon peers
```

### Media Streaming

#### `peerpigeon media start [options]`
Start media streaming.

**Options:**
- `--video` - Enable video
- `--audio` - Enable audio

```bash
peerpigeon media start --video --audio
```

#### `peerpigeon media stop`
Stop media streaming.

```bash
peerpigeon media stop
```

### Distributed Hash Table (DHT)

#### `peerpigeon dht put <key> <value> [options]`
Store data in DHT.

**Options:**
- `--ttl <ms>` - Time to live in milliseconds

```bash
peerpigeon dht put "user:profile" '{"name": "Alice", "age": 30}'
peerpigeon dht put "temp:data" "temporary" --ttl 60000
```

#### `peerpigeon dht get <key>`
Retrieve data from DHT.

```bash
peerpigeon dht get "user:profile"
```

### Server Management

#### `peerpigeon server [options]`
Start signaling server.

**Options:**
- `-p, --port <port>` - Server port (default: 3000)
- `-h, --host <host>` - Server host (default: localhost)
- `--max-peers <n>` - Maximum peers (default: 100)

```bash
peerpigeon server --port 8080 --host 0.0.0.0
```

### Debug and Development

#### `peerpigeon debug <module> [options]`
Enable debug logging.

**Options:**
- `-a, --all` - Enable all modules

```bash
peerpigeon debug PeerPigeonMesh
peerpigeon debug --all
```

### Interactive Mode

#### `peerpigeon interactive`
Start interactive mode for real-time messaging.

```bash
peerpigeon interactive
```

**Interactive Commands:**
- Type messages to broadcast
- `/dm <peerId> <message>` - Send direct message
- `/status` - Show status
- `/peers` - List peers
- `/media start` - Start media streaming
- `/media stop` - Stop media streaming
- `/dht put <key> <value>` - Store in DHT
- `/dht get <key>` - Get from DHT
- `/quit` - Exit

## Configuration

The CLI automatically saves configuration and history in `~/.peerpigeon/`:

- `config.json` - Connection settings and preferences
- `history.json` - Message and connection history

### Configuration File Format

```json
{
  "signalingUrl": "wss://localhost:3000",
  "peerId": "abc123def456...",
  "maxPeers": 3,
  "minPeers": 2,
  "autoDiscovery": true,
  "enableWebDHT": true,
  "enableCrypto": false
}
```

## Examples

### Simple Chat Network

Terminal 1 (Start server):
```bash
peerpigeon server
```

Terminal 2 (Peer 1):
```bash
peerpigeon init --url wss://localhost:3000 --interactive
> Hello from peer 1!
```

Terminal 3 (Peer 2):
```bash
peerpigeon init --url wss://localhost:3000 --interactive
> Hello from peer 2!
```

### Video Conference Setup

Terminal 1 (Peer with video):
```bash
peerpigeon init --url wss://localhost:3000
peerpigeon media start --video --audio
```

Terminal 2 (Peer joining):
```bash
peerpigeon init --url wss://localhost:3000 --interactive
/media start --audio
```

### Distributed Data Storage

```bash
# Store user data
peerpigeon dht put "users:alice" '{"name": "Alice", "status": "online"}'

# Retrieve data from another peer
peerpigeon dht get "users:alice"

# Store temporary data with expiration
peerpigeon dht put "session:temp" "temporary data" --ttl 300000
```

### Custom Mesh Configuration

```bash
# Large mesh with custom settings
peerpigeon init \
  --url wss://signaling.example.com \
  --max-peers 10 \
  --min-peers 3 \
  --enable-webdht \
  --enable-crypto \
  --interactive
```

## Environment Variables

- `PEERPIGEON_SIGNALING_URL` - Default signaling server URL
- `PEERPIGEON_PEER_ID` - Default peer ID
- `PEERPIGEON_MAX_PEERS` - Default maximum peers
- `PEERPIGEON_DEBUG` - Comma-separated list of modules to debug

```bash
export PEERPIGEON_SIGNALING_URL=wss://my-signaling.com
export PEERPIGEON_DEBUG=PeerPigeonMesh,ConnectionManager
peerpigeon init --interactive
```

## Error Handling

The CLI provides detailed error messages and suggestions:

```bash
# Connection failure
peerpigeon init --url wss://invalid-server.com
# ✗ [12:34:56] Error: Connection failed: ENOTFOUND invalid-server.com

# Missing dependencies
peerpigeon media start --video
# ⚠ [12:34:56] Warning: Camera access denied. Check permissions.

# Invalid commands
peerpigeon invalid-command
# ✗ [12:34:56] Error: Unknown command. Use --help for available commands.
```

## Integration with Node.js Applications

Use the CLI programmatically:

```javascript
import { spawn } from 'child_process';

// Start peer and send message
const peer = spawn('peerpigeon', ['init', '--url', 'wss://localhost:3000']);
setTimeout(() => {
  spawn('peerpigeon', ['send', 'Hello from Node.js!']);
}, 2000);
```

## Troubleshooting

### Common Issues

1. **Connection refused**
   ```bash
   # Check if signaling server is running
   peerpigeon server --port 3000
   ```

2. **No peers discovered**
   ```bash
   # Check auto-discovery is enabled
   peerpigeon status
   # Enable if disabled
   peerpigeon init --auto-discovery
   ```

3. **Media permissions denied**
   ```bash
   # Check browser/system permissions for camera/microphone
   peerpigeon media start --audio  # Try audio only first
   ```

4. **DHT operations failing**
   ```bash
   # Ensure WebDHT is enabled
   peerpigeon init --enable-webdht
   ```

### Debug Mode

Enable debug logging for troubleshooting:

```bash
peerpigeon debug --all
peerpigeon init --url wss://localhost:3000 --interactive
```

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions welcome! Please see CONTRIBUTING.md for guidelines.
