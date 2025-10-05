import { EventEmitter } from './EventEmitter.js';
import DebugLogger from './DebugLogger.js';
import { createLexicalInterface } from './LexicalStorageInterface.js';

// Dynamic import for unsea to handle both Node.js and browser environments
let unsea = null;

async function initializeUnsea() {
  if (unsea) return unsea;

  try {
    // Check if UnSEA is bundled (browser bundle case)
    if (typeof window !== 'undefined' && window.__PEERPIGEON_UNSEA__) {
      unsea = window.__PEERPIGEON_UNSEA__;
      console.log('✅ Using bundled UnSEA crypto for storage');
      return unsea;
    }

    // Check global scope for bundled version
    if (typeof globalThis !== 'undefined' && globalThis.__PEERPIGEON_UNSEA__) {
      unsea = globalThis.__PEERPIGEON_UNSEA__;
      console.log('✅ Using bundled UnSEA crypto for storage');
      return unsea;
    }

    // Detect environment - prioritize Node.js detection for tests
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

    if (isNode) {
      // For Node.js environments (including tests), use npm package
      unsea = await import('unsea');
      console.log('✅ Loaded unsea from npm package (Node.js) for storage');
    } else {
      // For browser environments without bundle, try CDN sources as fallback
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
 * DistributedStorageManager - High-level distributed storage layer for PeerPigeon mesh
 *
 * Features:
 * - Encrypted storage using unsea directly
 * - Optional public/private data visibility with access control
 * - Optional immutability with CRDT support for collaborative editing
 * - Mutable layer for data originators
 * - Uses WebDHT as low-level storage backend (but is separate conceptually)
 * - Space separation for preventing data overwrites (Private, Public, Frozen)
 * 
 * IMPORTANT: This is a HIGH-LEVEL storage system that provides encryption, 
 * access control, and advanced features. It uses WebDHT as its storage backend
 * but they are separate concepts:
 * - WebDHT: Low-level distributed hash table for raw key-value storage
 * - DistributedStorageManager: High-level storage with encryption/access control
 */
export class DistributedStorageManager extends EventEmitter {
  constructor(mesh) {
    super();
    this.debug = DebugLogger.create('DistributedStorageManager');
    this.mesh = mesh;
    
    // IMPORTANT: DistributedStorageManager uses WebDHT as its storage backend
    // but they are conceptually separate systems:
    // - WebDHT: Low-level DHT for raw key-value storage across the mesh
    // - DistributedStorageManager: High-level storage with encryption, access control, spaces
    this.webDHT = mesh.webDHT; // Uses WebDHT as backend storage layer
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
      conflictResolution: 'last-write-wins', // or 'crdt-merge'
      spaceEnforcement: true // Enable space-based access control
    };

    // Storage spaces for data separation
    this.spaces = {
      PRIVATE: 'private', // Only owner can read/write, encrypted
      PUBLIC: 'public', // Anyone can read, only owner can write
      FROZEN: 'frozen' // Immutable once set, anyone can read
    };

    // Local storage for metadata and permissions
    this.storageMetadata = new Map(); // keyId -> metadata
    this.accessControl = new Map(); // keyId -> access control info
    this.crdtStates = new Map(); // keyId -> CRDT state for collaborative data

    // Track data ownership by space
    this.ownedKeys = new Set(); // Keys owned by this peer
    this.spaceOwnership = new Map(); // space:key -> owner mapping
    this.keyToSpaceMapping = new Map(); // baseKey -> {space, storageKey} mapping for transparent access

    // Track enabled state
    this.enabled = true; // Enable by default

    this.debug.log(`DistributedStorageManager initialized for peer ${this.mesh.peerId?.substring(0, 8)}...`);
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

      this.debug.log('📦 Storage encryption initialized with unsea');
    } catch (error) {
      this.debug.warn('📦 Failed to initialize storage encryption:', error);
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

    while ((!this.unsea || !this.storageKeypair) && (Date.now() - start) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Resolve a key to its actual storage location across spaces
   * @param {string} key - The storage key (base key only)
   * @returns {Object} - {space, baseKey, keyId}
   */
  async resolveKey(key) {
    // Use the key directly - NO PREFIX PARSING
    const baseKey = key;
    
    // Generate keyId from baseKey (no prefixes)
    const keyId = await this.webDHT.hash(baseKey);

    // For bare keys, check if we have a mapping
    const mapping = this.keyToSpaceMapping.get(baseKey);
    if (mapping) {
      return {
        space: mapping.space,
        baseKey,
        keyId
      };
    }

    // If no mapping exists, check if we have metadata for this key
    if (this.storageMetadata.has(keyId)) {
      const metadata = this.storageMetadata.get(keyId);
      const space = metadata.space || this.spaces.PRIVATE;
      // Update the mapping for future use
      this.keyToSpaceMapping.set(baseKey, { space, storageKey: baseKey });
      return {
        space,
        baseKey,
        keyId
      };
    }

    // Default to private space if no other information is available
    const defaultSpace = this.spaces.PRIVATE;
    this.keyToSpaceMapping.set(baseKey, { space: defaultSpace, storageKey: baseKey });
    return {
      space: defaultSpace,
      baseKey,
      keyId
    };
  }



  /**
   * Check if a peer can access a key in a specific space
   * @param {string} space - The storage space
   * @param {string} key - The storage key
   * @param {string} peerId - The peer ID requesting access
   * @param {string} operation - The operation (read, write)
   * @returns {boolean} - Whether access is allowed
   */
  canAccessSpace(space, key, peerId, operation = 'read') {
    if (!this.config.spaceEnforcement) {
      return true; // Space enforcement disabled
    }

    const spaceKey = `${space}:${key}`;
    const owner = this.spaceOwnership.get(spaceKey);

    switch (space) {
      case this.spaces.PRIVATE:
        // Private: Only owner can read/write, or if no owner exists (initial write)
        return !owner || owner === peerId;

      case this.spaces.PUBLIC:
        if (operation === 'read') {
          return true; // Anyone can read public data
        } else {
          return !owner || owner === peerId; // Only owner can write, or initial write
        }

      case this.spaces.FROZEN:
        if (operation === 'read') {
          return true; // Anyone can read frozen data
        } else {
          // For frozen data, only the owner can write (both initial and updates)
          return !owner || owner === peerId; // Only owner can write, or initial write
        }

      default:
        return false;
    }
  }

  /**
   * Determine appropriate space and access control from options
   * @param {Object} options - Storage options
   * @returns {Object} - {space, isPublic, isImmutable}
   */
  determineSpaceFromOptions(options = {}) {
    // Allow explicit space specification
    if (options.space && Object.values(this.spaces).includes(options.space)) {
      const space = options.space;
      return {
        space,
        isPublic: space !== this.spaces.PRIVATE,
        isImmutable: space === this.spaces.FROZEN
      };
    }

    // Legacy compatibility - determine space from isPublic/isImmutable
    if (options.isImmutable) {
      return {
        space: this.spaces.FROZEN,
        isPublic: true,
        isImmutable: true
      };
    } else if (options.isPublic) {
      return {
        space: this.spaces.PUBLIC,
        isPublic: true,
        isImmutable: false
      };
    } else {
      return {
        space: this.spaces.PRIVATE,
        isPublic: false,
        isImmutable: false
      };
    }
  }

  /**
   * Find if a base key exists in a different space
   * @param {string} baseKey - The base key to search for
   * @param {string} excludeSpace - The space to exclude from search
   * @returns {string|null} - The space where the key exists, or null if not found
   */
  findKeyInDifferentSpace(baseKey, excludeSpace) {
    // Check our metadata to see if this baseKey exists in a different space
    for (const metadata of this.storageMetadata.values()) {
      if (metadata.baseKey === baseKey && metadata.space !== excludeSpace) {
        return metadata.space;
      }
    }
    
    // Also check space ownership using baseKey directly
    if (this.spaceOwnership.has(baseKey)) {
      const mapping = this.keyToSpaceMapping.get(baseKey);
      if (mapping && mapping.space !== excludeSpace) {
        return mapping.space;
      }
    }
    
    return null;
  }

  /**
   * Check if the current peer has read access to a key with space awareness
   * @param {string} keyId - The key ID
   * @param {Object} metadata - The metadata object
   * @param {string} space - The storage space
   * @returns {boolean} - Whether access is allowed
   */
  hasReadAccessWithSpace(keyId, metadata, space) {
    const accessControl = this.accessControl.get(keyId);

    if (!accessControl && metadata) {
      // Create access control from metadata
      this.accessControl.set(keyId, {
        isPublic: metadata.isPublic,
        owner: metadata.owner,
        allowedPeers: new Set(metadata.allowedPeers || []),
        isImmutable: metadata.isImmutable,
        space: metadata.space || space
      });
      return this.hasReadAccessWithSpace(keyId, metadata, space);
    }

    if (!accessControl) {
      return false;
    }

    // Owner always has access
    if (accessControl.owner === this.mesh.peerId) {
      return true;
    }

    // Space-based access control
    switch (space) {
      case this.spaces.PRIVATE:
        // Private: only owner and specifically allowed peers
        return accessControl.allowedPeers.has(this.mesh.peerId);

      case this.spaces.PUBLIC:
      case this.spaces.FROZEN:
        // Public and frozen: anyone can read
        return true;

      default:
        return false;
    }
  }

  /**
   * Store data with encryption and access control
   * @param {string} key - The storage key
   * @param {any} value - The value to store
   * @param {Object} options - Storage options
   * @param {string} options.space - Storage space ('private', 'public', 'frozen')
   * @param {boolean} options.isPublic - Whether data is publicly readable (legacy, use space instead)
   * @param {boolean} options.isImmutable - Whether data is immutable (legacy, use frozen space instead)
   * @param {boolean} options.enableCRDT - Whether to enable CRDT for collaborative editing (default: false)
   * @param {number} options.ttl - Time to live in milliseconds
   * @param {Array<string>} options.allowedPeers - Specific peers allowed to read private data
   * @returns {Promise<boolean>} Success status
   */
  async store(key, value, options = {}) {
    if (!this.enabled) {
      return false;
    }

    if (!this.webDHT) {
      throw new Error('WebDHT not available - ensure it is enabled in mesh configuration');
    }

    // Wait for crypto initialization if encryption is enabled
    if (this.config.encryptionEnabled) {
      await this.waitForCrypto();
    }

    // Use the key directly - NO PREFIX PARSING
    const spaceConfig = this.determineSpaceFromOptions(options);

    // Use the base key directly - NO SPACE PREFIXES!
    const baseKey = key;
    const space = options.space || spaceConfig.space;
    
    // The stored key is just the base key - space info goes in metadata
    const storageKey = baseKey;

    // Check space access permissions
    if (!this.canAccessSpace(space, baseKey, this.mesh.peerId, 'write')) {
      throw new Error(`Write access denied for space "${space}" and key "${baseKey}"`);
    }

    const keyId = await this.webDHT.hash(storageKey);
    const timestamp = Date.now();
    this.debug.log(`📦 Storing key: ${storageKey} in ${space} space, keyId: ${keyId.toString(16).substring(0, 8)}...`);

    // Validate value size
    const serializedValue = JSON.stringify(value);
    if (serializedValue.length > this.config.maxValueSize) {
      throw new Error(`Value size exceeds maximum allowed size of ${this.config.maxValueSize} bytes`);
    }

    // Create storage metadata with type and space information
    const metadata = {
      key: baseKey,  // Just the base key, no prefixes - space is its own attribute
      baseKey,
      space,
      keyId,
      owner: this.mesh.peerId,
      isPublic: spaceConfig.isPublic,
      isImmutable: spaceConfig.isImmutable,
      enableCRDT: options.enableCRDT || false,
      allowedPeers: options.allowedPeers || [],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      ttl: options.ttl || this.config.defaultTTL,
      type: 'storage', // Mark this as storage data type
      dataType: 'distributed-storage' // Specific storage system identifier
    };

    // Store metadata locally
    this.storageMetadata.set(keyId, metadata);
    this.ownedKeys.add(keyId);

    // Track space ownership using just the base key
    this.spaceOwnership.set(baseKey, this.mesh.peerId);

    // Track base key to space mapping for transparent access
    this.keyToSpaceMapping.set(baseKey, { space, storageKey });

    // Set up access control
    this.accessControl.set(keyId, {
      isPublic: metadata.isPublic,
      owner: metadata.owner,
      allowedPeers: new Set(metadata.allowedPeers),
      isImmutable: metadata.isImmutable,
      space
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

    // Only encrypt private space data
    if (space === this.spaces.PRIVATE && this.config.encryptionEnabled && this.unsea && this.storageKeypair) {
      try {
        // For private data, encrypt with the owner's keypair so only the owner can decrypt
        const encryptedValue = await this.unsea.encryptMessageWithMeta(serializedValue, this.storageKeypair);
        storagePayload = {
          value: encryptedValue,
          metadata,
          encrypted: true,
          encryptedBy: this.mesh.peerId // Track who encrypted it
        };
        this.debug.log(`📦 Encrypted private space storage data for key: ${storageKey} (owner-only access)`);
      } catch (error) {
        this.debug.warn(`Failed to encrypt private space storage data for key ${storageKey}:`, error);
        // Fall back to unencrypted storage if encryption fails
      }
    } else {
      this.debug.log(`📦 Storing ${space} space data for key: ${storageKey}`);
    }

    // CRITICAL DEBUG: Log exactly what we're storing
    this.debug.log(`📦 STORING PAYLOAD STRUCTURE for key ${storageKey}:`, {
      hasValue: !!storagePayload.value,
      hasMetadata: !!storagePayload.metadata,
      valueType: typeof storagePayload.value,
      metadataType: typeof storagePayload.metadata,
      metadataKeys: storagePayload.metadata ? Object.keys(storagePayload.metadata) : 'none',
      encrypted: storagePayload.encrypted,
      payloadKeys: Object.keys(storagePayload)
    });

    // Store in WebDHT with storage namespace prefix to separate from raw DHT data
    // This maintains separation between low-level DHT operations and high-level storage
    try {
      this.debug.log(`📦 Storing payload for key ${storageKey}:`, {
        hasValue: !!storagePayload.value,
        hasMetadata: !!storagePayload.metadata,
        encrypted: storagePayload.encrypted,
        space
      });

      // Store directly with clean key - NO PREFIXES, type information is in metadata
      await this.webDHT.put(storageKey, storagePayload, {
        ttl: metadata.ttl,
        space: space // Pass space for space-aware replication
      });

      this.debug.log(`📦 Stored ${space} space data for key: ${storageKey}`);

      // Emit storage event
      this.emit('dataStored', {
        key: storageKey,
        baseKey,
        space,
        keyId,
        isPublic: metadata.isPublic,
        isImmutable: metadata.isImmutable,
        enableCRDT: metadata.enableCRDT
      });

      return true;
    } catch (error) {
      this.debug.error(`Failed to store data for key ${storageKey}:`, error);
      // Clean up local metadata on failure
      this.storageMetadata.delete(keyId);
      this.ownedKeys.delete(keyId);
      this.accessControl.delete(keyId);
      this.crdtStates.delete(keyId);
      this.spaceOwnership.delete(baseKey);
      this.keyToSpaceMapping.delete(baseKey);
      throw error;
    }
  }

  /**
   * Retrieve data with access control and decryption
   * @param {string} key - The storage key (base key only, no prefixes)
   * @param {Object} options - Retrieval options
   * @param {string} options.space - Specific space to look in (optional)
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

    // Use the key directly - NO PREFIX STRIPPING
    const baseKey = key;
    
    this.debug.log(`📦 Retrieving data for base key: ${baseKey}`);

    try {
      // Get data from WebDHT using just the clean base key - NO PREFIXES
      const webDHTPayload = await this.webDHT.get(baseKey, {
        forceRefresh: options.forceRefresh,
        space: options.space // Pass space for space-aware replication
      });

      this.debug.log(`📦 Retrieved WebDHT payload for key ${baseKey}:`, {
        payloadExists: !!webDHTPayload,
        payloadType: typeof webDHTPayload,
        keys: webDHTPayload ? Object.keys(webDHTPayload) : 'none'
      });

      if (!webDHTPayload || typeof webDHTPayload !== 'object') {
        this.debug.log(`📦 No data found for key: ${baseKey}`);
        return null;
      }

      // Process the data using the metadata to determine space and access control
      return await this.processRetrievedData(baseKey, webDHTPayload);
    } catch (error) {
      this.debug.error(`Failed to retrieve data for key ${baseKey}:`, error);
      return null;
    }
  }

  /**
   * Process retrieved data payload with decryption and access control
   * @private
   */
  async processRetrievedData(baseKey, webDHTPayload) {
    try {
      // Generate keyId for this baseKey
      const keyId = await this.webDHT.hash(baseKey);

      // WebDHT returns the storage payload directly as {value, metadata, encrypted}
      const storagePayload = webDHTPayload;

      console.log(`📦 CRITICAL DEBUG: WebDHT payload structure for ${baseKey}:`, {
        webDHTKeys: Object.keys(webDHTPayload),
        payloadType: typeof webDHTPayload,
        directValue: !!webDHTPayload.value,
        directMetadata: !!webDHTPayload.metadata,
        directEncrypted: webDHTPayload.encrypted
      });

      if (!storagePayload || typeof storagePayload !== 'object') {
        console.log(`📦 CRITICAL: Invalid storage payload for key: ${baseKey}`);
        this.debug.log(`📦 Invalid storage payload for key: ${baseKey}`);
        return null;
      }

      // Safely destructure the payload with detailed logging
      const value = storagePayload.value;
      const metadata = storagePayload.metadata;
      const encrypted = storagePayload.encrypted || false;
      const encryptedBy = storagePayload.encryptedBy;

      if (!metadata) {
        this.debug.warn(`📦 Invalid storage payload for key ${baseKey}: missing metadata`);
        return null;
      }

      // Validate this is actually storage data by checking metadata type
      if (!metadata.type || metadata.type !== 'storage') {
        this.debug.log(`📦 Data for key ${baseKey} is not storage data (type: ${metadata.type || 'unknown'}) - ignoring`);
        return null;
      }

      // Get space from metadata - this is where space info is stored!
      const space = metadata.space;

      this.debug.log('📦 Payload components:', {
        hasValue: value !== undefined,
        valueType: typeof value,
        hasMetadata: metadata !== undefined,
        metadataType: typeof metadata,
        encrypted,
        space: space || 'unknown',
        encryptedBy: encryptedBy?.substring(0, 8) + '...' || 'unknown'
      });

      // Check space access permissions using space from metadata
      if (!this.canAccessSpace(space, baseKey, this.mesh.peerId, 'read')) {
        this.debug.warn(`📦 Access denied for key: ${baseKey} in space: ${space}`);
        return null;
      }

      // Check access permissions using space-aware logic
      if (!this.hasReadAccessWithSpace(keyId, metadata, space)) {
        this.debug.warn(`📦 Access denied for key: ${baseKey} in space: ${space}`);
        return null;
      }

      // Decrypt if necessary
      let finalValue = value;
      if (encrypted && this.unsea && this.storageKeypair) {
        // Only allow decryption if this peer is the owner (encrypted the data)
        if (encryptedBy && encryptedBy !== this.mesh.peerId) {
          this.debug.warn(`📦 Cannot decrypt data for key ${baseKey}: encrypted by different peer (${encryptedBy.substring(0, 8)}...), current peer: ${this.mesh.peerId.substring(0, 8)}...`);
          // For private data encrypted by another peer, deny access
          if (!metadata.isPublic) {
            this.debug.warn(`Access denied for key: ${baseKey} - private data encrypted by different peer`);
            return null;
          }
        }

        try {
          const decryptedValue = await this.unsea.decryptMessageWithMeta(value, this.storageKeypair.epriv);
          finalValue = JSON.parse(decryptedValue);
          this.debug.log(`🔓 Decrypted storage data for key: ${baseKey}`);
        } catch (error) {
          this.debug.error(`Failed to decrypt data for key ${baseKey}:`, error);
          // If this is private data and decryption fails, deny access
          if (!metadata.isPublic) {
            return null;
          }
          // For public data, if decryption fails, try to use the raw value
          this.debug.warn(`📦 Using raw value for public key ${baseKey} due to decryption failure`);
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
          isImmutable: metadata.isImmutable,
          space: metadata.space || space
        });

        // Track space ownership from retrieved metadata using baseKey
        if (metadata.owner && !this.spaceOwnership.has(baseKey)) {
          this.spaceOwnership.set(baseKey, metadata.owner);
        }

        // Update key mapping for future transparent access
        this.keyToSpaceMapping.set(baseKey, { space, storageKey: baseKey });
      }

      this.debug.log(`📦 Retrieved ${space} space data for key: ${baseKey}`);

      // Emit retrieval event
      this.emit('dataRetrieved', {
        key: baseKey,
        baseKey,
        space,
        keyId,
        isPublic: metadata.isPublic,
        owner: metadata.owner
      });

      return finalValue;
    } catch (error) {
      this.debug.error(`Failed to retrieve data for key ${baseKey}:`, error);
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

    // Resolve the key to its actual storage location
    const resolved = await this.resolveKey(key);
    const { baseKey, keyId } = resolved;
    const timestamp = Date.now();

    // Check if we have access to update
    let accessControl = this.accessControl.get(keyId);
    let metadata = this.storageMetadata.get(keyId);

    if (!accessControl || !metadata) {
      // Try to retrieve metadata first
      const existingData = await this.retrieve(baseKey);
      if (!existingData) {
        throw new Error(`Key ${key} does not exist or is not accessible`);
      }

      // Check if metadata is now available after retrieve
      const updatedAccessControl = this.accessControl.get(keyId);
      const updatedMetadata = this.storageMetadata.get(keyId);

      if (!updatedAccessControl || !updatedMetadata) {
        throw new Error(`Key ${key} metadata could not be loaded - unable to update`);
      }

      // Update local references and continue with update logic
      accessControl = updatedAccessControl;
      metadata = updatedMetadata;
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
        this.debug.log(`📦 Encrypted updated storage data for key: ${key}`);
      } catch (error) {
        this.debug.warn(`Failed to encrypt updated storage data for key ${key}:`, error);
      }
    }

    try {
      // Use WebDHT update to notify all replicas and subscribers - NO PREFIXES
      await this.webDHT.update(baseKey, storagePayload, {
        ttl: metadata.ttl
      });

      // Update local metadata
      this.storageMetadata.set(keyId, metadata);

      this.debug.log(`📦 Updated ${metadata.isPublic ? 'public' : 'private'} data for key: ${baseKey}`);

      // Emit update event
      this.emit('dataUpdated', {
        key: baseKey,
        keyId,
        isPublic: metadata.isPublic,
        version: metadata.version,
        isOwner
      });

      return true;
    } catch (error) {
      this.debug.error(`Failed to update data for key ${baseKey}:`, error);
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

    // Resolve the key to its actual storage location
    const resolved = await this.resolveKey(key);
    const { baseKey, keyId } = resolved;

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

      // Mark as deleted in WebDHT - NO PREFIXES
      await this.webDHT.update(baseKey, tombstone);

      // Clean up local state
      this.storageMetadata.delete(keyId);
      this.ownedKeys.delete(keyId);
      this.accessControl.delete(keyId);
      this.crdtStates.delete(keyId);

      // Clean up space ownership tracking and key mapping
      this.spaceOwnership.delete(baseKey);
      this.keyToSpaceMapping.delete(baseKey);

      this.debug.log(`📦 Deleted data for key: ${baseKey}`);

      // Emit deletion event
      this.emit('dataDeleted', { key: baseKey, keyId });

      return true;
    } catch (error) {
      this.debug.error(`Failed to delete data for key ${baseKey}:`, error);
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

    // Subscribe to the WebDHT key - NO PREFIXES
    const currentValue = await this.webDHT.subscribe(key);

    this.debug.log(`📦 Subscribed to storage key: ${key}`);

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

    // Unsubscribe from the WebDHT key - NO PREFIXES
    await this.webDHT.unsubscribe(key);
    this.debug.log(`📦 Unsubscribed from storage key: ${key}`);
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
    // Resolve the key to its actual storage location
    const resolved = await this.resolveKey(key);
    const { baseKey, keyId } = resolved;

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
      const currentPayload = await this.webDHT.get(baseKey);
      if (currentPayload) {
        currentPayload.metadata = metadata;
        await this.webDHT.update(baseKey, currentPayload);
      }

      this.debug.log(`📦 Granted access to peer ${peerId.substring(0, 8)}... for key: ${baseKey}`);

      // Emit access granted event
      this.emit('accessGranted', { key: baseKey, keyId, peerId });

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
    // Resolve the key to its actual storage location
    const resolved = await this.resolveKey(key);
    const { baseKey, keyId } = resolved;

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
      const currentPayload = await this.webDHT.get(baseKey);
      if (currentPayload) {
        currentPayload.metadata = metadata;
        await this.webDHT.update(baseKey, currentPayload);
      }

      this.debug.log(`📦 Revoked access from peer ${peerId.substring(0, 8)}... for key: ${baseKey}`);

      // Emit access revoked event
      this.emit('accessRevoked', { key: baseKey, keyId, peerId });

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
        this.debug.log(`📦 Cleaned up expired metadata for key: ${metadata.key}`);
      }
    }

    // Clean up old CRDT operations (keep last 100 operations per key)
    for (const [keyId, crdtState] of this.crdtStates.entries()) {
      if (crdtState.operations.length > 100) {
        crdtState.operations = crdtState.operations.slice(-100);
        this.debug.log(`📦 Cleaned up old CRDT operations for key: ${keyId.substring(0, 8)}...`);
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
          this.debug.warn(`Failed to backup key ${metadata.key}:`, error);
        }
      }
    }

    this.debug.log(`📦 Created backup with ${backupData.keys.length} keys`);
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
        this.debug.warn(`Failed to restore key ${keyData.key}:`, error);
      }
    }

    this.debug.log(`📦 Restore complete: ${results.restored} restored, ${results.skipped} skipped, ${results.failed} failed`);
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
    this.debug.log(`📦 Bulk store complete: ${results.stored} stored, ${results.failed} failed`);
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
        this.debug.warn(`Failed to retrieve key ${key}:`, error);
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
        this.debug.warn(`Failed to subscribe to key ${key}:`, error);
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
          this.debug.warn(`Failed to unsubscribe from key ${key}:`, error);
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
    // Resolve the key to its actual storage location
    const resolved = await this.resolveKey(key);
    const { baseKey, keyId } = resolved;

    let metadata = this.storageMetadata.get(keyId);

    // If metadata is not found locally, try to retrieve it from the network
    if (!metadata) {
      try {
        const existingData = await this.retrieve(baseKey);
        if (existingData !== null) {
          // Metadata should now be available after retrieve
          metadata = this.storageMetadata.get(keyId);
        }
      } catch (error) {
        this.debug.warn(`Failed to retrieve metadata for key ${key}:`, error);
      }
    }

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
    this.debug.log('📦 Distributed storage enabled');
    this.emit('storageEnabled');
  }

  /**
   * Disable the distributed storage layer
   * @returns {Promise<void>}
   */
  async disable() {
    this.enabled = false;
    this.debug.log('📦 Distributed storage disabled');
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
          this.debug.warn(`Failed to delete key ${metadata.key} during clear:`, error);
        }
      }
    }

    // Clear local state
    this.storageMetadata.clear();
    this.accessControl.clear();
    this.crdtStates.clear();
    this.ownedKeys.clear();
    this.spaceOwnership.clear();
    this.keyToSpaceMapping.clear();

    this.debug.log('📦 All stored data cleared');
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
      if (metadata) {
        // Check both the stored key and the base key for prefix match
        const storedKey = metadata.key;
        const baseKey = metadata.baseKey;

        if (storedKey.startsWith(prefix) || baseKey.startsWith(prefix)) {
          // Return the base key for user convenience (since they stored with base key)
          keys.push(baseKey);
        }
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
        this.debug.warn(`Failed to delete key ${key} during bulk delete:`, error);
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

  /**
   * Get a lexical interface for GUN-like chaining
   * @returns {Proxy} Lexical interface
   */
  lexical() {
    return createLexicalInterface(this);
  }

  /**
   * Alias for lexical() - more GUN-like naming
   * @returns {Proxy} Lexical interface
   */
  gun() {
    return this.lexical();
  }
}
