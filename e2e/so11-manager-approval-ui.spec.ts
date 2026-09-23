import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { login, logout, openSidebar, waitForUiIdle, api } from './helpers';

const { runWithTarget, wfQuery, sql } = require(path.join(__dirname, '..', 'backend', 'db'));
const { assertTestDatabase } = require(path.join(__dirname, '..', 'backend', 'tests', 'test-safety'));

const ARTIFACT_DIR = 'C:\\Users\\amyou\\.gemini\\antigravity-ide\\brain\\61b294eb-26f6-4516-b079-04180a0a706c';

function copyArtifact(srcPath: string, destFileName: string) {
  try {
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(ARTIFACT_DIR, destFileName));
      console.log(`[ARTIFACT] Copied ${destFileName} to artifact store`);
    }
  } catch (err) {
    console.error(`Failed to copy artifact ${destFileName}:`, err);
  }
}

const SALES_USER = 'emp-00002';
const MANAGER_USER = 'emp-00021';

const tracked = {
  tripIds: new Set<number>(),
  draftSoIds: new Set<number>(),
  priceApprovalIds: new Set<number>()
};

test.describe.serial('SO-11: Manager UI Approval for Low-Price Request (Hostinger TEST)', () => {
  test.setTimeout(180_000);

  let tripId: number;
  let tripCode: string;
  let soId: number;
  let approvalId: number;

  test.beforeAll(async () => {
    const baseURL = process.env.E2E_BASE_URL || 'https://test.thirayu.online';
    if (!baseURL.includes('test.thirayu.online') && !baseURL.includes('localhost')) {
      throw new Error(`CRITICAL TEST SAFETY: Unexpected baseURL "${baseURL}". Must target TEST environment.`);
    }

    await runWithTarget('remote_b', async () => {
      await assertTestDatabase();
    });
  });

  test.afterAll(async () => {
    console.log('[SO-11 PRICE UAT CLEANUP] Starting teardown on remote_b...');
    await runWithTarget('remote_b', async () => {
      if (tracked.priceApprovalIds.size > 0) {
        for (const paid of tracked.priceApprovalIds) {
          await wfQuery(`DELETE FROM wf.PriceApproval WHERE Id = @paid`, { paid: { type: sql.Int, value: paid } });
        }
        tracked.priceApprovalIds.clear();
      }

      if (tracked.draftSoIds.size > 0) {
        for (const dId of tracked.draftSoIds) {
          await wfQuery(`DELETE FROM wf.PriceApproval WHERE SoId = @dId`, { dId: { type: sql.Int, value: dId } });
          await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SoId = @dId`, { dId: { type: sql.Int, value: dId } });
          await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @dId`, { dId: { type: sql.Int, value: dId } });
        }
        tracked.draftSoIds.clear();
      }

      if (tracked.tripIds.size > 0) {
        for (const tId of tracked.tripIds) {
          await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @tId`, { tId: { type: sql.Int, value: tId } });
        }
        tracked.tripIds.clear();
      }
    });
  });

  test('Sales low-price blocked in UI -> Manager approves via actual EditRequests UI controls', async ({ page }) => {
    // -------------------------------------------------------------
    // STEP 1: Sales User Login & Creates Trip with Low-Price Bill
    // -------------------------------------------------------------
    console.log('[STEP 1] Sales logs in and creates trip with low-price SO...');
    await login(page, SALES_USER);

    // Create Trip & Low-Price SO via API
    const truckPlate = `70-${Math.floor(1000 + Math.random() * 9000)}`;
    const tripRes = await api<any>(page, '/trips', {
      method: 'POST',
      data: {
        transRegistration: truckPlate,
        truckCapacityTon: 15.0
      }
    });
    tripId = Number(tripRes.body.tripId);
    tripCode = tripRes.body.tripCode;
    tracked.tripIds.add(tripId);

    const soRes = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        soPrefix: 'AI',
        custId: '1000',
        custName: 'พาต้าเคมีคอล แอนด์ แมชชีนเนอรี่ จำกัด',
        tripId,
        lines: [
          {
            goodId: '1097',
            goodCode: '7-13032100BBCAR',
            goodName: '13-3-21',
            qtyTon: 10.0,
            pricePerTon: 500.0 // Below announced price!
          }
        ]
      }
    });
    soId = Number(soRes.body.id);
    tracked.draftSoIds.add(soId);
    expect(soRes.body.needsApproval).toBe(true);

    // -------------------------------------------------------------
    // STEP 2: Sales Sees Warning Badge in UI & Confirmation is Blocked
    // -------------------------------------------------------------
    console.log('[STEP 2] Verifying Sales sees "⏳ รออนุมัติราคา" badge in UI...');
    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    // Open the trip card
    const tripCard = page.locator(`div:has-text("${tripCode}")`).first();
    await expect(tripCard).toBeVisible({ timeout: 15_000 });
    await tripCard.locator('button:has-text("จัดการทริป")').first().click();

    await expect(page.locator('[data-testid="trip-summary-modal"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=รออนุมัติราคา').first()).toBeVisible({ timeout: 10_000 });

    // Sales attempts to confirm trip
    const confirmBtn = page.locator('[data-testid="btn-confirm-trip"], button:has-text("ยืนยัน")').first();
    await confirmBtn.click();
    await page.waitForTimeout(500);

    // Verify React modal dialog shows below-announced price block
    await expect(page.getByText('ไม่สามารถยืนยันได้').first()).toBeVisible({ timeout: 5_000 });

    const shot1 = 'docs/evidence/so11-ui-price-01-sales-blocked.png';
    await page.screenshot({ path: shot1, fullPage: true });
    copyArtifact(shot1, 'so11-ui-price-01-sales-blocked.png');

    // Click "ตกลง" to dismiss dialog
    await page.getByRole('button', { name: 'ตกลง' }).first().click();
    await page.waitForTimeout(500);

    // Query approvalId from DB
    await runWithTarget('remote_b', async () => {
      const pa = await wfQuery(`SELECT Id, Status FROM wf.PriceApproval WHERE SoId = @soId`, {
        soId: { type: sql.Int, value: soId }
      });
      expect(pa.recordset.length).toBeGreaterThan(0);
      approvalId = pa.recordset[0].Id;
      tracked.priceApprovalIds.add(approvalId);
      expect(pa.recordset[0].Status).toBe('PENDING');
      console.log(`[STEP 2] DB verified PriceApproval row: Id=${approvalId}, Status=PENDING`);
    });

    // -------------------------------------------------------------
    // STEP 3: Manager Logs In & Uses Actual EditRequests Approval Controls
    // -------------------------------------------------------------
    console.log('[STEP 3] Logging in as Manager User...');
    await logout(page);
    await login(page, MANAGER_USER);
    await openSidebar(page, 'คำขอแก้ไขและอนุมัติ');
    await waitForUiIdle(page);

    // Switch to "อนุมัติราคาขายต่ำกว่าประกาศ" tab
    console.log('[STEP 3] Switching to "อนุมัติราคาขายต่ำกว่าประกาศ" tab...');
    const priceTab = page.locator('button:has-text("ขออนุมัติราคาต่ำกว่าประกาศ")').first();
    await expect(priceTab).toBeVisible({ timeout: 10_000 });
    await priceTab.click();
    await waitForUiIdle(page);

    // Find the exact approval card for this SO
    const approvalCard = page.locator('.rounded-lg.border.bg-white', { hasText: `#${approvalId}` }).first();
    await expect(approvalCard).toBeVisible({ timeout: 10_000 });

    // Click "อนุมัติราคา" button in the card
    console.log('[STEP 3] Clicking "อนุมัติราคา" button in UI card...');
    const approveBtn = approvalCard.locator('button:has-text("อนุมัติราคา")').first();
    await approveBtn.click();
    await page.waitForTimeout(500);

    // Fill approval note input
    const noteInput = approvalCard.locator('input[placeholder*="หมายเหตุการอนุมัติ"]').first();
    await expect(noteInput).toBeVisible({ timeout: 5_000 });
    await noteInput.fill('อนุมัติราคาพิเศษกรณีพิเศษ (SO11 Manager UI Rehearsal)');

    // Click "ยืนยันอนุมัติ" button and observe PATCH /api/edit-requests/price-approvals/:id/approve response
    console.log('[STEP 3] Submitting approval form via UI...');
    const [approveRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes(`/api/edit-requests/price-approvals/${approvalId}/approve`) && res.request().method() === 'PATCH' && res.status() === 200),
      approvalCard.locator('button:has-text("ยืนยันอนุมัติ")').first().click()
    ]);
    const approveJson = await approveRes.json();
    console.log('[STEP 3] Manager approval API response observed:', approveJson);
    expect(approveJson.status).toBe('APPROVED');

    // Switch status filter dropdown to 'APPROVED' (อนุมัติแล้ว) to view approved row in UI
    console.log('[STEP 3] Switching status filter to "อนุมัติแล้ว"...');
    const statusSelect = page.locator('select:has(option[value="APPROVED"])').first();
    await statusSelect.selectOption('APPROVED');
    await waitForUiIdle(page);

    // Verify card updates to "อนุมัติแล้ว" in UI
    const approvedCard = page.locator('.rounded-lg.border.bg-white', { hasText: `#${approvalId}` }).first();
    await expect(approvedCard.getByText('อนุมัติแล้ว').first()).toBeVisible({ timeout: 10_000 });

    const shot2 = 'docs/evidence/so11-ui-price-02-manager-approved.png';
    await page.screenshot({ path: shot2, fullPage: true });
    copyArtifact(shot2, 'so11-ui-price-02-manager-approved.png');

    // -------------------------------------------------------------
    // STEP 4: Sales Returns, Verifies Unblocked State in UI
    // -------------------------------------------------------------
    console.log('[STEP 4] Logging back in as Sales to verify approved state...');
    await logout(page);
    await login(page, SALES_USER);
    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    // Open trip card
    const verifiedTripCard = page.locator(`div:has-text("${tripCode}")`).first();
    await expect(verifiedTripCard).toBeVisible({ timeout: 10_000 });
    await verifiedTripCard.locator('button:has-text("จัดการทริป")').first().click();
    await waitForUiIdle(page);

    // Verify DB confirms status is APPROVED
    await runWithTarget('remote_b', async () => {
      const pa = await wfQuery(`SELECT Status FROM wf.PriceApproval WHERE Id = @paid`, {
        paid: { type: sql.Int, value: approvalId }
      });
      expect(pa.recordset[0].Status).toBe('APPROVED');
      console.log(`[STEP 4] DB verified PriceApproval #${approvalId} is APPROVED`);
    });

    const shot3 = 'docs/evidence/so11-ui-price-03-sales-verified-approved.png';
    await page.screenshot({ path: shot3, fullPage: true });
    copyArtifact(shot3, 'so11-ui-price-03-sales-verified-approved.png');

    console.log('[SUCCESS] SO-11 Manager UI Price Approval workflow PASSED 100%!');
  });
});
