#!/usr/bin/env node

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('🔄 Starting PeerPigeon Dev Server...');
console.log('✅ Imports loaded successfully');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log(`📁 Server directory: ${__dirname}`);

const app = express();
const PORT = process.env.PORT || 8080;

console.log(`🔧 Configuring server on port ${PORT}...`);

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Serve static files from the root directory
console.log('📂 Setting up static file serving...');
app.use(express.static(__dirname));

// Serve the browser example specifically
app.use('/examples/browser', express.static(path.join(__dirname, 'examples/browser')));

// Serve source files for the browser
app.use('/src', express.static(path.join(__dirname, 'src')));

// Serve browser example assets from root for convenience
app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'examples/browser/styles.css'));
});

app.get('/ui.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'examples/browser/ui.js'));
});

app.get('/app.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'examples/browser/app.js'));
});

// Serve assets directory
app.use('/assets', express.static(path.join(__dirname, 'examples/browser/assets')));

// Serve the main index.js
app.get('/index.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.js'));
});

// Default route - serve the browser example
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'examples/browser/index.html'));
});

// Catch-all for browser example
app.get('/browser', (req, res) => {
  res.sendFile(path.join(__dirname, 'examples/browser/index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('\n🚀 PeerPigeon Dev Server STARTED!');
  console.log(`🚀 PeerPigeon Dev Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${__dirname}`);
  console.log(`🌐 Browser example: http://localhost:${PORT}/browser`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log('\n✅ Server is ready for connections\n');
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`🔥 Port ${PORT} is already in use. Try a different port with: PORT=8081 node dev-server.js`);
  }
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down dev server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down dev server...');
  process.exit(0);
});
