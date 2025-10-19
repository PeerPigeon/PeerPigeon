# WebRTC ICE Debugging Guide for Browser-2

## Current Issue

Peers are discovering each other through signaling but ICE negotiation is failing, preventing WebRTC connections from establishing.

## Symptoms

- ✅ Signaling works (peers discover each other)
- ✅ Offers/answers are exchanged
- ❌ ICE candidates fail
- ❌ No peer connections establish

## Key Differences: Vanilla vs Vue/Vite

### Vanilla Browser Example
- **Protocol**: Could be `file://` or `http://`
- **No HMR**: No WebSocket conflicts
- **No Proxy**: Direct WebRTC access
- **Works perfectly**

### Vue/Vite Example (browser-2)
- **Protocol**: `http://localhost:5173`
- **HMR Active**: Vite's WebSocket on port 5173
- **Dev Server**: Vite's middleware
- **ICE Failing**

## Possible Causes

### 1. Mixed Content Issues
If signaling server is `ws://` but page is `https://`, browsers block it.
- **Check**: Is your signaling server `ws://` or `wss://`?
- **Solution**: Match protocols (both HTTP + WS or both HTTPS + WSS)

### 2. Firefox Strict Networking
Firefox has stricter WebRTC policies than Chrome.
- **Check**: Does it work in Chrome?
- **Solution**: May need TURN server for Firefox

### 3. Vite HMR WebSocket Conflict
Vite's HMR uses WebSocket on same origin, might interfere.
- **Check**: Disable HMR temporarily
- **Solution**: Different ports or disable HMR

### 4. CORS/Headers
Vite might be setting headers that interfere with WebRTC.
- **Check**: Browser console for CORS errors
- **Solution**: Adjust Vite server headers

### 5. Network Topology
Your local network might require TURN for relay.
- **Check**: Are you behind a restrictive firewall/NAT?
- **Solution**: Add TURN server configuration

## Debug Steps

### Step 1: Check Signaling Server Protocol

```bash
# Check what's running
lsof -i :3000
```

Look for: Is it HTTP or HTTPS?

### Step 2: Try in Chrome

Open http://localhost:5173 in Chrome instead of Firefox.
- If it works: Firefox-specific issue
- If it fails: General Vite/Vue issue

### Step 3: Check about:webrtc in Firefox

1. Open new tab
2. Go to `about:webrtc`
3. Look at "Connection Log"
4. Find your peer connection attempts
5. Look for ICE candidate failures

Common issues shown:
- No host candidates (firewall blocking)
- No srflx candidates (STUN server issues)
- No relay candidates (need TURN server)

### Step 4: Test Without Vite

Build for production and serve with simple HTTP server:

```bash
npm run build
cd dist
python3 -m http.server 8080
```

Open http://localhost:8080
- If it works: Vite dev server issue
- If it fails: Build/configuration issue

### Step 5: Compare Working vs Failing

Open both at the same time:
1. **Vanilla browser example** (working)
2. **Vue browser-2** (failing)

Check in browser DevTools Network tab:
- Are WebSocket connections the same?
- Are there different security warnings?
- Are ICE candidates different?

## Quick Test Commands

```bash
# Build and test without Vite dev server
cd /path/to/PeerPigeon/examples/browser-2
npm run build
cd dist
python3 -m http.server 8080
# Open http://localhost:8080 in browser

# Check if signaling server is running
curl http://localhost:3000/health || echo "Signaling server not running"

# Test in different browsers
open -a "Google Chrome" http://localhost:5173
open -a "Firefox" http://localhost:5173
open -a "Safari" http://localhost:5173
```

## Temporary Workarounds

### Workaround 1: Use Production Build

```bash
npm run build
npm run preview
# Opens on different port without HMR
```

### Workaround 2: Disable HMR

Add to `vite.config.js`:
```javascript
export default defineConfig({
  server: {
    hmr: false  // Disable HMR
  }
});
```

### Workaround 3: Add TURN Server

If you have access to a TURN server, configure PeerPigeon to use it.
(Check PeerPigeon docs for ICE server configuration)

## Expected Behavior

When working correctly, you should see in console:
```
🔍 PEER DISCOVERED EVENT
🤝 PEER CONNECTED EVENT  ← This is missing!
```

Currently seeing:
```
🔍 PEER DISCOVERED EVENT  ✅
👋 PEER DISCONNECTED EVENT (ICE failed)  ❌
```

## Next Steps

Please run the **Step 4** test (build + simple HTTP server) and let me know if that works. This will tell us if it's specifically a Vite dev server issue.
