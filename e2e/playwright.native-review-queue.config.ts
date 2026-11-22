import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './resilience', testMatch: /(?:native-review-queue|coupon-bridge)\.spec\.ts/, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5182', browserName: 'chromium' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5182 --strictPort', cwd: '../WSSale-App',
    url: 'http://127.0.0.1:5182/tests/native-review-queue.html', reuseExistingServer: false, timeout: 30000 },
});
