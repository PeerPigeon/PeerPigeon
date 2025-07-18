/**
 * Timer utilities to handle cases where global setInterval/setTimeout might be wrapped
 * by debugging tools, preventing "Illegal invocation" errors.
 */

// Store original timer functions to avoid issues with wrapped functions
const originalSetInterval = window.setInterval;
const originalSetTimeout = window.setTimeout;
const originalClearInterval = window.clearInterval;
const originalClearTimeout = window.clearTimeout;

/**
 * Safe setInterval that uses the original function to avoid context issues
 * @param {Function} callback - Function to execute
 * @param {number} delay - Delay in milliseconds
 * @returns {number} - Interval ID
 */
export function safeSetInterval(callback, delay) {
    return originalSetInterval.call(window, callback, delay);
}

/**
 * Safe setTimeout that uses the original function to avoid context issues
 * @param {Function} callback - Function to execute
 * @param {number} delay - Delay in milliseconds
 * @returns {number} - Timeout ID
 */
export function safeSetTimeout(callback, delay) {
    return originalSetTimeout.call(window, callback, delay);
}

/**
 * Safe clearInterval that uses the original function
 * @param {number} id - Interval ID to clear
 */
export function safeClearInterval(id) {
    return originalClearInterval.call(window, id);
}

/**
 * Safe clearTimeout that uses the original function
 * @param {number} id - Timeout ID to clear
 */
export function safeClearTimeout(id) {
    return originalClearTimeout.call(window, id);
}
