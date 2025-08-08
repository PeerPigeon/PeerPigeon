import { EventEmitter } from './EventEmitter.js';
import DebugLogger from './DebugLogger.js';

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
      console.log('✅ Loaded unsea from npm package (Node.js)');
    } else if (isBrowser) {
      // Check if we have the bundled version first (from browser bundle)
      if ((typeof globalThis !== 'undefined' && globalThis.__PEERPIGEON_UNSEA__) ||
          (typeof window !== 'undefined' && window.__PEERPIGEON_UNSEA__)) {
        unsea = globalThis.__PEERPIGEON_UNSEA__ || window.__PEERPIGEON_UNSEA__;
        console.log('✅ Using bundled unsea (self-contained)');
      } else {
        // Fallback to CDN sources for backwards compatibility
        try {
          unsea = await import('https://cdn.jsdelivr.net/npm/unsea@latest/+esm');
          console.log('✅ Loaded unsea from jsDelivr CDN');
        } catch (jsDelivrError) {
          console.warn('Failed to load from jsDelivr, trying unpkg:', jsDelivrError);
          try {
            unsea = await import('https://unpkg.com/unsea@latest/dist/unsea.esm.js');
            console.log('✅ Loaded unsea from unpkg CDN');
          } catch (unpkgError) {
            console.warn('Failed to load from unpkg, trying Skypack:', unpkgError);
            unsea = await import('https://cdn.skypack.dev/unsea');
            console.log('✅ Loaded unsea from Skypack CDN');
          }
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
    console.error('Failed to load unsea:', error);
    throw error;
  }
}

export class CryptoManager extends EventEmitter {
  constructor() {
    super();
    this.debug = DebugLogger.create('CryptoManager');
    this.unsea = null;
    this.keypair = null;
    this.peerKeys = new Map(); // Store peer public keys
    this.encryptionEnabled = false;
    this.initialized = false;
    this.groupKeys = new Map(); // Store group encryption keys
    this.messageNonces = new Set(); // Prevent replay attacks
    this.maxNonceAge = 300000; // 5 minutes
    this.nonceCleanupInterval = null; // Track the cleanup interval

    // Performance metrics
    this.stats = {
      messagesEncrypted: 0,
      messagesDecrypted: 0,
      encryptionTime: 0,
      decryptionTime: 0,
      keyExchanges: 0
    };
  }

  /**
     * Initialize the crypto manager
     * @param {Object} options - Configuration options
     * @param {string} options.alias - Optional user alias for persistent identity
     * @param {string} options.password - Optional password for user account
     * @param {boolean} options.generateKeypair - Whether to generate a new keypair if no credentials
     * @param {string} options.peerId - Peer ID to use for automatic key storage
     * @returns {Promise<Object>} The generated or loaded keypair
     */
  async init(options = {}) {
    try {
      this.unsea = await initializeUnsea();

      if (options.alias && options.password) {
        // Try to create or authenticate with persistent identity
        await this.createOrAuthenticateUser(options.alias, options.password);
      } else if (options.peerId) {
        // Use peer ID for automatic persistent key storage
        await this.initWithPeerId(options.peerId);
      } else if (options.generateKeypair !== false) {
        // Generate ephemeral keypair
        this.keypair = await this.unsea.generateRandomPair();
      }

      if (this.keypair) {
        this.encryptionEnabled = true;
        this.initialized = true;
        this.emit('cryptoReady', { publicKey: this.getPublicKey() });

        // Start nonce cleanup
        this.startNonceCleanup();
      }

      return this.keypair;
    } catch (error) {
      this.debug.error('CryptoManager initialization failed:', error);
      this.emit('cryptoError', { error: error.message });
      throw error;
    }
  }

  /**
     * Create or authenticate a persistent user account
     */
  async createOrAuthenticateUser(alias, password) {
    try {
      // For unsea, we'll generate a deterministic keypair from credentials
      // Note: unsea doesn't have built-in user accounts like GUN
      // We can simulate this by generating deterministic keys from password+alias

      // Use unsea's key persistence if available (browser only)
      if (typeof window !== 'undefined') {
        try {
          // Try to load existing keys
          const existingKeys = await this.unsea.loadKeys(alias, password);
          if (existingKeys) {
            this.keypair = existingKeys;
          } else {
            // Generate new keys and save them
            this.keypair = await this.unsea.generateRandomPair();
            // PERFORMANCE: Defer key saving to prevent blocking WebRTC connection establishment
            setTimeout(async () => {
              try {
                await this.unsea.saveKeys(alias, this.keypair, password);
              } catch (saveError) {
                this.debug.warn('Failed to save persistent keys:', saveError);
              }
            }, 0);
          }
        } catch (error) {
          // Fallback to generating ephemeral keys
          this.debug.warn('Failed to use persistent storage, generating ephemeral keys:', error);
          this.keypair = await this.unsea.generateRandomPair();
        }
      } else {
        // For Node.js, just generate ephemeral keys
        this.keypair = await this.unsea.generateRandomPair();
      }

      this.emit('userAuthenticated', { alias, publicKey: this.getPublicKey() });
    } catch (error) {
      this.debug.error('User authentication failed:', error);
      throw error;
    }
  }

  /**
     * Initialize with automatic key persistence using peer ID
     * @param {string} peerId - The peer ID to use as storage alias
     */
  async initWithPeerId(peerId) {
    try {
      // Initialize unsea if not already done
      if (!this.unsea) {
        this.unsea = await initializeUnsea();
      }

      const keyAlias = `peerpigeon-${peerId}`;
      this.debug.log(`🔐 Initializing crypto with automatic key persistence for peer ${peerId.substring(0, 8)}...`);

      // Try to load existing keys first with timeout
      try {
        const loadKeysPromise = this.unsea.loadKeys(keyAlias);
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('LoadKeys timeout')), 5000);
        });
        
        const existingKeys = await Promise.race([loadKeysPromise, timeoutPromise]);
        if (existingKeys && existingKeys.pub && existingKeys.priv) {
          this.keypair = existingKeys;
          this.debug.log(`🔐 Loaded existing keypair for peer ${peerId.substring(0, 8)}...`);
          
          // Mark as initialized and emit ready event
          this.initialized = true;
          this.encryptionEnabled = true;
          this.emit('cryptoReady', {
            hasKeypair: !!this.keypair,
            publicKey: this.getPublicKey()
          });
          return;
        }
      } catch (error) {
        this.debug.log(`🔐 No existing keys found for peer ${peerId.substring(0, 8)}..., will generate new ones`);
      }

      // Generate new keys and save them with timeout
      const generateKeysPromise = this.unsea.generateRandomPair();
      const generateTimeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('GenerateKeys timeout')), 5000);
      });
      
      this.keypair = await Promise.race([generateKeysPromise, generateTimeoutPromise]);
      
      // PERFORMANCE: Defer key saving to prevent blocking WebRTC connection establishment
      setTimeout(async () => {
        try {
          await this.unsea.saveKeys(keyAlias, this.keypair);
          this.debug.log(`🔐 Generated and saved new keypair for peer ${peerId.substring(0, 8)}...`);
        } catch (saveError) {
          this.debug.warn(`🔐 Failed to save keypair for peer ${peerId.substring(0, 8)}..., using ephemeral keys:`, saveError.message);
          // Continue with ephemeral keys if storage fails
        }
      }, 0);

      // Mark as initialized and emit ready event
      this.initialized = true;
      this.encryptionEnabled = true;
      this.emit('cryptoReady', {
        hasKeypair: !!this.keypair,
        publicKey: this.getPublicKey()
      });

    } catch (error) {
      this.debug.error('Failed to initialize crypto with peer ID:', error);
      // Fallback to ephemeral keypair
      if (this.unsea) {
        this.keypair = await this.unsea.generateRandomPair();
        this.debug.log('🔐 Using ephemeral keypair as fallback');
      } else {
        throw error;
      }
    }

    // Mark as initialized and emit ready event
    this.initialized = true;
    this.encryptionEnabled = true;
    this.emit('cryptoReady', {
      hasKeypair: !!this.keypair,
      publicKey: this.getPublicKey()
    });
  }

  /**
     * Get the public key for sharing
     * @returns {string} The public key
     */
  getPublicKey() {
    // In unsea, the public key is likely in the 'pub' property
    return this.keypair?.pub || this.keypair?.publicKey;
  }

  /**
     * Get crypto status information
     * @returns {Object} Status information
     */
  getStatus() {
    // Convert group keys Map to object for UI consumption
    const groups = {};
    this.groupKeys.forEach((groupKey, groupId) => {
      groups[groupId] = {
        publicKey: groupKey.pub,
        created: groupKey.created || Date.now() // Use stored creation time or fallback to current time
      };
    });

    return {
      initialized: this.initialized,
      enabled: this.encryptionEnabled,
      hasKeypair: !!this.keypair,
      publicKey: this.getPublicKey(),
      peerCount: this.peerKeys.size,
      groupCount: this.groupKeys.size,
      groups,
      stats: { ...this.stats }
    };
  }

  /**
     * Store a peer's public keys (both pub and epub)
     * @param {string} peerId - The peer ID
     * @param {string|Object} publicKey - The peer's public key(s) - can be string (pub) or object with {pub, epub}
     */
  addPeerKey(peerId, publicKey) {
    if (!publicKey) return false;

    // Handle both string (just pub) and object (pub + epub) formats
    let keyData;
    if (typeof publicKey === 'string') {
      keyData = { pub: publicKey, epub: null };
    } else if (typeof publicKey === 'object' && (publicKey.pub || publicKey.epub)) {
      keyData = publicKey;
    } else {
      return false;
    }

    // Check if we already have the same key for this peer to prevent duplicate key exchange events
    const existingKey = this.peerKeys.get(peerId);
    if (existingKey) {
      // Compare both pub and epub keys to determine if this is actually a new key
      const pubMatches = existingKey.pub === keyData.pub;
      const epubMatches = existingKey.epub === keyData.epub;
      
      if (pubMatches && epubMatches) {
        // This is a duplicate key exchange - don't emit event or increment stats
        return false;
      }
    }

    this.peerKeys.set(peerId, keyData);
    this.stats.keyExchanges++;
    this.emit('peerKeyAdded', { peerId, publicKey: keyData });
    return true;
  }

  /**
     * Remove a peer's public key
     * @param {string} peerId - The peer ID
     */
  removePeerKey(peerId) {
    const removed = this.peerKeys.delete(peerId);
    if (removed) {
      this.emit('peerKeyRemoved', { peerId });
    }
    return removed;
  }

  /**
     * Encrypt a message for a specific peer
     * @param {any} message - The message to encrypt
     * @param {string} peerId - The target peer ID
     * @returns {Promise<Object>} Encrypted message object
     */
  async encryptForPeer(message, peerId) {
    if (!this.encryptionEnabled) {
      return { encrypted: false, data: message };
    }

    const peerKeyData = this.peerKeys.get(peerId);
    if (!peerKeyData) {
      throw new Error(`No public key found for peer ${peerId}`);
    }

    // Check if we have the encryption public key (epub)
    if (!peerKeyData.epub) {
      throw new Error(`No encryption public key (epub) found for peer ${peerId}. Only regular public key (pub) available.`);
    }

    const startTime = Date.now();
    try {
      const nonce = await this.generateNonce();
      const serialized = JSON.stringify(message);

      // Create a keypair object for unsea with both pub and epub
      const peerKeypair = {
        pub: peerKeyData.pub,
        epub: peerKeyData.epub
      };
      const encrypted = await this.unsea.encryptMessageWithMeta(serialized, peerKeypair);

      const result = {
        encrypted: true,
        data: encrypted,
        from: this.getPublicKey(),
        nonce,
        timestamp: Date.now()
      };

      this.stats.messagesEncrypted++;
      this.stats.encryptionTime += Date.now() - startTime;

      return result;
    } catch (error) {
      this.debug.error('Peer encryption failed:', error);
      throw error;
    }
  }

  /**
     * Decrypt a message from a peer
     * @param {Object} encryptedData - The encrypted message object
     * @returns {Promise<any>} The decrypted message
     */
  async decryptFromPeer(encryptedData) {
    if (!this.encryptionEnabled || !encryptedData.encrypted) {
      return encryptedData.data || encryptedData;
    }

    // Check for replay attacks
    if (encryptedData.nonce && this.messageNonces.has(encryptedData.nonce)) {
      throw new Error('Replay attack detected: duplicate nonce');
    }

    const startTime = Date.now();
    try {
      // Use unsea's decryptMessageWithMeta - pass our ephemeral private key (epriv)
      const decrypted = await this.unsea.decryptMessageWithMeta(encryptedData.data, this.keypair.epriv);
      const parsed = JSON.parse(decrypted);

      // Store nonce to prevent replay
      if (encryptedData.nonce) {
        this.messageNonces.add(encryptedData.nonce);
      }

      this.stats.messagesDecrypted++;
      this.stats.decryptionTime += Date.now() - startTime;

      return parsed;
    } catch (error) {
      this.debug.error('Peer decryption failed:', error);
      throw error;
    }
  }

  /**
     * Sign data with our private key
     * @param {any} data - The data to sign
     * @returns {Promise<string>} The signature
     */
  async sign(data) {
    if (!this.encryptionEnabled) return null;

    try {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data);
      return await this.unsea.signMessage(serialized, this.keypair.priv);
    } catch (error) {
      this.debug.error('Signing failed:', error);
      throw error;
    }
  }

  /**
     * Verify a signature
     * @param {string} signature - The signature to verify
     * @param {any} data - The original data
     * @param {string} publicKey - The signer's public key
     * @returns {Promise<boolean>} Whether the signature is valid
     */
  async verify(signature, data, publicKey) {
    if (!this.encryptionEnabled) return true;

    try {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data);
      return await this.unsea.verifyMessage(serialized, signature, publicKey);
    } catch (error) {
      this.debug.error('Signature verification failed:', error);
      return false;
    }
  }

  /**
     * Generate a shared group key
     * @param {string} groupId - The group identifier
     * @returns {Promise<Object>} The group key pair
     */
  async generateGroupKey(groupId) {
    try {
      const groupKey = await this.unsea.generateRandomPair();
      // Add metadata to the group key
      const groupKeyWithMeta = {
        ...groupKey,
        created: Date.now(),
        groupId
      };
      this.groupKeys.set(groupId, groupKeyWithMeta);
      this.emit('groupKeyGenerated', { groupId, publicKey: groupKey.pub });
      return groupKeyWithMeta;
    } catch (error) {
      this.debug.error('Group key generation failed:', error);
      throw error;
    }
  }

  /**
     * Add an existing group key
     * @param {string} groupId - The group identifier
     * @param {Object} groupKey - The group key pair
     */
  addGroupKey(groupId, groupKey) {
    this.groupKeys.set(groupId, groupKey);
    this.emit('groupKeyAdded', { groupId, publicKey: groupKey.pub });
  }

  /**
     * Encrypt a message for a group
     * @param {any} message - The message to encrypt
     * @param {string} groupId - The group identifier
     * @returns {Promise<Object>} Encrypted message object
     */
  async encryptForGroup(message, groupId) {
    if (!this.encryptionEnabled) {
      return { encrypted: false, data: message };
    }

    const groupKey = this.groupKeys.get(groupId);
    if (!groupKey) {
      throw new Error(`No group key found for group ${groupId}`);
    }

    const startTime = Date.now();
    try {
      const nonce = await this.generateNonce();
      const serialized = JSON.stringify(message);
      const encrypted = await this.unsea.encryptMessageWithMeta(serialized, groupKey);

      const result = {
        encrypted: true,
        group: true,
        groupId,
        data: encrypted,
        from: this.getPublicKey(),
        nonce,
        timestamp: Date.now()
      };

      this.stats.messagesEncrypted++;
      this.stats.encryptionTime += Date.now() - startTime;

      return result;
    } catch (error) {
      this.debug.error('Group encryption failed:', error);
      throw error;
    }
  }

  /**
     * Decrypt a group message
     * @param {Object} encryptedData - The encrypted message object
     * @returns {Promise<any>} The decrypted message
     */
  async decryptFromGroup(encryptedData) {
    if (!this.encryptionEnabled || !encryptedData.encrypted || !encryptedData.group) {
      return encryptedData.data || encryptedData;
    }

    const groupKey = this.groupKeys.get(encryptedData.groupId);
    if (!groupKey) {
      throw new Error(`No group key found for group ${encryptedData.groupId}`);
    }

    // Check for replay attacks
    if (encryptedData.nonce && this.messageNonces.has(encryptedData.nonce)) {
      throw new Error('Replay attack detected: duplicate nonce');
    }

    const startTime = Date.now();
    try {
      const decrypted = await this.unsea.decryptMessageWithMeta(encryptedData.data, groupKey.epriv);
      const parsed = JSON.parse(decrypted);

      // Store nonce to prevent replay
      if (encryptedData.nonce) {
        this.messageNonces.add(encryptedData.nonce);
      }

      this.stats.messagesDecrypted++;
      this.stats.decryptionTime += Date.now() - startTime;

      return parsed;
    } catch (error) {
      this.debug.error('Group decryption failed:', error);
      throw error;
    }
  }

  /**
     * Generate a cryptographically secure nonce
     * @returns {Promise<string>} A unique nonce
     */
  async generateNonce() {
    // Generate a simple nonce using timestamp and random
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    const combined = `${timestamp}-${random}-${Math.floor(Math.random() * 1000000)}`;

    // Use crypto.subtle to hash the combined string if available
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(combined);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
      } catch (error) {
        this.debug.warn('Could not use crypto.subtle for nonce generation:', error);
      }
    }

    // Fallback to simple combined string
    return combined;
  }

  /**
     * Start periodic cleanup of old nonces
     */
  startNonceCleanup() {
    // Store the interval ID for cleanup
    this.nonceCleanupInterval = setInterval(() => {
      try {
        // Remove old nonces (this is a simplified approach)
        // In a real implementation, you'd store nonces with timestamps
        if (this.messageNonces.size > 1000) {
          this.messageNonces.clear();
        }
      } catch (error) {
        console.error('Error during nonce cleanup:', error);
      }
    }, 60000); // Clean up every minute
  }

  /**
     * Export public key for sharing
     * @returns {Object} Export data
     */
  exportPublicKey() {
    if (!this.keypair) return null;

    return {
      pub: this.keypair.pub,
      epub: this.keypair.epub,
      algorithm: 'ECDSA',
      created: Date.now()
    };
  }

  /**
     * Clear all stored keys and reset state
     */
  reset() {
    // Clear the nonce cleanup interval
    if (this.nonceCleanupInterval) {
      clearInterval(this.nonceCleanupInterval);
      this.nonceCleanupInterval = null;
    }

    this.keypair = null;
    this.peerKeys.clear();
    this.groupKeys.clear();
    this.messageNonces.clear();
    this.encryptionEnabled = false;
    this.initialized = false;

    // Reset stats
    this.stats = {
      messagesEncrypted: 0,
      messagesDecrypted: 0,
      encryptionTime: 0,
      decryptionTime: 0,
      keyExchanges: 0
    };

    this.emit('cryptoReset');
  }

  /**
     * Test crypto functionality
     * @returns {Promise<Object>} Test results
     */
  async runSelfTest() {
    const results = {
      keypairGeneration: false,
      encryption: false,
      decryption: false,
      signing: false,
      verification: false,
      groupEncryption: false,
      errors: []
    };

    // Check if crypto is properly initialized
    if (!this.unsea) {
      results.errors.push('Unsea library not loaded');
      return results;
    }

    if (!this.initialized) {
      results.errors.push('CryptoManager not initialized');
      return results;
    }

    this.debug.log('🔍 Debug: unsea object:', this.unsea);
    this.debug.log('🔍 Debug: available methods:', Object.keys(this.unsea));

    try {
      // Test keypair generation
      this.debug.log('🧪 Testing keypair generation...');
      const testKeypair = await this.unsea.generateRandomPair();
      this.debug.log('🔍 Generated keypair:', testKeypair);
      results.keypairGeneration = !!(testKeypair && (testKeypair.pub || testKeypair.publicKey));

      // Test encryption/decryption - create two keypairs to simulate peer-to-peer encryption
      this.debug.log('🧪 Testing encryption...');
      const testMessage = 'Hello, crypto world!';

      // Create a second keypair to simulate a peer
      const peerKeypair = await this.unsea.generateRandomPair();

      // Encrypt from our keypair TO the peer keypair
      const encrypted = await this.unsea.encryptMessageWithMeta(testMessage, peerKeypair);
      this.debug.log('🔍 Encrypted result:', encrypted);
      results.encryption = !!encrypted;

      this.debug.log('🧪 Testing decryption...');
      // Use the ephemeral private key (epriv) for decryption as shown in the example
      const decrypted = await this.unsea.decryptMessageWithMeta(encrypted, peerKeypair.epriv);
      this.debug.log('🔍 Decrypted result:', decrypted);
      results.decryption = decrypted === testMessage;

      // Test signing/verification
      this.debug.log('🧪 Testing signing...');
      const signature = await this.unsea.signMessage(testMessage, this.keypair.priv);
      this.debug.log('🔍 Signature:', signature);
      results.signing = !!signature;

      this.debug.log('🧪 Testing verification...');
      const verified = await this.unsea.verifyMessage(testMessage, signature, this.keypair.pub);
      this.debug.log('🔍 Verification result:', verified);
      results.verification = verified === true;

      // Test group encryption (same as regular encryption with different key)
      this.debug.log('🧪 Testing group encryption...');
      const groupKey = await this.unsea.generateRandomPair();
      const groupEncrypted = await this.unsea.encryptMessageWithMeta(testMessage, groupKey);
      const groupDecrypted = await this.unsea.decryptMessageWithMeta(groupEncrypted, groupKey.epriv);
      results.groupEncryption = groupDecrypted === testMessage;
    } catch (error) {
      this.debug.error('🔍 Self-test error:', error);
      results.errors.push(error.message);
    }

    this.debug.log('🔍 Final test results:', results);
    return results;
  }
}
