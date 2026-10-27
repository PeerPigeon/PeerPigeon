# How PeerPigeon chooses a relay

With automatic relay selection (no `signalingServer` given), a peer reads the
relay registry (`/api/v1/relays`) from one bootstrap and chooses relays for its
room (`src/relay-choice.ts`):

1. **Candidates:** the room's five relays closest to the key FreeRTC publishes
   the room under, `sha256(["freertc-kad",1,"scope",network,room])`. Each relay
   counts as four points in the ID space (its node ID, then `sha256("<node id>:<i>")`).
   A room's peers gather on a few relays, so little signaling crosses between relays.
2. **Tiers:** a healthy local relay comes before every cloud relay. Healthy means
   under 5% failed joins (with at least two attempts) and under 90% of capacity.
   A relay is local when its registry entry says `relay_kind: "local"`, or when
   it is behind a tunnel (`/t/<node id>/ws`).
3. **Score**, lower wins:
   `joinMs + 2000·failureRate + 1000·loadRatio (+300 when reachable only through its tunnel)`.
   A relay nobody has measured scores as an average one. Ties go to XOR distance
   from the peer ID.
4. **Hysteresis:** the peer keeps the relay it used last unless another is in a
   better tier or is at least 30% better.

The remaining relays follow, nearest the peer first, as failover.

Relays are identified by their FreeRTC **node ID** (the SHA-256 of their signing
key), the same ID the relays use among themselves. `SHA-256(hostname)` is used
only for a relay whose node ID is unknown.

## Measurements

`PartialMesh` records each join (from connecting to registered) and each relay
the adapter gives up on, in a `RelayScoreBook` (`mesh.getRelayScores()`) that is
kept in localStorage. Each `PeerPigeonNode` hands its own measurements to every
new neighbour in one direct frame (`pp-relay-scores`, never shown to the
application), and again every ten minutes. A peer's own measurements count three
times what others share.

## API

```ts
import { chooseRelays, discoverSignalingRelays, discoverClosestSignalingServers, RelayScoreBook } from 'peerpigeon';

const relays = await discoverSignalingRelays({ bootstrapServer: 'wss://peer.ooo/ws' });
const book = new RelayScoreBook();
const order = await chooseRelays({
  peerId, network, room, relays,
  measurements: (nodeId) => book.measurement(nodeId),
  previousUrl,
});
```

`discoverClosestSignalingServers({ ..., network, room })` does both steps in one
call. Without `network` and `room`, relays are ranked by node-ID distance to the
peer ID, as before.

The relay side (pointers, punched connections, links between local relays,
measured costs) is described in FreeRTC's `docs/RELAYS.md`.
