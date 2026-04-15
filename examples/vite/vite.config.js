import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: 'peerpigeon', replacement: path.resolve(__dirname, '../../index.js') },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    open: true
  },
  optimizeDeps: {
    exclude: ['peerpigeon']
  },
  ssr: {
    noExternal: ['peerpigeon']
  }
});
