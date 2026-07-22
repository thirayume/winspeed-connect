import { test, expect } from '@playwright/test';
import { api, findOrder, login, openSidebar, runSuffix } from './helpers';

const tripPlate = runSuffix('CMP');

test.describe('Comprehensive Sales Trip E2E', () => {
  test('multi-bill trip is traceable and blocked by the verification gate', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    page.on('dialog', dialog => dialog.accept());
    await login(page, 'e2e_sales', 'E2E Sales');
    await openSidebar(page, 'ขาย');
    await page.getByRole('button', { name: 'สร้างบิล' }).click();
    await page.getByPlaceholder('ค้นหาชื่อลูกค้า...').fill('ทดสอบ');
    const customerOption = page.locator('.max-h-60 .font-bold', { hasText: 'คุณสมศักดิ์ ทดสอบ' });
    await expect(customerOption).toHaveCount(1);
    await customerOption.click();
    await page.getByPlaceholder('เช่น กจ70-4088').fill(tripPlate);
    await page.getByRole('button', { name: 'ยืนยันและเริ่มจัดออร์เดอร์' }).click();

    const products = page.locator('.grid.grid-cols-2 button, .grid.grid-cols-3 button, .grid.grid-cols-4 button');
    await expect.poll(() => products.count(), { timeout: 10_000 }).toBeGreaterThan(1);
    await products.first().click();
    const firstCart = page.locator('.p-3.rounded-lg.border').first();
    await firstCart.locator('input[type="number"][step="0.001"]').first().fill('3.125');
    await firstCart.locator('input[type="number"]').last().fill('5000');
    await page.getByRole('button', { name: 'บันทึกการจัดรถ' }).click();
    await page.getByRole('button', { name: 'ตกลง' }).click();

    const addFromModal = page.getByRole('button', { name: 'เพิ่มบิลใหม่ในทริปนี้' });
    await expect(addFromModal).toBeVisible({ timeout: 15_000 });
    await addFromModal.click();

    const prefix = page.locator('select').first();
    await expect(prefix).toBeVisible();
    await prefix.selectOption('K');
    await products.nth(1).click();
    const secondCart = page.locator('.p-3.rounded-lg.border').last();
    await secondCart.locator('input[type="number"][step="0.001"]').first().fill('2');
    await page.getByRole('button', { name: 'บันทึกการจัดรถ' }).click();
    await page.getByRole('button', { name: 'ตกลง' }).click();

    await expect.poll(async () => (await findOrder(page, tripPlate)).filter(row => row.truckPlate === tripPlate).length, {
      timeout: 20_000,
      message: `two bills for ${tripPlate} were not persisted`,
    }).toBeGreaterThanOrEqual(2);
    const orders = (await findOrder(page, tripPlate)).filter(row => row.truckPlate === tripPlate);
    expect(orders.every(order => order.status === 'DRAFT')).toBeTruthy();

    const details = [];
    for (const order of orders) {
      details.push((await api<any>(page, `/so/${encodeURIComponent(String(order.id))}`)).body);
    }
    const lines = details.flatMap(detail => detail.lines || []);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const gates = [];
    for (const order of orders) {
      const response = await api<any>(page, `/so/${encodeURIComponent(String(order.id))}/confirm`, {
        method: 'PATCH',
        data: {},
        expectedStatuses: [400],
      });
      expect(response.body.message).toMatch(/ตรวจซ้ำ/);
      gates.push({ id: order.id, message: response.body.message });
    }

    await testInfo.attach('multi-bill-gate.json', {
      body: Buffer.from(JSON.stringify({
        plate: tripPlate,
        orders: orders.map(order => ({ id: order.id, wfRef: order.wfRef, status: order.status })),
        gates,
      }, null, 2)),
      contentType: 'application/json',
    });
  });
});
