# Streaming API Documentation

PeerPigeon now supports efficient data streaming using the standard Web Streams API (ReadableStream/WritableStream). This enables large file transfers, progressive data transmission, and proper backpressure handling.

## Overview

The streaming API allows you to:
- Transfer large files efficiently
- Stream data progressively without loading entire files in memory
- Handle backpressure automatically
- Cancel or abort streams mid-transfer
- Track transfer progress

## Why Streams?

**Traditional Binary Messages** (sendBinaryData):
- Good for small data (<16MB)
- Loads entire data into memory
- No built-in progress tracking
- No backpressure handling

**Streams** (sendFile, sendStream):
- Perfect for large files (GBs+)
- Memory-efficient (chunks processed incrementally)
- Built-in backpressure and flow control
- Progress tracking and cancellation
- Standards-compliant (Web Streams API)

## Quick Start

### Send a File

```javascript
// Simple file transfer
const fileInput = document.getElementById('file-input');
const file = fileInput.files[0];

await mesh.sendFile(targetPeerId, file);
```

### Receive a File

```javascript
mesh.addEventListener('streamReceived', async (event) => {
  const { stream, metadata } = event;
  
  // Read stream chunks
  const chunks = [];
  const reader = stream.getReader();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  // Create downloadable blob
  const blob = new Blob(chunks, { type: metadata.mimeType });
  const url = URL.createObjectURL(blob);
  
  // Trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = metadata.filename;
  a.click();
});
```

## API Reference

### High-Level Methods

#### `sendFile(targetPeerId, file)`

Send a File object to a peer.

```javascript
const file = fileInput.files[0];
await mesh.sendFile(targetPeerId, file);
```

**Parameters:**
- `targetPeerId` (string): Destination peer ID
- `file` (File): File object to send

**Returns:** Promise<void>

---

#### `sendBlob(targetPeerId, blob, options)`

Send a Blob to a peer.

```javascript
const blob = new Blob(['Hello, world!'], { type: 'text/plain' });
await mesh.sendBlob(targetPeerId, blob, {
  filename: 'message.txt'
});
```

**Parameters:**
- `targetPeerId` (string): Destination peer ID
- `blob` (Blob): Blob to send
- `options` (object): Optional metadata
  - `filename` (string): Filename
  - `mimeType` (string): MIME type (defaults to blob.type)

**Returns:** Promise<void>

---

#### `sendStream(targetPeerId, readableStream, options)`

Send any ReadableStream to a peer.

```javascript
const response = await fetch('/large-file.bin');
await mesh.sendStream(targetPeerId, response.body, {
  filename: 'large-file.bin',
  totalSize: response.headers.get('content-length')
});
```

**Parameters:**
- `targetPeerId` (string): Destination peer ID
- `readableStream` (ReadableStream): Stream to send
- `options` (object): Stream metadata
  - `filename` (string): Filename
  - `mimeType` (string): MIME type
  - `totalSize` (number): Total size in bytes
  - `type` (string): Stream type ('file', 'blob', 'binary')

**Returns:** Promise<void>

---

### Low-Level Methods

#### `createStreamToPeer(targetPeerId, options)`

Create a WritableStream to a peer for manual control.

```javascript
const writable = mesh.createStreamToPeer(targetPeerId, {
  filename: 'data.bin',
  totalSize: 1024000,
  chunkSize: 16384 // 16KB chunks
});

const writer = writable.getWriter();

// Write chunks
await writer.write(chunk1);
await writer.write(chunk2);

// Close stream
await writer.close();
```

**Parameters:**
- `targetPeerId` (string): Destination peer ID
- `options` (object): Stream options
  - `streamId` (string): Optional stream ID (auto-generated if not provided)
  - `filename` (string): Filename
  - `mimeType` (string): MIME type
  - `totalSize` (number): Total size in bytes
  - `chunkSize` (number): Chunk size (default: 16384 bytes)
  - `type` (string): Stream type

**Returns:** WritableStream

---

## Events

### `streamReceived`

Fired when a stream starts being received from a peer.

```javascript
mesh.addEventListener('streamReceived', (event) => {
  const { peerId, streamId, stream, metadata } = event;
  
  console.log(`Receiving ${metadata.filename} from ${peerId}`);
  console.log(`Size: ${metadata.totalSize} bytes`);
  console.log(`Type: ${metadata.mimeType}`);
  
  // Process the stream...
});
```

**Event Data:**
- `peerId` (string): Sender's peer ID
- `streamId` (string): Unique stream identifier
- `stream` (ReadableStream): The incoming stream
- `metadata` (object): Stream metadata
  - `filename` (string)
  - `mimeType` (string)
  - `totalSize` (number)
  - `type` (string)
  - `timestamp` (number)

---

### `streamCompleted`

Fired when a stream transfer completes successfully.

```javascript
mesh.addEventListener('streamCompleted', (event) => {
  const { peerId, streamId, totalChunks } = event;
  console.log(`Stream ${streamId} completed (${totalChunks} chunks)`);
});
```

**Event Data:**
- `peerId` (string): Peer ID
- `streamId` (string): Stream identifier
- `totalChunks` (number): Number of chunks transferred

---

### `streamAborted`

Fired when a stream is aborted or fails.

```javascript
mesh.addEventListener('streamAborted', (event) => {
  const { peerId, streamId, reason } = event;
  console.error(`Stream ${streamId} aborted: ${reason}`);
});
```

**Event Data:**
- `peerId` (string): Peer ID
- `streamId` (string): Stream identifier
- `reason` (string): Abort reason

---

## Examples

### Example 1: File Transfer with Progress

```javascript
async function sendFileWithProgress(peerId, file) {
  const totalSize = file.size;
  let transferred = 0;
  
  // Create custom stream with progress tracking
  const fileStream = file.stream();
  const progressStream = new TransformStream({
    transform(chunk, controller) {
      transferred += chunk.length;
      const progress = (transferred / totalSize) * 100;
      updateProgressBar(progress);
      controller.enqueue(chunk);
    }
  });
  
  await mesh.sendStream(
    peerId,
    fileStream.pipeThrough(progressStream),
    {
      filename: file.name,
      totalSize: file.size,
      mimeType: file.type
    }
  );
}
```

### Example 2: Receiving and Saving Files

```javascript
mesh.addEventListener('streamReceived', async (event) => {
  const { stream, metadata } = event;
  
  // Create blob from stream
  const chunks = [];
  const reader = stream.getReader();
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const blob = new Blob(chunks, { type: metadata.mimeType });
    
    // Auto-download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = metadata.filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`Saved ${metadata.filename}`);
  } catch (error) {
    console.error('Failed to receive file:', error);
  }
});
```

### Example 3: Streaming from URL

```javascript
async function streamFromURL(peerId, url) {
  const response = await fetch(url);
  const filename = url.split('/').pop();
  const totalSize = response.headers.get('content-length');
  
  await mesh.sendStream(peerId, response.body, {
    filename,
    totalSize: parseInt(totalSize),
    mimeType: response.headers.get('content-type')
  });
}

// Usage
await streamFromURL(peerId, 'https://example.com/video.mp4');
```

### Example 4: Transform Stream (Compression)

```javascript
async function sendCompressedFile(peerId, file) {
  const compressionStream = new CompressionStream('gzip');
  
  await mesh.sendStream(
    peerId,
    file.stream().pipeThrough(compressionStream),
    {
      filename: file.name + '.gz',
      mimeType: 'application/gzip',
      type: 'compressed'
    }
  );
}

// Receiving side
mesh.addEventListener('streamReceived', async (event) => {
  const { stream, metadata } = event;
  
  if (metadata.type === 'compressed') {
    const decompressionStream = new DecompressionStream('gzip');
    const decompressedStream = stream.pipeThrough(decompressionStream);
    
    // Process decompressed stream...
  }
});
```

### Example 5: Multiple File Transfer

```javascript
async function sendMultipleFiles(peerId, files) {
  for (const file of files) {
    console.log(`Sending ${file.name}...`);
    await mesh.sendFile(peerId, file);
    console.log(`Sent ${file.name}`);
  }
}

// Usage
const fileInput = document.getElementById('file-input');
await sendMultipleFiles(peerId, fileInput.files);
```

### Example 6: Cancel Stream Transfer

```javascript
async function sendWithCancellation(peerId, file) {
  const abortController = new AbortController();
  
  // Show cancel button
  showCancelButton(() => abortController.abort());
  
  try {
    const writable = mesh.createStreamToPeer(peerId, {
      filename: file.name,
      totalSize: file.size
    });
    
    // Pipe with abort signal
    await file.stream().pipeTo(writable, {
      signal: abortController.signal
    });
    
    console.log('Transfer completed');
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Transfer cancelled by user');
    } else {
      console.error('Transfer failed:', error);
    }
  }
}
```

### Example 7: Stream Video Playback

```javascript
// Sender: Stream video file
await mesh.sendFile(peerId, videoFile);

// Receiver: Play as it streams
mesh.addEventListener('streamReceived', async (event) => {
  const { stream, metadata } = event;
  
  if (metadata.mimeType.startsWith('video/')) {
    const mediaSource = new MediaSource();
    const video = document.getElementById('video-player');
    video.src = URL.createObjectURL(mediaSource);
    
    mediaSource.addEventListener('sourceopen', async () => {
      const sourceBuffer = mediaSource.addSourceBuffer(metadata.mimeType);
      const reader = stream.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          mediaSource.endOfStream();
          break;
        }
        
        // Wait for buffer to be ready
        await new Promise(resolve => {
          if (sourceBuffer.updating) {
            sourceBuffer.addEventListener('updateend', resolve, { once: true });
          } else {
            resolve();
          }
        });
        
        sourceBuffer.appendBuffer(value);
      }
    });
  }
});
```

## Performance Considerations

### Chunk Size

Default chunk size is 16KB (16384 bytes). Adjust based on use case:

```javascript
// Small chunks for low latency
const writable = mesh.createStreamToPeer(peerId, {
  chunkSize: 8192  // 8KB
});

// Large chunks for throughput
const writable = mesh.createStreamToPeer(peerId, {
  chunkSize: 65536  // 64KB
});
```

**Guidelines:**
- **Small files (<1MB)**: 8-16KB chunks
- **Medium files (1-100MB)**: 16-32KB chunks
- **Large files (>100MB)**: 32-64KB chunks
- **Real-time data**: 4-8KB chunks

### Backpressure

The Streams API automatically handles backpressure. If the receiver is slow:

1. Writer blocks on `.write()` calls
2. Buffer fills up
3. Transfer pauses until buffer drains
4. Transfer resumes automatically

No manual throttling needed!

### Memory Usage

Streams are memory-efficient:

- Only active chunks in memory
- Garbage collected after processing
- Total memory ≈ chunk size × buffered chunks
- Typically <1MB even for GB files

## Error Handling

```javascript
try {
  await mesh.sendFile(peerId, file);
  console.log('✅ File sent successfully');
} catch (error) {
  if (error.message.includes('Data channel not open')) {
    console.error('❌ Peer disconnected');
  } else if (error.name === 'AbortError') {
    console.error('❌ Transfer cancelled');
  } else {
    console.error('❌ Transfer failed:', error);
  }
}
```

## Browser Compatibility

Requires support for:
- Web Streams API (ReadableStream/WritableStream)
- WebRTC RTCDataChannel
- Typed Arrays (Uint8Array)

**Supported:** Chrome 89+, Firefox 102+, Safari 14.1+, Edge 89+

## Comparison with Binary Messages

| Feature | Binary Messages | Streams |
|---------|----------------|---------|
| Max Size | ~16MB (practical) | Unlimited |
| Memory Usage | Full file in RAM | Chunks only |
| Progress Tracking | Manual | Built-in |
| Backpressure | Manual | Automatic |
| Cancellation | Not supported | Built-in |
| Use Case | Small data | Large files |

## Demo

Run the interactive demo:

```bash
npm run dev
# Open http://localhost:8080/examples/stream-file-transfer-demo.html
# Open in multiple tabs to test file transfers
```

## Related Documentation

- [Binary Messages](./BINARY_MESSAGES.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Web Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
