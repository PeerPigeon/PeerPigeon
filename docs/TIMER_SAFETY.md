# Timer Safety Notes

## Issue: Illegal Invocation with Wrapped Timer Functions

If you see errors like "Illegal invocation" when using `setInterval` or `setTimeout`, it's likely because a debugging tool or memory leak detector is wrapping these global functions and changing their context.

## Solution: TimerUtils.js

We've created `TimerUtils.js` that stores references to the original timer functions before they can be wrapped:

```javascript
import { safeSetInterval, safeClearInterval, safeSetTimeout, safeClearTimeout } from './TimerUtils.js';

// Use these instead of global timer functions
const intervalId = safeSetInterval(() => {}, 1000);
safeClearInterval(intervalId);

const timeoutId = safeSetTimeout(() => {}, 1000);
safeClearTimeout(timeoutId);
```

## Files Using Safe Timers

- `WebDHT.js` - Main DHT maintenance and timeouts
- `SignalingClient.js` - Keep-alive and health monitoring
- `GossipManager.js` - Message cleanup
- `PeerDiscovery.js` - Peer cleanup
- `ConnectionManager.js` - Connection cleanup
- `PeerPigeonMesh.js` - Connection monitoring

## Memory Leak Debugging

If you need to debug memory leaks, avoid wrapping global timer functions. Instead:

1. Use browser dev tools Memory tab
2. Use `performance.measureUserAgentSpecificMemory()` if available
3. Monitor object creation/destruction patterns
4. Use the browser's built-in memory profiling tools
