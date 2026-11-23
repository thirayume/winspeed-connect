import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./resilience',testMatch:'report-readiness.spec.ts',workers:1,timeout:30000,
 outputDir:'../test-results/report-readiness',use:{baseURL:'http://127.0.0.1:5193',viewport:{width:1600,height:1100},trace:'retain-on-failure'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5193 --strictPort',cwd:'../WSSale-App',url:'http://127.0.0.1:5193/tests/report-readiness.html',reuseExistingServer:false,timeout:30000}});
