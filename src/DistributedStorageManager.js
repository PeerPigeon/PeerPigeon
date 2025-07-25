import { EventEmitter } from './EventEmitter.js';

// Dynamic import for unsea to handle both Node.js and browser environments
let unsea = null;

async function initializeUnsea() {
  if (unsea) return unsea;

  try {
    // Detect environment - prioritize Node.js detection for tests
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
    const isBrowser = !isNode && typeof window !== 'undefined' && typeof document !== 'undefined';

    if (isNode) {
      // For Node.js environments (including tests), use npm package
      unsea = await import('unsea');
      console.log('✅ Loaded unsea from npm package (Node.js) for storage');
    } else if (isBrowser) {
      // For browser environments, try CDN sources
      try {
        unsea = await import('https://cdn.jsdelivr.net/npm/unsea@latest/+esm');
        console.log('✅ Loaded unsea from jsDelivr CDN for storage');
      } catch (jsDelivrError) {
        console.warn('Failed to load from jsDelivr, trying unpkg:', jsDelivrError);
        try {
          unsea = await import('https://unpkg.com/unsea@latest/dist/unsea.esm.js');
          console.log('✅ Loaded unsea from unpkg CDN for storage');
        } catch (unpkgError) {
          console.warn('Failed to load from unpkg, trying Skypack:', unpkgError);
          unsea = await import('https://cdn.skypack.dev/unsea');
          console.log('✅ Loaded unsea from Skypack CDN for storage');
        }
      }
    } else {
      throw new Error('Unknown environment - cannot load unsea');
    }

    if (!unsea) {
      throw new Error('Unsea not found after loading');
    }

    return unsea;
  } catch (error) {
    console.error('Failed to load unsea for storage:', error);
    throw error;
  }
}

/**
 * DistributedStorageManager - Optional storage layer for PeerPigeon mesh
 *
 * Features:
 * - Encrypted storage using unsea directly
 * - Optional public/private data visibility
 * - Optional immutability with CRDT support for collaborative editing
 * - Mutable layer for data originators
 * - Integration with WebDHT for distributed storage
 */
export class DistributedStorageManager extends EventEmitter {
  constructor(mesh) {
    super();
    this.mesh = mesh;
    this.webDHT = mesh.webDHT;
    this.cryptoManager = mesh.cryptoManager;

    // Initialize unsea for encryption
    this.unsea = null;
    this.storageKeypair = null;
    this.initializeCrypto();

    // Storage configuration
    this.config = {
      encryptionEnabled: true,
      defaultTTL: null, // No expiration by default
      maxValueSize: 1024 * 1024, // 1MB default max size
      enableCRDT: true,
      conflictResolution: 'last-write-wins' // or 'crdt-merge'
    };

    // Local storage for metadata and permissions
    this.storageMetadata = new Map(); // keyId -> metadata
    this.accessControl = new Map(); // keyId -> access control info
    this.crdtStates = new Map(); // keyId -> CRDT state for collaborative data

    // Track data ownership
    this.ownedKeys = new Set(); // Keys owned by this peer

    // Track enabled state
    this.enabled = true; // Enable by default

    console.log(`DistributedStorageManager initialized for peer ${this.mesh.peerId?.substring(0, 8)}...`);
  }

  /**
   * Initialize unsea encryption for storage
   * @private
   */
  async initializeCrypto() {
    try {
      this.unsea = await initializeUnsea();

      // Generate a keypair for storage encryption
      // Use the mesh's keypair if available, otherwise generate one
      if (this.cryptoManager && this.cryptoManager.keypair) {
        this.storageKeypair = this.cryptoManager.keypair;
      } else {
        this.storageKeypair = await this.unsea.generateRandomPair();
      }

      console.log('📦 Storage encryption initialized with unsea');
    } catch (error) {
      console.warn('📦 Failed to initialize storage encryption:', error);
      // Disable encryption if unsea fails to load
      this.config.encryptionEnabled = false;
    }
  }

  /**
   * Wait for crypto initialization to complete
   * @returns {Promise<void>}
   */
  async waitForCrypto() {
    if (this.unsea && this.storageKeypair) {
      return;
    }

    // Wait up to 5 seconds for crypto to initialize
    const timeout = 5000;
    const start = Date.now();

    while (!this.unsea || !this.storageKeypair) {
      if (Date.now() - start > timeout) {
        console.warn('📦 Crypto initialization timeout - proceeding without encryption');
        this.config.encryptionEnabled = false;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Store data with encryption and access control
   * @param {string} key - The storage key
   * @param {any} value - The value to store
   * @param {Object} options - Storage options
   * @param {boolean} options.isPublic - Whether data is publicly readable (default: false - private and encrypted)
   * @param {boolean} options.isImmutable - Whether data is immutable for other peers (default: false)
   * @param {boolean} options.enableCRDT - Whether to enable CRDT for collaborative editing (default: false)
   * @param {number} options.ttl - Time to live in milliseconds
   * @param {Array<string>} options.allowedPeers - Specific peers allowed to read private data
   * @returns {Promise<boolean>} Success status
   */
  async store(key, value, options = {}) {
    if (!this.webDHT) {
      throw new Error('WebDHT not available - ensure it is enabled in mesh configuration');
    }

    // Wait for crypto initialization if encryption is enabled
    if (this.config.encryptionEnabled) {
      await this.waitForCrypto();
    }

    const keyId = await this.webDHT.generateKeyId(key);
    const timestamp = Date.now();
    console.log(`📦 Storing key: ${key}, keyId: ${keyId.substring(0, 8)}...`);

    // Validate value size
    const serializedValue = JSON.stringify(value);
    if (serializedValue.length > this.config.maxValueSize) {
      throw new Error(`Value size exceeds maximum allowed size of ${this.config.maxValueSize} bytes`);
    }

    // Create storage metadata - default to private for security
    const metadata = {
      key,
      keyId,
      owner: this.mesh.peerId,
      isPublic: options.isPublic !== undefined ? options.isPublic : false, // Default to private
      isImmutable: options.isImmutable || false,
      enableCRDT: options.enableCRDT || false,
      allowedPeers: options.allowedPeers || [],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      ttl: options.ttl || this.config.defaultTTL
    };

    // Store metadata locally
    this.storageMetadata.set(keyId, metadata);
    this.ownedKeys.add(keyId);

    // Set up access control
    this.accessControl.set(keyId, {
      isPublic: metadata.isPublic,
      owner: metadata.owner,
      allowedPeers: new Set(metadata.allowedPeers),
      isImmutable: metadata.isImmutable
    });

    // Initialize CRDT state if enabled
    if (metadata.enableCRDT) {
      this.crdtStates.set(keyId, {
        vectorClock: { [this.mesh.peerId]: 1 },
        operations: [],
        lastMerged: timestamp
      });
    }

    // Prepare the storage payload
    let storagePayload = {
      value,
      metadata,
      encrypted: false
    };

    // Only encrypt private data (isPublic: false) to ensure owner-only access
    if (!metadata.isPublic && this.config.encryptionEnabled && this.unsea && this.storageKeypair) {
      try {
        // For private data, encrypt with the owner's keypair so only the owner can decrypt
        const encryptedValue = await this.unsea.encryptMessageWithMeta(serializedValue, this.storageKeypair);
        storagePayload = {
          value: encryptedValue,
          metadata,
          encrypted: true,
          encryptedBy: this.mesh.peerId // Track who encrypted it
        };
        console.log(`📦 Encrypted private storage data for key: ${key} (owner-only access)`);
      } catch (error) {
        console.warn(`Failed to encrypt private storage data for key ${key}:`, error);
        // Fall back to unencrypted storage if encryption fails
      }
    } else {
      console.log(`📦 Storing ${metadata.isPublic ? 'public' : 'unencrypted'} data for key: ${key}`);
    }

    // Store in WebDHT
    try {
      console.log(`📦 Storing payload for key ${key}:`, {
        hasValue: !!storagePayload.value,
        hasMetadata: !!storagePayload.metadata,
        encrypted: storagePayload.encrypted
      });

      await this.webDHT.put(`storage:${key}`, storagePayload, {
        ttl: metadata.ttl
      });

      console.log(`📦 Stored ${metadata.isPublic ? 'public' : 'private'} data for key: ${key}`);

      // Emit storage event
      this.emit('dataStored', {
        key,
        keyId,
        isPublic: metadata.isPublic,
        isImmutable: metadata.isImmutable,
        enableCRDT: metadata.enableCRDT
      });

      return true;
    } catch (error) {
      console.error(`Failed to store data for key ${key}:`, error);
      // Clean up local metadata on failure
      this.storageMetadata.delete(keyId);
      this.ownedKeys.delete(keyId);
      this.accessControl.delete(keyId);
      this.crdtStates.delete(keyId);
      throw error;
    }
  }

  /**
   * Retrieve data with access control and decryption
   * @param {string} key - The storage key
   * @param {Object} options - Retrieval options
   * @param {boolean} options.forceRefresh - Force refresh from network
   * @returns {Promise<any>} The stored value or null if not accessible
   */
  async retrieve(key, options = {}) {
    if (!this.webDHT) {
      throw new Error('WebDHT not available - ensure it is enabled in mesh configuration');
    }

    // Wait for crypto initialization if encryption is enabled
    if (this.config.encryptionEnabled) {
      await this.waitForCrypto();
    }

    const keyId = await this.webDHT.generateKeyId(key);
    console.log(`📦 Retrieving key: ${key}, keyId: ${keyId.substring(0, 8)}...`);

    try {
      // Get data from WebDHT
      console.log(`📦 Attempting to retrieve data for key: ${key}`);
      const storagePayload = await this.webDHT.get(`storage:${key}`, {
        forceRefresh: options.forceRefresh
      });

      console.log(`📦 Retrieved payload for key ${key}:`, {
        payloadExists: !!storagePayload,
        payloadType: typeof storagePayload,
        payloadValue: storagePayload,
        keys: storagePayload ? Object.keys(storagePayload) : 'none'
      });

      if (!storagePayload || typeof storagePayload !== 'object') {
        console.log(`📦 No data found for key: ${key}`);
        return null;
      }

      // Debug: Log the raw payload structure
      console.log('📦 Raw payload structure:', JSON.stringify(storagePayload, null, 2));

      // Safely destructure the payload with detailed logging
      const value = storagePayload.value;
      const metadata = storagePayload.metadata;
      const encrypted = storagePayload.encrypted || false;
      const encryptedBy = storagePayload.encryptedBy;

      console.log('📦 Payload components:', {
        hasValue: value !== undefined,
        valueType: typeof value,
        hasMetadata: metadata !== undefined,
        metadataType: typeof metadata,
        encrypted,
        encryptedBy: encryptedBy?.substring(0, 8) + '...' || 'unknown'
      });

      if (!metadata) {
        console.warn(`📦 Invalid storage payload for key ${key}: missing metadata`);
        return null;
      }

      // Check access permissions
      if (!this.hasReadAccess(keyId, metadata)) {
        console.warn(`Access denied for key: ${key}`);
        return null;
      }

      // Decrypt if necessary
      let finalValue = value;
      if (encrypted && this.unsea && this.storageKeypair) {
        // Only allow decryption if this peer is the owner (encrypted the data)
        if (encryptedBy && encryptedBy !== this.mesh.peerId) {
          console.warn(`📦 Cannot decrypt data for key ${key}: encrypted by different peer (${encryptedBy.substring(0, 8)}...), current peer: ${this.mesh.peerId.substring(0, 8)}...`);
          // For private data encrypted by another peer, deny access
          if (!metadata.isPublic) {
            console.warn(`Access denied for key: ${key} - private data encrypted by different peer`);
            return null;
          }
        }

        try {
          const decryptedValue = await this.unsea.decryptMessageWithMeta(value, this.storageKeypair.epriv);
          finalValue = JSON.parse(decryptedValue);
          console.log(`🔓 Decrypted storage data for key: ${key}`);
        } catch (error) {
          console.error(`Failed to decrypt data for key ${key}:`, error);
          // If this is private data and decryption fails, deny access
          if (!metadata.isPublic) {
            return null;
          }
          // For public data, if decryption fails, try to use the raw value
          console.warn(`📦 Using raw value for public key ${key} due to decryption failure`);
          finalValue = value;
        }
      }

      // Update local metadata if we don't have it
      if (!this.storageMetadata.has(keyId)) {
        this.storageMetadata.set(keyId, metadata);
        this.accessControl.set(keyId, {
          isPublic: metadata.isPublic,
          owner: metadata.owner,
          allowedPeers: new Set(metadata.allowedPeers),
          isImmutable: metadata.isImmutable
        });
      }

      console.log(`📦 Retrieved ${metadata.isPublic ? 'public' : 'private'} data for key: ${key}`);

      // Emit retrieval event
      this.emit('dataRetrieved', {
        key,
        keyId,
        isPublic: metadata.isPublic,
        owner: metadata.owner
      });

      return finalValue;
    } catch (error) {
      console.error(`Failed to retrieve data for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Update existing data (only allowed for owners or if mutable)
   * @param {string} key - The storage key
   * @param {any} newValue - The new value
   * @param {Object} options - Update options
   * @param {boolean} options.forceCRDTMerge - Force CRDT merge even if not owner
   * @returns {Promise<boolean>} Success status
   */
  async update(key, newValue, options = {}) {
    if (!this.webDHT) {
      throw new Error('WebDHT not available - ensure it is enabled in mesh configuration');
    }

    const keyId = await this.webDHT.generateKeyId(key);
    const timestamp = Date.now();

    // Check if we have access to update
    const accessControl = this.accessControl.get(keyId);
    const metadata = this.storageMetadata.get(keyId);

    if (!accessControl || !metadata) {
      // Try to retrieve metadata first
      const existingData = await this.retrieve(key);
      if (!existingData) {
        throw new Error(`Key ${key} does not exist or is not accessible`);
      }
      // Retry after retrieving metadata
      return this.update(key, newValue, options);
    }

    const isOwner = accessControl.owner === this.mesh.peerId;
    const canUpdate = isOwner || (!accessControl.isImmutable) || (metadata.enableCRDT && options.forceCRDTMerge);

    if (!canUpdate) {
      throw new Error(`Update not allowed for key ${key}: immutable data and not owner`);
    }

    // Handle CRDT merge if enabled
    if (metadata.enableCRDT && !isOwner) {
      return this.applyCRDTUpdate(key, keyId, newValue, options);
    }

    // Update metadata
    metadata.updatedAt = timestamp;
    metadata.version += 1;

    // Prepare storage payload
    let storagePayload = {
      value: newValue,
      metadata,
      encrypted: false
    };

    // Encrypt if not public and crypto is available
    if (!metadata.isPublic && this.config.encryptionEnabled && this.unsea && this.storageKeypair) {
      try {
        const serializedValue = JSON.stringify(newValue);
        const encryptedValue = await this.unsea.encryptMessageWithMeta(serializedValue, this.storageKeypair);
        storagePayload = {
          value: encryptedValue,
          metadata,
          encrypted: true,
          encryptedBy: this.mesh.peerId // Track who encrypted it
        };
        console.log(`📦 Encrypted updated storage data for key: ${key}`);
      } catch (error) {
        console.warn(`Failed to encrypt updated storage data for key ${key}:`, error);
      }
    }

    try {
      // Use WebDHT update to notify all replicas and subscribers
      await this.webDHT.update(`storage:${key}`, storagePayload, {
        ttl: metadata.ttl
      });

      // Update local metadata
      this.storageMetadata.set(keyId, metadata);

      console.log(`📦 Updated ${metadata.isPublic ? 'public' : 'private'} data for key: ${key}`);

      // Emit update event
      this.emit('dataUpdated', {
        key,
        keyId,
        isPublic: metadata.isPublic,
        version: metadata.version,
        isOwner
      });

      return true;
    } catch (error) {
      console.error(`Failed to update data for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Apply CRDT-based update for collaborative editing
   * @private
   */
  async applyCRDTUpdate(key, keyId, operation, options = {}) {
    const crdtState = this.crdtStates.get(keyId);
    const metadata = this.storageMetadata.get(keyId);

    if (!crdtState || !metadata) {
      throw new Error(`CRDT state not found for key ${key}`);
    }

    // Increment vector clock for this peer
    const currentClock = crdtState.vectorClock[this.mesh.peerId] || 0;
    crdtState.vectorClock[this.mesh.peerId] = currentClock + 1;

    // Add operation to CRDT state
    const crdtOperation = {
      peerId: this.mesh.peerId,
      timestamp: Date.now(),
      vectorClock: { ...crdtState.vectorClock },
      operation,
      type: options.operationType || 'replace'
    };

    crdtState.operations.push(crdtOperation);
    crdtState.lastMerged = Date.now();

    // Apply CRDT merge logic (simplified last-write-wins for now)
    const mergedValue = this.mergeCRDTOperations(crdtState.operations);

    // Update the stored value
    return this.update(key, mergedValue, { ...options, forceCRDTMerge: false });
  }

  /**
   * Simple CRDT merge implementation (can be extended for more sophisticated CRDTs)
   * @private
   */
  mergeCRDTOperations(operations) {
    // Sort operations by timestamp and apply in order
    const sortedOps = operations.sort((a, b) => a.timestamp - b.timestamp);

    let result = null;
    for (const op of sortedOps) {
      switch (op.type) {
        case 'replace':
          result = op.operation;
          break;
        case 'merge':
          if (result && typeof result === 'object' && typeof op.operation === 'object') {
            result = { ...result, ...op.operation };
          } else {
            result = op.operation;
          }
          break;
        default:
          result = op.operation;
      }
    }

    return result;
  }

  /**
   * Delete data (only allowed for owners)
   * @param {string} key - The storage key
   * @returns {Promise<boolean>} Success status
   */
  async delete(key) {
    if (!this.webDHT) {
      throw new Error('WebDHT not available - ensure it is enabled in mesh configuration');
    }

    const keyId = await this.webDHT.generateKeyId(key);
    const accessControl = this.accessControl.get(keyId);

    if (!accessControl || accessControl.owner !== this.mesh.peerId) {
      throw new Error(`Delete not allowed for key ${key}: not owner`);
    }

    try {
      // Create a tombstone entry to mark as deleted
      const tombstone = {
        deleted: true,
        deletedAt: Date.now(),
        deletedBy: this.mesh.peerId
      };

      await this.webDHT.update(`storage:${key}`, tombstone);

      // Clean up local state
      this.storageMetadata.delete(keyId);
      this.ownedKeys.delete(keyId);
      this.accessControl.delete(keyId);
      this.crdtStates.delete(keyId);

      console.log(`📦 Deleted data for key: ${key}`);

      // Emit deletion event
      this.emit('dataDeleted', { key, keyId });

      return true;
    } catch (error) {
      console.error(`Failed to delete data for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to changes for a storage key
   * @param {string} key - The storage key
   * @returns {Promise<any>} Current value or null
   */
  async subscribe(key) {
    if (!this.webDHT) {
      throw new Error('WebDHT not available - ensure it is enabled in mesh configuration');
    }

    // Subscribe to the WebDHT key
    const currentValue = await this.webDHT.subscribe(`storage:${key}`);

    console.log(`📦 Subscribed to storage key: ${key}`);

    return currentValue;
  }

  /**
   * Unsubscribe from changes for a storage key
   * @param {string} key - The storage key
   */
  async unsubscribe(key) {
    if (!this.webDHT) {
      return;
    }

    await this.webDHT.unsubscribe(`storage:${key}`);
    console.log(`📦 Unsubscribed from storage key: ${key}`);
  }

  /**
   * Check if the current peer has read access to a key
   * @private
   */
  hasReadAccess(keyId, metadata) {
    const accessControl = this.accessControl.get(keyId);

    if (!accessControl && metadata) {
      // Create access control from metadata
      this.accessControl.set(keyId, {
        isPublic: metadata.isPublic,
        owner: metadata.owner,
        allowedPeers: new Set(metadata.allowedPeers || []),
        isImmutable: metadata.isImmutable
      });
      return this.hasReadAccess(keyId, metadata);
    }

    if (!accessControl) {
      return false;
    }

    // Owner always has access
    if (accessControl.owner === this.mesh.peerId) {
      return true;
    }

    // Public data is accessible to everyone
    if (accessControl.isPublic) {
      return true;
    }

    // Check if peer is in allowed list
    return accessControl.allowedPeers.has(this.mesh.peerId);
  }

  /**
   * Grant access to a peer for a private key (only owner can do this)
   * @param {string} key - The storage key
   * @param {string} peerId - The peer to grant access to
   * @returns {Promise<boolean>} Success status
   */
  async grantAccess(key, peerId) {
    const keyId = await this.webDHT.generateKeyId(key);
    const accessControl = this.accessControl.get(keyId);
    const metadata = this.storageMetadata.get(keyId);

    if (!accessControl || !metadata || accessControl.owner !== this.mesh.peerId) {
      throw new Error(`Cannot grant access for key ${key}: not owner`);
    }

    if (accessControl.isPublic) {
      throw new Error(`Cannot grant access for key ${key}: already public`);
    }

    // Add peer to allowed list
    accessControl.allowedPeers.add(peerId);
    metadata.allowedPeers.push(peerId);
    metadata.updatedAt = Date.now();

    // Update the stored metadata
    try {
      const currentPayload = await this.webDHT.get(`storage:${key}`);
      if (currentPayload) {
        currentPayload.metadata = metadata;
        await this.webDHT.update(`storage:${key}`, currentPayload);
      }

      console.log(`📦 Granted access to peer ${peerId.substring(0, 8)}... for key: ${key}`);

      // Emit access granted event
      this.emit('accessGranted', { key, keyId, peerId });

      return true;
    } catch (error) {
      // Rollback changes
      accessControl.allowedPeers.delete(peerId);
      metadata.allowedPeers = metadata.allowedPeers.filter(p => p !== peerId);
      throw error;
    }
  }

  /**
   * Revoke access from a peer for a private key (only owner can do this)
   * @param {string} key - The storage key
   * @param {string} peerId - The peer to revoke access from
   * @returns {Promise<boolean>} Success status
   */
  async revokeAccess(key, peerId) {
    const keyId = await this.webDHT.generateKeyId(key);
    const accessControl = this.accessControl.get(keyId);
    const metadata = this.storageMetadata.get(keyId);

    if (!accessControl || !metadata || accessControl.owner !== this.mesh.peerId) {
      throw new Error(`Cannot revoke access for key ${key}: not owner`);
    }

    // Remove peer from allowed list
    accessControl.allowedPeers.delete(peerId);
    metadata.allowedPeers = metadata.allowedPeers.filter(p => p !== peerId);
    metadata.updatedAt = Date.now();

    // Update the stored metadata
    try {
      const currentPayload = await this.webDHT.get(`storage:${key}`);
      if (currentPayload) {
        currentPayload.metadata = metadata;
        await this.webDHT.update(`storage:${key}`, currentPayload);
      }

      console.log(`📦 Revoked access from peer ${peerId.substring(0, 8)}... for key: ${key}`);

      // Emit access revoked event
      this.emit('accessRevoked', { key, keyId, peerId });

      return true;
    } catch (error) {
      // Rollback changes
      accessControl.allowedPeers.add(peerId);
      metadata.allowedPeers.push(peerId);
      throw error;
    }
  }

  /**
   * List all keys owned by this peer
   * @returns {Array<Object>} Array of owned key metadata
   */
  getOwnedKeys() {
    const ownedKeys = [];
    for (const keyId of this.ownedKeys) {
      const metadata = this.storageMetadata.get(keyId);
      if (metadata) {
        ownedKeys.push({
          key: metadata.key,
          keyId,
          isPublic: metadata.isPublic,
          isImmutable: metadata.isImmutable,
          enableCRDT: metadata.enableCRDT,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          version: metadata.version
        });
      }
    }
    return ownedKeys;
  }

  /**
   * Get statistics about the storage manager
   * @returns {Promise<Object>} Storage statistics
   */
  async getStats() {
    let totalSize = 0;
    let itemCount = 0;

    // Calculate sizes for owned keys
    for (const keyId of this.ownedKeys) {
      const metadata = this.storageMetadata.get(keyId);
      if (metadata) {
        try {
          const value = await this.retrieve(metadata.key);
          if (value !== null) {
            const serializedSize = JSON.stringify(value).length;
            totalSize += serializedSize;
            itemCount++;
          }
        } catch (error) {
          // Skip keys that can't be retrieved
        }
      }
    }

    return {
      enabled: this.enabled,
      itemCount,
      totalSize,
      ownedKeys: this.ownedKeys.size,
      totalKeys: this.storageMetadata.size,
      crdtKeys: this.crdtStates.size,
      encryptionEnabled: this.config.encryptionEnabled && !!this.unsea && !!this.storageKeypair,
      maxValueSize: this.config.maxValueSize
    };
  }

  /**
   * Clean up expired data and old CRDT operations
   */
  cleanup() {
    const now = Date.now();

    // Clean up expired metadata
    for (const [keyId, metadata] of this.storageMetadata.entries()) {
      if (metadata.ttl && (metadata.createdAt + metadata.ttl) < now) {
        this.storageMetadata.delete(keyId);
        this.accessControl.delete(keyId);
        this.ownedKeys.delete(keyId);
        console.log(`📦 Cleaned up expired metadata for key: ${metadata.key}`);
      }
    }

    // Clean up old CRDT operations (keep last 100 operations per key)
    for (const [keyId, crdtState] of this.crdtStates.entries()) {
      if (crdtState.operations.length > 100) {
        crdtState.operations = crdtState.operations.slice(-100);
        console.log(`📦 Cleaned up old CRDT operations for key: ${keyId.substring(0, 8)}...`);
      }
    }
  }

  /**
   * Backup all owned data to a serializable format
   * @returns {Object} Backup data that can be restored later
   */
  async backup() {
    const backupData = {
      version: '1.0.0',
      timestamp: Date.now(),
      peerId: this.mesh.peerId,
      keys: []
    };

    for (const keyId of this.ownedKeys) {
      const metadata = this.storageMetadata.get(keyId);
      if (metadata) {
        try {
          // Get the current value from storage
          const value = await this.retrieve(metadata.key);
          if (value !== null) {
            backupData.keys.push({
              key: metadata.key,
              value,
              metadata: {
                isPublic: metadata.isPublic,
                isImmutable: metadata.isImmutable,
                enableCRDT: metadata.enableCRDT,
                allowedPeers: metadata.allowedPeers,
                ttl: metadata.ttl
              }
            });
          }
        } catch (error) {
          console.warn(`Failed to backup key ${metadata.key}:`, error);
        }
      }
    }

    console.log(`📦 Created backup with ${backupData.keys.length} keys`);
    return backupData;
  }

  /**
   * Restore data from a backup
   * @param {Object} backupData - Backup data created by backup()
   * @param {Object} options - Restore options
   * @param {boolean} options.overwrite - Whether to overwrite existing keys (default: false)
   * @returns {Promise<Object>} Restore results
   */
  async restore(backupData, options = {}) {
    if (!backupData || !backupData.keys || !Array.isArray(backupData.keys)) {
      throw new Error('Invalid backup data format');
    }

    const results = {
      restored: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    for (const keyData of backupData.keys) {
      try {
        const { key, value, metadata } = keyData;

        // Check if key already exists
        const existing = await this.retrieve(key);
        if (existing !== null && !options.overwrite) {
          results.skipped++;
          continue;
        }

        // Restore the key
        await this.store(key, value, metadata);
        results.restored++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          key: keyData.key,
          error: error.message
        });
        console.warn(`Failed to restore key ${keyData.key}:`, error);
      }
    }

    console.log(`📦 Restore complete: ${results.restored} restored, ${results.skipped} skipped, ${results.failed} failed`);
    return results;
  }

  /**
   * List all accessible keys (owned + granted access)
   * @returns {Array<Object>} Array of accessible key metadata
   */
  async listAccessibleKeys() {
    const accessibleKeys = [];

    // Add owned keys
    for (const keyId of this.ownedKeys) {
      const metadata = this.storageMetadata.get(keyId);
      if (metadata) {
        accessibleKeys.push({
          key: metadata.key,
          keyId,
          isPublic: metadata.isPublic,
          isImmutable: metadata.isImmutable,
          enableCRDT: metadata.enableCRDT,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          version: metadata.version,
          owned: true,
          accessible: true
        });
      }
    }

    // Add keys we have access to but don't own
    for (const [keyId] of this.accessControl.entries()) {
      if (!this.ownedKeys.has(keyId) && this.hasReadAccess(keyId)) {
        const metadata = this.storageMetadata.get(keyId);
        if (metadata) {
          accessibleKeys.push({
            key: metadata.key,
            keyId,
            isPublic: metadata.isPublic,
            isImmutable: metadata.isImmutable,
            enableCRDT: metadata.enableCRDT,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
            version: metadata.version,
            owned: false,
            accessible: true
          });
        }
      }
    }

    return accessibleKeys;
  }

  /**
   * Bulk store multiple key-value pairs
   * @param {Array<Object>} items - Array of {key, value, options} objects
   * @param {Object} globalOptions - Options to apply to all items
   * @returns {Promise<Object>} Results summary
   */
  async bulkStore(items, globalOptions = {}) {
    const results = {
      stored: 0,
      failed: 0,
      errors: []
    };

    const storePromises = items.map(async (item) => {
      try {
        const options = { ...globalOptions, ...item.options };
        await this.store(item.key, item.value, options);
        results.stored++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          key: item.key,
          error: error.message
        });
      }
    });

    await Promise.allSettled(storePromises);
    console.log(`📦 Bulk store complete: ${results.stored} stored, ${results.failed} failed`);
    return results;
  }

  /**
   * Bulk retrieve multiple keys
   * @param {Array<string>} keys - Array of keys to retrieve
   * @param {Object} options - Retrieval options
   * @returns {Promise<Object>} Map of key -> value (null for inaccessible keys)
   */
  async bulkRetrieve(keys, options = {}) {
    const results = {};

    const retrievePromises = keys.map(async (key) => {
      try {
        const value = await this.retrieve(key, options);
        results[key] = value;
      } catch (error) {
        console.warn(`Failed to retrieve key ${key}:`, error);
        results[key] = null;
      }
    });

    await Promise.allSettled(retrievePromises);
    return results;
  }

  /**
   * Search for keys by pattern or metadata
   * @param {Object} criteria - Search criteria
   * @param {string} criteria.keyPattern - Regex pattern to match keys
   * @param {boolean} criteria.isPublic - Filter by public/private
   * @param {boolean} criteria.owned - Filter by ownership
   * @param {string} criteria.owner - Filter by specific owner
   * @returns {Array<Object>} Matching keys
   */
  searchKeys(criteria = {}) {
    const matches = [];

    for (const [keyId, metadata] of this.storageMetadata.entries()) {
      let match = true;

      // Check key pattern
      if (criteria.keyPattern) {
        const regex = new RegExp(criteria.keyPattern);
        if (!regex.test(metadata.key)) {
          match = false;
        }
      }

      // Check public/private
      if (criteria.isPublic !== undefined && metadata.isPublic !== criteria.isPublic) {
        match = false;
      }

      // Check ownership
      if (criteria.owned !== undefined) {
        const isOwned = this.ownedKeys.has(keyId);
        if (isOwned !== criteria.owned) {
          match = false;
        }
      }

      // Check specific owner
      if (criteria.owner && metadata.owner !== criteria.owner) {
        match = false;
      }

      if (match) {
        matches.push({
          key: metadata.key,
          keyId,
          isPublic: metadata.isPublic,
          isImmutable: metadata.isImmutable,
          enableCRDT: metadata.enableCRDT,
          owner: metadata.owner,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          version: metadata.version,
          owned: this.ownedKeys.has(keyId)
        });
      }
    }

    return matches;
  }

  /**
   * Watch for changes to multiple keys
   * @param {Array<string>} keys - Keys to watch
   * @param {Function} callback - Callback function for changes
   * @returns {Function} Unwatch function
   */
  async watchKeys(keys, callback) {
    const subscriptions = new Set();

    // Subscribe to each key
    for (const key of keys) {
      try {
        await this.subscribe(key);
        subscriptions.add(key);
      } catch (error) {
        console.warn(`Failed to subscribe to key ${key}:`, error);
      }
    }

    // Set up event listener
    const eventHandler = (event) => {
      if (keys.includes(event.key)) {
        callback(event);
      }
    };

    this.addEventListener('dataUpdated', eventHandler);
    this.addEventListener('dataDeleted', eventHandler);

    // Return unwatch function
    return async () => {
      // Unsubscribe from keys
      for (const key of subscriptions) {
        try {
          await this.unsubscribe(key);
        } catch (error) {
          console.warn(`Failed to unsubscribe from key ${key}:`, error);
        }
      }

      // Remove event listeners
      this.removeEventListener('dataUpdated', eventHandler);
      this.removeEventListener('dataDeleted', eventHandler);
    };
  }

  /**
   * Get detailed information about a key including access control
   * @param {string} key - The storage key
   * @returns {Promise<Object|null>} Key information or null if not found
   */
  async getKeyInfo(key) {
    const keyId = await this.webDHT.generateKeyId(key);
    const metadata = this.storageMetadata.get(keyId);

    if (!metadata) {
      return null;
    }

    return {
      key: metadata.key,
      keyId,
      owner: metadata.owner,
      isPublic: metadata.isPublic,
      isImmutable: metadata.isImmutable,
      enableCRDT: metadata.enableCRDT,
      allowedPeers: metadata.allowedPeers,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      version: metadata.version,
      ttl: metadata.ttl,
      owned: this.ownedKeys.has(keyId),
      accessible: this.hasReadAccess(keyId, metadata),
      crdtEnabled: this.crdtStates.has(keyId)
    };
  }

  /**
   * Enable the distributed storage layer
   * @returns {Promise<void>}
   */
  async enable() {
    if (!this.webDHT) {
      throw new Error('WebDHT not available - ensure it is enabled in mesh configuration');
    }

    this.enabled = true;
    console.log('📦 Distributed storage enabled');
    this.emit('storageEnabled');
  }

  /**
   * Disable the distributed storage layer
   * @returns {Promise<void>}
   */
  async disable() {
    this.enabled = false;
    console.log('📦 Distributed storage disabled');
    this.emit('storageDisabled');
  }

  /**
   * Check if the distributed storage layer is enabled
   * @returns {boolean} Whether storage is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Clear all stored data owned by this peer
   * @returns {Promise<void>}
   */
  async clear() {
    const ownedKeys = Array.from(this.ownedKeys);

    for (const keyId of ownedKeys) {
      const metadata = this.storageMetadata.get(keyId);
      if (metadata) {
        try {
          await this.delete(metadata.key);
        } catch (error) {
          console.warn(`Failed to delete key ${metadata.key} during clear:`, error);
        }
      }
    }

    // Clear local state
    this.storageMetadata.clear();
    this.accessControl.clear();
    this.crdtStates.clear();
    this.ownedKeys.clear();

    console.log('📦 All stored data cleared');
    this.emit('storageCleared');
  }

  /**
   * List keys with optional prefix filter
   * @param {string} prefix - Optional prefix to filter keys
   * @returns {Promise<Array<string>>} Array of matching keys
   */
  async listKeys(prefix = '') {
    const keys = [];

    for (const keyId of this.ownedKeys) {
      const metadata = this.storageMetadata.get(keyId);
      if (metadata && metadata.key.startsWith(prefix)) {
        keys.push(metadata.key);
      }
    }

    return keys.sort();
  }

  /**
   * Bulk delete keys with a given prefix
   * @param {string} prefix - Prefix of keys to delete
   * @returns {Promise<number>} Number of keys deleted
   */
  async bulkDelete(prefix) {
    const keysToDelete = await this.listKeys(prefix);
    let deletedCount = 0;

    for (const key of keysToDelete) {
      try {
        await this.delete(key);
        deletedCount++;
      } catch (error) {
        console.warn(`Failed to delete key ${key} during bulk delete:`, error);
      }
    }

    return deletedCount;
  }

  /**
   * Search for data by key, value, or metadata
   * @param {string} query - Search query
   * @param {string} type - Search type: 'key', 'value', or 'metadata'
   * @returns {Promise<Array<Object>>} Search results
   */
  async search(query, type = 'key') {
    const results = [];
    const searchRegex = new RegExp(query, 'i'); // Case-insensitive search

    for (const keyId of this.ownedKeys) {
      const metadata = this.storageMetadata.get(keyId);
      if (!metadata) continue;

      let match = false;

      if (type === 'key' && searchRegex.test(metadata.key)) {
        match = true;
      } else if (type === 'value') {
        try {
          const value = await this.retrieve(metadata.key);
          if (value && searchRegex.test(JSON.stringify(value))) {
            match = true;
          }
        } catch (error) {
          // Skip values that can't be retrieved
        }
      } else if (type === 'metadata') {
        const metadataStr = JSON.stringify({
          owner: metadata.owner,
          isPublic: metadata.isPublic,
          isImmutable: metadata.isImmutable,
          enableCRDT: metadata.enableCRDT
        });
        if (searchRegex.test(metadataStr)) {
          match = true;
        }
      }

      if (match) {
        try {
          const value = await this.retrieve(metadata.key);
          results.push({
            key: metadata.key,
            value,
            metadata: {
              owner: metadata.owner,
              isPublic: metadata.isPublic,
              isImmutable: metadata.isImmutable,
              enableCRDT: metadata.enableCRDT,
              createdAt: metadata.createdAt,
              updatedAt: metadata.updatedAt
            }
          });
        } catch (error) {
          // Skip keys that can't be retrieved
        }
      }
    }

    return results;
  }
}
