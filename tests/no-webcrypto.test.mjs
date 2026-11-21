// Pages with no crypto.subtle (plain http): PeerPigeon's hashes, blob sealing and storage keys run on
// unsea's stand-in and give the same bytes as with WebCrypto. Run: node --test tests/no-webcrypto.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';

const dist = new URL('../dist/index.js', import.meta.url).href;
const content = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 13 + 7) % 256);

// The same work in a process that has WebCrypto, for comparison.
const withWebCrypto = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
  const pp = await import(${JSON.stringify(dist)});
  const content = Uint8Array.from({ length: 200000 }, (_, i) => (i * 13 + 7) % 256);
  const s = await pp.sealBlob(content);
  const ranked = await pp.rankSignalingServersByDistance('ab'.repeat(32), ['wss://a.example/ws', 'wss://b.example/ws', 'wss://c.example/ws']);
  console.log(JSON.stringify({ hash: s.hash, address: s.address, sealed: Buffer.from(s.sealed).toString('hex'), ranked }));
`]).toString());

test('without crypto.subtle: blobs seal to the same bytes, and open; relays rank the same', async () => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: (a) => webcrypto.getRandomValues(a) } });
  assert.equal(globalThis.crypto.subtle, undefined);
  const pp = await import(dist);
  const s = await pp.sealBlob(content);
  assert.equal(s.hash, withWebCrypto.hash);
  assert.equal(s.address, withWebCrypto.address);
  assert.equal(Buffer.from(s.sealed).toString('hex'), withWebCrypto.sealed);
  assert.deepEqual(await pp.openBlob(s.hash, Uint8Array.from(Buffer.from(withWebCrypto.sealed, 'hex'))), content);
  const bad = Uint8Array.from(s.sealed); bad[10] ^= 1;
  assert.equal(await pp.openBlob(s.hash, bad), null);
  assert.deepEqual(await pp.rankSignalingServersByDistance('ab'.repeat(32), ['wss://a.example/ws', 'wss://b.example/ws', 'wss://c.example/ws']), withWebCrypto.ranked);
});
