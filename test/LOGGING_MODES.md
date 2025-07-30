# Browser Integration Test - Logging Modes

## Overview
The browser integration test now supports different levels of logging verbosity to suit different needs.

## Available Commands

### 1. **Default Mode** (Full Output)
```bash
npm run test:browser
```
Shows all logging including setup steps, detailed progress, and debug information.

### 2. **Headless Mode** (Reduced Browser Output)
```bash
npm run test:browser:headless
```
Same as default but runs in headless mode (no visible browser windows).

### 3. **Quiet Mode** (Test Results Only)
```bash
npm run test:browser:quiet
```
Shows only:
- Test pass/fail status (✅/❌)
- Final test report
- Summary statistics
- Minimal setup/cleanup messages

### 4. **Verbose Mode** (Debug Output)
```bash
VERBOSE=true npm run test:browser:headless
```
Shows all logging including detailed debug information and browser console messages.

## Output Examples

### Quiet Mode Output
```
🧪 Starting comprehensive browser integration tests...
✅ Messaging
✅ Media Streaming  
✅ 2-Way Media Streaming
✅ Crypto
✅ Distributed Storage
✅ Lexical Storage Interface
✅ Manual Connection
✅ Settings
✅ Health Check
✅ WebDHT
✅ Peer Connections

📊 BROWSER INTEGRATION TEST REPORT
============================================================
Test Suites: 11
Passed: 11
Failed: 0
Pass Rate: 100.00%
...
```

### Full Mode Output
Includes detailed setup logs, peer connection details, media streaming debug info, WebRTC states, and comprehensive progress indicators.

## Use Cases

- **CI/CD**: Use `npm run test:browser:quiet` for clean build logs
- **Development**: Use `npm run test:browser` for full debugging context
- **Troubleshooting**: Use `VERBOSE=true npm run test:browser:headless` for maximum detail

## Test Duration
- Typical run time: 90-120 seconds
- All modes run the same comprehensive test suite
- Only the logging verbosity changes
