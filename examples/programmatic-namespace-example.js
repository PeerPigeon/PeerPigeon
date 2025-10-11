#!/usr/bin/env node

/**
 * Example: Programmatic Hub Namespace Configuration
 * 
 * This example demonstrates how to programmatically configure
 * custom hub mesh namespaces using the PeerPigeonServer API.
 */

import { PeerPigeonServer } from '../server/index.js';

console.log('🚀 Programmatic Hub Namespace Example\n');

// Example 1: Create hub with default namespace
console.log('1️⃣ Creating hub with default namespace...');
const hub1 = new PeerPigeonServer({
    port: 3000,
    host: 'localhost',
    isHub: true
});

console.log(`   Default namespace: ${hub1.getHubMeshNamespace()}\n`);

// Example 2: Create hub with custom namespace in constructor
console.log('2️⃣ Creating hub with custom namespace in constructor...');
const hub2 = new PeerPigeonServer({
    port: 3001,
    host: 'localhost',
    isHub: true,
    hubMeshNamespace: 'production-mesh'
});

console.log(`   Custom namespace: ${hub2.getHubMeshNamespace()}\n`);

// Example 3: Set namespace programmatically before starting
console.log('3️⃣ Setting namespace programmatically...');
const hub3 = new PeerPigeonServer({
    port: 3002,
    host: 'localhost',
    isHub: true
});

console.log(`   Initial namespace: ${hub3.getHubMeshNamespace()}`);
hub3.setHubMeshNamespace('staging-mesh');
console.log(`   Updated namespace: ${hub3.getHubMeshNamespace()}\n`);

// Example 4: Start servers and verify namespace in stats
console.log('4️⃣ Starting servers and checking stats...\n');

async function startAndVerify() {
    try {
        // Start hub1
        await hub1.start();
        const stats1 = hub1.getStats();
        console.log(`   Hub 1 (${stats1.port}): namespace = "${stats1.hubMeshNamespace}"`);

        // Start hub2
        await hub2.start();
        const stats2 = hub2.getStats();
        console.log(`   Hub 2 (${stats2.port}): namespace = "${stats2.hubMeshNamespace}"`);

        // Start hub3
        await hub3.start();
        const stats3 = hub3.getStats();
        console.log(`   Hub 3 (${stats3.port}): namespace = "${stats3.hubMeshNamespace}"\n`);

        console.log('✅ All hubs started successfully!\n');
        console.log('📝 Note: Hubs with different namespaces will NOT discover each other.');
        console.log('   Only hubs with matching namespaces form a mesh network.\n');

        // Example 5: Try to change namespace while running (will fail)
        console.log('5️⃣ Attempting to change namespace while running...');
        try {
            hub1.setHubMeshNamespace('should-fail');
        } catch (error) {
            console.log(`   ❌ Expected error: ${error.message}\n`);
        }

        // Example 6: Access namespace through different methods
        console.log('6️⃣ Accessing namespace through different methods:');
        console.log(`   getHubMeshNamespace(): ${hub1.getHubMeshNamespace()}`);
        console.log(`   getStats().hubMeshNamespace: ${hub1.getStats().hubMeshNamespace}`);
        console.log(`   Direct property access: ${hub1.hubMeshNamespace}\n`);

        // Cleanup
        console.log('🧹 Cleaning up...');
        await hub1.stop();
        await hub2.stop();
        await hub3.stop();
        console.log('✅ All hubs stopped\n');

        // Example 7: Change namespace after stopping
        console.log('7️⃣ Changing namespace after stopping...');
        console.log(`   Before: ${hub1.getHubMeshNamespace()}`);
        hub1.setHubMeshNamespace('after-stop-mesh');
        console.log(`   After: ${hub1.getHubMeshNamespace()}\n`);

        console.log('🎉 Example complete!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Run the example
startAndVerify();
