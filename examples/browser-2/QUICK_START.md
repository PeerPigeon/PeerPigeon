# Quick Start Checklist

## ✅ Setup Complete!

Your browser-2 example now has comprehensive testing support just like the browser example.

## Before Running

### 1. Start the Signaling Server
```bash
# From the root PeerPigeon directory
npm run dev-server
```

The server should be running on `ws://localhost:3000`

### 2. Start the Browser-2 Dev Server
```bash
# From examples/browser-2
npm run dev
```

This will:
- Copy PeerPigeon library to public folder
- Start Vite dev server on http://localhost:5173

## Testing the Setup

### Check PeerPigeon is Loading

1. Open http://localhost:5173 in your browser
2. Look at the header - you should see:
   - **Peer ID**: Should be a real hex ID (40 characters), NOT `mock-peer-xxxxx`
   - **Status**: Should show "Disconnected" initially

3. Open browser console (F12) and check for:
   ```
   ✅ PeerPigeon loaded successfully
   ```

### Connect to Network

1. Click the **"Connect"** button in the header
2. Status should change to "Connected"
3. Peer count should show "0/4" (or similar)

### Add Another Peer

Open one of these in another browser tab/window:
- Another tab of http://localhost:5173
- The original browser example: `examples/browser/index.html`

You should see:
- Peer count increase to "1/4", "2/4", etc.
- Connected peers listed in the Network tab

### Run Tests

1. Click the **🧪 Testing** tab
2. Try a quick test:
   - Click **"Performance Test"** button
   - Watch test results appear in real-time
   - Check the metrics at the bottom

## Troubleshooting

### Problem: Mock Peer ID (`mock-peer-xxxxx`)

**Cause:** PeerPigeon library didn't load

**Solutions:**
```bash
# 1. Verify the file exists
ls public/peerpigeon-browser.js

# 2. If missing, rebuild PeerPigeon
cd ../..
npm run build

# 3. Copy to public folder
cd examples/browser-2
npm run copy-peerpigeon

# 4. Hard refresh browser (Ctrl+Shift+R)
```

### Problem: No Peers Connecting

**Causes:**
1. Signaling server not running
2. Wrong WebSocket URL
3. Only one browser tab open

**Solutions:**
```bash
# 1. Check signaling server
npm run dev-server  # from root directory

# 2. Verify URL in header
# Should be: ws://localhost:3000

# 3. Open multiple tabs
# - Open another tab of localhost:5173
# - OR open examples/browser/index.html
```

### Problem: Tests Failing

**Cause:** Not connected to network

**Solution:**
1. Click "Connect" button first
2. Wait for at least 1 peer to connect
3. Then run tests

## What Should Work Now

✅ Real PeerPigeon library loads (not mock)  
✅ Peers can connect to signaling server  
✅ Peers discover and connect to each other  
✅ All 8 feature tabs work (Network, Messaging, Media, DHT, Storage, Crypto, Debug, Testing)  
✅ Testing tab shows comprehensive test suite  
✅ Tests execute and show results  
✅ Performance metrics track correctly  
✅ Export functions work  

## Quick Demo Flow

1. **Start servers** (signaling + dev)
2. **Open browser** → http://localhost:5173
3. **Connect** → Click "Connect" button
4. **Open second tab** → Same URL
5. **Watch peers connect** → Peer count increases
6. **Try messaging** → Go to Messaging tab, send message
7. **Run tests** → Go to Testing tab, click "Performance Test"
8. **Check results** → See real-time test results and metrics

## Need Help?

Check these files:
- `README.md` - Full documentation
- `IMPLEMENTATION.md` - Technical details
- Browser console (F12) - Error messages and logs

Common console messages:
- `✅ PeerPigeon loaded successfully` - Good!
- `🔍 PeerPigeon availability: {available: true}` - Good!
- `❌ PeerPigeon not found` - Need to fix loading
- `🤝 Peer connected: abc12345...` - Peer connection working!
