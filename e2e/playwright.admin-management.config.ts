import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: '.',
  testMatch: 'admin-management.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../test-results/admin-management',
  use: { baseURL: 'http://127.0.0.1:5187', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    cwd: path.resolve(__dirname, '..'),
    command: 'npm --prefix WSSale-App run dev -- --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: !process.env.CI,
  },
});
