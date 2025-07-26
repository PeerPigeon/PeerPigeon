# PeerPigeon Browser Integration Test

This comprehensive test suite simulates the `npm run dev` environment with 7 Puppeteer browser tabs to test all features of the PeerPigeon mesh networking library.

## Features Tested

### Core Functionality
- ✅ **Connection Management**: Tests signaling server connections
- ✅ **Peer Discovery**: Verifies automatic peer discovery mechanism  
- ✅ **Peer Connections**: Tests peer-to-peer WebRTC connections
- ✅ **Health Checks**: Validates network health monitoring

### Communication
- ✅ **Broadcast Messaging**: Tests messages sent to all connected peers
- ✅ **Direct Messaging**: Tests private messages between specific peers
- ✅ **Manual Connections**: Tests manual peer ID-based connections

### Advanced Features
- ✅ **WebDHT (Distributed Hash Table)**: Tests distributed key-value storage
- ✅ **Crypto Operations**: Tests end-to-end encryption and key management
- ✅ **Distributed Storage**: Tests encrypted peer-to-peer storage layer
- ✅ **Media Streaming**: Tests video/audio capabilities (with fake devices)

### Configuration
- ✅ **Settings Management**: Tests configuration options (min/max peers, routing, etc.)
- ✅ **XOR Routing**: Tests XOR-based peer selection and routing
- ✅ **Auto Discovery**: Tests automatic peer discovery toggle
- ✅ **Eviction Strategy**: Tests smart peer connection management

## Running the Tests

### Quick Start
```bash
# Run with visible browser windows (for debugging)
npm run test:browser

# Run in headless mode (for CI/CD)
npm run test:browser:headless
```

### Manual Test Execution
```bash
# Install dependencies if needed
npm install

# Run the test directly
node test/browser-integration-test.js

# Run in headless mode
HEADLESS=true node test/browser-integration-test.js
```

### Using the Test Runner
```bash
# Uses the helper script that auto-installs dependencies
node test/run-browser-test.js
```

## Test Configuration

The test can be configured via environment variables:

- `HEADLESS=true` - Run in headless mode (no visible browser windows)
- `NUM_PEERS=7` - Number of browser tabs/peers to create (default: 7)
- `SIGNALING_PORT=3000` - Port for the signaling server (default: 3000)
- `HTTP_PORT=8080` - Port for the HTTP server (default: 8080)
- `TEST_TIMEOUT=300000` - Test timeout in milliseconds (default: 5 minutes)

## Test Process

1. **Server Startup**: Starts WebSocket signaling server and HTTP server
2. **Browser Initialization**: Creates 7 Puppeteer browser tabs
3. **Peer Setup**: Generates peer IDs and connects to signaling server
4. **Feature Testing**: Runs comprehensive tests on all features
5. **Report Generation**: Creates detailed test report with pass/fail statistics

## Test Reports

Test reports are automatically saved to `test/reports/` with timestamp:
- JSON format with detailed results
- Pass/fail statistics
- Error details for failed tests
- Performance metrics

## Expected Behavior

### Peer Connections
- All 7 peers should connect to the signaling server
- Peers should discover each other through the mesh protocol
- WebRTC connections should be established between peers
- Average connection count per peer should be > 0

### Messaging
- Broadcast messages should reach multiple peers
- Direct messages should reach specific target peers
- Message logs should show successful delivery

### DHT Operations
- Key-value pairs should be stored successfully
- Data should be retrievable from other peers
- DHT logs should show successful operations

### Crypto Functions
- Keypairs should be generated successfully
- Self-tests should pass
- Public keys should be displayed correctly

### Storage Operations
- Distributed storage should be enabled successfully
- Data should be stored and retrieved
- Storage logs should show successful operations

## Troubleshooting

### Common Issues

**Browser Launch Fails**
```bash
# Install Chromium for Puppeteer
npx puppeteer install
```

**Server Port Conflicts**
```bash
# Kill processes using default ports
lsof -ti:3000 | xargs kill -9
lsof -ti:8080 | xargs kill -9
```

**Permission Errors**
```bash
# Make test files executable
chmod +x test/browser-integration-test.js
chmod +x test/run-browser-test.js
```

**Dependency Issues**
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Debug Mode

For debugging, run with visible browser windows:
```bash
HEADLESS=false node test/browser-integration-test.js
```

This allows you to:
- See browser interactions in real-time
- Inspect network traffic in DevTools
- Monitor console logs
- Verify UI state changes

## Integration with CI/CD

Add to your CI/CD pipeline:

```yaml
# GitHub Actions example
- name: Run Browser Integration Tests
  run: npm run test:browser:headless
  
# Or with custom configuration
- name: Run Browser Tests
  run: HEADLESS=true TIMEOUT=600000 node test/browser-integration-test.js
```

## Architecture

The test architecture consists of:

1. **Test Controller**: Main orchestration class
2. **Server Management**: Manages signaling and HTTP servers
3. **Browser Management**: Controls Puppeteer instances
4. **Feature Testers**: Individual test functions for each feature
5. **Report Generator**: Creates detailed test reports

## Performance Expectations

- **Setup Time**: ~15-30 seconds for server startup and browser initialization
- **Test Duration**: ~2-5 minutes for complete test suite
- **Memory Usage**: ~500MB-1GB for 7 browser instances
- **CPU Usage**: Moderate during WebRTC connection establishment

## Limitations

- Uses fake media devices (no actual camera/microphone testing)
- Network conditions are ideal (localhost)
- Limited to single-machine testing
- Does not test NAT traversal or firewall scenarios
- Browser-specific features may vary across different browsers
