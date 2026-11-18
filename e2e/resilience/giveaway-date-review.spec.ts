import { test, expect } from '@playwright/test';

test('ambiguous monthly withdrawals appear separately with a carry-over explanation', async ({ page }) => {
  await page.route('**/api/giveaway/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/regions')) return route.fulfill({ json: [{ Region: 'เขตทดสอบ', DisplayName: 'พนักงานทดสอบ',
      SalesUserId: 1, TotalBudget: 10, TotalWithdrawn: 3, TotalRemaining: 7, ItemCount: 1, OverCount: 0 }] });
    if (path.endsWith('/withdrawals/date-review')) return route.fulfill({ json: [{ Id: 12, IssueMonth: 6,
      ItemName: 'ของแถมทดสอบ', Qty: 3, Source: 'IMPORT' }] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/tests/giveaway-date-review.html');
  await page.getByText('พนักงานทดสอบ').first().click();
  await page.getByRole('button', { name: /ประวัติเบิก/ }).click();
  await expect(page.getByText('รอตรวจวันที่ (1 รายการที่โหลด)')).toBeVisible();
  await expect(page.getByText(/ยอดคงเหลือยังคำนวณรวมรายการเหล่านี้/)).toBeVisible();
  await expect(page.getByText(/#12.*ของแถมทดสอบ/)).toBeVisible();
});

test('a slow prior region response cannot replace the selected region', async ({ page }) => {
  await page.route('**/api/giveaway/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/regions')) return route.fulfill({ json: [
      { Region: 'เขตหนึ่ง', DisplayName: 'คนที่หนึ่ง', SalesUserId: 1, TotalBudget: 10, TotalWithdrawn: 0, TotalRemaining: 10, ItemCount: 1, OverCount: 0 },
      { Region: 'เขตสอง', DisplayName: 'คนที่สอง', SalesUserId: 2, TotalBudget: 10, TotalWithdrawn: 0, TotalRemaining: 10, ItemCount: 1, OverCount: 0 },
    ] });
    if (url.pathname.endsWith('/withdrawals/date-review')) {
      const first = url.searchParams.get('region') === 'เขตหนึ่ง';
      if (first) await new Promise(resolve => setTimeout(resolve, 600));
      return route.fulfill({ json: [{ Id: first ? 1 : 2, IssueMonth: 6, ItemName: first ? 'ของเขตหนึ่ง' : 'ของเขตสอง', Qty: 1, Source: 'IMPORT' }] });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/tests/giveaway-date-review.html');
  await page.getByText('คนที่หนึ่ง').first().click();
  await page.getByText('คนที่สอง').first().click();
  await page.getByRole('button', { name: /ประวัติเบิก/ }).click();
  await expect(page.getByText(/#2.*ของเขตสอง/)).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByText(/#1.*ของเขตหนึ่ง/)).toHaveCount(0);
  await expect(page.getByText(/#2.*ของเขตสอง/)).toBeVisible();
});
