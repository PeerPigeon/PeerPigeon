import assert from 'node:assert/strict';
import test from 'node:test';
import { relayDisplayName, relayNameOf } from '../dist/index.js';

const ID = 'ef0d4c0a988ec0d2f2bca53fd9f6b4e72f6f6c332cc2ff7b339b9a95f736f40a';
const hasAddress = (s) => /\d{1,3}(\.\d{1,3}){3}|localhost|\[|::/.test(s);

test('a relay is shown by its host name, or its node id: never by a label with an address in it', () => {
  assert.equal(relayNameOf({ name: 'wss://ef0d4c0a988ec0d2.decentralize.ooo:8443/ws', node_id: ID }), 'ef0d4c0a988ec0d2.decentralize.ooo');
  assert.equal(relayNameOf({ name: 'freertc-node-127.0.0.1-8788', node_id: ID }), 'relay ef0d4c0a988ec0d2');
  assert.equal(relayNameOf({ name: 'freertc-node-192.168.5.15-8788', node_id: ID }), 'relay ef0d4c0a988ec0d2');
  assert.equal(relayNameOf({ name: 'freertc-ef0d4c0a988ec0d2', node_id: ID }), 'relay ef0d4c0a988ec0d2');
  assert.equal(relayNameOf({ name: null, node_id: ID }), 'relay ef0d4c0a988ec0d2');
  assert.equal(relayNameOf({ name: 'wss://127.0.0.1:8443/ws' }), null);
});

test('no relay address a page can be on is shown as an IP address', () => {
  const urls = [
    'webrtc-direct://67.52.200.58:9443/sha256/' + 'e8'.repeat(32) + '?lan=192.168.5.15%3A9443',
    'ws://127.0.0.1:8788/ws', 'ws://192.168.50.184:8788/ws', 'ws://localhost:8788/ws', 'ws://[::1]:8788/ws', 'wss://203.0.113.7:8443/ws',
  ];
  for (const url of urls) assert.ok(!hasAddress(relayDisplayName(url)), `${url} shows as "${relayDisplayName(url)}"`);
  assert.equal(relayDisplayName('ws://127.0.0.1:8788/ws'), 'local relay');
  assert.equal(relayDisplayName('webrtc-direct://67.52.200.58:9443/sha256/' + 'e8'.repeat(32)), 'direct relay');
  assert.equal(relayDisplayName('wss://peer.ooo/ws'), 'peer.ooo');
  assert.equal(relayDisplayName('wss://ef0d4c0a988ec0d2.decentralize.ooo:8443/ws'), 'ef0d4c0a988ec0d2.decentralize.ooo:8443');
});
