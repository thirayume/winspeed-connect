import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './resilience', testMatch: ['giveaway-date-review.spec.ts', 'quotation-window-lock.spec.ts'], workers: 1,
  use: { baseURL: 'http://127.0.0.1:5178', browserName: 'chromium' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort', cwd: '../WSSale-App',
    url: 'http://127.0.0.1:5178/tests/giveaway-date-review.html', reuseExistingServer: false, timeout: 30000 },
});
