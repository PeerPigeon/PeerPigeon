import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateMessageLatency,
  formatMessagePeerId,
  formatHopLatency,
  formatHopTrace,
  formatMessageLatency,
  messagePeerSha1,
} from '../examples/vue3/src/message-latency.js';

test('message latency measures original broadcast time to local receipt', () => {
  assert.equal(calculateMessageLatency(1_000, 1_035), 35);
  assert.equal(calculateMessageLatency(2_000, 1_999), 0);
  assert.equal(calculateMessageLatency(undefined, 2_000), null);
});

test('message and hop identities use SHA-1 rather than raw peer identities', () => {
  const peerId = 'FF00112233445566778899aabbccddeeff00112233445566778899aabbccdead';
  assert.equal(messagePeerSha1(peerId), '00e69ad393791d6a821ff9a74dd6f5ef896b3b76');
  assert.equal(formatMessagePeerId(peerId), '00e69a');
  assert.equal(formatMessagePeerId('00e69ad393791d6a821ff9a74dd6f5ef896b3b76'), '00e69a');

  assert.equal(
    formatHopTrace([
      'd01c94aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa111111',
      'a75641bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb222222',
      'f5fdfecccccccccccccccccccccccccccccccccccccccccccccccccccc333333',
    ], 2),
    'Route: 380204 → 865f71 → 74254b',
  );
  assert.equal(
    formatHopTrace(['d01c94aaaa', 'f5fdfecccc'], 4),
    'Route: cf7720 → … 3 omitted … → 2fdf5d',
  );
  assert.equal(formatHopTrace([], 4), '');
});

test('message latency uses compact millisecond, second, and minute labels', () => {
  assert.equal(formatMessageLatency(35), '35ms');
  assert.equal(formatMessageLatency(1_000), '1s');
  assert.equal(formatMessageLatency(1_250), '1.3s');
  assert.equal(formatMessageLatency(6_000), '6s');
  assert.equal(formatMessageLatency(65_000), '1m 5s');
  assert.equal(formatHopLatency(1, 35), '1 hop, 35ms');
  assert.equal(formatHopLatency(2, 6_000), '2 hops, 6s');
});
