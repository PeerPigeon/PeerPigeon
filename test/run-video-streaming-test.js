#!/usr/bin/env node
/**
 * Video Streaming Test Runner
 * 
 * Helper script to run PeerPigeon video streaming tests with various configurations
 */

import { spawn } from 'child_process';

const TEST_FILE = 'test/video-streaming-test.js';

function printHelp() {
  console.log(`
🎥 PeerPigeon Video Streaming Test Runner

Usage:
  npm run test:video-streaming [options]
  node test/run-video-streaming-test.js [options]

Options:
  --headless         Run browser in headless mode (default)
  --headed           Run browser with visible UI (for debugging)
  --help, -h         Show this help message

Examples:
  npm run test:video-streaming                    # Run headless
  npm run test:video-streaming -- --headed       # Run with visible browser
  node test/run-video-streaming-test.js --headed # Run with visible browser

The test covers:
  ✅ 1:1 video streaming (peer-to-peer)
  ✅ 1:many video streaming (broadcast to multiple receivers)
  ✅ many:many video streaming (all peers broadcasting)
  
All tests use fake media devices to ensure consistent, hardware-independent testing.
`);
}

function runTest(args = []) {
  console.log('🎬 Starting PeerPigeon Video Streaming Tests...\n');
  
  const testProcess = spawn('node', [TEST_FILE], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...parseArgs(args)
    }
  });
  
  testProcess.on('close', (code) => {
    if (code === 0) {
      console.log('\n🎉 Video streaming tests completed successfully!');
    } else {
      console.log(`\n💥 Video streaming tests failed with exit code ${code}`);
    }
    process.exit(code);
  });
  
  testProcess.on('error', (error) => {
    console.error('❌ Failed to start test:', error.message);
    process.exit(1);
  });
}

function parseArgs(args) {
  const env = {};
  
  for (const arg of args) {
    switch (arg) {
      case '--headed':
        env.HEADLESS = 'false';
        break;
      case '--headless':
        env.HEADLESS = 'true';
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.warn(`⚠️  Unknown option: ${arg}`);
        }
        break;
    }
  }
  
  return env;
}

// Parse command line arguments
const args = process.argv.slice(2);

// Check if help is requested
if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

// Run the test
runTest(args);
