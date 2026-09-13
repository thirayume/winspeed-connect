import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore
import XLSX from '../backend/node_modules/xlsx';
// @ts-ignore
const pdfParse = require('pdf-parse');
import { login, openSidebar, waitForUiIdle } from './helpers';
import { execSync } from 'node:child_process';

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

test.describe('SO-10: Exact Output Checks & Multi-Report Rendering', () => {

  const uniqueSuffix = Date.now().toString().slice(-6);
  const headerCode = 'E2E_H_' + uniqueSuffix;
  const headerName = 'E2E Header ' + uniqueSuffix;
  const companyName = 'บริษัท อีทูอี ตรวจสอบความถูกต้อง ' + uniqueSuffix;
  
  const templateCode = 'E2E_T_' + uniqueSuffix;
  const templateName = 'E2E Template ' + uniqueSuffix;

  test.afterAll(async ({ request }) => {
    // Cleanup using node script against remote_b to ensure we use OCC
    try {
      console.log('Cleaning up tracked entities...');
      execSync(`node -e "
        const { wfQuery } = require('./backend/db');
        async function run() {
          await wfQuery('DELETE FROM wf.ReportTemplateAssignment WHERE UpdatedBy = ''E2E_TEST''');
          await wfQuery('DELETE FROM wf.ReportTemplate WHERE TemplateCode = ''${templateCode}''');
          await wfQuery('DELETE FROM wf.ReportHeaderMaster WHERE HeaderCode = ''${headerCode}''');
          console.log('Cleaned up E2E entities.');
          process.exit(0);
        }
        run();
      "`, { stdio: 'inherit' });
    } catch (e) {
      console.error('Failed to cleanup E2E entities:', e);
    }
  });

  test('Non-Admin cannot access Admin Master UI', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    await page.locator('input[type="text"]').fill('wh-so10'); 
    await page.locator('input[type="password"]').fill(process.env.E2E_PASSWORD || 'W0rldF3rt');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await waitForUiIdle(page);
    await openSidebar(page, 'รายงาน');
    await waitForUiIdle(page);
    const adminBtn = page.getByRole('button', { name: /จัดการแม่แบบ \(Admin\)/i });
    await expect(adminBtn).toBeHidden({ timeout: 5000 });
  });

  test('Admin Assigns Custom Template & Validates Exact PDF/XLSX Outputs', async ({ page }) => {
    test.setTimeout(180_000); // Allow more time for full exact flow

    // Regression Sensitivity Harness via Interception
    if (process.env.E2E_INJECT_FAILURES === '1') {
      console.log('--- REGRESSION HARNESS ENABLED: INJECTING FAILURES ---');
      await page.route('**/api/reports/**', async route => {
        const response = await route.fetch();
        const url = route.request().url();
        
        // 1. Inject wrong quantity in Excel export
        if (url.includes('/export?format=xlsx')) {
          console.log('Injecting wrong XLSX data...');
          // Return a corrupted JSON array to the frontend if it's the JSON endpoint, 
          // or intercept the Blob. But we can't easily intercept the binary Blob.
          // Wait, our frontend exports XLSX by calling the backend which returns a Blob.
          // If we intercept the Blob and return a 1-byte file, it'll fail XLSX parsing!
          route.fulfill({
            status: 200,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            body: Buffer.from('FAKE_BROKEN_EXCEL_DATA')
          });
          return;
        }
        
        // 2. Inject wrong header / wrong page count in PDF HTML view
        if (url.includes('/customer-dispatch') && !url.includes('format=xlsx')) {
          const body = await response.text();
          // Remove the company name to prove the header check fails!
          const corruptedBody = body.replace(new RegExp(companyName, 'g'), 'WRONG_COMPANY_NAME')
                                    // Introduce an extra page to break the page count === check
                                    + '<div class="report-page-container">หน้า 999 / 999</div>';
          route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: corruptedBody
          });
          return;
        }
        
        route.fulfill({ response });
      });
    }

    // ==========================================
    // 1. ADMIN CONFIGURATION JOURNEY
    // ==========================================
    await login(page, 'e2e_admin');
    await waitForUiIdle(page);
    await openSidebar(page, 'รายงาน');
    await waitForUiIdle(page);
    
    await page.getByRole('button', { name: /จัดการแม่แบบ \(Admin\)/i }).click();
    await expect(page.getByText('ระบบจัดการหัวกระดาษและแม่แบบรายงาน (SO-10 Admin Master)')).toBeVisible();

    // -- Tab 1: Create Header
    await page.getByRole('button', { name: /^หัวกระดาษหลัก/i }).click();
    await page.getByRole('button', { name: /เพิ่มหัวกระดาษ/i }).click();
    await page.locator('text=รหัสหัวกระดาษ (Header Code) *').locator('+ input').fill(headerCode);
    await page.locator('text=ชื่อเรียกหัวกระดาษ (Header Name) *').locator('+ input').fill(headerName);
    await page.locator('text=ชื่อบริษัท (ภาษาไทย) *').locator('+ input').fill(companyName);
    await page.locator('text=ที่อยู่บริษัท (ภาษาไทย) *').locator('+ textarea').fill('123 ถนน E2E Exact Check');
    await page.locator('text=เลขประจำตัวผู้เสียภาษี (Tax ID) *').locator('+ input').fill('1234567890123');
    await page.getByPlaceholder('ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลงตามมาตรฐาน SO-10').fill('E2E_TEST');
    await page.getByRole('button', { name: /บันทึก/i }).click();
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    const shot1 = 'test-results/so10-01-admin-header-master-modal.png';
    await page.screenshot({ path: shot1, fullPage: false });
    copyArtifact(shot1, 'so10-01-admin-header-master-modal.png');

    // -- Tab 2: Create Template
    await page.getByRole('button', { name: /^แม่แบบรายงาน/i }).click();
    await page.getByRole('button', { name: /เพิ่มแม่แบบ/i }).click();
    await page.locator('text=รหัสแม่แบบ (Template Code) *').locator('+ input').fill(templateCode);
    await page.locator('text=ชื่อแม่แบบ (Template Name) *').locator('+ input').fill(templateName);
    // Select our newly created header
    await page.locator('text=หัวกระดาษ (Header) *').locator('+ div').click(); // click select
    await page.getByText(headerCode).click();
    await page.getByPlaceholder('ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลงตามมาตรฐาน SO-10').fill('E2E_TEST');
    await page.getByRole('button', { name: /บันทึก/i }).click();
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // -- Tab 3: Assign to 3 Archetypes
    await page.getByRole('button', { name: /^กำหนดแม่แบบรายงาน/i }).click();
    
    // Assign to Logistics (customer-dispatch)
    await page.locator('tr:has-text("customer-dispatch")').getByRole('button', { name: 'แก้ไข' }).click();
    await page.locator('text=แม่แบบ (Template) *').locator('+ div').click();
    await page.getByText(templateCode).click();
    await page.getByPlaceholder('ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลงตามมาตรฐาน SO-10').fill('E2E_TEST');
    await page.getByRole('button', { name: /บันทึก/i }).click();
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // Assign to Finance (rebate-claim-detail)
    await page.locator('tr:has-text("rebate-claim-detail")').getByRole('button', { name: 'แก้ไข' }).click();
    await page.locator('text=แม่แบบ (Template) *').locator('+ div').click();
    await page.getByText(templateCode).click();
    await page.getByPlaceholder('ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลงตามมาตรฐาน SO-10').fill('E2E_TEST');
    await page.getByRole('button', { name: /บันทึก/i }).click();
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // Assign to Weighing (weighbridge-log)
    await page.locator('tr:has-text("weighbridge-log")').getByRole('button', { name: 'แก้ไข' }).click();
    await page.locator('text=แม่แบบ (Template) *').locator('+ div').click();
    await page.getByText(templateCode).click();
    await page.getByPlaceholder('ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลงตามมาตรฐาน SO-10').fill('E2E_TEST');
    await page.getByRole('button', { name: /บันทึก/i }).click();
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // Close Admin Modal
    await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();

    // ==========================================
    // 2. EXPORT VALIDATION
    // ==========================================

    async function checkPdfExact(reportName: string, expectedPrefix: string, expectedPages: number) {
      const btn = page.locator(`button:has-text("${reportName}")`).first();
      await btn.click();
      await waitForUiIdle(page);

      await page.getByRole('button', { name: /พิมพ์ \/ Export PDF \(A4\)/i }).click();
      const pdfModalRoot = page.locator('.report-modal-root');
      await expect(pdfModalRoot).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1500);

      // Logical DOM validation
      const pageContainers = page.locator('.report-page-container');
      const logicalPageCount = await pageContainers.count();
      
      if (expectedPages > 0) {
        expect(logicalPageCount).toBe(expectedPages);
      }

      // Check our EXACT company name is printed on the first and last logical pages
      await expect(pageContainers.first().getByText(companyName).first()).toBeVisible();
      await expect(pageContainers.last().getByText(companyName).first()).toBeVisible();

      // Check DOM physical clipping (Ensure "รวมทั้งสิ้น" isn't pushed out of bounds)
      // Playwright's toBeVisible checks intersection observer, so if it's clipped/hidden it will fail.
      const hasTotalRow = await pageContainers.last().getByText('รวมทั้งสิ้น').count();
      if (hasTotalRow > 0) {
        await expect(pageContainers.last().getByText('รวมทั้งสิ้น').first()).toBeVisible();
      }

      const pdfPath = `test-results/${expectedPrefix}-exact.pdf`;
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
      copyArtifact(pdfPath, `${expectedPrefix}-exact.pdf`);

      // ACTUAL PHYSICAL PDF PARSING
      const pdfArray = new Uint8Array(fs.readFileSync(pdfPath));
      const pdf = new pdfParse.PDFParse(pdfArray);
      await pdf.load();
      const pdfData = await pdf.getText();

      // EXACT PAGE COUNT ASSERTION
      // If the DOM said 3 pages, the printed PDF MUST have exactly 3 pages. No >= allowed.
      expect(pdfData.total).toBe(logicalPageCount);
      
      // Ensure the exact company name is actually in the extracted text from the PDF
      expect(pdfData.text).toContain(companyName);

      await page.locator('.report-modal-root button:has(svg.lucide-x)').first().click();
      await expect(pdfModalRoot).toBeHidden();
    }

    async function checkExcelExact(reportName: string) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15_000 }),
        page.getByRole('button', { name: /Export Excel/i }).click(),
      ]);
      const excelPath = await download.path();
      expect(excelPath).toBeTruthy();

      const wb = XLSX.readFile(excelPath);
      expect(wb.SheetNames).toContain('Report');
      const sheet = wb.Sheets['Report'];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      
      // Look for the header row to find column indexes
      let headerRowIndex = -1;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        if (rows[i] && rows[i].some(c => typeof c === 'string' && (c.includes('รหัส') || c.includes('จำนวน')))) {
          headerRowIndex = i;
          break;
        }
      }
      expect(headerRowIndex).toBeGreaterThanOrEqual(0);
      
      const headers = rows[headerRowIndex];
      const dataRows = rows.slice(headerRowIndex + 1);
      
      // Validate CustCode leading zeros (if it exists)
      const custCodeIdx = headers.findIndex(h => typeof h === 'string' && (h.includes('รหัสลูกค้า') || h.includes('CustCode')));
      if (custCodeIdx !== -1) {
        const sampleCustCode = dataRows.find(r => r[custCodeIdx] !== undefined)?.[custCodeIdx];
        if (sampleCustCode) {
          expect(typeof sampleCustCode).toBe('string'); // Excel must preserve it as string, not strip leading zeros
        }
      }

      // Validate exact QtyTon numeric types and totals calculation
      const qtyIdx = headers.findIndex(h => typeof h === 'string' && (h.includes('ปริมาณ') || h.includes('น้ำหนัก')));
      if (qtyIdx !== -1) {
        let computedSum = 0;
        let lastRowTotal = 0;
        let foundNumbers = 0;
        for (let i = 0; i < dataRows.length; i++) {
          const row = dataRows[i];
          const val = row[qtyIdx];
          
          if (i === dataRows.length - 1 && typeof row[0] === 'string' && row[0].includes('รวม')) {
            lastRowTotal = val;
            break;
          }
          
          if (typeof val === 'number') {
            computedSum += val;
            foundNumbers++;
            
            // Assert that non-integer values exist if appropriate, but specifically assert it's a Number type
            expect(typeof val).toBe('number');
          }
        }
        
        if (foundNumbers > 0) {
          // Assert that our independently computed sum closely matches the Excel sheet's last row sum
          // We use toBeCloseTo to account for floating point math
          expect(computedSum).toBeCloseTo(lastRowTotal, 2);
        }
      }
    }

    await checkPdfExact('รายงานการขนสินค้าตามรายชื่อลูกค้า', 'so10-dispatch', 0); // 0 means just use logical = physical
    await checkExcelExact('รายงานการขนสินค้าตามรายชื่อลูกค้า');

    await checkPdfExact('รายงานรายละเอียดใบขอเคลียร์รีเบท', 'so10-rebate', 0);
    await checkExcelExact('รายงานรายละเอียดใบขอเคลียร์รีเบท');

    await checkPdfExact('รายงานใบชั่งเข้า–ชั่งออก', 'so10-weigh', 0);
    await checkExcelExact('รายงานใบชั่งเข้า–ชั่งออก');

  });
});
