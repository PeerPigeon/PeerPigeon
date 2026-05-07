#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const golangDir = join(repoRoot, 'golang');
const rustDir = join(repoRoot, 'rust');
const wasmOut = join(repoRoot, 'examples', 'vue3', 'public', 'peerpigeon.wasm');
const wasmExecOut = join(repoRoot, 'examples', 'vue3', 'public', 'wasm_exec.js');
const rustOutDir = join(repoRoot, 'examples', 'vue3', 'public', 'rust-wasm');

const argv = new Set(process.argv.slice(2));
const wantsGo = argv.has('--go') || argv.has('--all') || argv.size === 0;
const wantsRust = argv.has('--rust') || argv.has('--all') || argv.size === 0;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const details = stderr || stdout || `Command failed: ${cmd} ${args.join(' ')}`;
    throw new Error(details);
  }

  return result;
}

try {
  if (wantsGo) {
    const goRoot = run('go', ['env', 'GOROOT'], { cwd: golangDir }).stdout.trim();

    if (!goRoot) {
      throw new Error('Unable to resolve GOROOT from `go env GOROOT`.');
    }

    run('go', ['build', '-o', '../examples/vue3/public/peerpigeon.wasm', './wasm'], {
      cwd: golangDir,
      env: {
        ...process.env,
        GOOS: 'js',
        GOARCH: 'wasm',
      },
    });

    if (existsSync(wasmExecOut)) {
      try {
        chmodSync(wasmExecOut, 0o644);
      } catch {
        // continue and let copy fail with a clear error if still not writable
      }
    }
    copyFileSync(join(goRoot, 'lib', 'wasm', 'wasm_exec.js'), wasmExecOut);
    chmodSync(wasmExecOut, 0o644);

    console.log('Built Go wasm:', wasmOut);
    console.log('Copied Go runtime:', wasmExecOut);
  }

  if (wantsRust) {
    run('wasm-pack', ['build', '--target', 'web', '--out-dir', '../examples/vue3/public/rust-wasm', '--release'], {
      cwd: rustDir,
    });
    console.log('Built Rust wasm:', rustOutDir);
  }
} catch (error) {
  const message = String(error?.message || error || 'Unknown wasm build error');
  console.error('WASM build failed:', message);
  process.exit(1);
}
