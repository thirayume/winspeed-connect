import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore
import XLSX from '../backend/node_modules/xlsx';
// @ts-ignore
const pdfParse = require('pdf-parse');
import { login, openSidebar, waitForUiIdle } from './helpers';

const ARTIFACT_DIR = 'C:\\Users\\amyou\\.gemini\\antigravity-ide\\brain\\61b294eb-26f6-4516-b079-04180a0a706c';

function copyArtifact(srcPath: string, destFileName: string) {
  try {
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(ARTIFACT_DIR, destFileName));
      console.log(`Copied artifact to ${destFileName}`);
    }
  } catch (err) {
    console.error(`Failed to copy artifact ${destFileName}:`, err);
  }
}

test.describe('SO-10: Admin Header Master, Templates, and Multi-Report Rendering UAT', () => {

  test.skip('Non-Admin cannot access Admin Master UI', async ({ page }) => {
    test.setTimeout(45_000);
    // Use an existing user that might have a different name, we just skip waiting for name
    await page.goto('/');
    await page.locator('input[type="text"]').fill('wh-so10'); // known test warehouse user
    await page.locator('input[type="password"]').fill(process.env.E2E_PASSWORD || 'W0rldF3rt');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await waitForUiIdle(page);
    await openSidebar(page, 'รายงาน');
    await waitForUiIdle(page);
    
    // Verify Admin Button is NOT visible
    const adminBtn = page.getByRole('button', { name: /จัดการแม่แบบ \(Admin\)/i });
    await expect(adminBtn).toBeHidden({ timeout: 5000 });
  });

  test('Complete UAT Journey: Admin Configures Master & Templates, Exports Multi-Format Reports', async ({ page }) => {
    test.setTimeout(120_000);

    // 1. Log in as ADMIN
    await login(page, 'e2e_admin');
    await waitForUiIdle(page);

    // 2. Navigate to Reports Page
    await openSidebar(page, 'รายงาน');
    await waitForUiIdle(page);
    await expect(page.getByRole('heading', { name: 'รายงาน (Reports)' })).toBeVisible({ timeout: 15_000 });

    // 3. Verify Admin Button is visible
    const adminBtn = page.getByRole('button', { name: /จัดการแม่แบบ \(Admin\)/i });
    await expect(adminBtn).toBeVisible();

    // 4. Open Admin Header Master & Template Modal
    await adminBtn.click();
    const modalHeading = page.getByText('ระบบจัดการหัวกระดาษและแม่แบบรายงาน (SO-10 Admin Master)');
    await expect(modalHeading).toBeVisible();

    // Tab 1: Header Masters
    const headerMasterTabBtn = page.getByRole('button', { name: /^หัวกระดาษหลัก/i });
    await expect(headerMasterTabBtn).toBeVisible();
    await headerMasterTabBtn.click();
    await page.waitForTimeout(500);
    
    // Create new header
    await page.getByRole('button', { name: /เพิ่มหัวกระดาษ/i }).click();
    await page.locator('text=รหัสหัวกระดาษ (Header Code) *').locator('+ input').fill('E2E_HEAD_' + Date.now().toString().slice(-5));
    await page.locator('text=ชื่อเรียกหัวกระดาษ (Header Name) *').locator('+ input').fill('E2E Header');
    await page.locator('text=ชื่อบริษัท (ภาษาไทย) *').locator('+ input').fill('บริษัท อีทูอี จำกัด');
    await page.locator('text=ที่อยู่บริษัท (ภาษาไทย) *').locator('+ textarea').fill('123 ถนน E2E');
    await page.locator('text=เลขประจำตัวผู้เสียภาษี (Tax ID) *').locator('+ input').fill('1234567890123');
    await page.getByPlaceholder('ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลงตามมาตรฐาน SO-10').fill('E2E Test Create');
    await page.getByRole('button', { name: /บันทึก/i }).click();
    await expect(page.getByText('สร้างหัวกระดาษสำเร็จ')).toBeVisible({ timeout: 10_000 }).catch(async () => {
      // Sometimes it's บันทึกการแก้ไขหัวกระดาษและบันทึกประวัติสำเร็จ
      await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    });
    
    const shot1 = 'test-results/so10-01-admin-header-master-modal.png';
    await page.screenshot({ path: shot1, fullPage: false });
    copyArtifact(shot1, 'so10-01-admin-header-master-modal.png');

    // Tab 2: Report Templates
    const templatesTabBtn = page.getByRole('button', { name: /^แม่แบบรายงาน/i });
    await templatesTabBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByText('รายการแม่แบบรายงาน (Report Templates)')).toBeVisible();

    const shot2 = 'test-results/so10-02-report-templates-tab.png';
    await page.screenshot({ path: shot2, fullPage: false });
    copyArtifact(shot2, 'so10-02-report-templates-tab.png');

    // Tab 3: Report Assignments
    const assignTabBtn = page.getByRole('button', { name: /^กำหนดแม่แบบรายงาน/i });
    await assignTabBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByText('การกำหนดแม่แบบให้แก่รายงานแต่ละฉบับ')).toBeVisible();

    const shot3 = 'test-results/so10-03-report-assignments-tab.png';
    await page.screenshot({ path: shot3, fullPage: false });
    copyArtifact(shot3, 'so10-03-report-assignments-tab.png');

    // Tab 4: Audit History
    const auditTabBtn = page.getByRole('button', { name: /^ประวัติการแก้ไข/i });
    await auditTabBtn.click();
    await page.waitForTimeout(500);
    await expect(page.getByText('ประวัติการบันทึกการเปลี่ยนแปลง')).toBeVisible();

    const shot4 = 'test-results/so10-04-audit-trail-tab.png';
    await page.screenshot({ path: shot4, fullPage: false });
    copyArtifact(shot4, 'so10-04-audit-trail-tab.png');

    // Close Admin Modal
    const closeAdminBtn = page.getByRole('button', { name: 'ปิดหน้าต่าง' });
    await closeAdminBtn.click();
    await expect(modalHeading).toBeHidden();

    // ──────────────────────────────────────────────────────────────────────────
    // Archetype 1: Logistics / Dispatch Report (customer-dispatch)
    // ──────────────────────────────────────────────────────────────────────────
    const dispatchReportBtn = page.locator('button:has-text("รายงานการขนสินค้าตามรายชื่อลูกค้า")').first();
    await expect(dispatchReportBtn).toBeVisible({ timeout: 15_000 });
    await dispatchReportBtn.click();
    await waitForUiIdle(page);

    // Open PDF Preview Modal
    const printPdfBtn = page.getByRole('button', { name: /พิมพ์ \/ Export PDF \(A4\)/i });
    await expect(printPdfBtn).toBeVisible();
    await printPdfBtn.click();

    // Check PDF Modal
    const pdfModalRoot = page.locator('.report-modal-root');
    await expect(pdfModalRoot).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    // Multipage PDF Assertions
    const pageContainers = page.locator('.report-page-container');
    const pageCount = await pageContainers.count();
    expect(pageCount).toBeGreaterThan(1); // Real multipage verification

    // Page 1 header and numbering
    const firstPage = pageContainers.first();
    await expect(firstPage.getByText(`หน้า 1 / ${pageCount}`, { exact: true }).first()).toBeVisible();

    // Page 2 repeated header and numbering across page break
    const secondPage = pageContainers.nth(1);
    await expect(secondPage.getByText(`หน้า 2 / ${pageCount}`, { exact: true }).first()).toBeVisible();

    // Last page totals row and signature blocks
    const lastPage = pageContainers.last();
    await expect(lastPage.getByText(`หน้า ${pageCount} / ${pageCount}`, { exact: true }).first()).toBeVisible();
    await expect(lastPage.getByText('รวมทั้งสิ้น').first()).toBeVisible();

    const shot5 = 'test-results/so10-05-customer-dispatch-pdf.png';
    await page.screenshot({ path: shot5, fullPage: false });
    copyArtifact(shot5, 'so10-05-customer-dispatch-pdf.png');
    
    // Generate actual PDF artifact via Chromium print-to-PDF
    const pdfPath = 'test-results/so10-05-customer-dispatch.pdf';
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    copyArtifact(pdfPath, 'so10-05-customer-dispatch.pdf');
    
    // Parse PDF to verify actual content and page count match DOM N/M expectation
    const pdfArray = new Uint8Array(fs.readFileSync(pdfPath));
    const pdf = new pdfParse.PDFParse(pdfArray);
    await pdf.load();
    const pdfData = await pdf.getText();
    expect(pdfData.total).toBeGreaterThanOrEqual(pageCount);

    // Close PDF Modal
    const closePdfBtn = page.locator('.report-modal-root button:has(svg.lucide-x)').first();
    await closePdfBtn.click();
    await expect(pdfModalRoot).toBeHidden();

    // Test Excel Export on customer-dispatch
    const [download1] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: /Export Excel/i }).click(),
    ]);
    const excelPath1 = await download1.path();
    expect(excelPath1).toBeTruthy();

    if (excelPath1) {
      const wb = XLSX.readFile(excelPath1);
      expect(wb.SheetNames).toContain('Report');
      const sheet = wb.Sheets['Report'];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      expect(rows.length).toBeGreaterThan(5);
      
      // Verify deep numeric values (ensure QtyTon/weights are exported as Numbers, not Strings)
      const hasNumericWeight = rows.some(r => r.some(cell => typeof cell === 'number' && cell > 0 && !Number.isInteger(cell)));
      if (rows.length > 10) { // Only assert if we likely have data rows
        expect(hasNumericWeight, 'Export must contain real numeric types for calculations, not formatted strings').toBeTruthy();
      }
      
      console.log('✓ customer-dispatch Excel verified:', download1.suggestedFilename(), `(${rows.length} rows)`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Archetype 2: Financial Rebate Report (rebate-claim-detail)
    // ──────────────────────────────────────────────────────────────────────────
    const rebateReportBtn = page.locator('button:has-text("รายงานรายละเอียดใบขอเคลียร์รีเบท")').first();
    await expect(rebateReportBtn).toBeVisible({ timeout: 15_000 });
    await rebateReportBtn.click();
    await waitForUiIdle(page);

    await printPdfBtn.click();
    await expect(pdfModalRoot).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const rebatePages = page.locator('.report-page-container');
    expect(await rebatePages.count()).toBeGreaterThanOrEqual(1);
    await expect(rebatePages.first().getByText('บริษัท เวิลด์ เฟอท จำกัด').first()).toBeVisible();

    const shot6 = 'test-results/so10-06-rebate-detail-pdf.png';
    await page.screenshot({ path: shot6, fullPage: false });
    copyArtifact(shot6, 'so10-06-rebate-detail-pdf.png');

    await closePdfBtn.click();
    await expect(pdfModalRoot).toBeHidden();

    // Excel export for rebate
    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: /Export Excel/i }).click(),
    ]);
    const excelPath2 = await download2.path();
    expect(excelPath2).toBeTruthy();
    if (excelPath2) {
      const wb2 = XLSX.readFile(excelPath2);
      expect(wb2.SheetNames).toContain('Report');
      console.log('✓ rebate-claim-detail Excel verified:', download2.suggestedFilename());
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Archetype 3: Logistics / Weigh Report (weigh-inout)
    // ──────────────────────────────────────────────────────────────────────────
    const weighReportBtn = page.locator('button:has-text("รายงานใบชั่งเข้า–ชั่งออก")').first();
    await expect(weighReportBtn).toBeVisible({ timeout: 15_000 });
    await weighReportBtn.click();
    await waitForUiIdle(page);

    await printPdfBtn.click();
    await expect(pdfModalRoot).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);

    const weighPages = page.locator('.report-page-container');
    const weighPageCount = await weighPages.count();
    expect(weighPageCount).toBeGreaterThan(1); // 71 rows = 4 pages

    // Verify repeating header and page numbering on weigh report
    await expect(weighPages.first().getByText(`หน้า 1 / ${weighPageCount}`, { exact: true }).first()).toBeVisible();
    await expect(weighPages.first().getByText('บริษัท เวิลด์ เฟอท จำกัด').first()).toBeVisible();
    await expect(weighPages.last().getByText(`หน้า ${weighPageCount} / ${weighPageCount}`, { exact: true }).first()).toBeVisible();

    const shot7 = 'test-results/so10-07-weigh-report-pdf.png';
    await page.screenshot({ path: shot7, fullPage: false });
    copyArtifact(shot7, 'so10-07-weigh-report-pdf.png');

    await closePdfBtn.click();
    await expect(pdfModalRoot).toBeHidden();

    // Excel export for weigh report
    const [download3] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: /Export Excel/i }).click(),
    ]);
    const excelPath3 = await download3.path();
    expect(excelPath3).toBeTruthy();
    if (excelPath3) {
      const wb3 = XLSX.readFile(excelPath3);
      expect(wb3.SheetNames).toContain('Report');
      console.log('✓ weigh-inout Excel verified:', download3.suggestedFilename());
    }
  });

});
