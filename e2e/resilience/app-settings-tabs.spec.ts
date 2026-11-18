import { test, expect } from '@playwright/test';

// UAT feedback 18 Nov 2026 (picture 6): "start Rebate again" shows only while the Rebate Pool switch is on.
// The tab must not disappear for good: the owner's Rebate reset on Production still needs it.
test('the Rebate reset tab follows the Rebate Pool switch', async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/rebate-pool/admin/reset')) return route.fulfill({ json: { enabled: false } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/tests/app-settings-tabs.html');
  const tab = page.getByRole('tab', { name: 'เริ่มยอด Rebate ใหม่' });
  await expect(page.getByRole('tab', { name: 'กำหนดรับสินค้า' })).toBeVisible();
  await expect(tab).toHaveCount(0);

  await page.getByRole('button', { name: 'Pool on', exact: true }).click();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.getByRole('heading', { name: 'เริ่มยอด Rebate ใหม่ทุกฐานในระบบนี้' })).toBeVisible();

  // Switching the pool off while on the tab falls back to the first tab instead of an empty page.
  await page.getByRole('button', { name: 'Pool off', exact: true }).click();
  await expect(tab).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'กำหนดรับสินค้า' })).toHaveAttribute('aria-selected', 'true');
});
