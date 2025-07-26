#!/usr/bin/env node
/**
 * Simple test runner for the PeerPigeon browser integration test
 * Automatically installs dependencies if needed and runs the test
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
const REQUIRED_PACKAGES = ['puppeteer'];
async function checkDependencies() {
  try {
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
    const devDeps = packageJson.devDependencies || {};
    const missing = REQUIRED_PACKAGES.filter(pkg => !devDeps[pkg]);
    if (missing.length > 0) {
      console.log(`📦 Installing missing dependencies: ${missing.join(', ')}`);
      const npmInstall = spawn('npm', ['install', '--save-dev', ...missing], {
        stdio: 'inherit'
      });
      await new Promise((resolve, reject) => {
        npmInstall.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`npm install failed with code ${code}`));
          }
        });
      });
      console.log('✅ Dependencies installed successfully');
    }
  } catch (error) {
    console.error('❌ Failed to check/install dependencies:', error.message);
    process.exit(1);
  }
}
async function runTest() {
  console.log('🚀 Starting PeerPigeon Browser Integration Test');
  console.log('================================================\n');
  const testProcess = spawn('node', ['test/browser-integration-test.js'], {
    stdio: 'inherit',
    env: { ...process.env, ...process.env }
  });
  return new Promise((resolve, reject) => {
    testProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Test failed with code ${code}`));
      }
    });
  });
}
async function main() {
  try {
    await checkDependencies();
    await runTest();
    console.log('\n🎉 Test completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}
main();
