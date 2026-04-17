import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    include: ['gossip-protocol', 'unsea'],
    esbuildOptions: {
      target: 'safari15',
    },
  },
  build: {
    target: 'safari15',
  },
  server: {
    hmr: true,
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
