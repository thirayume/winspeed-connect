import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore
import XLSX from '../backend/node_modules/xlsx';
// @ts-ignore
const pdfParse = require('pdf-parse');
import { login, openSidebar, waitForUiIdle } from './helpers';

// Safe Database Helpers directly imported from backend
// @ts-ignore
const { runWithTarget, wfQuery, sql } = require('../backend/db');
// @ts-ignore
const { assertTestDatabase } = require('../backend/tests/test-safety');

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

interface AssignmentRecord {
  AssignmentId: number;
  ReportKey: string;
  TemplateId: number;
  IsActive: boolean;
  Version: number;
}

test.describe('SO-10: Exact Output Checks & Multi-Report Rendering', () => {

  const uniqueSuffix = Date.now().toString().slice(-6);
  const headerCode = 'E2E_H_' + uniqueSuffix;
  const headerName = 'E2E Header ' + uniqueSuffix;
  const companyName = 'บริษัท อีทูอี ตรวจสอบความถูกต้อง ' + uniqueSuffix;
  
  const templateCode = 'E2E_T_' + uniqueSuffix;
  const templateName = 'E2E Template ' + uniqueSuffix;

  let initialAssignments: AssignmentRecord[] = [];

  test.beforeAll(async () => {
    // 1. Safety verification: Base URL must target TEST environment
    const baseURL = process.env.E2E_BASE_URL || 'https://test.thirayu.online';
    console.log(`[E2E] Verifying environment baseURL: ${baseURL}`);
    if (!baseURL.includes('test.thirayu.online') && !baseURL.includes('localhost')) {
      throw new Error(`CRITICAL TEST SAFETY: Unexpected baseURL "${baseURL}". Must target TEST environment.`);
    }

    // 2. Record pre-test baseline assignments using safe DB connection on remote_b
    await runWithTarget('remote_b', async () => {
      const safety = await assertTestDatabase();
      console.log(`[E2E PRE-TEST] Safety confirmed on ${safety.dbName} (${safety.serverName})`);

      const res = await wfQuery(`
        SELECT AssignmentId, ReportKey, TemplateId, IsActive, Version
        FROM wf.ReportTemplateAssignment
        WHERE ReportKey IN ('customer-dispatch', 'rebate-claim-detail', 'weighbridge-log')
      `);

      initialAssignments = res.recordset.map((r: any) => ({
        AssignmentId: Number(r.AssignmentId),
        ReportKey: String(r.ReportKey),
        TemplateId: Number(r.TemplateId),
        IsActive: Boolean(r.IsActive),
        Version: Number(r.Version),
      }));

      console.log('[E2E PRE-TEST] Baseline assignments recorded:', initialAssignments);
      if (initialAssignments.length < 3) {
        throw new Error(`CRITICAL PRE-TEST: Expected 3 assignments, found ${initialAssignments.length}`);
      }
    });
  });

  test.afterAll(async () => {
    console.log('[E2E CLEANUP] Starting atomic OCC cleanup and entity restoration...');
    await runWithTarget('remote_b', async () => {
      const safety = await assertTestDatabase();
      console.log(`[E2E CLEANUP] Safety confirmed on DB: ${safety.dbName}`);

      // 1. Atomically restore each shared assignment back to its baseline
      for (const initial of initialAssignments) {
        const curRes = await wfQuery(`
          SELECT AssignmentId, TemplateId, IsActive, Version
          FROM wf.ReportTemplateAssignment
          WHERE AssignmentId = @aid
        `, { aid: { type: sql.Int, value: initial.AssignmentId } });

        const current = curRes.recordset[0];
        if (!current) {
          throw new Error(`CRITICAL OCC CLEANUP: AssignmentId ${initial.AssignmentId} for ${initial.ReportKey} not found!`);
        }

        const currentTemplateId = Number(current.TemplateId);
        const currentVersion = Number(current.Version);
        const currentIsActive = Boolean(current.IsActive);

        if (currentTemplateId !== initial.TemplateId || currentIsActive !== initial.IsActive) {
          console.log(`[E2E CLEANUP] Restoring ${initial.ReportKey} (ID ${initial.AssignmentId}): Template ${currentTemplateId} -> ${initial.TemplateId}, Version ${currentVersion} -> ${currentVersion + 1}`);
          const updRes = await wfQuery(`
            UPDATE wf.ReportTemplateAssignment
            SET TemplateId = @targetTemplateId,
                IsActive = @isActive,
                Version = Version + 1,
                UpdatedBy = 'E2E_CLEANUP_OCC',
                UpdatedAt = SYSUTCDATETIME()
            WHERE AssignmentId = @aid
              AND Version = @expectedVersion
          `, {
            targetTemplateId: { type: sql.Int, value: initial.TemplateId },
            isActive: { type: sql.Bit, value: initial.IsActive ? 1 : 0 },
            aid: { type: sql.Int, value: initial.AssignmentId },
            expectedVersion: { type: sql.Int, value: currentVersion }
          });

          if (updRes.rowsAffected[0] !== 1) {
            throw new Error(`CRITICAL OCC CONFLICT: Failed to restore AssignmentId ${initial.AssignmentId}. Expected version ${currentVersion}, rows affected: ${updRes.rowsAffected[0]}`);
          }
        } else {
          console.log(`[E2E CLEANUP] Assignment ${initial.ReportKey} already matches baseline (TemplateId ${initial.TemplateId})`);
        }
      }

      // 2. Delete owned test template (only if unreferenced)
      const tRes = await wfQuery(`
        SELECT TemplateId FROM wf.ReportTemplate WHERE TemplateCode = @tc
      `, { tc: { type: sql.NVarChar, value: templateCode } });

      if (tRes.recordset.length > 0) {
        const tid = Number(tRes.recordset[0].TemplateId);
        const refCheck = await wfQuery(`
          SELECT COUNT(*) as refCount FROM wf.ReportTemplateAssignment WHERE TemplateId = @tid
        `, { tid: { type: sql.Int, value: tid } });

        if (refCheck.recordset[0].refCount > 0) {
          throw new Error(`CANNOT DELETE TEMPLATE: Template ${tid} (${templateCode}) is still referenced by ${refCheck.recordset[0].refCount} assignments!`);
        }

        const delRes = await wfQuery(`
          DELETE FROM wf.ReportTemplate WHERE TemplateId = @tid
        `, { tid: { type: sql.Int, value: tid } });
        console.log(`[E2E CLEANUP] Deleted owned Template ${tid} (${delRes.rowsAffected[0]} rows)`);
      }

      // 3. Delete owned test header (only if unreferenced)
      const hRes = await wfQuery(`
        SELECT HeaderId FROM wf.ReportHeaderMaster WHERE HeaderCode = @hc
      `, { hc: { type: sql.NVarChar, value: headerCode } });

      if (hRes.recordset.length > 0) {
        const hid = Number(hRes.recordset[0].HeaderId);
        const refCheck = await wfQuery(`
          SELECT COUNT(*) as refCount FROM wf.ReportTemplate WHERE HeaderId = @hid
        `, { hid: { type: sql.Int, value: hid } });

        if (refCheck.recordset[0].refCount > 0) {
          throw new Error(`CANNOT DELETE HEADER: Header ${hid} (${headerCode}) is still referenced by ${refCheck.recordset[0].refCount} templates!`);
        }

        const delRes = await wfQuery(`
          DELETE FROM wf.ReportHeaderMaster WHERE HeaderId = @hid
        `, { hid: { type: sql.Int, value: hid } });
        console.log(`[E2E CLEANUP] Deleted owned Header ${hid} (${delRes.rowsAffected[0]} rows)`);
      }
      console.log('[E2E CLEANUP] All shared assignments restored and test entities safely removed.');
    });
  });

  test('Non-Admin cannot access Admin Master UI', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    await page.locator('input[type="text"]').fill('e2e_accounting');
    await page.locator('input[type="password"]').fill(process.env.E2E_PASSWORD || 'W0rldF3rt');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await waitForUiIdle(page);
    await openSidebar(page, 'รายงาน');
    await waitForUiIdle(page);
    const adminBtn = page.getByRole('button', { name: /จัดการแม่แบบ \(Admin\)/i });
    await expect(adminBtn).toBeHidden({ timeout: 5000 });
  });

  test('Admin Assigns Custom Template & Validates Exact PDF/XLSX Outputs (Unmodified Deployed App)', async ({ page }) => {
    test.setTimeout(180_000);

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
    await page.locator('input[placeholder*="ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลง"]').fill('E2E_TEST');
    
    // Save Header
    await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/admin/reports/headers') && res.request().method() === 'GET' && [200, 304].includes(res.status())),
      page.getByRole('button', { name: /บันทึก/i }).click()
    ]);
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
    
    // Select newly created header
    const selectLocator = page.locator('text=หัวกระดาษที่ผูก (Header Master) *').locator('+ select');
    const optionLocator = selectLocator.locator('option', { hasText: headerCode });
    await expect(optionLocator).toBeAttached({ timeout: 20_000 });
    
    const optionValue = await optionLocator.getAttribute('value');
    if (!optionValue) throw new Error(`Header code ${headerCode} has no value attribute`);
    await selectLocator.selectOption(optionValue);
    await page.waitForTimeout(500);
    await page.locator('input[placeholder*="ระบุเหตุผลเพื่อบันทึกประวัติการเปลี่ยนแปลง"]').fill('E2E_TEST');
    
    // Save Template (pure native request, no body rewriting)
    await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/admin/reports/templates') && res.request().method() === 'GET' && [200, 304].includes(res.status())),
      page.getByRole('button', { name: /บันทึก/i }).click()
    ]);
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // -- Tab 3: Assign to 3 Archetypes
    await page.getByRole('button', { name: /^กำหนดแม่แบบรายงาน/i }).click();
    await page.waitForTimeout(500);

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('E2E_TEST');
      } else {
        await dialog.accept();
      }
    });
    
    // Assign to Logistics (customer-dispatch)
    const logSelect = page.locator('tr:has-text("customer-dispatch") select');
    const logOpt = logSelect.locator('option', { hasText: templateName });
    await expect(logOpt).toBeAttached({ timeout: 10_000 });
    await logSelect.selectOption(await logOpt.getAttribute('value') as string);
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // Assign to Finance (rebate-claim-detail)
    const finSelect = page.locator('tr:has-text("rebate-claim-detail") select');
    const finOpt = finSelect.locator('option', { hasText: templateName });
    await expect(finOpt).toBeAttached({ timeout: 10_000 });
    await finSelect.selectOption(await finOpt.getAttribute('value') as string);
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // Assign to Weighing (weighbridge-log)
    const wbSelect = page.locator('tr:has-text("weighbridge-log") select');
    const wbOpt = wbSelect.locator('option', { hasText: templateName });
    await expect(wbOpt).toBeAttached({ timeout: 10_000 });
    await wbSelect.selectOption(await wbOpt.getAttribute('value') as string);
    await expect(page.getByText(/สำเร็จ/)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // Close Admin Modal
    await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();

    // ==========================================
    // 2. UNMODIFIED EXPORT VALIDATION
    // ==========================================

    async function checkPdfExact(reportName: string, expectedPrefix: string) {
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
      expect(logicalPageCount).toBeGreaterThan(0);

      // Check custom company name appears in header
      await expect(pageContainers.first().getByText(companyName).first()).toBeVisible();
      await expect(pageContainers.last().getByText(companyName).first()).toBeVisible();

      // Check DOM physical clipping (Ensure "รวมทั้งสิ้น" isn't pushed out of bounds)
      const hasTotalRow = await pageContainers.last().getByText('รวมทั้งสิ้น').count();
      if (hasTotalRow > 0) {
        await expect(pageContainers.last().getByText('รวมทั้งสิ้น').first()).toBeVisible();
      }

      // NO page.addStyleTag! Native print CSS from deployed application
      const pdfPath = `test-results/${expectedPrefix}-exact.pdf`;
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
      copyArtifact(pdfPath, `${expectedPrefix}-exact.pdf`);

      // Parse actual physical PDF
      const pdfArray = new Uint8Array(fs.readFileSync(pdfPath));
      const pdf = new pdfParse.PDFParse(pdfArray);
      await pdf.load();
      const pdfData = await pdf.getText();

      console.log(`[PDF ${expectedPrefix}] Physical pages: ${pdfData.total}, Logical DOM pages: ${logicalPageCount}`);

      // EXACT PAGE COUNT ASSERTION: Physical PDF pages must match Logical DOM pages 1:1
      expect(pdfData.total).toBe(logicalPageCount);
      
      // Ensure company name is present in extracted physical text
      expect(pdfData.text).toContain(companyName);

      await page.locator('.report-modal-root button:has(svg.lucide-x)').first().click();
      await expect(pdfModalRoot).toBeHidden();
    }

    async function checkExcelExact(reportTitle: string, expectedColumns: string[], archetypeKey: string) {
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
      
      // 1. Verify Header Master metadata in rows 0-3
      expect(rows.length).toBeGreaterThanOrEqual(6);
      expect(rows[0]?.[0]).toBe(companyName);
      expect(rows[3]?.[0]).toContain(templateCode);

      // 2. Find column header row
      let headerRowIndex = -1;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        if (rows[i] && expectedColumns.every(col => rows[i].some(c => typeof c === 'string' && c.trim() === col))) {
          headerRowIndex = i;
          break;
        }
      }
      expect(headerRowIndex).toBeGreaterThanOrEqual(4);
      const headers: string[] = rows[headerRowIndex];
      const dataRows = rows.slice(headerRowIndex + 1);
      expect(dataRows.length).toBeGreaterThan(0);

      // Verify all required columns are present
      for (const col of expectedColumns) {
        const idx = headers.findIndex(h => typeof h === 'string' && h.trim() === col);
        expect(idx).toBeGreaterThanOrEqual(0);
      }

      // 3. Leading zero / string preservation for identifiers
      const custCodeIdx = headers.findIndex(h => typeof h === 'string' && (h.includes('รหัสลูกค้า') || h.includes('เลขที่')));
      if (custCodeIdx !== -1) {
        for (let i = 0; i < dataRows.length - 1; i++) {
          const val = dataRows[i][custCodeIdx];
          if (val !== undefined && val !== null && val !== '') {
            expect(typeof val).toBe('string');
          }
        }
      }

      // 4. Verify summary row and numeric calculations
      const lastRow = dataRows[dataRows.length - 1];
      expect(typeof lastRow[0]).toBe('string');
      expect(lastRow[0]).toContain('รวม');

      const sumCols = headers.map((h, i) => ({ name: h, index: i }))
        .filter(c => ['จำนวน (ตัน)', 'เป็นเงิน (บาท)', 'ยอดขอเคลม (บาท)', 'ยอดรวมส่วนลด (บาท)', 'สุทธิ (กก.)'].includes(c.name));

      expect(sumCols.length).toBeGreaterThan(0);

      for (const sc of sumCols) {
        let computedSum = 0;
        for (let i = 0; i < dataRows.length - 1; i++) {
          const val = dataRows[i][sc.index];
          if (typeof val === 'number') {
            computedSum += val;
          } else if (typeof val === 'string' && val.trim() !== '') {
            const parsed = parseFloat(val.replace(/,/g, ''));
            if (!isNaN(parsed)) computedSum += parsed;
          }
        }
        const expectedSum = typeof lastRow[sc.index] === 'number' 
          ? lastRow[sc.index] 
          : parseFloat(String(lastRow[sc.index] || '0').replace(/,/g, ''));

        console.log(`[XLSX ${archetypeKey}] Column "${sc.name}": computed ${computedSum.toFixed(2)} vs summary row ${expectedSum.toFixed(2)}`);
        expect(computedSum).toBeCloseTo(expectedSum, 1);
      }
    }

    // Archetype 1: Customer Dispatch & Delivery (Logistics)
    await checkPdfExact('รายงานการขนสินค้าตามรายชื่อลูกค้า', 'so10-dispatch');
    await checkExcelExact('รายงานการขนสินค้าตามรายชื่อลูกค้า', ['รหัสลูกค้า', 'ชื่อลูกค้า', 'วันที่ขน', 'เลขที่ใบส่งของ', 'สูตรปุ๋ย', 'จำนวน (ตัน)', 'ราคา/ตัน', 'เป็นเงิน (บาท)'], 'customer-dispatch');

    // Archetype 2: Rebate Claim Detail (Finance)
    await checkPdfExact('รายงานรายละเอียดใบขอเคลียร์รีเบท', 'so10-rebate');
    await checkExcelExact('รายงานรายละเอียดใบขอเคลียร์รีเบท', ['เลขที่เคลม', 'รหัสลูกค้า', 'ยอดขอเคลม (บาท)', 'จำนวน (ตัน)', 'ราคาสุทธิ', 'ยอดรวมส่วนลด (บาท)'], 'rebate-claim-detail');

    // Archetype 3: Weighbridge Log (Factory)
    await checkPdfExact('รายงานใบชั่งเข้า–ชั่งออก', 'so10-weigh');
    await checkExcelExact('รายงานใบชั่งเข้า–ชั่งออก', ['เลขที่ใบชั่ง', 'ทะเบียนรถ', 'ลูกค้า', 'ชั่งเข้า (กก.)', 'ชั่งออก (กก.)', 'สุทธิ (กก.)', 'วันที่ชั่งออก', 'สถานะ'], 'weighbridge-log');

  });
});
