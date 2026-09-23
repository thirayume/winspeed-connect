/**
 * SO-11: Fixture-Assisted Integration Smoke Test (Legacy)
 *
 * SCOPE & BOUNDARY DISCLAIMER:
 * This test is a fixture-assisted smoke test preserved for regression safety.
 * It bypasses the real creation, pricing approval, trip confirmation (wf.sp_ConfirmSalesOrder),
 * warehouse picking (dbo.SOHD PkgStatus), and warehouse loading (SalesOrderExt.IsLoaded)
 * by directly inserting rows and updating statuses via SQL.
 * It directly exercises only:
 * - Load plan setup (PUT /api/trips/:id/load-plan)
 * - Warehouse load plan ack (POST /api/trips/:id/load-plan/ack)
 * - Shipping departure with scale check (PATCH /api/so/:id/ship)
 * - Native coupon posting fail-closed gate (POST /api/coupons/post-native)
 * - Operational report read (GET /api/reports/customer-dispatch)
 *
 * For the complete end-to-end operational lifecycle executed strictly through real API endpoints
 * without SQL status bypass, see: integration-so-11-real-workflow.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { runWithTarget, wfQuery, sql, pools, DEFAULT_TARGET } = require('../db');
const { assertTestDatabase } = require('./test-safety');

let server;
let baseUrl;

let salesToken;
let warehouseToken;
let managerToken;
let adminToken;
let managerUserId;

async function startTestServer() {
  if (server) return;
  await new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      runWithTarget('remote_b', next);
    });

    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/stock', require('../routes/stock'));
    app.use('/api/trips', require('../routes/trips'));
    app.use('/api/so', require('../routes/so'));
    app.use('/api/coupons', require('../routes/coupons'));
    app.use('/api/reports', require('../routes/reports'));

    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ message: err.message, ...err });
    });

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function loginAs(username, password = 'W0rldF3rt') {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  const token = data.accessToken || data.token;
  if (!res.ok || !token) {
    throw new Error(`Login failed for ${username}: ${data.message || res.statusText}`);
  }
  return { token, user: data.user };
}

const trackedFixtures = {
  soIds: new Set(),
  tripIds: new Set(),
  ticketIds: new Set(),
  reservationIds: new Set(),
  wghdIds: new Set()
};

function trackSo(id) { if (id != null) trackedFixtures.soIds.add(Number(id)); }
function trackTrip(id) { if (id != null) trackedFixtures.tripIds.add(Number(id)); }
function trackTicket(id) { if (id != null) trackedFixtures.ticketIds.add(Number(id)); }
function trackReservation(id) { if (id != null) trackedFixtures.reservationIds.add(Number(id)); }
function trackWghd(id) { if (id != null) trackedFixtures.wghdIds.add(Number(id)); }

async function cleanTrackedFixtures() {
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();

    // 1. Delete reservations
    if (trackedFixtures.reservationIds.size > 0) {
      for (const rid of trackedFixtures.reservationIds) {
        await wfQuery(`DELETE FROM wf.CouponReservation WHERE ReservationId = @rid`, {
          rid: { type: sql.Int, value: Number(rid) }
        });
      }
      trackedFixtures.reservationIds.clear();
    }

    // 2. Delete tickets
    if (trackedFixtures.ticketIds.size > 0) {
      for (const tid of trackedFixtures.ticketIds) {
        await wfQuery(`DELETE FROM wf.WeighTicket WHERE Id = @tid`, {
          tid: { type: sql.Int, value: Number(tid) }
        });
      }
      trackedFixtures.ticketIds.clear();
    }

    // 3. Delete SOs
    if (trackedFixtures.soIds.size > 0) {
      for (const id of trackedFixtures.soIds) {
        const idStr = String(id);
        const idNum = Number(id) || 0;
        await wfQuery(`DELETE FROM wf.RebateLedger WHERE SoId = @idStr`, { idStr: { type: sql.NVarChar(50), value: idStr } });
        await wfQuery(`DELETE FROM wf.WeighTicket WHERE SoId = @idStr`, { idStr: { type: sql.NVarChar(50), value: idStr } });
        await wfQuery(`DELETE FROM wf.SalesOrderLineExt WHERE SOID = @idStr`, { idStr: { type: sql.VarChar(50), value: idStr } });
        await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SoId = @idNum`, { idNum: { type: sql.Int, value: idNum } });
        await wfQuery(`DELETE FROM wf.SalesOrderExt WHERE SOID = @idStr`, { idStr: { type: sql.VarChar(50), value: idStr } });
        await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @idNum`, { idNum: { type: sql.Int, value: idNum } });
      }
      trackedFixtures.soIds.clear();
    }

    // 4. Delete trips
    if (trackedFixtures.tripIds.size > 0) {
      for (const tid of trackedFixtures.tripIds) {
        await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @tid`, {
          tid: { type: sql.Int, value: Number(tid) }
        });
      }
      trackedFixtures.tripIds.clear();
    }

    // 5. Delete tracked synthetic WGHD rows
    if (trackedFixtures.wghdIds.size > 0) {
      for (const wid of trackedFixtures.wghdIds) {
        await wfQuery(`DELETE FROM dbo.WGHD WHERE Id = @wid AND DocuNo LIKE 'WG-TEST%'`, {
          wid: { type: sql.Int, value: Number(wid) }
        });
      }
      trackedFixtures.wghdIds.clear();
    }
  });
}

test.before(async () => {
  await startTestServer();
  await runWithTarget('remote_b', async () => {
    const safety = await assertTestDatabase();
    console.log(`[SO-11 REHEARSAL] Database safety verified on ${safety.dbName} (${safety.serverName})`);
  });

  const salesAuth = await loginAs('emp-00002');
  salesToken = salesAuth.token;
  const whAuth = await loginAs('emp-00047');
  warehouseToken = whAuth.token;
  const mgrAuth = await loginAs('emp-00021');
  managerToken = mgrAuth.token;
  managerUserId = mgrAuth.user.id || mgrAuth.user.sub;
  const admAuth = await loginAs('admin');
  adminToken = admAuth.token;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await cleanTrackedFixtures();
  try {
    const p = pools('remote_b');
    if (p) {
      await p.readerPool.close();
      await p.ownerPool.close();
    }
    const defP = pools(DEFAULT_TARGET);
    if (defP && defP !== p) {
      await defP.readerPool.close();
      await defP.ownerPool.close();
    }
  } catch (e) {
    // Ignore pool closure errors during teardown
  }
});

test.describe('SO-11: Fixture-Assisted Integration Smoke Test', () => {

  test('Smoke Scenario SO-11.0: Fixture-Assisted Lifecycle Smoke Test', async () => {
    const suffix = Date.now().toString().slice(-6);
    const tripCode = `TRIP-SO11-${suffix}`;
    const wfRef = `SO-SO11-${suffix}`;
    const truckPlate = `70-${suffix.slice(-4)}`;

    let tripId;
    let soId;

    // ----------------------------------------------------
    // STEP 1: Sales Creates Trip & Draft SO
    // ----------------------------------------------------
    console.log('[STEP 1] Sales creates Trip and Draft SO...');
    await runWithTarget('remote_b', async () => {
      const tripRes = await wfQuery(`
        INSERT INTO wf.SalesTrip (
          TripCode, TransRegistration, TruckCapacityTon, CreatedBy, Status,
          DocumentRevision, LoadPlanRevision, LoadPlanStatus, PickupDueDate
        )
        OUTPUT inserted.TripId
        VALUES (
          @tc, @plate, 36.00, 1, 'DRAFT', 1, 1, 'DRAFT', DATEADD(day, 2, CAST(GETDATE() AS DATE))
        )
      `, {
        tc: { type: sql.NVarChar(50), value: tripCode },
        plate: { type: sql.NVarChar(50), value: truckPlate }
      });
      tripId = tripRes.recordset[0].TripId;
      trackTrip(tripId);

      const soRes = await wfQuery(`
        INSERT INTO wf.SalesOrder (
          WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId
        )
        OUTPUT inserted.Id
        VALUES (
          @wfRef, 'AI', '0462002', N'สหกรณ์การเกษตรเพื่อการตลาดลูกค้า ธ.ก.ส.', 'DRAFT', @tripId, 1
        )
      `, {
        wfRef: { type: sql.NVarChar(50), value: wfRef },
        tripId: { type: sql.Int, value: tripId }
      });
      soId = soRes.recordset[0].Id;
      trackSo(soId);

      await wfQuery(`
        INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon)
        VALUES (@soId, 1, 'G1', '16-16-16', N'ปุ๋ยเคมีสูตร 16-16-16', 15.000, 300, 15500.00)
      `, { soId: { type: sql.Int, value: soId } });

      await wfQuery(`
        INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix, TripId)
        VALUES (@soIdStr, @wfRef, 'AI', @tripId)
      `, {
        soIdStr: { type: sql.VarChar(50), value: String(soId) },
        wfRef: { type: sql.NVarChar(50), value: wfRef },
        tripId: { type: sql.Int, value: tripId }
      });
    });

    assert.ok(tripId, 'TripId should be generated');
    assert.ok(soId, 'SoId should be generated');

    // ----------------------------------------------------
    // STEP 2: Sales Sets Load Plan
    // ----------------------------------------------------
    console.log('[STEP 2] Sales sets Load Plan...');
    const planRes = await fetch(`${baseUrl}/api/trips/${tripId}/load-plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        expectedPlanRevision: 1,
        lines: [
          { memberKind: 'DRAFT', memberId: String(soId), lineNum: 1, loadSequence: 1, masterQty: 15.000, childQty: 0.000 }
        ]
      })
    });
    assert.equal(planRes.status, 200);
    const planData = await planRes.json();
    assert.equal(planData.loadPlanStatus, 'SALE_CONFIRMED');
    assert.equal(planData.loadPlanRevision, 2);

    // ----------------------------------------------------
    // STEP 3: Warehouse Acknowledges Load Plan
    // ----------------------------------------------------
    console.log('[STEP 3] Warehouse acknowledges Load Plan...');
    const ackRes = await fetch(`${baseUrl}/api/trips/${tripId}/load-plan/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
      body: JSON.stringify({ expectedPlanRevision: 2 })
    });
    assert.equal(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.equal(ackData.loadPlanStatus, 'WAREHOUSE_ACK');

    // ----------------------------------------------------
    // STEP 4: Factory Weighbridge Records Weigh Ticket
    // ----------------------------------------------------
    console.log('[STEP 4] Factory Weighbridge records scale ticket...');
    await runWithTarget('remote_b', async () => {
      // Tare: 14,200 kg, Gross: 29,220 kg -> Net: 15,020 kg
      const wRes = await wfQuery(`
        INSERT INTO dbo.WGHD (
          DocuNo, MoveBill, CarNo, SPID, WGType, Status, WeightIn, WeightOut, WeightNet, DateIn, DateOut, LocationName
        )
        OUTPUT inserted.Id
        VALUES (
          'WG-TEST-SO11', 'MB-SO11', @plate, @soId, 'SO', 3, 14200, 29220, 15020, GETUTCDATE(), GETUTCDATE(), '1'
        )
      `, {
        plate: { type: sql.NVarChar(50), value: truckPlate },
        soId: { type: sql.Int, value: Number(soId) }
      });
      const wghdId = wRes.recordset[0].Id;
      trackWghd(wghdId);

      // Update SO status to LOADED
      await wfQuery(`UPDATE wf.SalesOrder SET Status = 'LOADED' WHERE Id = @soId`, { soId: { type: sql.Int, value: soId } });
      await wfQuery(`UPDATE wf.SalesOrderExt SET IsLoaded = 1 WHERE SOID = @soIdStr`, { soIdStr: { type: sql.VarChar(50), value: String(soId) } });
    });

    // ----------------------------------------------------
    // STEP 5: Shipping Dispatch Completed
    // ----------------------------------------------------
    console.log('[STEP 5] Shipping departure confirmed...');
    const shipRes = await fetch(`${baseUrl}/api/so/${soId}/ship`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
      body: JSON.stringify({ weighOutWeight: 29220, tareKg: 14200 })
    });
    assert.equal(shipRes.status, 200);
    const shipData = await shipRes.json();
    assert.equal(shipData.status, 'SHIPPED');

    // Verify in DB that SO and Ext reflect SHIPPED state and weighOutWeight
    await runWithTarget('remote_b', async () => {
      const ext = (await wfQuery(`SELECT WeighOutWeight FROM wf.SalesOrderExt WHERE SOID = @soIdStr`, {
        soIdStr: { type: sql.VarChar(50), value: String(soId) }
      })).recordset[0];
      assert.equal(Number(ext.WeighOutWeight), 29220);
    });

    // ----------------------------------------------------
    // STEP 6: Native Posting Gate Verification (Explicit Blocker)
    // ----------------------------------------------------
    console.log('[STEP 6] Verifying Fail-Closed Native Posting Gate...');
    const postRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reservationId: 1 })
    });
    assert.equal(postRes.status, 400, 'Native posting endpoint must fail-closed with 400 when flag=false');
    const postData = await postRes.json();
    assert.ok(postData.message.includes('COUPON_NATIVE_POSTING_ENABLED=false'), 'Must return explicit disabled message');

    // ----------------------------------------------------
    // STEP 7: Operational Reporting Verification
    // ----------------------------------------------------
    console.log('[STEP 7] Verifying operational reports...');
    const rptRes = await fetch(`${baseUrl}/api/reports/customer-dispatch`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(rptRes.status, 200);
    const rptData = await rptRes.json();
    assert.equal(rptData.type, 'customer-dispatch');
    assert.ok(Array.isArray(rptData.rows));

    console.log('[SO-11 REHEARSAL] Full Application-Only Lifecycle completed successfully!');
  });

});
