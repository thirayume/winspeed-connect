import { test, expect } from '@playwright/test';

// Owner, 18 Nov 2026: the bill price moves up or down in steps of 100 baht; the colour says whether the discount
// needs no approval (up to 200), needs approval (up to 300) or cannot be saved (beyond 300, or off the step).
// The server decides the colour; this fixture answers like the real rule so the screen wiring can be checked.
const ANNOUNCED = 19000;
function level(price: number) {
  const below = ANNOUNCED - price;
  if (Math.round(below * 100) % 10000 !== 0) return 'OFF_STEP';
  if (price > ANNOUNCED) return 'GREEN';
  if (price === ANNOUNCED) return 'EQUAL';
  if (below <= 200) return 'BELOW_STANDARD';
  return below <= 300 ? 'YELLOW' : 'RED';
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/so/123')) {
      return route.fulfill({ json: { id: 123, soPrefix: 'I', custId: '1078', custName: 'ลูกค้าตัวอย่าง', deliveryDate: '2026-12-01',
        truckPlate: 'TEST-1', status: 'DRAFT', lines: [{ goodId: '1114', goodCode: 'G-1114', goodName: 'ปุ๋ยตัวอย่าง', qtyTon: 1, pricePerTon: ANNOUNCED }] } });
    }
    if (url.pathname.endsWith('/so/price-indicator')) {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: { lines: body.lines.map((l: any) => ({ key: l.key, level: level(Number(l.pricePerTon)), belowThreshold: false })), belowThreshold: false } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/tests/price-step.html');
  await expect(page.getByLabel('ราคาต่อตัน')).toHaveValue(String(ANNOUNCED));
});

test('the − and + buttons move the price by 100 and the colour follows the discount bands', async ({ page }) => {
  const price = page.getByLabel('ราคาต่อตัน');
  const down = page.getByRole('button', { name: 'ลดราคา 100 บาท' });
  const up = page.getByRole('button', { name: 'เพิ่มราคา 100 บาท' });
  await expect(page.getByText('เท่าราคาประกาศ', { exact: true })).toBeVisible();

  await down.click();
  await expect(price).toHaveValue('18900');
  await down.click();
  await expect(price).toHaveValue('18800');
  await expect(page.getByText('ต่ำกว่าราคาประกาศ (ไม่ต้องขออนุมัติ)')).toBeVisible();

  await down.click();
  await expect(price).toHaveValue('18700');
  await expect(page.getByText('ต่ำกว่าราคาประกาศเกินเกณฑ์ (ต้องขออนุมัติ)')).toBeVisible();

  await down.click();
  await expect(price).toHaveValue('18600');
  await expect(page.getByText('ลดราคาเกินเพดาน (บันทึกไม่ได้)')).toBeVisible();

  for (let i = 0; i < 5; i++) await up.click();
  await expect(price).toHaveValue('19100');
  await expect(page.getByText('สูงกว่าราคาประกาศ', { exact: true })).toBeVisible();
});

test('a typed price off the 100-baht step is flagged', async ({ page }) => {
  const price = page.getByLabel('ราคาต่อตัน');
  await price.fill('18950');
  await expect(page.getByText('ปรับราคาได้ทีละ 100 บาท (บันทึกไม่ได้)')).toBeVisible();
  await price.press('ArrowUp');
  await expect(price).toHaveValue('19000');
});
