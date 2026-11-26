# <picture><source media="(prefers-color-scheme: dark)" srcset="assets/pigeonlogo-dark.svg"><img src="assets/pigeonlogo.svg" alt="" height="36" align="top"></picture> PeerPigeon

*Peer-to-peer apps in the browser, with nothing in the middle.*

PeerPigeon links browsers and servers into a mesh over WebRTC: messages to the whole room or to one peer,
encryption, and signed storage that outlives the page.<br>
Relays only introduce peers. After that, everything goes straight between them.

## Table of contents

- [What it does](#what-it-does)
- [Installation](#installation)
- [Quick start](#quick-start)
- [The node](#the-node)
- [Storage](#storage)
- [How it works](#how-it-works)
- [The stack](#the-stack)
- [Specifications](#specifications)
- [Building PeerPigeon](#building-peerpigeon)
- [Links](#links)
- [License](#license)

## What it does

| | |
| --- | --- |
| **A partial mesh** | Each peer keeps between `minPeers` and `maxPeers` links, chosen and repaired as peers come and go |
| **Messages** | `broadcast` reaches the whole room by gossip; `sendDirect` reaches one peer, routed hop by hop |
| **Encryption** | A room cipher and per-peer keys: `broadcastEncrypted` and `sendEncryptedDirect` |
| **Signed storage** | Records signed by their writers, synced to the room, and kept on storage servers while nobody is online |
| **Relay choice** | Joins the room's closest healthy relays, local ones first |
| **Browsers and Node** | The same package, with types, as an ES module or CommonJS |

## Installation

```
npm install peerpigeon
```

It brings [FreeRTC](https://github.com/draeder/freertc) (the relay client) and
[UnSea](https://github.com/draeder/unsea) (the cryptography) with it.

## Quick start

```js
import { PeerPigeonNode } from 'peerpigeon'

const node = new PeerPigeonNode({
  networkId: 'my-app',              // your app's own namespace
  sessionId: 'lobby',               // the room
  signalingServer: 'wss://peer.ooo/ws',
  automaticSignalingServer: true,   // join the room's closest healthy relays
  storage: { replicate: ['notes/'] },
})

node.on('message', (m) => { if (!m.local) console.log(m.kind, m.fromPeerId, m.data) })
await node.start()

node.broadcast({ text: 'hello, everyone' })        // the whole room
node.sendDirect(peerId, { text: 'just you' })      // one peer, across the mesh
```

Peers meet only when `networkId` and `sessionId` both match.

To try it with many peers, run a relay on your own machine that keeps to itself:

```
FREERTC_FEDERATION=off npx freertc dev
```

and use `signalingServer: 'ws://127.0.0.1:8788/ws'`.

## The node

| Option | What it does |
| --- | --- |
| `networkId`, `sessionId` | Your app's namespace, and the room |
| `signalingServer`, `signalingServers` | The relay to start from, and more to fall back on |
| `automaticSignalingServer` | Choose the room's relays from the registry |
| `minPeers`, `maxPeers` | How many links to keep |
| `crypto` | `false` to leave encryption out; `{ keyPair }` to be the same identity on another device |
| `storage` | Attach storage (`replicate`, `servers`, …) |

| Method | |
| --- | --- |
| `start()`, `destroy()` | Join the room; leave and close everything |
| `broadcast(data)`, `sendDirect(peerId, data)` | To everyone, or to one peer |
| `broadcastEncrypted(text)`, `sendEncryptedDirect(peerId, text)` | The same, encrypted |
| `getConnectedPeers()`, `getGlobalPeers()` | The peers linked to this one, and all known in the room |
| `openStorage(sessionId, { owner })` | Another storage room, for example one only a single key may write |

Events, with `node.on(event, handler)`: `ready`, `peerConnected`, `peerDisconnected`, `message`,
`keyDiscovered`, `graphChanged`, `deliveryComplete`, `error`, and more.
[Every option, method and event](https://docs.peerpigeon.io/blocks/peerpigeon).

## Storage

```js
await node.storage.put('public', 'notes/1', { text: 'still here tomorrow' })
const record = await node.storage.get('public', 'notes/1')

node.storage.subscribe((change) => console.log(change.op, change.key))
```

Every change is signed with the node's keys and synced to the room. A peer that joins later is sent what it
missed. When the room's [storage servers](https://docs.peerpigeon.io/blocks/pigeonfs) are up, records go to them
too, so they are there when no peer is online. The servers hold hashes and ciphertext only.
[Spaces, and who may write what](https://docs.peerpigeon.io/guide/storage).

## How it works

| | |
| --- | --- |
| **1. Relays introduce** | [FreeRTC](https://docs.peerpigeon.io/blocks/freertc) relays pass the few messages two peers need to meet. Signaling only |
| **2. Peers link directly** | PeerPigeon keeps the mesh over WebRTC. Messages and records go straight between peers |
| **3. Storage servers keep** | [PigeonFS](https://docs.peerpigeon.io/blocks/pigeonfs) servers keep each room's signed records, so they outlast everyone leaving |

How a peer picks its relays, and measures them, is in [RELAYS.md](RELAYS.md).

## The stack

| Part | What it does |
| --- | --- |
| **PeerPigeon** | The mesh, messages, encryption and signed storage (this repo) |
| [FreeRTC](https://docs.peerpigeon.io/blocks/freertc) | Relays that introduce peers and federate with each other, on Workers or Node |
| [PigeonFS](https://docs.peerpigeon.io/blocks/pigeonfs) | Storage servers anyone can run, for rooms, records and file pieces |
| [PigeonIdP](https://docs.peerpigeon.io/blocks/pigeonidp) | Accounts without a company: one name everywhere, your own keys |
| [UnSea](https://docs.peerpigeon.io/blocks/unsea) | Keys, signatures and encryption in plain JavaScript |
| [wurl](https://docs.peerpigeon.io/blocks/wurl) | curl for WebRTC: join any relay as a peer from the command line |
| [Console](https://console.peerpigeon.io) | Your relays, storage servers and apps, and the people in them |

## Specifications

| Spec | |
| --- | --- |
| [PSP](https://docs.peerpigeon.io/blocks/psp) | The Peer Signaling Protocol: how peers name themselves, find each other and trade offers, answers and ICE candidates. The protocol FreeRTC relays speak |
| [CECR](https://docs.peerpigeon.io/blocks/cecr) | Convergent Extremal Coordinate Routing: how a message crosses a partly connected mesh, each hop closer to its target |

## Building PeerPigeon

```
npm install
npm run build
```

`dist/` gets the ES module, CommonJS and types. The demo, a room's mesh drawn live
([pigeon.peer.ooo](https://pigeon.peer.ooo)), is in `examples/vue3`:

```
npm run example:vue3
```

## Links

[Docs](https://docs.peerpigeon.io) · [peerpigeon.io](https://peerpigeon.io) · [peer.ooo](https://peer.ooo) ·
[Demo](https://pigeon.peer.ooo) · [npm](https://www.npmjs.com/package/peerpigeon) ·
[Issues](https://github.com/PeerPigeon/PeerPigeon/issues)

## License

ISC
