import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(__dirname, '../..')
const peerPigeonSourceRoot = path.resolve(workspaceRoot, 'src')

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
