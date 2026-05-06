# PeerPigeon Rust Port (Initial)

This directory contains a first-pass Rust port of the Go runtime in `golang/`.

## Implemented

- `gossip`:
  - Broadcast messages with hop-limited propagation.
  - Direct messages with best-effort forwarding.
  - Message deduplication.
- `storage`:
  - In-memory key-value store.
  - Core spaces (`public`, `user`, `frozen`, `private`, `epublic`).
  - Local/remote change events.
  - Mutation envelope generation and remote-apply path.
- `mesh`:
  - `MeshLike` trait.
  - In-process network/mesh for deterministic local testing.
- `signaling`, `rtcpeer`:
  - Compile-safe placeholders mirroring Go package boundaries.

## Quickstart

```bash
cd rust
cargo run --example simple
```

## Porting Notes

This is a functional scaffold focused on sharing the same module boundaries as the Go code. The WebRTC and production signaling stack still need full implementation (likely via `webrtc` + `tokio-tungstenite`).
