#!/usr/bin/env node

/**
 * Simple development runner - replaces concurrently with zero external dependencies
 * Runs both the signaling server and HTTP dev server
 */

import { spawn } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('🚀 Starting PeerPigeon Development Environment...');

// Color codes for output
const colors = {
  signaling: '\x1b[34m', // Blue
  http: '\x1b[32m',      // Green
  reset: '\x1b[0m'
};

// Start signaling server
const signalingServer = spawn('node', ['websocket-server/server.js'], {
  cwd: __dirname,
  stdio: 'pipe'
});

// Start HTTP dev server  
const httpServer = spawn('node', ['dev-server.js'], {
  cwd: __dirname,
  stdio: 'pipe'
});

// Handle signaling server output
signalingServer.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    console.log(`${colors.signaling}[signaling]${colors.reset} ${line}`);
  });
});

signalingServer.stderr.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    console.log(`${colors.signaling}[signaling]${colors.reset} ${line}`);
  });
});

// Handle HTTP server output
httpServer.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    console.log(`${colors.http}[http]${colors.reset} ${line}`);
  });
});

httpServer.stderr.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    console.log(`${colors.http}[http]${colors.reset} ${line}`);
  });
});

// Handle server exits
signalingServer.on('exit', (code) => {
  console.log(`${colors.signaling}[signaling]${colors.reset} Server exited with code ${code}`);
  if (code !== 0) {
    console.log('Shutting down HTTP server...');
    httpServer.kill();
    process.exit(1);
  }
});

httpServer.on('exit', (code) => {
  console.log(`${colors.http}[http]${colors.reset} Server exited with code ${code}`);
  if (code !== 0) {
    console.log('Shutting down signaling server...');
    signalingServer.kill();
    process.exit(1);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down development servers...');
  signalingServer.kill('SIGTERM');
  httpServer.kill('SIGTERM');
  
  setTimeout(() => {
    signalingServer.kill('SIGKILL');
    httpServer.kill('SIGKILL');
    process.exit(0);
  }, 3000);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down development servers...');
  signalingServer.kill('SIGTERM');
  httpServer.kill('SIGTERM');
  process.exit(0);
});

console.log('✅ Development servers starting...');
console.log('🌐 Signaling server: ws://localhost:3000');
console.log('🌐 HTTP dev server: http://localhost:8080'); 
console.log('📝 Press Ctrl+C to stop both servers');
