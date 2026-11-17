import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './resilience', testMatch: 'rebate-feature-gate.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5179', browserName: 'chromium' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5179 --strictPort', cwd: '../WSSale-App',
    url: 'http://127.0.0.1:5179/tests/rebate-feature-gate.html', reuseExistingServer: false, timeout: 30000 },
});
