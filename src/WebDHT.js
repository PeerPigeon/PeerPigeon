import { EventEmitter } from './EventEmitter.js';
import { safeSetInterval, safeClearInterval, safeSetTimeout, safeClearTimeout } from './TimerUtils.js';

/**
 * WebDHT - A Kademlia-like Distributed Hash Table for WebRTC mesh networks
 *
 * Features:
 * - Key-value storage with closest peer routing
 * - Subscribe/unsubscribe to key changes
 * - Automatic replication and fault tolerance
 * - XOR distance-based routing
 */
export class WebDHT extends EventEmitter {
  constructor(mesh) {
    super();
    this.mesh = mesh;
    this.peerId = mesh.peerId;

    // Local storage for key-value pairs this peer is responsible for
    this.localStorage = new Map();

    // Subscriptions: key -> Set of peer IDs that want notifications
    this.subscriptions = new Map();

    // Pending subscriptions for keys that don't exist yet: keyId -> Set of peer IDs
    this.pendingSubscriptions = new Map();

    // Active subscriptions from this peer to others
    this.mySubscriptions = new Set();

    // Routing table for faster lookups (k-buckets)
    this.routingTable = new Map();

    // Configuration
    this.config = {
      k: 20, // Bucket size (number of peers per bucket)
      alpha: 3, // Parallelism factor for lookups
      replicationFactor: 3, // Number of peers to store each key
      ttl: null, // Default TTL: null = no expiration (records persist indefinitely)
      refreshInterval: 300000 // Refresh interval (5 minutes)
    };

    // Setup message handlers
    this.setupMessageHandlers();

    // Start periodic maintenance
    this.startMaintenance();

    console.log(`WebDHT initialized for peer ${this.peerId.substring(0, 8)}...`);
  }

  /**
     * Setup message handlers for DHT operations
     */
  setupMessageHandlers() {
    console.log(`🔥 DHT Setting up message handlers for peer ${this.peerId.substring(0, 8)}`);

    // DHT messages now come through ConnectionManager's handleIncomingMessage
    // which routes 'dht' type messages to this.mesh.webDHT.handleMessage
    // So we don't need to listen to gossip manager events anymore

    console.log(`🔥 DHT Message handlers setup complete for peer ${this.peerId.substring(0, 8)}`);
  }

  /**
     * Handle incoming DHT messages - called by ConnectionManager
     */
  async handleMessage(message, fromPeerId) {
    console.log(`🔥 DHT Message received from ${fromPeerId.substring(0, 8)}:`, message);

    // Extract the DHT operation type and data
    const type = message.messageType || message.type;
    const data = message.data;

    if (!type || !data) {
      console.error(`🔥 DHT Invalid message structure from ${fromPeerId.substring(0, 8)}:`, message);
      return;
    }

    console.log(`🔥 DHT Processing ${type} from ${fromPeerId.substring(0, 8)}, data:`, data);

    try {
      switch (type) {
        case 'store':
          console.log(`🔥 DHT Handling store request from ${fromPeerId.substring(0, 8)}`);
          await this.handleStoreRequest(fromPeerId, data);
          break;
        case 'find_value':
          console.log(`🔥 DHT Handling find_value request from ${fromPeerId.substring(0, 8)}`);
          await this.handleFindValueRequest(fromPeerId, data);
          break;
        case 'find_node':
          console.log(`🔥 DHT Handling find_node request from ${fromPeerId.substring(0, 8)}`);
          await this.handleFindNodeRequest(fromPeerId, data);
          break;
        case 'subscribe':
          console.log(`🔥 DHT Handling subscribe request from ${fromPeerId.substring(0, 8)}`);
          await this.handleSubscribeRequest(fromPeerId, data);
          break;
        case 'unsubscribe':
          console.log(`🔥 DHT Handling unsubscribe request from ${fromPeerId.substring(0, 8)}`);
          await this.handleUnsubscribeRequest(fromPeerId, data);
          break;
        case 'value_changed':
          console.log(`🔥 DHT Handling value_changed notification from ${fromPeerId.substring(0, 8)}`);
          await this.handleValueChangedNotification(fromPeerId, data);
          break;
        case 'update_value':
          console.log(`🔥 DHT Handling update_value request from ${fromPeerId.substring(0, 8)}`);
          await this.handleUpdateValueRequest(fromPeerId, data);
          break;
        case 'store_response':
        case 'find_value_response':
        case 'find_node_response':
        case 'update_value_response':
          console.log(`🔥 DHT Handling response (${type}) from ${fromPeerId.substring(0, 8)}`);
          this.handleResponse(fromPeerId, data);
          break;
        default:
          console.warn(`Unknown DHT message type: ${type}`);
      }
    } catch (error) {
      console.error(`🔥 DHT Error handling message type ${type} from ${fromPeerId.substring(0, 8)}:`, error);
    }
  }

  /**
     * Store a key-value pair in the DHT
     */
  async put(key, value, options = {}) {
    const keyId = await this.generateKeyId(key);
    const ttl = options.ttl || this.config.ttl;

    console.log(`DHT PUT: ${key} -> ${keyId.substring(0, 8)}...`);

    const storeData = {
      key,
      keyId,
      value,
      timestamp: Date.now(),
      ttl,
      publisher: this.peerId
    };

    // Check if this is a new key (for pending subscription activation)
    const isNewKey = !this.localStorage.has(keyId);

    // CRITICAL FIX: Always store locally first (the originator always keeps a copy)
    this.storeLocally(keyId, storeData);
    console.log(`DHT PUT: Stored locally: ${key}`);

    // If this is a new key, activate any pending subscriptions
    if (isNewKey) {
      const activatedSubscribers = this.activatePendingSubscriptions(keyId);

      // Notify locally activated subscribers about the new key
      if (activatedSubscribers.length > 0) {
        console.log(`DHT PUT: Notifying ${activatedSubscribers.length} locally pending subscribers about new key ${key}`);

        const notificationPromises = activatedSubscribers.map(async (subscriberId) => {
          if (subscriberId !== this.peerId) {
            try {
              return await this.sendDHTMessage(subscriberId, 'value_changed', {
                key,
                keyId,
                newValue: value,
                timestamp: storeData.timestamp,
                isNewKey: true
              });
            } catch (error) {
              console.warn(`Failed to notify subscriber ${subscriberId.substring(0, 8)} about new key:`, error.message);
              return null;
            }
          }
        }).filter(Boolean);

        await Promise.allSettled(notificationPromises);
      }
    }

    // AUTO-SUBSCRIBE: When putting a value, automatically subscribe to future changes
    this.mySubscriptions.add(keyId);
    console.log(`DHT PUT: Auto-subscribed to ${key} for future updates`);

    // Find the closest peers to store this key for replication
    const closestPeers = await this.findClosestPeers(keyId, this.config.k); // Get more peers initially

    // Implement iterative storage for better replication success
    return await this.performIterativePut(keyId, storeData, closestPeers);
  }

  /**
     * Retrieve a value from the DHT
     */
  async get(key, options = {}) {
    const keyId = await this.generateKeyId(key);
    // Subscribe unless explicitly disabled or skipSubscribe is true
    const subscribe = options.skipSubscribe ? false : (options.subscribe !== false);
    const forceRefresh = options.forceRefresh || false;

    console.log(`DHT GET: ${key} -> ${keyId.substring(0, 8)}... (auto-subscribing: ${subscribe}, forceRefresh: ${forceRefresh})`);

    // Check local storage FIRST (unless force refresh is requested)
    if (!forceRefresh && this.localStorage.has(keyId)) {
      const data = this.localStorage.get(keyId);
      if (!this.isExpired(data)) {
        console.log(`DHT GET: Found locally: ${key} (using cached data)`);
        // Add subscription even for local data (unless skipSubscribe is true)
        if (subscribe) {
          this.mySubscriptions.add(keyId);
        }
        return data.value;
      } else {
        // Remove expired data
        this.localStorage.delete(keyId);
        console.log(`DHT GET: Removed expired local data for: ${key}`);
      }
    }

    if (forceRefresh) {
      console.log('DHT GET: Force refresh requested - bypassing local cache, fetching from original storing peers');
    } else {
      console.log(`DHT GET: Not found locally, routing to network for key: ${key}`);
    }

    // Implement iterative Kademlia lookup with automatic subscription
    return await this.performIterativeGet(keyId, key, subscribe);
  }

  /**
     * Subscribe to changes for a key
     * NOTE: This now supports subscribing to keys that don't exist yet
     */
  async subscribe(key) {
    const keyId = await this.generateKeyId(key);

    console.log(`DHT EXPLICIT SUBSCRIBE: ${key} -> ${keyId.substring(0, 8)}...`);

    // Add to our subscriptions immediately
    this.mySubscriptions.add(keyId);

    // Find the peers responsible for storing this key
    const closestPeers = await this.findClosestPeers(keyId, this.config.replicationFactor);

    // Send subscription requests to all potential storage peers
    const subscribePromises = closestPeers.map(async (peerId) => {
      if (peerId !== this.peerId) {
        try {
          return await this.sendDHTMessage(peerId, 'subscribe', {
            keyId,
            key,
            subscriber: this.peerId
          });
        } catch (error) {
          console.warn(`DHT SUBSCRIBE: Failed to subscribe to peer ${peerId.substring(0, 8)}:`, error.message);
          return null;
        }
      }
    }).filter(Boolean);

    await Promise.allSettled(subscribePromises);

    // Also add ourselves to pending subscriptions if we're among the closest
    if (this.isAmongClosest(keyId, closestPeers)) {
      this.addPendingSubscription(keyId, this.peerId);
    }

    // Try to get the current value (if it exists)
    let currentValue = null;
    try {
      currentValue = await this.get(key, { skipSubscribe: true }); // Skip auto-subscribe since we're already subscribed
    } catch (error) {
      console.log(`DHT SUBSCRIBE: Key ${key} doesn't exist yet, but subscription is active for when it's created`);
    }

    console.log(`DHT SUBSCRIBE: Subscribed to ${key}, current value:`, currentValue);
    return currentValue;
  }

  /**
     * Unsubscribe from changes for a key
     */
  async unsubscribe(key) {
    const keyId = await this.generateKeyId(key);

    if (!this.mySubscriptions.has(keyId)) {
      return;
    }

    // Find the peers responsible for this key and unsubscribe
    const closestPeers = await this.findClosestPeers(keyId, this.config.replicationFactor);

    const unsubscribePromises = closestPeers.map(async (peerId) => {
      if (peerId !== this.peerId) {
        return this.sendDHTMessage(peerId, 'unsubscribe', {
          keyId,
          key,
          subscriber: this.peerId
        });
      }
    }).filter(Boolean);

    await Promise.allSettled(unsubscribePromises);
    this.mySubscriptions.delete(keyId);

    // Remove local subscription if we're storing this key
    if (this.subscriptions.has(keyId)) {
      this.subscriptions.get(keyId).delete(this.peerId);
      if (this.subscriptions.get(keyId).size === 0) {
        this.subscriptions.delete(keyId);
      }
    }

    // Remove local pending subscription if we're storing this key
    if (this.pendingSubscriptions.has(keyId)) {
      this.pendingSubscriptions.get(keyId).delete(this.peerId);
      if (this.pendingSubscriptions.get(keyId).size === 0) {
        this.pendingSubscriptions.delete(keyId);
      }
    }

    console.log(`DHT UNSUBSCRIBE: ${key} -> ${keyId.substring(0, 8)}...`);
  }

  /**
     * Update a key's value and notify all replicas and subscribers
     */
  async update(key, newValue, options = {}) {
    const keyId = await this.generateKeyId(key);

    console.log(`DHT UPDATE: Updating ${key} with new value across all replicas and subscribers`);

    // AUTO-SUBSCRIBE: When updating a value, automatically subscribe to future changes
    this.mySubscriptions.add(keyId);
    console.log(`DHT UPDATE: Auto-subscribed to ${key} for future updates`);

    // Find all peers that should store this key (closest peers)
    const closestPeers = await this.findClosestPeers(keyId, this.config.replicationFactor);

    // Create update data
    const updateData = {
      key,
      keyId,
      value: newValue,
      timestamp: Date.now(),
      ttl: options.ttl || this.config.ttl,
      publisher: this.peerId
    };

    console.log(`DHT UPDATE: Target replica peers for ${key}:`, closestPeers.map(p => p.substring(0, 8)));

    // CRITICAL FIX: Always update locally first if we're among the closest
    let localUpdateSuccess = false;
    if (this.isAmongClosest(keyId, closestPeers)) {
      this.storeLocally(keyId, updateData);
      localUpdateSuccess = true;
      console.log(`DHT UPDATE: Updated ${key} locally (we are replica peer)`);
    }

    // CRITICAL FIX: Send update to ALL replica peers and wait for ALL to succeed
    const updatePromises = closestPeers.map(async (peerId) => {
      if (peerId !== this.peerId) {
        try {
          console.log(`DHT UPDATE: Sending update to replica peer ${peerId.substring(0, 8)}`);
          const response = await this.sendDHTMessage(peerId, 'update_value', updateData);
          if (response && response.success) {
            console.log(`DHT UPDATE: Successfully updated replica peer ${peerId.substring(0, 8)}`);
            return { peerId, success: true };
          } else {
            console.warn(`DHT UPDATE: Replica peer ${peerId.substring(0, 8)} rejected update:`, response);
            return { peerId, success: false, response };
          }
        } catch (error) {
          console.warn(`DHT UPDATE: Failed to update replica peer ${peerId.substring(0, 8)}:`, error.message);
          return { peerId, success: false, error: error.message };
        }
      }
      return null;
    }).filter(Boolean);

    const results = await Promise.allSettled(updatePromises);
    const updateResults = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    const successfulUpdates = updateResults.filter(r => r.success).length;
    const failedUpdates = updateResults.filter(r => !r.success);

    console.log(`DHT UPDATE: Replica peer update results for ${key}:`);
    console.log(`  - Successful: ${successfulUpdates}`);
    console.log(`  - Failed: ${failedUpdates.length}`);
    console.log(`  - Local: ${localUpdateSuccess ? 'success' : 'not applicable'}`);

    // ENHANCED: Log failed updates for debugging
    if (failedUpdates.length > 0) {
      console.warn('DHT UPDATE: Failed to update these replica peers:',
        failedUpdates.map(f => ({ peer: f.peerId.substring(0, 8), reason: f.error || f.response })));
      console.warn('DHT UPDATE: This may lead to consistency issues. Consider implementing retry logic.');
    }

    // CRITICAL: Broadcast value change to ALL peers (including non-replicas)
    // This ensures any peer with cached values gets the update immediately
    await this.broadcastValueChange(key, keyId, newValue, updateData.timestamp);

    // SUCCESS CRITERIA: ALL replica peers must be updated for consistency
    // This prevents the case where a later GET operation hits a replica peer with stale data
    const totalSuccessful = (localUpdateSuccess ? 1 : 0) + successfulUpdates;
    const totalReplicas = closestPeers.length;
    const wasSuccessful = totalSuccessful >= totalReplicas;

    if (!wasSuccessful) {
      console.warn(`DHT UPDATE: ${key} update FAILED - only ${totalSuccessful}/${totalReplicas} replicas updated successfully`);
      console.warn('DHT UPDATE: This may cause consistency issues where GET operations return stale data');
    } else {
      console.log(`DHT UPDATE: ${key} update SUCCESSFUL - all ${totalSuccessful}/${totalReplicas} replicas updated`);
    }

    return wasSuccessful;
  }

  /**
     * Broadcast value change to ALL peers in the network
     * This ensures both subscribers and peers with cached values are updated
     */
  async broadcastValueChange(key, keyId, newValue, timestamp) {
    // Get ALL connected peers, not just subscribers
    const allPeers = this.mesh.connectionManager.getConnectedPeers().map(p => p.peerId);

    console.log(`DHT UPDATE: Broadcasting value change for ${key} to ${allPeers.length} peers`);

    const notificationPromises = allPeers.map(async (peerId) => {
      try {
        // Send notification to ALL peers - they'll decide if they care
        return await this.sendDHTMessage(peerId, 'value_changed', {
          key,
          keyId,
          newValue,
          timestamp
        });
      } catch (error) {
        console.warn(`DHT BROADCAST: Failed to notify peer ${peerId.substring(0, 8)}:`, error.message);
        return null;
      }
    });

    const results = await Promise.allSettled(notificationPromises);
    const successfulNotifications = results.filter(r => r.status === 'fulfilled' && r.value).length;

    console.log(`DHT UPDATE: Broadcasted ${key} change to ${successfulNotifications}/${allPeers.length} peers`);

    // Also emit local event if this peer has subscriptions
    if (this.mySubscriptions.has(keyId)) {
      this.emit('valueChanged', { key, keyId, newValue, timestamp });
    }
  }

  /**
     * Handle store request from another peer
     */
  async handleStoreRequest(fromPeerId, data) {
    const { keyId, key, value, timestamp, ttl, publisher, messageId } = data;

    console.log(`🔥 DHT STORE REQUEST: ${key} from ${fromPeerId.substring(0, 8)}, messageId: ${messageId}`);

    // Check if we should store this key (are we close enough?)
    const closestPeers = await this.findClosestPeers(keyId, this.config.replicationFactor);

    if (this.isAmongClosest(keyId, closestPeers)) {
      // Check if this is a new key (for pending subscription activation)
      const isNewKey = !this.localStorage.has(keyId);

      this.storeLocally(keyId, { key, value, timestamp, ttl, publisher });

      // If this is a new key, activate any pending subscriptions
      if (isNewKey) {
        const activatedSubscribers = this.activatePendingSubscriptions(keyId);

        // Notify newly activated subscribers about the new key
        if (activatedSubscribers.length > 0) {
          console.log(`DHT STORE: Notifying ${activatedSubscribers.length} subscribers about new key ${key}`);

          const notificationPromises = activatedSubscribers.map(async (subscriberId) => {
            if (subscriberId !== this.peerId && subscriberId !== fromPeerId) {
              try {
                return await this.sendDHTMessage(subscriberId, 'value_changed', {
                  key,
                  keyId,
                  newValue: value,
                  timestamp,
                  isNewKey: true
                });
              } catch (error) {
                console.warn(`Failed to notify subscriber ${subscriberId.substring(0, 8)} about new key:`, error.message);
                return null;
              }
            }
          }).filter(Boolean);

          await Promise.allSettled(notificationPromises);
        }
      }

      console.log(`🔥 DHT STORE: Accepting and storing ${key}, sending success response`);

      // Send response using the same direct messaging structure
      this.sendDirectToPeer(fromPeerId, {
        type: 'dht',
        messageType: 'store_response',
        data: {
          keyId,
          success: true,
          storedBy: this.peerId,
          messageId // Echo back the messageId for response matching
        }
      });

      console.log(`DHT STORE: accepted ${key} from ${fromPeerId.substring(0, 8)}...`);
    } else {
      console.log(`🔥 DHT STORE: Rejecting ${key} (not among closest), sending failure response`);

      this.sendDirectToPeer(fromPeerId, {
        type: 'dht',
        messageType: 'store_response',
        data: {
          keyId,
          success: false,
          reason: 'not_closest',
          closestPeers: closestPeers.slice(0, this.config.replicationFactor),
          messageId // Echo back the messageId for response matching
        }
      });
    }
  }

  /**
     * Handle find value request
     */
  async handleFindValueRequest(fromPeerId, data) {
    const { keyId, key, subscribe, requester, messageId } = data;

    console.log(`🔥 DHT FIND_VALUE REQUEST: ${key} from ${fromPeerId.substring(0, 8)}, messageId: ${messageId}`);
    console.log('🔥 DHT FIND_VALUE REQUEST: Full data received:', data);

    if (this.localStorage.has(keyId)) {
      const storedData = this.localStorage.get(keyId);

      if (!this.isExpired(storedData)) {
        console.log(`🔥 DHT FIND_VALUE: Found ${key} locally, sending success response with messageId: ${messageId}`);

        // Add subscription if requested
        if (subscribe) {
          this.addSubscription(keyId, requester);
        }

        // CRITICAL FIX: Use the request's messageId, not generate a new one
        const responseData = {
          keyId,
          found: true,
          messageId, // Echo back the EXACT messageId from request
          key: storedData.key,
          value: storedData.value,
          timestamp: storedData.timestamp,
          ttl: storedData.ttl,
          publisher: storedData.publisher
        };

        console.log(`🔥 DHT FIND_VALUE: Sending response data with messageId ${messageId}:`, responseData);

        this.sendDirectToPeer(fromPeerId, {
          type: 'dht',
          messageType: 'find_value_response',
          data: responseData
        });

        console.log(`DHT FIND_VALUE: found ${key} for ${fromPeerId.substring(0, 8)}...`);
        return;
      } else {
        this.localStorage.delete(keyId);
        console.log(`🔥 DHT FIND_VALUE: Found ${key} but expired, removed from storage`);
      }
    }

    console.log(`🔥 DHT FIND_VALUE: ${key} not found locally, sending closest peers response with messageId: ${messageId}`);

    // If not found, return closest peers
    const closestPeers = await this.findClosestPeers(keyId, this.config.k);

    const responseData = {
      keyId,
      found: false,
      messageId, // Echo back the EXACT messageId from request
      closestPeers
    };

    console.log(`🔥 DHT FIND_VALUE: Sending not-found response data with messageId ${messageId}:`, responseData);

    this.sendDirectToPeer(fromPeerId, {
      type: 'dht',
      messageType: 'find_value_response',
      data: responseData
    });
  }

  /**
     * Handle subscribe request
     */
  async handleSubscribeRequest(fromPeerId, data) {
    const { keyId, key, subscriber } = data;

    console.log(`DHT SUBSCRIBE REQUEST: ${key} from ${fromPeerId.substring(0, 8)} for subscriber ${subscriber.substring(0, 8)}`);

    if (this.localStorage.has(keyId)) {
      // Key exists - add to active subscriptions
      this.addSubscription(keyId, subscriber);
      console.log(`DHT SUBSCRIBE: added ${subscriber.substring(0, 8)}... to ${key} notifications (key exists)`);
    } else {
      // Key doesn't exist yet - add to pending subscriptions
      this.addPendingSubscription(keyId, subscriber);
      console.log(`DHT SUBSCRIBE: added ${subscriber.substring(0, 8)}... to ${key} pending notifications (key doesn't exist yet)`);
    }
  }

  /**
     * Handle unsubscribe request
     */
  async handleUnsubscribeRequest(fromPeerId, data) {
    const { keyId, key, subscriber } = data;

    // Remove from active subscriptions
    if (this.subscriptions.has(keyId)) {
      this.subscriptions.get(keyId).delete(subscriber);
      if (this.subscriptions.get(keyId).size === 0) {
        this.subscriptions.delete(keyId);
      }
      console.log(`DHT UNSUBSCRIBE: removed ${subscriber.substring(0, 8)}... from ${key} active notifications`);
    }

    // Remove from pending subscriptions
    if (this.pendingSubscriptions.has(keyId)) {
      this.pendingSubscriptions.get(keyId).delete(subscriber);
      if (this.pendingSubscriptions.get(keyId).size === 0) {
        this.pendingSubscriptions.delete(keyId);
      }
      console.log(`DHT UNSUBSCRIBE: removed ${subscriber.substring(0, 8)}... from ${key} pending notifications`);
    }
  }

  /**
     * Handle value changed notification
     */
  async handleValueChangedNotification(fromPeerId, data) {
    const { key, keyId, newValue, timestamp, isNewKey } = data;

    console.log(`🔥 DHT VALUE_CHANGED notification: ${key} = ${newValue} from ${fromPeerId.substring(0, 8)}${isNewKey ? ' (NEW KEY)' : ''}`);

    // CRITICAL FIX: Always update local cache if we have it, regardless of subscriptions
    // This prevents stale cached values from being returned by get() operations
    if (this.localStorage.has(keyId)) {
      const storedData = this.localStorage.get(keyId);
      // Only update if the new timestamp is newer (prevent old notifications from overwriting newer data)
      if (!storedData.timestamp || timestamp >= storedData.timestamp) {
        storedData.value = newValue;
        storedData.timestamp = timestamp;
        console.log(`🔥 DHT VALUE_CHANGED: Updated local cache for ${key} (timestamp: ${timestamp})`);
      } else {
        console.log(`🔥 DHT VALUE_CHANGED: Ignoring older notification for ${key} (current: ${storedData.timestamp}, notification: ${timestamp})`);
      }
    } else if (isNewKey) {
      // For new keys, store the data locally even if we don't normally store this key
      // This helps with caching and consistency
      console.log(`🔥 DHT VALUE_CHANGED: Caching new key ${key} locally`);
      this.storeLocally(keyId, {
        key,
        value: newValue,
        timestamp,
        ttl: null, // Use default TTL
        publisher: fromPeerId
      }, false); // Not a primary replica
    }

    // Check if we have subscribers for this key
    const hasSubscribers = this.mySubscriptions.has(keyId);
    const hasLocalSubscribers = this.subscriptions.has(keyId) && this.subscriptions.get(keyId).size > 0;

    if (hasSubscribers || hasLocalSubscribers) {
      console.log(`🔥 DHT VALUE_CHANGED: Processing notification for ${key} (mySubscriptions: ${hasSubscribers}, localSubscribers: ${hasLocalSubscribers})`);

      // Emit change event if this peer is subscribed
      if (hasSubscribers) {
        this.emit('valueChanged', { key, keyId, newValue, timestamp, isNewKey });
        console.log(`🔥 DHT VALUE_CHANGED: Emitted local event for ${key}${isNewKey ? ' (NEW KEY)' : ''}`);
      }

      // Forward to local subscribers (other peers that subscribed through this peer)
      if (hasLocalSubscribers) {
        const localSubscribers = Array.from(this.subscriptions.get(keyId));
        console.log(`🔥 DHT VALUE_CHANGED: Forwarding to ${localSubscribers.length} local subscribers for ${key}`);

        const forwardPromises = localSubscribers.map(async (subscriberId) => {
          if (subscriberId !== this.peerId && subscriberId !== fromPeerId) {
            try {
              return await this.sendDHTMessage(subscriberId, 'value_changed', {
                key,
                keyId,
                newValue,
                timestamp,
                isNewKey
              });
            } catch (error) {
              console.warn(`Failed to forward notification to ${subscriberId.substring(0, 8)}:`, error.message);
              return null;
            }
          }
        }).filter(Boolean);

        await Promise.allSettled(forwardPromises);
      }
    } else {
      console.log(`🔥 DHT VALUE_CHANGED: No subscriptions for ${key}, but updated cache anyway`);
    }
  }

  /**
     * Handle update value request - used to propagate updates to replica peers
     */
  async handleUpdateValueRequest(fromPeerId, data) {
    const { keyId, key, value, timestamp, ttl, publisher, messageId } = data;

    console.log(`🔥 DHT UPDATE_VALUE REQUEST: ${key} from ${fromPeerId.substring(0, 8)}`);

    // Check if we should store this key (are we among the closest?)
    const closestPeers = await this.findClosestPeers(keyId, this.config.replicationFactor);

    if (this.isAmongClosest(keyId, closestPeers)) {
      // Update our local copy
      this.storeLocally(keyId, { key, value, timestamp, ttl, publisher });
      console.log(`DHT UPDATE_VALUE: Updated ${key} locally`);

      // Notify any local subscribers
      if (this.subscriptions.has(keyId)) {
        const subscribers = Array.from(this.subscriptions.get(keyId));
        console.log(`DHT UPDATE_VALUE: Notifying ${subscribers.length} local subscribers for ${key}`);

        const notificationPromises = subscribers.map(async (subscriberId) => {
          if (subscriberId !== this.peerId) {
            try {
              return await this.sendDHTMessage(subscriberId, 'value_changed', {
                key,
                keyId,
                newValue: value,
                timestamp
              });
            } catch (error) {
              console.warn(`Failed to notify subscriber ${subscriberId.substring(0, 8)}:`, error.message);
              return null;
            }
          }
        }).filter(Boolean);

        await Promise.allSettled(notificationPromises);
      }

      // Send success response
      this.sendDirectToPeer(fromPeerId, {
        type: 'dht',
        messageType: 'update_value_response',
        data: {
          keyId,
          success: true,
          updatedBy: this.peerId,
          messageId
        }
      });
    } else {
      console.log(`DHT UPDATE_VALUE: Not responsible for ${key}, rejecting update`);

      // Send failure response
      this.sendDirectToPeer(fromPeerId, {
        type: 'dht',
        messageType: 'update_value_response',
        data: {
          keyId,
          success: false,
          reason: 'not_closest',
          messageId
        }
      });
    }
  }

  /**
     * Send a DHT message to a specific peer using direct P2P connection
     */
  async sendDHTMessage(targetPeerId, type, data) {
    return new Promise((resolve, reject) => {
      const messageId = this.generateMessageId();

      console.log(`🔥 DHT Sending ${type} to ${targetPeerId.substring(0, 8)} with messageId ${messageId}`);
      console.log('🔥 DHT Request data being sent:', { ...data, messageId });

      // Set up response handler
      const timeout = safeSetTimeout(() => {
        console.log(`🔥 DHT Timeout for messageId ${messageId} to peer ${targetPeerId.substring(0, 8)}`);
        this.removeResponseHandler(messageId);
        reject(new Error('DHT message timeout'));
      }, 5000);

      this.setResponseHandler(messageId, (response) => {
        console.log(`🔥 DHT Response received for ${type} messageId ${messageId}:`, response);
        safeClearTimeout(timeout);
        resolve(response);
      });

      // Send message directly via peer-to-peer connection with proper message structure
      const messageToSend = {
        type: 'dht', // This tells ConnectionManager to route to DHT
        data: { ...data, messageId },
        messageType: type // The actual DHT operation type
      };

      console.log(`🔥 DHT Full message being sent to ${targetPeerId.substring(0, 8)}:`, messageToSend);

      const success = this.sendDirectToPeer(targetPeerId, messageToSend);

      if (!success) {
        console.log(`🔥 DHT Failed to send to ${targetPeerId.substring(0, 8)}, cleaning up messageId ${messageId}`);
        safeClearTimeout(timeout);
        this.removeResponseHandler(messageId);
        reject(new Error('Failed to send DHT message - no direct connection'));
      }
    });
  }

  /**
     * Send a message directly to a peer using the data channel or route through mesh
     * This implements proper Kademlia routing for peers that aren't directly connected
     */
  sendDirectToPeer(targetPeerId, message) {
    console.log(`DHT: Attempting to send message to ${targetPeerId.substring(0, 8)}:`, message.type);

    // First try direct connection if available
    const success = this.mesh.connectionManager.sendDirectMessage(targetPeerId, message);

    if (success) {
      console.log(`DHT: Successfully sent direct message to ${targetPeerId.substring(0, 8)}`);
      return true;
    } else {
      console.log(`DHT: No direct connection to ${targetPeerId.substring(0, 8)}, using Kademlia routing`);

      // Use gossip/routing mechanism to reach the target peer
      // Create a special DHT routing message that will be forwarded through the mesh
      const routingMessage = {
        id: this.generateMessageId(),
        from: this.peerId,
        to: targetPeerId, // Target peer ID for routing
        subtype: 'dht-routing', // Special subtype for DHT routing
        content: message, // The actual DHT message to deliver
        timestamp: Date.now(),
        ttl: 5, // Allow up to 5 hops to reach the target
        path: [this.peerId] // Track routing path
      };

      console.log(`DHT: Routing message to ${targetPeerId.substring(0, 8)} via gossip network`);
      this.mesh.gossipManager.propagateMessage(routingMessage);
      return true;
    }
  }

  /**
     * Find the closest peers to a given key ID
     */
  async findClosestPeers(keyId, count) {
    const allPeers = [this.peerId, ...this.mesh.connectionManager.getConnectedPeers().map(p => p.peerId)];

    console.log(`DHT findClosestPeers: Looking for ${count} closest peers to key ${keyId.substring(0, 8)}... from ${allPeers.length} total peers`);

    // Sort by XOR distance to the key
    allPeers.sort((a, b) => {
      const distA = this.xorDistance(keyId, a);
      const distB = this.xorDistance(keyId, b);
      return distA.localeCompare(distB);
    });

    const result = allPeers.slice(0, count);

    console.log('DHT findClosestPeers result:', result.map(peerId => ({
      peerId: peerId.substring(0, 8) + '...',
      distance: this.xorDistance(keyId, peerId).substring(0, 8) + '...',
      isSelf: peerId === this.peerId
    })));

    return result;
  }

  /**
     * Calculate XOR distance between two IDs
     */
  xorDistance(id1, id2) {
    // Convert hex strings to numbers and XOR them
    let distance = '';
    for (let i = 0; i < Math.min(id1.length, id2.length); i++) {
      const xor = parseInt(id1[i], 16) ^ parseInt(id2[i], 16);
      distance += xor.toString(16);
    }
    return distance;
  }

  /**
     * Generate a deterministic key ID from a key string using SHA-1
     */
  async generateKeyId(key) {
    // Use Web Crypto API to generate SHA-1 hash like peer IDs
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
     * Generate a unique message ID
     */
  generateMessageId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
     * Store data locally
     */
  storeLocally(keyId, data, isPrimary = true) {
    this.localStorage.set(keyId, {
      ...data,
      storedAt: Date.now(),
      isPrimary
    });
  }

  /**
     * Add a subscription for a key
     */
  addSubscription(keyId, subscriberId) {
    if (!this.subscriptions.has(keyId)) {
      this.subscriptions.set(keyId, new Set());
    }
    this.subscriptions.get(keyId).add(subscriberId);
  }

  /**
     * Add a pending subscription for a key that doesn't exist yet
     */
  addPendingSubscription(keyId, subscriberId) {
    if (!this.pendingSubscriptions.has(keyId)) {
      this.pendingSubscriptions.set(keyId, new Set());
    }
    this.pendingSubscriptions.get(keyId).add(subscriberId);
  }

  /**
     * Activate pending subscriptions when a key is first created
     */
  activatePendingSubscriptions(keyId) {
    if (this.pendingSubscriptions.has(keyId)) {
      const pendingSubscribers = this.pendingSubscriptions.get(keyId);

      // Move all pending subscribers to active subscriptions
      if (!this.subscriptions.has(keyId)) {
        this.subscriptions.set(keyId, new Set());
      }

      pendingSubscribers.forEach(subscriberId => {
        this.subscriptions.get(keyId).add(subscriberId);
      });

      console.log(`DHT: Activated ${pendingSubscribers.size} pending subscriptions for keyId ${keyId.substring(0, 8)}`);

      // Clear pending subscriptions for this key
      this.pendingSubscriptions.delete(keyId);

      return Array.from(pendingSubscribers);
    }
    return [];
  }

  /**
     * Check if this peer is among the closest to a key
     */
  isAmongClosest(keyId, closestPeers) {
    return closestPeers.includes(this.peerId);
  }

  /**
     * Check if stored data has expired
     */
  isExpired(data) {
    // If TTL is null/undefined, record never expires
    if (!data.ttl) {
      return false;
    }
    // TTL is stored in seconds, so convert to milliseconds
    return data.timestamp + (data.ttl * 1000) < Date.now();
  }

  /**
     * Response handler management
     */
  setResponseHandler(messageId, handler) {
    if (!this.responseHandlers) {
      this.responseHandlers = new Map();
    }
    this.responseHandlers.set(messageId, handler);
  }

  removeResponseHandler(messageId) {
    if (this.responseHandlers) {
      this.responseHandlers.delete(messageId);
    }
  }

  handleResponse(fromPeerId, data) {
    console.log(`🔥 DHT Response received from ${fromPeerId.substring(0, 8)}: messageId=${data.messageId}, type=${data.type || 'unknown'}`);
    console.log('🔥 DHT Response full data:', data);
    console.log('🔥 DHT Response available handlers:', this.responseHandlers ? Array.from(this.responseHandlers.keys()) : 'none');

    if (this.responseHandlers && data.messageId) {
      const handler = this.responseHandlers.get(data.messageId);
      if (handler) {
        console.log(`🔥 DHT Response: Found handler for messageId ${data.messageId}, calling handler`);
        this.removeResponseHandler(data.messageId);
        handler(data);
      } else {
        console.warn(`🔥 DHT Response: No handler found for messageId ${data.messageId}`);
        console.log('🔥 DHT Response: Available handlers:', Array.from(this.responseHandlers.keys()));
      }
    } else {
      console.warn('🔥 DHT Response: Missing responseHandlers or messageId', {
        hasHandlers: !!this.responseHandlers,
        messageId: data.messageId
      });
    }
  }

  /**
     * Start periodic maintenance tasks
     */
  startMaintenance() {
    // Clean up expired keys
    // Use safeSetInterval to avoid issues with wrapped setInterval functions
    this.maintenanceInterval = safeSetInterval(() => {
      this.performMaintenance();
    }, this.config.refreshInterval);
  }

  /**
     * Perform maintenance tasks
     */
  performMaintenance() {
    // Remove expired keys
    for (const [keyId, data] of this.localStorage.entries()) {
      if (this.isExpired(data)) {
        this.localStorage.delete(keyId);
        this.subscriptions.delete(keyId);
        console.log(`DHT MAINTENANCE: removed expired key ${keyId.substring(0, 8)}...`);
      }
    }

    // TODO: Republish keys if needed
    // TODO: Update routing table

    console.log(`DHT MAINTENANCE: ${this.localStorage.size} keys stored, ${this.subscriptions.size} subscriptions active`);
  }

  /**
     * Get DHT statistics
     */
  getStats() {
    return {
      storedKeys: this.localStorage.size,
      activeSubscriptions: this.subscriptions.size,
      pendingSubscriptions: this.pendingSubscriptions.size,
      mySubscriptions: this.mySubscriptions.size,
      connectedPeers: this.mesh.connectionManager.getConnectedPeerCount()
    };
  }

  /**
     * Cleanup DHT resources
     */
  cleanup() {
    if (this.maintenanceInterval) {
      safeClearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }

    this.localStorage.clear();
    this.subscriptions.clear();
    this.pendingSubscriptions.clear();
    this.mySubscriptions.clear();

    if (this.responseHandlers) {
      this.responseHandlers.clear();
    }

    console.log('WebDHT cleaned up');
  }

  /**
     * Perform iterative Kademlia lookup for GET operations
     * This improves success rate by querying multiple rounds of peers
     */
  async performIterativeGet(keyId, key, subscribe = false) {
    const queriedPeers = new Set([this.peerId]);
    const closestPeers = await this.findClosestPeers(keyId, this.config.k);

    // Remove self from the list
    const availablePeers = closestPeers.filter(peerId => peerId !== this.peerId);

    console.log(`DHT Iterative GET: Found ${availablePeers.length} potential peers for key ${key}`);

    // Try querying peers in rounds, increasing the number each round
    const maxRounds = 3;
    let currentRound = 0;
    let peersPerRound = this.config.alpha; // Start with alpha peers

    while (currentRound < maxRounds && queriedPeers.size < availablePeers.length + 1) {
      currentRound++;

      // Get the next batch of peers to query
      const peersToQuery = availablePeers
        .filter(peerId => !queriedPeers.has(peerId))
        .slice(0, peersPerRound);

      if (peersToQuery.length === 0) {
        console.log(`DHT Iterative GET Round ${currentRound}: No more peers to query`);
        break;
      }

      console.log(`DHT Iterative GET Round ${currentRound}: Querying ${peersToQuery.length} peers`);

      // Mark these peers as queried
      peersToQuery.forEach(peerId => queriedPeers.add(peerId));

      // Query this batch of peers in parallel
      const queryPromises = peersToQuery.map(async (peerId) => {
        try {
          return await this.sendDHTMessage(peerId, 'find_value', {
            keyId,
            key,
            subscribe,
            requester: this.peerId
          });
        } catch (error) {
          console.warn(`DHT GET: Failed to query peer ${peerId.substring(0, 8)}:`, error.message);
          return null;
        }
      });

      const results = await Promise.allSettled(queryPromises);

      // Collect all valid responses from this round
      const validResponses = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled' && result.value) {
          const data = result.value;
          if (data.found && !this.isExpired(data)) {
            validResponses.push({
              peerId: peersToQuery[i],
              data,
              timestamp: data.timestamp || 0
            });
            console.log(`DHT Iterative GET: Found value on peer ${peersToQuery[i].substring(0, 8)} with timestamp ${data.timestamp}, value: ${JSON.stringify(data.value).substring(0, 50)}...`);
          }
        }
      }

      // If we found any valid responses, find the most recent one
      if (validResponses.length > 0) {
        // Sort by timestamp descending to get the most recent value
        validResponses.sort((a, b) => b.timestamp - a.timestamp);
        const mostRecent = validResponses[0];

        console.log(`DHT Iterative GET: Selected most recent value from peer ${mostRecent.peerId.substring(0, 8)} (timestamp: ${mostRecent.timestamp}) in round ${currentRound}`);

        if (validResponses.length > 1) {
          console.log(`DHT Iterative GET: Found ${validResponses.length} versions, timestamps: ${validResponses.map(r => r.timestamp).join(', ')}`);
          // Log inconsistency warning if timestamps are very different
          const timeDiffs = validResponses.map(r => Math.abs(mostRecent.timestamp - r.timestamp));
          const maxTimeDiff = Math.max(...timeDiffs);
          if (maxTimeDiff > 10000) { // More than 10 seconds difference
            console.warn(`DHT CONSISTENCY WARNING: Large timestamp differences found (max: ${maxTimeDiff}ms). This suggests replica peers have inconsistent data!`);
            console.warn('DHT CONSISTENCY: Detailed responses:', validResponses.map(r => ({
              peer: r.peerId.substring(0, 8),
              timestamp: r.timestamp,
              value: JSON.stringify(r.data.value).substring(0, 30) + '...'
            })));
          }
        }

        // Cache the most recent value locally
        this.storeLocally(keyId, mostRecent.data, false);

        // ALWAYS add subscription when we successfully get a value
        if (subscribe) {
          this.mySubscriptions.add(keyId);
          console.log(`DHT GET: Auto-subscribed to ${key}`);
        }

        return mostRecent.data.value;
      }

      // Increase peers per round for next iteration (more aggressive search)
      peersPerRound = Math.min(peersPerRound * 2, Math.max(1, Math.floor(availablePeers.length / maxRounds)));
    }

    console.log(`DHT Iterative GET failed: key ${key} not found after querying ${queriedPeers.size - 1} peers`);
    return null;
  }

  /**
     * Perform iterative storage for PUT operations with better replication
     */
  async performIterativePut(keyId, storeData, closestPeers) {
    const targetReplicas = this.config.replicationFactor;
    const availablePeers = closestPeers.filter(peerId => peerId !== this.peerId);

    console.log(`DHT Iterative PUT: Attempting to store ${storeData.key} on ${targetReplicas} of ${availablePeers.length} available peers`);

    let successful = 0;
    let attempted = 0;
    const batchSize = Math.min(this.config.alpha, availablePeers.length);

    // Try to store on peers in batches until we reach target replication
    for (let i = 0; i < availablePeers.length && successful < targetReplicas; i += batchSize) {
      const batch = availablePeers.slice(i, i + batchSize);
      attempted += batch.length;

      console.log(`DHT PUT Batch ${Math.floor(i / batchSize) + 1}: Storing on ${batch.length} peers`);

      const storePromises = batch.map(async (peerId) => {
        try {
          const result = await this.sendDHTMessage(peerId, 'store', storeData);
          return { peerId, success: true, result };
        } catch (error) {
          console.warn(`DHT PUT: Failed to store on peer ${peerId.substring(0, 8)}:`, error.message);
          return { peerId, success: false, error };
        }
      });

      const results = await Promise.allSettled(storePromises);

      // Count successful stores in this batch
      const batchSuccessful = results.filter(r =>
        r.status === 'fulfilled' && r.value && r.value.success
      ).length;

      successful += batchSuccessful;

      console.log(`DHT PUT Batch completed: ${batchSuccessful}/${batch.length} successful (total: ${successful}/${targetReplicas})`);

      // If we've reached our target, we can stop
      if (successful >= targetReplicas) {
        break;
      }

      // Small delay between batches to avoid overwhelming the network
      if (i + batchSize < availablePeers.length) {
        await new Promise(resolve => safeSetTimeout(resolve, 100));
      }
    }

    console.log(`DHT PUT completed: ${successful}/${targetReplicas} target replicas stored (${attempted} peers attempted)`);
    return successful > 0;
  }
}
