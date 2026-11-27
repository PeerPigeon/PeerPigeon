import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(__dirname, '../..')
const peerPigeonSourceRoot = path.resolve(workspaceRoot, 'src')

// Which build a page is running, shown at the foot of the page: the PeerPigeon commit it was built from
// (the demo runs PeerPigeon's own source) and the freertc commit the lockfile pins.
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: workspaceRoot }).toString().trim() } catch { return 'dev' } })()
const freertc = (() => {
  try {
    const lock = JSON.parse(readFileSync(path.resolve(workspaceRoot, 'package-lock.json'), 'utf8'))
    return /#([0-9a-f]{7})[0-9a-f]*$/.exec(lock.packages?.['node_modules/freertc']?.resolved ?? '')?.[1] ?? lock.packages?.['node_modules/freertc']?.version ?? '?'
  } catch { return '?' }
})()
const builtAt = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' })
const build = `${commit} (freertc ${freertc}), ${builtAt}`

export default defineConfig({
  plugins: [
    {
      name: 'peerpigeon-core-full-reload',
      configureServer(server) {
        server.watcher.add(peerPigeonSourceRoot)
        server.watcher.on('change', (file) => {
          if (path.resolve(file).startsWith(`${peerPigeonSourceRoot}${path.sep}`)) {
            server.ws.send({ type: 'full-reload', path: '*' })
          }
        })
      }
    },
    vue()
  ],
  define: { __BUILD__: JSON.stringify(build) },
  resolve: {
    alias: {
      peerpigeon: path.resolve(__dirname, '../../src/index.ts')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    fs: {
      allow: [workspaceRoot]
    },
    allowedHosts: ['peer.local'],
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  }
})
