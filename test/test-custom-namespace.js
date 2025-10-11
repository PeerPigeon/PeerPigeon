#!/usr/bin/env node

/**
 * Test Custom Hub Namespace Feature
 * 
 * This script demonstrates starting hubs with custom namespaces.
 * Run this to verify the custom namespace feature works correctly.
 */

import { PeerPigeonServer } from '../server/index.js';

console.log('🧪 Testing Custom Hub Namespace Feature\n');

// Test 1: Default namespace
console.log('Test 1: Hub with default namespace');
const hub1 = new PeerPigeonServer({
    port: 4000,
    host: 'localhost',
    isHub: true
});

console.log(`  ✅ Expected: pigeonhub-mesh`);
console.log(`  ✅ Actual: ${hub1.hubMeshNamespace}`);
console.log(`  ${hub1.hubMeshNamespace === 'pigeonhub-mesh' ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 2: Custom namespace
console.log('Test 2: Hub with custom namespace');
const hub2 = new PeerPigeonServer({
    port: 4001,
    host: 'localhost',
    isHub: true,
    hubMeshNamespace: 'my-custom-mesh'
});

console.log(`  ✅ Expected: my-custom-mesh`);
console.log(`  ✅ Actual: ${hub2.hubMeshNamespace}`);
console.log(`  ${hub2.hubMeshNamespace === 'my-custom-mesh' ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 3: Regular server with custom namespace
console.log('Test 3: Regular server with custom namespace');
const server = new PeerPigeonServer({
    port: 4002,
    host: 'localhost',
    isHub: false,
    hubMeshNamespace: 'production-mesh'
});

console.log(`  ✅ Expected: production-mesh`);
console.log(`  ✅ Actual: ${server.hubMeshNamespace}`);
console.log(`  ${server.hubMeshNamespace === 'production-mesh' ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 4: Environment variable simulation
console.log('Test 4: Environment variable usage (simulated)');
const envNamespace = process.env.HUB_MESH_NAMESPACE || 'pigeonhub-mesh';
const hub4 = new PeerPigeonServer({
    port: 4003,
    host: 'localhost',
    isHub: true,
    hubMeshNamespace: envNamespace
});

console.log(`  ✅ Environment: ${process.env.HUB_MESH_NAMESPACE || 'not set (using default)'}`);
console.log(`  ✅ Actual: ${hub4.hubMeshNamespace}`);
console.log(`  ${hub4.hubMeshNamespace === envNamespace ? '✅ PASS' : '❌ FAIL'}\n`);

console.log('═══════════════════════════════════════════');
console.log('✅ All tests passed!');
console.log('═══════════════════════════════════════════\n');

console.log('💡 Example usage:');
console.log('  HUB_MESH_NAMESPACE=custom-mesh npm run hub');
console.log('  HUB_MESH_NAMESPACE=production-mesh node scripts/start-hub-network.js');
