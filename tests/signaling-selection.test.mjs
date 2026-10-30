import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SIGNALING_SERVERS,
  PartialMesh,
  discoverClosestSignalingServer,
  discoverClosestSignalingServers,
  rankSignalingServersByDistance,
  selectClosestSignalingServer,
} from '../dist/index.js';

async function hostnameId(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hostname));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('automatic relay selection chooses the hostname nearest the 256-bit peer ID', async () => {
  const exactRelay = 'wss://decentralize.ooo/ws';
  const peerId = await hostnameId(exactRelay);
  const ranked = await rankSignalingServersByDistance(peerId, DEFAULT_SIGNALING_SERVERS);
  assert.equal(
    await selectClosestSignalingServer(peerId, DEFAULT_SIGNALING_SERVERS),
    exactRelay,
  );
  assert.equal(ranked[0], exactRelay);
  assert.equal(ranked.length, DEFAULT_SIGNALING_SERVERS.length);
});

test('automatic discovery queries only the bootstrap before selecting one relay', async () => {
  const bootstrap = 'wss://peer.ooo/ws';
  const discovered = 'wss://new-federated-relay.example/ws';
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() {
        return { ok: true, relays: [{ url: discovered }] };
      },
    };
  };
  const peerId = await hostnameId(discovered);
  const selected = await discoverClosestSignalingServer({
    bootstrapServer: bootstrap,
    peerId,
    fallbackServers: DEFAULT_SIGNALING_SERVERS,
    fetchImpl,
  });
  assert.equal(selected, discovered);
  assert.deepEqual(calls, ['https://peer.ooo/api/v1/relays']);
});

test('automatic discovery returns a bounded nearest-first failover list', async () => {
  const bootstrap = 'wss://peer.ooo/ws';
  const exactRelay = 'wss://close-relay.example/ws';
  const calls = [];
  const peerId = await hostnameId(exactRelay);
  const relays = await discoverClosestSignalingServers({
    bootstrapServer: bootstrap,
    peerId,
    fallbackServers: DEFAULT_SIGNALING_SERVERS,
    limit: 3,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        async json() {
          return { relays: [{ url: exactRelay }, { url: exactRelay }] };
        },
      };
    },
  });

  assert.equal(relays[0], exactRelay);
  assert.equal(relays.length, 3);
  assert.equal(new Set(relays).size, relays.length);
  assert.deepEqual(calls, ['https://peer.ooo/api/v1/relays']);
});

test('PartialMesh defaults to automatic discovery but preserves explicit manual relay mode', () => {
  const automatic = new PartialMesh();
  const automaticConfig = automatic.getConfig();
  assert.equal(automaticConfig.automaticSignalingServer, true);
  assert.deepEqual(automaticConfig.signalingServers, [...DEFAULT_SIGNALING_SERVERS]);

  const manualUrl = 'wss://relay.example/ws';
  const manual = new PartialMesh({ signalingServer: manualUrl });
  const manualConfig = manual.getConfig();
  assert.equal(manualConfig.automaticSignalingServer, false);
  assert.deepEqual(manualConfig.signalingServers, [manualUrl]);
});

test('a same-tab reload rotates and retires its previous peer identity', () => {
  const originalWindow = globalThis.window;
  const values = new Map();
  let navigationType = 'navigate';
  const sessionStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  globalThis.window = {
    crypto: globalThis.crypto,
    sessionStorage,
    performance: {
      getEntriesByType(type) {
        return type === 'navigation' ? [{ type: navigationType }] : [];
      },
    },
  };

  try {
    const options = { networkId: 'identity-test', sessionId: 'identity-test' };
    const firstMesh = new PartialMesh(options);
    const first = firstMesh.loadOrCreateBrowserPeerId(['wss://relay.example/ws']);
    firstMesh.rememberBrowserPeerSignalUrls(['wss://first-relay.example/ws']);

    navigationType = 'reload';
    const reloadedMesh = new PartialMesh(options);
    const reloaded = reloadedMesh.loadOrCreateBrowserPeerId(['wss://relay.example/ws']);
    assert.notEqual(reloaded.requestedPeerId, first.requestedPeerId);
    assert.equal(reloaded.previousPeerId, first.requestedPeerId);
    assert.equal(reloaded.retiredPeerIds.includes(first.requestedPeerId), true);
    assert.deepEqual(reloaded.previousPeerSignalUrls, ['wss://first-relay.example/ws']);
    reloadedMesh.rememberBrowserPeerSignalUrls(['wss://second-relay.example/ws']);

    const reloadedAgainMesh = new PartialMesh(options);
    const reloadedAgain = reloadedAgainMesh.loadOrCreateBrowserPeerId(['wss://relay.example/ws']);
    assert.notEqual(reloadedAgain.requestedPeerId, reloaded.requestedPeerId);
    assert.equal(reloadedAgain.previousPeerId, reloaded.requestedPeerId);
    assert.deepEqual(reloadedAgain.previousPeerSignalUrls, ['wss://second-relay.example/ws']);
    assert.equal(reloadedAgain.retiredPeerIds.includes(first.requestedPeerId), true);
    assert.equal(reloadedAgain.retiredPeerIds.includes(reloaded.requestedPeerId), true);

    navigationType = 'navigate';
    const separatelyOpenedMesh = new PartialMesh(options);
    const separatelyOpened = separatelyOpenedMesh.loadOrCreateBrowserPeerId(['wss://relay.example/ws']);
    assert.notEqual(separatelyOpened.requestedPeerId, reloadedAgain.requestedPeerId);
    assert.equal(separatelyOpened.previousPeerId, null);
    assert.equal(separatelyOpened.retiredPeerIds.includes(first.requestedPeerId), true);
    assert.equal(separatelyOpened.retiredPeerIds.includes(reloadedAgain.requestedPeerId), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('local peer identity is ready before automatic relay discovery completes', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const pending = [];

  class PendingWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      this.readyState = PendingWebSocket.CONNECTING;
    }

    close(code = 1000) {
      this.readyState = PendingWebSocket.CLOSED;
      this.onclose?.({ code });
    }

    send() {}
  }

  // Discovery makes several requests at once (the relay registry and the DNS
  // directory); all of them stay pending until the identity has been checked.
  let released = false;
  const failed = { ok: false, json: async () => ({}) };
  globalThis.fetch = () => (released ? Promise.resolve(failed) : new Promise((resolve) => {
    pending.push(resolve);
  }));
  globalThis.WebSocket = PendingWebSocket;
  const mesh = new PartialMesh();
  let identity = '';
  mesh.on('identity:ready', ({ clientId }) => {
    identity = clientId;
  });

  try {
    const initializing = mesh.init();
    await Promise.resolve();
    assert.match(identity, /^[0-9a-f]{64}$/);
    assert.equal(mesh.getClientId(), identity);

    released = true;
    for (const resolve of pending) resolve(failed);
    await initializing;
  } finally {
    mesh.destroy();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

// Phase 1 of the relay plan: one relay ID everywhere. Relays are ranked by
// their FreeRTC node ID (the same ID the relays' Kademlia overlay uses), not
// by SHA-256(hostname); a relay behind NAT is ranked by its own node ID, not
// as its tunnel home.
const randomHexId = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');

test('a relay is ranked by the node ID the registry gives it, not its hostname', async () => {
  const peerId = randomHexId();
  const near = { url: 'wss://far-by-hostname.example/ws', node_id: peerId };
  const ranked = await rankSignalingServersByDistance(peerId, [...DEFAULT_SIGNALING_SERVERS, near]);
  assert.equal(ranked[0], near.url, 'the relay whose node ID equals the peer ID is closest');
});

test('relays behind one tunnel home are distinct relays, each ranked by its own node ID', async () => {
  const a = randomHexId();
  const b = randomHexId();
  const tunneledA = `wss://peer.ooo/t/${a}/ws`;
  const tunneledB = `wss://peer.ooo/t/${b}/ws`;
  const toA = await rankSignalingServersByDistance(a, ['wss://peer.ooo/ws', tunneledB, tunneledA]);
  assert.equal(toA[0], tunneledA);
  const toB = await rankSignalingServersByDistance(b, ['wss://peer.ooo/ws', tunneledA, tunneledB]);
  assert.equal(toB[0], tunneledB);
  assert.equal(new Set(toA).size, 3, 'the home and both tunneled relays are three relays');
});

test('discovery ranks registry relays by their node_id, and a URL listed twice keeps the entry that knew it', async () => {
  const peerId = randomHexId();
  const relay = 'wss://registry-relay.example/ws';
  const relays = await discoverClosestSignalingServers({
    bootstrapServer: 'wss://peer.ooo/ws',
    peerId,
    fallbackServers: [...DEFAULT_SIGNALING_SERVERS, relay],
    fetchImpl: async () => ({
      ok: true,
      async json() { return { relays: [{ url: relay }, { url: relay, node_id: peerId }] }; },
    }),
  });
  assert.equal(relays[0], relay);
});

test('direct relays from the DNS directory come first, and a relay listed both ways is kept once', async () => {
  const { discoverSignalingRelays } = await import('../dist/index.js');
  const { generateRandomPair } = await import('unsea');
  const { createRelayIdentity } = await import('../node_modules/freertc/src/relay-identity.js');
  const { createSignedDirectoryRecord, encodeDirectoryTxt } = await import('../node_modules/freertc/src/direct/record.js');
  const pair = await generateRandomPair();
  const identity = await createRelayIdentity(pair.pub, pair.priv);
  const tunnel = `wss://peer.ooo/t/${identity.nodeId}/ws`;
  const record = await createSignedDirectoryRecord(identity, {
    direct: `webrtc-direct://203.0.113.7:9443/sha256/${'a'.repeat(64)}`,
    tunnel,
  });
  const fetchImpl = async (url) => {
    if (String(url).includes('dns-query') || String(url).includes('/resolve')) {
      return new Response(JSON.stringify({ Answer: [{ type: 16, data: encodeDirectoryTxt(record) }] }));
    }
    return new Response(JSON.stringify({ relays: [
      { url: tunnel, node_id: identity.nodeId, relay_kind: 'local' },
      { url: 'wss://decentralize.ooo/ws' },
    ] }));
  };
  const relays = await discoverSignalingRelays({ bootstrapServer: 'wss://peer.ooo/ws', fetchImpl, directory: `_relays.test-${Date.now()}.example` });
  assert.equal(relays[0].url, `webrtc-direct://203.0.113.7:9443/sha256/${'a'.repeat(64)}?tunnel=${encodeURIComponent(tunnel)}`);
  assert.equal(relays[0].kind, 'local');
  assert.equal(relays[0].nodeId, identity.nodeId);
  assert.equal(relays.filter((relay) => relay.nodeId === identity.nodeId).length, 1, 'kept once, as its direct entry');
  assert.ok(relays.some((relay) => relay.url === 'wss://decentralize.ooo/ws'));
  const none = await discoverSignalingRelays({ bootstrapServer: 'wss://peer.ooo/ws', fetchImpl, directory: false });
  assert.equal(none.some((relay) => relay.url.startsWith('webrtc-direct:')), false, 'directory: false skips the lookup');
});
