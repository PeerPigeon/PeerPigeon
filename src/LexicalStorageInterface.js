import { EventEmitter } from './EventEmitter.js';
import DebugLogger from './DebugLogger.js';

/**
 * Lexical Storage Interface - GUN-like chaining API for DistributedStorageManager
 *
 * Usage:
 * const user = storage.get('users').get('alice');
 * await user.put({name: 'Alice', age: 30});
 * const name = await user.get('name').val();
 *
 * user.get('friends').set({bob: true, charlie: true});
 * user.get('friends').map().on((friend, key) => console.log(key, friend));
 */
export class LexicalStorageInterface extends EventEmitter {
  constructor(distributedStorage, path = []) {
    super();
    this.debug = DebugLogger.create('LexicalStorageInterface');
    this.storage = distributedStorage;
    this.path = path.slice(); // Create a copy of the path
    this.subscriptions = new Map();
    this._isMap = false;
  }

  /**
   * Navigate to a key (creates a new interface instance)
   * @param {string} key - The key to navigate to
   * @returns {LexicalStorageInterface} New interface for the key
   */
  get(key) {
    const newInterface = new LexicalStorageInterface(this.storage, [...this.path, key]);
    return newInterface;
  }

  /**
   * Store data at the current path
   * @param {any} value - Value to store
   * @param {Object} options - Storage options
   * @returns {Promise<LexicalStorageInterface>} This interface for chaining
   */
  async put(value, options = {}) {
    const fullKey = this.path.join(':');

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // For objects, store each property as a separate key
      const promises = Object.entries(value).map(([prop, val]) => {
        const propKey = `${fullKey}:${prop}`;
        return this.storage.store(propKey, val, options);
      });
      await Promise.all(promises);

      // Also store the object structure for reference
      await this.storage.store(fullKey, { _keys: Object.keys(value), _type: 'object' }, options);
    } else {
      // For primitives, store directly
      await this.storage.store(fullKey, value, options);
    }

    // Emit change event
    this.emit('put', { key: fullKey, value });

    return this;
  }

  /**
   * Retrieve the current value
   * @param {Object} options - Retrieval options
   * @returns {Promise<any>} The stored value
   */
  async val(options = {}) {
    const fullKey = this.path.join(':');
    const value = await this.storage.retrieve(fullKey, options);

    // If it's an object structure, reconstruct it
    if (value && typeof value === 'object' && value._keys && value._type === 'object') {
      const reconstructed = {};
      const promises = value._keys.map(async (key) => {
        const keyValue = await this.storage.retrieve(`${fullKey}:${key}`, options);
        reconstructed[key] = keyValue;
      });
      await Promise.all(promises);
      return reconstructed;
    }

    return value;
  }

  /**
   * Set multiple key-value pairs (like GUN's set)
   * @param {Object} obj - Object with key-value pairs to set
   * @param {Object} options - Storage options
   * @returns {Promise<LexicalStorageInterface>} This interface for chaining
   */
  async set(obj, options = {}) {
    const fullKey = this.path.join(':');

    // Store each entry with a unique ID
    const promises = Object.entries(obj).map(([key, value]) => {
      const setKey = `${fullKey}:${key}`;
      return this.storage.store(setKey, value, options);
    });

    await Promise.all(promises);

    // Update the set index
    const existingSet = await this.storage.retrieve(`${fullKey}:_set`) || {};
    const updatedSet = { ...existingSet, ...obj };
    await this.storage.store(`${fullKey}:_set`, updatedSet, options);

    // Emit set event
    this.emit('set', { key: fullKey, values: obj });

    return this;
  }

  /**
   * Map over a set (like GUN's map)
   * @returns {LexicalStorageInterface} New interface for mapping
   */
  map() {
    const mapInterface = new LexicalStorageInterface(this.storage, this.path);
    mapInterface._isMap = true;
    return mapInterface;
  }

  /**
   * Subscribe to changes (like GUN's on)
   * @param {Function} callback - Callback for changes
   * @returns {Function} Unsubscribe function
   */
  on(callback) {
    const fullKey = this.path.join(':');

    if (this._isMap) {
      // For maps, listen to set changes
      const setKey = `${fullKey}:_set`;

      const handleChange = async () => {
        const setData = await this.storage.retrieve(setKey);
        if (setData) {
          Object.entries(setData).forEach(([key, value]) => {
            callback(value, key);
          });
        }
      };

      // Subscribe to the set key using storage's subscription mechanism
      if (this.storage.subscribe) {
        this.storage.subscribe(setKey).then(() => {
          this.storage.on('dataUpdated', (event) => {
            if (event.key === setKey) {
              handleChange();
            }
          });
        });
      }

      // Initial call
      handleChange();

      return () => {
        if (this.storage.unsubscribe) {
          this.storage.unsubscribe(setKey);
        }
      };
    } else {
      // For regular keys, listen to direct changes
      if (this.storage.subscribe) {
        this.storage.subscribe(fullKey).then((currentValue) => {
          callback(currentValue, fullKey);
        });

        this.storage.on('dataUpdated', (event) => {
          if (event.key === fullKey) {
            this.storage.retrieve(fullKey).then(value => {
              callback(value, fullKey);
            });
          }
        });
      }

      return () => {
        if (this.storage.unsubscribe) {
          this.storage.unsubscribe(fullKey);
        }
      };
    }
  }

  /**
   * Once - listen for a single change
   * @param {Function} callback - Callback for the change
   * @returns {Promise} Promise that resolves with the value
   */
  async once(callback) {
    return new Promise((resolve) => {
      const unsubscribe = this.on((value, key) => {
        if (callback) callback(value, key);
        unsubscribe();
        resolve(value);
      });
    });
  }

  /**
   * Delete the current path
   * @returns {Promise<boolean>} Success status
   */
  async delete() {
    const fullKey = this.path.join(':');

    // If it's an object, delete all its properties first
    const value = await this.storage.retrieve(fullKey);
    if (value && typeof value === 'object' && value._keys && value._type === 'object') {
      const deletePromises = value._keys.map(key => {
        const propKey = `${fullKey}:${key}`;
        return this.storage.delete(propKey);
      });
      await Promise.all(deletePromises);
    }

    const result = await this.storage.delete(fullKey);

    // Emit delete event
    this.emit('delete', { key: fullKey });

    return result;
  }

  /**
   * Update with merge semantics
   * @param {any} value - Value to merge
   * @param {Object} options - Update options
   * @returns {Promise<LexicalStorageInterface>} This interface for chaining
   */
  async update(value, options = {}) {
    const fullKey = this.path.join(':');
    const currentValue = await this.storage.retrieve(fullKey);

    let mergedValue;
    if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
        typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)) {
      // Handle object reconstruction first
      if (currentValue._keys && currentValue._type === 'object') {
        const reconstructed = {};
        const promises = currentValue._keys.map(async (key) => {
          const keyValue = await this.storage.retrieve(`${fullKey}:${key}`, options);
          reconstructed[key] = keyValue;
        });
        await Promise.all(promises);
        mergedValue = { ...reconstructed, ...value };
      } else {
        mergedValue = { ...currentValue, ...value };
      }
    } else {
      mergedValue = value;
    }

    // Use put instead of update to ensure proper object decomposition
    await this.put(mergedValue, options);

    // Emit update event
    this.emit('update', { key: fullKey, value: mergedValue });

    return this;
  }

  /**
   * Create a proxied interface that allows property access
   * @returns {Proxy} Proxied interface
   */
  proxy() {
    return new Proxy(this, {
      get(target, prop) {
        // If it's a method, return it bound
        if (typeof target[prop] === 'function') {
          return target[prop].bind(target);
        }

        // If it's a property access, create a new get() call
        if (typeof prop === 'string' && !prop.startsWith('_') && prop !== 'constructor') {
          return target.get(prop).proxy();
        }

        return target[prop];
      }
    });
  }

  /**
   * Get the current path as a string
   * @returns {string} The path
   */
  getPath() {
    return this.path.join(':');
  }

  /**
   * Check if a value exists at the current path
   * @returns {Promise<boolean>} Whether the value exists
   */
  async exists() {
    const fullKey = this.path.join(':');
    const value = await this.storage.retrieve(fullKey);
    return value !== null && value !== undefined;
  }

  /**
   * Get all keys under the current path (for object-like structures)
   * @returns {Promise<string[]>} Array of keys
   */
  async keys() {
    const fullKey = this.path.join(':');
    const value = await this.storage.retrieve(fullKey);

    if (value && typeof value === 'object' && value._keys && value._type === 'object') {
      return value._keys;
    }

    return [];
  }
}

/**
 * Create a lexical interface for the distributed storage
 * @param {DistributedStorageManager} distributedStorage
 * @returns {Proxy} Proxied lexical interface
 */
export function createLexicalInterface(distributedStorage) {
  const lexicalInterface = new LexicalStorageInterface(distributedStorage);
  return lexicalInterface.proxy();
}
