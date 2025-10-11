# PeerPigeon Hub Quick Reference

## NPM Scripts

```bash
# Start bootstrap hub (port 3000)
npm run hub:bootstrap

# Start secondary hub (port 3001, auto-connects to 3000)
npm run hub

# Start complete hub network (4 hubs on ports 3000-3003)
npm run hub:network
```

## Environment Variables

```bash
# Custom port
PORT=4000 npm run hub

# Custom bootstrap
BOOTSTRAP=ws://hub.example.com:3000 npm run hub

# Multiple bootstrap hubs
BOOTSTRAP=ws://hub1.com:3000,ws://hub2.com:3000 npm run hub

# Custom hub ID
HUB_ID=abc123...xyz npm run hub

# Disable auto-connect
AUTO_CONNECT=false npm run hub
```

## Direct Script Usage

```bash
# Bootstrap hub
node scripts/start-hub.js --bootstrap

# Secondary hub with custom config
PORT=3002 BOOTSTRAP=ws://localhost:3000 node scripts/start-hub.js

# Hub network with custom count
HUB_COUNT=6 node scripts/start-hub-network.js
```

## Monitoring

```bash
# Health check
curl http://localhost:3000/health

# List hubs
curl http://localhost:3000/hubs
```

## Network Topology

```
Bootstrap (3000)
    ↑
    ├── Hub 1 (3001) ← auto-connects
    ├── Hub 2 (3002) ← auto-connects
    └── Hub 3 (3003) ← auto-connects
```

## Production (PM2)

```bash
# Bootstrap
pm2 start scripts/start-hub.js --name hub-3000 -- --bootstrap

# Secondary hubs
PORT=3001 pm2 start scripts/start-hub.js --name hub-3001
PORT=3002 pm2 start scripts/start-hub.js --name hub-3002

# Save & startup
pm2 save
pm2 startup
```

## Key Features

- ✅ Auto-connect to bootstrap hub
- 🔄 Auto-reconnect on disconnect
- 🔍 Automatic hub discovery
- 📊 Real-time statistics
- 🛡️ Graceful shutdown
- 🚀 Port auto-increment

## Events Displayed

- ✅ Peer connected/disconnected
- 🏢 Hub registered/unregistered
- 🔗 Bootstrap connected/disconnected
- 🔍 Hub discovered
- 📢 Peer announced

## Default Configuration

- Bootstrap Port: 3000
- Secondary Port: 3001
- Host: localhost
- Reconnect Interval: 5 seconds
- Max Reconnect Attempts: 10
- Hub Mesh Namespace: pigeonhub-mesh (configurable via `HUB_MESH_NAMESPACE`)

