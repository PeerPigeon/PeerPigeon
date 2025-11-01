# Broadcast Streaming API

The PeerPigeon Broadcast Streaming API allows you to stream data to all peers in the mesh network using the **gossip protocol**. This is useful for scenarios like:

- Broadcasting files to all participants across the entire mesh (multi-hop)
- Live streaming content to viewers anywhere in the network
- Distributing updates or media to all peers, even those not directly connected

## Features

- **Gossip-based propagation**: Streams reach all peers in the mesh, even those multiple hops away
- **Multi-hop delivery**: Messages automatically propagate through the network (TTL-based)
- **Efficient streaming**: Uses WritableStream API for memory-efficient chunked transfers
- **Automatic deduplication**: Gossip protocol prevents duplicate chunk delivery
- **Error resilience**: Network continues functioning even if individual peers fail
- **Progress tracking**: Emits events for monitoring broadcast progress and completion
- **Flexible input**: Supports Files, Blobs, and custom ReadableStreams

## How It Works

Unlike point-to-point streaming, broadcast streaming uses the gossip protocol to propagate stream chunks throughout the entire mesh network:

1. **Chunk broadcasting**: Each chunk is sent as a gossip message with TTL (time-to-live)
2. **Multi-hop propagation**: Peers relay chunks to their neighbors, reaching the entire network
3. **Ordered reassembly**: Receiving peers buffer and reorder chunks automatically
4. **Deduplication**: Gossip protocol ensures peers don't process duplicate chunks

**Network Reach**: Gossip broadcast reaches ALL peers in the mesh, not just directly connected ones.

## Basic Usage

### Broadcasting a File

```javascript
import { PeerPigeonMesh } from 'peerpigeon';

const mesh = new PeerPigeonMesh();
await mesh.init();
await mesh.connect('ws://signaling-server:3000');

// Broadcast a file to all connected peers
const fileInput = document.getElementById('fileInput');
const file = fileInput.files[0];

await mesh.broadcastFile(file);
```

### Broadcasting a Blob

```javascript
const text = 'Hello all peers!';
const blob = new Blob([text], { type: 'text/plain' });

await mesh.broadcastBlob(blob, {
  filename: 'message.txt'
});
```

### Broadcasting a Custom Stream

```javascript
// Create a readable stream from any source
const readableStream = new ReadableStream({
  start(controller) {
    // Push chunks to the stream
    controller.enqueue(new Uint8Array([1, 2, 3]));
    controller.close();
  }
});

// Broadcast with metadata
await mesh.broadcastStream(readableStream, {
  filename: 'data.bin',
  mimeType: 'application/octet-stream',
  totalSize: 1024
});
```

## Advanced Usage

### Creating a Broadcast Stream Manually

For more control, you can create a writable broadcast stream and pipe data to it:

```javascript
// Create a writable stream that broadcasts to all peers
const broadcastStream = mesh.createBroadcastStream({
  filename: 'large-file.dat',
  mimeType: 'application/octet-stream',
  totalSize: 1024 * 1024 * 100 // 100MB
});

// Get a writer
const writer = broadcastStream.getWriter();

// Write chunks
await writer.write(chunk1);
await writer.write(chunk2);
await writer.write(chunk3);

// Close when done
await writer.close();
```

### Piping from a ReadableStream

```javascript
const response = await fetch('https://example.com/large-file.zip');
const readableStream = response.body;

const broadcastStream = mesh.createBroadcastStream({
  filename: 'download.zip',
  mimeType: 'application/zip'
});

// Pipe directly from fetch to all peers
await readableStream.pipeTo(broadcastStream);
```

## Event Handling

### Monitoring Broadcast Completion

```javascript
mesh.addEventListener('broadcastStreamComplete', (event) => {
  console.log(`Broadcast complete!`);
  console.log(`Total bytes sent: ${event.totalBytes}`);
  console.log(`Successful peers: ${event.successCount}/${event.totalPeers}`);
  console.log(`Metadata:`, event.metadata);
});
```

### Handling Broadcast Failures

```javascript
mesh.addEventListener('broadcastStreamAborted', (event) => {
  console.error(`Broadcast aborted: ${event.reason}`);
  console.log(`Stream ID: ${event.streamId}`);
});
```

### Receiving Broadcasts

Peers receiving broadcast streams get the standard `streamReceived` event:

```javascript
mesh.addEventListener('streamReceived', async (event) => {
  console.log(`Receiving stream from ${event.peerId}`);
  console.log(`Metadata:`, event.metadata);
  
  // Read the stream
  const reader = event.stream.getReader();
  const chunks = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  // Process received data
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  console.log(`Received ${totalLength} bytes`);
  
  // Create a blob if needed
  if (event.metadata.filename) {
    const blob = new Blob(chunks, { type: event.metadata.mimeType });
    const url = URL.createObjectURL(blob);
    // Download or display the file
  }
});
```

## API Reference

### Methods

#### `createBroadcastStream(options)`

Creates a WritableStream that broadcasts data to all connected peers.

**Parameters:**
- `options` (object, optional):
  - `streamId` (string): Custom stream ID (auto-generated if not provided)
  - `type` (string): Stream type (default: 'broadcast')
  - `filename` (string): Filename for the stream
  - `mimeType` (string): MIME type of the content
  - `totalSize` (number): Total size in bytes
  - `chunkSize` (number): Chunk size for transmission

**Returns:** `WritableStream`

**Throws:** Error if no peers are connected

---

#### `broadcastStream(readableStream, options)`

Broadcasts a ReadableStream to all connected peers.

**Parameters:**
- `readableStream` (ReadableStream): The stream to broadcast
- `options` (object, optional): Same as `createBroadcastStream`

**Returns:** `Promise<void>`

---

#### `broadcastFile(file)`

Broadcasts a File to all connected peers.

**Parameters:**
- `file` (File): The file to broadcast

**Returns:** `Promise<void>`

---

#### `broadcastBlob(blob, options)`

Broadcasts a Blob to all connected peers.

**Parameters:**
- `blob` (Blob): The blob to broadcast
- `options` (object, optional): Additional options (filename, etc.)

**Returns:** `Promise<void>`

---

### Events

#### `broadcastStreamComplete`

Emitted when a broadcast stream completes successfully.

**Event Data:**
```javascript
{
  streamId: string,
  totalBytes: number,
  totalChunks: number,
  metadata: object
}
```

---

#### `broadcastStreamAborted`

Emitted when a broadcast stream is aborted.

**Event Data:**
```javascript
{
  streamId: string,
  reason: string,
  metadata: object
}
```

---

#### `streamReceived`

Emitted on receiving peers when a gossip stream starts. This event fires on ALL peers in the mesh as chunks propagate via gossip.

**Event Data:**
```javascript
{
  peerId: string,
  streamId: string,
  stream: ReadableStream,
  metadata: object
}
```

---

#### `streamCompleted`

Emitted when a gossip stream is fully received.

**Event Data:**
```javascript
{
  peerId: string,
  streamId: string,
  totalChunks: number,
  totalBytes: number
}
```

## Error Handling

The broadcast streaming API uses gossip protocol for resilience:

- Chunks propagate through the network with TTL (time-to-live)
- If some peers are unreachable, chunks route around them
- Network continues functioning even if individual peers fail
- Gossip deduplication prevents processing the same chunk multiple times

```javascript
try {
  await mesh.broadcastFile(file);
} catch (error) {
  if (error.message.includes('All peer connections failed')) {
    console.error('Broadcast failed: All peers disconnected');
  } else {
    console.error('Broadcast error:', error);
  }
}
```

## Performance Considerations

### Chunk Size

The default chunk size is optimized for most use cases, but you can customize it:

```javascript
mesh.createBroadcastStream({
  filename: 'large-file.dat',
  chunkSize: 32768 // 32KB chunks
});
```

- Smaller chunks (4-16KB): Better for real-time streaming, more overhead
- Larger chunks (32-64KB): Better throughput, higher latency

### Memory Usage

Broadcast streams use memory efficiently by:
- Processing data in chunks
- Using backpressure to avoid overwhelming peers
- Cleaning up resources automatically

For very large files, the streaming API uses minimal memory as it doesn't load the entire file into memory.

### Network Bandwidth

Broadcasting consumes bandwidth proportional to: `file_size × number_of_peers`

For example, broadcasting a 10MB file to 5 peers consumes approximately 50MB of upload bandwidth.

## Examples

See the complete working example in `/examples/broadcast-stream-demo.html`.

## Comparison with Other Methods

| Method | Use Case | Network Reach | Behavior |
|--------|----------|---------------|----------|
| `broadcastStream()` | Large files/media | **Entire mesh (multi-hop)** | Gossip-based chunked streaming |
| `broadcastBinaryData()` | Small binary messages | **Direct peers only** | Single-shot binary broadcast |
| `sendMessage()` | Text messages | **Entire mesh (multi-hop)** | Gossip protocol with TTL |
| `createStreamToPeer()` | 1:1 file transfer | **Single peer** | Direct P2P streaming |

### Gossip vs Direct Streaming

**Broadcast Streaming (Gossip)**:
- ✅ Reaches **all peers** in the mesh (multi-hop)
- ✅ Survives **network partitions** and peer churn
- ✅ **Automatic deduplication** of chunks
- ✅ Works through **intermediate peers** as relays
- ⚠️ Higher **latency** due to multi-hop propagation
- ⚠️ More **bandwidth usage** (chunks propagate through multiple paths)

**Direct P2P Streaming** (createStreamToPeer):
- ✅ **Lower latency** - direct connection
- ✅ **Efficient bandwidth** usage
- ✅ Best for **1:1 file transfers**
- ❌ Only reaches **directly connected peer**
- ❌ Fails if **connection drops**

## Browser Compatibility

The broadcast streaming API requires:
- WebRTC support
- Streams API (ReadableStream, WritableStream)
- Modern browsers: Chrome 89+, Firefox 88+, Safari 14.1+, Edge 89+

## Next Steps

- See [STREAMING_API.md](./STREAMING_API.md) for peer-to-peer streaming
- See [BINARY_MESSAGES.md](./BINARY_MESSAGES.md) for binary messaging
- Check out the demo: `examples/broadcast-stream-demo.html`
