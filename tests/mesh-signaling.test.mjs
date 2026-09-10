import assert from 'node:assert/strict';
import test from 'node:test';

import { GossipProtocol, PartialMesh, isMeshSignalPayload, MESH_SIGNAL_PAYLOAD_TYPE } from '../dist/index.js';
import { FreeRTCClientAdapter } from '../src/freertc-client-adapter.ts';

const SELF = '0'.repeat(64);
const FAR = 'f'.repeat(64);
const NEAR_FAR = `${'f'.repeat(63)}0`;
const NEIGHBOR = `${'0'.repeat(63)}1`;
const STRANGER = `${'a'.repeat(63)}b`;

function fakeMesh({ connected = [], global = [] } = {}) {
  return {
    on() {},
    getClientId: () => SELF,
    getConnectedPeers: () => [...connected],
    getDiscoveredPeers: () => [],
    getGlobalPeers: () => [...global],
    send() {},
  };
}

test('the gossip layer knows which peers a signaling frame can reach through the mesh', () => {
  const direct = new GossipProtocol(fakeMesh({ connected: [NEIGHBOR], global: [NEIGHBOR] }));
  const routed = new GossipProtocol(fakeMesh({ connected: [NEAR_FAR], global: [NEAR_FAR, FAR] }));
  const isolated = new GossipProtocol(fakeMesh({ global: [FAR] }));
  try {
    // A connected neighbour is always reachable.
    assert.equal(direct.canRouteDirect(NEIGHBOR), true);

    // A member behind a neighbour that makes XOR progress toward it is reachable.
    assert.equal(routed.canRouteDirect(FAR), true);

    // Not a member, or no neighbours at all: nowhere to send it.
    assert.equal(routed.canRouteDirect(STRANGER), false);
    assert.equal(isolated.canRouteDirect(FAR), false);
    assert.equal(routed.canRouteDirect(SELF), false);
    assert.equal(routed.canRouteDirect(''), false);
  } finally {
    for (const protocol of [direct, routed, isolated]) protocol.destroy();
  }
});

test('a signaling envelope inside a direct frame is recognised and never surfaces as chat', () => {
  assert.equal(isMeshSignalPayload({ __ppType: MESH_SIGNAL_PAYLOAD_TYPE, envelope: { type: 'offer' } }), true);
  assert.equal(isMeshSignalPayload({ __ppType: MESH_SIGNAL_PAYLOAD_TYPE }), false);
  assert.equal(isMeshSignalPayload({ __ppType: 'pp-storage-op-v1', envelope: {} }), false);
  assert.equal(isMeshSignalPayload('offer'), false);
});

test('mesh reachability never widens the dial set: a member the relay has not listed is not dialed for it', () => {
  const routable = '1'.repeat(64);
  const unroutable = '2'.repeat(64);
  const mesh = new PartialMesh({ minPeers: 1, maxPeers: 20, autoDiscover: false, autoConnect: false });
  try {
    mesh.setMeshSignaling({ canRoute: (peerId) => peerId === routable, send: () => false });
    const now = Date.now();
    mesh.mergeMembership([routable, unroutable], [], { [routable]: [20, 1, now], [unroutable]: [20, 1, now] }, 'relay');

    const candidates = mesh.dialCandidatePeerIds(false);
    assert.ok(!candidates.includes(routable), 'reachability alone does not make a member a dial candidate');
    assert.ok(!candidates.includes(unroutable));
  } finally {
    mesh.destroy();
  }
});

test('a neighbour can carry another peer\'s frame but never author one on its behalf', () => {
  const mesh = new PartialMesh({ autoDiscover: false, autoConnect: false });
  try {
    const carrier = '3'.repeat(64);
    const author = '4'.repeat(64);
    const envelope = { type: 'offer', from: author, to: SELF, network: 'n', session_id: 'r', body: {} };
    // The direct frame came from `carrier`, the envelope claims `author`.
    assert.equal(mesh.receiveMeshSignal(carrier, envelope), false);
    assert.equal(mesh.receiveMeshSignal(author, null), false);
    assert.equal(mesh.receiveMeshSignal('', envelope), false);
  } finally {
    mesh.destroy();
  }
});

test('the adapter dials over the mesh before any relay registration and applies the answer that comes back', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const sockets = [];
  const peerConnections = [];

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) { this.url = String(url); this.readyState = FakeWebSocket.CONNECTING; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close(code = 1000) { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({ code }); }
  }
  class FakeDataChannel {
    constructor() { this.readyState = 'connecting'; }
    send() {}
    close() { this.readyState = 'closed'; this.onclose?.(); }
  }
  class FakeRTCPeerConnection {
    constructor() {
      this.signalingState = 'stable';
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.iceGatheringState = 'complete';
      this.localDescription = null;
      this.remoteDescription = null;
      peerConnections.push(this);
    }
    addTransceiver() {}
    createDataChannel() { return new FakeDataChannel(); }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:local\r\n' }; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' }; }
    async setLocalDescription(description) { this.localDescription = description; this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'; }
    async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'; }
    async addIceCandidate() {}
    addEventListener() {}
    removeEventListener() {}
    close() { this.signalingState = 'closed'; this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  }
  globalThis.WebSocket = FakeWebSocket;
  globalThis.RTCPeerConnection = FakeRTCPeerConnection;

  const local = '5'.repeat(64);
  const remote = '6'.repeat(64);
  const meshFrames = [];
  const adapter = new FreeRTCClientAdapter('wss://relay.example/ws', {
    networkId: 'mesh-network',
    roomId: 'mesh-room',
    peerId: local,
    meshSignaling: {
      canRoute: (peerId) => peerId === remote,
      send: (envelope) => { meshFrames.push(envelope); return true; },
    },
  });

  try {
    adapter.connect();
    assert.equal(adapter.isConnected(), false, 'the relay has not acknowledged anything');
    assert.equal(adapter.canSignalViaMesh(remote), true);
    assert.equal(adapter.canSignalViaMesh(local), false);

    await adapter.initiateConnection(remote);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const offers = meshFrames.filter((frame) => frame.type === 'offer');
    assert.equal(offers.length, 1, 'the offer left over the mesh');
    assert.equal(offers[0].to, remote);
    assert.equal(offers[0].from, local);
    assert.equal(sockets[0].sent.filter((frame) => frame.type === 'offer').length, 0, 'the relay socket carried no offer');

    const accepted = adapter.injectSignal({
      psp_version: '1.0',
      type: 'answer',
      network: 'mesh-network',
      session_id: 'mesh-room',
      from: remote,
      to: local,
      message_id: 'mesh-answer',
      timestamp: Date.now(),
      ttl_ms: 10000,
      reply_to: null,
      body: { sdp: 'v=0\r\na=ice-ufrag:remote\r\n' },
    });
    assert.equal(accepted, true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(peerConnections[0].remoteDescription?.type, 'answer');

    // A peer the mesh cannot reach still needs the relay.
    await assert.rejects(() => adapter.initiateConnection('7'.repeat(64)), /Not connected/);
  } finally {
    adapter.disconnect();
    globalThis.WebSocket = originalWebSocket;
    globalThis.RTCPeerConnection = originalRTCPeerConnection;
  }
});

test('a direct frame no neighbour takes reports as not sent, so signaling falls back to the relay', () => {
  const sendCalls = [];
  const refusing = {
    on() {},
    getClientId: () => SELF,
    getConnectedPeers: () => [NEAR_FAR],
    getDiscoveredPeers: () => [],
    getGlobalPeers: () => [NEAR_FAR, FAR],
    send: (peerId) => { sendCalls.push(peerId); throw new Error('send buffer full'); },
  };
  const gossip = new GossipProtocol(refusing);
  try {
    assert.equal(gossip.canRouteDirect(FAR), true, 'a route exists on paper');
    assert.equal(gossip.sendDirect(FAR, { hello: 1 }), null, 'but nobody took the frame');
    assert.ok(sendCalls.length >= 1);
  } finally {
    gossip.destroy();
  }
});

test('message copies kept for repair are bounded in bytes, and an oversized payload is never kept', () => {
  const mesh = fakeMesh({ connected: [NEIGHBOR], global: [NEIGHBOR] });
  const gossip = new GossipProtocol(mesh);
  try {
    const big = 'x'.repeat(200 * 1024);
    for (let i = 0; i < 300; i += 1) gossip.broadcast({ i, big });
    const retained = gossip.getRetainedBytes();
    assert.ok(retained > 0, 'copies are kept');
    assert.ok(retained <= 24 * 1024 * 1024, `bounded at 24 MB, held ${retained}`);
    const before = gossip.getRetainedBytes();
    gossip.broadcast({ huge: 'y'.repeat(300 * 1024) });
    assert.equal(gossip.getRetainedBytes(), before, 'a payload past the per-message bound is not retained');
  } finally {
    gossip.destroy();
  }
});
