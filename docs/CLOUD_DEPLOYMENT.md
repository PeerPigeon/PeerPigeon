# Cloud Deployment Guide

## Bootstrap Hub Hierarchy

For cloud deployments, PeerPigeon uses a hierarchical bootstrap configuration to ensure reliable hub mesh connectivity:

### Hub Roles

1. **Hub B (`pigeonhub-b.fly.dev`)** - Primary Bootstrap Hub
   - Does not connect to any other hubs on startup
   - Acts as the primary bootstrap for all other hubs
   - Should be the most stable/reliable deployment

2. **Hub C (`pigeonhub-c.fly.dev`)** - Secondary Bootstrap Hub
   - Bootstraps from Hub B: `wss://pigeonhub-b.fly.dev`
   - Acts as a secondary bootstrap for other hubs
   - Provides redundancy if Hub B is unreachable

3. **Other Hubs** - Client Hubs
   - Bootstrap from both Hub B and Hub C: `wss://pigeonhub-b.fly.dev`, `wss://pigeonhub-c.fly.dev`
   - Connect to the hub mesh through either bootstrap hub
   - Automatically discover other hubs through the mesh

### Automatic Configuration

The `scripts/start-hub.js` script automatically detects the hostname and configures bootstraps:

```bash
# Hub B (primary) - no bootstraps
HOSTNAME=pigeonhub-b.fly.dev npm run hub

# Hub C (secondary) - bootstraps from B
HOSTNAME=pigeonhub-c.fly.dev npm run hub

# Other hubs - bootstrap from B and C
HOSTNAME=pigeonhub-d.fly.dev npm run hub
```

### Manual Override

You can override the automatic configuration with the `BOOTSTRAP_HUBS` environment variable:

```bash
BOOTSTRAP_HUBS=wss://custom-hub.example.com npm run hub
```

### Local Development

For local development, use explicit bootstrap configuration:

```bash
# Primary hub (no bootstrap)
PORT=3000 npm run hub

# Secondary hubs (bootstrap from primary)
PORT=3001 BOOTSTRAP_HUBS=ws://localhost:3000 npm run hub
PORT=3002 BOOTSTRAP_HUBS=ws://localhost:3000 npm run hub
```

## Deployment Example (Fly.io)

### Hub B Deployment

```toml
# fly.toml for pigeonhub-b
app = "pigeonhub-b"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  HOST = "0.0.0.0"

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

### Hub C Deployment

```toml
# fly.toml for pigeonhub-c
app = "pigeonhub-c"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  HOST = "0.0.0.0"

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

### Other Hub Deployments

Follow the same pattern as Hub C. The bootstrap configuration will be automatic based on the hostname.

## Health Checks

All hubs expose health endpoints:

- `GET /health` - Basic health check
- `GET /hubs` - List of connected hubs in the mesh

Use these endpoints for monitoring and load balancer health checks.

## WebSocket vs WSS

- **Local Development**: Use `ws://` protocol
- **Production/Cloud**: Use `wss://` protocol (secure WebSocket over TLS)

The hub script automatically uses `wss://` for fly.dev/fly.io hostnames.
