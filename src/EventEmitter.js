export class EventEmitter {
  constructor() {
    this.eventListeners = {};
  }

  addEventListener(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  removeEventListener(event, callback) {
    if (this.eventListeners[event]) {
      const index = this.eventListeners[event].indexOf(callback);
      if (index > -1) {
        this.eventListeners[event].splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach(callback => callback(data));
    }
  }

  // Standard Node.js EventEmitter compatible methods
  
  /**
   * Add event listener (alias for addEventListener)
   * @param {string} event - Event name
   * @param {Function} callback - Event handler
   * @returns {EventEmitter} Returns this for chaining
   */
  on(event, callback) {
    this.addEventListener(event, callback);
    return this;
  }

  /**
   * Remove event listener (alias for removeEventListener)
   * @param {string} event - Event name
   * @param {Function} callback - Event handler to remove
   * @returns {EventEmitter} Returns this for chaining
   */
  off(event, callback) {
    this.removeEventListener(event, callback);
    return this;
  }

  /**
   * Add one-time event listener
   * @param {string} event - Event name
   * @param {Function} callback - Event handler
   * @returns {EventEmitter} Returns this for chaining
   */
  once(event, callback) {
    const onceWrapper = (data) => {
      callback(data);
      this.removeEventListener(event, onceWrapper);
    };
    this.addEventListener(event, onceWrapper);
    return this;
  }

  /**
   * Remove all listeners for an event, or all listeners if no event specified
   * @param {string} [event] - Event name (optional)
   * @returns {EventEmitter} Returns this for chaining
   */
  removeAllListeners(event) {
    if (event) {
      delete this.eventListeners[event];
    } else {
      this.eventListeners = {};
    }
    return this;
  }

  /**
   * Get array of listeners for an event
   * @param {string} event - Event name
   * @returns {Function[]} Array of listeners
   */
  listeners(event) {
    return this.eventListeners[event] ? [...this.eventListeners[event]] : [];
  }

  /**
   * Get count of listeners for an event
   * @param {string} event - Event name
   * @returns {number} Number of listeners
   */
  listenerCount(event) {
    return this.eventListeners[event] ? this.eventListeners[event].length : 0;
  }

  /**
   * Get array of event names that have listeners
   * @returns {string[]} Array of event names
   */
  eventNames() {
    return Object.keys(this.eventListeners);
  }
}
