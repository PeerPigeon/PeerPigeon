# Binary Message Support

PeerPigeon now supports sending and receiving binary data (Uint8Array, ArrayBuffer, etc.) directly over WebRTC data channels without JSON serialization overhead.

## Overview

Prior to this feature, all messages were JSON-serialized, which made sending binary data inefficient and potentially corrupted the data. The new binary message support allows you to send raw binary data efficiently for use cases like:

- File transfers
- Image/video streaming
- Audio data
- Binary protocols
- Encrypted data
- Large datasets
- Custom binary formats

## How It Works

When you send binary data:

1. **Detection**: PeerPigeon detects if the message is an ArrayBuffer or TypedArray (like Uint8Array)
2. **Header**: A small JSON header is sent first indicating binary data follows
3. **Binary Transfer**: The actual binary data is sent directly over the data channel
4. **Reception**: The receiver gets a `binaryMessageReceived` event with the Uint8Array data

This approach preserves the binary data perfectly while maintaining backward compatibility with JSON messages.

## API

### Sending Binary Data

#### Send to Specific Peer

```javascript
const mesh = new PeerPigeonMesh({ /* options */ });

// Create binary data
const data = new Uint8Array([1, 2, 3, 4, 5]);

// Send to specific peer
const success = await mesh.sendBinaryData(targetPeerId, data);
console.log(`Sent: ${success}`);
```

#### Broadcast to All Peers

```javascript
// Broadcast binary data to all connected peers
const sentCount = await mesh.broadcastBinaryData(data);
console.log(`Sent to ${sentCount} peers`);
```

### Receiving Binary Data

Listen for the `binaryMessageReceived` event:

```javascript
mesh.addEventListener('binaryMessageReceived', (event) => {
  const { from, data, size } = event;
  
  console.log(`Received ${size} bytes from ${from}`);
  console.log(`Data:`, data); // Uint8Array
  
  // Use the binary data
  processData(data);
});
```

## Examples

### Example 1: Send Text as Binary

```javascript
// Encode text as binary
const encoder = new TextEncoder();
const text = "Hello, PeerPigeon!";
const binaryData = encoder.encode(text);

// Send
await mesh.sendBinaryData(targetPeerId, binaryData);

// Receive and decode
mesh.addEventListener('binaryMessageReceived', (event) => {
  const decoder = new TextDecoder();
  const text = decoder.decode(event.data);
  console.log('Received text:', text);
});
```

### Example 2: Send Random Binary Data

```javascript
// Generate random binary data
const size = 1024; // 1KB
const randomData = new Uint8Array(size);
crypto.getRandomValues(randomData);

// Broadcast to all peers
const count = await mesh.broadcastBinaryData(randomData);
console.log(`Broadcasted ${size} bytes to ${count} peers`);
```

### Example 3: Send File Data

```javascript
// Read file as binary
const fileInput = document.getElementById('file-input');
const file = fileInput.files[0];

const arrayBuffer = await file.arrayBuffer();
const uint8Array = new Uint8Array(arrayBuffer);

// Send file data
await mesh.sendBinaryData(targetPeerId, uint8Array);
```

### Example 4: Send Image Data

```javascript
// Get image data from canvas
const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

// Send image data as binary
await mesh.sendBinaryData(targetPeerId, imageData.data);

// Receive and display
mesh.addEventListener('binaryMessageReceived', (event) => {
  const receivedCanvas = document.getElementById('receivedCanvas');
  const ctx = receivedCanvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(event.data);
  ctx.putImageData(imageData, 0, 0);
});
```

### Example 5: Chunked File Transfer

```javascript
// Send large file in chunks
async function sendFileInChunks(peerId, file, chunkSize = 16384) {
  const arrayBuffer = await file.arrayBuffer();
  const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
    const chunk = new Uint8Array(arrayBuffer.slice(start, end));
    
    await mesh.sendBinaryData(peerId, chunk);
    console.log(`Sent chunk ${i + 1}/${totalChunks}`);
  }
}
```

## Event Details

### binaryMessageReceived Event

```typescript
interface BinaryMessageEvent {
  from: string;      // Peer ID of sender
  data: Uint8Array;  // Binary data
  size: number;      // Size in bytes
  timestamp: number; // When received (Date.now())
}
```

## Performance Considerations

### Advantages of Binary Messages

- **Efficiency**: No JSON serialization overhead
- **Integrity**: Binary data is preserved exactly
- **Speed**: Direct ArrayBuffer transfer is faster
- **Size**: No base64 encoding bloat (33% overhead)

### Size Limits

WebRTC data channels have a maximum message size limit (typically 16KB-64KB depending on browser). For larger data:

1. **Chunking**: Split data into smaller chunks
2. **Streaming**: Send data progressively
3. **Compression**: Use compression libraries before sending

```javascript
// Example: Chunk large data
function chunkData(data, chunkSize = 16384) {
  const chunks = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks;
}

// Send chunks
for (const chunk of chunkData(largeData)) {
  await mesh.sendBinaryData(peerId, chunk);
}
```

## Comparison with JSON Messages

### Before (JSON Serialization)

```javascript
// Binary data must be converted to base64
const base64 = btoa(String.fromCharCode(...binaryData));
await mesh.sendMessage({ type: 'binary', data: base64 });

// 33% size increase due to base64 encoding
// JSON serialization overhead
// Data type conversion overhead
```

### After (Native Binary)

```javascript
// Send binary data directly
await mesh.sendBinaryData(peerId, binaryData);

// No size increase
// No serialization overhead
// Direct ArrayBuffer transfer
```

## Demo

Run the included demo to see binary messages in action:

```bash
npm run dev
# Open http://localhost:8080/examples/binary-message-demo.html
# Open in multiple browser tabs to test
```

The demo allows you to:
- Send random binary data
- Send test patterns
- Send text as binary
- Broadcast to all peers
- Monitor bytes sent/received
- View hex dumps of data

## Browser Compatibility

Binary message support works in all browsers that support:
- WebRTC RTCDataChannel
- ArrayBuffer
- Uint8Array
- TextEncoder/TextDecoder (for text encoding)

This includes all modern browsers (Chrome, Firefox, Safari, Edge).

## Implementation Details

### Message Flow

1. **Sender Side** (`PeerConnection.sendMessage`):
   ```javascript
   if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
     // Send header
     dataChannel.send(JSON.stringify({ type: '__BINARY__', size }));
     // Send binary data
     dataChannel.send(buffer);
   }
   ```

2. **Receiver Side** (`PeerConnection.onmessage`):
   ```javascript
   if (event.data instanceof ArrayBuffer) {
     if (this._expectingBinaryMessage) {
       emit('message', { type: 'binary', data: new Uint8Array(event.data) });
     }
   }
   ```

3. **Application Level** (`ConnectionManager.handleIncomingMessage`):
   ```javascript
   if (message.type === 'binary') {
     mesh.emit('binaryMessageReceived', { from, data, size });
   }
   ```

## Troubleshooting

### Binary Data Not Received

- Check browser console for errors
- Ensure both peers have updated PeerPigeon version
- Verify data channel is open (`peer.dataChannel.readyState === 'open'`)
- Check data size isn't exceeding limits

### Data Corruption

- Don't modify the Uint8Array while sending
- Don't try to JSON.stringify binary data
- Use correct TypedArray types for your data

### Performance Issues

- Chunk large files into smaller pieces
- Use compression for repetitive data
- Monitor network bandwidth
- Consider adding flow control for large transfers

## Best Practices

1. **Size Management**: Keep messages under 16KB or implement chunking
2. **Error Handling**: Always check return values and handle errors
3. **Type Safety**: Use proper TypedArray types (Uint8Array, Float32Array, etc.)
4. **Memory**: Clean up large ArrayBuffers when done
5. **Validation**: Validate data size and format on reception

## Future Enhancements

Potential improvements for binary message support:

- Automatic chunking for large data
- Built-in compression
- Progress callbacks
- Data streaming API
- Binary message encryption
- Reliability layer with ACKs

## Related Documentation

- [API Documentation](./API_DOCUMENTATION.md)
- [WebRTC Data Channels](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel)
- [ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer)
- [TypedArray](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray)
