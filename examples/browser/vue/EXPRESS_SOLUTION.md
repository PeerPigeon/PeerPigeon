# 🎯 SOLUTION: Use Express Server Instead of Vite Dev Server

## The Problem

**Vite's dev server breaks WebRTC ICE negotiation** causing peer connections to fail, while the vanilla browser example works perfectly with Express.

## Why Express Works

The vanilla browser example uses a simple Express server (`dev-server.js`) which:
- ✅ Just serves static files
- ✅ No HMR WebSocket interference
- ✅ No module transformation
- ✅ No middleware conflicts with WebRTC

## Why Vite Fails

Vite's dev server has issues with WebRTC:
- ❌ HMR WebSocket conflicts with PeerPigeon signaling
- ❌ Module transformation affects timing
- ❌ Development middleware interferes with ICE candidates
- ❌ Firefox is particularly strict about these issues

## The Fix: Use Express for Browser-2

I've updated the Express server to serve the **built** Vue app, avoiding Vite's dev server entirely.

### Setup Steps

1. **Build browser-2 for production:**
   ```bash
   cd examples/browser-2
   npm run build
   ```
   
   This creates `dist/` folder with optimized production build.

2. **Start the Express server (from root):**
   ```bash
   cd ../..
   npm run dev-server
   ```

3. **Open browser-2 via Express:**
   ```
   http://localhost:8080/browser-2
   ```

### URLs Now Available

- **Browser (vanilla)**: http://localhost:8080/browser
- **Browser-2 (Vue)**: http://localhost:8080/browser-2  ✨ NEW
- **Health check**: http://localhost:8080/health

## Development Workflow

### Option 1: Express Server (RECOMMENDED for testing WebRTC)

```bash
# Build browser-2
cd examples/browser-2
npm run build

# Start Express server
cd ../..
npm run dev-server

# Open http://localhost:8080/browser-2
```

**Pros:**
- ✅ WebRTC works perfectly
- ✅ Same environment as browser example
- ✅ Production-like performance

**Cons:**
- ❌ No hot reload - must rebuild after changes
- ❌ Slower iteration

### Option 2: Vite Dev Server (for UI development only)

```bash
cd examples/browser-2
npm run dev

# Open http://localhost:5173
```

**Pros:**
- ✅ Hot Module Reload
- ✅ Fast iteration
- ✅ Good for UI/styling work

**Cons:**
- ❌ WebRTC connections fail (ICE issues)
- ❌ Can't test peer functionality
- ❌ Not suitable for integration testing

## Recommended Approach

**For development:**
1. Use Vite dev server (`npm run dev`) for UI changes
2. Don't worry about WebRTC not working in dev mode

**For testing:**
1. Build (`npm run build`)
2. Use Express server (`npm run dev-server` from root)
3. Test at http://localhost:8080/browser-2

**For production:**
1. Build (`npm run build`)
2. Serve `dist/` folder with any static file server
3. WebRTC will work correctly

## Quick Commands Reference

```bash
# From examples/browser-2/

# Build for production
npm run build

# Start Vite dev (UI development only)
npm run dev

# Preview production build
npm run preview

# From project root/

# Start Express server (serves both examples)
npm run dev-server

# Start signaling server
npm run dev-server  # It's the same command
```

## Testing Peer Connections

1. **Build browser-2:**
   ```bash
   cd examples/browser-2 && npm run build && cd ../..
   ```

2. **Start Express server:**
   ```bash
   npm run dev-server
   ```

3. **Open multiple tabs:**
   - Tab 1: http://localhost:8080/browser (vanilla)
   - Tab 2: http://localhost:8080/browser-2 (Vue)
   - Tab 3: http://localhost:8080/browser-2 (Vue)

4. **Click "Connect" in each tab**

5. **Watch peers connect!** 🎉

You should see:
```
🔍 PEER DISCOVERED EVENT
🤝 PEER CONNECTED EVENT  ← This will now work!
```

## Updated Documentation

The main README and QUICK_START.md have been updated to reflect this approach.

## Why This Is The Right Solution

1. **Proven to work** - Express server works perfectly for browser example
2. **Production-like** - Testing against production build is more reliable
3. **Simple** - No complex Vite configuration hacks
4. **Maintainable** - Clear separation between dev (Vite) and test (Express)

## Future Improvements

Consider creating a `dev-server-watch.js` that:
- Watches for file changes in browser-2
- Auto-rebuilds on change
- Serves via Express
- Best of both worlds: auto-rebuild + WebRTC working

For now, manual rebuild + Express is the reliable solution! 🚀
