/**
 * Timer utilities to handle cases where global setInterval/setTimeout might be wrapped
 * by debugging tools, preventing "Illegal invocation" errors.
 */

import { environmentDetector } from './EnvironmentDetector.js';
import DebugLogger from './DebugLogger.js';

// Store original timer functions to avoid issues with wrapped functions
let originalSetInterval, originalSetTimeout, originalClearInterval, originalClearTimeout;

if (environmentDetector.isBrowser) {
  originalSetInterval = window.setInterval;
  originalSetTimeout = window.setTimeout;
  originalClearInterval = window.clearInterval;
  originalClearTimeout = window.clearTimeout;
} else {
  // In Node.js or other environments, use global functions
  originalSetInterval = setInterval;
  originalSetTimeout = setTimeout;
  originalClearInterval = clearInterval;
  originalClearTimeout = clearTimeout;
}

/**
 * Safe setInterval that uses the original function to avoid context issues
 * @param {Function} callback - Function to execute
 * @param {number} delay - Delay in milliseconds
 * @returns {number} - Interval ID
 */
export function safeSetInterval(callback, delay) {
  if (environmentDetector.isBrowser) {
    return originalSetInterval.call(window, callback, delay);
  } else {
    return originalSetInterval(callback, delay);
  }
}

/**
 * Safe setTimeout that uses the original function to avoid context issues
 * @param {Function} callback - Function to execute
 * @param {number} delay - Delay in milliseconds
 * @returns {number} - Timeout ID
 */
export function safeSetTimeout(callback, delay) {
  if (environmentDetector.isBrowser) {
    return originalSetTimeout.call(window, callback, delay);
  } else {
    return originalSetTimeout(callback, delay);
  }
}

/**
 * Safe clearInterval that uses the original function
 * @param {number} id - Interval ID to clear
 */
export function safeClearInterval(id) {
  if (environmentDetector.isBrowser) {
    return originalClearInterval.call(window, id);
  } else {
    return originalClearInterval(id);
  }
}

/**
 * Safe clearTimeout that uses the original function
 * @param {number} id - Timeout ID to clear
 */
export function safeClearTimeout(id) {
  if (environmentDetector.isBrowser) {
    return originalClearTimeout.call(window, id);
  } else {
    return originalClearTimeout(id);
  }
}
