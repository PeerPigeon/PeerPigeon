# Memory Leak Fixes - July 17, 2025

## Issue
User reported severe memory leaks when running 7 browser peers overnight, causing the system to run out of memory.

## Root Cause Analysis
After analyzing the codebase, several memory leak sources were identified:

### 1. SignalingClient Health Monitoring Interval Not Cleaned Up
**File**: `src/SignalingClient.js`
**Issue**: The `disconnect()` method was not calling `stopHealthMonitoring()`, leaving the health check interval running indefinitely.
**Impact**: Health monitoring interval runs every 15 seconds, accumulating memory over time.

### 2. WebSocket Event Handlers Not Cleared
**File**: `src/SignalingClient.js`  
**Issue**: WebSocket event handlers (`onopen`, `onmessage`, `onclose`, `onerror`) were not explicitly cleared when disconnecting.
**Impact**: Event handlers could potentially hold references to objects, preventing garbage collection.

### 3. GossipManager Cleanup Timer Not Cleared
**File**: `src/GossipManager.js`
**Issue**: The `startCleanupTimer()` method created a `setInterval` but the `cleanup()` method didn't clear it.
**Impact**: Cleanup interval runs every minute, accumulating memory and preventing proper cleanup.

## Fixes Applied

### 1. Fixed SignalingClient Disconnect Method
**Status**: ✅ **COMPLETED**
```javascript
disconnect() {
    // Clear reconnection state
    this.isReconnecting = false;
    if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
    }

    this.stopKeepAlive();
    this.stopHealthMonitoring(); // ✅ FIX: Added this line
    
    this.connected = false;
    this.connectionPromise = null;

    if (this.websocket) {
        // ✅ FIX: Clear event handlers to prevent memory leaks
        this.websocket.onopen = null;
        this.websocket.onmessage = null;
        this.websocket.onclose = null;
        this.websocket.onerror = null;
        
        this.websocket.close(1000, 'Client disconnect');
        this.websocket = null;
    }

    this.emit('disconnected');
}
```

### 2. Fixed GossipManager Cleanup Timer
**Status**: ✅ **COMPLETED**
```javascript
// Added cleanup timer tracking
constructor(mesh, connectionManager) {
    // ...existing code...
    this.cleanupTimer = null; // ✅ FIX: Track cleanup timer
    this.startCleanupTimer();
}

// Fixed startCleanupTimer method
startCleanupTimer() {
    if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => {
        this.cleanupExpiredMessages();
    }, this.cleanupInterval);
}

// Fixed cleanup method
cleanup() {
    // ✅ FIX: Clear the cleanup timer
    if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
    }
    this.seenMessages.clear();
    this.messageHistory.clear();
}
```

## Memory Leak Prevention Checklist

For future development, ensure all components follow these patterns:

### ✅ Intervals & Timeouts
- Always store interval/timeout IDs in instance variables
- Clear all intervals/timeouts in cleanup methods
- Use `clearInterval()` and `clearTimeout()` appropriately

### ✅ Event Handlers
- Remove event listeners in cleanup methods
- Set WebSocket event handlers to `null` when disconnecting
- Use `removeEventListener()` for DOM events

### ✅ WebSocket Connections
- Always close WebSocket connections properly
- Clear all event handlers before closing
- Set connection references to `null` after closing

### ✅ Map/Set Cleanup
- Clear all Map and Set instances in cleanup methods
- Remove references to prevent memory retention

## Summary

**All memory leak fixes have been successfully applied:**

1. ✅ **SignalingClient Health Monitoring** - Fixed `disconnect()` method to properly call `stopHealthMonitoring()`
2. ✅ **WebSocket Event Handlers** - Added explicit cleanup of WebSocket event handlers to prevent memory leaks
3. ✅ **GossipManager Cleanup Timer** - Fixed interval cleanup in `cleanup()` method

The memory leak issues should now be resolved. The system will properly clean up all intervals, timeouts, and event handlers when peers disconnect or pages are closed.

## Verification
After applying these fixes:
- All intervals and timeouts are properly cleared on disconnect
- WebSocket event handlers are explicitly nullified
- GossipManager cleanup timer is properly managed
- Memory usage should remain stable during long-running sessions

## Related Files Modified
- `src/SignalingClient.js`
- `src/GossipManager.js`