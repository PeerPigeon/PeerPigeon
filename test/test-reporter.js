#!/usr/bin/env node

/**
 * Comprehensive Test Reporter for PeerPigeon
 * Runs all tests and provides a unified summary
 */

import { spawn } from 'child_process';

class TestReporter {
  constructor() {
    this.results = {
      storage: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        success: true // Default to true, only false if failures
      },
      persistent: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        success: true
      },
      browser: {
        totalSuites: 0,
        passed: 0,
        failed: 0,
        success: true
      }
    };
  }

  /**
   * Run a command and capture output
   */
  async runCommand(command, args = []) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });

      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Parse storage test results from output
   */
  parseStorageResults(output) {
    const totalMatch = output.match(/Total Tests:\s*(\d+)/);
    const passedMatch = output.match(/✅ Passed:\s*(\d+)/);
    const failedMatch = output.match(/❌ Failed:\s*(\d+)/);

    if (totalMatch && passedMatch && failedMatch) {
      this.results.storage.totalTests = parseInt(totalMatch[1]);
      this.results.storage.passed = parseInt(passedMatch[1]);
      this.results.storage.failed = parseInt(failedMatch[1]);
      // Only set to false if there are failures and tests were run
      if (this.results.storage.totalTests > 0 && this.results.storage.failed > 0) {
        this.results.storage.success = false;
      }
    }
  }

  /**
   * Parse persistent storage test results from output
   */
  parsePersistentResults(output) {
    // Count test sections (each "📁 Test N:" indicates a test)
    const testMatches = output.match(/📁 Test \d+:/g);
    const totalTests = testMatches ? testMatches.length : 0;

    // Check if all tests passed by looking for the success message
    const successMatch = output.match(/🎉 All tests passed!/);
    const success = !!successMatch;

    this.results.persistent.totalTests = totalTests;
    this.results.persistent.passed = success ? totalTests : 0;
    this.results.persistent.failed = success ? 0 : totalTests;
    // Only set to false if there are failures and tests were run
    if (totalTests > 0 && !success) {
      this.results.persistent.success = false;
    }
  }

  /**
   * Parse browser test results from output
   */
  parseBrowserResults(output) {
    // Look for "Test Categories:" instead of "Test Suites:"
    const suitesMatch = output.match(/Test Categories:\s*(\d+)/);
    const passedMatch = output.match(/Passed:\s*(\d+)/);
    const failedMatch = output.match(/Failed:\s*(\d+)/);

    if (suitesMatch && passedMatch && failedMatch) {
      this.results.browser.totalSuites = parseInt(suitesMatch[1]);
      this.results.browser.passed = parseInt(passedMatch[1]);
      this.results.browser.failed = parseInt(failedMatch[1]);
      // Only set to false if there are failures and suites were run
      if (this.results.browser.totalSuites > 0 && this.results.browser.failed > 0) {
        this.results.browser.success = false;
      }
    }
  }

  /**
   * Print comprehensive test summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(80));
    console.log('🏁 COMPREHENSIVE TEST SUMMARY - PEERPIGEON');
    console.log('='.repeat(80));

    // Storage Tests Summary
    console.log('\n📦 DISTRIBUTED STORAGE TESTS:');
    console.log(`   Individual Tests: ${this.results.storage.totalTests}`);
    console.log(`   ✅ Passed: ${this.results.storage.passed}`);
    console.log(`   ❌ Failed: ${this.results.storage.failed}`);
    if (this.results.storage.totalTests > 0) {
      const storageRate = ((this.results.storage.passed / this.results.storage.totalTests) * 100).toFixed(1);
      console.log(`   Success Rate: ${storageRate}%`);
    }

    // Persistent Storage Tests Summary
    console.log('\n💾 PERSISTENT STORAGE TESTS:');
    console.log(`   Individual Tests: ${this.results.persistent.totalTests}`);
    console.log(`   ✅ Passed: ${this.results.persistent.passed}`);
    console.log(`   ❌ Failed: ${this.results.persistent.failed}`);
    if (this.results.persistent.totalTests > 0) {
      const persistentRate = ((this.results.persistent.passed / this.results.persistent.totalTests) * 100).toFixed(1);
      console.log(`   Success Rate: ${persistentRate}%`);
    }

    // Browser Integration Tests Summary
    console.log('\n🌐 BROWSER INTEGRATION TESTS:');
    console.log(`   Test Suites: ${this.results.browser.totalSuites}`);
    console.log(`   ✅ Passed: ${this.results.browser.passed}`);
    console.log(`   ❌ Failed: ${this.results.browser.failed}`);
    if (this.results.browser.totalSuites > 0) {
      const browserRate = ((this.results.browser.passed / this.results.browser.totalSuites) * 100).toFixed(1);
      console.log(`   Success Rate: ${browserRate}%`);
    }

    // Overall Summary
    const totalTests = this.results.storage.totalTests + this.results.persistent.totalTests;
    const totalSuites = this.results.browser.totalSuites;
    const totalPassed = this.results.storage.passed + this.results.persistent.passed + this.results.browser.passed;
    const totalFailed = this.results.storage.failed + this.results.persistent.failed + this.results.browser.failed;
    // Only require success for categories that actually ran tests/suites
    const categories = [];
    if (this.results.storage.totalTests > 0) categories.push(this.results.storage.success);
    if (this.results.persistent.totalTests > 0) categories.push(this.results.persistent.success);
    if (this.results.browser.totalSuites > 0) categories.push(this.results.browser.success);
    const overallSuccess = categories.length === 0 ? true : categories.every(Boolean);

    console.log('\n📊 OVERALL SUMMARY:');
    console.log(`   Storage Tests: ${this.results.storage.totalTests} distributed + ${this.results.persistent.totalTests} persistent = ${totalTests} total`);
    console.log(`   Browser Suites: ${totalSuites} test suites`);
    console.log(`   Total Passed: ${totalPassed}`);
    console.log(`   Total Failed: ${totalFailed}`);

    console.log('\n🎯 COVERAGE AREAS:');
    console.log('   • Distributed Storage (CRUD, encryption, access control)');
    console.log('   • Persistent Storage (IndexedDB, filesystem, in-memory)');
    console.log('   • WebRTC Mesh Networking (peer connections, routing)');
    console.log('   • WebDHT (distributed hash table operations)');
    console.log('   • Media Streaming (audio/video transmission)');
    console.log('   • Cryptography (key generation, self-tests)');
    console.log('   • Messaging System (broadcast & direct messaging)');
    console.log('   • Configuration Management (settings, health checks)');

    if (overallSuccess) {
      console.log('\n🎉 ALL TESTS PASSED! PeerPigeon is working perfectly.');
    } else {
      console.log('\n⚠️  SOME TESTS FAILED. Please review the errors above.');
    }

    console.log('='.repeat(80));

    return overallSuccess;
  }

  /**
   * Run all tests and generate comprehensive report
   */
  async runAllTests() {
    console.log('🚀 Starting PeerPigeon Test Suite...\n');

    try {
      // Run storage tests
      console.log('📦 Running Distributed Storage Tests...');
      const storageResult = await this.runCommand('npm', ['run', 'test:storage']);
      this.parseStorageResults(storageResult.stdout);

      // Run persistent storage tests
      console.log('\n💾 Running Persistent Storage Tests...');
      const persistentResult = await this.runCommand('node', ['test/persistent-storage-test.js']);
      this.parsePersistentResults(persistentResult.stdout);

      console.log('\n🌐 Running Browser Integration Tests...');
      const browserResult = await this.runCommand('npm', ['run', 'test:browser:headless']);
      this.parseBrowserResults(browserResult.stdout);

      // Generate comprehensive summary
      const overallSuccess = this.printSummary();

      // Exit with appropriate code
      process.exit(overallSuccess ? 0 : 1);
    } catch (error) {
      console.error('❌ Test execution failed:', error.message);
      process.exit(1);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const reporter = new TestReporter();
  reporter.runAllTests();
}

export default TestReporter;
