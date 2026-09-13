import { test, expect } from '@playwright/test';
import path from 'path';

// Load DB client for direct verification and run-owned fixtures
const { wfQuery, runWithTarget, sql } = require(path.join(__dirname, '..', 'backend', 'db'));
const { assertTestDatabase } = require(path.join(__dirname, '..', 'backend', 'tests', 'test-safety'));

interface RunReceipt {
  claimId: number | null;
  custId: string | null;
}

const receipt: RunReceipt = {
  claimId: null,
  custId: null,
};

async function findEligibleCustomerLot() {
  return await runWithTarget('remote_b', async () => {
    await assertTestDatabase();
    const lotRes = await wfQuery(`
      SELECT TOP 1 CustId, CustName, GoodCode, GoodName, QtyTon, RemainingTonRebate, ListPricePerTon, NetPricePerTon, SourceSOID, SourceListNo, SourceDocuNo, SourceDocuDate
      FROM wf.v_RebateAccrualRemaining
      WHERE RemainingTonRebate >= 0.5
      ORDER BY CustId ASC
    `);
    const lot = lotRes.recordset?.[0];
    if (!lot) {
      throw new Error('No available accrual lot found in test database for SO-09 UAT fixture');
    }
    return lot;
  });
}

async function getCustomerRegionAndManagers(custId: string) {
  return await runWithTarget('remote_b', async () => {
    const custRes = await wfQuery(`
      SELECT c.CustID, c.CustName, a.SaleAreaCode
      FROM dbo.EMCust c
      LEFT JOIN dbo.EMSaleArea a ON a.SaleAreaID = c.SaleAreaID
      WHERE c.CustID = @cid
    `, { cid: { type: sql.NVarChar(20), value: custId } });
    const cust = custRes.recordset?.[0];
    const saleAreaCode = cust?.SaleAreaCode || '03';
    const regionCode = saleAreaCode.slice(0, 2);

    // Find manager assigned to this region
    const correctMgrRes = await wfQuery(`
      SELECT TOP 1 u.Id, u.Username, u.DisplayName, a.RegionCode
      FROM wf.UserSaleArea a
      JOIN wf.AppUser u ON u.Id = a.UserId
      WHERE a.RegionCode = @rcode AND u.Role = 'MANAGER'
    `, { rcode: { type: sql.VarChar(10), value: regionCode } });
    const correctMgr = correctMgrRes.recordset?.[0];

    // Find manager assigned to a DIFFERENT region
    const wrongMgrRes = await wfQuery(`
      SELECT TOP 1 u.Id, u.Username, u.DisplayName, a.RegionCode
      FROM wf.UserSaleArea a
      JOIN wf.AppUser u ON u.Id = a.UserId
      WHERE a.RegionCode <> @rcode AND u.Role = 'MANAGER'
    `, { rcode: { type: sql.VarChar(10), value: regionCode } });
    const wrongMgr = wrongMgrRes.recordset?.[0];

    return { regionCode, correctMgr, wrongMgr };
  });
}

async function cleanupRunReceipt() {
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();
    if (receipt.claimId) {
      const claimId = receipt.claimId;
      // Check if attached to pool to restore claimed amount
      const claimRow = (await wfQuery('SELECT PoolId, ClaimAmt FROM wf.RebateClaim WHERE Id = @id', {
        id: { type: sql.Int, value: claimId }
      })).recordset?.[0];

      if (claimRow?.PoolId && Number(claimRow.ClaimAmt) > 0) {
        await wfQuery(`
          UPDATE wf.RebatePool
          SET ClaimedAmt = CASE WHEN ClaimedAmt >= @amt THEN ClaimedAmt - @amt ELSE 0 END,
              UpdatedAt = GETUTCDATE()
          WHERE Id = @pid
        `, {
          amt: { type: sql.Decimal(12, 2), value: claimRow.ClaimAmt },
          pid: { type: sql.Int, value: claimRow.PoolId }
        });
      }

      await wfQuery('DELETE FROM wf.RebateClaimApproval WHERE ClaimId = @id', { id: { type: sql.Int, value: claimId } });
      await wfQuery('DELETE FROM wf.RebateClaimLine WHERE ClaimId = @id', { id: { type: sql.Int, value: claimId } });
      await wfQuery('DELETE FROM wf.RebateClaimInvoice WHERE ClaimId = @id', { id: { type: sql.Int, value: claimId } });
      await wfQuery('DELETE FROM wf.RebateClaim WHERE Id = @id', { id: { type: sql.Int, value: claimId } });
      console.log(`[Teardown] Cleaned up claim ${claimId} and restored pool ${claimRow?.PoolId}`);
      receipt.claimId = null;
    }
  });
}

test.describe('SO-09 Browser UAT Gate: Rebate Vertical Slice Journey', () => {
  test.afterEach(async () => {
    await cleanupRunReceipt();
  });

  test('Rebate Lifecycle: Sales UI Creation -> 100/0 Breakdown -> Wrong-Region Rejection -> Manager Approval', async ({ page }) => {
    test.setTimeout(120000);

    const lot = await findEligibleCustomerLot();
    const targetCustId = String(lot.CustId);
    receipt.custId = targetCustId;

    const { regionCode, correctMgr, wrongMgr } = await getCustomerRegionAndManagers(targetCustId);
    expect(correctMgr).toBeDefined();
    expect(wrongMgr).toBeDefined();
    console.log(`[UAT Context] Customer ${targetCustId} in Region ${regionCode}. Correct Manager: ${correctMgr.Username}, Wrong Manager: ${wrongMgr.Username}`);

    await page.setViewportSize({ width: 1440, height: 900 });

    page.on('console', msg => console.log(`[PAGE CONSOLE ${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.error('[PAGE ERROR]', err));
    page.on('response', res => {
      if (res.status() >= 400) console.warn(`[HTTP ERROR ${res.status()}]`, res.url());
    });

    // ─────────────────────────────────────────────────────────────
    // 1. Login as Sales User (emp-00002) & Navigate to Rebate
    // ─────────────────────────────────────────────────────────────
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/login';
    });
    await expect(page.locator('input[placeholder="username"]')).toBeVisible({ timeout: 10000 });
    await page.fill('input[placeholder="username"]', 'emp-00002');
    await page.fill('input[type="password"]', 'W0rldF3rt');
    await page.click('button:has-text("เข้าสู่ระบบ")');

    const rebateNav = page.locator('button[title*="รีเบท"], button:has-text("รีเบท (App)"), button:has-text("รีเบท")').first();
    await expect(rebateNav).toBeVisible({ timeout: 15000 });
    await rebateNav.click();

    await expect(page.locator('h1:has-text("รีเบท (Rebate)")')).toBeVisible({ timeout: 10000 });

    // ─────────────────────────────────────────────────────────────
    // 2. Open Pool & Launch UI ClaimDialog
    // ─────────────────────────────────────────────────────────────
    const poolCard = page.locator('[data-testid^="pool-card-"]').first();
    await expect(poolCard).toBeVisible({ timeout: 10000 });
    await poolCard.click();

    const openClaimBtn = page.locator('button[data-testid="open-claim-dialog-button"], button:has-text("ยื่นเคลม (FIFO)")').first();
    await expect(openClaimBtn).toBeVisible({ timeout: 10000 });
    await openClaimBtn.click();

    await expect(page.locator('text=แบบขออนุมัติเคลียร์รายการส่งเสริมการขาย')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('input[data-testid="claim-cust-id-input"]')).toBeVisible();

    // ─────────────────────────────────────────────────────────────
    // 3. Fill Customer -> Fetch Lots -> Pick FIFO Lot
    // ─────────────────────────────────────────────────────────────
    await page.fill('input[data-testid="claim-cust-id-input"]', targetCustId);
    await page.click('button[data-testid="fetch-lots-button"]');

    const useLotBtn = page.locator('button[data-testid="use-lot-button"]').first();
    await expect(useLotBtn).toBeVisible({ timeout: 15000 });
    await useLotBtn.click();

    // Fill line params: qty 0.5, price 11100, net 10600 (Rebate 500/ton -> total 250 baht)
    const qtyInput = page.locator('input[data-testid="line-qtyTon-0"]');
    await expect(qtyInput).toBeVisible({ timeout: 5000 });
    await qtyInput.fill('0.5');

    const priceInput = page.locator('input[data-testid="line-pricePerTon-0"]');
    await priceInput.fill('11100');

    const netInput = page.locator('input[data-testid="line-netPricePerTon-0"]');
    await netInput.fill('10600');

    // ─────────────────────────────────────────────────────────────
    // 4. Verify 100/0 Rule & Policy Breakdown on UI
    // ─────────────────────────────────────────────────────────────
    await expect(page.locator('text=สัดส่วนการคืนเงินตามนโยบายระบบ (Rebate Policy Distribution)')).toBeVisible();
    await expect(page.locator('text=นโยบายคืนลูกค้า 100% (ปิด Self Claim ตามกฎ)')).toBeVisible();
    await expect(page.locator('text=สัดส่วนลูกค้า: 100%')).toBeVisible();
    await expect(page.locator('text=สะสมบริษัท: 0%')).toBeVisible();

    // Enter note
    await page.fill('textarea[data-testid="claim-note-input"]', `UAT E2E Rebate Journey Claim ${Date.now()}`);
    await page.screenshot({ path: 'test-results/artifacts/so09-01-sales-create-claim-dialog.png' });

    // ─────────────────────────────────────────────────────────────
    // 5. Submit Claim via UI and Capture Claim ID from response
    // ─────────────────────────────────────────────────────────────
    const submitBtn = page.locator('button[data-testid="submit-claim-button"]');
    await expect(submitBtn).toBeEnabled();

    const [claimResponse] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/rebate/claims') && res.request().method() === 'POST'),
      submitBtn.click(),
    ]);

    expect(claimResponse.status()).toBe(200);
    const claimData = await claimResponse.json();
    console.log('[DEBUG claimData]', claimData);
    const createdClaimId = Number(claimData.Id || claimData.id || claimData.claim?.Id || claimData.claim?.id);
    expect(createdClaimId).toBeGreaterThan(0);
    receipt.claimId = createdClaimId;
    console.log(`[UAT Playwright] Successfully created claim ID: ${receipt.claimId} via UI ClaimDialog!`);

    await expect(page.locator('text=แบบขออนุมัติเคลียร์รายการส่งเสริมการขาย')).not.toBeVisible({ timeout: 8000 });

    // ─────────────────────────────────────────────────────────────
    // 6. Verify Created Claim in Claims List & Inspect Detail Modal
    // ─────────────────────────────────────────────────────────────
    const claimCard = page.locator(`button[data-testid="claim-card-${receipt.claimId}"], button:has-text("#${receipt.claimId}")`).first();
    await expect(claimCard).toBeVisible({ timeout: 15000 });
    await claimCard.click();

    const detailModal = page.locator('[data-testid="claim-detail-dialog"]');
    await expect(page.locator('[data-testid="claim-detail-title"]')).toContainText(String(receipt.claimId), { timeout: 15000 });
    await expect(detailModal.locator('text=รอผู้จัดการภาค').first()).toBeVisible({ timeout: 10000 });

    // Segregation of Duties: Sales cannot approve their own claim
    const approveBtnForSales = detailModal.locator('button[data-testid="approve-claim-button"]');
    await expect(approveBtnForSales).not.toBeVisible();

    await page.screenshot({ path: 'test-results/artifacts/so09-02-sales-claim-details.png' });
    await page.click('button[data-testid="close-claim-detail"], button[aria-label="close-modal"]');

    // ─────────────────────────────────────────────────────────────
    // 7. Negative Test: Wrong-Region Manager Rejection Guard
    // ─────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/login';
    });
    await expect(page.locator('input[placeholder="username"]')).toBeVisible({ timeout: 10000 });
    await page.fill('input[placeholder="username"]', wrongMgr.Username);
    await page.fill('input[type="password"]', 'W0rldF3rt');
    await page.click('button:has-text("เข้าสู่ระบบ")');

    const wrongMgrRebateNav = page.locator('button[title*="รีเบท"], button:has-text("รีเบท (App)"), button:has-text("รีเบท")').first();
    await expect(wrongMgrRebateNav).toBeVisible({ timeout: 15000 });
    await wrongMgrRebateNav.click();

    const wrongMgrClaimCard = page.locator(`button[data-testid="claim-card-${receipt.claimId}"], button:has-text("#${receipt.claimId}")`).first();
    await expect(wrongMgrClaimCard).toBeVisible({ timeout: 15000 });
    await wrongMgrClaimCard.click();

    await expect(page.locator('[data-testid="claim-detail-title"]')).toContainText(String(receipt.claimId), { timeout: 15000 });

    const approveBtnWrongMgr = page.locator('[data-testid="claim-detail-dialog"] button[data-testid="approve-claim-button"]');
    await expect(approveBtnWrongMgr).toBeVisible({ timeout: 8000 });
    await approveBtnWrongMgr.click();

    // Verify 403 rejection message displayed on UI
    await expect(page.locator('[data-testid="claim-detail-dialog"]').locator(`text=ไม่มีสิทธิ์อนุมัติชั้นที่ 2 (ผู้จัดการภาค ${regionCode})`)).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'test-results/artifacts/so09-03-wrong-region-manager-rejected.png' });
    await page.click('button[data-testid="close-claim-detail"], button[aria-label="close-modal"]');

    // Verify claim is still TIER2_PENDING in DB
    await runWithTarget('remote_b', async () => {
      const dbRow = (await wfQuery('SELECT Status, CurrentTier FROM wf.RebateClaim WHERE Id = @id', {
        id: { type: sql.Int, value: receipt.claimId }
      })).recordset?.[0];
      expect(dbRow.CurrentTier).toBe(2);
      expect(dbRow.Status).toBe('TIER2_PENDING');
    });

    // ─────────────────────────────────────────────────────────────
    // 8. Positive Test: Correct-Region Manager Approves Claim
    // ─────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/login';
    });
    await expect(page.locator('input[placeholder="username"]')).toBeVisible({ timeout: 10000 });
    await page.fill('input[placeholder="username"]', correctMgr.Username);
    await page.fill('input[type="password"]', 'W0rldF3rt');
    await page.click('button:has-text("เข้าสู่ระบบ")');

    const correctMgrRebateNav = page.locator('button[title*="รีเบท"], button:has-text("รีเบท (App)"), button:has-text("รีเบท")').first();
    await expect(correctMgrRebateNav).toBeVisible({ timeout: 15000 });
    await correctMgrRebateNav.click();

    const correctMgrClaimCard = page.locator(`button[data-testid="claim-card-${receipt.claimId}"], button:has-text("#${receipt.claimId}")`).first();
    await expect(correctMgrClaimCard).toBeVisible({ timeout: 15000 });
    await correctMgrClaimCard.click();

    await expect(page.locator('[data-testid="claim-detail-title"]')).toContainText(String(receipt.claimId), { timeout: 15000 });

    const approveBtnCorrectMgr = page.locator('button[data-testid="approve-claim-button"]');
    await expect(approveBtnCorrectMgr).toBeVisible({ timeout: 8000 });
    await approveBtnCorrectMgr.click();

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/artifacts/so09-04-correct-region-manager-approved.png' });

    // ─────────────────────────────────────────────────────────────
    // 9. Final Database Verification
    // ─────────────────────────────────────────────────────────────
    await runWithTarget('remote_b', async () => {
      const dbRow = (await wfQuery('SELECT Status, CurrentTier FROM wf.RebateClaim WHERE Id = @id', {
        id: { type: sql.Int, value: receipt.claimId }
      })).recordset?.[0];
      expect(dbRow.CurrentTier).toBe(3);
      expect(dbRow.Status).toBe('TIER3_PENDING');

      const approvals = (await wfQuery('SELECT Tier, RequiredRole, Decision, DecidedBy FROM wf.RebateClaimApproval WHERE ClaimId = @id ORDER BY ApprovalId ASC', {
        id: { type: sql.Int, value: receipt.claimId }
      })).recordset;
      expect(approvals.length).toBe(2);
      expect(approvals[0].Tier).toBe(1);
      expect(approvals[0].Decision).toBe('APPROVED');
      expect(approvals[1].Tier).toBe(2);
      expect(approvals[1].Decision).toBe('APPROVED');
      expect(String(approvals[1].DecidedBy)).toBe(String(correctMgr.Id));
      console.log(`[UAT DB Check] Claim ${receipt.claimId} successfully verified in DB!`);
    });
  });
});
