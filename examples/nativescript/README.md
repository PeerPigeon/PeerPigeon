# NativeScript Example

This example demonstrates how to use PeerPigeon in a NativeScript application.

## Prerequisites

- NativeScript CLI installed (`npm install -g @nativescript/cli`)
- NativeScript development environment set up for your target platform (iOS/Android)
- WebRTC plugin for NativeScript (if using media features)

## Setup

1. Create a new NativeScript project:
```bash
ns create MyPeerPigeonApp --js
cd MyPeerPigeonApp
```

2. Install PeerPigeon:
```bash
npm install peerpigeon
```

3. For WebRTC support, install a WebRTC plugin:
```bash
# Example plugin (check for latest NativeScript WebRTC plugins)
ns plugin add @nativescript/webrtc
```

4. Copy the example code from `app.js` to your project's main file.

## Features Supported

- ✅ Environment detection
- ✅ WebSocket signaling (with appropriate plugin)
- ✅ Basic mesh networking
- ✅ Storage management (using NativeScript's application-settings)
- ⚠️ WebRTC (requires additional plugin)
- ⚠️ Media features (requires camera/microphone permissions)

## Platform Considerations

### Android
- Requires network permissions in `app/App_Resources/Android/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### iOS
- May require camera/microphone permissions if using media features
- Add appropriate usage descriptions in `app/App_Resources/iOS/Info.plist`

## Running the Example

```bash
# Run on iOS simulator
ns run ios

# Run on Android emulator
ns run android

# Run on physical device
ns run ios --device
ns run android --device
```

## Notes

- This example uses basic mesh networking without WebRTC
- For full WebRTC support, additional native plugins are required
- Storage uses NativeScript's application-settings module
- Network connectivity is automatically detected
