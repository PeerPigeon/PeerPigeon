# PeerPigeon Minimal Browser Test

This is a stripped-down version of PeerPigeon designed for testing browser-to-browser connections with minimal complexity.

## Features Enabled
- ✅ Basic peer connections
- ✅ Data channel establishment  
- ✅ Encryption and key exchange
- ✅ Simple messaging
- ✅ Peer discovery

## Features Disabled
- ❌ WebDHT (distributed hash table)
- ❌ Distributed storage
- ❌ Media streams
- ❌ Complex routing
- ❌ Eviction strategies

## How to Test Browser-to-Browser Connections

1. **Start the signaling server:**
   ```bash
   cd /Users/danraeder/Documents/GitHub/peerpigeon
   node websocket-server/server.js
   ```

2. **Open two browser tabs:**
   - Tab 1: Open `index.html` in this directory
   - Tab 2: Open `index.html` in another tab (same file)

3. **Connect both instances:**
   - Click "Connect" in both tabs
   - Both should show "Connected to signaling"
   - Watch for peer discovery and connection events

4. **Test messaging:**
   - Once peers are connected, click "Send Test Message"
   - Message should appear in both browser logs

## Debugging

- Open browser console (F12) for detailed logging
- Use `window.mesh()` in console to inspect mesh state
- Use `window.minimalPeer` to access the main instance

## Expected Behavior

If browser-to-browser connections work properly:
1. Both tabs connect to signaling server
2. Peers discover each other
3. WebRTC data channels establish successfully
4. Key exchange completes
5. Messages can be sent between browsers

If connections fail, the logs will show where the process breaks down.
