/**
 * PersistentStorageAdapter - Provides persistent storage across different environments
 *
 * - Browser: Uses IndexedDB for persistence
 * - Node.js: Uses filesystem for persistence
 * - Fallback: In-memory storage with no persistence
 */

import DebugLogger from './DebugLogger.js';

export class PersistentStorageAdapter {
  constructor(options = {}) {
    this.debug = DebugLogger.create('PersistentStorageAdapter');
    this.dbName = options.dbName || 'peerpigeon-storage';
    this.dbVersion = options.dbVersion || 1;
    this.storeName = options.storeName || 'keyvalue';
    this.dataDir = options.dataDir || './peerpigeon-data';

    this.db = null;
    this.storage = new Map(); // Fallback in-memory storage
    this.isReady = false;
    this.storageType = 'memory'; // 'indexeddb', 'filesystem', or 'memory'

    this.initialize();
  }

  async initialize() {
    try {
      // Detect environment
      const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
      const isBrowser = !isNode && typeof window !== 'undefined' && typeof document !== 'undefined';

      if (isBrowser && typeof indexedDB !== 'undefined') {
        await this.initializeIndexedDB();
        this.storageType = 'indexeddb';
      } else if (isNode) {
        await this.initializeFilesystem();
        this.storageType = 'filesystem';
      } else {
        this.debug.warn('No persistent storage available, using in-memory storage');
        this.storageType = 'memory';
      }

      this.isReady = true;
      this.debug.log(`Persistent storage initialized: ${this.storageType}`);
    } catch (error) {
      this.debug.error('Failed to initialize persistent storage:', error);
      this.storageType = 'memory';
      this.isReady = true;
    }
  }

  async initializeIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.debug.log('IndexedDB initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          this.debug.log('IndexedDB object store created');
        }
      };
    });
  }

  async initializeFilesystem() {
    try {
      // Dynamic import for Node.js modules
      const { promises: fs } = await import('fs');
      const path = await import('path');

      // Store references for later use
      this.fs = fs;
      this.path = path;

      await fs.mkdir(this.dataDir, { recursive: true });
      this.debug.log(`Filesystem storage directory created: ${this.dataDir}`);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async waitForReady() {
    // No waiting - proceed immediately regardless of ready state
  }

  async set(key, value, metadata = {}) {
    await this.waitForReady();

    const record = {
      key,
      value,
      timestamp: Date.now(),
      ...metadata
    };

    try {
      switch (this.storageType) {
        case 'indexeddb':
          return await this.setIndexedDB(record);
        case 'filesystem':
          return await this.setFilesystem(record);
        default:
          this.storage.set(key, record);
          return true;
      }
    } catch (error) {
      this.debug.error(`Failed to set key ${key}:`, error);
      // Fallback to memory storage
      this.storage.set(key, record);
      return true;
    }
  }

  async get(key) {
    await this.waitForReady();

    try {
      switch (this.storageType) {
        case 'indexeddb':
          return await this.getIndexedDB(key);
        case 'filesystem':
          return await this.getFilesystem(key);
        default: {
          const record = this.storage.get(key);
          return record ? record.value : null;
        }
      }
    } catch (error) {
      this.debug.error(`Failed to get key ${key}:`, error);
      // Fallback to memory storage
      const record = this.storage.get(key);
      return record ? record.value : null;
    }
  }

  async delete(key) {
    await this.waitForReady();

    try {
      switch (this.storageType) {
        case 'indexeddb':
          return await this.deleteIndexedDB(key);
        case 'filesystem':
          return await this.deleteFilesystem(key);
        default:
          return this.storage.delete(key);
      }
    } catch (error) {
      this.debug.error(`Failed to delete key ${key}:`, error);
      // Fallback to memory storage
      return this.storage.delete(key);
    }
  }

  async keys() {
    await this.waitForReady();

    try {
      switch (this.storageType) {
        case 'indexeddb':
          return await this.keysIndexedDB();
        case 'filesystem':
          return await this.keysFilesystem();
        default:
          return Array.from(this.storage.keys());
      }
    } catch (error) {
      this.debug.error('Failed to get keys:', error);
      return Array.from(this.storage.keys());
    }
  }

  async clear() {
    await this.waitForReady();

    try {
      switch (this.storageType) {
        case 'indexeddb':
          return await this.clearIndexedDB();
        case 'filesystem':
          return await this.clearFilesystem();
        default:
          this.storage.clear();
          return true;
      }
    } catch (error) {
      this.debug.error('Failed to clear storage:', error);
      this.storage.clear();
      return true;
    }
  }

  // IndexedDB implementation
  async setIndexedDB(record) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(record);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async getIndexedDB(key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result;
        resolve(record ? record.value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteIndexedDB(key) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async keysIndexedDB() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clearIndexedDB() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // Filesystem implementation
  getFilePath(key) {
    // Sanitize key for filesystem
    const sanitized = key.replace(/[^a-zA-Z0-9-_.:]/g, '_');
    return this.path.join(this.dataDir, `${sanitized}.json`);
  }

  async setFilesystem(record) {
    const filePath = this.getFilePath(record.key);
    await this.fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
    return true;
  }

  async getFilesystem(key) {
    try {
      const filePath = this.getFilePath(key);
      const data = await this.fs.readFile(filePath, 'utf8');
      const record = JSON.parse(data);
      return record.value;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // File doesn't exist
      }
      throw error;
    }
  }

  async deleteFilesystem(key) {
    try {
      const filePath = this.getFilePath(key);
      await this.fs.unlink(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true; // File doesn't exist, consider it deleted
      }
      throw error;
    }
  }

  async keysFilesystem() {
    try {
      const files = await this.fs.readdir(this.dataDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', '').replace(/_/g, '/')) // Reverse sanitization
        .filter(key => key); // Remove empty keys
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // Directory doesn't exist
      }
      throw error;
    }
  }

  async clearFilesystem() {
    try {
      const files = await this.fs.readdir(this.dataDir);
      const deletePromises = files
        .filter(file => file.endsWith('.json'))
        .map(file => this.fs.unlink(this.path.join(this.dataDir, file)));

      await Promise.all(deletePromises);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true; // Directory doesn't exist
      }
      throw error;
    }
  }

  // Utility methods
  getStorageType() {
    return this.storageType;
  }

  async getStats() {
    await this.waitForReady();

    const keys = await this.keys();
    let totalSize = 0;

    // Estimate total size (rough calculation)
    for (const key of keys) {
      const value = await this.get(key);
      if (value) {
        totalSize += JSON.stringify(value).length;
      }
    }

    return {
      type: this.storageType,
      keys: keys.length,
      estimatedSize: totalSize,
      isReady: this.isReady
    };
  }
}
