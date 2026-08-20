import assert from 'node:assert/strict';
import test from 'node:test';
import { PeerPigeonStorage } from '../dist/index.js';

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

test('uses localStorage pulses only when BroadcastChannel is unavailable', async () => {
  const pulses = { sets: 0, removes: 0 };
  const messages = [];
  class TestBroadcastChannel {
    addEventListener() {}
    removeEventListener() {}
    close() {}
    postMessage(message) { messages.push(message); }
  }
  const restore = [
    replaceGlobal('window', { addEventListener() {}, removeEventListener() {} }),
    replaceGlobal('localStorage', {
      setItem() { pulses.sets += 1; },
      removeItem() { pulses.removes += 1; },
    }),
    replaceGlobal('BroadcastChannel', TestBroadcastChannel),
  ];

  try {
    const channelStorage = new PeerPigeonStorage({
      userId: 'browser-with-channel',
      sessionId: 'cross-tab-channel-test',
      syncSecret: 'cross-tab-test-secret',
    });
    await channelStorage.init();
    await channelStorage.put('private', 'channel-key', { live: true });
    await channelStorage.close();
    assert.equal(messages.length, 1);
    assert.deepEqual(pulses, { sets: 0, removes: 0 });

    globalThis.BroadcastChannel = undefined;
    const fallbackStorage = new PeerPigeonStorage({
      userId: 'browser-without-channel',
      sessionId: 'cross-tab-fallback-test',
      syncSecret: 'cross-tab-test-secret',
    });
    await fallbackStorage.init();
    await fallbackStorage.put('private', 'fallback-key', { live: true });
    await fallbackStorage.close();
    assert.deepEqual(pulses, { sets: 1, removes: 1 });
  } finally {
    for (const restoreGlobal of restore.reverse()) restoreGlobal();
  }
});
