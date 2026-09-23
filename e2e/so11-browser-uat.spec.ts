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
const SALES_NAME = 'เกษร  ดีบรรเจิด';
const WAREHOUSE_USER = 'emp-00047';
const WAREHOUSE_NAME = 'วัชริน ';
const MANAGER_USER = 'emp-00021';
const MANAGER_NAME = 'จักรพงษ์';

// Tracked test fixtures for strict teardown & accounting
const tracked = {
  tripIds: new Set<number>(),
  draftSoIds: new Set<number>(),
  nativeSoids: new Set<number>(),
  wghdIds: new Set<number>(),
  retainedCancelledSohd: [] as Array<{ soid: number; docuNo: string; custName: string; docuStatus: string }>
};

test.describe.serial('SO-11: Deployed Hostinger TEST Browser UAT & Policy Gates', () => {
  test.setTimeout(240_000);

  const fixtureTag = `SO11_${Date.now().toString(36)}`;
  const truckPlate1 = `70-${Math.floor(1000 + Math.random() * 9000)}`;
  const truckPlate2 = `70-${Math.floor(1000 + Math.random() * 9000)}`;

  let trip1Id: number;
  let trip1Code: string;
  let so1AId: number;
  let so1BId: number;
  let nativeSoid1: number;
  let residualTripId1: number;
  let residualTripCode1: string;

  let trip2Id: number;
  let so2AId: number;
  let so2BId: number;
  let nativeSoid2A: number;
  let nativeSoid2B: number;

  test.beforeAll(async () => {
    const baseURL = process.env.E2E_BASE_URL || 'https://test.thirayu.online';
    console.log(`[SO-11 UAT] Verifying baseURL target: ${baseURL}`);
    if (!baseURL.includes('test.thirayu.online') && !baseURL.includes('localhost')) {
      throw new Error(`CRITICAL TEST SAFETY: Unexpected baseURL "${baseURL}". Must target TEST environment.`);
    }

    await runWithTarget('remote_b', async () => {
      const safety = await assertTestDatabase();
      console.log(`[SO-11 UAT PRE-TEST] Verified test database safety on ${safety.dbName} (${safety.serverName})`);
    });
  });

  test.afterAll(async () => {
    console.log('[SO-11 UAT CLEANUP] Starting scoped teardown and accounting on remote_b...');
    await runWithTarget('remote_b', async () => {
      const safety = await assertTestDatabase();
      console.log(`[SO-11 UAT CLEANUP] Confirmed test DB: ${safety.dbName}`);

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

          const sohdRow = (await wfQuery(`SELECT SOID, DocuNo, CustName, DocuStatus FROM dbo.SOHD WHERE SOID = @soidNum`, {
            soidNum: { type: sql.Int, value: soidNum }
          })).recordset?.[0];

          if (sohdRow) {
            tracked.retainedCancelledSohd.push({
              soid: Number(sohdRow.SOID),
              docuNo: String(sohdRow.DocuNo),
              custName: String(sohdRow.CustName || ''),
              docuStatus: String(sohdRow.DocuStatus)
            });
          }
        }
        console.log(`[CLEANUP] Retained ${tracked.retainedCancelledSohd.length} cancelled native SOHD headers:`, tracked.retainedCancelledSohd);
        tracked.nativeSoids.clear();
      }

      // 3. Clean draft SO records
      if (tracked.draftSoIds.size > 0) {
        for (const id of tracked.draftSoIds) {
          const idNum = Number(id);
          const idStr = String(id);
          await wfQuery(`DELETE FROM wf.SalesOrderAudit WHERE SoId = @idStr`, { idStr: { type: sql.NVarChar(50), value: idStr } });
          await wfQuery(`DELETE FROM wf.PriceApproval WHERE SoId = @idNum`, { idNum: { type: sql.Int, value: idNum } });
          await wfQuery(`DELETE FROM wf.SalesOrderLineExt WHERE SOID = @idStr`, { idStr: { type: sql.VarChar(50), value: idStr } });
          await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SoId = @idNum`, { idNum: { type: sql.Int, value: idNum } });
          await wfQuery(`DELETE FROM wf.SalesOrderExt WHERE SOID = @idStr`, { idStr: { type: sql.VarChar(50), value: idStr } });
          await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @idNum`, { idNum: { type: sql.Int, value: idNum } });
        }
        console.log(`[CLEANUP] Deleted ${tracked.draftSoIds.size} draft SO records.`);
        tracked.draftSoIds.clear();
      }

      // 4. Clean trip records (residual trips first, then parents)
      if (tracked.tripIds.size > 0) {
        for (const tid of tracked.tripIds) {
          await wfQuery(`DELETE FROM wf.SalesTrip WHERE ParentTripId = @tid`, { tid: { type: sql.Int, value: tid } });
        }
        for (const tid of tracked.tripIds) {
          await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @tid`, { tid: { type: sql.Int, value: tid } });
        }
        console.log(`[CLEANUP] Deleted ${tracked.tripIds.size} SalesTrip records.`);
        tracked.tripIds.clear();
      }
    });
  });

  // --------------------------------------------------------------------------
  // TEST 1: Health & Deployed Environment Verification
  // --------------------------------------------------------------------------
  test('1. Environment Health and Deployed UI Verification on Hostinger TEST', async ({ page, request }) => {
    const healthRes = await request.get('https://api-test.thirayu.online/api/health');
    expect(healthRes.ok()).toBeTruthy();
    const health = await healthRes.json();
    expect(health.version).toMatch(/^2\.\d+\.\d+$/);
    expect(health.db.sqlserver).toBe('up');

    await page.goto('https://test.thirayu.online/');
    await expect(page.locator('#root')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'WS-Sale-App' })).toBeVisible();

    const shotPath = 'test-results/so11-01-login-screen.png';
    await page.screenshot({ path: shotPath });
    copyArtifact(shotPath, 'so11-01-login-screen.png');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Scenario 1 — Multi-Customer Trip, Selective Confirmation & Residual Split
  // --------------------------------------------------------------------------
  test('2. Scenario 1: Multi-Customer Trip, Selective Confirmation (-R Split) & Full Dispatch', async ({ page }) => {
    // 2.1 Sales logs in via real UI
    await login(page, SALES_USER, SALES_NAME);
    await openSidebar(page, 'ขาย');
    await expect(page.getByRole('heading', { name: 'Sales Portal' })).toBeVisible();

    // 2.2 Create Trip with 30t capacity (2 distinct customer orders of 15t each)
    const tripRes = await api<any>(page, '/trips', {
      method: 'POST',
      data: {
        transRegistration: truckPlate1,
        truck: truckPlate1,
        truckCapacityTon: 30.0,
        truckTypeId: 'trailer',
        remark: `SO-11 Scenario 1 ${fixtureTag}`
      }
    });
    expect(tripRes.status).toBe(200);
    trip1Id = Number(tripRes.body.tripId || tripRes.body.id);
    trip1Code = tripRes.body.tripCode || `TRIP-${trip1Id}`;
    expect(trip1Id).toBeGreaterThan(0);
    tracked.tripIds.add(trip1Id);

    // 2.3 Create SO for Customer A (CustID 1000, 15 tons)
    const soARes = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        soPrefix: 'AI',
        custId: '1000',
        custName: 'สหกรณ์การเกษตรเมืองสระแก้ว จำกัด',
        tripId: trip1Id,
        truckPlate: truckPlate1,
        creditDays: 30,
        lines: [
          {
            goodId: '1097',
            goodCode: '7-13032100BBCAR',
            goodName: '13-3-21 เชิงผสม ตรารถเกษตร',
            qtyTon: 15.000,
            qtyBag: 300,
            pricePerTon: 15000
          }
        ]
      },
      expectedStatuses: [200, 201]
    });
    so1AId = Number(soARes.body.id);
    expect(so1AId).toBeGreaterThan(0);
    tracked.draftSoIds.add(so1AId);

    // 2.4 Create SO for Customer B (CustID 1001, 15 tons)
    const soBRes = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        soPrefix: 'AI',
        custId: '1001',
        custName: 'บริษัท ปุ๋ยไทยอินเตอร์เนชั่นแนล จำกัด',
        tripId: trip1Id,
        truckPlate: truckPlate1,
        creditDays: 30,
        lines: [
          {
            goodId: '1098',
            goodCode: '7-13032700BBCAR',
            goodName: '13-3-27 เชิงผสม ตรารถเกษตร',
            qtyTon: 15.000,
            qtyBag: 300,
            pricePerTon: 16700
          }
        ]
      },
      expectedStatuses: [200, 201]
    });
    so1BId = Number(soBRes.body.id);
    expect(so1BId).toBeGreaterThan(0);
    tracked.draftSoIds.add(so1BId);

    // 2.5 Reload and inspect multi-customer trip in UI
    await page.reload();
    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    const searchInput = page.getByPlaceholder('ค้นหา ลูกค้า / WfRef...');
    await searchInput.fill(truckPlate1);
    await page.waitForTimeout(600);

    const tripCard = page.locator('.rounded-2xl', { hasText: truckPlate1 }).first();
    await expect(tripCard).toBeVisible({ timeout: 15_000 });

    const manageBtn = tripCard.getByRole('button', { name: 'จัดการทริป' });
    await expect(manageBtn).toBeVisible();
    await manageBtn.click();

    // Verify modal shows 2 customers
    const modalHeader = page.locator('.fixed.inset-0.z-50 h2');
    await expect(modalHeader).toBeVisible();
    await expect(page.getByText(/ลูกค้า 2 ราย|2 จุดหมาย/).first()).toBeVisible();

    // Uncheck Customer B to selectively confirm Customer A
    const billCheckboxes = page.locator('input[type="checkbox"].w-4.h-4');
    expect(await billCheckboxes.count()).toBeGreaterThanOrEqual(2);
    await billCheckboxes.nth(1).uncheck();

    await expect(page.getByText('ที่เลือกยืนยัน (1 บิล):')).toBeVisible();

    // 2.6 Execute selective confirmation via API with explicit pickupDueDate
    const targetDate = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
    const confirmRes = await api<any>(page, `/trips/${trip1Id}/confirm`, {
      method: 'POST',
      data: {
        confirmedOrderIds: [so1AId],
        transRegistration: truckPlate1,
        driverName: 'สมชาย ขับดี (UAT-1)',
        pickupDueDate: targetDate,
        expectedRevision: 1
      },
      expectedStatuses: [200]
    });

    expect(confirmRes.body.confirmedOrderCount).toBe(1);
    residualTripId1 = Number(confirmRes.body.residualTripId);
    residualTripCode1 = confirmRes.body.residualTripCode;
    expect(residualTripId1).toBeGreaterThan(0);
    expect(residualTripCode1).toMatch(/-R/);
    tracked.tripIds.add(residualTripId1);

    // Resolve native SOID for confirmed order A
    await runWithTarget('remote_b', async () => {
      const ext = (await wfQuery(`SELECT SOID, TripId FROM wf.SalesOrderExt WHERE TripId = @id`, {
        id: { type: sql.Int, value: trip1Id }
      })).recordset?.[0];
      expect(ext?.SOID).toBeDefined();
      nativeSoid1 = Number(ext.SOID);
      tracked.nativeSoids.add(nativeSoid1);

      // Verify native SOHD DocuType 103
      const sohd = (await wfQuery(`SELECT SOID, DocuType, DocuNo, CustName FROM dbo.SOHD WHERE SOID = @soid`, {
        soid: { type: sql.Int, value: nativeSoid1 }
      })).recordset?.[0];
      expect(String(sohd.DocuType)).toBe('103');
      expect(sohd.DocuNo).toBeTruthy();
      console.log(`[SCENARIO 1] Confirmed Native SOHD Generated: ${sohd.DocuNo} (SOID: ${nativeSoid1})`);
    });

    // 2.7 Sales sets Load Plan (15.0 tons for confirmed native SO)
    const planRes = await api<any>(page, `/trips/${trip1Id}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: 1,
        lines: [
          {
            memberKind: 'CONFIRMED',
            memberId: String(nativeSoid1),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 15.000,
            childQty: 0.000
          }
        ]
      },
      expectedStatuses: [200]
    });
    expect(planRes.body.loadPlanStatus).toBe('SALE_CONFIRMED');

    // 2.8 Warehouse logs in and acknowledges Load Plan via UI
    await logout(page);
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);
    await openSidebar(page, 'ขาย');
    await waitForUiIdle(page);

    const whSearch = page.locator('input[placeholder*="ค้นหา"]').first();
    await whSearch.fill(truckPlate1);
    await page.waitForTimeout(600);

    const whTripCard = page.locator('.rounded-2xl', { hasText: truckPlate1 }).filter({ hasNotText: '-R' }).first();
    await expect(whTripCard).toBeVisible({ timeout: 15_000 });
    await whTripCard.getByRole('button', { name: 'จัดการทริป' }).click();

    const ackButton = page.locator('[data-testid="btn-warehouse-ack-loadplan"]');
    await expect(ackButton).toBeVisible({ timeout: 10_000 });
    await ackButton.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text=คลังรับทราบแผนแล้ว')).toBeVisible({ timeout: 10_000 });

    const shotAck = 'test-results/so11-02-warehouse-ack.png';
    await page.screenshot({ path: shotAck });
    copyArtifact(shotAck, 'so11-02-warehouse-ack.png');

    // 2.9 Warehouse marks Picking and Loading
    const pickRes = await api<any>(page, `/so/${nativeSoid1}/picking`, {
      method: 'PATCH',
      data: { isPicked: true },
      expectedStatuses: [200]
    });
    expect(pickRes.body.status).toBe('PICKING');

    const loadRes = await api<any>(page, `/so/${nativeSoid1}/load`, {
      method: 'PATCH',
      data: { isLoaded: true },
      expectedStatuses: [200]
    });
    expect(loadRes.body.status).toBe('LOADED');

    // 2.10 Simulated Weighbridge Ticket in dbo.WGHD
    await runWithTarget('remote_b', async () => {
      const insWghd = await wfQuery(`
        INSERT INTO dbo.WGHD (
          DocuNo, MoveBill, CarNo, SPID, WGType, Status, WeightIn, WeightOut, WeightNet, DateIn, DateOut, LocationName
        )
        OUTPUT inserted.Id
        VALUES (
          @docuNo, 'MB-SO11-01', @truckPlate, @soId, 'SO', 3, 14200, 29220, 15020, GETUTCDATE(), GETUTCDATE(), '1'
        )
      `, {
        docuNo: { type: sql.NVarChar(50), value: `WG-TEST-${Date.now().toString().slice(-6)}` },
        truckPlate: { type: sql.NVarChar(50), value: truckPlate1 },
        soId: { type: sql.Int, value: Number(nativeSoid1) }
      });
      const wghdId = Number(insWghd.recordset[0].Id);
      tracked.wghdIds.add(wghdId);
    });

    // 2.11 Warehouse marks Shipping Departure
    const shipRes = await api<any>(page, `/so/${nativeSoid1}/ship`, {
      method: 'PATCH',
      data: {
        weighOutWeight: 29220,
        tareKg: 14200,
        scaleNo: 1,
        movebill: 'MB-SO11-01'
      },
      expectedStatuses: [200]
    });
    expect(shipRes.body.status).toBe('SHIPPED');

    // 2.12 Verify Operational Report (wh-dispatch-daily) reflects confirmed DocuNo
    const rptRes = await api<any>(page, '/reports/wh-dispatch-daily', {
      method: 'GET',
      expectedStatuses: [200]
    });
    const dispatchRows = rptRes.body.rows || rptRes.body.data || [];
    const matchedRow = dispatchRows.find((r: any) => String(r.soId || r.SOID) === String(nativeSoid1));
    expect(matchedRow).toBeDefined();
    console.log(`[SCENARIO 1] Verified in wh-dispatch-daily: SOID ${nativeSoid1}, DocuNo: ${matchedRow?.docuNo || matchedRow?.DocuNo}, NetTon: ${matchedRow?.netTon || matchedRow?.qtyTon}`);

    const shotShip = 'test-results/so11-03-dispatched-report.png';
    await page.screenshot({ path: shotShip });
    copyArtifact(shotShip, 'so11-03-dispatched-report.png');
  });

  // --------------------------------------------------------------------------
  // TEST 3: Scenario 2 — Multi-Customer Trip Carrying Both to Confirmation & Departure
  // --------------------------------------------------------------------------
  test('3. Scenario 2: Multi-Customer Trip Carrying Both Customers to Departure', async ({ page }) => {
    // 3.1 Sales creates a trip with 2 customers (10t each, 20t total)
    await login(page, SALES_USER, SALES_NAME);

    const tripRes = await api<any>(page, '/trips', {
      method: 'POST',
      data: {
        transRegistration: truckPlate2,
        truck: truckPlate2,
        truckCapacityTon: 30.0,
        truckTypeId: 'trailer',
        remark: `SO-11 Scenario 2 ${fixtureTag}`
      }
    });
    expect(tripRes.status).toBe(200);
    trip2Id = Number(tripRes.body.tripId || tripRes.body.id);
    tracked.tripIds.add(trip2Id);

    // Order 1 (CustID 1000, 10 tons)
    const so1Res = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        soPrefix: 'AI',
        custId: '1000',
        custName: 'สหกรณ์การเกษตรเมืองสระแก้ว จำกัด',
        tripId: trip2Id,
        truckPlate: truckPlate2,
        creditDays: 30,
        lines: [
          {
            goodId: '1097',
            goodCode: '7-13032100BBCAR',
            goodName: '13-3-21 เชิงผสม ตรารถเกษตร',
            qtyTon: 10.000,
            qtyBag: 200,
            pricePerTon: 15000
          }
        ]
      }
    });
    so2AId = Number(so1Res.body.id);
    tracked.draftSoIds.add(so2AId);

    // Order 2 (CustID 1001, 10 tons)
    const so2Res = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        soPrefix: 'AI',
        custId: '1001',
        custName: 'บริษัท ปุ๋ยไทยอินเตอร์เนชั่นแนล จำกัด',
        tripId: trip2Id,
        truckPlate: truckPlate2,
        creditDays: 30,
        lines: [
          {
            goodId: '1098',
            goodCode: '7-13032700BBCAR',
            goodName: '13-3-27 เชิงผสม ตรารถเกษตร',
            qtyTon: 10.000,
            qtyBag: 200,
            pricePerTon: 16700
          }
        ]
      }
    });
    so2BId = Number(so2Res.body.id);
    tracked.draftSoIds.add(so2BId);

    // 3.2 Confirm BOTH orders in the same trip
    const targetDate = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
    const confirmRes = await api<any>(page, `/trips/${trip2Id}/confirm`, {
      method: 'POST',
      data: {
        confirmedOrderIds: [so2AId, so2BId],
        transRegistration: truckPlate2,
        driverName: 'สมชาย ขับดี (UAT-2)',
        pickupDueDate: targetDate,
        expectedRevision: 1
      },
      expectedStatuses: [200]
    });

    expect(confirmRes.body.confirmedOrderCount).toBe(2);
    expect(confirmRes.body.residualTripId).toBeNull(); // No residual split when all confirmed

    // Resolve native SOIDs for both orders
    await runWithTarget('remote_b', async () => {
      const exts = (await wfQuery(`SELECT SOID, TripId FROM wf.SalesOrderExt WHERE TripId = @id ORDER BY SOID ASC`, {
        id: { type: sql.Int, value: trip2Id }
      })).recordset;
      expect(exts.length).toBe(2);
      nativeSoid2A = Number(exts[0].SOID);
      nativeSoid2B = Number(exts[1].SOID);
      tracked.nativeSoids.add(nativeSoid2A);
      tracked.nativeSoids.add(nativeSoid2B);

      const sohdA = (await wfQuery(`SELECT DocuNo FROM dbo.SOHD WHERE SOID = @soid`, { soid: { type: sql.Int, value: nativeSoid2A } })).recordset?.[0];
      const sohdB = (await wfQuery(`SELECT DocuNo FROM dbo.SOHD WHERE SOID = @soid`, { soid: { type: sql.Int, value: nativeSoid2B } })).recordset?.[0];
      console.log(`[SCENARIO 2] Both Confirmed Native SOHDs Generated: Order A ${sohdA?.DocuNo}, Order B ${sohdB?.DocuNo}`);
    });

    // 3.3 Set Load Plan allocating sequence 1 and 2
    const planRes = await api<any>(page, `/trips/${trip2Id}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: 1,
        lines: [
          {
            memberKind: 'CONFIRMED',
            memberId: String(nativeSoid2A),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 10.000,
            childQty: 0.000
          },
          {
            memberKind: 'CONFIRMED',
            memberId: String(nativeSoid2B),
            lineNum: 1,
            loadSequence: 2,
            masterQty: 10.000,
            childQty: 0.000
          }
        ]
      },
      expectedStatuses: [200]
    });
    expect(planRes.body.loadPlanStatus).toBe('SALE_CONFIRMED');

    // 3.4 Warehouse acknowledges and advances both
    await logout(page);
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);

    await api<any>(page, `/trips/${trip2Id}/load-plan/ack`, {
      method: 'POST',
      data: { expectedPlanRevision: planRes.body.loadPlanRevision || 2 },
      expectedStatuses: [200]
    });

    for (const sid of [nativeSoid2A, nativeSoid2B]) {
      await api<any>(page, `/so/${sid}/picking`, { method: 'PATCH', data: { isPicked: true }, expectedStatuses: [200] });
      await api<any>(page, `/so/${sid}/load`, { method: 'PATCH', data: { isLoaded: true }, expectedStatuses: [200] });
    }

    // Insert simulated weighbridge scale records for both orders
    await runWithTarget('remote_b', async () => {
      for (const sid of [nativeSoid2A, nativeSoid2B]) {
        const insWghd = await wfQuery(`
          INSERT INTO dbo.WGHD (
            DocuNo, MoveBill, CarNo, SPID, WGType, Status, WeightIn, WeightOut, WeightNet, DateIn, DateOut, LocationName
          )
          OUTPUT inserted.Id
          VALUES (
            @docuNo, 'MB-SO11-02', @truckPlate, @soId, 'SO', 3, 14200, 34200, 20000, GETUTCDATE(), GETUTCDATE(), '1'
          )
        `, {
          docuNo: { type: sql.NVarChar(50), value: `WG-TEST-${sid}-${Date.now().toString().slice(-4)}` },
          truckPlate: { type: sql.NVarChar(50), value: truckPlate2 },
          soId: { type: sql.Int, value: Number(sid) }
        });
        tracked.wghdIds.add(Number(insWghd.recordset[0].Id));
      }
    });

    // Ship both orders
    for (const sid of [nativeSoid2A, nativeSoid2B]) {
      const sRes = await api<any>(page, `/so/${sid}/ship`, {
        method: 'PATCH',
        data: { weighOutWeight: 34200, tareKg: 14200, scaleNo: 1, movebill: 'MB-SO11-02' },
        expectedStatuses: [200]
      });
      expect(sRes.body.status).toBe('SHIPPED');
    }

    const shotMulti = 'test-results/so11-04-multi-customer-shipped.png';
    await page.screenshot({ path: shotMulti });
    copyArtifact(shotMulti, 'so11-04-multi-customer-shipped.png');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Scenario 3 — Policy Gates, Rejections & Edge Cases
  // --------------------------------------------------------------------------
  test('4. Scenario 3: Below-Announced Price Approval, Role Permissions, Stale Revision & Idempotent Retry', async ({ page }) => {
    // 4.1 Gate A: Below-announced price generates pending approval & blocks non-manager
    await login(page, SALES_USER, SALES_NAME);

    const priceTruckPlate = `70-${Math.floor(1000 + Math.random() * 9000)}`;
    const priceTripRes = await api<any>(page, '/trips', {
      method: 'POST',
      data: {
        transRegistration: priceTruckPlate,
        truck: priceTruckPlate,
        truckCapacityTon: 15.0,
        remark: `SO-11 Price Gate ${fixtureTag}`
      }
    });
    const priceTripId = Number(priceTripRes.body.tripId || priceTripRes.body.id);
    tracked.tripIds.add(priceTripId);

    // Sales creates an SO with price 500 THB/ton (far below announced price 16,000 THB/ton)
    const priceSoRes = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        soPrefix: 'AI',
        custId: '1000',
        custName: 'สหกรณ์การเกษตรเมืองสระแก้ว จำกัด',
        tripId: priceTripId,
        truckPlate: priceTruckPlate,
        creditDays: 30,
        lines: [
          {
            goodId: '1002',
            goodCode: '1-0000600100CAR',
            goodName: 'กระสอบ 0-0-60 ผง รถเกษตร',
            qtyTon: 10.000,
            qtyBag: 200,
            pricePerTon: 500.00 // Below-announced price!
          }
        ]
      }
    });
    const priceSoId = Number(priceSoRes.body.id);
    expect(priceSoId).toBeGreaterThan(0);
    tracked.draftSoIds.add(priceSoId);
    expect(priceSoRes.body.needsApproval).toBe(true);

    // Verify wf.PriceApproval record was created in PENDING_APPROVAL
    let approvalId: number;
    await runWithTarget('remote_b', async () => {
      const appr = (await wfQuery(`SELECT Id, Status FROM wf.PriceApproval WHERE SoId = @soid`, {
        soid: { type: sql.Int, value: priceSoId }
      })).recordset?.[0];
      expect(appr).toBeDefined();
      expect(appr.Status).toBe('PENDING');
      approvalId = Number(appr.Id);
    });

    // Non-manager (Sales) attempts to approve price -> must be rejected with 403 Forbidden
    await api<any>(page, `/edit-requests/price-approvals/${approvalId!}/approve`, {
      method: 'PATCH',
      data: { note: 'Sales self-approval should fail' },
      expectedStatuses: [403]
    });

    // Manager (emp-00021) logs into real UI and approves price in 'คำขอแก้ไข'
    await logout(page);
    await login(page, MANAGER_USER, MANAGER_NAME);
    await openSidebar(page, 'คำขอแก้ไข');
    await expect(page.getByRole('heading', { name: 'คำขอแก้ไขหลังยืนยัน / Hold รถ' })).toBeVisible();

    const priceTabBtn = page.getByRole('button', { name: 'ขออนุมัติราคาต่ำกว่าประกาศ' });
    await expect(priceTabBtn).toBeVisible();
    await priceTabBtn.click();
    await waitForUiIdle(page);

    // Approve price via manager API
    const mgrApproveRes = await api<any>(page, `/edit-requests/price-approvals/${approvalId!}/approve`, {
      method: 'PATCH',
      data: { note: 'UAT Approved by Regional Manager' },
      expectedStatuses: [200]
    });
    expect(mgrApproveRes.body.status).toBe('APPROVED');

    const shotApproval = 'test-results/so11-05-manager-price-approved.png';
    await page.screenshot({ path: shotApproval });
    copyArtifact(shotApproval, 'so11-05-manager-price-approved.png');

    // 4.2 Gate B: Pickup Lead Time / Due Date ("วันรับห้ามเดา") Validation
    await logout(page);
    await login(page, SALES_USER, SALES_NAME);

    // Missing pickupDueDate -> 400 Bad Request
    const noDateRes = await api<any>(page, `/trips/${priceTripId}/confirm`, {
      method: 'POST',
      data: {
        confirmedOrderIds: [priceSoId],
        transRegistration: priceTruckPlate,
        pickupDueDate: null, // Prohibited!
        expectedRevision: 1
      },
      expectedStatuses: [400]
    });
    expect(noDateRes.body.message).toContain('pickupDueDate');

    // 4.3 Gate C: Stale Revision OCC Conflict (409)
    const staleRes = await api<any>(page, `/trips/${priceTripId}/confirm`, {
      method: 'POST',
      data: {
        confirmedOrderIds: [priceSoId],
        transRegistration: priceTruckPlate,
        pickupDueDate: '2026-09-20',
        expectedRevision: 999 // Stale revision!
      },
      expectedStatuses: [409]
    });
    expect(staleRes.body.message).toMatch(/ถูกแก้ไขโดยผู้อื่น|Conflict/);

    // 4.4 Gate D: Duplicate Shipment Retry (Idempotency)
    // Retry shipping nativeSoid1 (already SHIPPED in Scenario 1)
    await logout(page);
    await login(page, WAREHOUSE_USER, WAREHOUSE_NAME);

    const retryShipRes = await api<any>(page, `/so/${nativeSoid1}/ship`, {
      method: 'PATCH',
      data: {
        weighOutWeight: 29220,
        tareKg: 14200,
        scaleNo: 1,
        movebill: 'MB-SO11-01'
      },
      expectedStatuses: [200]
    });
    expect(retryShipRes.body.status).toBe('SHIPPED');
    expect(retryShipRes.body.idempotent).toBe(true);
    expect(retryShipRes.body.message).toContain('Idempotent Retry');

    const shotIdempotent = 'test-results/so11-06-idempotent-ship.png';
    await page.screenshot({ path: shotIdempotent });
    copyArtifact(shotIdempotent, 'so11-06-idempotent-ship.png');
  });
});
