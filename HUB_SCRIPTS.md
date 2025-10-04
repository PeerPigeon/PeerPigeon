# PeerPigeon Hub Scripts

Easy-to-use scripts for starting and managing PeerPigeon hubs.

## Quick Start

### Start a Bootstrap Hub (Port 3000)

```bash
npm run hub:bootstrap
```

This starts the primary hub that other hubs connect to.

### Start a Secondary Hub (Port 3001)

```bash
npm run hub
```

This starts a hub that automatically connects to the bootstrap hub on port 3000.

### Start a Complete Hub Network

```bash
npm run hub:network
```

This starts a network of 4 hubs:
- Bootstrap hub on port 3000
- Secondary hubs on ports 3001, 3002, 3003

All secondary hubs automatically connect to the bootstrap hub.

## Advanced Usage

### Custom Port

```bash
PORT=4000 npm run hub
```

### Custom Bootstrap URI

```bash
PORT=3005 BOOTSTRAP=ws://hub.example.com:3000 npm run hub
```

### Multiple Bootstrap Hubs (Redundancy)

```bash
BOOTSTRAP=ws://hub1.example.com:3000,ws://hub2.example.com:3000 npm run hub
```

### Custom Hub ID

```bash
HUB_ID=a1b2c3d4e5f6789012345678901234567890abcd npm run hub
```

### Disable Auto-Connect

```bash
AUTO_CONNECT=false npm run hub
```

## Script Files

### `scripts/start-hub.js`

Start a single hub with custom configuration.

**Usage:**
```bash
node scripts/start-hub.js                    # Secondary hub on port 3001
node scripts/start-hub.js --bootstrap        # Bootstrap hub on port 3000
PORT=3002 node scripts/start-hub.js          # Custom port
```

**Environment Variables:**
- `PORT` - Port number (default: 3001 for secondary, 3000 for bootstrap)
- `HOST` - Host address (default: localhost)
- `BOOTSTRAP` - Comma-separated bootstrap hub URIs
- `HUB_ID` - Custom 40-character hex peer ID
- `AUTO_CONNECT` - Auto-connect to bootstrap (default: true)

**Command Line Flags:**
- `--bootstrap` or `-b` - Run as bootstrap hub (port 3000, no auto-connect)

### `scripts/start-hub-network.js`

Start a complete network of interconnected hubs.

**Usage:**
```bash
node scripts/start-hub-network.js           # Start 4 hubs (ports 3000-3003)
HUB_COUNT=6 node scripts/start-hub-network.js  # Start 6 hubs (ports 3000-3005)
```

**Environment Variables:**
- `HUB_COUNT` - Number of hubs to start (default: 4)
- `START_PORT` - Starting port number (default: 3000)
- `HOST` - Host address (default: localhost)

**Features:**
- Starts bootstrap hub first
- Starts secondary hubs with auto-connect
- Displays network topology
- Shows periodic statistics (every 30 seconds)
- Graceful shutdown of all hubs

## Hub Features

### Automatic Connection

Secondary hubs automatically connect to the bootstrap hub and discover other hubs through it.

### Auto-Reconnection

If a hub loses connection to the bootstrap, it automatically attempts to reconnect:
- Reconnect interval: 5 seconds
- Max attempts: 10
- Exponential backoff

### Event Monitoring

All scripts display real-time events:
- ✅ Peer connections
- 🏢 Hub registrations
- 🔗 Bootstrap connections
- 🔍 Hub discovery
- 📢 Peer announcements

### Statistics

Periodic statistics are displayed showing:
- Total connections
- Number of hubs
- Number of peers
- Active networks
- Bootstrap connection status

## Network Topologies

### Basic Topology

```
Bootstrap Hub (3000)
        ↑
        ├── Hub 1 (3001)
        ├── Hub 2 (3002)
        └── Hub 3 (3003)
```

### Redundant Topology

```bash
# Hub 1 with multiple bootstrap hubs
BOOTSTRAP=ws://localhost:3000,ws://localhost:3001 PORT=3005 npm run hub
```

```
Bootstrap Hub 1 (3000) ←→ Hub (3005)
Bootstrap Hub 2 (3001) ←→ Hub (3005)
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "isHub": true,
  "connections": 3,
  "hubs": 2,
  "peers": 1,
  "networks": 2
}
```

### List Connected Hubs

```bash
curl http://localhost:3000/hubs
```

Response:
```json
{
  "totalHubs": 3,
  "hubs": [
    {
      "peerId": "abc123...",
      "networkName": "pigeonhub-mesh",
      "registeredAt": 1696334400000
    }
  ]
}
```

## Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start bootstrap hub
pm2 start scripts/start-hub.js --name hub-bootstrap -- --bootstrap

# Start secondary hubs
PORT=3001 pm2 start scripts/start-hub.js --name hub-3001
PORT=3002 pm2 start scripts/start-hub.js --name hub-3002
PORT=3003 pm2 start scripts/start-hub.js --name hub-3003

# Save configuration
pm2 save

# Setup auto-restart on reboot
pm2 startup
```

### Using Docker

Create a `Dockerfile`:
```dockerfile
FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["npm", "run", "hub"]
```

Run:
```bash
# Bootstrap hub
docker run -p 3000:3000 -e PORT=3000 peerpigeon-hub --bootstrap

# Secondary hubs
docker run -p 3001:3001 -e PORT=3001 -e BOOTSTRAP=ws://bootstrap:3000 peerpigeon-hub
docker run -p 3002:3002 -e PORT=3002 -e BOOTSTRAP=ws://bootstrap:3000 peerpigeon-hub
```

### Using Systemd

Create `/etc/systemd/system/peerpigeon-hub@.service`:
```ini
[Unit]
Description=PeerPigeon Hub on port %i
After=network.target

[Service]
Type=simple
User=peerpigeon
WorkingDirectory=/opt/peerpigeon
Environment="PORT=%i"
ExecStart=/usr/bin/node scripts/start-hub.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
# Bootstrap hub
systemctl enable peerpigeon-hub@3000
systemctl start peerpigeon-hub@3000

# Secondary hubs
systemctl enable peerpigeon-hub@3001
systemctl start peerpigeon-hub@3001
```

## Troubleshooting

### Port Already in Use

The hub will automatically try the next available port:
```
⚠️  Port 3000 is already in use
🔄 Trying port 3001...
✅ Port 3000 was in use, using port 3001 instead
```

### Can't Connect to Bootstrap

Check that the bootstrap hub is running:
```bash
curl http://localhost:3000/health
```

Verify the bootstrap URI is correct:
```bash
BOOTSTRAP=ws://localhost:3000 npm run hub
```

### Hub Not Discovering Others

1. Ensure hubs are using `pigeonhub-mesh` namespace
2. Check that `autoConnect` is enabled
3. Verify network connectivity between hubs
4. Check firewall rules

### Memory Issues

Adjust Node.js memory limits:
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run hub:network
```

## Examples

See the `examples/` directory for more detailed examples:
- `examples/hub-example.js` - Basic hub usage
- `examples/bootstrap-hub-example.js` - Bootstrap hub examples

## Support

For more information, see:
- [HUB_SYSTEM.md](../HUB_SYSTEM.md) - Complete hub system documentation
- [API_DOCUMENTATION.md](../API_DOCUMENTATION.md) - API reference
- [README.md](../README.md) - Main project documentation
