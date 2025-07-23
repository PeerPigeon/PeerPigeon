import { jest } from '@jest/globals';
import { WebDHT } from '../../src/WebDHT.js';

// Mock the entire WebDHT module's TimerUtils import
const mockTimerUtils = {
  safeSetInterval: jest.fn((fn, interval) => setInterval(fn, interval)),
  safeClearInterval: jest.fn((id) => clearInterval(id)),
  safeSetTimeout: jest.fn((fn, timeout) => setTimeout(fn, timeout)),
  safeClearTimeout: jest.fn((id) => clearTimeout(id))
};

// Mock module path resolution
jest.unstable_mockModule('../../src/TimerUtils.js', () => mockTimerUtils);

describe('WebDHT Pending Subscriptions', () => {
  let mockMesh;
  let webDHT;

  beforeEach(() => {
    // Create a mock mesh
    mockMesh = {
      peerId: 'test-peer-123',
      connectionManager: {
        getConnectedPeers: jest.fn(() => []),
        sendDirectMessage: jest.fn(() => Promise.resolve())
      }
    };

    webDHT = new WebDHT(mockMesh);

    // Mock the sendDHTMessage method
    webDHT.sendDHTMessage = jest.fn(() => Promise.resolve({ success: true }));

    // Mock the findClosestPeers method
    webDHT.findClosestPeers = jest.fn(() => Promise.resolve(['peer1', 'peer2', 'test-peer-123']));
  });

  afterEach(() => {
    if (webDHT.maintenanceInterval) {
      clearInterval(webDHT.maintenanceInterval);
    }
  });

  test('should allow subscription to non-existent key', async () => {
    const key = 'non-existent-key';

    // Subscribe to a key that doesn't exist yet
    const result = await webDHT.subscribe(key);

    // Should return null since key doesn't exist
    expect(result).toBeNull();

    // Should have added to mySubscriptions
    const keyId = await webDHT.generateKeyId(key);
    expect(webDHT.mySubscriptions.has(keyId)).toBe(true);

    // Should have sent subscription requests to closest peers
    expect(webDHT.sendDHTMessage).toHaveBeenCalledWith(
      'peer1',
      'subscribe',
      expect.objectContaining({
        keyId,
        key,
        subscriber: 'test-peer-123'
      })
    );
  });

  test('should activate pending subscriptions when key is created', async () => {
    const key = 'future-key';
    const keyId = await webDHT.generateKeyId(key);

    // Add a pending subscription
    webDHT.addPendingSubscription(keyId, 'subscriber-peer');

    expect(webDHT.pendingSubscriptions.has(keyId)).toBe(true);
    expect(webDHT.subscriptions.has(keyId)).toBe(false);

    // Activate pending subscriptions
    const activatedSubscribers = webDHT.activatePendingSubscriptions(keyId);

    expect(activatedSubscribers).toEqual(['subscriber-peer']);
    expect(webDHT.pendingSubscriptions.has(keyId)).toBe(false);
    expect(webDHT.subscriptions.has(keyId)).toBe(true);
    expect(webDHT.subscriptions.get(keyId).has('subscriber-peer')).toBe(true);
  });

  test('should handle subscribe request for non-existent key', async () => {
    const key = 'future-key';
    const keyId = await webDHT.generateKeyId(key);
    const subscriberId = 'requesting-peer';

    // Handle a subscribe request for a non-existent key
    await webDHT.handleSubscribeRequest('sender-peer', {
      keyId,
      key,
      subscriber: subscriberId
    });

    // Should add to pending subscriptions since key doesn't exist
    expect(webDHT.pendingSubscriptions.has(keyId)).toBe(true);
    expect(webDHT.pendingSubscriptions.get(keyId).has(subscriberId)).toBe(true);
    expect(webDHT.subscriptions.has(keyId)).toBe(false);
  });

  test('should notify pending subscribers when key is first stored', async () => {
    const key = 'new-key';
    const keyId = await webDHT.generateKeyId(key);
    const value = 'initial-value';

    // Add pending subscriptions
    webDHT.addPendingSubscription(keyId, 'subscriber1');
    webDHT.addPendingSubscription(keyId, 'subscriber2');

    // Mock sendDHTMessage to track notifications
    const notificationPromises = [];
    webDHT.sendDHTMessage = jest.fn(() => {
      const promise = Promise.resolve({ success: true });
      notificationPromises.push(promise);
      return promise;
    });

    // Simulate storing a new key
    await webDHT.handleStoreRequest('storing-peer', {
      keyId,
      key,
      value,
      timestamp: Date.now(),
      ttl: null,
      publisher: 'original-peer',
      messageId: 'msg123'
    });

    // Should have activated pending subscriptions
    expect(webDHT.pendingSubscriptions.has(keyId)).toBe(false);
    expect(webDHT.subscriptions.has(keyId)).toBe(true);

    // Should have notified pending subscribers
    expect(webDHT.sendDHTMessage).toHaveBeenCalledWith(
      'subscriber1',
      'value_changed',
      expect.objectContaining({
        key,
        keyId,
        newValue: value,
        isNewKey: true
      })
    );

    expect(webDHT.sendDHTMessage).toHaveBeenCalledWith(
      'subscriber2',
      'value_changed',
      expect.objectContaining({
        key,
        keyId,
        newValue: value,
        isNewKey: true
      })
    );
  });

  test('should notify pending subscribers when putting new key', async () => {
    const key = 'brand-new-key';
    const value = 'first-value';

    // Add a pending subscription for this peer
    const keyId = await webDHT.generateKeyId(key);
    webDHT.addPendingSubscription(keyId, 'waiting-peer');

    // Mock sendDHTMessage
    webDHT.sendDHTMessage = jest.fn(() => Promise.resolve({ success: true }));

    // Mock performIterativePut to avoid complexity
    webDHT.performIterativePut = jest.fn(() => Promise.resolve(true));

    // Put the new key
    await webDHT.put(key, value);

    // Should have activated pending subscriptions and notified
    expect(webDHT.pendingSubscriptions.has(keyId)).toBe(false);
    expect(webDHT.subscriptions.has(keyId)).toBe(true);

    // Should have notified the waiting peer
    expect(webDHT.sendDHTMessage).toHaveBeenCalledWith(
      'waiting-peer',
      'value_changed',
      expect.objectContaining({
        key,
        keyId,
        newValue: value,
        isNewKey: true
      })
    );
  });

  test('should handle value changed notification for new key', async () => {
    const key = 'incoming-new-key';
    const keyId = await webDHT.generateKeyId(key);
    const value = 'new-value';
    const timestamp = Date.now();

    // Subscribe to the key (should be added to mySubscriptions)
    webDHT.mySubscriptions.add(keyId);

    // Mock emit to track events
    const emitSpy = jest.spyOn(webDHT, 'emit');

    // Handle value changed notification for new key
    await webDHT.handleValueChangedNotification('notifying-peer', {
      key,
      keyId,
      newValue: value,
      timestamp,
      isNewKey: true
    });

    // Should have cached the new key locally
    expect(webDHT.localStorage.has(keyId)).toBe(true);
    const storedData = webDHT.localStorage.get(keyId);
    expect(storedData.value).toBe(value);
    expect(storedData.key).toBe(key);

    // Should have emitted valueChanged event
    expect(emitSpy).toHaveBeenCalledWith('valueChanged', {
      key,
      keyId,
      newValue: value,
      timestamp,
      isNewKey: true
    });
  });

  test('should clean up pending subscriptions on unsubscribe', async () => {
    const key = 'cleanup-test-key';
    const keyId = await webDHT.generateKeyId(key);

    // Add to both active and pending subscriptions
    webDHT.mySubscriptions.add(keyId);
    webDHT.addSubscription(keyId, webDHT.peerId);
    webDHT.addPendingSubscription(keyId, webDHT.peerId);

    // Mock sendDHTMessage
    webDHT.sendDHTMessage = jest.fn(() => Promise.resolve());

    // Unsubscribe
    await webDHT.unsubscribe(key);

    // Should have cleaned up all subscription types
    expect(webDHT.mySubscriptions.has(keyId)).toBe(false);
    expect(webDHT.subscriptions.has(keyId)).toBe(false);
    expect(webDHT.pendingSubscriptions.has(keyId)).toBe(false);
  });
});
