import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: false,
    // Use 0.0.0.0 to allow all network interfaces
    host: '0.0.0.0',
    https: false,
    cors: true,
    // Disable HMR to avoid WebSocket conflicts
    hmr: false
  },
  // Prevent Vite from optimizing PeerPigeon library
  optimizeDeps: {
    exclude: ['peerpigeon']
  }
});
