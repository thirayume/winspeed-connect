# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: comprehensive-sales.spec.ts >> Comprehensive Sales Trip E2E >> multi-bill trip is traceable and blocked by the verification gate
- Location: e2e\comprehensive-sales.spec.ts:7:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'WS-Sale-App' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('heading', { name: 'WS-Sale-App' })

```

# Test source

```ts
  1  | import { expect, type Page } from '@playwright/test';
  2  | 
  3  | export const E2E_PASSWORD = process.env.E2E_PASSWORD || 'W0rldF3rt';
  4  | export const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3000/api';
  5  | 
  6  | export type ApiResult<T> = {
  7  |   status: number;
  8  |   body: T;
  9  | };
  10 | 
  11 | export async function login(page: Page, username: string, expectedDisplayName: string) {
  12 |   await page.goto('/');
> 13 |   await expect(page.getByRole('heading', { name: 'WS-Sale-App' })).toBeVisible();
     |                                                                    ^ Error: expect(locator).toBeVisible() failed
  14 |   await page.locator('input[type="text"]').fill(username);
  15 |   await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  16 |   await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  17 |   await expect(page.getByText(expectedDisplayName, { exact: true })).toBeVisible({ timeout: 15_000 });
  18 | }
  19 | 
  20 | export async function logout(page: Page) {
  21 |   await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  22 |   await expect(page.getByRole('heading', { name: 'WS-Sale-App' })).toBeVisible();
  23 | }
  24 | 
  25 | export async function openSidebar(page: Page, title: string) {
  26 |   const button = page.locator(`aside button[title="${title}"]`);
  27 |   await expect(button).toHaveCount(1);
  28 |   await expect(button).toBeVisible();
  29 |   await button.click({ force: true });
  30 | }
  31 | 
  32 | export async function api<T>(
  33 |   page: Page,
  34 |   path: string,
  35 |   options: { method?: string; data?: unknown; expectedStatuses?: number[] } = {},
  36 | ): Promise<ApiResult<T>> {
  37 |   const token = await page.evaluate(() => localStorage.getItem('wssale_token'));
  38 |   expect(token, `JWT is missing before ${options.method || 'GET'} ${path}`).toBeTruthy();
  39 |   const response = await page.request.fetch(`${API_BASE}${path}`, {
  40 |     method: options.method || 'GET',
  41 |     data: options.data,
  42 |     headers: {
  43 |       Authorization: `Bearer ${token}`,
  44 |       'Content-Type': 'application/json',
  45 |       'X-DB-Target': 'local',
  46 |     },
  47 |   });
  48 |   const text = await response.text();
  49 |   let body: unknown = null;
  50 |   try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  51 |   const allowed = options.expectedStatuses || [200];
  52 |   expect(
  53 |     allowed,
  54 |     `${options.method || 'GET'} ${path} returned ${response.status()}: ${text.slice(0, 500)}`,
  55 |   ).toContain(response.status());
  56 |   return { status: response.status(), body: body as T };
  57 | }
  58 | 
  59 | export async function publicApi<T>(page: Page, path: string): Promise<ApiResult<T>> {
  60 |   const response = await page.request.get(`${API_BASE}${path}`, { headers: { 'X-DB-Target': 'local' } });
  61 |   const text = await response.text();
  62 |   let body: unknown = null;
  63 |   try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  64 |   expect(response.ok(), `GET ${path} returned ${response.status()}: ${text.slice(0, 500)}`).toBeTruthy();
  65 |   return { status: response.status(), body: body as T };
  66 | }
  67 | 
  68 | export async function findOrder(page: Page, wfRefOrPlate: string) {
  69 |   const result = await api<{ data: any[] }>(page, `/so?search=${encodeURIComponent(wfRefOrPlate)}&limit=100`);
  70 |   return result.body.data || [];
  71 | }
  72 | 
  73 | export async function waitForOrderByPlate(page: Page, plate: string) {
  74 |   let order: any | undefined;
  75 |   await expect.poll(async () => {
  76 |     const rows = await findOrder(page, plate);
  77 |     order = rows.find(row => row.truckPlate === plate);
  78 |     return order?.wfRef || null;
  79 |   }, { timeout: 20_000, message: `order with plate ${plate} was not created` }).not.toBeNull();
  80 |   return order!;
  81 | }
  82 | 
  83 | export async function waitForOrderStatus(page: Page, wfRef: string, status: string) {
  84 |   let order: any | undefined;
  85 |   await expect.poll(async () => {
  86 |     const rows = await findOrder(page, wfRef);
  87 |     order = rows.find(row => row.wfRef === wfRef);
  88 |     return order?.status || null;
  89 |   }, { timeout: 25_000, message: `${wfRef} did not reach ${status}` }).toBe(status);
  90 |   return order!;
  91 | }
  92 | 
  93 | export function runSuffix(prefix: string) {
  94 |   const source = process.env.E2E_RUN_ID || Date.now().toString(36);
  95 |   return `${prefix}-${source.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}`;
  96 | }
  97 | 
```