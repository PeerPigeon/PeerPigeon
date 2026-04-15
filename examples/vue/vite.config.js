import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  base: '/',
  resolve: {
    alias: {
      'peerpigeon': resolve(__dirname, '../../src/index.js')
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    strictPort: false
  },
  optimizeDeps: {
    exclude: ['peerpigeon']
  }
});
