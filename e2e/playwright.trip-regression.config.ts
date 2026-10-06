import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'trip-setup-regression.spec.ts',workers:1,retries:0,reporter:'list',use:{headless:true},outputDir:'../test-results/trip-setup-regression'});
