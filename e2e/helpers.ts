import { expect, type Page } from '@playwright/test';

export const E2E_PASSWORD = process.env.E2E_PASSWORD || 'W0rldF3rt';
export const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3000/api';

export type ApiResult<T> = {
  status: number;
  body: T;
};

export async function login(page: Page, username: string, expectedDisplayName: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'WS-Sale-App' })).toBeVisible();
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText(expectedDisplayName, { exact: true })).toBeVisible({ timeout: 15_000 });
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page.getByRole('heading', { name: 'WS-Sale-App' })).toBeVisible();
}

export async function openSidebar(page: Page, title: string) {
  const button = page.locator(`aside button[title="${title}"]`);
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await button.click({ force: true });
}

export async function api<T>(
  page: Page,
  path: string,
  options: { method?: string; data?: unknown; expectedStatuses?: number[] } = {},
): Promise<ApiResult<T>> {
  const token = await page.evaluate(() => localStorage.getItem('wssale_token'));
  expect(token, `JWT is missing before ${options.method || 'GET'} ${path}`).toBeTruthy();
  const response = await page.request.fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    data: options.data,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-DB-Target': 'local',
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  const allowed = options.expectedStatuses || [200];
  expect(
    allowed,
    `${options.method || 'GET'} ${path} returned ${response.status()}: ${text.slice(0, 500)}`,
  ).toContain(response.status());
  return { status: response.status(), body: body as T };
}

export async function publicApi<T>(page: Page, path: string): Promise<ApiResult<T>> {
  const response = await page.request.get(`${API_BASE}${path}`, { headers: { 'X-DB-Target': 'local' } });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  expect(response.ok(), `GET ${path} returned ${response.status()}: ${text.slice(0, 500)}`).toBeTruthy();
  return { status: response.status(), body: body as T };
}

export async function findOrder(page: Page, wfRefOrPlate: string) {
  const result = await api<{ data: any[] }>(page, `/so?search=${encodeURIComponent(wfRefOrPlate)}&limit=100`);
  return result.body.data || [];
}

export async function waitForOrderByPlate(page: Page, plate: string) {
  let order: any | undefined;
  await expect.poll(async () => {
    const rows = await findOrder(page, plate);
    order = rows.find(row => row.truckPlate === plate);
    return order?.wfRef || null;
  }, { timeout: 20_000, message: `order with plate ${plate} was not created` }).not.toBeNull();
  return order!;
}

export async function waitForOrderStatus(page: Page, wfRef: string, status: string) {
  let order: any | undefined;
  await expect.poll(async () => {
    const rows = await findOrder(page, wfRef);
    order = rows.find(row => row.wfRef === wfRef);
    return order?.status || null;
  }, { timeout: 25_000, message: `${wfRef} did not reach ${status}` }).toBe(status);
  return order!;
}

export function runSuffix(prefix: string) {
  const source = process.env.E2E_RUN_ID || Date.now().toString(36);
  return `${prefix}-${source.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}`;
}
