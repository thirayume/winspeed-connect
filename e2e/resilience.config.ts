import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './resilience', workers: 1, timeout: 30000,
  outputDir: './test-results/resilience',
  use: { baseURL:'http://127.0.0.1:5188', viewport:{width:1440,height:1000}, trace:'retain-on-failure' },
  webServer: { cwd: process.cwd(), command:'npm --prefix WSSale-App run dev -- --host 127.0.0.1 --port 5188 --strictPort', url:'http://127.0.0.1:5188', reuseExistingServer:false },
});
