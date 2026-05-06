#!/usr/bin/env node
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const exampleRoot = path.join(repoRoot, 'examples', 'vue3')
const viteBin = path.join(exampleRoot, 'node_modules', 'vite', 'bin', 'vite.js')

const child = spawn(
  process.execPath,
  [viteBin, '--config', 'vite.config.ts', '--host', '0.0.0.0', '--strictPort', ...process.argv.slice(2)],
  {
    cwd: exampleRoot,
    stdio: 'inherit',
  }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(`[dev-vite] Failed to launch Vite: ${error.message}`)
  process.exit(1)
})