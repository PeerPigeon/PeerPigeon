#!/usr/bin/env node

/**
 * Start a PeerPigeon Hub with fly.dev bootstraps
 * Usage: npm run hub:bootstraps [--port=3000]
 */
import { PeerPigeonServer } from '../server/index.js';
import net from 'net';

const args = process.argv.slice(2);

function getAvailablePort(startPort, maxTries = 20) {
  return new Promise((resolve) => {
    let port = startPort;
    let tries = 0;
    function tryPort() {
      const server = net.createServer();
      server.once('error', () => {
        port++;
        tries++;
        if (tries < maxTries) {
          tryPort();
        } else {
          resolve(startPort); // fallback to startPort
        }
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port);
    }
    tryPort();
  });
}

const BASE_PORT = (() => {
  const portArg = args.find(a => a.startsWith('--port='));
  return portArg ? parseInt(portArg.split('=')[1]) : (parseInt(process.env.PORT) || 3000);
})();

async function startHub() {
  const PORT = await getAvailablePort(BASE_PORT);
  const HOST = process.env.HOST || '0.0.0.0';
  const HUB_MESH_NAMESPACE = process.env.HUB_MESH_NAMESPACE || 'pigeonhub-mesh';

  // Use fly.dev bootstraps
  const bootstrapHubs = [
    'wss://pigeonhub.fly.dev',
    'wss://pigeonhub-b.fly.dev',
    'wss://pigeonhub-c.fly.dev'
  ];

  console.log('🚀 Starting PeerPigeon Hub with fly.dev bootstraps...\n');
  console.log(`🔗 Bootstraps: ${bootstrapHubs.join(', ')}`);
  console.log(`🔗 Using port: ${PORT}`);

  const hub = new PeerPigeonServer({
    port: PORT,
    host: HOST,
    isHub: true,
    hubMeshNamespace: HUB_MESH_NAMESPACE,
    autoConnect: true,
    bootstrapHubs
  });

  hub.on('started', ({ host, port }) => {
    console.log(`✅ Hub running on ws://${host}:${port}`);
    console.log(`   Health: http://${host}:${port}/health`);
    console.log(`   Hubs:   http://${host}:${port}/hubs\n`);
  });

  hub.start();
}

startHub();
