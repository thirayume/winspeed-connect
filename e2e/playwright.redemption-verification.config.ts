import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './resilience', testMatch: 'redemption-verification.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5181', browserName: 'chromium' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5181 --strictPort', cwd: '../WSSale-App',
    url: 'http://127.0.0.1:5181/tests/redemption-verification.html', reuseExistingServer: false, timeout: 30000 },
});
