# PeerPigeon Selective Streaming Guide

## Overview

PeerPigeon now supports **selective streaming**, allowing you to control exactly which peers receive your media streams. This enables sophisticated streaming patterns including 1:1, 1:many, and many:many configurations with individual peer control.

## Key Features

- **🎯 Selective Streaming**: Stream to specific peers only
- **📡 Broadcast Mode**: Traditional stream-to-all behavior  
- **🔧 Dynamic Control**: Block/allow peers during active streaming
- **👥 Multiple Patterns**: Support for 1:1, 1:many, many:many topologies
- **📊 Status Monitoring**: Real-time streaming status for all peers

## API Reference

### Core Methods

#### `startSelectiveStream(peerIds, options)`
Start streaming to specific peers only.

```javascript
// 1:1 streaming (single peer)
await mesh.startSelectiveStream('peer-id-123', {
    video: true, 
    audio: true
});

// 1:many streaming (multiple peers)
await mesh.startSelectiveStream([
    'peer-id-123', 
    'peer-id-456', 
    'peer-id-789'
], {
    video: true, 
    audio: true
});
```

**Parameters:**
- `peerIds` (string | string[]): Target peer ID(s) to stream to
- `options` (Object): Media stream options
  - `video` (boolean): Enable video streaming
  - `audio` (boolean): Enable audio streaming
  - `deviceIds` (Object): Specific device IDs for camera/microphone

**Returns:** `Promise<MediaStream>` - The local media stream

#### `stopSelectiveStream(returnToBroadcast)`
Stop selective streaming with option to switch to broadcast mode.

```javascript
// Stop streaming entirely
await mesh.stopSelectiveStream(false);

// Stop selective and switch to broadcast mode
await mesh.stopSelectiveStream(true);
```

**Parameters:**
- `returnToBroadcast` (boolean): If true, switch to broadcast mode; if false, stop entirely

#### `enableStreamingForAllPeers()`
Switch to broadcast mode - stream to all connected peers.

```javascript
await mesh.enableStreamingForAllPeers();
```

#### `blockStreamingToPeers(peerIds)`
Block streaming to specific peers while maintaining streams to others.

```javascript
// Block streaming to specific peers
await mesh.blockStreamingToPeers(['peer-id-456', 'peer-id-789']);

// Block single peer
await mesh.blockStreamingToPeers('peer-id-123');
```

#### `allowStreamingToPeers(peerIds)`
Re-enable streaming to previously blocked peers.

```javascript
// Allow streaming to specific peers
await mesh.allowStreamingToPeers(['peer-id-456', 'peer-id-789']);

// Allow single peer
await mesh.allowStreamingToPeers('peer-id-123');
```

### Status Methods

#### `getStreamingStatus()`
Get detailed streaming status for all connected peers.

```javascript
const status = mesh.getStreamingStatus();
// Returns Map<string, StreamingStatus>
// StreamingStatus: {
//   sendingStream: boolean,
//   receivingStreams: boolean, 
//   streamType: 'broadcast' | 'selective' | 'none'
// }
```

#### `isStreamingToAll()`
Check if currently streaming to all connected peers.

```javascript
const isBroadcast = mesh.isStreamingToAll();
// Returns boolean
```

#### `getStreamingPeers()`
Get list of peers currently receiving streams.

```javascript
const streamingPeers = mesh.getStreamingPeers();
// Returns string[] - Array of peer IDs
```

#### `getBlockedStreamingPeers()`
Get list of peers blocked from receiving streams.

```javascript
const blockedPeers = mesh.getBlockedStreamingPeers();
// Returns string[] - Array of peer IDs
```

## Events

The selective streaming system emits several new events:

### `selectiveStreamStarted`
Fired when selective streaming begins.

```javascript
mesh.addEventListener('selectiveStreamStarted', (data) => {
    console.log(`Selective ${data.streamType} streaming started`);
    console.log(`Target peers: ${data.targetPeerIds.join(', ')}`);
    console.log(`Stream:`, data.stream);
});
```

### `selectiveStreamStopped`
Fired when selective streaming stops.

```javascript
mesh.addEventListener('selectiveStreamStopped', (data) => {
    console.log(`Selective streaming stopped`);
    console.log(`Switched to broadcast: ${data.returnToBroadcast}`);
});
```

### `broadcastStreamEnabled`
Fired when broadcast mode is enabled.

```javascript
mesh.addEventListener('broadcastStreamEnabled', () => {
    console.log('Broadcasting to all peers');
});
```

### `streamingBlockedToPeers`
Fired when peers are blocked from streaming.

```javascript
mesh.addEventListener('streamingBlockedToPeers', (data) => {
    console.log(`Blocked peers: ${data.blockedPeerIds.join(', ')}`);
});
```

### `streamingAllowedToPeers`
Fired when peers are allowed streaming access.

```javascript
mesh.addEventListener('streamingAllowedToPeers', (data) => {
    console.log(`Allowed peers: ${data.allowedPeerIds.join(', ')}`);
});
```

## Streaming Patterns

### 1:1 Streaming (Private Call)
Stream to exactly one peer for private communication.

```javascript
// Start 1:1 streaming
await mesh.startSelectiveStream('target-peer-id', {
    video: true,
    audio: true
});

console.log('Private call started');
```

### 1:Many Streaming (Broadcast to Group)
Stream to multiple selected peers (like a webinar or presentation).

```javascript
// Select target audience
const audience = ['peer-1', 'peer-2', 'peer-3'];

// Start group streaming
await mesh.startSelectiveStream(audience, {
    video: true,
    audio: true
});

console.log(`Presenting to ${audience.length} participants`);
```

### Many:Many Streaming (Conference)
Multiple peers streaming to each other in various patterns.

```javascript
// Each peer can define their own streaming targets
// Peer A streams to B and C
await meshA.startSelectiveStream(['peer-b', 'peer-c'], options);

// Peer B streams to A and C  
await meshB.startSelectiveStream(['peer-a', 'peer-c'], options);

// Peer C streams only to A (selective participation)
await meshC.startSelectiveStream(['peer-a'], options);
```

### Dynamic Control During Streaming
Modify streaming targets while active.

```javascript
// Start streaming to group
await mesh.startSelectiveStream(['peer-1', 'peer-2', 'peer-3'], options);

// Later: Block disruptive participant
await mesh.blockStreamingToPeers(['peer-2']);

// Later: Allow them back
await mesh.allowStreamingToPeers(['peer-2']);

// Or switch to broadcast mode
await mesh.stopSelectiveStream(true);
```

## Migration from Traditional Broadcasting

### Before (Traditional Broadcasting)
```javascript
// Old way - always streams to ALL connected peers
await mesh.startMedia({
    video: true,
    audio: true
});
// No control over who receives the stream
```

### After (Selective Streaming)
```javascript
// New way - full control over streaming targets

// Option 1: Selective streaming
await mesh.startSelectiveStream(['peer-1', 'peer-2'], {
    video: true,
    audio: true
});

// Option 2: Traditional broadcast (still supported)
await mesh.enableStreamingForAllPeers();
await mesh.startMedia({
    video: true,
    audio: true
});

// Option 3: Use new selective method for broadcast
await mesh.startSelectiveStream(mesh.getConnectedPeerIds(), options);
```

## Best Practices

### 1. Check Connected Peers
Always verify peers are connected before starting selective streaming.

```javascript
const connectedPeers = mesh.getConnectedPeerIds();
const targetPeers = ['peer-1', 'peer-2'];

// Filter to only connected targets
const validTargets = targetPeers.filter(id => connectedPeers.includes(id));

if (validTargets.length > 0) {
    await mesh.startSelectiveStream(validTargets, options);
} else {
    console.log('No valid targets for streaming');
}
```

### 2. Monitor Streaming Status
Use status methods to keep UI updated.

```javascript
function updateStreamingUI() {
    const isStreaming = mesh.isStreamingToAll();
    const streamingPeers = mesh.getStreamingPeers();
    const blockedPeers = mesh.getBlockedStreamingPeers();
    
    document.getElementById('streaming-mode').textContent = 
        isStreaming ? 'Broadcast' : 'Selective';
    document.getElementById('active-peers').textContent = 
        streamingPeers.length;
    document.getElementById('blocked-peers').textContent = 
        blockedPeers.length;
}

// Update on any streaming event
mesh.addEventListener('selectiveStreamStarted', updateStreamingUI);
mesh.addEventListener('streamingBlockedToPeers', updateStreamingUI);
mesh.addEventListener('streamingAllowedToPeers', updateStreamingUI);
```

### 3. Handle Errors Gracefully
Always wrap streaming operations in try-catch blocks.

```javascript
async function startConferenceCall(participants) {
    try {
        await mesh.startSelectiveStream(participants, {
            video: true,
            audio: true
        });
        console.log('Conference started successfully');
    } catch (error) {
        console.error('Failed to start conference:', error);
        
        // Fallback to broadcast mode
        try {
            await mesh.enableStreamingForAllPeers();
            await mesh.startMedia({ video: true, audio: true });
            console.log('Fallback to broadcast mode');
        } catch (fallbackError) {
            console.error('All streaming methods failed:', fallbackError);
        }
    }
}
```

### 4. Cleanup on Disconnect
Stop streaming when peers disconnect.

```javascript
mesh.addEventListener('peerDisconnected', async (data) => {
    const disconnectedPeer = data.peerId;
    const streamingPeers = mesh.getStreamingPeers();
    
    // If we were streaming only to the disconnected peer
    if (streamingPeers.length === 1 && streamingPeers[0] === disconnectedPeer) {
        await mesh.stopSelectiveStream(false);
        console.log('Stopped streaming - target peer disconnected');
    }
});
```

## Demo and Examples

Check out the complete demo at `examples/selective-streaming-demo.html` for a working implementation with UI controls.

### Running the Demo

1. Start a signaling server:
```bash
npm run server
# or directly:
# node server/start.js
```

2. Open the demo in multiple browser tabs:
```bash
# Open examples/selective-streaming-demo.html in 2+ browser tabs
```

3. Connect all tabs to the signaling server
4. Experiment with different streaming patterns using the UI controls

## Backward Compatibility

All existing PeerPigeon applications continue to work unchanged. The traditional `startMedia()` method still broadcasts to all connected peers by default. Selective streaming is purely additive functionality.

## Use Cases

- **Video Conferences**: Each participant can choose who they stream to
- **Webinars**: Host streams to all, participants can selectively unmute to specific people
- **Private Calls**: 1:1 streaming for confidential conversations  
- **Breakout Rooms**: Dynamic group formation with selective streaming
- **Gaming**: Players can stream to teammates but not opponents
- **Education**: Teachers can create focused groups for different lesson components
- **Moderation**: Ability to block disruptive participants while maintaining streams to others

## Performance Considerations

- Selective streaming can reduce bandwidth usage by limiting stream targets
- Each peer connection requires separate encoding, so many targets still use significant resources
- The mesh forwarding system automatically handles indirect peer connections
- Monitor connection quality and adjust streaming targets accordingly

## Troubleshooting

### Common Issues

1. **"No peers selected" error**: Ensure you've selected peers in the UI or passed valid peer IDs
2. **Streaming not working**: Check that crypto keys are exchanged and data channels are ready
3. **Peers not receiving streams**: Verify the target peers have called `allowRemoteStreamEmission()`
4. **Performance issues**: Reduce number of streaming targets or lower video quality

### Debug Information

```javascript
// Check streaming status
console.log('Streaming Status:', mesh.getStreamingStatus());
console.log('Connected Peers:', mesh.getConnectedPeerIds());
console.log('Streaming To:', mesh.getStreamingPeers());
console.log('Blocked Peers:', mesh.getBlockedStreamingPeers());

// Monitor events
mesh.addEventListener('selectiveStreamStarted', console.log);
mesh.addEventListener('streamingBlockedToPeers', console.log);
mesh.addEventListener('streamingAllowedToPeers', console.log);
```
