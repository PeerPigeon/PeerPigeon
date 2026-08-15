import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalPeerId, formatPeerId } from '../examples/vue3/src/peer-id.js';

test('all compact peer identity labels use the exact canonical first four characters', () => {
  const peerId = 'FF00112233445566778899aabbccddeeff00112233445566778899aabbccdead';
  assert.equal(canonicalPeerId(`  ${peerId}  `), peerId);
  assert.equal(formatPeerId(peerId), 'FF00');
});

test('short peer IDs are displayed verbatim', () => {
  assert.equal(formatPeerId('DeAd'), 'DeAd');
});
