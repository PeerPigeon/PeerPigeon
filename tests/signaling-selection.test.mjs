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

test('local peer identity is ready before automatic relay discovery completes', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  let resolveRegistry;

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

  globalThis.fetch = () => new Promise((resolve) => {
    resolveRegistry = resolve;
  });
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

    resolveRegistry({ ok: false });
    await initializing;
  } finally {
    mesh.destroy();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});
