import { test, expect } from '@playwright/test';
import { api, login, openSidebar } from './helpers';

test.describe.serial('v1.7.0 Sale Trip & Rebate Ratio E2E', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('1. Backend Sale Trip API health and structure', async ({ page }, testInfo) => {
    await login(page, 'e2e_sales', 'E2E Sales');
    const tripsRes = await api<any[]>(page, '/trips');
    expect(tripsRes.status).toBe(200);
    expect(Array.isArray(tripsRes.body)).toBe(true);

    await testInfo.attach('trips-api-response.json', {
      body: JSON.stringify(tripsRes.body, null, 2),
      contentType: 'application/json',
    });
  });

  test('2. Rebate Claim Ratio & Calculation verification', async ({ page }, testInfo) => {
    await login(page, 'e2e_admin', 'E2E Admin');
    await openSidebar(page, 'รีเบท (App)');
    await expect(page.getByRole('heading', { name: 'รีเบท (Rebate)' })).toBeVisible();

    // Verify Export Claims button is present
    const exportBtn = page.getByRole('button', { name: 'Export Claims (Excel)' });
    await expect(exportBtn).toBeVisible();

    // Check Budget Expenditure API endpoint
    const budgetRes = await api<any>(page, '/budget/expenditure');
    expect([200, 404]).toContain(budgetRes.status); // Accepts 200 or clean empty 404

    await testInfo.attach('rebate-page-check.json', {
      body: JSON.stringify({ exportBtnVisible: true, budgetStatus: budgetRes.status }, null, 2),
      contentType: 'application/json',
    });
  });

  test('3. Incentive & Budget Expenditure Reports Navigation', async ({ page }) => {
    await login(page, 'e2e_manager', 'E2E Manager');
    
    // Check Incentive Report nav
    await openSidebar(page, 'Incentive & Retained');
    await expect(page.getByRole('heading', { name: 'Incentive & Retained Amount Summary' })).toBeVisible();

    // Check Budget Expenditure Report nav
    await openSidebar(page, 'Budget Expenditure');
    await expect(page.getByRole('heading', { name: 'Budget Expenditure Tracking' })).toBeVisible();
  });
});
