#!/usr/bin/env node

/**
 * Simple test - just 2 hubs
 */

import { PeerPigeonServer } from '../server/index.js';

console.log('Starting Hub 1...\n');
const hub1 = new PeerPigeonServer({
    port: 3000,
    host: '0.0.0.0',
    isHub: true
});

await hub1.start();
console.log('\nHub 1 started. Waiting 3 seconds...\n');
await new Promise(r => setTimeout(r, 3000));

console.log('Starting Hub 2...\n');
const hub2 = new PeerPigeonServer({
    port: 3001,
    host: '0.0.0.0',
    isHub: true,
    bootstrapHubs: ['ws://localhost:3000']
});

await hub2.start();
console.log('\nHub 2 started. Waiting 10 seconds...\n');
await new Promise(r => setTimeout(r, 10000));

console.log('\nTest complete!\n');
await hub1.stop();
await hub2.stop();
process.exit(0);
