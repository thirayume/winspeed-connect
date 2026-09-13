'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { runWithTarget, query, wfQuery, pools, sql } = require('../db');
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
  stockKeys: new Set(),
  wghdIds: new Set(),
  ticketIds: new Set()
};

function trackSo(id) { if (id != null) trackedFixtures.soIds.add(Number(id)); }
function trackTrip(id) { if (id != null) trackedFixtures.tripIds.add(Number(id)); }
function trackStock(goodId, warehouseId) { if (goodId && warehouseId) trackedFixtures.stockKeys.add(`${goodId}|${warehouseId}`); }
function trackWghd(id) { if (id != null) trackedFixtures.wghdIds.add(Number(id)); }
function trackTicket(id) { if (id != null) trackedFixtures.ticketIds.add(Number(id)); }

async function cleanTrackedFixtures() {
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();

    // 1. Delete child tables by exact tracked SO IDs FIRST (prevent orphan rows)
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

    // 2. Delete separately tracked tickets
    if (trackedFixtures.ticketIds.size > 0) {
      for (const tid of trackedFixtures.ticketIds) {
        await wfQuery(`DELETE FROM wf.WeighTicket WHERE Id = @tid`, { tid: { type: sql.Int, value: Number(tid) } });
      }
      trackedFixtures.ticketIds.clear();
    }

    // 3. Delete tracked trips
    if (trackedFixtures.tripIds.size > 0) {
      for (const tid of trackedFixtures.tripIds) {
        await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @tid`, { tid: { type: sql.Int, value: Number(tid) } });
      }
      trackedFixtures.tripIds.clear();
    }

    // 4. Delete tracked operational stock rows by composite key only
    if (trackedFixtures.stockKeys.size > 0) {
      for (const key of trackedFixtures.stockKeys) {
        const [goodId, warehouseId] = key.split('|');
        await wfQuery(
          `DELETE FROM wf.OperationalStock WHERE GoodId = @goodId AND WarehouseId = @warehouseId`,
          {
            goodId: { type: sql.NVarChar(50), value: goodId },
            warehouseId: { type: sql.NVarChar(50), value: warehouseId }
          }
        );
      }
      trackedFixtures.stockKeys.clear();
    }

    // 5. Delete tracked synthetic WGHD rows by exact ID only (never touching native data)
    if (trackedFixtures.wghdIds.size > 0) {
      for (const wid of trackedFixtures.wghdIds) {
        await wfQuery(`DELETE FROM dbo.WGHD WHERE Id = @wid AND (DocuNo LIKE 'WG-TEST%' OR CarNo LIKE 'TEST-WG%')`, {
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
    await assertTestDatabase();
  });

  // Authenticate exclusively through real test accounts via POST /api/auth/login
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
  setTimeout(() => process.exit(0), 500).unref();
});

// ─────────────────────────────────────────────────────────────
// GROUP 1: SO-06 Available-To-Promise (ATP)
// ─────────────────────────────────────────────────────────────

test('ATP 1.1: Separate warehouses does not cross-deduct reservations across warehouses', async () => {
  const goodCode = 'TEST-SO06-MULTIWH';
  const now = new Date();

  await runWithTarget('remote_b', async () => {
    await wfQuery(`
      INSERT INTO wf.OperationalStock (GoodId, WarehouseId, GoodName, QtyOnHand, Unit, Source, AsOf, UpdatedBy)
      VALUES 
        (@gc, 'WH-NORTH', N'ปุ๋ยทดสอบสูตร 1', 50.00, N'ตัน', 'FEED', @asOf, 1),
        (@gc, 'WH-SOUTH', N'ปุ๋ยทดสอบสูตร 1', 30.00, N'ตัน', 'FEED', @asOf, 1)
    `, {
      gc: { type: sql.NVarChar(50), value: goodCode },
      asOf: { type: sql.DateTime2, value: now }
    });
    trackStock(goodCode, 'WH-NORTH');
    trackStock(goodCode, 'WH-SOUTH');
  });

  const res = await fetch(`${baseUrl}/api/stock/atp?goodCode=${goodCode}`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.data?.find(r => r.goodCode === goodCode);

  assert.ok(row, 'Row should be found');
  assert.equal(row.totalOnHand, 80);
  assert.equal(row.warehouses.length, 2);
  const whNorth = row.warehouses.find(w => w.warehouseId === 'WH-NORTH');
  const whSouth = row.warehouses.find(w => w.warehouseId === 'WH-SOUTH');
  assert.equal(whNorth.qtyOnHand, 50);
  assert.equal(whSouth.qtyOnHand, 30);
  assert.equal(row.totalAvailable, 80);
  assert.equal(row.state, 'FULLY_READY');
  assert.equal(row.freshness, 'FRESH');
});

test('ATP 1.2: Stale stock (> policy days) returns state UNKNOWN with explanatory reason', async () => {
  const goodCode = 'TEST-SO06-STALE';
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

  await runWithTarget('remote_b', async () => {
    await wfQuery(`
      INSERT INTO wf.OperationalStock (GoodId, WarehouseId, GoodName, QtyOnHand, Unit, Source, AsOf, UpdatedBy)
      VALUES (@gc, 'WH-MAIN', N'ปุ๋ยสต๊อกเก่า', 40.00, N'ตัน', 'FEED', @asOf, 1)
    `, {
      gc: { type: sql.NVarChar(50), value: goodCode },
      asOf: { type: sql.DateTime2, value: eightDaysAgo }
    });
    trackStock(goodCode, 'WH-MAIN');
  });

  const res = await fetch(`${baseUrl}/api/stock/atp?goodCode=${goodCode}`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.data?.find(r => r.goodCode === goodCode);

  assert.ok(row);
  assert.equal(row.isStale, true);
  assert.equal(row.freshness, 'STALE');
  assert.equal(row.state, 'UNKNOWN');
  assert.ok(row.stateReason?.includes('ไม่อัปเดต'));
});

test('ATP 1.3: Future or invalid AsOf returns state UNKNOWN and freshness UNKNOWN', async () => {
  const goodCode = 'TEST-SO06-NOASOF';
  const futureAsOf = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await runWithTarget('remote_b', async () => {
    await wfQuery(`
      INSERT INTO wf.OperationalStock (GoodId, WarehouseId, GoodName, QtyOnHand, Unit, Source, AsOf, UpdatedBy)
      VALUES (@gc, 'WH-MAIN', N'ปุ๋ยไม่ระบุ AsOf', 15.00, N'ตัน', 'FEED', @asOf, 1)
    `, {
      gc: { type: sql.NVarChar(50), value: goodCode },
      asOf: { type: sql.DateTime2, value: futureAsOf }
    });
    trackStock(goodCode, 'WH-MAIN');
  });

  const res = await fetch(`${baseUrl}/api/stock/atp?goodCode=${goodCode}`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.data?.find(r => r.goodCode === goodCode);

  assert.ok(row);
  assert.equal(row.freshness, 'UNKNOWN');
  assert.equal(row.state, 'UNKNOWN');
  assert.ok(row.stateReason?.includes('AsOf'));
});

test('ATP 1.4: Invalid or missing unit returns state UNKNOWN', async () => {
  const goodCode = 'TEST-SO06-BADUNIT';

  await runWithTarget('remote_b', async () => {
    await wfQuery(`
      INSERT INTO wf.OperationalStock (GoodId, WarehouseId, GoodName, QtyOnHand, Unit, Source, AsOf, UpdatedBy)
      VALUES (@gc, 'WH-MAIN', N'ปุ๋ยหน่วยผิด', 10.00, N'ชิ้น', 'FEED', GETUTCDATE(), 1)
    `, { gc: { type: sql.NVarChar(50), value: goodCode } });
    trackStock(goodCode, 'WH-MAIN');
  });

  const res = await fetch(`${baseUrl}/api/stock/atp?goodCode=${goodCode}`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.data?.find(r => r.goodCode === goodCode);

  assert.ok(row);
  assert.equal(row.state, 'UNKNOWN');
  assert.ok(row.stateReason?.includes('หน่วยสินค้าไม่ชัดเจน'));
});

test('ATP 1.5: Historic open SO older than 60 days without Ext is preserved in demand (no arbitrary cutoff)', async () => {
  const goodCode = '9-1620000000CAR';
  const testWh = 'WH-TEST-HIST';

  await runWithTarget('remote_b', async () => {
    await wfQuery(`
      INSERT INTO wf.OperationalStock (GoodId, WarehouseId, GoodName, QtyOnHand, Unit, Source, AsOf, UpdatedBy)
      VALUES (@gc, @wh, N'ปุ๋ยทดสอบประวัติศาสตร์', 100.00, N'ตัน', 'FEED', GETUTCDATE(), 1)
    `, { 
      gc: { type: sql.NVarChar(50), value: goodCode },
      wh: { type: sql.NVarChar(50), value: testWh }
    });
    trackStock(goodCode, testWh);
  });

  const res = await fetch(`${baseUrl}/api/stock/atp?goodCode=${goodCode}`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.data?.find(r => r.goodCode === goodCode);

  assert.ok(row);
  assert.equal(row.totalOnHand, 100);
  // Demand from 2019 (> 60 days ago) must be preserved and NOT dropped (actual historic unfulfilled demand is 8.00 tons)
  assert.ok(row.confirmedReserved >= 8, `Confirmed reserved demand must include historic open orders (got ${row.confirmedReserved})`);
});

// ─────────────────────────────────────────────────────────────
// GROUP 2: Vehicle Capacity & Physical Limits (SO-06)
// ─────────────────────────────────────────────────────────────

test('Capacity 2.1: Authoritative master resolves 18+18 = 36t for trailer payload', async () => {
  let testTripId;
  await runWithTarget('remote_b', async () => {
    const res = await wfQuery(`
      INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, TruckTypeId, CreatedBy, Status, DocumentRevision)
      OUTPUT inserted.TripId
      VALUES ('TRIP-TEST-SO07-CAP1', N'70-9999 (พ่วง)', 50.00, 'trailer', 1, 'DRAFT', 1)
    `);
    testTripId = res.recordset[0].TripId;
    trackTrip(testTripId);
  });

  const res = await fetch(`${baseUrl}/api/trips/${testTripId}/loading-plan`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.capacityInfo.status, 'VERIFIED');
  assert.equal(body.capacityInfo.truckTypeId, 'trailer');
  assert.equal(body.capacityInfo.maxWeightMain, 18);
  assert.equal(body.capacityInfo.maxWeightTrailer, 18);
  // Authoritative physical payload limit is 36t (not client spoofed 50t)
  assert.equal(body.totals.maxTon, 36);
});

test('Capacity 2.2: Missing truck master returns status UNKNOWN and does not blindly assume 50', async () => {
  let testTripId;
  await runWithTarget('remote_b', async () => {
    const res = await wfQuery(`
      INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, CreatedBy, Status, DocumentRevision)
      OUTPUT inserted.TripId
      VALUES ('TRIP-TEST-SO07-UNKNOWN', N'ไม่ระบุทะเบียนรถ', NULL, 1, 'DRAFT', 1)
    `);
    testTripId = res.recordset[0].TripId;
    trackTrip(testTripId);
  });

  const res = await fetch(`${baseUrl}/api/trips/${testTripId}/loading-plan`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.capacityInfo.status, 'UNKNOWN');
  assert.equal(body.totals.maxTon, 0);
  assert.ok(body.alerts.some(a => a.text.includes('UNKNOWN')));
});

// ─────────────────────────────────────────────────────────────
// GROUP 3: Transactional Load Plan Command (SO-07)
// ─────────────────────────────────────────────────────────────

test('Load Plan 3.1: Transactional command updates typed line IDs and updates revision', async () => {
  let testTripId;
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const tripRes = await wfQuery(`
      INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, TruckTypeId, CreatedBy, Status, DocumentRevision, LoadPlanRevision, LoadPlanStatus)
      OUTPUT inserted.TripId
      VALUES ('TRIP-TEST-SO07-PLAN1', N'70-1111', 36.00, 'trailer', 1, 'DRAFT', 1, 1, 'DRAFT')
    `);
    testTripId = tripRes.recordset[0].TripId;
    trackTrip(testTripId);

    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-LP-01', 'AI', '1001', N'ลูกค้าทดสอบ 1', 'DRAFT', @tripId, 1)
    `, { tripId: { type: sql.Int, value: testTripId } });
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`
      INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon)
      VALUES 
        (@soId, 1, 'G1', 'P1', N'ปุ๋ยสูตร 15-15-15', 20.000, 400, 15000),
        (@soId, 2, 'G2', 'P2', N'ปุ๋ยสูตร 16-20-0', 10.000, 200, 14000)
    `, { soId: { type: sql.Int, value: testSoId } });
  });

  const res = await fetch(`${baseUrl}/api/trips/${testTripId}/load-plan`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesToken}`
    },
    body: JSON.stringify({
      expectedPlanRevision: 1,
      lines: [
        {
          memberKind: 'DRAFT',
          memberId: String(testSoId),
          lineNum: 1,
          loadSequence: 1,
          masterQty: 10.000,
          childQty: 10.000
        },
        {
          memberKind: 'DRAFT',
          memberId: String(testSoId),
          lineNum: 2,
          loadSequence: 2,
          masterQty: 10.000,
          childQty: 0.000
        }
      ]
    })
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.loadPlanStatus, 'SALE_CONFIRMED');
  assert.equal(body.loadPlanRevision, 2);

  await runWithTarget('remote_b', async () => {
    const lines = (await wfQuery(`
      SELECT LineNum, LoadSequence, MasterQty, ChildQty
      FROM wf.SalesOrderLine WHERE SoId = @soId ORDER BY LineNum
    `, { soId: { type: sql.Int, value: testSoId } })).recordset;

    assert.equal(lines[0].LoadSequence, 1);
    assert.equal(Number(lines[0].MasterQty), 10);
    assert.equal(Number(lines[0].ChildQty), 10);

    assert.equal(lines[1].LoadSequence, 2);
    assert.equal(Number(lines[1].MasterQty), 10);
    assert.equal(Number(lines[1].ChildQty), 0);

    const trip = (await wfQuery(`SELECT LoadPlanStatus, LoadPlanRevision FROM wf.SalesTrip WHERE TripId = @tid`, {
      tid: { type: sql.Int, value: testTripId }
    })).recordset[0];
    assert.equal(trip.LoadPlanStatus, 'SALE_CONFIRMED');
    assert.equal(trip.LoadPlanRevision, 2);
  });
});

test('Load Plan 3.2: Rejects overallocation or negative quantities', async () => {
  let testTripId;
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const tripRes = await wfQuery(`
      INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, CreatedBy, Status, DocumentRevision, LoadPlanRevision, LoadPlanStatus)
      OUTPUT inserted.TripId
      VALUES ('TRIP-TEST-SO07-PLAN2', N'70-2222', 36.00, 1, 'DRAFT', 1, 1, 'DRAFT')
    `);
    testTripId = tripRes.recordset[0].TripId;
    trackTrip(testTripId);

    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-LP-02', 'AI', '1002', N'ลูกค้าทดสอบ 2', 'DRAFT', @tripId, 1)
    `, { tripId: { type: sql.Int, value: testTripId } });
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`
      INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon)
      VALUES (@soId, 1, 'G1', 'P1', N'ปุ๋ยสูตร 15-15-15', 20.000, 400, 15000)
    `, { soId: { type: sql.Int, value: testSoId } });
  });

  const res1 = await fetch(`${baseUrl}/api/trips/${testTripId}/load-plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      expectedPlanRevision: 1,
      lines: [{ memberKind: 'DRAFT', memberId: String(testSoId), lineNum: 1, loadSequence: 1, masterQty: 15, childQty: 10 }]
    })
  });
  assert.equal(res1.status, 400);
  const err1 = await res1.json();
  assert.ok(err1.message.includes('ไม่เท่ากับยอดในบิล'));

  const res2 = await fetch(`${baseUrl}/api/trips/${testTripId}/load-plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      expectedPlanRevision: 1,
      lines: [{ memberKind: 'DRAFT', memberId: String(testSoId), lineNum: 1, loadSequence: 1, masterQty: -5, childQty: 25 }]
    })
  });
  assert.equal(res2.status, 400);
  const err2 = await res2.json();
  assert.ok(err2.message.includes('ต้องไม่ติดลบ'));
});

test('Load Plan 3.3: Warehouse Ack and automatic invalidation upon subsequent plan edit', async () => {
  let testTripId;
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const tripRes = await wfQuery(`
      INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, CreatedBy, Status, DocumentRevision, LoadPlanRevision, LoadPlanStatus)
      OUTPUT inserted.TripId
      VALUES ('TRIP-TEST-SO07-PLAN3', N'70-3333', 36.00, 1, 'DRAFT', 1, 1, 'DRAFT')
    `);
    testTripId = tripRes.recordset[0].TripId;
    trackTrip(testTripId);

    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-LP-03', 'AI', '1003', N'ลูกค้าทดสอบ 3', 'DRAFT', @tripId, 1)
    `, { tripId: { type: sql.Int, value: testTripId } });
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`
      INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon)
      VALUES (@soId, 1, 'G1', 'P1', N'ปุ๋ยสูตร 15-15-15', 10.000, 200, 15000)
    `, { soId: { type: sql.Int, value: testSoId } });
  });

  // Step 1: Sales confirms load plan -> revision becomes 2, state SALE_CONFIRMED
  const res1 = await fetch(`${baseUrl}/api/trips/${testTripId}/load-plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      expectedPlanRevision: 1,
      lines: [{ memberKind: 'DRAFT', memberId: String(testSoId), lineNum: 1, loadSequence: 1, masterQty: 10, childQty: 0 }]
    })
  });
  assert.equal(res1.status, 200);

  // Step 2: Warehouse acknowledges revision 2
  const ackRes = await fetch(`${baseUrl}/api/trips/${testTripId}/load-plan/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({ expectedPlanRevision: 2 })
  });
  assert.equal(ackRes.status, 200);
  const ackBody = await ackRes.json();
  assert.equal(ackBody.loadPlanStatus, 'WAREHOUSE_ACK');

  // Verify in DB that WarehouseAckAt is set
  await runWithTarget('remote_b', async () => {
    const trip = (await wfQuery(`SELECT LoadPlanStatus, WarehouseAckAt FROM wf.SalesTrip WHERE TripId = @tid`, {
      tid: { type: sql.Int, value: testTripId }
    })).recordset[0];
    assert.equal(trip.LoadPlanStatus, 'WAREHOUSE_ACK');
    assert.ok(trip.WarehouseAckAt !== null);
  });

  // Step 3: Sales re-edits load plan -> revision becomes 3, WarehouseAckAt MUST BE INVALIDATED (null)
  const res2 = await fetch(`${baseUrl}/api/trips/${testTripId}/load-plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      expectedPlanRevision: 2,
      lines: [{ memberKind: 'DRAFT', memberId: String(testSoId), lineNum: 1, loadSequence: 1, masterQty: 5, childQty: 5 }]
    })
  });
  assert.equal(res2.status, 200);

  await runWithTarget('remote_b', async () => {
    const trip = (await wfQuery(`SELECT LoadPlanStatus, LoadPlanRevision, WarehouseAckAt FROM wf.SalesTrip WHERE TripId = @tid`, {
      tid: { type: sql.Int, value: testTripId }
    })).recordset[0];
    assert.equal(trip.LoadPlanStatus, 'SALE_CONFIRMED');
    assert.equal(trip.LoadPlanRevision, 3);
    assert.equal(trip.WarehouseAckAt, null, 'Warehouse acknowledgement must be invalidated upon plan edit');
  });
});

// ─────────────────────────────────────────────────────────────
// GROUP 4: Hardened Scale Event Linkage & Shipping Validation (SO-07)
// ─────────────────────────────────────────────────────────────

test('Weigh/Ship 4.1: Unacknowledged load plan blocks ship command', async () => {
  let testTripId;
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const tripRes = await wfQuery(`
      INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, CreatedBy, Status, DocumentRevision, LoadPlanRevision, LoadPlanStatus)
      OUTPUT inserted.TripId
      VALUES ('TRIP-TEST-SO07-SHIP1', N'70-4444', 36.00, 1, 'CONFIRMED', 1, 1, 'SALE_CONFIRMED')
    `);
    testTripId = tripRes.recordset[0].TripId;
    trackTrip(testTripId);

    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-01', 'AI', '1004', N'ลูกค้าทดสอบ 4', 'LOADED', @tripId, 1, N'70-4444')
    `, { tripId: { type: sql.Int, value: testTripId } });
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`
      INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix, TripId) VALUES (@soId, 'SO-TEST-SHIP-01', 'AI', @tripId)
    `, { soId: { type: sql.VarChar(50), value: String(testSoId) }, tripId: { type: sql.Int, value: testTripId } });
  });

  const res = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({ weighOutWeight: 30000, tareKg: 14000 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.message.includes('ยังไม่ได้รับการยืนยันจากฝ่ายคลัง'));
});

test('Weigh/Ship 4.2: Missing scale event blocks shipping unless authorized managerial exception', async () => {
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-02', 'AI', '1005', N'ลูกค้าทดสอบ 5', 'LOADED', 1, N'70-5555')
    `);
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix) VALUES (@soId, 'SO-TEST-SHIP-02', 'AI')`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    });
  });

  // Attempt 1: Warehouse user with no scale event and no override -> 400
  const res1 = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({ weighOutWeight: 30000, tareKg: 14000 })
  });
  assert.equal(res1.status, 400);
  const body1 = await res1.json();
  assert.ok(body1.message.includes('ไม่พบเหตุการณ์ชั่งจริง'));

  // Attempt 2: Warehouse user tries to pass manual override -> 403 Forbidden (requires MANAGER/ADMIN)
  const res2 = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      weighOutWeight: 30000,
      tareKg: 14000,
      overrideReason: 'เครื่องชั่งเสีย ชั่งด้วยมือ',
      evidencePhotoUrl: 'https://img.test/scale.jpg'
    })
  });
  assert.equal(res2.status, 403);
  const body2 = await res2.json();
  assert.ok(body2.message.includes('MANAGER'));

  // Attempt 3: Manager executes authorized override with photo and reason -> 200 Success
  const res3 = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
    body: JSON.stringify({
      weighOutWeight: 30000,
      tareKg: 14000,
      overrideReason: 'เครื่องชั่งช่อง 2 ขัดข้อง ชั่งด้วยแท่นชั่งสำรองโรง 3',
      evidencePhotoUrl: 'https://img.test/scale_ticket_photo.jpg',
      overrideApprovedBy: 9999 // Client tries to spoof approver
    })
  });
  assert.equal(res3.status, 200);

  // Verify in DB that approver was derived from token, NOT 9999
  await runWithTarget('remote_b', async () => {
    const ticket = (await wfQuery(`
      SELECT TOP 1 OverrideApprovedBy, OverrideReason, EvidencePhotoUrl
      FROM wf.WeighTicket WHERE SoId = @soId ORDER BY Id DESC
    `, { soId: { type: sql.NVarChar(50), value: String(testSoId) } })).recordset[0];

    assert.ok(ticket, 'WeighTicket must exist');
    assert.equal(ticket.OverrideApprovedBy, managerUserId, 'Approver ID must be strictly derived from auth token');
    assert.ok(ticket.EvidencePhotoUrl.includes('scale_ticket_photo.jpg'));
  });
});

test('Weigh/Ship 4.3: Scale event of DIFFERENT SO with same truck plate is REJECTED (Plate leakage prevention)', async () => {
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-LEAK', 'AI', '1006', N'ลูกค้าทดสอบ 6', 'LOADED', 1, N'70-LEAK')
    `);
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix) VALUES (@soId, 'SO-TEST-SHIP-LEAK', 'AI')`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    });

    // Insert a valid scale event for a COMPLETELY DIFFERENT SO with the same plate
    const tRes = await wfQuery(`
      INSERT INTO wf.WeighTicket (
        SoId, WfRef, TruckPlate, GrossKg, TareKg, NetKg, ScaleNo, WeighOutAt, Status, CreatedBy
      ) OUTPUT inserted.Id VALUES (
        'SO-TEST-OTHER-DIFF', 'SO-OTHER', N'70-LEAK', 32000, 12000, 20000, 1, GETUTCDATE(), 'DONE', 1
      )
    `);
    trackTicket(tRes.recordset[0].Id);
  });

  // Attempt ship: Must NOT pick up the scale event of the other SO just because the plate matches
  const res = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({ weighOutWeight: 32000, tareKg: 12000 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.message.includes('ไม่พบเหตุการณ์ชั่งจริง'));
});

test('Weigh/Ship 4.4: Manual override event CANNOT be reused as verified scale event on subsequent actions', async () => {
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-NOREUSE', 'AI', '1007', N'ลูกค้าทดสอบ 7', 'LOADED', 1, N'70-7777')
    `);
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix) VALUES (@soId, 'SO-TEST-SHIP-NOREUSE', 'AI')`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    });

    // Insert a ticket that was created via manual override (has OverrideApprovedBy)
    await wfQuery(`
      INSERT INTO wf.WeighTicket (
        SoId, WfRef, TruckPlate, GrossKg, TareKg, NetKg, ScaleNo, WeighOutAt, Status, CreatedBy, OverrideApprovedBy, OverrideReason
      ) VALUES (
        @soId, 'SO-TEST-SHIP-NOREUSE', N'70-7777', 30000, 14000, 16000, 1, GETUTCDATE(), 'DONE', 1, 63, N'แท่นชั่งเสีย ยกเว้นครั้งก่อน'
      )
    `, { soId: { type: sql.NVarChar(50), value: String(testSoId) } });
  });

  // Attempt ship as regular warehouse user without override parameters:
  // The existing manual override MUST NOT be treated as a verified automated scale event!
  const res = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({ weighOutWeight: 30000, tareKg: 14000 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.message.includes('ไม่พบเหตุการณ์ชั่งจริง'));
});

test('Weigh/Ship 4.5: Mismatch between request weights and verified scale event is REJECTED', async () => {
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-MISMATCH', 'AI', '1008', N'ลูกค้าทดสอบ 8', 'LOADED', 1, N'70-8888')
    `);
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix) VALUES (@soId, 'SO-TEST-SHIP-MISMATCH', 'AI')`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    });

    // Insert actual scale event: Gross 32,000 kg, Tare 12,000 kg
    await wfQuery(`
      INSERT INTO wf.WeighTicket (
        SoId, WfRef, TruckPlate, GrossKg, TareKg, NetKg, ScaleNo, WeighOutAt, Status, CreatedBy
      ) VALUES (
        @soId, 'SO-TEST-SHIP-MISMATCH', N'70-8888', 32000, 12000, 20000, 1, GETUTCDATE(), 'DONE', 1
      )
    `, { soId: { type: sql.NVarChar(50), value: String(testSoId) } });
  });

  // Client sends 35,000 kg instead of 32,000 kg -> 400 Bad Request
  const res = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({ weighOutWeight: 35000, tareKg: 12000 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.message.includes('ไม่ตรงกับข้อมูลจริงจากเครื่องชั่ง'));
});

test('Weigh/Ship 4.6: Native WGHD scale event happy path adopts authoritative weights', async () => {
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-WGHD', 'AI', '1009', N'ลูกค้าทดสอบ 9', 'LOADED', 1, N'TEST-WG99')
    `);
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix) VALUES (@soId, 'SO-TEST-SHIP-WGHD', 'AI')`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    });

    // Insert native scale event in dbo.WGHD with SPID = testSoId
    const wgRes = await wfQuery(`
      INSERT INTO dbo.WGHD (
        WGType, SPID, DocuNo, CarNo, WeightIn, WeightOut, WeightNet, Status, DateOut, LocationName
      ) OUTPUT inserted.Id VALUES (
        'SO', @soid, 'WG-TEST-01', N'TEST-WG99', 11500, 31500, 20000, '3', DATEADD(minute, -10, GETUTCDATE()), '1'
      )
    `, { soid: { type: sql.Int, value: Number(testSoId) } });
    trackWghd(wgRes.recordset[0].Id);
  });

  const res = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({}) // Client does not send weights -> adopts directly from WGHD
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'SHIPPED');
  assert.equal(body.netKg, 20000);

  // Verify in DB that SalesOrderExt adopted the authoritative Gross weight
  await runWithTarget('remote_b', async () => {
    const ext = (await wfQuery(`SELECT WeighOutWeight FROM wf.SalesOrderExt WHERE SOID = @soId`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    })).recordset[0];
    assert.equal(Number(ext.WeighOutWeight), 31500);
  });
});

test('Weigh/Ship 4.7: Idempotent ship retry returns existing status without side-effects', async () => {
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-IDEM', 'AI', '1010', N'ลูกค้าทดสอบ 10', 'LOADED', 1, N'TEST-WG88')
    `);
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix) VALUES (@soId, 'SO-TEST-SHIP-IDEM', 'AI')`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    });

    const wgRes = await wfQuery(`
      INSERT INTO dbo.WGHD (
        WGType, SPID, DocuNo, CarNo, WeightIn, WeightOut, WeightNet, Status, DateOut, LocationName
      ) OUTPUT inserted.Id VALUES (
        'SO', @soid, 'WG-TEST-02', N'TEST-WG88', 12000, 32000, 20000, '3', DATEADD(minute, -10, GETUTCDATE()), '1'
      )
    `, { soid: { type: sql.Int, value: Number(testSoId) } });
    trackWghd(wgRes.recordset[0].Id);
  });

  // Call 1: First ship
  const res1 = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({})
  });
  assert.equal(res1.status, 200);

  // Call 2: Retry ship (SO is now SHIPPED)
  const res2 = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({})
  });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.status, 'SHIPPED');
  assert.equal(body2.idempotent, true);

  // Verify only 1 WeighTicket exists
  await runWithTarget('remote_b', async () => {
    const tickets = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.WeighTicket WHERE SoId = @soId`, {
      soId: { type: sql.NVarChar(50), value: String(testSoId) }
    })).recordset[0].Cnt;
    assert.equal(tickets, 1, 'Only one WeighTicket should be generated across idempotent calls');
  });
});

test('Weigh/Ship 4.8: Parallel concurrent shipping requests produce exactly 1 ticket and 0 duplicate rebate accruals', async () => {
  let testTripId;
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const tripRes = await wfQuery(`
      INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, CreatedBy, Status, DocumentRevision, LoadPlanRevision, LoadPlanStatus)
      OUTPUT inserted.TripId
      VALUES ('TRIP-TEST-CONCUR', N'70-CONCUR', 36.00, 1, 'CONFIRMED', 1, 2, 'WAREHOUSE_ACK')
    `);
    testTripId = tripRes.recordset[0].TripId;
    trackTrip(testTripId);

    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-PARALLEL', 'AI', '1011', N'ลูกค้าทดสอบ 11', 'LOADED', @tripId, 1, N'70-CONCUR')
    `, { tripId: { type: sql.Int, value: testTripId } });
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`
      INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix, TripId) VALUES (@soId, 'SO-TEST-SHIP-PARALLEL', 'AI', @tripId)
    `, { soId: { type: sql.VarChar(50), value: String(testSoId) }, tripId: { type: sql.Int, value: testTripId } });

    await wfQuery(`
      INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon)
      VALUES (@soId, 1, 'G1', 'P1', N'ปุ๋ยสูตร 15-15-15', 20.000, 400, 15000)
    `, { soId: { type: sql.Int, value: testSoId } });

    const wgRes = await wfQuery(`
      INSERT INTO dbo.WGHD (
        WGType, SPID, DocuNo, CarNo, WeightIn, WeightOut, WeightNet, Status, DateOut, LocationName
      ) OUTPUT inserted.Id VALUES (
        'SO', @soid, 'WG-TEST-03', N'70-CONCUR', 12000, 32000, 20000, '3', DATEADD(minute, -5, GETUTCDATE()), '1'
      )
    `, { soid: { type: sql.Int, value: Number(testSoId) } });
    trackWghd(wgRes.recordset[0].Id);
  });

  // Execute TWO PARALLEL ship requests at the exact same time
  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
      body: JSON.stringify({})
    }),
    fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
      body: JSON.stringify({})
    })
  ]);

  assert.equal(resA.status, 200, `Request A should succeed (got ${resA.status})`);
  assert.equal(resB.status, 200, `Request B should succeed (got ${resB.status})`);

  const dataA = await resA.json();
  const dataB = await resB.json();

  assert.equal(dataA.status, 'SHIPPED');
  assert.equal(dataB.status, 'SHIPPED');
  assert.ok(dataA.idempotent || dataB.idempotent, 'One of the concurrent requests must be resolved as idempotent without race condition');

  // Verify database: EXACTLY 1 WeighTicket created
  await runWithTarget('remote_b', async () => {
    const ticketCount = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.WeighTicket WHERE SoId = @soId`, {
      soId: { type: sql.NVarChar(50), value: String(testSoId) }
    })).recordset[0].Cnt;
    assert.equal(ticketCount, 1, 'Exactly one WeighTicket must exist in DB despite parallel concurrent ship requests');

    // Verify database: at most 1 RebateLedger entry
    const rebateCount = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.RebateLedger WHERE SoId = @soId`, {
      soId: { type: sql.NVarChar(50), value: String(testSoId) }
    })).recordset[0].Cnt;
    assert.ok(rebateCount <= 1, 'No duplicate RebateLedger entries from parallel concurrent ship requests');
  });
});

test('Weigh/Ship 4.9: Controlled concurrent plan edit and ship interleaving', async () => {
  let testTripId;
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const tripRes = await wfQuery(`
      INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, CreatedBy, Status, DocumentRevision, LoadPlanRevision, LoadPlanStatus, WarehouseAckAt)
      OUTPUT inserted.TripId
      VALUES ('TRIP-TEST-CONCUR-LP', N'70-CONCUR-LP', 36.00, 1, 'CONFIRMED', 1, 2, 'WAREHOUSE_ACK', GETUTCDATE())
    `);
    testTripId = tripRes.recordset[0].TripId;
    trackTrip(testTripId);

    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-CONCURLP', 'AI', '1012', N'ลูกค้าทดสอบ 12', 'LOADED', @tripId, 1, N'70-CONCUR-LP')
    `, { tripId: { type: sql.Int, value: testTripId } });
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`
      INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix, TripId) VALUES (@soId, 'SO-TEST-SHIP-CONCURLP', 'AI', @tripId)
    `, { soId: { type: sql.VarChar(50), value: String(testSoId) }, tripId: { type: sql.Int, value: testTripId } });

    await wfQuery(`
      INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon)
      VALUES (@soId, 1, 'G1', 'P1', N'ปุ๋ยสูตร 15-15-15', 20.000, 400, 15000)
    `, { soId: { type: sql.Int, value: testSoId } });

    const wgRes = await wfQuery(`
      INSERT INTO dbo.WGHD (
        WGType, SPID, DocuNo, CarNo, WeightIn, WeightOut, WeightNet, Status, DateOut, LocationName
      ) OUTPUT inserted.Id VALUES (
        'SO', @soid, 'WG-TEST-CONCURLP', N'70-CONCUR-LP', 12000, 32000, 20000, '3', DATEADD(minute, -5, GETUTCDATE()), '1'
      )
    `, { soid: { type: sql.Int, value: Number(testSoId) } });
    trackWghd(wgRes.recordset[0].Id);
  });

  // Interleave plan edit and ship concurrently via Promise.all
  const [shipRes, editRes] = await Promise.all([
    fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
      body: JSON.stringify({})
    }),
    fetch(`${baseUrl}/api/trips/${testTripId}/load-plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        expectedPlanRevision: 2,
        lines: [{ memberKind: 'DRAFT', memberId: String(testSoId), lineNum: 1, loadSequence: 2, masterQty: 20, childQty: 0 }]
      })
    })
  ]);

  // Transaction serialization guarantees:
  // If ship won lock first -> ship is 200 (SHIPPED)
  // If edit won lock first -> edit is 200, ship sees LoadPlanStatus = SALE_CONFIRMED and returns 400
  const shipData = await shipRes.json();
  if (shipRes.status === 200) {
    assert.equal(shipData.status, 'SHIPPED');
  } else {
    assert.equal(shipRes.status, 400);
    assert.ok(shipData.message.includes('ยังไม่ได้รับการยืนยันจากฝ่ายคลัง'));
  }
  assert.ok([200, 400].includes(editRes.status));
});

test('Weigh/Ship 4.10: Fault injection mid-write transaction rollback ensures status & ticket atomicity', async () => {
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-ROLLBACK', 'AI', '1013', N'ลูกค้าทดสอบ 13', 'LOADED', 1, N'70-ROLLBACK')
    `);
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix) VALUES (@soId, 'SO-TEST-SHIP-ROLLBACK', 'AI')`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    });

    await wfQuery(`
      INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon)
      VALUES (@soId, 1, 'G1', 'P1', N'ปุ๋ยสูตร 15-15-15', 20.000, 400, 15000)
    `, { soId: { type: sql.Int, value: testSoId } });

    const wgRes = await wfQuery(`
      INSERT INTO dbo.WGHD (
        WGType, SPID, DocuNo, CarNo, WeightIn, WeightOut, WeightNet, Status, DateOut, LocationName
      ) OUTPUT inserted.Id VALUES (
        'SO', @soid, 'WG-TEST-ROLLBACK', N'70-ROLLBACK', 12000, 32000, 20000, '3', DATEADD(minute, -5, GETUTCDATE()), '1'
      )
    `, { soid: { type: sql.Int, value: Number(testSoId) } });
    trackWghd(wgRes.recordset[0].Id);
  });

  // Call ship with mid_write_rollback fault injection header
  const res = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
      'x-test-fault-injection': 'mid_write_rollback'
    },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.ok(body.message.includes('FAULT_INJECTION_MID_WRITE_ROLLBACK'));

  // Assert in DB that status rolled back to LOADED, 0 WeighTicket, 0 OutboxEvent
  await runWithTarget('remote_b', async () => {
    const so = (await wfQuery(`SELECT Status FROM wf.SalesOrder WHERE Id = @soId`, {
      soId: { type: sql.Int, value: testSoId }
    })).recordset[0];
    assert.equal(so.Status, 'LOADED', 'Status must remain LOADED after mid-write transaction rollback');

    const ext = (await wfQuery(`SELECT WeighOutWeight FROM wf.SalesOrderExt WHERE SOID = @soId`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    })).recordset[0];
    assert.equal(ext.WeighOutWeight, null, 'WeighOutWeight must be rolled back to NULL');

    const ticketCount = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.WeighTicket WHERE SoId = @soId`, {
      soId: { type: sql.NVarChar(50), value: String(testSoId) }
    })).recordset[0].Cnt;
    assert.equal(ticketCount, 0, 'No WeighTicket should exist after transaction rollback');

    const outboxCount = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.OutboxEvent WHERE AggregateId = @soId AND EventType = 'SO_SHIPPED'`, {
      soId: { type: sql.NVarChar(60), value: String(testSoId) }
    })).recordset[0].Cnt;
    assert.equal(outboxCount, 0, 'No OutboxEvent should exist after transaction rollback');
  });
});

test('Weigh/Ship 4.11: Post-commit failure recovery completes pending rebate & outbox without duplicate side-effects', async () => {
  let testSoId;

  await runWithTarget('remote_b', async () => {
    const soRes = await wfQuery(`
      INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, SalesUserId, TruckPlate)
      OUTPUT inserted.Id
      VALUES ('SO-TEST-SHIP-RECOVER', 'AI', '1014', N'ลูกค้าทดสอบ 14', 'LOADED', 1, N'70-RECOVER')
    `);
    testSoId = soRes.recordset[0].Id;
    trackSo(testSoId);

    await wfQuery(`INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix) VALUES (@soId, 'SO-TEST-SHIP-RECOVER', 'AI')`, {
      soId: { type: sql.VarChar(50), value: String(testSoId) }
    });

    // Line with price differential to trigger rebate accrual
    await wfQuery(`
      INSERT INTO wf.SalesOrderLine (SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon, NetPricePerTon)
      VALUES (@soId, 1, 'G1', 'P1', N'ปุ๋ยสูตร 15-15-15', 10.000, 200, 15000, 14000)
    `, { soId: { type: sql.Int, value: testSoId } });

    const wgRes = await wfQuery(`
      INSERT INTO dbo.WGHD (
        WGType, SPID, DocuNo, CarNo, WeightIn, WeightOut, WeightNet, Status, DateOut, LocationName
      ) OUTPUT inserted.Id VALUES (
        'SO', @soid, 'WG-TEST-RECOVER', N'70-RECOVER', 12000, 22000, 10000, '3', DATEADD(minute, -5, GETUTCDATE()), '1'
      )
    `, { soid: { type: sql.Int, value: Number(testSoId) } });
    trackWghd(wgRes.recordset[0].Id);
  });

  // Step 1: Trigger ship with post_commit_delivery_failure
  // The DB transaction commits (status becomes SHIPPED, outbox is PENDING), but crashes right after
  const res1 = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
      'x-test-fault-injection': 'post_commit_delivery_failure'
    },
    body: JSON.stringify({})
  });
  assert.equal(res1.status, 500);
  const body1 = await res1.json();
  assert.ok(body1.message.includes('FAULT_INJECTION_POST_COMMIT_DELIVERY_FAILURE'));

  // Step 2: Verify in DB that status IS committed as SHIPPED and outbox is PENDING, but RebateLedger is NOT yet booked
  await runWithTarget('remote_b', async () => {
    const so = (await wfQuery(`SELECT Status FROM wf.SalesOrder WHERE Id = @soId`, {
      soId: { type: sql.Int, value: testSoId }
    })).recordset[0];
    assert.equal(so.Status, 'SHIPPED', 'SO status must be SHIPPED in DB because transaction committed');

    const outbox = (await wfQuery(`SELECT Status FROM wf.OutboxEvent WHERE AggregateId = @soId AND EventType = 'SO_SHIPPED'`, {
      soId: { type: sql.NVarChar(60), value: String(testSoId) }
    })).recordset[0];
    assert.equal(outbox?.Status, 'PENDING', 'Outbox must be in PENDING state awaiting delivery');

    const rebateCount = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.RebateLedger WHERE SoId = @soId`, {
      soId: { type: sql.NVarChar(50), value: String(testSoId) }
    })).recordset[0].Cnt;
    assert.equal(rebateCount, 0, 'RebateLedger must not be booked yet due to post-commit interruption');
  });

  // Step 3: Client retries ship request (normal idempotent retry without fault injection)
  const res2 = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`
    },
    body: JSON.stringify({})
  });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.status, 'SHIPPED');
  assert.equal(body2.idempotent, true);
  assert.equal(body2.recovered, true, 'Retry must report that pending tasks were recovered');

  // Step 4: Verify in DB that retry completed the pending rebate and outbox transitioned to DONE
  await runWithTarget('remote_b', async () => {
    const rebateCount = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.RebateLedger WHERE SoId = @soId`, {
      soId: { type: sql.NVarChar(50), value: String(testSoId) }
    })).recordset[0].Cnt;
    assert.equal(rebateCount, 1, 'RebateLedger must be recovered and booked exactly once');

    const outbox = (await wfQuery(`SELECT Status FROM wf.OutboxEvent WHERE AggregateId = @soId AND EventType = 'SO_SHIPPED'`, {
      soId: { type: sql.NVarChar(60), value: String(testSoId) }
    })).recordset[0];
    assert.equal(outbox?.Status, 'DONE', 'Outbox must now be marked DONE');
  });

  // Step 5: Second retry must be purely idempotent with zero duplicate rows
  const res3 = await fetch(`${baseUrl}/api/so/${testSoId}/ship`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`
    },
    body: JSON.stringify({})
  });
  assert.equal(res3.status, 200);
  const body3 = await res3.json();
  assert.equal(body3.recovered, false, 'Second retry does not re-run recovered tasks');

  await runWithTarget('remote_b', async () => {
    const rebateCount = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.RebateLedger WHERE SoId = @soId`, {
      soId: { type: sql.NVarChar(50), value: String(testSoId) }
    })).recordset[0].Cnt;
    assert.equal(rebateCount, 1, 'RebateLedger must still have exactly 1 row (zero duplicate accruals)');
  });
});

test('Weigh/Ship 4.12: Native SO without draft mirror ships successfully and ensures ext record', async () => {
  let nativeSo;

  await runWithTarget('remote_b', async () => {
    // Find an actual unmirrored native document from dbo.SOHD
    const nativeRow = (await wfQuery(`
      SELECT TOP 1 hd.SOID, hd.DocuNo, hd.CustID, hd.TransRegistration
      FROM dbo.SOHD hd WITH (NOLOCK)
      LEFT JOIN wf.SalesOrder so WITH (NOLOCK) ON so.Id = hd.SOID
      LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK) ON ext.SOID = CAST(hd.SOID AS VARCHAR(50))
      WHERE so.Id IS NULL AND (ext.WeighOutWeight IS NULL OR ext.SOID IS NULL) AND hd.DocuStatus = 'N'
      ORDER BY hd.SOID DESC
    `)).recordset?.[0];

    assert.ok(nativeRow, 'Must find a native unmirrored SO in dbo.SOHD');
    nativeSo = nativeRow;

    const soIdStr = String(nativeSo.SOID);
    trackSo(nativeSo.SOID);

    // Ensure wf.SalesOrderExt exists with IsLoaded = 1
    await wfQuery(`
      IF NOT EXISTS (SELECT 1 FROM wf.SalesOrderExt WHERE SOID = @soId)
      BEGIN
        INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix, IsLoaded)
        VALUES (@soId, @ref, 'AI', 1)
      END
      ELSE
      BEGIN
        UPDATE wf.SalesOrderExt SET IsLoaded = 1, WeighOutWeight = NULL WHERE SOID = @soId
      END
    `, { soId: { type: sql.VarChar(50), value: soIdStr }, ref: { type: sql.NVarChar(30), value: nativeSo.DocuNo } });

    // Add scale event in dbo.WGHD for this native SO
    const wgRes = await wfQuery(`
      INSERT INTO dbo.WGHD (
        WGType, SPID, DocuNo, CarNo, WeightIn, WeightOut, WeightNet, Status, DateOut, LocationName
      ) OUTPUT inserted.Id VALUES (
        'SO', @soid, 'WG-NATIVE-TEST', ISNULL(@carNo, N'70-NATIVE'), 13000, 33000, 20000, '3', DATEADD(minute, -5, GETUTCDATE()), '1'
      )
    `, {
      soid: { type: sql.Int, value: Number(nativeSo.SOID) },
      carNo: { type: sql.NVarChar(30), value: nativeSo.TransRegistration || '70-NATIVE' }
    });
    trackWghd(wgRes.recordset[0].Id);
  });

  const res = await fetch(`${baseUrl}/api/so/${nativeSo.SOID}/ship`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'SHIPPED');

  await runWithTarget('remote_b', async () => {
    const ext = (await wfQuery(`SELECT WeighOutWeight FROM wf.SalesOrderExt WHERE SOID = @soId`, {
      soId: { type: sql.VarChar(50), value: String(nativeSo.SOID) }
    })).recordset[0];
    assert.ok(ext?.WeighOutWeight > 0, 'Native SO must have WeighOutWeight populated');

    const draftExists = (await wfQuery(`SELECT COUNT(*) AS Cnt FROM wf.SalesOrder WHERE Id = @soId`, {
      soId: { type: sql.Int, value: Number(nativeSo.SOID) }
    })).recordset[0].Cnt;
    assert.equal(draftExists, 0, 'No draft row should be created in wf.SalesOrder');

    // Reset WeighOutWeight on this native row during test cleanup so it remains clean
    await wfQuery(`UPDATE wf.SalesOrderExt SET WeighOutWeight = NULL, IsLoaded = 0 WHERE SOID = @soId`, {
      soId: { type: sql.VarChar(50), value: String(nativeSo.SOID) }
    });
  });
});
