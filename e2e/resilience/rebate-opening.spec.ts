import { test, expect } from '@playwright/test';

test('opening balance can be selected without old document IDs or user-controlled prices', async ({ page }) => {
  let body: any;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith('/system-settings')) return route.fulfill({ json: { settings: { CUSTOMER_RATIO: 100 } }, headers });
    if (url.pathname.endsWith('/accrual/123/opening')) return route.fulfill({ json: [{ GoodCode: 'TEST', GoodName: 'ปุ๋ยทดสอบ', RemainingTon: 2, RemainingAmt: 1600 }], headers });
    if (url.pathname.endsWith('/accrual/123')) return route.fulfill({ json: [], headers });
    if (url.pathname.endsWith('/claims')) { body = route.request().postDataJSON(); return route.fulfill({ json: { Id: 10 }, headers }); }
    return route.fulfill({ json: {}, headers });
  });
  await page.goto('/tests/rebate-opening.html');
  await page.getByTestId('claim-cust-id-input').fill('123');
  await page.getByTestId('fetch-lots-button').click();
  await page.getByRole('button', { name: 'ใช้ยอดยกมา' }).click();
  await expect(page.getByText('ยอดยกมาเป็นประมาณการจากล็อตจริง ระบบตรวจยอดอีกครั้งเมื่อบันทึก')).toBeVisible();
  await expect(page.getByText('ประมาณ 1,600.00')).toBeVisible();
  await expect(page.getByTestId('line-pricePerTon-0')).toBeDisabled();
  await page.getByTestId('line-qtyTon-0').fill('1');
  await expect(page.getByText('ยอดยกมาบางส่วนจะคำนวณจากล็อตจริงเมื่อบันทึก ยอดด้านล่างยังไม่รวมส่วนนี้')).toBeVisible();
  await page.getByTestId('line-qtyTon-0').fill('2');
  await page.getByTestId('submit-claim-button').click();
  await expect.poll(() => body).toBeTruthy();
  expect(body.lines[0]).toMatchObject({ goodCode: 'TEST', qtyTon: 2, openingBalance: true });
  expect(body.lines[0].sourceSOID).toBeUndefined();
  expect(body.lines[0].sourceListNo).toBeUndefined();
  expect(body.poolId).toBeUndefined();
});
