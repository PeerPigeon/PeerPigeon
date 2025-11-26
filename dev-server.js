#!/usr/bin/env node

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  console.log('🚀 Starting Fast PeerPigeon Dev Server...');

  // Check if browser bundle exists, but don't auto-build
  const browserBundlePath = path.join(__dirname, 'dist', 'peerpigeon-browser.js');
  if (!existsSync(browserBundlePath)) {
    console.log('⚠️  Browser bundle not found. Run "npm run build" to create it.');
    console.log('📦 Continuing without bundle - examples may not work properly.');
  } else {
    console.log('✅ Browser bundle found at dist/peerpigeon-browser.js');
  }

  const app = express();
  const PORT = process.env.PORT || 8080;

  // Add request logging middleware
  app.use((req, res, next) => {
    console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Serve static files from the root directory
  app.use(express.static(__dirname));

  // Serve the browser example specifically
  app.use('/examples/browser', express.static(path.join(__dirname, 'examples/browser')));
  
  // Serve browser examples
  app.use('/vanilla', express.static(path.join(__dirname, 'examples/browser/vanilla')));
  app.use('/vue', express.static(path.join(__dirname, 'examples/browser/vue/dist')));

  // Serve the dist folder for browser bundles
  app.use('/dist', express.static(path.join(__dirname, 'dist')));

  // Serve source files for the browser
  app.use('/src', express.static(path.join(__dirname, 'src')));

  // Serve peerpigeon-browser.js from Vue dist (Vue app needs it at root)
  app.get('/peerpigeon-browser.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'examples/browser/vue/dist/peerpigeon-browser.js'));
  });

  // Serve assets from Vue dist first (Vue app needs /assets/ at root)
  // Then fall back to vanilla assets
  app.use('/assets', express.static(path.join(__dirname, 'examples/browser/vue/dist/assets')));
  app.use('/assets', express.static(path.join(__dirname, 'examples/browser/vanilla/assets')));

  // Serve browser example assets from root for convenience (vanilla)
  app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'examples/browser/vanilla/styles.css'));
  });

  app.get('/ui.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'examples/browser/vanilla/ui.js'));
  });

  app.get('/app.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'examples/browser/vanilla/app.js'));
  });

  // Serve the main index.js
  app.get('/index.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.js'));
  });

  // Default route - redirect to Network page in Vue app
  app.get('/', (req, res) => {
    res.redirect('/vue/');
  });

  // Catch-all for vanilla browser example
  app.get('/vanilla', (req, res) => {
    res.sendFile(path.join(__dirname, 'examples/browser/vanilla/index.html'));
  });

  // SPA fallback for Vue app - must come after static routes
  app.get('/vue/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'examples/browser/vue/dist/index.html'));
  });

  app.get('/vue', (req, res) => {
    res.sendFile(path.join(__dirname, 'examples/browser/vue/dist/index.html'));
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Fast Dev Server running on http://localhost:${PORT}`);
    console.log(`🌐 Vanilla example: http://localhost:${PORT}/vanilla`);
    console.log(`🌐 Vue example: http://localhost:${PORT}/vue`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log('✅ Server is ready for connections');
    console.log('\n📁 Serving:');
    console.log('   • Browser bundle: /dist/peerpigeon-browser.js');
    console.log('   • Vanilla example: /examples/browser/vanilla/');
    console.log('   • Vue example: /examples/browser/vue/dist/');
    console.log('   • Source files: /src/');
    console.log('   • Static assets: /assets/');
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
}

// Start the server
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
