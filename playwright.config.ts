import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: process.env.CI ? 'dot' : 'line',
  timeout: 180_000,
  expect: {
    timeout: 120_000
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:5183',
    headless: true,
    viewport: { width: 900, height: 700 }
  },
  webServer: {
    command: 'cd examples/vue3 && npm run dev -- --host 127.0.0.1 --port 5183 --strictPort --clearScreen false',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
