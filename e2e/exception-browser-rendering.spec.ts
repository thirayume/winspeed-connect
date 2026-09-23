import { test, expect } from '@playwright/test';
import { login, openSidebar, waitForUiIdle } from './helpers';

test.describe('Exception Presentation Browser & Component Rendering UAT', () => {

  test('[CONTROLLED_MOCK_UAT] SO Sales Billing Projection Exception DOM Rendering', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Controlled Exception Dataset (3 UNKNOWN, 1 NORMAL, 1 OVER_INVOICED)
    const controlledData = {
      type: 'so-sales-billing-projection',
      title: 'รายงานประมาณการขายก่อนลงบัญชี (SO Sales Billing Projection — Not a Posted GL)',
      category: 'sales',
      columns: [
        { key: 'DocuNo', label: 'เลขที่เอกสาร SO', type: 'identifier' },
        { key: 'DocuDate', label: 'วันที่เอกสาร SO', type: 'date' },
        { key: 'CustName', label: 'ชื่อลูกค้า', type: 'text' },
        { key: 'EstimatedAmount', label: 'มูลค่าขายประมาณการ (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
        { key: 'AllocationStatus', label: 'สถานะการจัดสรร', type: 'text' },
        { key: 'Note', label: 'หมายเหตุความหมายข้อมูล', type: 'text' },
        { key: 'RefSO', label: 'อ้างอิง SO ID', type: 'identifier' },
      ],
      rows: [
        {
          DocuNo: 'SO-UAT-UNK-01',
          DocuDate: '2026-09-20',
          CustName: 'ลูกค้าทดสอบ 1',
          EstimatedAmount: null,
          AllocationStatus: 'UNKNOWN',
          Note: 'Unallocated missing reference',
          RefSO: '1001'
        },
        {
          DocuNo: 'SO-UAT-UNK-02',
          DocuDate: '2026-09-20',
          CustName: 'ลูกค้าทดสอบ 2',
          EstimatedAmount: null,
          AllocationStatus: 'UNKNOWN',
          Note: 'Header-only delivery missing lines',
          RefSO: '1002'
        },
        {
          DocuNo: 'SO-UAT-UNK-03',
          DocuDate: '2026-09-20',
          CustName: 'ลูกค้าทดสอบ 3',
          EstimatedAmount: null,
          AllocationStatus: 'UNKNOWN',
          Note: 'Partial invoice with unreferenced line',
          RefSO: '1003'
        },
        {
          DocuNo: 'SO-UAT-NORM-01',
          DocuDate: '2026-09-20',
          CustName: 'ลูกค้าทดสอบ ปกติ',
          EstimatedAmount: 500.00,
          AllocationStatus: 'NORMAL',
          Note: 'Fully mapped delivery',
          RefSO: '1004'
        },
        {
          DocuNo: 'SO-UAT-OVER-01',
          DocuDate: '2026-09-20',
          CustName: 'ลูกค้าทดสอบ เกิน',
          EstimatedAmount: -200.00,
          AllocationStatus: 'OVER_INVOICED',
          Note: 'Invoiced exceed ordered',
          RefSO: '1005'
        }
      ]
    };

    // 2. Intercept report API route with controlled dataset
    await page.route('**/api/reports/so-sales-billing-projection*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(controlledData)
      });
    });

    // 3. Login as accounting role
    await login(page, 'e2e_accounting');
    await waitForUiIdle(page);

    // 4. Open Reports portal via sidebar
    await openSidebar(page, 'รายงาน');
    await waitForUiIdle(page);

    // 5. Select so-sales-billing-projection report
    const projBtn = page.locator('button', { hasText: /ประมาณการขายก่อนลงบัญชี/i }).first();
    await expect(projBtn).toBeVisible({ timeout: 10_000 });
    await projBtn.click();
    await waitForUiIdle(page);

    // 6. Assert DOM rendering of rows
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });

    // UNKNOWN rows must render dash "-" in the amount column (col index 3)
    const unkRow1 = table.locator('tbody tr', { hasText: 'SO-UAT-UNK-01' });
    await expect(unkRow1).toBeVisible();
    await expect(unkRow1).toContainText('UNKNOWN');
    const unk1Cells = unkRow1.locator('td');
    await expect(unk1Cells.nth(3)).toHaveText('-');

    const unkRow2 = table.locator('tbody tr', { hasText: 'SO-UAT-UNK-02' });
    await expect(unkRow2).toBeVisible();
    await expect(unkRow2).toContainText('UNKNOWN');
    const unk2Cells = unkRow2.locator('td');
    await expect(unk2Cells.nth(3)).toHaveText('-');

    const unkRow3 = table.locator('tbody tr', { hasText: 'SO-UAT-UNK-03' });
    await expect(unkRow3).toBeVisible();
    await expect(unkRow3).toContainText('UNKNOWN');
    const unk3Cells = unkRow3.locator('td');
    await expect(unk3Cells.nth(3)).toHaveText('-');

    // NORMAL row renders 500.00
    const normRow = table.locator('tbody tr', { hasText: 'SO-UAT-NORM-01' });
    await expect(normRow).toBeVisible();
    await expect(normRow).toContainText('NORMAL');
    const normCells = normRow.locator('td');
    await expect(normCells.nth(3)).toHaveText('500.00');

    // OVER_INVOICED row renders -200.00
    const overRow = table.locator('tbody tr', { hasText: 'SO-UAT-OVER-01' });
    await expect(overRow).toBeVisible();
    await expect(overRow).toContainText('OVER_INVOICED');
    const overCells = overRow.locator('td');
    await expect(overCells.nth(3)).toHaveText('-200.00');

    // Footer Total Row must strictly equal 300.00 (500 + (-200)) without null contamination
    const tfoot = table.locator('tfoot tr');
    await expect(tfoot).toBeVisible();
    await expect(tfoot).toContainText('รวมทั้งสิ้น (Total)');
    const totalCells = tfoot.locator('td');
    await expect(totalCells.nth(3)).toHaveText('300.00');

    // Capture visual artifact
    await page.screenshot({ path: 'scratch/so_projection_controlled_browser_uat.png', fullPage: false });
  });

  test('[CONTROLLED_MOCK_UAT] 0-Line GL Journal Header DOM Rendering', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Controlled 0-Line GL Journal Dataset
    const glData = {
      type: 'gl-sales-journal',
      title: 'รายงานสมุดรายวันขาย GL จริง (Native WinSpeed Sales Journal & Ledger)',
      category: 'finance',
      columns: [
        { key: 'JournalNo', label: 'เลขที่สมุดรายวัน', type: 'identifier' },
        { key: 'DocuDate', label: 'วันที่ลงบัญชี', type: 'date' },
        { key: 'JourName', label: 'สมุดรายวัน', type: 'text' },
        { key: 'AccountCode', label: 'รหัสบัญชี', type: 'identifier' },
        { key: 'AccountName', label: 'ชื่อบัญชี', type: 'text' },
        { key: 'Debit', label: 'เดบิต (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
        { key: 'Credit', label: 'เครดิต (บาท)', type: 'money', precision: 2, unit: 'บาท', aggregation: 'sum' },
        { key: 'BalanceStatus', label: 'สถานะสมดุล', type: 'text' },
        { key: 'PostingStatus', label: 'สถานะ Posting', type: 'text' },
        { key: 'RefInvoiceNo', label: 'อ้างอิงใบกำกับ', type: 'identifier' }
      ],
      rows: [
        {
          JournalNo: 'GL-UAT-NOLINE-01',
          DocuDate: '2026-09-20',
          JourName: 'รายวันขาย',
          AccountCode: '-',
          AccountName: 'ไม่มีรายการบัญชี (No GL Lines)',
          Debit: 0,
          Credit: 0,
          BalanceStatus: 'ไม่สมดุล (Unbalanced)',
          PostingStatus: 'ไม่สอดคล้อง (Inconsistent GL)',
          RefInvoiceNo: 'INV-UAT-01'
        }
      ]
    };

    // 2. Intercept report API route with controlled dataset
    await page.route('**/api/reports/gl-sales-journal*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(glData)
      });
    });

    // 3. Login as accounting role
    await login(page, 'e2e_accounting');
    await waitForUiIdle(page);

    // 4. Open Reports portal via sidebar
    await openSidebar(page, 'รายงาน');
    await waitForUiIdle(page);

    // 5. Select gl-sales-journal report
    const glBtn = page.locator('button', { hasText: /สมุดรายวันขาย GL จริง/i }).first();
    await expect(glBtn).toBeVisible({ timeout: 10_000 });
    await glBtn.click();
    await waitForUiIdle(page);

    // 6. Assert DOM rendering of 0-line header row
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });

    const row = table.locator('tbody tr', { hasText: 'GL-UAT-NOLINE-01' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('ไม่มีรายการบัญชี (No GL Lines)');
    await expect(row).toContainText('ไม่สมดุล (Unbalanced)');

    // Capture visual artifact
    await page.screenshot({ path: 'scratch/gl_journal_noline_browser_uat.png', fullPage: false });
  });

  test('[DEPLOYED_LIVE_READ_ONLY] Live Deployed TEST Database Projection Smoke', async ({ page }) => {
    test.setTimeout(90_000);

    // 1. Unmocked: Hits actual deployed backend API on Hostinger TEST
    await login(page, 'e2e_accounting');
    await waitForUiIdle(page);

    await openSidebar(page, 'รายงาน');
    await waitForUiIdle(page);

    // 2. Click report
    const projBtn = page.locator('button', { hasText: /ประมาณการขายก่อนลงบัญชี/i }).first();
    await expect(projBtn).toBeVisible({ timeout: 10_000 });
    await projBtn.click();

    // Allow realistic WAN latency (~6.5-8.5s) without timeout
    await expect(page.locator('table')).toBeVisible({ timeout: 30_000 });
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    console.log(`[DEPLOYED_LIVE_READ_ONLY] Rendered ${count} live rows from dbwins_worldfert9_test_v2`);
    expect(count).toBeGreaterThan(0);
  });

});
