import assert from 'node:assert/strict';
import test from 'node:test';

import { FreeRTCClientAdapter } from '../src/freertc-client-adapter.ts';

test('adapter withdraws the previous reload identity before registering its replacement', () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];

  class RecordingWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = String(url);
      this.readyState = RecordingWebSocket.CONNECTING;
      this.sent = [];
      sockets.push(this);
    }

    send(value) {
      this.sent.push(JSON.parse(value));
    }

    open() {
      this.readyState = RecordingWebSocket.OPEN;
      this.onopen?.();
    }

    close(code = 1000) {
      this.readyState = RecordingWebSocket.CLOSED;
      this.onclose?.({ code });
    }
  }

  globalThis.WebSocket = RecordingWebSocket;
  const currentPeerId = '1'.repeat(64);
  const previousPeerId = '2'.repeat(64);
  const adapter = new FreeRTCClientAdapter('wss://new-relay.example/ws', {
    networkId: 'reload-network',
    roomId: 'reload-room',
    peerId: currentPeerId,
    previousPeerId,
    previousPeerSignalUrls: ['wss://old-relay.example/ws'],
  });

  try {
    adapter.connect();
    assert.equal(sockets.length, 2);

    const [cleanupSocket, currentSocket] = sockets;
    assert.match(cleanupSocket.url, /^wss:\/\/old-relay\.example\/ws/);
    assert.match(currentSocket.url, /^wss:\/\/new-relay\.example\/ws/);

    cleanupSocket.open();
    assert.equal(cleanupSocket.sent.length, 1);
    assert.equal(cleanupSocket.sent[0].type, 'withdraw');
    assert.equal(cleanupSocket.sent[0].from, previousPeerId);
    assert.equal(cleanupSocket.sent[0].network, 'reload-network');
    assert.equal(cleanupSocket.sent[0].session_id, 'reload-room');
    assert.equal(cleanupSocket.readyState, RecordingWebSocket.CLOSED);

    currentSocket.open();
    assert.equal(currentSocket.sent[0].type, 'announce');
    assert.equal(currentSocket.sent[0].from, currentPeerId);
  } finally {
    adapter.disconnect();
    globalThis.WebSocket = originalWebSocket;
  }
});

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

    // FreeRTC owns every retry and its backoff on the selected federated relay.
    failLatestSocket();
    t.mock.timers.tick(0);
    assert.equal(attempts.length, 2);
    failLatestSocket();
    t.mock.timers.tick(1_000);
    failLatestSocket();
    t.mock.timers.tick(1_500);

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

test('resume clears every adapter and FreeRTC recovery backoff immediately', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  let resets = 0;
  let discoveryRequests = 0;
  adapter.client = {
    isRegistered: true,
    mesh: { connections: new Map() },
    resetRecoveryBackoffs() { resets += 1; },
    advertise() {},
    requestBootstrap() { discoveryRequests += 1; },
    disconnect() {},
  };
  adapter.recoveringPeerIds.add('2'.repeat(64));
  adapter.pendingTransportRestorePeerIds.add('3'.repeat(64));
  adapter.recyclingSignalingTransport = true;
  adapter.waitingForTransportClose = true;
  adapter.lastBootstrapAtMs = Date.now();

  try {
    assert.equal(adapter.recoverAfterInactivity('resume'), true);
    assert.equal(resets, 1);
    assert.equal(discoveryRequests, 1);
    assert.equal(adapter.recoveringPeerIds.size, 0);
    assert.equal(adapter.pendingTransportRestorePeerIds.size, 0);
    assert.equal(adapter.recyclingSignalingTransport, false);
    assert.equal(adapter.waitingForTransportClose, false);
    assert.equal(adapter.lastBootstrapAtMs, 0);

    // Focus/pageshow events in the same thaw are not blocked by an old throttle.
    assert.equal(adapter.recoverAfterInactivity('focus'), true);
    assert.equal(resets, 2);
    assert.equal(discoveryRequests, 2);
  } finally {
    adapter.disconnect();
  }
});

test('a failed transport is released and redialed immediately even with another healthy edge', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const peerId = '2'.repeat(64);
  const healthyPeerId = '3'.repeat(64);
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const disconnected = [];
  let reannouncements = 0;
  const connection = { connectionState: 'failed', close() {} };
  const channel = { readyState: 'closed', close() {} };
  const healthyEntry = {
    connection: { connectionState: 'connected', close() {} },
    channel: { readyState: 'open', close() {} },
    state: 'connected',
  };

  adapter.client = {
    mesh: { connections: new Map([
      [peerId, { connection, channel, state: 'failed' }],
      [healthyPeerId, healthyEntry],
    ]) },
    advertise() { reannouncements += 1; },
    requestBootstrap() {},
  };
  adapter.connectedPeers.add(peerId);
  adapter.connectedPeers.add(healthyPeerId);
  adapter.on('rtc:disconnected', ({ peerId: disconnectedPeerId }) => {
    disconnected.push(disconnectedPeerId);
  });

  adapter.handleConnectionState({ peerId, state: 'failed' });
  assert.deepEqual(disconnected, [peerId]);
  assert.equal(reannouncements, 1);
  assert.equal(adapter.client.mesh.connections.has(peerId), false);
  assert.equal(adapter.client.mesh.connections.has(healthyPeerId), true);

  // A new FreeRTC generation clears the old recovery guard. If that
  // replacement also fails, it must be released immediately as well.
  adapter.client.mesh.connections.set(peerId, { connection, channel, state: 'connecting' });
  adapter.handleConnectionState({ peerId, state: 'connecting' });
  adapter.handleConnectionState({ peerId, state: 'failed' });
  assert.deepEqual(disconnected, [peerId, peerId]);
  assert.equal(reannouncements, 2);
});

test('an exhausted FreeRTC offer releases its pending slot and refreshes discovery immediately', () => {
  const peerId = '2'.repeat(64);
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const connection = { connectionState: 'new', closeCalls: 0, close() { this.closeCalls += 1; } };
  const channel = { readyState: 'connecting', closeCalls: 0, close() { this.closeCalls += 1; } };
  const disconnected = [];
  const failures = [];
  const logs = [];
  let reannouncements = 0;
  let discoveryRequests = 0;

  adapter.client = {
    mesh: { connections: new Map([[peerId, { connection, channel, state: 'connecting' }]]) },
    advertise() { reannouncements += 1; },
    requestBootstrap() { discoveryRequests += 1; },
  };
  adapter.on('rtc:disconnected', ({ peerId: disconnectedPeerId }) => disconnected.push(disconnectedPeerId));
  adapter.on('rtc:negotiation-failed', (details) => failures.push(details));
  adapter.on('signaling:log', ({ message }) => logs.push(message));

  adapter.handleNegotiationFailure({ peerId, reason: 'offer_retries_exhausted' });

  assert.equal(adapter.client.mesh.connections.has(peerId), false);
  assert.equal(connection.closeCalls, 1);
  assert.equal(channel.closeCalls, 1);
  assert.equal(reannouncements, 1);
  assert.equal(discoveryRequests, 2);
  assert.deepEqual(disconnected, [peerId]);
  assert.deepEqual(failures, [{ peerId, reason: 'offer_retries_exhausted' }]);
  assert.ok(logs.some((message) => message.includes('offer_retries_exhausted')));
  assert.ok(logs.some((message) => message.includes('released immediately; redialing')));
});

test('an isolated adapter releases every stale direct edge immediately', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const peerIds = ['2'.repeat(64), '3'.repeat(64)];
  let reannouncements = 0;
  const disconnected = [];
  const entries = new Map(peerIds.map((peerId) => [peerId, {
    state: 'connected',
    connection: { connectionState: 'connected', close() {} },
    channel: { readyState: 'open', close() {} },
  }]));
  adapter.client = {
    isRegistered: true,
    mesh: { connections: entries },
    advertise() { reannouncements += 1; },
    requestBootstrap() {},
  };
  for (const peerId of peerIds) adapter.connectedPeers.add(peerId);
  adapter.on('rtc:disconnected', ({ peerId }) => disconnected.push(peerId));

  entries.get(peerIds[0]).state = 'recovering';
  entries.get(peerIds[0]).connection.connectionState = 'disconnected';
  entries.get(peerIds[0]).channel.readyState = 'closed';
  adapter.handleConnectionState({ peerId: peerIds[0], state: 'disconnected' });

  assert.equal(reannouncements, 1);
  assert.deepEqual(disconnected, [peerIds[0]]);
  assert.equal(entries.size, 1);

  entries.get(peerIds[1]).state = 'recovering';
  entries.get(peerIds[1]).connection.connectionState = 'disconnected';
  entries.get(peerIds[1]).channel.readyState = 'closed';
  adapter.handleConnectionState({ peerId: peerIds[1], state: 'disconnected' });

  assert.equal(reannouncements, 2);
  assert.deepEqual(new Set(disconnected), new Set(peerIds));
  assert.equal(entries.size, 0);

  adapter.disconnect();
});

test('data-channel closure starts recovery before peer-connection state changes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const peerId = '2'.repeat(64);
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const listeners = new Map();
  const channel = {
    readyState: 'open',
    close() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const entry = {
    state: 'connected',
    connection: { connectionState: 'connected', close() {} },
    channel,
  };
  let reannouncements = 0;
  adapter.client = {
    isRegistered: true,
    mesh: { connections: new Map([[peerId, entry]]) },
    advertise() { reannouncements += 1; },
    requestBootstrap() {},
  };

  adapter.waitForOpenDataChannel(peerId);
  assert.equal(adapter.connectedPeers.has(peerId), true);
  assert.equal(typeof listeners.get('close'), 'function');

  channel.readyState = 'closed';
  listeners.get('close')();
  assert.equal(reannouncements, 1);

  adapter.disconnect();
});

test('data-channel open is event-driven with no polling delay', () => {
  const peerId = '2'.repeat(64);
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const listeners = new Map();
  const channel = {
    readyState: 'connecting',
    close() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  adapter.client = {
    mesh: { connections: new Map([[peerId, {
      state: 'connected',
      connection: { connectionState: 'connected', close() {} },
      channel,
    }]]) },
    requestBootstrap() {},
    advertise() {},
  };
  const connected = [];
  adapter.on('rtc:connected', ({ peerId: connectedPeerId }) => connected.push(connectedPeerId));

  adapter.handleConnectionState({ peerId, state: 'connected' });
  assert.deepEqual(connected, []);
  assert.equal(typeof listeners.get('open'), 'function');

  channel.readyState = 'open';
  listeners.get('open')();
  assert.deepEqual(connected, [peerId]);

  adapter.disconnect();
});

test('broadcast send failure releases the unusable edge immediately', () => {
  const peerId = '2'.repeat(64);
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const connections = new Map([[peerId, {
    state: 'connected',
    connection: { connectionState: 'connected', close() {} },
    channel: { readyState: 'open', close() {} },
  }]]);
  adapter.client = {
    mesh: { connections },
    sendData() { throw new Error('channel is no longer writable'); },
    requestBootstrap() {},
    advertise() {},
  };
  adapter.connectedPeers.add(peerId);
  const disconnected = [];
  adapter.on('rtc:disconnected', ({ peerId: disconnectedPeerId }) => disconnected.push(disconnectedPeerId));

  adapter.broadcast('payload');

  assert.deepEqual(disconnected, [peerId]);
  assert.equal(connections.has(peerId), false);
  adapter.disconnect();
});

test('suspend recovery releases missing peer edges immediately and recycles the same FreeRTC client', (t) => {
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
  assert.deepEqual(peerDisconnects, [{ peerId }]);
  t.mock.timers.tick(4_999);
  assert.equal(disconnects, 0);

  t.mock.timers.tick(1);
  assert.equal(disconnects, 1);
  assert.equal(adapter.client, client);
  assert.equal(connects, 1);
  assert.equal(adapter.client, client);

  // The missing edge was already released; a later registration flush must
  // not emit a duplicate disconnect.
  adapter.flushPendingTransportRestoreFailures();
  assert.deepEqual(peerDisconnects, [{ peerId }]);
});

test('an unregistered signaling transport recovers without another peer announcing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  let disconnects = 0;
  let connects = 0;
  const client = {
    isRegistered: false,
    mesh: { connections: new Map() },
    advertise() {},
    requestBootstrap() {},
    disconnect() { disconnects += 1; },
    connect() { connects += 1; },
  };
  adapter.client = client;

  adapter.recoverAfterInactivity('signaling-watchdog');
  assert.equal(connects, 1);

  t.mock.timers.tick(4_999);
  assert.equal(disconnects, 0);

  // A FreeRTC connect call is a no-op while its old WebSocket remains OPEN or
  // CONNECTING. The registration deadline must therefore recycle that socket.
  t.mock.timers.tick(1);
  assert.equal(disconnects, 1);
  assert.equal(adapter.client, client);
  assert.equal(connects, 2);
  assert.equal(adapter.client, client);

  // Missing a second acknowledgement must start another bounded recycle;
  // the adapter cannot remain trapped in "reconnect in progress".
  t.mock.timers.tick(5_000);
  assert.equal(disconnects, 2);
  assert.equal(connects, 3);

  adapter.disconnect();
});

test('connect resynchronizes adapter state when FreeRTC is already registered', () => {
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  let connectedEvents = 0;
  let connects = 0;
  let bootstrapRequests = 0;
  adapter.client = {
    isRegistered: true,
    mesh: { connections: new Map() },
    advertise() {},
    requestBootstrap() { bootstrapRequests += 1; },
    disconnect() {},
    connect() { connects += 1; },
  };
  adapter.on('connected', () => { connectedEvents += 1; });

  adapter.connect();

  assert.equal(connectedEvents, 1);
  assert.equal(connects, 0);
  assert.equal(bootstrapRequests, 1);

  adapter.disconnect();
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
});

test('a transient empty discovery snapshot after resume preserves recent peers', () => {
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const peerIds = ['2', '3', '4', '5'].map((digit) => digit.repeat(64));
  const snapshots = [];
  const activeSnapshots = [];
  adapter.on('peers-updated', ({ peers, activePeers }) => {
    snapshots.push(peers);
    activeSnapshots.push(activePeers);
  });

  adapter.handleBootstrapCandidates(peerIds.map((peerId) => ({ peerId })));
  adapter.handleBootstrapCandidates([]);

  assert.deepEqual(new Set(snapshots[0]), new Set(peerIds));
  assert.deepEqual(new Set(snapshots[1]), new Set(peerIds));
  assert.deepEqual(new Set(activeSnapshots[0]), new Set(peerIds));
  assert.deepEqual(activeSnapshots[1], []);
});

test('stale relay leases remain in discovery grace but not in the active peer count', () => {
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    peerId: '1'.repeat(64),
  });
  const currentPeerId = '2'.repeat(64);
  const stalePeerId = '3'.repeat(64);
  let snapshot = null;
  adapter.on('peers-updated', (peers) => { snapshot = peers; });

  adapter.handleBootstrapCandidates([
    { peerId: currentPeerId, advertisedAt: Date.now() },
    { peerId: stalePeerId, advertisedAt: Date.now() - 20_000 },
  ]);

  assert.deepEqual(new Set(snapshot.peers), new Set([currentPeerId, stalePeerId]));
  assert.deepEqual(snapshot.activePeers, [currentPeerId]);
});
