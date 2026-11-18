import { test, expect } from '@playwright/test';

// Owner, 18 Nov 2026: with 178 pages there was no quick way to page 100 or the last page, and no rows-per-page choice.
const TOTAL = 8889;
let requests: URLSearchParams[] = [];

test.beforeEach(async ({ page }) => {
  requests = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/master/aging/search')) return route.fulfill({ json: [] });
    requests.push(url.searchParams);
    const pageNo = Number(url.searchParams.get('page') || 1);
    const size = Number(url.searchParams.get('pageSize') || 50);
    const first = (pageNo - 1) * size;
    const data = Array.from({ length: Math.max(0, Math.min(size, TOTAL - first)) }, (_, i) => ({
      SoId: String(first + i + 1), WfRef: `FIXTURE-${first + i + 1}`, CustName: 'Fixture customer', TruckPlate: 'ไม่ระบุรถ',
      GoodCode: '1', GoodName: 'Fixture good', QtyTon: 1, DaysOpen: 10, Status: 'CONFIRMED', CreatedAt: '2026-11-01',
    }));
    await route.fulfill({ json: { total: TOTAL, page: pageNo, pageSize: size, bills: 526, tons: 16494.21, maxDays: 317, data } });
  });
  await page.goto('/tests/pagination.html');
  await expect(page.getByTestId('pagination-summary')).toHaveText(/แสดง 1–50 จาก 8,889 รายการสินค้า/);
});

test('jumps straight to page 100, to the last page and back to the first', async ({ page }) => {
  await page.getByTestId('pagination-jump').fill('100');
  await page.getByTestId('pagination-jump').press('Enter');
  await expect(page.getByTestId('pagination-summary')).toHaveText(/แสดง 4,951–5,000 จาก 8,889/);
  await expect(page.getByRole('button', { name: '100', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(requests.at(-1)?.get('page')).toBe('100');

  await page.getByTestId('pagination-last').click();
  await expect(page.getByTestId('pagination-summary')).toHaveText(/แสดง 8,851–8,889 จาก 8,889/);
  await expect(page.getByTestId('pagination-next')).toBeDisabled();
  expect(requests.at(-1)?.get('page')).toBe('178');

  await page.getByTestId('pagination-first').click();
  await expect(page.getByTestId('pagination-summary')).toHaveText(/แสดง 1–50 จาก 8,889/);
  await expect(page.getByTestId('pagination-prev')).toBeDisabled();
});

test('a page beyond the last one lands on the last page', async ({ page }) => {
  await page.getByTestId('pagination-jump').fill('5000');
  await page.getByTestId('pagination-go').click();
  await expect(page.getByTestId('pagination-summary')).toHaveText(/แสดง 8,851–8,889 จาก 8,889/);
});

test('rows per page changes the request, goes back to page 1, and is remembered', async ({ page }) => {
  await page.getByTestId('pagination-last').click();
  await expect(page.getByTestId('pagination-summary')).toHaveText(/แสดง 8,851–8,889/);
  await page.getByTestId('pagination-size').selectOption('200');
  await expect(page.getByTestId('pagination-summary')).toHaveText(/แสดง 1–200 จาก 8,889/);
  expect(requests.at(-1)?.get('pageSize')).toBe('200');
  expect(requests.at(-1)?.get('page')).toBe('1');
  await expect(page.getByRole('button', { name: '45', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('pagination-summary')).toHaveText(/แสดง 1–200 จาก 8,889/);
  await expect(page.getByTestId('pagination-size')).toHaveValue('200');
});

test('the summary shows outstanding bills and tons for the whole result, not one page', async ({ page }) => {
  await expect(page.getByText('บิลค้างส่ง:')).toContainText('526');
  await expect(page.getByText('ปริมาณที่ยังไม่ส่ง:')).toContainText('16,494.21');
  await expect(page.getByText('ค้างส่งนานสุด:')).toContainText('317');
});
