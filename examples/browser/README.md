# PeerPigeon Browser-3 Example - Complete API Testing Suite

This is a comprehensive browser-based testing interface for all PeerPigeon features. It provides a complete testing environment with tabbed interface for testing every aspect of the PeerPigeon mesh networking library.

## Features Tested

### 🌐 Connection Management
- **Signaling Server Connection**: Connect/disconnect from WebSocket signaling servers
- **Mesh Configuration**: Configure max/min peers, auto-discovery, eviction strategy, XOR routing
- **Peer Management**: View connected peers, manually connect to specific peers, force connection attempts
- **Cleanup Operations**: Clean stale signaling data and connection management

### 💬 Messaging & Communication
- **Broadcast Messages**: Send messages to all peers in the mesh network
- **Direct Messages**: Send targeted messages to specific peers
- **Message History**: Complete log of sent and received messages with timestamps
- **Message Types**: Support for text, JSON objects, and encrypted content

### 🎥 Media Management
- **Local Media Streams**: Start/stop camera and microphone
- **Device Selection**: Choose specific cameras and microphones
- **Media Controls**: Toggle video/audio on/off during active streams
- **Remote Streams**: Display incoming video/audio from connected peers
- **Device Enumeration**: Refresh and list available media devices

### 🗄️ Distributed Hash Table (DHT)
- **Data Storage**: Store key-value pairs across the distributed network
- **Data Retrieval**: Get stored values by key
- **Data Updates**: Update existing values with merge options
- **Data Deletion**: Remove keys from the distributed storage
- **Subscriptions**: Subscribe to key changes and receive notifications
- **Storage Spaces**: Use different storage spaces (private, public, frozen)
- **TTL Support**: Set time-to-live for stored data

### 🔐 Encryption & Security
- **Encrypted Messaging**: Send encrypted broadcasts with optional group IDs
- **Key Exchange**: Automated key exchange between peers
- **Manual Key Management**: Manually add peer public keys
- **Crypto Status**: Monitor encryption system status and key exchanges
- **Group Encryption**: Support for group-based encryption keys

### 📊 Network Information & Monitoring
- **Network Status**: Real-time connection status, peer counts, uptime
- **Peer State Summary**: Detailed view of all peer connection states
- **Connection Monitoring**: Start/stop connection health monitoring
- **Connectivity Debugging**: Debug connectivity issues
- **Discovered Peers**: List of all discovered peers in the network

### 🧪 API Testing & Utilities
- **Utility Functions**: Validate peer IDs, force connections, cleanup operations
- **Performance Testing**: Test message throughput and system performance
- **Stress Testing**: High-load testing with rapid operations
- **Error Testing**: Test system behavior with invalid inputs
- **Log Export**: Export all logs and test results as JSON
- **Test Results**: Comprehensive logging of all test operations

## Usage

### Prerequisites
1. Start the PeerPigeon development environment:
   ```bash
   npm run dev
   ```
   This starts both the signaling server (ws://localhost:3000) and HTTP server (http://localhost:8080)

2. Open multiple browser windows/tabs to simulate multiple peers

### Getting Started

1. **Open the Testing Suite**
   - Navigate to `http://localhost:8080/examples/browser-3/`
   - The interface will automatically initialize PeerPigeon with all features enabled

2. **Connect to Signaling Server**
   - Default URL: `ws://localhost:3000`
   - Click "Connect" button
   - Status will update to show connection state

3. **Test Features**
   - Use the tabbed interface to explore different feature categories
   - Each tab contains comprehensive testing tools for that feature set
   - System log at the bottom shows all activity

### Testing Workflows

#### Basic Connectivity Test
1. Open 2+ browser windows with the testing suite
2. Connect all instances to the signaling server
3. Verify peers appear in the "Connected Peers" list
4. Test broadcast and direct messaging

#### Media Streaming Test
1. Grant camera/microphone permissions
2. Select desired devices in Media tab
3. Enable video/audio and start media
4. Verify local video preview appears
5. Check remote streams from other connected peers

#### DHT Storage Test
1. Store data using the DHT interface
2. Retrieve data from other peer instances
3. Test subscriptions by updating values
4. Verify real-time notifications work

#### Encryption Test
1. Send encrypted broadcasts
2. Verify automatic key exchange occurs
3. Test manual key management
4. Confirm encrypted messages are received and decrypted

#### Performance Testing
1. Use the API Testing tab
2. Configure message count and size
3. Run performance tests
4. Monitor results and system performance

## File Structure

```
examples/browser-3/
├── index.html          # Main HTML interface with tabbed layout
├── styles.css          # Comprehensive CSS styling
├── app.js             # Complete JavaScript application
└── README.md          # This documentation file
```

## API Coverage

This testing suite exercises the complete PeerPigeon API:

### Core PeerPigeonMesh Methods
- `new PeerPigeonMesh(options)` - Initialization with all options
- `init()` - System initialization
- `connect(url)` - Signaling server connection
- `disconnect()` - Clean disconnection
- `getStatus()` - Network status information
- `getPeers()` - Connected peer information
- `getConnectedPeerIds()` - Peer ID lists
- `getDiscoveredPeers()` - Discovery information

### Configuration Methods
- `setMaxPeers(n)` - Maximum peer limit
- `setMinPeers(n)` - Minimum peer requirement
- `setAutoDiscovery(enabled)` - Auto-discovery toggle
- `setEvictionStrategy(enabled)` - Eviction strategy toggle
- `setXorRouting(enabled)` - XOR routing toggle

### Messaging Methods
- `sendMessage(content)` - Broadcast messages
- `sendDirectMessage(peerId, content)` - Direct messages
- `sendEncryptedBroadcast(content, groupId)` - Encrypted broadcasts

### Media Methods
- `initializeMedia()` - Media system initialization
- `startMedia(options)` - Start local media streams
- `stopMedia()` - Stop media streams
- `toggleVideo()` - Video track control
- `toggleAudio()` - Audio track control
- `enumerateMediaDevices()` - Device enumeration
- `getMediaState()` - Media status information
- `getLocalStream()` - Local stream access
- `getRemoteStreams()` - Remote stream access

### DHT Methods
- `dhtPut(key, value, options)` - Store data
- `dhtGet(key, options)` - Retrieve data
- `dhtUpdate(key, value, options)` - Update data
- `dhtDelete(key)` - Delete data
- `dhtSubscribe(key)` - Subscribe to changes
- `dhtUnsubscribe(key)` - Unsubscribe from changes

### Crypto Methods
- `exchangeKeysWithPeer(peerId)` - Key exchange
- `addPeerKey(peerId, publicKey)` - Manual key management
- `getPublicKey()` - Public key access

### Utility Methods
- `cleanupStaleSignalingData()` - Cleanup operations
- `forceConnectToAllPeers()` - Force connections
- `debugConnectivity()` - Debug information
- `getPeerStateSummary()` - Peer state information
- `startConnectionMonitoring()` - Connection monitoring
- `stopConnectionMonitoring()` - Stop monitoring
- `canAcceptMorePeers()` - Connection capacity
- `hasPeer(peerId)` - Peer existence check
- `validatePeerId(peerId)` - Peer ID validation

### Event Listeners
All PeerPigeon events are monitored and logged:
- `statusChanged` - Connection status changes
- `peerConnected` - New peer connections
- `peerDisconnected` - Peer disconnections
- `peerDiscovered` - Peer discovery
- `messageReceived` - Incoming messages
- `dhtValueChanged` - DHT value changes
- `localStreamStarted` - Local media started
- `localStreamStopped` - Local media stopped
- `remoteStream` - Remote media streams
- `mediaError` - Media errors
- `cryptoReady` - Encryption ready
- `cryptoError` - Encryption errors
- `peerKeyAdded` - Key exchange completion
- `connectionStats` - Connection statistics

## Features

### User Interface
- **Tabbed Navigation**: Organized feature testing by category
- **Real-time Updates**: Live status updates and peer information
- **Comprehensive Logging**: Detailed logs for all operations
- **Responsive Design**: Works on desktop and mobile devices
- **Dark/Light Theme**: Professional styling with clear visual hierarchy

### Error Handling
- **Graceful Degradation**: Handles API errors without breaking interface
- **Validation**: Input validation for all user inputs
- **Error Reporting**: Clear error messages with context
- **Recovery Options**: Ways to recover from error states

### Performance Monitoring
- **Message Metrics**: Track sent/received message counts
- **Connection Stats**: Monitor bandwidth and connection quality
- **System Performance**: Test system limits and performance
- **Export Functionality**: Export all logs and metrics

## Troubleshooting

### Common Issues

1. **Connection Failed**
   - Verify signaling server is running (`npm run dev`)
   - Check WebSocket URL format
   - Ensure firewall/proxy allows WebSocket connections

2. **Media Not Working**
   - Grant camera/microphone permissions
   - Check device availability in browser settings
   - Try different cameras/microphones

3. **DHT Operations Failing**
   - Ensure peers are connected
   - Check data size limits
   - Verify JSON format for values

4. **No Remote Streams**
   - Verify both peers have started media
   - Check WebRTC connectivity
   - Look for firewall/NAT issues

### Debug Information

Use the following features for debugging:
1. **System Log**: Monitor all system activity
2. **Network Info Tab**: Check connection status and peer states
3. **Debug Connectivity**: Get detailed connectivity information
4. **Export Logs**: Save logs for analysis

## Development

To modify or extend this testing suite:

1. **Add New Tests**: Extend the testing controls in `setupTestingControls()`
2. **Add New Features**: Create new tabs and corresponding functionality
3. **Modify UI**: Update `styles.css` for visual changes
4. **Add Event Handling**: Extend `setupEventListeners()` for new events

## Contributing

This testing suite serves as both a comprehensive API test and a reference implementation. When adding new PeerPigeon features, update this testing suite to include:

1. New API method tests
2. New event listener coverage
3. New configuration options
4. Updated documentation

## License

This example is part of the PeerPigeon project and follows the same license terms.
