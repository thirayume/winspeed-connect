import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: '.',
  testMatch: 'trip-setup-regression.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../test-results/trip-setup-regression',
  use: { baseURL: 'http://127.0.0.1:5189', headless: true },
  webServer: {
    cwd: path.resolve(__dirname, '..'),
    command: 'npm --prefix WSSale-App run dev -- --host 127.0.0.1 --port 5189 --strictPort',
    url: 'http://127.0.0.1:5189',
    reuseExistingServer: !process.env.CI,
  },
});
