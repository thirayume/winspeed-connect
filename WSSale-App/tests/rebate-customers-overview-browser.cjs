'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/api/rebate-pool/customers?*', async route => {
      const url = new URL(route.request().url());
      const search = url.searchParams.get('search');
      if (search === 'fail') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      if (search === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
      const item = search === 'slow' ? { custId: 1, custName: 'OLD', custCode: 'A', status: 'ready', balance: 100, openingBalance: 0 }
        : search === 'new' ? { custId: 2, custName: 'NEW', custCode: 'B', status: 'needs_review', balance: null, openingBalance: null }
        : { custId: 3, custName: 'FIRST', custCode: 'C', status: 'ready', balance: 25, openingBalance: 0 };
      await route.fulfill({ json: { asOfDate: '2026-11-14', nextAfter: null, items: [item] } });
    });
    await page.goto('http://127.0.0.1:5179/tests/rebate-customers-overview.html');
    await page.getByText('FIRST').waitFor();
    await page.getByRole('button', { name: 'ดูคิว FIFO' }).click();
    assert.equal(await page.locator('body').getAttribute('data-selected-customer'), '3');
    const input = page.getByLabel('ค้นหาลูกค้า');
    await input.fill('slow'); await page.getByRole('button', { name: 'ค้นหา' }).click();
    await input.fill('new'); await page.getByRole('button', { name: 'ค้นหา' }).click();
    await page.getByText('NEW').waitFor();
    await page.waitForTimeout(1000);
    assert.equal(await page.getByText('OLD').count(), 0);
    assert.equal(await page.getByText('ไม่พร้อมแสดง').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'ดูคิว FIFO' }).isDisabled(), true);
    await input.fill('fail'); await page.getByRole('button', { name: 'ค้นหา' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('ไม่พบลูกค้าที่มีรายการสะสมตามเงื่อนไขนี้').count(), 0);
    console.log('REBATE_CUSTOMERS_BROWSER=PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
