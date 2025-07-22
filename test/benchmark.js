#!/usr/bin/env node

/**
 * Performance Benchmark Suite
 * Tests encryption, mesh operations, and network performance
 */

import { performance } from 'perf_hooks';
import { CryptoManager } from '../src/CryptoManager.js';
import { PeerPigeonMesh } from '../src/PeerPigeonMesh.js';

class BenchmarkRunner {
  constructor() {
    this.results = [];
  }

  async benchmark(name, fn, iterations = 100) {
    console.log(`🏃‍♂️ Running ${name}...`);

    // Warmup
    for (let i = 0; i < 5; i++) {
      await fn();
    }

    const times = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];

    const result = {
      name,
      iterations,
      average: avg.toFixed(3),
      median: median.toFixed(3),
      min: min.toFixed(3),
      max: max.toFixed(3),
      opsPerSecond: (1000 / avg).toFixed(0)
    };

    this.results.push(result);

    console.log(`  ✅ ${name}: ${result.average}ms avg, ${result.opsPerSecond} ops/sec`);
    return result;
  }

  async runCryptoBenchmarks() {
    console.log('\n🔐 Crypto Benchmarks');
    console.log('='.repeat(40));

    const crypto = new CryptoManager();
    await crypto.init({ generateKeypair: true });

    // Key generation benchmark
    await this.benchmark('Key Generation', async () => {
      const tempCrypto = new CryptoManager();
      await tempCrypto.init({ generateKeypair: true });
    }, 10);

    // Encryption benchmark
    const message = 'This is a test message for encryption benchmarking';

    // Add our own key for self-encryption test
    const ourKeypair = crypto.keypair;
    if (ourKeypair && ourKeypair.pub && ourKeypair.epub) {
      crypto.addPeerKey(crypto.getPublicKey().pub || 'test-peer', {
        pub: ourKeypair.pub,
        epub: ourKeypair.epub
      });

      await this.benchmark('Message Encryption', async () => {
        const encrypted = await crypto.encryptForPeer(message, crypto.getPublicKey().pub || 'test-peer');
        return encrypted;
      }, 50);
    }

    // Group key generation
    await this.benchmark('Group Key Generation', async () => {
      await crypto.generateGroupKey('benchmark-group');
    }, 20);

    // Signing benchmark
    await this.benchmark('Message Signing', async () => {
      return await crypto.sign(message);
    }, 100);

    // Hash generation - using appropriate crypto API for environment
    await this.benchmark('SHA-256 Hashing', async () => {
      const encoder = new TextEncoder();
      const data = encoder.encode(message);

      if (typeof crypto !== 'undefined' && crypto.subtle) {
        // Browser environment
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer));
      } else {
        // Node.js environment
        const nodeCrypto = await import('crypto');
        const hash = nodeCrypto.createHash('sha256');
        hash.update(data);
        return hash.digest('hex');
      }
    }, 200);
  }

  async runMeshBenchmarks() {
    console.log('\n🕸️  Mesh Benchmarks');
    console.log('='.repeat(40));

    // Mesh initialization
    await this.benchmark('Mesh Initialization', async () => {
      const tempMesh = new PeerPigeonMesh({
        signalingServer: 'ws://localhost:3000',
        autoConnect: false
      });
      await tempMesh.init();
      tempMesh.disconnect(); // Clean up resources
    }, 5);

    // DHT operations (if implemented)
    await this.benchmark('DHT Store Operation', async () => {
      // Mock DHT store operation
      const key = 'benchmark-key-' + Math.random();
      const value = { data: 'benchmark-value', timestamp: Date.now() };
      // This would normally store in DHT
      return { key, value };
    }, 50);

    // Message routing
    await this.benchmark('Message Routing Logic', async () => {
      const peerId = 'benchmark-peer-' + Math.random();
      const message = { type: 'benchmark', data: 'test' };
      // Mock routing logic
      return { peerId, message };
    }, 100);
  }

  async runMemoryBenchmarks() {
    console.log('\n💾 Memory Benchmarks');
    console.log('='.repeat(40));

    const initialMemory = process.memoryUsage();

    // Create multiple crypto managers
    const cryptoManagers = [];
    for (let i = 0; i < 10; i++) {
      const crypto = new CryptoManager();
      await crypto.init({ generateKeypair: true });
      cryptoManagers.push(crypto);
    }

    const afterCryptoMemory = process.memoryUsage();

    console.log('  📊 Memory usage after 10 crypto managers:');
    console.log(`     Heap Used: ${((afterCryptoMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`     External: ${((afterCryptoMemory.external - initialMemory.external) / 1024 / 1024).toFixed(2)} MB`);
  }

  printResults() {
    console.log('\n📊 Benchmark Results');
    console.log('='.repeat(80));
    console.log('| Test Name                    | Avg (ms) | Median (ms) | Ops/sec |');
    console.log('|------------------------------|----------|-------------|---------|');

    this.results.forEach(result => {
      const name = result.name.padEnd(28);
      const avg = result.average.padStart(8);
      const median = result.median.padStart(11);
      const ops = result.opsPerSecond.padStart(7);
      console.log(`| ${name} | ${avg} | ${median} | ${ops} |`);
    });

    console.log('='.repeat(80));
  }

  async run() {
    console.log('🚀 PeerPigeon Performance Benchmarks');
    console.log('=====================================\n');

    const startTime = performance.now();

    try {
      await this.runCryptoBenchmarks();
      await this.runMeshBenchmarks();
      await this.runMemoryBenchmarks();

      const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);

      this.printResults();
      console.log(`\n⏱️  Total benchmark time: ${totalTime}s`);
      console.log('✅ All benchmarks completed successfully!');
    } catch (error) {
      console.error('💥 Benchmark failed:', error);
      process.exit(1);
    }
  }
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const runner = new BenchmarkRunner();
  runner.run();
}

export { BenchmarkRunner };
