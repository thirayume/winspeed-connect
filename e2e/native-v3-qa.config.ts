import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'.',testMatch:'native-v3-qa.spec.ts',fullyParallel:false,workers:1,retries:0,
 outputDir:'../scratch/native-v3-ui-artifacts',reporter:[['list']],
 timeout:120_000,expect:{timeout:20_000},
 use:{baseURL:'http://127.0.0.1:13298',trace:'off',video:'off',screenshot:'only-on-failure',...devices['Desktop Chrome']},
});
