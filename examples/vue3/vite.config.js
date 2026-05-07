import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import inject from '@rollup/plugin-inject'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const hmrHost = String(process.env.PEERPIGEON_VITE_HMR_HOST || '').trim()
const hmrProtocol = String(process.env.PEERPIGEON_VITE_HMR_PROTOCOL || '').trim()
const hmrClientPortRaw = Number(process.env.PEERPIGEON_VITE_HMR_CLIENT_PORT || 0)
const hmrClientPort = Number.isFinite(hmrClientPortRaw) && hmrClientPortRaw > 0
  ? Math.floor(hmrClientPortRaw)
  : 0

const hmr = hmrHost
  ? {
      host: hmrHost,
      protocol: hmrProtocol || undefined,
      clientPort: hmrClientPort || undefined,
    }
  : undefined

export default defineConfig({
  plugins: [
    vue(),
    inject({
      Buffer: ['buffer', 'Buffer'],
      process: 'process'
    })
  ],
  define: {
    global: 'globalThis',
    'process.env': {}
  },
  resolve: {
    alias: {
      peerpigeon: path.resolve(__dirname, '../../src/index.ts'),
      events: 'events',
      util: 'util',
      stream: 'stream-browserify',
      buffer: 'buffer',
      process: 'process/browser'
    }
  },
  optimizeDeps: {
    include: ['events', 'util', 'stream-browserify', 'buffer', 'process']
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr,
    allowedHosts: ['peer.local', 'peerpigeon.local'],
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  }
})
