# Local Testing Guide

## WebRTC Local Connection Requirements

When testing PeerPigeon locally (localhost), **WebRTC connections require media permissions** due to browser security restrictions.

### Why This Happens

Chrome and other browsers restrict ICE candidate gathering (especially mDNS/local network discovery) unless:

1. **Media permissions are granted** (microphone or camera access)
2. **TURN server is configured** for relaying connections
3. **Connection is over HTTPS** (not applicable for localhost)

### Solution: Grant Media Permissions

Before testing peer connections locally:

#### Option 1: Use the Media Tab
1. Open the browser example at `http://localhost:8080/`
2. Go to the **"Media"** tab
3. Click **"Start Media"** button
4. Allow microphone/camera access when prompted
5. Now peer connections will work!

#### Option 2: Manual Permission Grant
1. Open Chrome settings: `chrome://settings/content/microphone`
2. Add `http://localhost:8080` to allowed sites
3. Refresh the page

### Symptoms of Missing Permissions

If you see these symptoms, you need to grant media permissions:

- ✅ Peers discover each other
- ✅ Offers and answers are exchanged
- ✅ ICE candidates are being sent
- ❌ Connection fails after 15-30 seconds
- ❌ Console shows "connection failed" or "ICE failed"

### Why Only Local Testing?

This issue **only affects localhost testing**. In production:
- HTTPS automatically enables WebRTC without media permissions
- Public STUN/TURN servers handle NAT traversal
- Connections work normally without requiring media access

### Alternative: Use TURN Server

Configure a TURN server for local testing without media:

```javascript
const mesh = new PeerPigeon.PeerPigeonMesh({
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: 'turn:your-turn-server.com:3478',
            username: 'user',
            credential: 'pass'
        }
    ]
});
```

### Quick Test Script

Run this in the browser console to test if you have the necessary permissions:

```javascript
// Test media permissions
navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(() => console.log('✅ Media permissions granted - connections will work'))
    .catch(() => console.log('❌ Media permissions denied - connections may fail on localhost'));
```

## Testing Workflow

### Recommended Testing Flow

1. **Start the servers:**
   ```bash
   npm run dev
   ```

2. **Open two browser tabs:**
   - Tab 1: `http://localhost:8080/`
   - Tab 2: `http://localhost:8080/`

3. **Grant media permissions in BOTH tabs:**
   - Click "Media" tab
   - Click "Start Media"
   - Allow microphone access
   - You can mute/stop after permissions are granted

4. **Connect to the signaling server:**
   - Click "Connect" button in Connection tab
   - Wait for "Connected to signaling server" message

5. **Watch peers connect automatically:**
   - Peers will discover each other
   - Connections should establish within 2-3 seconds
   - Check "Connected Peers" section

### Production Deployment

For production deployment on HTTPS, media permissions are **not required** for data-only connections. WebRTC works normally with just signaling.

## Troubleshooting

### Connection Still Fails After Granting Media

1. **Check browser console** for detailed errors
2. **Verify signaling server** is running (`ws://localhost:3000`)
3. **Check ICE candidates** are being generated (look for host candidates)
4. **Try reloading** both browser tabs

### ICE Candidates Not Generated

If you don't see any ICE candidates with `typ host`:
- Media permissions were not granted
- Browser is blocking local network discovery
- Try using a TURN server

### Firewall Issues

Even on localhost, some corporate firewalls block WebRTC:
- Try disabling firewall temporarily
- Check if WebRTC is blocked by enterprise policy
- Test on a different network

## Reference Links

- [WebRTC Security](https://webrtc-security.github.io/)
- [ICE Candidate Gathering](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/icecandidate_event)
- [Chrome WebRTC Permissions](https://developer.chrome.com/docs/web-platform/webrtc-permissions)
