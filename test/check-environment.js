#!/usr/bin/env node
/**
 * Demo script to show the browser integration test setup
 * This is a lightweight version that just validates the environment
 */
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
async function checkEnvironment() {
  console.log('🔍 Checking environment for browser integration test...\n');
  // Check if Puppeteer can launch a browser
  try {
    console.log('📱 Testing Puppeteer browser launch...');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('data:text/html,<h1>Test</h1>');
    await browser.close();
    console.log('✅ Puppeteer working correctly\n');
  } catch (error) {
    console.error('❌ Puppeteer test failed:', error.message);
    return false;
  }
  // Check if we can spawn processes
  try {
    console.log('⚙️  Testing process spawning...');
    const testProcess = spawn('echo', ['test'], { stdio: 'pipe' });
    await new Promise((resolve, reject) => {
      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process failed with code ${code}`));
        }
      });
    });
    console.log('✅ Process spawning working correctly\n');
  } catch (error) {
    console.error('❌ Process spawning test failed:', error.message);
    return false;
  }
  // Check if ports are available
  console.log('🔌 Checking default ports...');
  try {
    const http = await import('http');
    // Test signaling port (3000)
    const server1 = http.createServer();
    await new Promise((resolve, reject) => {
      server1.listen(3000, () => {
        server1.close(resolve);
      });
      server1.on('error', reject);
    });
    console.log('✅ Port 3000 (signaling) available');
    // Test HTTP port (8080)
    const server2 = http.createServer();
    await new Promise((resolve, reject) => {
      server2.listen(8080, () => {
        server2.close(resolve);
      });
      server2.on('error', reject);
    });
    console.log('✅ Port 8080 (HTTP) available');
  } catch (error) {
    console.warn('⚠️  Port availability check failed:', error.message);
    console.log('💡 This might be okay if the ports are used by other services\n');
  }
  return true;
}
async function showTestCommands() {
  console.log('\n📋 Available Test Commands:');
  console.log('==========================\n');
  console.log('🚀 Run browser integration test (visible browsers):');
  console.log('   npm run test:browser\n');
  console.log('🤖 Run browser integration test (headless):');
  console.log('   npm run test:browser:headless\n');
  console.log('🔧 Run test directly:');
  console.log('   node test/browser-integration-test.js\n');
  console.log('📊 Run with custom configuration:');
  console.log('   HEADLESS=true TIMEOUT=600000 node test/browser-integration-test.js\n');
  console.log('🎯 Test Features Include:');
  console.log('   • 7 simultaneous browser instances');
  console.log('   • WebRTC peer-to-peer connections');
  console.log('   • Broadcast and direct messaging');
  console.log('   • WebDHT distributed storage');
  console.log('   • End-to-end encryption');
  console.log('   • Media streaming (fake devices)');
  console.log('   • Peer discovery and routing');
  console.log('   • Configuration management\n');
  console.log('📁 Test reports saved to: test/reports/\n');
}
async function main() {
  console.log('🧪 PeerPigeon Browser Integration Test Environment Check');
  console.log('======================================================\n');
  const envOk = await checkEnvironment();
  if (envOk) {
    console.log('🎉 Environment check passed! Ready to run browser integration tests.');
    await showTestCommands();
  } else {
    console.log('❌ Environment check failed. Please resolve the issues above.');
    process.exit(1);
  }
}
main().catch(error => {
  console.error('❌ Environment check failed:', error);
  process.exit(1);
});
