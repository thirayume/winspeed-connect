import { test, expect } from '@playwright/test';
import path from 'path';

// Load DB client for direct verification
const { wfQuery, runWithTarget, sql } = require(path.join(__dirname, '..', 'backend', 'db'));
const { assertTestDatabase } = require(path.join(__dirname, '..', 'backend', 'tests', 'test-safety'));

const CUST_ID = '23048';
const GOOD_ID = 1156;
const INITIAL_QTY = 15.0;

interface RunReceipt {
  couponId: number | null;
  couponNo: string | null;
  createdSoId: number | null;
  createdReservationId: number | null;
}

const receipt: RunReceipt = {
  couponId: null,
  couponNo: null,
  createdSoId: null,
  createdReservationId: null,
};

async function allocateSyntheticFixture(): Promise<{ couponId: number; couponNo: string }> {
  return await runWithTarget('remote_b', async () => {
    await assertTestDatabase();

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidateId = 981000 + Math.floor(Math.random() * 18000);
      const existing = await wfQuery(
        'SELECT TOP 1 CouponID FROM dbo.WFCoupon WHERE CouponID = @cid UNION SELECT TOP 1 CouponId FROM wf.CouponReservation WHERE CouponId = @cid',
        { cid: { type: sql.Int, value: candidateId } }
      );
      if (!existing.recordset || existing.recordset.length === 0) {
        const candidateNo = `UAT-SO08-${Date.now()}-${candidateId}`;
        await wfQuery(`
          INSERT INTO dbo.WFCoupon (CouponID, GoodID, DocuID, CouponNo, GoodQty, RemaQty, GoodPrice, GoodName)
          VALUES (@cid, @gid, 276866, @cno, @qty, @qty, 15000, @gname)
        `, {
          cid: { type: sql.Int, value: candidateId },
          gid: { type: sql.Int, value: GOOD_ID },
          cno: { type: sql.VarChar(25), value: candidateNo },
          qty: { type: sql.Decimal(12, 4), value: INITIAL_QTY },
          gname: { type: sql.VarChar(200), value: '0-0-60 (เม็ด)  ตรารถเกษตร' }
        });

        receipt.couponId = candidateId;
        receipt.couponNo = candidateNo;
        return { couponId: candidateId, couponNo: candidateNo };
      }
    }
    throw new Error('Failed to allocate unique synthetic coupon ID after 50 attempts');
  });
}

async function cleanupRunReceipt() {
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();

    if (receipt.createdReservationId) {
      await wfQuery('DELETE FROM wf.CouponReservation WHERE Id = @rid', {
        rid: { type: sql.Int, value: receipt.createdReservationId }
      });
    } else if (receipt.couponId) {
      await wfQuery('DELETE FROM wf.CouponReservation WHERE CouponId = @cid', {
        cid: { type: sql.Int, value: receipt.couponId }
      });
    }

    if (receipt.createdSoId) {
      await wfQuery('DELETE FROM wf.SalesOrderLine WHERE SOID = @soId', {
        soId: { type: sql.Int, value: receipt.createdSoId }
      });
      await wfQuery('DELETE FROM wf.SalesOrder WHERE Id = @soId', {
        soId: { type: sql.Int, value: receipt.createdSoId }
      });
    }

    if (receipt.couponId) {
      await wfQuery('DELETE FROM dbo.WFCoupon WHERE CouponID = @cid', {
        cid: { type: sql.Int, value: receipt.couponId }
      });
    }
  });
}

async function getReservationStatus() {
  if (!receipt.couponId) return [];
  return await runWithTarget('remote_b', async () => {
    const res = await wfQuery(
      'SELECT Id, Status, ReservedQty, CarrierSoId, CancelReason FROM wf.CouponReservation WHERE CouponId = @cid ORDER BY Id DESC',
      { cid: { type: sql.Int, value: receipt.couponId } }
    );
    return res.recordset || [];
  });
}

async function dismissAllAlertsAndConfirms(page: any) {
  for (let i = 0; i < 5; i++) {
    const okBtn = page.locator('div.z-\\[99999\\] button:has-text("ตกลง"), button:has-text("ตกลง")').first();
    if (await okBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await okBtn.click();
      await page.waitForTimeout(400);
    } else {
      break;
    }
  }
}

test.describe('SO-08 Browser UAT Gate: Real SalesPortal Journey', () => {
  test.beforeEach(async () => {
    await allocateSyntheticFixture();
  });

  test.afterEach(async () => {
    await cleanupRunReceipt();
  });

  test('Full Journey: Login -> Setup Trip -> Reserve Coupon -> Save SO -> Reload -> Edit -> Discard -> Save Removal', async ({ page }) => {
    test.setTimeout(90000);

    // Handle all native browser dialogs
    page.on('dialog', async (dialog) => {
      console.log(`[Native Dialog] ${dialog.type()}: ${dialog.message()}`);
      await dialog.accept();
    });

    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Login as Sales User (emp-00002)
    await page.goto('/login');
    await expect(page.locator('input[type="text"], input[name="username"]')).toBeVisible();
    await page.fill('input[type="text"], input[name="username"]', 'emp-00002');
    await page.fill('input[type="password"]', 'W0rldF3rt');
    await page.click('button:has-text("เข้าสู่ระบบ")');

    // Wait for authenticated view and navigate to Sales Portal
    const salesBtn = page.getByRole('button', { name: 'ขาย', exact: true });
    await expect(salesBtn).toBeVisible({ timeout: 15000 });
    await salesBtn.click();

    // Verify on Sales Portal
    await expect(page.locator('text=Sales Portal')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/artifacts/so08-01-sales-portal.png' });

    // 2. Open Trip Setup Modal and enter trip info
    await page.click('button:has-text("สร้างบิล")');
    await expect(page.locator('text=ข้อมูลการจัดส่ง (Trip)')).toBeVisible({ timeout: 5000 });

    const testPlate = '70-9888';
    await page.fill('input[placeholder*="70-4088"]', testPlate);
    await page.screenshot({ path: 'test-results/artifacts/so08-02-trip-setup.png' });

    // Confirm and open CreateSODialog
    await page.click('button:has-text("ยืนยันและเริ่มจัดออร์เดอร์")');
    await expect(page.locator('button[data-testid="btn-open-coupon-picker"]')).toBeVisible({ timeout: 10000 });

    // 3. Select Customer 23048 (Owner of synthetic coupon)
    await page.click('input[placeholder*="ค้นหารหัสหรือชื่อลูกค้า"]');
    await page.fill('input[placeholder*="ค้นหารหัสหรือชื่อลูกค้า"]', CUST_ID);
    await page.waitForTimeout(500);
    const custOption = page.locator(`div:has-text("${CUST_ID}")`).last();
    await custOption.click();

    await expect(page.locator(`text=[${CUST_ID}]`)).toBeVisible();
    await page.screenshot({ path: 'test-results/artifacts/so08-03-customer-selected.png' });

    // 4. Open CouponPickerModal and Reserve 5.0 Tons
    await page.click('button[data-testid="btn-open-coupon-picker"]');
    await expect(page.locator('div[data-testid="coupon-picker-modal"]')).toBeVisible({ timeout: 8000 });

    // Select synthetic coupon card
    const synthCard = page.locator(`div[data-testid="card-coupon-${receipt.couponId}"]`);
    await expect(synthCard).toBeVisible({ timeout: 8000 });
    await synthCard.click();

    // Enter 5.0 tons
    await expect(page.locator('input[data-testid="input-reserve-amount"]')).toBeVisible();
    await page.fill('input[data-testid="input-reserve-amount"]', '5.0');
    await page.screenshot({ path: 'test-results/artifacts/so08-04-coupon-amount-entered.png' });

    await page.click('button[data-testid="btn-confirm-reserve-coupon"]');

    // Wait for picker to close and verify coupon line is added in bill cart
    await expect(page.locator('div[data-testid="coupon-picker-modal"]')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=ตั๋วปุ๋ย:')).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'test-results/artifacts/so08-05-coupon-line-in-cart.png' });

    // Also add a regular product line so the bill has goods even if coupon line is removed later
    const firstGoodCard = page.locator('button[data-testid^="card-good-"]').first();
    await expect(firstGoodCard).toBeVisible({ timeout: 5000 });
    await firstGoodCard.click();
    await page.waitForTimeout(500);

    // 5. Save SO ("บันทึกการจัดรถ")
    await page.click('button[data-testid="btn-save-so"]');

    // Dismiss any appConfirm and appAlert dialogs
    await page.waitForTimeout(500);
    await dismissAllAlertsAndConfirms(page);

    // Wait for CreateSODialog to close and TripSummaryModal to appear
    await expect(page.locator('div[data-testid="trip-summary-modal"]')).toBeVisible({ timeout: 15000 });
    // Dismiss any trailing alert modal sitting over TripSummaryModal
    await dismissAllAlertsAndConfirms(page);
    await page.screenshot({ path: 'test-results/artifacts/so08-06-trip-summary-after-save.png' });

    // VERIFY DB: Reservation is RESERVED, attached to CarrierSoId, ReservedQty = 5.0
    let reservations = await getReservationStatus();
    expect(reservations.length).toBe(1);
    expect(reservations[0].Status).toBe('RESERVED');
    expect(Number(reservations[0].ReservedQty)).toBe(5.0);
    expect(reservations[0].CarrierSoId).not.toBeNull();
    const createdSoId = reservations[0].CarrierSoId;
    receipt.createdSoId = Number(createdSoId);
    receipt.createdReservationId = reservations[0].Id;
    console.log(`[UAT DB Check 1] SO Created: ${createdSoId}, Reservation Status: ${reservations[0].Status}`);

    // 6. Test Edit -> Discard Flow
    // Click "แก้ไขบิล" inside TripSummaryModal
    const editBtn = page.locator('button:has-text("แก้ไขบิล")').first();
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();

    // CreateSODialog opens in edit mode
    await expect(page.locator('div[data-testid="create-so-dialog"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('div[data-testid="global-loader"]')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('div[data-testid="cart-coupon-line"]')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/artifacts/so08-07-edit-dialog-opened.png' });

    // Remove the coupon line in draft
    await page.click('button[data-testid="btn-remove-coupon-line"]');
    await expect(page.locator('div[data-testid="cart-coupon-line"]')).not.toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/artifacts/so08-08-line-removed-draft.png' });

    // DISCARD: Click Close / Discard (X) button without saving
    await page.click('button[data-testid="btn-close-dialog"]');
    await expect(page.locator('div[data-testid="trip-summary-modal"]')).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'test-results/artifacts/so08-09-discarded-dialog-closed.png' });

    // VERIFY DB: Reservation is STILL RESERVED! Discard MUST NOT cancel persisted reservation
    reservations = await getReservationStatus();
    expect(reservations.length).toBe(1);
    expect(reservations[0].Status).toBe('RESERVED');
    expect(reservations[0].CarrierSoId).toBe(createdSoId);
    console.log(`[UAT DB Check 2] After Discard: Reservation remains ${reservations[0].Status} for SO ${createdSoId}`);

    // 7. Test Edit -> Save Removal Flow
    // Re-open Edit modal
    await editBtn.click();
    await expect(page.locator('div[data-testid="create-so-dialog"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('div[data-testid="global-loader"]')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('div[data-testid="cart-coupon-line"]')).toBeVisible({ timeout: 10000 });

    // Remove the coupon line and this time SAVE changes
    await page.click('button[data-testid="btn-remove-coupon-line"]');
    await expect(page.locator('div[data-testid="cart-coupon-line"]')).not.toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/artifacts/so08-10-line-removed-before-save.png' });

    await page.click('button[data-testid="btn-save-so"]');
    await page.waitForTimeout(500);
    await dismissAllAlertsAndConfirms(page);

    await expect(page.locator('div[data-testid="trip-summary-modal"]')).toBeVisible({ timeout: 15000 });
    await dismissAllAlertsAndConfirms(page);
    await page.screenshot({ path: 'test-results/artifacts/so08-11-saved-removal-completed.png' });

    // VERIFY DB: Reservation is now CANCELLED with CancelReason = 'SO_LINE_REMOVED_ON_EDIT'
    reservations = await getReservationStatus();
    expect(reservations.length).toBe(1);
    expect(reservations[0].Status).toBe('CANCELLED');
    expect(reservations[0].CancelReason).toBe('SO_LINE_REMOVED_ON_EDIT');
    console.log(`[UAT DB Check 3] After Save Removal: Status = ${reservations[0].Status}, Reason = ${reservations[0].CancelReason}`);
  });
});
