#!/usr/bin/env node

/**
 * Comprehensive Test Runner
 * Runs all tests including custom test runners and Jest tests
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

class TestRunner {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      suites: []
    };
  }

  async runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      console.log(`\n🔧 Running: ${command} ${args.join(' ')}`);

      const proc = spawn(command, args, {
        cwd: projectRoot,
        stdio: 'inherit',
        ...options
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ ${command} completed successfully`);
          resolve(true);
        } else {
          console.error(`❌ ${command} failed with code ${code}`);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        console.error(`💥 Error running ${command}:`, err.message);
        reject(err);
      });
    });
  }

  async runCustomTests() {
    console.log('\n📋 Running Custom Test Suites...');

    const customTests = [
      'test/unit/crypto.test.js',
      'test/unit/mesh.test.js',
      'test/integration/integration.test.js'
    ];

    let allPassed = true;

    for (const testFile of customTests) {
      console.log(`\n🧪 Running ${testFile}...`);
      const success = await this.runCommand('node', [testFile]);
      if (success) {
        this.results.passed++;
      } else {
        this.results.failed++;
        allPassed = false;
      }
      this.results.suites.push({ name: testFile, passed: success });
    }

    return allPassed;
  }

  async runJestTests() {
    console.log('\n🃏 Running Jest Tests...');
    return await this.runCommand('npx', ['jest', '--verbose']);
  }

  async runLinting() {
    console.log('\n🔍 Running ESLint...');
    return await this.runCommand('npx', ['eslint', 'src/', 'examples/', 'websocket-server/', '--ext', '.js']);
  }

  async runCoverage() {
    console.log('\n📊 Running Coverage Analysis...');
    return await this.runCommand('npx', ['jest', '--coverage']);
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📋 TEST SUMMARY');
    console.log('='.repeat(60));

    this.results.suites.forEach(suite => {
      const status = suite.passed ? '✅' : '❌';
      console.log(`${status} ${suite.name}`);
    });

    console.log(`\nTotal Suites: ${this.results.suites.length}`);
    console.log(`Passed: ${this.results.passed}`);
    console.log(`Failed: ${this.results.failed}`);

    if (this.results.failed === 0) {
      console.log('\n🎉 All tests passed!');
    } else {
      console.log(`\n⚠️  ${this.results.failed} test suite(s) failed`);
    }
  }

  async run() {
    console.log('🚀 Starting PeerPigeon Test Suite');
    console.log('='.repeat(60));

    try {
      // Run linting first
      const lintPassed = await this.runLinting();

      // Run custom tests
      const customPassed = await this.runCustomTests();

      // Run Jest tests (if any Jest-compatible tests exist)
      // const jestPassed = await this.runJestTests();

      // Run coverage analysis
      // const coveragePassed = await this.runCoverage();

      this.printSummary();

      // Exit with appropriate code
      const allPassed = lintPassed && customPassed;
      process.exit(allPassed ? 0 : 1);
    } catch (error) {
      console.error('💥 Test runner encountered an error:', error);
      process.exit(1);
    }
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runner = new TestRunner();
  runner.run();
}

export { TestRunner };
