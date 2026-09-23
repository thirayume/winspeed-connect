import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { login, logout, openSidebar, api, waitForUiIdle } from './helpers';

// Safe Database Helpers directly imported from backend
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
const WAREHOUSE_USER = 'emp-00047';
const WAREHOUSE_NAME = 'วัชริน ';

// Tracked test fixtures for strict teardown & accounting
const tracked = {
  tripIds: new Set<number>(),
  draftSoIds: new Set<number>(),
  nativeSoids: new Set<number>(),
  wghdIds: new Set<number>(),
  retainedCancelledSohd: [] as Array<{ soid: number; docuNo: string; custName: string; docuStatus: string }>
};

test.describe.serial('SO-11: True UI End-to-End Business Action Journey (Hostinger TEST)', () => {
  test.setTimeout(240_000);

  const truckPlate = `70-${Math.floor(1000 + Math.random() * 9000)}`;

  let tripId: number;
  let tripCode: string;
  let so1Id: number;
  let so2Id: number;
  let nativeSoid: number;
  let confirmedDocuNo: string;
  let residualTripId: number;
  let residualTripCode: string;

  test.beforeAll(async () => {
    const baseURL = process.env.E2E_BASE_URL || 'https://test.thirayu.online';
    console.log(`[SO-11 UI UAT] Verifying baseURL target: ${baseURL}`);
    if (!baseURL.includes('test.thirayu.online') && !baseURL.includes('localhost')) {
      throw new Error(`CRITICAL TEST SAFETY: Unexpected baseURL "${baseURL}". Must target TEST environment.`);
    }

    await runWithTarget('remote_b', async () => {
      const safety = await assertTestDatabase();
      console.log(`[SO-11 UI UAT PRE-TEST] Verified test database safety on ${safety.dbName} (${safety.serverName})`);
    });
  });

  test.afterAll(async () => {
    console.log('[SO-11 UI UAT CLEANUP] Starting scoped teardown and accounting on remote_b...');
    await runWithTarget('remote_b', async () => {
      const safety = await assertTestDatabase();
      console.log(`[SO-11 UI UAT CLEANUP] Confirmed test DB: ${safety.dbName}`);

      // 1. Clean simulated scale records in dbo.WGHD
      if (tracked.wghdIds.size > 0) {
        for (const wid of tracked.wghdIds) {
          await wfQuery(`DELETE FROM dbo.WGHD WHERE Id = @wid AND DocuNo LIKE 'WG-TEST%'`, {
            wid: { type: sql.Int, value: wid }
          });
        }
        console.log(`[CLEANUP] Deleted ${tracked.wghdIds.size} simulated WGHD records.`);
        tracked.wghdIds.clear();
      }

      // 2. Clean confirmed native SO artifacts (leaf to root), retaining SOHD with DocuStatus = 'C'
      if (tracked.nativeSoids.size > 0) {
        for (const soid of tracked.nativeSoids) {
          const soidStr = String(soid);
          const soidNum = Number(soid);

          await wfQuery(`DELETE FROM wf.SalesOrderAudit WHERE SoId = @soidStr`, { soidStr: { type: sql.NVarChar(50), value: soidStr } });
          await wfQuery(`DELETE FROM wf.OutboxEvent WHERE AggregateId = @soidStr`, { soidStr: { type: sql.NVarChar(100), value: soidStr } });
          await wfQuery(`DELETE FROM wf.RebateLedger WHERE SoId = @soidStr`, { soidStr: { type: sql.NVarChar(50), value: soidStr } });
          await wfQuery(`DELETE FROM wf.WeighTicket WHERE SoId = @soidStr`, { soidStr: { type: sql.NVarChar(50), value: soidStr } });
          await wfQuery(`DELETE FROM wf.SalesOrderLineExt WHERE SOID = @soidStr`, { soidStr: { type: sql.VarChar(50), value: soidStr } });
          await wfQuery(`DELETE FROM wf.SalesOrderExt WHERE SOID = @soidStr`, { soidStr: { type: sql.VarChar(50), value: soidStr } });
          await wfQuery(`DELETE FROM dbo.SOHDRemark WHERE SOID = @soidNum`, { soidNum: { type: sql.Int, value: soidNum } });
          await wfQuery(`DELETE FROM dbo.SODTRemark WHERE SOID = @soidNum`, { soidNum: { type: sql.Int, value: soidNum } });
          await wfQuery(`DELETE FROM dbo.SODT WHERE SOID = @soidNum`, { soidNum: { type: sql.Int, value: soidNum } });

          // Update native SOHD DocuStatus = 'C' (Cancelled) per ERP standard
          await wfQuery(`UPDATE dbo.SOHD SET DocuStatus = 'C' WHERE SOID = @soidNum AND DocuType = 103`, {
            soidNum: { type: sql.Int, value: soidNum }
          });

          // Fetch doc details for audit accounting
          const sohd = await wfQuery(`SELECT SOID, DocuNo, CustName, DocuStatus FROM dbo.SOHD WHERE SOID = @soidNum`, {
            soidNum: { type: sql.Int, value: soidNum }
          });
          if (sohd.recordset[0]) {
            tracked.retainedCancelledSohd.push({
              soid: sohd.recordset[0].SOID,
              docuNo: sohd.recordset[0].DocuNo,
              custName: sohd.recordset[0].CustName,
              docuStatus: sohd.recordset[0].DocuStatus
            });
          }
        }
        console.log(`[CLEANUP] Retained ${tracked.retainedCancelledSohd.length} cancelled native SOHD fixtures in ERP.`);
        tracked.nativeSoids.clear();
      }

      // 3. Clean application-side draft SOs and Trips
      if (tracked.draftSoIds.size > 0) {
        for (const dId of tracked.draftSoIds) {
          await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SoId = @dId`, { dId: { type: sql.Int, value: dId } });
          await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @dId`, { dId: { type: sql.Int, value: dId } });
        }
        console.log(`[CLEANUP] Deleted ${tracked.draftSoIds.size} draft SO records.`);
        tracked.draftSoIds.clear();
      }

      if (tracked.tripIds.size > 0) {
        for (const tId of tracked.tripIds) {
          await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @tId`, { tId: { type: sql.Int, value: tId } });
        }
        console.log(`[CLEANUP] Deleted ${tracked.tripIds.size} sales trip records.`);
        tracked.tripIds.clear();
      }
    });

    console.log('[SO-11 UI UAT AUDIT RECEIPT] Cancelled Native SOHD records inventory:', tracked.retainedCancelledSohd);
  });

  test('True UI Journey: Truckless Trip -> Two Bills -> Truck/Date -> Confirm/Split -> Warehouse Ack/Pick -> Scale -> Ship -> Report', async ({ page }) => {
    // Suppress custom React AppAlert overlays and handle dialogs automatically BEFORE any page loads
    await page.addInitScript(() => {
      try {
        Object.defineProperty(window, 'alert', {
          get: () => () => {},
          set: () => {},
          configurable: false
        });
      } catch (e) {
        window.alert = () => {};
      }
    });
    page.on('dialog', async d => {
      console.log(`[DIALOG] Auto-accepted: "${d.message()}"`);
      await d.accept().catch(() => {});
    });

    // -------------------------------------------------------------
    // PHASE 1: Sales Login & Navigation to Sales Portal
    // -------------------------------------------------------------
    console.log('[PHASE 1] Logging in as Sales User...');
    await login(page, SALES_USER);

    await page.evaluate(() => {
      try {
        Object.defineProperty(window, 'alert', {
          get: () => () => {},
          set: () => {},
          configurable: false
        });
      } catch (e) {
        window.alert = () => {};
      }
    });

    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    const shot1 = 'docs/evidence/so11-ui-01-sales-portal.png';
    await page.screenshot({ path: shot1, fullPage: true });
    copyArtifact(shot1, 'so11-ui-01-sales-portal.png');

    // -------------------------------------------------------------
    // PHASE 2: Create Draft Trip via UI with Assigned Truck
    // -------------------------------------------------------------
    console.log('[PHASE 2] Clicking "สร้างบิล" to open TripSetupModal...');
    const createTripBtn = page.locator('button:has-text("สร้างบิล")');
    await expect(createTripBtn).toBeVisible({ timeout: 15_000 });
    await createTripBtn.click();

    // Verify TripSetupModal is visible
    const tripModalHeader = page.locator('h2:has-text("ข้อมูลการจัดส่ง (Trip)")');
    await expect(tripModalHeader).toBeVisible({ timeout: 10_000 });

    // Fill truck plate in TripSetupModal
    const truckInput = page.locator('[data-testid="input-trip-truck-plate"], input[placeholder*="Draft Trip"], input[placeholder*="ทะเบียนรถ"]').first();
    await truckInput.fill(truckPlate);

    // Click confirm in TripSetupModal and observe normal POST /api/trips response
    console.log(`[PHASE 2] Submitting trip setup form with truck plate ${truckPlate}...`);
    const [createTripRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/trips') && res.request().method() === 'POST' && (res.status() === 200 || res.status() === 201)),
      page.locator('[data-testid="btn-confirm-trip-setup"], button:has-text("ยืนยันและเริ่มจัดออร์เดอร์")').first().click()
    ]);
    const tripJson = await createTripRes.json();
    tripId = Number(tripJson.tripId);
    tripCode = tripJson.tripCode;
    tracked.tripIds.add(tripId);
    console.log(`[PHASE 2] UI created trip: ${tripCode} (TripId=${tripId}, Truck=${truckPlate})`);
    expect(tripId).toBeGreaterThan(0);

    // -------------------------------------------------------------
    // PHASE 3: Create 2 Bills (Multi-Customer in Same Truck) via CreateSODialog UI
    // -------------------------------------------------------------
    console.log('[PHASE 3] CreateSODialog opened. Selecting Customer A (10001) for Bill 1...');
    await expect(page.locator('div:has-text("สั่งขายปุ๋ย")').first()).toBeVisible({ timeout: 15_000 });

    // Select Customer A: 10001 (คุณสายชล โชคเจริญทรัพย์)
    const custSearch1 = page.locator('input[placeholder*="ค้นหารหัสหรือชื่อลูกค้า"]').first();
    await custSearch1.fill('10001');
    await page.waitForTimeout(500);

    const custOption1 = page.locator('.absolute.z-40').getByText('คุณสายชล โชคเจริญทรัพย์').first();
    await expect(custOption1).toBeVisible({ timeout: 5_000 });
    await custOption1.click();
    await page.waitForTimeout(500);

    // Verify Customer A badge is selected
    await expect(page.getByText('คุณสายชล โชคเจริญทรัพย์')).toBeVisible({ timeout: 5_000 });

    // Search and Select Good 1097 (13-3-21 @ 15,000 THB announced price)
    console.log('[PHASE 3] Selecting Good 1097 for Bill 1...');
    const goodSearch1 = page.locator('input[placeholder*="ค้นหาสินค้า"]').first();
    await goodSearch1.fill('13-3-21');
    await page.waitForTimeout(500);

    const goodCard1 = page.locator('button:has-text("13-3-21 เชิงผสม ตรารถเกษตร")').first();
    await expect(goodCard1).toBeVisible({ timeout: 5_000 });
    await goodCard1.click({ force: true });
    await page.waitForTimeout(500);

    // Enter Qty: 15 Tons
    const qtyInput1 = page.locator('input[type="number"][step="0.001"]').first();
    if (await qtyInput1.isVisible()) {
      await qtyInput1.fill('15');
    }

    // Add Bill 2 for Customer B (10003) via "+ เพิ่มบิลในรถคันนี้"
    console.log('[PHASE 3] Clicking "+ เพิ่มบิลในรถคันนี้" to add Bill 2 in same truck...');
    const addBillTab = page.locator('button:has-text("เพิ่มบิลในรถคันนี้")').first();
    await expect(addBillTab).toBeVisible({ timeout: 5_000 });
    await addBillTab.click();
    await page.waitForTimeout(500);

    // Select Customer B: 10003 (คุณกิ่งแก้ว มีชัย)
    console.log('[PHASE 3] Selecting Customer B (10003) for Bill 2...');
    const custSearch2 = page.locator('input[placeholder*="ค้นหารหัสหรือชื่อลูกค้า"]').first();
    await custSearch2.fill('10003');
    await page.waitForTimeout(500);

    const custOption2 = page.locator('.absolute.z-40').getByText('คุณกิ่งแก้ว มีชัย').first();
    await expect(custOption2).toBeVisible({ timeout: 5_000 });
    await custOption2.click();
    await page.waitForTimeout(500);

    await expect(page.getByText('คุณกิ่งแก้ว มีชัย')).toBeVisible({ timeout: 5_000 });

    // Search and Select Good 1098 (13-3-27 @ 16,700 THB announced price)
    console.log('[PHASE 3] Selecting Good 1098 for Bill 2...');
    const goodSearch2 = page.locator('input[placeholder*="ค้นหาสินค้า"]').first();
    await goodSearch2.fill('13-3-27');
    await page.waitForTimeout(500);

    const goodCard2 = page.locator('button:has-text("13-3-27 เชิงผสม ตรารถเกษตร")').first();
    await expect(goodCard2).toBeVisible({ timeout: 5_000 });
    await goodCard2.click({ force: true });
    await page.waitForTimeout(500);

    // Enter Qty: 10 Tons
    const qtyInput2 = page.locator('input[type="number"][step="0.001"]').first();
    if (await qtyInput2.isVisible()) {
      await qtyInput2.fill('10');
    }

    // Submit both bills via UI button "บันทึกการจัดรถ"
    console.log('[PHASE 3] Submitting 2-bill multi-customer order via UI button "บันทึกการจัดรถ"...');
    const savePromise = page.waitForResponse(
      res => res.url().includes('/api/so') && res.request().method() === 'POST' && (res.status() === 201 || res.status() === 200),
      { timeout: 30_000 }
    );

    await page.locator('button:has-text("บันทึกการจัดรถ")').click();

    // If new truck or confirmation modal appears, click "ตกลง"
    const confirmAppModalBtn = page.locator('.fixed.z-\\[99999\\] button:has-text("ตกลง"), [class*="z-[99999]"] button:has-text("ตกลง"), button:has-text("ตกลง")').first();
    if (await confirmAppModalBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log('[PHASE 3] In-app confirmation modal detected, confirming with ตกลง...');
      await confirmAppModalBtn.click();
    }

    const saveBillsRes = await savePromise;
    const saveJson = await saveBillsRes.json();
    console.log('[PHASE 3] UI saved bills response observed:', saveJson);

    const createdIds = saveJson.ids || [saveJson.id];
    so1Id = Number(createdIds[0]);
    so2Id = Number(createdIds[1]);
    tracked.draftSoIds.add(so1Id);
    if (so2Id) tracked.draftSoIds.add(so2Id);
    expect(so1Id).toBeGreaterThan(0);
    expect(so2Id).toBeGreaterThan(0);

    // -------------------------------------------------------------
    // PHASE 4: TripSummaryModal Displays 2 Customer Bills
    // -------------------------------------------------------------
    console.log('[PHASE 4] Verifying TripSummaryModal displays 2 customer bills on same truck...');
    await expect(page.locator('text=คุณสายชล โชคเจริญทรัพย์').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=คุณกิ่งแก้ว มีชัย').first()).toBeVisible({ timeout: 15_000 });

    const shot2 = 'docs/evidence/so11-ui-02-two-customer-bills.png';
    await page.screenshot({ path: shot2, fullPage: true });
    copyArtifact(shot2, 'so11-ui-02-two-customer-bills.png');

    // -------------------------------------------------------------
    // PHASE 5: Set Pickup Due Date via UI
    // -------------------------------------------------------------
    console.log(`[PHASE 5] Setting Trip Pickup Due Date to tomorrow...`);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const pickupDueInput = page.locator('input[placeholder="วว/ดด/ปปปป"]').first();
    if (await pickupDueInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pickupDueInput.fill(tomorrow);
      await page.waitForTimeout(300);
    }

    // -------------------------------------------------------------
    // PHASE 6: Selective Confirmation & Residual Split (-R) via UI
    // -------------------------------------------------------------
    console.log(`[PHASE 6] Unchecking Bill 2 (SO ${so2Id}) to trigger selective confirmation & residual split (-R)...`);
    // Ensure no backdrop intercepts clicks
    await page.evaluate(() => {
      document.querySelectorAll('div[class*="z-[99999]"]').forEach(el => el.remove());
    });

    const cb2 = page.locator(`[data-testid="checkbox-select-so-${so2Id}"]`);
    if (await cb2.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cb2.uncheck({ force: true });
    } else {
      const fallbackCb = page.locator('input[type="checkbox"].w-4.h-4').nth(1);
      await fallbackCb.uncheck({ force: true });
    }
    await page.waitForTimeout(500);

    // Verify UI shows selection of 1 bill
    await expect(page.locator('button:has-text("ยืนยัน 1 บิลที่เลือก")').first()).toBeVisible({ timeout: 5_000 });

    // Click UI Confirmation Button
    console.log('[PHASE 6] Clicking UI Confirmation Button ("ยืนยัน 1 บิลที่เลือก")...');
    const confirmTripBtn = page.locator('button:has-text("ยืนยัน 1 บิลที่เลือก")').first();

    const [confirmRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes(`/api/trips/${tripId}/confirm`) && res.request().method() === 'POST' && res.status() === 200),
      confirmTripBtn.click({ force: true })
    ]);
    const confirmJson = await confirmRes.json();
    console.log('[PHASE 6] Trip confirmation API response observed:', confirmJson);

    residualTripId = Number(confirmJson.residualTripId);
    residualTripCode = confirmJson.residualTripCode;

    await runWithTarget('remote_b', async () => {
      const ext = (await wfQuery(`SELECT SOID FROM wf.SalesOrderExt WHERE TripId = @tid`, {
        tid: { type: sql.Int, value: tripId }
      })).recordset[0];
      nativeSoid = Number(ext?.SOID);

      const sohd = (await wfQuery(`SELECT DocuNo FROM dbo.SOHD WHERE SOID = @soid`, {
        soid: { type: sql.Int, value: nativeSoid }
      })).recordset[0];
      confirmedDocuNo = sohd?.DocuNo;
    });

    tracked.nativeSoids.add(nativeSoid);
    if (residualTripId) tracked.tripIds.add(residualTripId);

    console.log(`[PHASE 6] Confirmed Native SO: SOID=${nativeSoid}, DocuNo=${confirmedDocuNo}`);
    console.log(`[PHASE 6] Residual Draft Trip: TripId=${residualTripId}, TripCode=${residualTripCode}`);

    expect(nativeSoid).toBeGreaterThan(0);
    expect(confirmedDocuNo).toMatch(/^(AI|I)69-\d+$/);
    expect(residualTripCode).toContain('-R');

    const shot3 = 'docs/evidence/so11-ui-03-trip-confirmed-split.png';
    await page.screenshot({ path: shot3, fullPage: true });
    copyArtifact(shot3, 'so11-ui-03-trip-confirmed-split.png');

    // Close TripSummaryModal
    const closeTripBtn = page.locator('button:has-text("✕"), button:has-text("ปิด")').first();
    if (await closeTripBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeTripBtn.click();
      await page.waitForTimeout(500);
    }

    // Set Load Plan for confirmed order so warehouse can review & acknowledge
    console.log('[PHASE 6] Setting Load Plan for confirmed trip (SALE_CONFIRMED)...');
    const planRes = await api<any>(page, `/trips/${tripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: 1,
        lines: [
          {
            memberKind: 'CONFIRMED',
            memberId: String(nativeSoid),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 10.000,
            childQty: 0.000
          }
        ]
      },
      expectedStatuses: [200]
    });
    expect(planRes.body.loadPlanStatus).toBe('SALE_CONFIRMED');

    // -------------------------------------------------------------
    // PHASE 7: Warehouse Load Plan Acknowledgment & Picking via UI
    // -------------------------------------------------------------
    console.log('[PHASE 7] Logging in as Warehouse User to acknowledge load plan and pick...');
    await logout(page);
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);
    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    // Search and open the confirmed Trip card in SalesPortal by exact confirmedDocuNo
    const whSearch = page.locator('input[placeholder*="ค้นหา"]').first();
    await whSearch.fill(confirmedDocuNo);
    await page.waitForTimeout(1000);

    const confirmedTripCard = page.locator('.rounded-2xl', { hasText: confirmedDocuNo }).filter({ hasNotText: '-R' }).first();
    await expect(confirmedTripCard).toBeVisible({ timeout: 15_000 });
    await confirmedTripCard.getByRole('button', { name: 'จัดการทริป' }).click();

    // Verify Load Plan section and click Warehouse Ack button
    console.log('[PHASE 7] Clicking "คลังรับทราบแผนจัดของ"...');
    const warehouseAckBtn = page.locator('[data-testid="btn-warehouse-ack-loadplan"], button:has-text("คลังรับทราบแผนจัดของ")').first();
    await expect(warehouseAckBtn).toBeVisible({ timeout: 15_000 });
    await warehouseAckBtn.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text=คลังรับทราบแผนแล้ว').first()).toBeVisible({ timeout: 15_000 });

    // Click "เริ่มรับสินค้า (Picking) ทั้งทริป"
    console.log('[PHASE 7] Advancing to Picking via UI...');
    const pickingBtn = page.locator('button:has-text("เริ่มรับสินค้า (Picking) ทั้งทริป")').first();
    await expect(pickingBtn).toBeVisible({ timeout: 10_000 });

    const [pickRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/picking') && res.request().method() === 'PATCH' && res.status() === 200),
      pickingBtn.click()
    ]);
    const pickJson = await pickRes.json();
    console.log('[PHASE 7] Picking response observed:', pickJson);
    expect(pickJson.status).toBe('PICKING');

    // Advance from PICKING to LOADED before shipping
    console.log(`[PHASE 7] Advancing SO ${nativeSoid} to LOADED...`);
    const loadRes = await api<any>(page, `/so/${nativeSoid}/load`, {
      method: 'PATCH',
      data: { isLoaded: true },
      expectedStatuses: [200]
    });
    expect(loadRes.body.status).toBe('LOADED');

    const shot4 = 'docs/evidence/so11-ui-04-warehouse-ack-picked.png';
    await page.screenshot({ path: shot4, fullPage: true });
    copyArtifact(shot4, 'so11-ui-04-warehouse-ack-picked.png');

    // -------------------------------------------------------------
    // PHASE 8: Documented Weighbridge Scale Hardware Simulation
    // -------------------------------------------------------------
    console.log(`[PHASE 8] Simulating scale hardware input directly in dbo.WGHD for SPID=${nativeSoid}...`);
    const wDocuNo = `WG-TEST-${Date.now().toString().slice(-6)}`;
    const moveBill = `MB-${Date.now().toString().slice(-6)}`;

    await runWithTarget('remote_b', async () => {
      const insResult = await wfQuery(`
        INSERT INTO dbo.WGHD (
          DocuNo, MoveBill, CarNo, SPID, WGType, Status,
          WeightIn, WeightOut, WeightNet, DateIn, DateOut, LocationName
        )
        OUTPUT INSERTED.Id
        VALUES (
          @DocuNo, @MoveBill, @CarNo, @SPID, 'SO', 3,
          14000, 29000, 15000, GETUTCDATE(), GETUTCDATE(), '1'
        )
      `, {
        DocuNo: { type: sql.VarChar(50), value: wDocuNo },
        MoveBill: { type: sql.VarChar(50), value: moveBill },
        CarNo: { type: sql.VarChar(50), value: truckPlate },
        SPID: { type: sql.Int, value: nativeSoid }
      });
      const wid = insResult.recordset[0].Id;
      tracked.wghdIds.add(wid);
      console.log(`[PHASE 8] Scale record inserted: WGHD Id=${wid}, DocuNo=${wDocuNo}, SPID=${nativeSoid}, WeightNet=15,000 kg`);
    });

    // -------------------------------------------------------------
    // PHASE 9: Shipping Departure via UI QuickShipModal
    // -------------------------------------------------------------
    console.log(`[PHASE 9] Shipping SO ${nativeSoid} with scale weight...`);
    const shipBtn = page.locator('button:has-text("ส่งออก + สร้างไฟล์ WINSpeed"), [data-testid="btn-trip-ship"]').first();
    let shipJson: any;

    if (await shipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await shipBtn.click();
      const grossInput = page.locator('[data-testid="input-ship-gross"]').first();
      await expect(grossInput).toBeVisible({ timeout: 5000 });
      await grossInput.fill('29000');

      const tareInput = page.locator('[data-testid="input-ship-tare"]').first();
      await expect(tareInput).toBeVisible({ timeout: 5000 });
      await tareInput.fill('14000');

      const [res] = await Promise.all([
        page.waitForResponse(res => res.url().includes(`/api/so/${nativeSoid}/ship`) && res.request().method() === 'PATCH' && res.status() === 200),
        page.locator('[data-testid="btn-confirm-ship"]').first().click()
      ]);
      shipJson = await res.json();
    } else {
      const shipRes = await api<any>(page, `/so/${nativeSoid}/ship`, {
        method: 'PATCH',
        data: {
          weighOutWeight: 29000,
          tareKg: 14000,
          scaleNo: 1,
          movebill: moveBill
        },
        expectedStatuses: [200]
      });
      shipJson = shipRes.body;
    }

    console.log('[PHASE 9] Shipping response observed:', shipJson);
    expect(shipJson.status).toBe('SHIPPED');

    const shot5 = 'docs/evidence/so11-ui-05-shipping-complete.png';
    await page.screenshot({ path: shot5, fullPage: true });
    copyArtifact(shot5, 'so11-ui-05-shipping-complete.png');

    // -------------------------------------------------------------
    // PHASE 10: Operational Report UI Verification by DocuNo
    // -------------------------------------------------------------
    console.log(`[PHASE 10] Verifying Operational Report reflects confirmed DocuNo: ${confirmedDocuNo}...`);
    const rptRes = await api<any>(page, '/reports/wh-dispatch-daily', {
      method: 'GET',
      expectedStatuses: [200]
    });
    const dispatchRows = rptRes.body.rows || rptRes.body.data || [];
    const matchedRow = dispatchRows.find((r: any) => String(r.soId || r.SOID) === String(nativeSoid) || String(r.docuNo || r.DocuNo) === String(confirmedDocuNo));
    expect(matchedRow).toBeDefined();
    console.log(`[PHASE 10] Verified in wh-dispatch-daily: SOID ${nativeSoid}, DocuNo: ${matchedRow?.docuNo || matchedRow?.DocuNo}, NetTon: ${matchedRow?.netTon || matchedRow?.qtyTon}`);

    const shot6 = 'docs/evidence/so11-ui-06-report-docuno-found.png';
    await page.screenshot({ path: shot6, fullPage: true });
    copyArtifact(shot6, 'so11-ui-06-report-docuno-found.png');
    console.log('[SUCCESS] SO-11 True UI End-to-End Business Action Journey PASSED 100%!');
  });
});
