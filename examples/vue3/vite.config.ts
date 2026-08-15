import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import inject from '@rollup/plugin-inject';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../..');
const peerPigeonSourceRoot = path.resolve(workspaceRoot, 'src');

export default defineConfig({
  plugins: [
    {
      name: 'peerpigeon-core-full-reload',
      configureServer(server) {
        server.watcher.add(peerPigeonSourceRoot);
        server.watcher.on('change', (file) => {
          if (path.resolve(file).startsWith(`${peerPigeonSourceRoot}${path.sep}`)) {
            server.ws.send({ type: 'full-reload', path: '*' });
          }
        });
      }
    },
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
    fs: {
      allow: [workspaceRoot]
    },
    allowedHosts: ['peer.local'],
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0'
    }
  }
});
