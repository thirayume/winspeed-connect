import { test, expect } from '@playwright/test';
import { login, openSidebar, publicApi } from './helpers';

test.describe('WS-Sale-App V1.0 role navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('ADMIN can login, use Access As and return to ADMIN', async ({ page }, testInfo) => {
    await login(page, 'e2e_admin', 'E2E Admin');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.locator('button[title="Access As"]').click();
    await page.getByPlaceholder('ค้นหาชื่อ').fill('e2e_sales');
    await page.getByRole('button', { name: /E2E Sales/ }).click();
    await expect(page.getByText('E2E Sales', { exact: true })).toBeVisible();

    await page.locator('button[title="Access As"]').click();
    await page.getByRole('button', { name: /กลับเป็น/ }).click();
    await expect(page.getByText('E2E Admin', { exact: true })).toBeVisible();
    await testInfo.attach('admin-access-as.txt', { body: Buffer.from('ADMIN -> SALES -> ADMIN'), contentType: 'text/plain' });
  });

  test('SALES can access Quotation', async ({ page }) => {
    await login(page, 'e2e_sales', 'E2E Sales');
    await openSidebar(page, 'เสนอราคา');
    await expect(page.getByRole('heading', { name: 'ใบเสนอราคา' })).toBeVisible();
    await expect(page.getByTitle('สร้างใบเสนอราคา')).toBeVisible();
  });

  test('COUNTER_SALES can access TruckScale with explicit health', async ({ page }) => {
    await login(page, 'e2e_counter', 'E2E Counter');
    await openSidebar(page, 'คลัง/ชั่ง');
    await openSidebar(page, 'TruckScale');
    await expect(page.getByRole('heading', { name: 'TruckScale — เครื่องชั่ง' })).toBeVisible();
    const health = (await publicApi<any>(page, '/health')).body;
    const status = page.getByTestId('truckscale-status');
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(status).toContainText(health.db?.mysql === 'up' ? 'เชื่อมต่อแล้ว' : 'เชื่อมต่อไม่ได้');
  });

  test('WAREHOUSE can access loading and scale queues', async ({ page }) => {
    await login(page, 'e2e_warehouse', 'E2E Warehouse');
    await openSidebar(page, 'คลัง');
    await expect(page.getByRole('heading', { name: 'คลัง / รับสินค้า' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'โกดัง (โหลดสินค้า)', exact: true })).toBeVisible();
    const scaleTab = page.getByRole('button', { name: 'เครื่องชั่ง (ชั่งออก)', exact: true });
    await expect(scaleTab).toBeVisible();
    await scaleTab.click();
    await expect(page.getByTestId('store-queue-scale')).toBeVisible();
  });
});
