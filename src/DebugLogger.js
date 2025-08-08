/**
 * Debug Logger - Configurable debugging system for PeerPigeon
 *
 * Provides centralized control over console logging with module-specific enable/disable
 * functionality. Default is disabled to prevent console noise in production.
 *
 * Usage:
 *   const debug = DebugLogger.create('ModuleName');
 *   debug.log('This will only show if enabled');
 *   debug.warn('Warnings can be controlled separately');
 *   debug.error('Errors can be controlled separately');
 *
 * Configuration:
 *   DebugLogger.enable('ModuleName');  // Enable specific module
 *   DebugLogger.enableAll();          // Enable all modules
 *   DebugLogger.disable('ModuleName'); // Disable specific module
 *   DebugLogger.disableAll();         // Disable all modules (default)
 */

class DebugLogger {
  static moduleStates = new Map();
  static globalEnabled = false;
  static defaultEnabled = false; // Default is disabled

  /**
   * Create a debug logger for a specific module
   * @param {string} moduleName - Name of the module (e.g., 'GossipManager', 'PeerConnection')
   * @returns {Object} Debug logger with log/warn/error methods
   */
  static create(moduleName) {
    // Initialize module state if not exists
    if (!this.moduleStates.has(moduleName)) {
      this.moduleStates.set(moduleName, this.defaultEnabled);
    }

    return {
      /**
       * Debug log - for general debugging information
       * @param {...any} args - Arguments to log
       */
      log: (...args) => {
        if (this.isEnabled(moduleName)) {
          console.log(`[${moduleName}]`, ...args);
        }
      },

      /**
       * Debug warn - for warnings
       * @param {...any} args - Arguments to log
       */
      warn: (...args) => {
        if (this.isEnabled(moduleName)) {
          console.warn(`[${moduleName}]`, ...args);
        }
      },

      /**
       * Debug error - for errors
       * @param {...any} args - Arguments to log
       */
      error: (...args) => {
        if (this.isEnabled(moduleName)) {
          console.error(`[${moduleName}]`, ...args);
        }
      },

      /**
       * Debug info - alias for log
       * @param {...any} args - Arguments to log
       */
      info: (...args) => {
        if (this.isEnabled(moduleName)) {
          console.info(`[${moduleName}]`, ...args);
        }
      },

      /**
       * Debug debug - alias for log
       * @param {...any} args - Arguments to log
       */
      debug: (...args) => {
        if (this.isEnabled(moduleName)) {
          console.debug(`[${moduleName}]`, ...args);
        }
      }
    };
  }

  /**
   * Check if debugging is enabled for a module
   * @param {string} moduleName - Module name to check
   * @returns {boolean} True if enabled
   */
  static isEnabled(moduleName) {
    if (this.globalEnabled) return true;
    return this.moduleStates.get(moduleName) || false;
  }

  /**
   * Enable debugging for a specific module
   * @param {string} moduleName - Module name to enable
   */
  static enable(moduleName) {
    this.moduleStates.set(moduleName, true);
  }

  /**
   * Disable debugging for a specific module
   * @param {string} moduleName - Module name to disable
   */
  static disable(moduleName) {
    this.moduleStates.set(moduleName, false);
  }

  /**
   * Enable debugging for all modules
   */
  static enableAll() {
    this.globalEnabled = true;
  }

  /**
   * Disable debugging for all modules
   */
  static disableAll() {
    this.globalEnabled = false;
    // Reset all module states to false
    for (const [moduleName] of this.moduleStates) {
      this.moduleStates.set(moduleName, false);
    }
  }

  /**
   * Enable debugging for multiple modules
   * @param {string[]} moduleNames - Array of module names to enable
   */
  static enableModules(moduleNames) {
    for (const moduleName of moduleNames) {
      this.enable(moduleName);
    }
  }

  /**
   * Disable debugging for multiple modules
   * @param {string[]} moduleNames - Array of module names to disable
   */
  static disableModules(moduleNames) {
    for (const moduleName of moduleNames) {
      this.disable(moduleName);
    }
  }

  /**
   * Get the current state of all modules
   * @returns {Object} Object with module names as keys and enabled state as values
   */
  static getState() {
    const state = {};
    for (const [moduleName, enabled] of this.moduleStates) {
      state[moduleName] = enabled;
    }
    return {
      globalEnabled: this.globalEnabled,
      modules: state
    };
  }

  /**
   * Configure debugging from an options object
   * @param {Object} options - Configuration options
   * @param {boolean} [options.enableAll] - Enable all modules
   * @param {boolean} [options.disableAll] - Disable all modules
   * @param {string[]} [options.enable] - Array of module names to enable
   * @param {string[]} [options.disable] - Array of module names to disable
   */
  static configure(options = {}) {
    if (options.disableAll) {
      this.disableAll();
    }

    if (options.enableAll) {
      this.enableAll();
    }

    if (options.enable && Array.isArray(options.enable)) {
      this.enableModules(options.enable);
    }

    if (options.disable && Array.isArray(options.disable)) {
      this.disableModules(options.disable);
    }
  }

  /**
   * Get list of all known modules
   * @returns {string[]} Array of module names
   */
  static getModules() {
    return Array.from(this.moduleStates.keys()).sort();
  }
}

// ES6 export
export default DebugLogger;
