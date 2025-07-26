# PeerPigeon Browser Integration Test - Quick Start Guide

## 🎯 What This Test Does

This comprehensive test suite replaces manual testing by automatically running **7 Puppeteer browser tabs** that simulate the same environment as `npm run dev`, but with full automation and testing of **every feature** in the PeerPigeon browser UI.

## ✨ Features Tested

### Core Mesh Networking
- **Connection Management**: Signaling server connections and disconnections
- **Peer Discovery**: Automatic discovery of nearby peers
- **WebRTC Connections**: Direct peer-to-peer connections
- **Manual Connections**: Connecting to specific peer IDs
- **Health Checks**: Network health monitoring

### Communication
- **Broadcast Messages**: Messages sent to all connected peers
- **Direct Messages**: Private messages between specific peers  
- **Message Delivery**: Verification of message receipt

### Advanced Features
- **WebDHT**: Distributed hash table operations (store/retrieve data)
- **Crypto Operations**: End-to-end encryption, keypair generation, self-tests
- **Distributed Storage**: Encrypted peer-to-peer storage layer
- **Media Streaming**: Video/audio streaming (with fake devices for testing)

### Configuration
- **Settings Management**: Min/max peers, routing options, discovery settings
- **XOR Routing**: XOR-based peer selection and routing
- **Eviction Strategy**: Smart peer connection management

## 🚀 Quick Start

### Run the Test (Recommended)
```bash
# Run with visible browser windows (great for debugging)
npm run test:browser

# Run in headless mode (faster, good for CI/CD)
npm run test:browser:headless
```

### Alternative Methods
```bash
# Direct execution
node test/browser-integration-test.js

# With custom configuration
HEADLESS=true TIMEOUT=600000 node test/browser-integration-test.js

# Check environment first
node test/check-environment.js
```

## 📊 What to Expect

### Test Process
1. **Server Startup** (~10 seconds): Starts signaling and HTTP servers
2. **Browser Launch** (~15 seconds): Opens 7 Puppeteer browser tabs
3. **Peer Setup** (~10 seconds): Generates peer IDs and connects to signaling
4. **Feature Testing** (~2-3 minutes): Tests all features systematically
5. **Report Generation**: Creates detailed JSON report

### Example Output
```
🚀 Starting servers...
✅ Servers started successfully
🌐 Initializing browser with 7 tabs...
📄 Page 1 initialized
📄 Page 2 initialized
...
🔑 Waiting for peer IDs to be generated...
🆔 Peer 1 ID: a1b2c3d4e5f6789012345678901234567890abcd
...
🔗 Connecting all peers to signaling server...
✅ Peer 1 connected
...
💬 Testing messaging functionality...
📨 Broadcast message received by 6/6 peers
📧 Direct message test passed
...
📊 TEST REPORT
==============
Total Tests: 8
Passed: 8
Failed: 0
Pass Rate: 100.00%
```

## 📁 Test Reports

Reports are automatically saved to `test/reports/` with detailed information:

```json
{
  "timestamp": "2025-01-01T12:00:00.000Z",
  "totalPeers": 7,
  "testResults": {
    "total": 8,
    "passed": 8,
    "failed": 0,
    "errors": []
  },
  "summary": {
    "passRate": "100.00%",
    "totalTests": 8,
    "passed": 8,
    "failed": 0
  }
}
```

## 🛠️ Configuration Options

### Environment Variables
- `HEADLESS=true|false` - Run browsers in headless mode
- `NUM_PEERS=7` - Number of browser instances (default: 7)
- `SIGNALING_PORT=3000` - Signaling server port
- `HTTP_PORT=8080` - HTTP server port  
- `TEST_TIMEOUT=300000` - Overall test timeout (5 minutes)

### Custom Test Scenarios
The test is designed to be easily extensible. You can:
- Modify `NUM_PEERS` to test different network sizes
- Add new test functions for additional features
- Adjust timeouts for slower systems
- Configure different port combinations

## 🐛 Troubleshooting

### Common Issues

**Chromium Download Issues**
```bash
npx puppeteer install
```

**Port Conflicts**
```bash
# Kill processes using default ports
lsof -ti:3000 | xargs kill -9
lsof -ti:8080 | xargs kill -9
```

**Permission Issues**  
```bash
chmod +x test/*.js
```

**Memory Issues (7 browsers can be intensive)**
```bash
# Reduce number of peers
NUM_PEERS=3 npm run test:browser
```

### Debug Mode
Run with visible browsers to see what's happening:
```bash
HEADLESS=false node test/browser-integration-test.js
```

## 🔄 Integration with Development Workflow

### Replace Manual Testing
Instead of manually running `npm run dev` and testing features by hand:
```bash
# Old way (manual)
npm run dev
# Then manually test features in multiple browser tabs

# New way (automated)
npm run test:browser
```

### CI/CD Integration
```yaml
# GitHub Actions example
- name: Browser Integration Tests
  run: npm run test:browser:headless
  timeout-minutes: 10
```

## 🎯 Test Coverage

This test provides comprehensive coverage of:

✅ **100% of UI features** in the browser example  
✅ **All mesh networking functionality**  
✅ **WebRTC connection establishment**  
✅ **DHT and storage operations**  
✅ **Crypto and security features**  
✅ **Configuration and settings**  
✅ **Error handling and edge cases**  

## 🚀 Next Steps

1. **Run the environment check**: `node test/check-environment.js`
2. **Run your first test**: `npm run test:browser`
3. **Check the generated report** in `test/reports/`
4. **Integrate into your development workflow**
5. **Customize for your specific needs**

The test is designed to be a **drop-in replacement** for manual browser testing, providing automated verification of all PeerPigeon features with detailed reporting and debugging capabilities.
