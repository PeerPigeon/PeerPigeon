#!/usr/bin/env node

import { build } from 'esbuild';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

async function buildBrowser() {
  console.log('🔨 Building browser bundle...');
  
  try {
    // Ensure dist directory exists
    await mkdir(join(projectRoot, 'dist'), { recursive: true });
    
    // Create a browser bundle that includes UnSEA
    await build({
      entryPoints: [join(projectRoot, 'src/browser-entry.js')],
      bundle: true,
      format: 'iife',
      globalName: 'PeerPigeon',
      outfile: join(projectRoot, 'dist/peerpigeon-browser.js'),
      external: ['pigeonrtc', '@koush/wrtc'], // Don't bundle these - they're handled differently
      platform: 'browser',
      target: 'es2020',
      minify: false, // Keep readable for debugging
      sourcemap: true,
      mainFields: ['module', 'main'], // Prefer ES modules over browser field
      conditions: ['import', 'module'], // Use import conditions to get ESM versions
      define: {
        'process.env.NODE_ENV': '"production"',
        global: 'globalThis'
      },
      banner: {
        js: '// PeerPigeon Browser Bundle - includes UnSEA crypto library\n// Generated automatically - do not edit directly\n'
      }
    });
    
    console.log('✅ Browser bundle created at dist/peerpigeon-browser.js');
    console.log('📦 UnSEA crypto library bundled from node_modules');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

buildBrowser();
