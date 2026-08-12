# peerpigeon-go

A faithful Go port of the [peerpigeon](https://github.com/peerpigeon/peerpigeon) TypeScript WebRTC P2P mesh networking library.

## Packages

| Package | TypeScript source | Description |
|---|---|---|
| `pkg/rtcpeer` | `src/rtc-peer.ts` | WebRTC peer abstraction via [pion/webrtc](https://github.com/pion/webrtc) |
| `pkg/signaling` | `src/freertc-client-adapter.ts` | FreeRTC WebSocket signaling adapter |
| `pkg/mesh` | `src/index.ts` | `PartialMesh` – configurable partial-mesh topology |
| `pkg/gossip` | `src/gossip.ts` | `GossipProtocol` – epidemic broadcast + XOR/CECR direct routing |
| `pkg/storage` | `src/storage.ts` | `PeerPigeonStorage` – encrypted gossip-synced key-value store |

## Quick Start

```bash
cd golang
go mod tidy
go run examples/simple/main.go
```

## Usage

```go
package main

import (
    "fmt"
    "time"

    "github.com/peerpigeon/peerpigeon-go/pkg/gossip"
    "github.com/peerpigeon/peerpigeon-go/pkg/mesh"
    "github.com/peerpigeon/peerpigeon-go/pkg/storage"
)

func main() {
    m := mesh.New(mesh.Config{
        SessionID:    "my-app-room",
        MinPeers:     2,
        MaxPeers:     8,
        AutoDiscover: true,
        AutoConnect:  true,
    })

    g := gossip.New(m, gossip.Options{MaxHops: 5})

    store, _ := storage.New(storage.Options{
        UserID:    "user-abc123",
        SessionID: "my-app-room",
        Gossip:    g,
    })
    store.Init()

    m.OnPeerConnected(func(peerID string) {
        fmt.Println("connected:", peerID)
    })

    m.Init()
    time.Sleep(30 * time.Second)
}
```

## Architecture

```
PeerPigeonStorage  ←uses→  GossipProtocol  ←uses→  PartialMesh
                                                        ↓
                                              FreeRTCClientAdapter
                                                        ↓
                                              RtcPeer (pion/webrtc)
```

## Protocol Compatibility

The Go port uses the same PSP (PeerPigeonSignaling) wire format as the TypeScript version and is fully interoperable: Go peers can connect to browser peers through the same `peer.ooo` signaling server.

## Differences from the TypeScript version

- **Storage**: Uses an in-memory driver (no IndexedDB). A file-backed driver can be plugged in by implementing the `StorageDriver` interface.
- **Cross-tab sync**: Not applicable; removed.
- **Page-unload handling**: Not applicable; removed.
- **WebCrypto**: Replaced with Go stdlib `crypto/aes` + `crypto/sha256`.
- **BigInt**: Replaced with `math/big`.
