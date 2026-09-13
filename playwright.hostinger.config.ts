import { defineConfig } from '@playwright/test';
import base from './playwright.config';
process.env.E2E_BASE_URL = 'https://test.thirayu.online';
process.env.E2E_API_BASE = 'https://api-test.thirayu.online/api';
process.env.E2E_DB_TARGET = 'server';
export default defineConfig(base, { use: { ...base.use, baseURL: process.env.E2E_BASE_URL } });
