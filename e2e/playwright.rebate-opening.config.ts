import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './resilience', testMatch: 'rebate-opening.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5177', browserName: 'chromium' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5177 --strictPort', cwd: '../WSSale-App',
    url: 'http://127.0.0.1:5177/tests/rebate-opening.html', reuseExistingServer: false, timeout: 30000 },
});
