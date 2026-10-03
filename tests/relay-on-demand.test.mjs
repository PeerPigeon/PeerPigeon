// The adapter lets FreeRTC release its relay socket while the mesh is healthy, so it must not
// read that quiet as a dead relay: no reconnect, no acknowledgement probe, and the peer still
// counts as connected.
import assert from 'node:assert/strict';
import test from 'node:test';

import { FreeRTCClientAdapter } from '../src/freertc-client-adapter.ts';

const HEALTH_INTERVAL_MS = 15_000;
const PEER_ID = '1'.repeat(64);
const meshSignaling = { send: () => false, canRoute: () => false };

class QuietWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = String(url);
    this.readyState = QuietWebSocket.CONNECTING;
  }

  send() {}

  close(code = 1000) {
    this.readyState = QuietWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

/** Runs `body` with a fake WebSocket installed and the real one restored afterwards. */
function withQuietSockets(body) {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = QuietWebSocket;
  try {
    return body();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
}

test('on-demand relay is requested only when the mesh can carry signaling', () => {
  withQuietSockets(() => {
    const withMesh = new FreeRTCClientAdapter('wss://relay.example/ws', { peerId: PEER_ID, meshSignaling });
    const withoutMesh = new FreeRTCClientAdapter('wss://relay.example/ws', { peerId: PEER_ID });
    const optedOut = new FreeRTCClientAdapter('wss://relay.example/ws', { peerId: PEER_ID, meshSignaling, relayOnDemand: false });
    try {
      for (const adapter of [withMesh, withoutMesh, optedOut]) adapter.connect();
      assert.equal(withMesh.client.relayMode, 'on-demand');
      assert.equal(withoutMesh.client.relayMode, 'always');
      assert.equal(optedOut.client.relayMode, 'always');
    } finally {
      for (const adapter of [withMesh, withoutMesh, optedOut]) adapter.disconnect();
    }
  });
});

test('a relay released on purpose still counts as connected', () => {
  withQuietSockets(() => {
    const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', { peerId: PEER_ID, meshSignaling });
    try {
      adapter.connect();
      assert.equal(adapter.isConnected(), false, 'a relay that never acknowledged is not connected');
      Object.defineProperty(adapter.client, 'relayIdle', { value: true });
      assert.equal(adapter.isConnected(), true);
    } finally {
      adapter.disconnect();
    }
  });
});

test('the health check leaves a released relay closed, and still chases a dead one', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  withQuietSockets(() => {
    const reconnects = (adapter) => {
      const calls = [];
      adapter.client.connect = () => { calls.push('connect'); };
      adapter.client.reconnectSignaling = () => { calls.push('reconnectSignaling'); };
      adapter.client.requestBootstrap = () => { calls.push('requestBootstrap'); };
      return calls;
    };
    const idle = new FreeRTCClientAdapter('wss://relay.example/ws', { peerId: PEER_ID, meshSignaling });
    const dead = new FreeRTCClientAdapter('wss://relay.example/ws', { peerId: PEER_ID, meshSignaling });
    try {
      idle.connect();
      dead.connect();
      const idleCalls = reconnects(idle);
      const deadCalls = reconnects(dead);
      Object.defineProperty(idle.client, 'relayIdle', { value: true });

      t.mock.timers.tick(HEALTH_INTERVAL_MS * 2);

      assert.deepEqual(idleCalls, [], 'a released relay is not reopened by the health check');
      assert.ok(deadCalls.length > 0, 'a relay that never registered is still retried');
    } finally {
      idle.disconnect();
      dead.disconnect();
    }
  });
});
