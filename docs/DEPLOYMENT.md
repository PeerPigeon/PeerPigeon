# Deployment Guide

This guide covers deploying PeerPigeon's WebSocket signaling server and integrating the mesh library into your applications.

## Table of Contents

1. [WebSocket Signaling Server](#websocket-signaling-server)
2. [Browser Integration](#browser-integration)
3. [Production Deployment](#production-deployment)
4. [Custom Signaling Server](#custom-signaling-server)
5. [Monitoring and Debugging](#monitoring-and-debugging)

## WebSocket Signaling Server

PeerPigeon includes a Node.js WebSocket signaling server for local development and production use.

### Local Development

1. **Navigate to the server directory:**
   ```bash
   cd websocket-server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   # Or for development with auto-restart:
   npm run dev
   ```

4. **Test the server:**
   ```bash
   npm test
   ```

The server will be available at `ws://localhost:3000`.

### Server Configuration

The WebSocket server supports the following environment variables:

```bash
# Server configuration
PORT=3000                    # Server port (default: 3000)
HOST=localhost              # Server host (default: localhost)

# Performance tuning
MAX_CONNECTIONS=1000        # Maximum WebSocket connections
CLEANUP_INTERVAL=60000      # Cleanup interval in ms (default: 60000)
PEER_TIMEOUT=300000         # Peer timeout in ms (default: 300000)

# Security
CORS_ORIGIN=*               # CORS origin (default: *)
MAX_MESSAGE_SIZE=1048576    # Max message size in bytes (default: 1MB)
```

### Server Features

The included WebSocket server provides:

- **Real-time WebSocket connections** for signaling
- **Peer discovery** and announcement
- **Message routing** between peers
- **Connection management** with automatic cleanup
- **XOR-based peer matching** for optimal routing
- **Memory-efficient** message handling
- **Graceful shutdown** support

## Browser Integration

### Static File Serving

Serve the PeerPigeon files from any web server:

```bash
# Using npm (recommended)
npm run dev

# Using Node.js http-server
npx http-server -p 8080 -c-1

# Using live-server (with auto-reload)
npx live-server --port=8080 --no-browser
```

### Basic HTML Integration

```html
<!DOCTYPE html>
<html>
<head>
    <title>My PeerPigeon App</title>
</head>
<body>
    <script type="module">
        import { PeerPigeonMesh } from 'peerpigeon';
        
        const mesh = new PeerPigeonMesh();
        await mesh.init();
        await mesh.connect('ws://localhost:3000');
        
        // Your application logic here
    </script>
</body>
</html>
```

### Query Parameter Configuration

You can configure the signaling server URL via query parameters:

```
http://localhost:8080/examples/browser/?api=ws://your-server.com:3000
```

### Environment-Specific Configuration

```javascript
// config.js
const config = {
  development: {
    signalingUrl: 'ws://localhost:3000',
    debug: true
  },
  staging: {
    signalingUrl: 'wss://staging-ws.example.com',
    debug: true
  },
  production: {
    signalingUrl: 'wss://ws.example.com',
    debug: false
  }
};

export const getConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  return config[env];
};
```

## Production Deployment

### Docker Deployment

Create a `Dockerfile` for the WebSocket server:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY websocket-server/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy server files
COPY websocket-server/ ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:

```bash
# Build image
docker build -t peerpigeon-signaling .

# Run container
docker run -p 3000:3000 \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  -e MAX_CONNECTIONS=1000 \
  peerpigeon-signaling
```

### Docker Compose

```yaml
version: '3.8'

services:
  peerpigeon-signaling:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - HOST=0.0.0.0
      - MAX_CONNECTIONS=1000
      - CORS_ORIGIN=https://yourapp.com
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - peerpigeon-signaling
    restart: unless-stopped
```

### Nginx Configuration

```nginx
upstream peerpigeon {
    server peerpigeon-signaling:3000;
}

server {
    listen 80;
    server_name ws.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ws.example.com;
    
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    
    location / {
        proxy_pass http://peerpigeon;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

### Cloud Platform Deployment

### Load Balancing

For high availability, use multiple server instances:

```javascript
// cluster.js
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  
  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork();
  });
} else {
  // Worker process
  require('./server.js');
  console.log(`Worker ${process.pid} started`);
}
```

## Custom Signaling Server

If you need to implement your own signaling server, here's what you need to support:

### WebSocket Protocol

**Connection URL:** `ws://your-server?peerId=<40-char-hex-id>`

**Message Format:**
```json
{
  "type": "announce|goodbye|offer|answer|ice-candidate|ping|cleanup",
  "data": {
    "peerId": "sender-peer-id",
    "timestamp": 1234567890,
    // ... type-specific data
  },
  "targetPeerId": "optional-target-peer-id",
  "maxPeers": 10
}
```

### Required Message Types

#### announce
Peer joins the network:
```json
{
  "type": "announce",
  "data": {
    "peerId": "a1b2c3d4e5f6789012345678901234567890abcd"
  }
}
```

#### goodbye
Peer leaves the network:
```json
{
  "type": "goodbye",
  "data": {
    "peerId": "a1b2c3d4e5f6789012345678901234567890abcd",
    "reason": "user_disconnect"
  }
}
```

#### offer/answer/ice-candidate
WebRTC signaling:
```json
{
  "type": "offer",
  "data": {
    "peerId": "sender-id",
    "sdp": "v=0\r\no=- 123...",
    "type": "offer"
  },
  "targetPeerId": "receiver-id"
}
```

#### ping/pong
Keep-alive messages:
```json
{
  "type": "ping",
  "data": {
    "peerId": "sender-id",
    "timestamp": 1234567890
  }
}
```

### Server Response Format

```json
{
  "type": "connected|peer-discovered|peer-disconnected|pong|error",
  "data": {
    // Response-specific data
  },
  "fromPeerId": "system",
  "targetPeerId": "receiver-id",
  "timestamp": 1234567890
}
```

### Minimal Implementation

```javascript
const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const connections = new Map();
const peerData = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const peerId = url.searchParams.get('peerId');
  
  if (!peerId || !/^[a-fA-F0-9]{40}$/.test(peerId)) {
    ws.close(1008, 'Invalid peerId');
    return;
  }
  
  connections.set(peerId, ws);
  
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    
    switch (message.type) {
      case 'announce':
        handleAnnounce(peerId, message);
        break;
      case 'goodbye':
        handleGoodbye(peerId, message);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        handleSignaling(peerId, message);
        break;
      case 'ping':
        handlePing(peerId, message);
        break;
    }
  });
  
  ws.on('close', () => {
    connections.delete(peerId);
    peerData.delete(peerId);
  });
});

function handleAnnounce(peerId, message) {
  peerData.set(peerId, message.data);
  
  // Notify other peers
  for (const [otherPeerId, connection] of connections) {
    if (otherPeerId !== peerId) {
      connection.send(JSON.stringify({
        type: 'peer-discovered',
        data: { peerId, ...message.data },
        fromPeerId: 'system',
        targetPeerId: otherPeerId,
        timestamp: Date.now()
      }));
    }
  }
}

function handleSignaling(fromPeerId, message) {
  const targetConnection = connections.get(message.targetPeerId);
  if (targetConnection) {
    targetConnection.send(JSON.stringify({
      ...message,
      fromPeerId,
      timestamp: Date.now()
    }));
  }
}

function handlePing(peerId, message) {
  const connection = connections.get(peerId);
  if (connection) {
    connection.send(JSON.stringify({
      type: 'pong',
      data: { timestamp: Date.now() },
      fromPeerId: 'system',
      targetPeerId: peerId,
      timestamp: Date.now()
    }));
  }
}

server.listen(3000, () => {
  console.log('WebSocket signaling server running on port 3000');
});
```

## Monitoring and Debugging

### Health Checks

Add a health check endpoint to your server:

```javascript
// Add to server.js
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connections: connections.size,
    memory: process.memoryUsage()
  });
});
```

### Logging

Use structured logging for production:

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}
```

### Metrics Collection

```javascript
const metrics = {
  connectionsTotal: 0,
  messagesTotal: 0,
  errorsTotal: 0,
  startTime: Date.now()
};

function recordMetric(type) {
  metrics[type]++;
}

function getMetrics() {
  return {
    ...metrics,
    uptime: Date.now() - metrics.startTime,
    activeConnections: connections.size
  };
}
```

This deployment guide provides practical steps for deploying PeerPigeon with the actual WebSocket server included in the repository.

## Browser Integration

### Static File Hosting

Serve the PeerPigeon files from any static hosting provider:

```bash
# Using npm (recommended)
npm run dev

# Using Node.js http-server
npx http-server -p 8080 -c-1

# Using live-server (with auto-reload)
npx live-server --port=8080 --no-browser
```

### CDN Integration

Host on a CDN for global distribution:

```html
<script type="module">
  import { PeerPigeonMesh } from 'peerpigeon';
  
  const mesh = new PeerPigeonMesh();
  
  await mesh.init();
  await mesh.connect('https://api.example.com/signaling');
</script>
```

### Webpack Integration

Bundle Pigion with your application:

```javascript
// webpack.config.js
module.exports = {
  entry: './src/app.js',
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  }
};
```

```javascript
// src/app.js
import { PeerPigeonMesh } from 'peerpigeon';

class MyApp {
  constructor() {
    this.mesh = new PeerPigeonMesh();
    this.init();
  }
  
  async init() {
    await this.mesh.init();
    // Your application logic
  }
}

new MyApp();
```

### Environment Configuration

Use environment variables for different deployment stages:

```javascript
// config.js
const config = {
  development: {
    signalingUrl: 'http://localhost:3000/signaling',
    debug: true
  },
  staging: {
    signalingUrl: 'https://staging-api.example.com/signaling',
    debug: true
  },
  production: {
    signalingUrl: 'https://api.example.com/signaling',
    debug: false
  }
};

export const getConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  return config[env];
};
```

## Production Considerations

### Security

#### HTTPS Requirements
- **Signaling server** must use HTTPS in production
- **WebRTC** requires secure contexts for getUserMedia APIs
- **Mixed content** policies block HTTP resources on HTTPS pages

#### CORS Configuration
```javascript
// Express CORS setup
app.use(cors({
  origin: [
    'https://yourapp.com',
    'https://www.yourapp.com',
    /\.yourapp\.com$/
  ],
  credentials: true,
  optionsSuccessStatus: 200
}));
```

#### Rate Limiting
```javascript
// Express rate limiting
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/signaling', limiter);
```

#### Input Validation
```javascript
// Joi validation example
const Joi = require('joi');

const messageSchema = Joi.object({
  peerId: Joi.string().length(40).hex().required(),
  type: Joi.string().valid('announce', 'goodbye', 'offer', 'answer', 'ice-candidate', 'cleanup').required(),
  data: Joi.object().required(),
  targetPeerId: Joi.string().length(40).hex().optional(),
  maxPeers: Joi.number().integer().min(1).max(50).default(10)
});
```

### Performance Optimization

#### Message Batching
```javascript
// Batch multiple signaling messages
class SignalingBatch {
  constructor(signalingUrl) {
    this.url = signalingUrl;
    this.batch = [];
    this.timeout = null;
  }
  
  addMessage(message) {
    this.batch.push(message);
    
    if (!this.timeout) {
      this.timeout = setTimeout(() => {
        this.flush();
      }, 100); // Batch for 100ms
    }
  }
  
  async flush() {
    if (this.batch.length === 0) return;
    
    const messages = this.batch.splice(0);
    this.timeout = null;
    
    await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });
  }
}
```

#### WebSocket Connection Management
```javascript
// WebSocket connection manager with reconnection logic
class WebSocketManager {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
  }
  
  connect() {
    this.ws = new WebSocket(this.url);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.scheduleReconnect();
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      setTimeout(() => {
        this.reconnectAttempts++;
        this.reconnectDelay *= 1.5; // Exponential backoff
        this.connect();
      }, this.reconnectDelay);
    }
  }
  
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, message queued');
      // Queue message for when connection is restored
    }
  }
}
```

### Monitoring

#### Health Check Endpoint
```javascript
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    activeConnections: getActiveConnectionCount(),
    messageQueueSize: getMessageQueueSize()
  };
  
  res.json(health);
});
```

#### Application Monitoring
```javascript
// Browser performance monitoring
class PeerPigeonMonitor {
  constructor(mesh) {
    this.mesh = mesh;
    this.startTime = Date.now();
    this.messagesSent = 0;
    this.messagesReceived = 0;
    
    mesh.addEventListener('messageReceived', () => this.messagesReceived++);
    
    setInterval(() => this.reportMetrics(), 60000); // Report every minute
  }
  
  reportMetrics() {
    const uptime = Date.now() - this.startTime;
    const peers = this.mesh.getPeers();
    
    console.log({
      uptime: Math.floor(uptime / 1000),
      connectedPeers: peers.length,
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      memoryUsage: performance.memory?.usedJSHeapSize || 'unknown'
    });
  }
}
```

### Error Handling

#### Graceful Degradation
```javascript
class RobustMesh extends PeerPigeonMesh {
  async connect(signalingUrl) {
    try {
      await super.connect(signalingUrl);
    } catch (error) {
      console.warn('Primary signaling failed, trying backup:', error);
      
      // Try backup signaling servers
      for (const backupUrl of this.backupServers) {
        try {
          await super.connect(backupUrl);
          break;
        } catch (backupError) {
          console.warn(`Backup ${backupUrl} failed:`, backupError);
        }
      }
    }
  }
}
```

#### Circuit Breaker Pattern
```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureThreshold = threshold;
    this.resetTimeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.nextAttempt = 0;
  }
  
  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  recordFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }
  
  reset() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
}
```

This comprehensive deployment guide should help you successfully deploy and scale PeerPigeon in production environments while maintaining security, performance, and reliability.
