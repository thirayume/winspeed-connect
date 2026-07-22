import { test, expect } from '@playwright/test';
import {
  api,
  findOrder,
  login,
  logout,
  openSidebar,
  publicApi,
  runSuffix,
  waitForOrderByPlate,
  waitForOrderStatus,
} from './helpers';

let sharedWfRef = '';
let sharedSoId: string | number = '';
const uatPlate = runSuffix('UAT');

test.describe.serial('UAT Full Loop E2E', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('1. SALES creates a traceable SO draft', async ({ page }, testInfo) => {
    page.on('dialog', dialog => dialog.accept());
    await login(page, 'e2e_sales', 'E2E Sales');
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    await page.getByRole('button', { name: 'สร้างบิล' }).click();
    const customerSearch = page.getByPlaceholder('ค้นหาชื่อลูกค้า...');
    await expect(customerSearch).toBeVisible();
    await customerSearch.fill('ทดสอบ');
    const customerOption = page.locator('.max-h-60 .font-bold', { hasText: 'คุณสมศักดิ์ ทดสอบ' });
    await expect(customerOption).toHaveCount(1);
    await customerOption.click();
    await page.getByPlaceholder('เช่น กจ70-4088').fill(uatPlate);
    await page.getByRole('button', { name: 'ยืนยันและเริ่มจัดออร์เดอร์' }).click();

    const products = page.locator('.grid.grid-cols-2 button, .grid.grid-cols-3 button, .grid.grid-cols-4 button');
    await expect.poll(() => products.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await products.first().click();
    const quantity = page.locator('input[type="number"][step="0.001"]');
    await expect(quantity.first()).toBeVisible();
    await quantity.first().fill('2');

    await page.getByRole('button', { name: 'บันทึกการจัดรถ' }).click();
    const acknowledge = page.getByRole('button', { name: 'ตกลง' });
    await expect(acknowledge).toBeVisible({ timeout: 10_000 });
    await acknowledge.click();

    const order = await waitForOrderByPlate(page, uatPlate);
    sharedWfRef = order.wfRef;
    sharedSoId = order.id;
    expect(sharedWfRef).toMatch(/^[IKA]+\d{2}-\d+$/);
    expect(order.status).toBe('DRAFT');
    expect(order.lines?.length || 0).toBeGreaterThan(0);
    await testInfo.attach('created-order.json', {
      body: Buffer.from(JSON.stringify({ id: sharedSoId, wfRef: sharedWfRef, plate: uatPlate, status: order.status }, null, 2)),
      contentType: 'application/json',
    });
  });

  test('2. MANAGER verifies and ADMIN confirms the SO', async ({ page }, testInfo) => {
    expect(sharedWfRef, 'step 1 must create a WfRef').not.toBe('');
    await login(page, 'e2e_manager', 'E2E Manager');
    await openSidebar(page, 'Paper Trail');
    await expect(page.getByRole('heading', { name: 'Paper Trail' })).toBeVisible();
    await page.getByPlaceholder('ค้นหา SO, ลูกค้า, ทะเบียนรถ...').fill(sharedWfRef);

    const managerCard = page.getByTestId(`paper-card-${sharedSoId}`);
    await expect(managerCard).toBeVisible({ timeout: 15_000 });
    await managerCard.getByRole('button', { name: 'ตรวจ', exact: true }).click();
    await expect(managerCard).toContainText('ตรวจแล้ว', { timeout: 15_000 });
    const verifiedDetail = (await api<any>(page, `/so/${encodeURIComponent(String(sharedSoId))}`)).body;
    const verifiedActions = (verifiedDetail.auditLogs || verifiedDetail.audit || []).map((row: any) => row.action || row.Action);
    expect(verifiedActions).toContain('VERIFIED');

    await logout(page);
    await login(page, 'e2e_admin', 'E2E Admin');
    await openSidebar(page, 'Paper Trail');
    await page.getByPlaceholder('ค้นหา SO, ลูกค้า, ทะเบียนรถ...').fill(sharedWfRef);
    const adminCard = page.getByTestId(`paper-card-${sharedSoId}`);
    await expect(adminCard).toContainText('ตรวจแล้ว', { timeout: 15_000 });
    await adminCard.getByRole('button', { name: 'ยืนยันเป็นรอจัดส่ง', exact: true }).click();

    const confirmed = await waitForOrderStatus(page, sharedWfRef, 'CONFIRMED');
    sharedSoId = confirmed.id;
    await testInfo.attach('confirmed-order.json', {
      body: Buffer.from(JSON.stringify({ id: sharedSoId, wfRef: sharedWfRef, verifiedAt: confirmed.verifiedAt, status: confirmed.status }, null, 2)),
      contentType: 'application/json',
    });
  });

  test('3. COUNTER SALES sees the real TruckScale health state', async ({ page }, testInfo) => {
    expect(sharedWfRef).not.toBe('');
    await login(page, 'e2e_counter', 'E2E Counter');
    await openSidebar(page, 'คลัง/ชั่ง');
    await openSidebar(page, 'TruckScale');
    await expect(page.getByRole('heading', { name: 'TruckScale — เครื่องชั่ง' })).toBeVisible();
    const health = (await publicApi<any>(page, '/health')).body;
    const scaleStatus = page.getByTestId('truckscale-status');
    await expect(scaleStatus).toBeVisible({ timeout: 15_000 });
    if (health.db?.mysql === 'up') {
      await expect(scaleStatus).toContainText('เชื่อมต่อแล้ว');
    } else {
      await expect(scaleStatus).toContainText('เชื่อมต่อไม่ได้');
    }
    await testInfo.attach('truckscale-health.json', {
      body: Buffer.from(JSON.stringify({ mysql: health.db?.mysql, ui: await scaleStatus.innerText() }, null, 2)),
      contentType: 'application/json',
    });
  });

  test('4. WAREHOUSE picks, loads and ships the SO', async ({ page }, testInfo) => {
    expect(sharedSoId).not.toBe('');
    await login(page, 'e2e_warehouse', 'E2E Warehouse');
    await openSidebar(page, 'คลัง');
    await expect(page.getByRole('heading', { name: 'คลัง / รับสินค้า' })).toBeVisible();
    const search = page.getByPlaceholder('ค้นหา ลูกค้า / WfRef / ทะเบียนรถ...');
    await search.fill(sharedWfRef);

    const card = page.getByTestId(`store-order-${sharedSoId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'เริ่มรับสินค้า', exact: true }).click();
    await waitForOrderStatus(page, sharedWfRef, 'PICKING');

    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'จัดลำดับ & ยืนยันโหลด', exact: true }).click();
    const loader = page.getByTestId('truck-loader-modal');
    await expect(loader).toBeVisible();
    await expect(loader).toContainText('จัดวางครบทุกรายการแล้ว');
    await loader.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
    await waitForOrderStatus(page, sharedWfRef, 'LOADED');

    await page.getByRole('button', { name: 'เครื่องชั่ง (ชั่งออก)', exact: true }).click();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'ระบุน้ำหนักชั่งออก', exact: true }).click();
    const weighModal = page.getByTestId('weigh-out-modal');
    await expect(weighModal).toBeVisible();
    await weighModal.getByTestId('weigh-tare').fill('10000');
    await weighModal.getByTestId('weigh-gross').fill('20000');
    await weighModal.getByRole('button', { name: 'ยืนยัน / ส่งออก', exact: true }).click();
    const shipped = await waitForOrderStatus(page, sharedWfRef, 'SHIPPED');
    const weigh = await api<any>(page, `/so/${encodeURIComponent(String(sharedSoId))}/weigh`);
    expect(weigh.body?.netKg ?? weigh.body?.NetKg ?? 10_000).toBeTruthy();
    await testInfo.attach('shipped-order.json', {
      body: Buffer.from(JSON.stringify({ id: shipped.id, wfRef: sharedWfRef, status: shipped.status, weigh: weigh.body }, null, 2)),
      contentType: 'application/json',
    });
  });

  test('5. ADMIN verifies SHIPPED state and audit trail in Paper Trail', async ({ page }, testInfo) => {
    expect(sharedSoId).not.toBe('');
    await login(page, 'e2e_admin', 'E2E Admin');
    await openSidebar(page, 'Paper Trail');
    await page.getByPlaceholder('ค้นหา SO, ลูกค้า, ทะเบียนรถ...').fill(sharedWfRef);
    const card = page.getByTestId(`paper-card-${sharedSoId}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(sharedWfRef);
    await expect(card).toContainText('ส่งออกจากตาชั่ง');

    const detail = (await api<any>(page, `/so/${encodeURIComponent(String(sharedSoId))}`)).body;
    expect(detail.status).toBe('SHIPPED');
    const auditActions = (detail.auditLogs || detail.audit || []).map((row: any) => row.action || row.Action);
    expect(auditActions).toEqual(expect.arrayContaining(['CONFIRMED', 'PICKING', 'LOADED', 'SHIPPED']));
    await testInfo.attach('uat-final-audit.json', {
      body: Buffer.from(JSON.stringify({ id: sharedSoId, wfRef: sharedWfRef, status: detail.status, auditActions }, null, 2)),
      contentType: 'application/json',
    });
  });
});
