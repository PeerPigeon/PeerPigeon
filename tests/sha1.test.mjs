import assert from 'node:assert/strict';
import test from 'node:test';

import { sha1Hex } from '../dist/index.js';

test('SHA-1 display identifiers match the standard digest', () => {
  assert.equal(sha1Hex(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});
