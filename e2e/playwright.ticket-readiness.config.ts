import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./resilience',testMatch:'ticket-readiness.spec.ts',workers:1,timeout:30000,
 outputDir:'../test-results/ticket-readiness',use:{baseURL:'http://127.0.0.1:5194',viewport:{width:1600,height:1000},trace:'retain-on-failure'},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5194 --strictPort',cwd:'../WSSale-App',url:'http://127.0.0.1:5194/tests/ticket-readiness.html',reuseExistingServer:false,timeout:30000}});
