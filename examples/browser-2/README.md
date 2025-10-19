# PeerPigeon Vue 3 Testing Example

This is a comprehensive Vue 3 example showcasing all PeerPigeon features with an integrated testing suite, similar to the browser example.

## Features

### Core Features (All Tabs)
- **Network**: Connection management, peer discovery, network namespaces
- **Messaging**: Broadcast and direct messaging between peers
- **Media**: Audio/video streaming with WebRTC
- **DHT**: Distributed Hash Table for key-value storage
- **Storage**: Distributed storage across peers
- **Crypto**: End-to-end encryption for messages and data
- **Debug**: Debug logging and module control
- **Testing**: Comprehensive API testing suite ✨ **NEW**

### Testing Suite

The Testing tab provides comprehensive testing capabilities similar to the browser example:

#### Quick Tests
- **Validate Peer ID**: Test peer ID validation logic
- **Performance Test**: Send multiple messages to measure throughput
- **Stress Test**: Combined DHT and messaging stress test
- **Invalid Peer Test**: Test error handling for invalid peer connections
- **Malformed Message Test**: Test handling of malformed message data
- **DHT Limits Test**: Test DHT with large data payloads

#### Test Configuration
- Configurable peer ID for validation
- Adjustable message count (1-1000)
- Adjustable message size (1-10,000 characters)

#### Test Results
- Real-time test result display
- Color-coded status indicators (success, error, warning, info)
- Detailed test output with timestamps
- Export capabilities for results and logs

#### Performance Metrics
- Messages sent/received counters
- DHT operations counter
- Test duration tracking
- Success rate calculation
- Average response time measurement

#### Export Options
- Export all logs (includes messages, debug logs, network status)
- Export test results only
- Export performance metrics
- JSON format for easy analysis

## Getting Started

### Prerequisites
```bash
npm install
```

**Important:** Make sure the PeerPigeon library is built first:
```bash
# From the root PeerPigeon directory
cd /path/to/PeerPigeon
npm run build

# Then return to browser-2
cd examples/browser-2
npm install
```

### Development
```bash
npm run dev
```

This will:
1. Copy the PeerPigeon library to the public folder
2. Start the Vite dev server

Open your browser to http://localhost:5173

**Note:** If you see "mock-peer-..." as your Peer ID, the PeerPigeon library didn't load correctly. Check the browser console for errors.

### Production Build
```bash
npm run build
npm run preview
```

## Architecture

### Vue 3 + Vite
- Modern Vue 3 with Composition API
- Vite for fast development and optimized builds
- Component-based architecture

### State Management
- Pinia store for centralized state
- Reactive data with Vue refs/reactive
- Event-driven updates from PeerPigeon mesh

### Router
- Vue Router for navigation between features
- Clean URL structure
- Tab-based navigation UI

## Testing Features

### Test Types

#### 1. Peer ID Validation
Tests the peer ID validation logic to ensure proper format and length requirements.

#### 2. Performance Test
Sends a configurable number of messages to measure:
- Message throughput (messages per second)
- Success/failure rates
- Average response time
- System performance under load

#### 3. Stress Test
Combines multiple operations:
- 20 DHT put operations
- 50 broadcast messages
- Measures overall system stability
- Reports success rates across operation types

#### 4. Error Handling Tests
- Invalid peer connections
- Malformed message data
- DHT data limits
- Ensures graceful error handling

### Using the Testing Suite

1. **Connect to Signaling Server**
   - Enter server URL (default: ws://localhost:3000)
   - Click "Connect"

2. **Navigate to Testing Tab**
   - Click the 🧪 Testing tab

3. **Configure Tests**
   - Adjust message count and size as needed
   - Enter peer IDs for validation tests

4. **Run Tests**
   - Click any quick test button
   - Watch results appear in real-time

5. **Export Results**
   - Use export buttons to save test data
   - Analyze results externally if needed

## Comparison with Browser Example

The browser-2 (Vue) testing implementation mirrors the browser example's capabilities:

| Feature | Browser Example | Browser-2 (Vue) |
|---------|----------------|-----------------|
| API Testing | ✅ | ✅ |
| Performance Tests | ✅ | ✅ |
| Stress Tests | ✅ | ✅ |
| Error Handling Tests | ✅ | ✅ |
| Export Functionality | ✅ | ✅ |
| Metrics Tracking | ✅ | ✅ |
| Real-time Results | ✅ | ✅ |
| Modern UI Framework | Vanilla JS | Vue 3 |
| State Management | Class-based | Pinia Store |
| Component Architecture | Monolithic | Modular Components |

## Development

### Adding New Tests

To add a new test to the testing suite:

1. Add a button in the Quick Tests section:
```vue
<button @click="myNewTest" class="btn btn-primary">
  🆕 My New Test
</button>
```

2. Implement the test method:
```javascript
const myNewTest = async () => {
  try {
    // Your test logic here
    const result = await store.someMethod();
    
    addTestResult(
      'My New Test',
      `Test completed: ${result}`,
      'success'
    );
  } catch (error) {
    addTestResult(
      'My New Test',
      `Test failed: ${error.message}`,
      'error',
      error.message
    );
  }
};
```

### Customizing Metrics

Edit `performanceMetrics` ref in TestingView.vue to add new metrics:

```javascript
const performanceMetrics = ref({
  messagesSent: 0,
  messagesReceived: 0,
  dhtOperations: 0,
  myCustomMetric: 0, // Add your metric
  duration: 0,
  // ...
});
```

## Troubleshooting

### PeerPigeon Not Loading (Mock Peer ID)
If you see a peer ID like `mock-peer-xxxxx`, the PeerPigeon library isn't loading:

1. **Check if the library file exists:**
   ```bash
   ls public/peerpigeon-browser.js
   ```

2. **Rebuild PeerPigeon if missing:**
   ```bash
   cd ../..
   npm run build
   cd examples/browser-2
   npm run copy-peerpigeon
   ```

3. **Check browser console for errors:**
   - Open DevTools (F12)
   - Look for 404 errors loading `/peerpigeon-browser.js`
   - Look for script loading errors

4. **Verify the script loads before Vue:**
   - The script tag for PeerPigeon MUST come before the Vue module script
   - Check `index.html` - PeerPigeon should load first

5. **Hard refresh the browser:**
   - Press Ctrl+Shift+R (or Cmd+Shift+R on Mac)
   - Clear cache and reload

### No Peers Connecting
If PeerPigeon loads but no peers connect:

1. **Ensure signaling server is running:**
   ```bash
   # In the root PeerPigeon directory
   npm run dev-server
   ```

2. **Check the signaling server URL:**
   - Default: `ws://localhost:3000`
   - Must use `ws://` not `wss://` for local development
   - Make sure the port matches your server

3. **Open another tab/browser:**
   - PeerPigeon needs at least 2 peers to connect
   - Open http://localhost:5173 in another tab
   - Or use the original browser example: `examples/browser/index.html`

4. **Check browser console:**
   - Look for WebSocket connection errors
   - Look for WebRTC connection errors
   - Check the Network tab for failed connections

5. **Verify network name:**
   - Both peers must use the same network name
   - Default is "global"
   - Network names are case-sensitive

### Build Issues
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Connection Issues
- Ensure signaling server is running
- Check WebSocket URL (ws:// not wss:// for local)
- Verify network connectivity

### Test Failures
- Connect to signaling server first
- Ensure at least one peer is connected for network tests
- Check browser console for detailed error messages

## License

See main PeerPigeon project license.
