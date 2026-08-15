import assert from 'node:assert/strict';
import test from 'node:test';

import { FreeRTCClientAdapter } from '../src/freertc-client-adapter.ts';

test('Vue-style proxying does not suppress FreeRTC registration callbacks', () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];

  class RegisteringWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = String(url);
      this.readyState = RegisteringWebSocket.CONNECTING;
      sockets.push(this);
    }

    send() {}

    close(code = 1000) {
      this.readyState = RegisteringWebSocket.CLOSED;
      this.onclose?.({ code });
    }
  }

  globalThis.WebSocket = RegisteringWebSocket;
  const rawAdapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const wrappedClients = new WeakMap();
  const reactiveAdapter = new Proxy(rawAdapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== 'client' || !value || typeof value !== 'object') return value;
      let wrapped = wrappedClients.get(value);
      if (!wrapped) {
        wrapped = new Proxy(value, {});
        wrappedClients.set(value, wrapped);
      }
      return wrapped;
    },
  });
  const registrations = [];
  reactiveAdapter.on('connected', (data) => registrations.push(data));

  try {
    reactiveAdapter.connect();
    const socket = sockets[0];
    socket.readyState = RegisteringWebSocket.OPEN;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({ type: 'ack', body: { status: 'ok' } }),
    });

    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].clientId, '1'.repeat(64));
  } finally {
    reactiveAdapter.disconnect();
    globalThis.WebSocket = originalWebSocket;
  }
});

test('adapter leaves relay retries and backoff inside one FreeRTC client', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalWebSocket = globalThis.WebSocket;
  const attempts = [];
  const sockets = [];

  class PendingWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = String(url);
      this.readyState = PendingWebSocket.CONNECTING;
      attempts.push(this.url);
      sockets.push(this);
    }

    close(code = 1000) {
      this.readyState = PendingWebSocket.CLOSED;
      this.onclose?.({ code });
    }

    send() {}
  }

  globalThis.WebSocket = PendingWebSocket;
  const adapter = new FreeRTCClientAdapter([
    'wss://nearest.example/ws',
    'wss://next-nearest.example/ws',
  ], {
    peerId: '1'.repeat(64),
    retiredPeerIds: Array.from(
      { length: 45 },
      (_, index) => index.toString(16).padStart(64, '0'),
    ),
  });

  try {
    adapter.connect();
    // Retired identities are tombstoned/leased, never withdrawn through one
    // auxiliary WebSocket per identity.
    assert.equal(attempts.length, 1);
    assert.match(attempts[0], /^wss:\/\/nearest\.example\/ws/);

    const failLatestSocket = () => {
      const socket = sockets.at(-1);
      socket.readyState = PendingWebSocket.CLOSED;
      socket.onclose?.({ code: 1006 });
    };

    // FreeRTC owns every retry and its backoff on the original client.
    failLatestSocket();
    t.mock.timers.tick(1_000);
    failLatestSocket();
    t.mock.timers.tick(1_500);
    failLatestSocket();
    t.mock.timers.tick(2_250);

    assert.equal(attempts.length, 4);
    assert.match(attempts[0], /^wss:\/\/nearest\.example\/ws/);
    assert.match(attempts[1], /^wss:\/\/nearest\.example\/ws/);
    assert.match(attempts[2], /^wss:\/\/nearest\.example\/ws/);
    assert.match(attempts[3], /^wss:\/\/nearest\.example\/ws/);
    assert.equal(attempts.some((url) => /^wss:\/\/next-nearest\.example\/ws/.test(url)), false);
  } finally {
    adapter.disconnect();
    globalThis.WebSocket = originalWebSocket;
  }
});

test('failed FreeRTC transport gets the full offer retry window before PeerPigeon redials', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const peerId = '2'.repeat(64);
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const disconnected = [];
  let reannouncements = 0;
  const connection = { connectionState: 'failed', close() {} };
  const channel = { readyState: 'closed', close() {} };

  adapter.client = {
    mesh: { connections: new Map([[peerId, { connection, channel, state: 'failed' }]]) },
    advertise() { reannouncements += 1; },
    requestBootstrap() {},
  };
  adapter.connectedPeers.add(peerId);
  adapter.on('rtc:disconnected', ({ peerId: disconnectedPeerId }) => {
    disconnected.push(disconnectedPeerId);
  });

  adapter.handleConnectionState({ peerId, state: 'failed' });
  assert.deepEqual(disconnected, []);

  t.mock.timers.tick(11_999);
  assert.deepEqual(disconnected, []);

  t.mock.timers.tick(1);
  assert.deepEqual(disconnected, []);
  assert.equal(reannouncements, 1);

  t.mock.timers.tick(19_999);
  assert.deepEqual(disconnected, []);

  t.mock.timers.tick(1);
  assert.deepEqual(disconnected, [peerId]);
});

test('an unacknowledged suspend probe recycles transport without replacing the FreeRTC client', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const peerId = '2'.repeat(64);
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  let disconnects = 0;
  let connects = 0;
  const client = {
    isRegistered: true,
    mesh: { connections: new Map() },
    advertise() {},
    requestBootstrap() {},
    disconnect() { disconnects += 1; },
    connect() { connects += 1; },
  };
  const peerDisconnects = [];
  adapter.client = client;
  adapter.signalingConnected = true;
  adapter.connectedPeers.add(peerId);
  adapter.on('rtc:disconnected', (data) => peerDisconnects.push(data));

  adapter.recoverAfterInactivity('visible');
  t.mock.timers.tick(4_999);
  assert.equal(disconnects, 0);

  t.mock.timers.tick(1);
  assert.equal(disconnects, 1);
  assert.equal(adapter.client, client);
  assert.equal(connects, 0);

  // A zombie WebSocket may never dispatch close, so the same client resumes
  // through the bounded fallback.
  t.mock.timers.tick(1_000);
  assert.equal(connects, 1);
  assert.equal(adapter.client, client);
  assert.deepEqual(peerDisconnects, []);

  // Peer redials are released only after the relay acknowledges registration.
  adapter.flushPendingTransportRestoreFailures();
  assert.deepEqual(peerDisconnects, [{
    peerId,
    reason: 'signaling-transport-restore-failed',
  }]);
});

test('periodic relay acknowledgement checks detect zombie sockets without lifecycle events', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  let bootstrapRequests = 0;
  let disconnects = 0;
  adapter.client = {
    isRegistered: true,
    mesh: { connections: new Map() },
    requestBootstrap() { bootstrapRequests += 1; },
    disconnect() { disconnects += 1; },
    connect() {},
  };

  adapter.startSignalingHealthLoop();
  t.mock.timers.tick(15_000);
  assert.equal(bootstrapRequests, 1);
  assert.equal(disconnects, 0);

  t.mock.timers.tick(5_000);
  assert.equal(disconnects, 1);
  assert.equal(adapter.client.isRegistered, true);

  adapter.stopSignalingHealthLoop();
  adapter.clearSignalingReconnectTimer();
});

test('a transient empty discovery snapshot after resume preserves recent peers', () => {
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const peerIds = ['2', '3', '4', '5'].map((digit) => digit.repeat(64));
  const snapshots = [];
  adapter.on('peers-updated', ({ peers }) => snapshots.push(peers));

  adapter.handleBootstrapCandidates(peerIds.map((peerId) => ({ peerId })));
  adapter.handleBootstrapCandidates([]);

  assert.deepEqual(new Set(snapshots[0]), new Set(peerIds));
  assert.deepEqual(new Set(snapshots[1]), new Set(peerIds));
});
