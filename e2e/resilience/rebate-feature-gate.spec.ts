import { test, expect } from '@playwright/test';

test('Pool screens do not request Pool APIs until the server feature is present', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    requests.push(url.pathname);
    if (url.pathname.endsWith('/admin/reset')) return route.fulfill({ json: { enabled: false }, headers });
    if (url.pathname.endsWith('/oct31-prices')) return route.fulfill({ json: { items: [] }, headers });
    if (url.pathname.endsWith('/customers')) return route.fulfill({ json: { items: [], total: 0 }, headers });
    return route.fulfill({ json: [], headers });
  });
  await page.goto('/tests/rebate-feature-gate.html');
  await expect(page.getByText('Rebate Pool ยังไม่เปิดใช้งานในระบบนี้', { exact: true })).toBeVisible();
  await expect(page.getByText('Rebate Pool ยังไม่เปิดใช้งานในระบบนี้ จึงยังไม่สามารถเริ่มยอดใหม่ได้')).toBeVisible();
  await page.waitForTimeout(250);
  expect(requests.filter(p => p.includes('/rebate-pool/'))).toEqual([]);
  await page.getByRole('button', { name: 'เปิดสำหรับทดสอบ' }).click();
  await expect.poll(() => requests.some(p => p.endsWith('/rebate-pool/ledger'))).toBe(true);
  await expect.poll(() => requests.some(p => p.endsWith('/rebate-pool/admin/reset'))).toBe(true);
  await page.getByRole('button', { name: 'ปิดสำหรับทดสอบ', exact: true }).click();
  await expect(page.getByText('Rebate Pool ยังไม่เปิดใช้งานในระบบนี้', { exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  const offCount = requests.filter(p => p.includes('/rebate-pool/')).length;
  await page.waitForTimeout(250);
  expect(requests.filter(p => p.includes('/rebate-pool/')).length).toBe(offCount);
});
