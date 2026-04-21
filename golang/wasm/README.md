# PeerPigeon Go Wasm Runtime

This package exposes the Go gossip/storage core to browser JavaScript via `syscall/js`.

Build:

```bash
cd golang
GOOS=js GOARCH=wasm go build -o ../examples/vue3/public/peerpigeon.wasm ./wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" ../examples/vue3/public/wasm_exec.js
```

Expected JS bridge object for `peerpigeonCreateNode(config, bridge)`:

- `send(peerId, uint8Array)` -> required transport send hook (WebRTC/DataChannel path)
- `onMessageReceived(event)` -> optional callback for gossip message events
- `onStorageChange(event)` -> optional callback for storage change events

Minimal API exposed on `window`:

- `peerpigeonCreateNode(config, bridge) -> nodeId`
- `peerpigeonDestroyNode(nodeId)`
- `peerpigeonBroadcast(nodeId, data)`
- `peerpigeonSendDirect(nodeId, peerId, data)`
- `peerpigeonStoragePut(nodeId, space, key, value)`
- `peerpigeonStorageGet(nodeId, space, key)`
- `peerpigeonStorageDelete(nodeId, space, key)`
- `peerpigeonSetClientID(nodeId, clientId)`
- `peerpigeonSetConnectedPeers(nodeId, peers[])`
- `peerpigeonSetDiscoveredPeers(nodeId, peers[])`
- `peerpigeonSetGlobalPeers(nodeId, peers[])`
- `peerpigeonHandlePeerConnected(nodeId, peerId)`
- `peerpigeonHandlePeerDisconnected(nodeId, peerId)`
- `peerpigeonHandlePeerData(nodeId, peerId, uint8Array)`

Notes:

- All protocol and storage logic runs in Go.
- Browser signaling + WebRTC interop is expected to be provided by JS and routed through these hooks.
