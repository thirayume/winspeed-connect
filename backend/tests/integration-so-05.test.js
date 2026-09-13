'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { runWithTarget, query, wfQuery, pools, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const { evaluateLinePrice, calculatePricingFingerprint } = require('../services/price-authority');
const { getBangkokDateString, addBangkokCalendarDays } = require('../services/so-pickup-policy');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

function makeToken(sub, role, username) {
  return jwt.sign({ sub, id: sub, role, username }, SECRET, { expiresIn: '1h' });
}

const sales1Token = makeToken(1, 'SALES', 'sales1');
const sales2Token = makeToken(2, 'SALES', 'sales2');
const managerToken = makeToken(63, 'MANAGER', 'manager1');
const adminToken = makeToken(63, 'ADMIN', 'admin1');

let server;
let baseUrl;

async function startTestServer() {
  if (server) return;
  await new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      runWithTarget('remote_b', next);
    });

    app.use('/api/so', require('../routes/so'));
    app.use('/api/trips', require('../routes/trips'));
    app.use('/api/edit-requests', require('../routes/edit-requests'));

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

async function stopTestServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
}

const runRemote = (fn) => runWithTarget('remote_b', fn);

// ── 1. Target Safety Marker ──────────────────────────────────────────────────
test('SO-05.0: Target safety marker verifies test database before test execution', async () => {
  await runRemote(async () => {
    const { dbName } = await assertTestDatabase();
    assert.match(dbName, /test/i, 'Database must be test database');
    assert.notEqual(dbName, 'dbwins_worldfert9', 'Must not run against production');
  });
});

// ── 2. Price Authority Filtering & Unit Resolution (Finding 5) ───────────────
test('SO-05.1: Price authority filters out expired prices and requires approval for below-announced price', async () => {
  await runRemote(async () => {
    await assertTestDatabase();

    const goodId = '23042'; // Good with real price records in test DB
    const line = { goodId, qtyTon: 1, pricePerTon: 17000, isGiveaway: false };

    // 2.1 On 2026-09-07, previous price (SetPriceID 2062) expired on 2026-08-31
    // Filter `(hd.EndDate IS NULL OR hd.EndDate >= @d)` must exclude it and return UNKNOWN
    const resExpired = await evaluateLinePrice(line, null, '2026-09-07');
    assert.equal(resExpired.hasAnnouncedPrice, false, 'Expired price must not be treated as active announced price');
    assert.equal(resExpired.requiresApproval, true, 'Unknown price must fail closed to requiring approval');
    assert.equal(resExpired.announcedPrice, null);

    // 2.2 On 2026-08-31, active price was 17,800
    // Selling at 17,000 is 800 below announced price -> requires approval
    const resActiveDiscount = await evaluateLinePrice(line, null, '2026-08-31');
    assert.equal(resActiveDiscount.hasAnnouncedPrice, true);
    assert.equal(resActiveDiscount.announcedPrice, 17800);
    assert.equal(resActiveDiscount.requiresApproval, true);
    assert.equal(resActiveDiscount.deviationPerTon, 800);
    assert.equal(resActiveDiscount.totalDeviation, 800);

    // 2.3 On 2026-08-31, selling at 17,800 is at announced price -> no approval required
    const resFair = await evaluateLinePrice({ ...line, pricePerTon: 17800 }, null, '2026-08-31');
    assert.equal(resFair.hasAnnouncedPrice, true);
    assert.equal(resFair.requiresApproval, false);
    assert.equal(resFair.deviationPerTon, 0);

    // 2.4 Giveaway item is exempt from price approval
    const resGiveaway = await evaluateLinePrice({ ...line, pricePerTon: 0, isGiveaway: true }, null, '2026-08-31');
    assert.equal(resGiveaway.isGiveaway, true);
    assert.equal(resGiveaway.requiresApproval, false, 'Giveaway must be exempt from price approval');
  });
});

// ── 3. Real API: Below-Announced Price Creation & Approval Gate (Finding 6 & 7) ─
test('SO-05.2: Real API: Below-announced price triggers approval request; blocks confirmation until manager approval', async () => {
  await startTestServer();
  let createdSoId = null;
  let priceApprovalId = null;

  try {
    await runRemote(async () => { await assertTestDatabase(); });

    // Step A: Call real POST /api/so with line below announced price
    const orderPayload = {
      soPrefix: 'I',
      custId: '1000',
      custName: 'พาต้าเคมีคอล แอนด์ แมชชีนเนอรี่ จำกัด',
      deliveryDate: '2026-08-31',
      creditDays: 30,
      noTruckRequired: true,
      lines: [
        {
          goodId: '23042',
          goodCode: '7-12042600BBCAR',
          goodName: '12-4-26 เชิงผสม ตรารถเกษตร',
          qtyTon: 2,
          qtyBag: 40,
          pricePerTon: 17000, // 800 below announced 17,800
          netPricePerTon: 17000,
          isGiveaway: false,
        }
      ]
    };

    const createRes = await fetch(`${baseUrl}/api/so`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sales1Token}`,
      },
      body: JSON.stringify(orderPayload),
    });

    assert.equal(createRes.status, 200, 'POST /api/so must return 200');
    const createData = await createRes.json();
    assert.equal(createData.needsApproval, true, 'needsApproval flag must be true');
    createdSoId = createData.id;
    assert.ok(createdSoId, 'Created SO ID must be returned');

    // Verify DB state
    await runRemote(async () => {
      await assertTestDatabase();
      const soRow = (await wfQuery(`SELECT RequiresPriceApproval, PriceApprovalStatus, DocumentRevision, PricingFingerprint FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: createdSoId } })).recordset[0];
      assert.equal(soRow.RequiresPriceApproval, true);
      assert.equal(soRow.PriceApprovalStatus, 'PENDING');
      assert.equal(soRow.DocumentRevision, 1);
      assert.ok(soRow.PricingFingerprint, 'PricingFingerprint must be recorded');

      const aprRow = (await wfQuery(`SELECT Id, Status, DocumentRevision FROM wf.PriceApproval WHERE SoId = @id`, { id: { type: sql.Int, value: createdSoId } })).recordset[0];
      assert.ok(aprRow, 'PriceApproval request must exist in DB');
      assert.equal(aprRow.Status, 'PENDING');
      assert.equal(aprRow.DocumentRevision, 1);
      priceApprovalId = aprRow.Id;
    });

    // Step B: Attempt confirmation via real PATCH /api/so/:id/confirm while PENDING
    const confirmAttempt = await fetch(`${baseUrl}/api/so/${createdSoId}/confirm`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ pickupDueDate: '2026-09-10' }),
    });

    assert.equal(confirmAttempt.status, 400, 'Confirmation must be blocked when price approval is PENDING');
    const confirmFailData = await confirmAttempt.json();
    assert.equal(confirmFailData.requiresApproval, true);

    // Step C: Attempt approval by SALES user -> must be rejected with 403 Forbidden
    const salesApproveAttempt = await fetch(`${baseUrl}/api/edit-requests/price-approvals/${priceApprovalId}/approve`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sales1Token}`,
      },
      body: JSON.stringify({ note: 'Self approve attempt' }),
    });
    assert.equal(salesApproveAttempt.status, 403, 'Sales user must not be able to approve price requests');

    // Step D: Approve by MANAGER -> must succeed with 200 OK
    const mgrApproveRes = await fetch(`${baseUrl}/api/edit-requests/price-approvals/${priceApprovalId}/approve`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${managerToken}`,
      },
      body: JSON.stringify({ note: 'Approved discount by manager' }),
    });
    assert.equal(mgrApproveRes.status, 200, 'Manager approval must succeed');
    const mgrData = await mgrApproveRes.json();
    assert.equal(mgrData.status, 'APPROVED');

    // Verify DB state updated
    await runRemote(async () => {
      await assertTestDatabase();
      const soRow = (await wfQuery(`SELECT PriceApprovalStatus FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: createdSoId } })).recordset[0];
      assert.equal(soRow.PriceApprovalStatus, 'APPROVED');
    });

  } finally {
    await runRemote(async () => {
      await assertTestDatabase();
      if (priceApprovalId) await wfQuery(`DELETE FROM wf.PriceApproval WHERE Id = @id`, { id: { type: sql.Int, value: priceApprovalId } }).catch(() => {});
      if (createdSoId) {
        await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SoId = @id`, { id: { type: sql.Int, value: createdSoId } }).catch(() => {});
        await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: createdSoId } }).catch(() => {});
      }
    });
  }
});

// ── 4. Real API: Revision Invalidation on Edit (Finding 6) ───────────────────
test('SO-05.3: Real API: Editing an approved SO bumps DocumentRevision and marks previous approval SUPERSEDED', async () => {
  await startTestServer();
  let createdSoId = null;
  let priceApprovalId = null;

  try {
    await runRemote(async () => { await assertTestDatabase(); });

    // Step A: Create and approve SO
    const createRes = await fetch(`${baseUrl}/api/so`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        soPrefix: 'I',
        custId: '1000',
        custName: 'พาต้าเคมีคอล แอนด์ แมชชีนเนอรี่ จำกัด',
        deliveryDate: '2026-08-31',
        lines: [{
          goodId: '23042',
          goodCode: '7-12042600BBCAR',
          goodName: '12-4-26 เชิงผสม ตรารถเกษตร',
          qtyTon: 2,
          qtyBag: 40,
          pricePerTon: 17000,
          netPricePerTon: 17000,
          isGiveaway: false,
        }]
      }),
    });
    const cData = await createRes.json();
    createdSoId = cData.id;

    // Get approval ID and approve it
    await runRemote(async () => {
      await assertTestDatabase();
      const apr = (await wfQuery(`SELECT Id FROM wf.PriceApproval WHERE SoId = @id`, { id: { type: sql.Int, value: createdSoId } })).recordset[0];
      priceApprovalId = apr.Id;
    });

    const approveRes = await fetch(`${baseUrl}/api/edit-requests/price-approvals/${priceApprovalId}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${managerToken}` },
      body: JSON.stringify({ note: 'Initial approval' }),
    });
    assert.equal(approveRes.status, 200);

    // Step B: Edit the SO via PUT /api/so/:id (e.g. increase quantity)
    const editRes = await fetch(`${baseUrl}/api/so/${createdSoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        soPrefix: 'I',
        custId: '1000',
        custName: 'พาต้าเคมีคอล แอนด์ แมชชีนเนอรี่ จำกัด',
        deliveryDate: '2026-08-31',
        lines: [{
          goodId: '23042',
          goodCode: '7-12042600BBCAR',
          goodName: '12-4-26 เชิงผสม ตรารถเกษตร',
          qtyTon: 5, // Changed from 2 to 5
          qtyBag: 100,
          pricePerTon: 17000,
          netPricePerTon: 17000,
          isGiveaway: false,
        }]
      }),
    });
    assert.equal(editRes.status, 200);

    // Step C: Verify DB: DocumentRevision = 2, previous approval = SUPERSEDED
    await runRemote(async () => {
      await assertTestDatabase();
      const so = (await wfQuery(`SELECT DocumentRevision, RequiresPriceApproval, PriceApprovalStatus FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: createdSoId } })).recordset[0];
      assert.equal(so.DocumentRevision, 2, 'DocumentRevision must be bumped to 2');
      assert.equal(so.PriceApprovalStatus, 'PENDING', 'PriceApprovalStatus must reset to PENDING');

      const oldApr = (await wfQuery(`SELECT Status, DocumentRevision FROM wf.PriceApproval WHERE Id = @id`, { id: { type: sql.Int, value: priceApprovalId } })).recordset[0];
      assert.equal(oldApr.Status, 'SUPERSEDED', 'Previous approval must be marked SUPERSEDED');
      assert.equal(oldApr.DocumentRevision, 1);
    });

    // Step D: Confirm must be blocked because current revision is not approved
    const confirmRes = await fetch(`${baseUrl}/api/so/${createdSoId}/confirm`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ pickupDueDate: '2026-09-10' }),
    });
    assert.equal(confirmRes.status, 400, 'Confirmation must be blocked for superseded revision');

  } finally {
    await runRemote(async () => {
      await assertTestDatabase();
      if (createdSoId) {
        await wfQuery(`DELETE FROM wf.PriceApproval WHERE SoId = @id`, { id: { type: sql.Int, value: createdSoId } }).catch(() => {});
        await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SoId = @id`, { id: { type: sql.Int, value: createdSoId } }).catch(() => {});
        await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: createdSoId } }).catch(() => {});
      }
    });
  }
});

// ── 5. Real API: Multi-Customer Draft Trip (Finding 1 & 2) ───────────────────
test('SO-05.4: Real API: Draft Trip created without vehicle houses multi-customer SOs with preserved identity', async () => {
  await startTestServer();
  let testTripId = null;
  let soId1 = null;
  let soId2 = null;

  try {
    await runRemote(async () => { await assertTestDatabase(); });

    // Step A: Create Draft Trip via POST /api/trips without vehicle
    const tripRes = await fetch(`${baseUrl}/api/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        transRegistration: null,
        driverName: null,
        truckCapacityTon: 30.00,
        scheduledDate: '2026-09-15',
      }),
    });
    assert.equal(tripRes.status, 200);
    const tripData = await tripRes.json();
    testTripId = tripData.tripId;
    assert.ok(testTripId, 'Trip ID must be returned');

    // Step B: Create two SOs with DIFFERENT customers linked to this Trip
    const so1Res = await fetch(`${baseUrl}/api/so`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        tripId: testTripId,
        soPrefix: 'I',
        custId: '1000',
        custName: 'พาต้าเคมีคอล แอนด์ แมชชีนเนอรี่ จำกัด',
        deliveryDate: '2026-09-15',
        lines: [{ goodId: '23042', goodCode: '7-12042600BBCAR', goodName: '12-4-26', qtyTon: 5, pricePerTon: 18000, isGiveaway: false }]
      }),
    });
    assert.equal(so1Res.status, 200);
    soId1 = (await so1Res.json()).id;

    const so2Res = await fetch(`${baseUrl}/api/so`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        tripId: testTripId,
        soPrefix: 'K',
        custId: '1001',
        custName: 'ดาวฟ้าเคมี จำกัด',
        deliveryDate: '2026-09-15',
        lines: [{ goodId: '23042', goodCode: '7-12042600BBCAR', goodName: '12-4-26', qtyTon: 10, pricePerTon: 18000, isGiveaway: false }]
      }),
    });
    assert.equal(so2Res.status, 200);
    soId2 = (await so2Res.json()).id;

    // Step C: Verify through wf.v_TripMember view
    await runRemote(async () => {
      await assertTestDatabase();
      const members = (await wfQuery(`SELECT * FROM wf.v_TripMember WHERE TripId = @tripId`, { tripId: { type: sql.Int, value: testTripId } })).recordset;
      assert.equal(members.length, 2, 'Both SOs must be members of the trip');
      const custs = new Set(members.map(m => m.CustId));
      assert.equal(custs.size, 2, 'Must preserve distinct customers per SO');
    });

  } finally {
    await runRemote(async () => {
      await assertTestDatabase();
      if (soId1) {
        await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SoId = @id`, { id: { type: sql.Int, value: soId1 } }).catch(() => {});
        await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: soId1 } }).catch(() => {});
      }
      if (soId2) {
        await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SoId = @id`, { id: { type: sql.Int, value: soId2 } }).catch(() => {});
        await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: soId2 } }).catch(() => {});
      }
      if (testTripId) await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @id`, { id: { type: sql.Int, value: testTripId } }).catch(() => {});
    });
  }
});

// ── 6. Real API: Trip Confirm Validations ("วันรับห้ามเดา", ทะเบียน, สิทธิ์) ─
test('SO-05.5: Real API: Trip confirmation enforces truck plate, strict pickupDueDate and ownership', async () => {
  await startTestServer();
  let testTripId = null;
  let soId = null;

  try {
    await runRemote(async () => {
      await assertTestDatabase();
      const tripR = await wfQuery(`
        INSERT INTO wf.SalesTrip (TripCode, TransRegistration, CreatedBy, Status, DocumentRevision)
        OUTPUT inserted.TripId
        VALUES ('TEST_VALIDATION_TRIP', NULL, 1, 'DRAFT', 1)
      `);
      testTripId = tripR.recordset[0].TripId;

      const soR = await wfQuery(`
        INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId, EnteredByUserId)
        OUTPUT inserted.Id
        VALUES ('TEST_VAL_SO', 'I', '1000', 'Test Cust', 'DRAFT', @tripId, 1, 1)
      `, { tripId: { type: sql.Int, value: testTripId } });
      soId = soR.recordset[0].Id;
    });

    // 6.1 Missing truck plate -> 400 Bad Request
    const noPlateRes = await fetch(`${baseUrl}/api/trips/${testTripId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        confirmedOrderIds: [soId],
        transRegistration: 'ยังไม่ระบุรถ',
        pickupDueDate: '2026-09-15',
      }),
    });
    assert.equal(noPlateRes.status, 400);
    const noPlateData = await noPlateRes.json();
    assert.match(noPlateData.message, /ทะเบียนรถ/);

    // 6.2 Missing pickupDueDate -> 400 Bad Request ("วันรับห้ามเดา")
    const noDateRes = await fetch(`${baseUrl}/api/trips/${testTripId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        confirmedOrderIds: [soId],
        transRegistration: '70-1234',
        pickupDueDate: null, // P1 Finding 4: Must not guess today
      }),
    });
    assert.equal(noDateRes.status, 400);
    const noDateData = await noDateRes.json();
    assert.match(noDateData.message, /pickupDueDate/);

    // 6.3 Non-owner non-admin user -> 403 Forbidden
    const unauthRes = await fetch(`${baseUrl}/api/trips/${testTripId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales2Token}` },
      body: JSON.stringify({
        confirmedOrderIds: [soId],
        transRegistration: '70-1234',
        pickupDueDate: '2026-09-15',
        expectedRevision: 1,
      }),
    });
    assert.equal(unauthRes.status, 403);
    const unauthData = await unauthRes.json();
    assert.match(unauthData.message, /สิทธิ์/);

  } finally {
    await runRemote(async () => {
      await assertTestDatabase();
      if (soId) await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: soId } }).catch(() => {});
      if (testTripId) await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @id`, { id: { type: sql.Int, value: testTripId } }).catch(() => {});
    });
  }
});

// ── 7. Real API: Trip Confirm Residual Split & Idempotency Replay (Findings 3 & 4) ─
test('SO-05.6: Real API: Trip confirm performs atomic residual split and handles scoped idempotency key replay vs conflict', async () => {
  await startTestServer();
  const fixtureTag = `TRIP_SPLIT_${Date.now().toString(36)}`;
  let testTripId = null;
  let residualTripId = null;
  let soIdA = null;
  let soIdB = null;

  try {
    await runRemote(async () => {
      await assertTestDatabase();
      const tripR = await wfQuery(`
        INSERT INTO wf.SalesTrip (TripCode, TransRegistration, TruckCapacityTon, CreatedBy, Status, DocumentRevision)
        OUTPUT inserted.TripId
        VALUES (@code, NULL, 35.00, 1, 'DRAFT', 1)
      `, { code: { type: sql.VarChar(50), value: fixtureTag } });
      testTripId = tripR.recordset[0].TripId;

      const soAR = await wfQuery(`
        INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId, EnteredByUserId)
        OUTPUT inserted.Id
        VALUES (@ref, 'I', '1000', 'Cust 1000', 'DRAFT', @tripId, 1, 1)
      `, { ref: { type: sql.NVarChar(30), value: `${fixtureTag}_A` }, tripId: { type: sql.Int, value: testTripId } });
      soIdA = soAR.recordset[0].Id;

      const soBR = await wfQuery(`
        INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, SalesUserId, EnteredByUserId)
        OUTPUT inserted.Id
        VALUES (@ref, 'K', '1001', 'Cust 1001', 'DRAFT', @tripId, 1, 1)
      `, { ref: { type: sql.NVarChar(30), value: `${fixtureTag}_B` }, tripId: { type: sql.Int, value: testTripId } });
      soIdB = soBR.recordset[0].Id;
    });

    const idempotencyKey = `idem-${fixtureTag}`;
    const truckPlate = '70-5555';
    const pickupDueDate = '2026-09-15';

    // Step A: Confirm selecting SO A only, omitting SO B
    const confirmRes = await fetch(`${baseUrl}/api/trips/${testTripId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        confirmedOrderIds: [soIdA],
        transRegistration: truckPlate,
        pickupDueDate,
        idempotencyKey,
        expectedRevision: 1,
      }),
    });

    assert.equal(confirmRes.status, 200, 'Trip confirmation must succeed');
    const confirmData = await confirmRes.json();
    assert.equal(confirmData.confirmedOrderCount, 1);
    assert.equal(confirmData.residualOrderCount, 1);
    assert.ok(confirmData.residualTripId, 'Residual trip ID must be generated');
    residualTripId = confirmData.residualTripId;
    assert.equal(confirmData.residualTripCode, `${fixtureTag}-R`);

    // Verify DB state
    await runRemote(async () => {
      await assertTestDatabase();
      const trip = (await wfQuery(`SELECT Status, TransRegistration, DocumentRevision, IdempotencyKey, PayloadHash FROM wf.SalesTrip WHERE TripId = @id`, { id: { type: sql.Int, value: testTripId } })).recordset[0];
      assert.equal(trip.Status, 'CONFIRMED');
      assert.equal(trip.TransRegistration, truckPlate);
      assert.equal(trip.DocumentRevision, 2);
      assert.equal(trip.IdempotencyKey, idempotencyKey);
      assert.ok(trip.PayloadHash, 'PayloadHash must be recorded');

      const resTrip = (await wfQuery(`SELECT Status, TripCode, ParentTripId, IsResidual FROM wf.SalesTrip WHERE TripId = @id`, { id: { type: sql.Int, value: residualTripId } })).recordset[0];
      assert.equal(resTrip.Status, 'DRAFT');
      assert.equal(resTrip.TripCode, `${fixtureTag}-R`);
      assert.equal(Number(resTrip.ParentTripId), Number(testTripId));
      assert.equal(resTrip.IsResidual, true);

      // Verify SO B was moved to residual trip
      const soB = (await wfQuery(`SELECT TripId FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: soIdB } })).recordset[0];
      assert.equal(Number(soB.TripId), Number(residualTripId), 'Unselected SO B must be moved to residual trip');
    });

    // Step B: Replay EXACT same request with same idempotencyKey -> must return 200 with isIdempotent: true
    const replayRes = await fetch(`${baseUrl}/api/trips/${testTripId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        confirmedOrderIds: [soIdA],
        transRegistration: truckPlate,
        pickupDueDate,
        idempotencyKey,
      }),
    });
    const replayData = await replayRes.json();
    assert.equal(replayRes.status, 200, `Replay must succeed 200: ${JSON.stringify(replayData)}`);
    assert.equal(replayData.isIdempotent, true, 'Replay with same payload must return isIdempotent: true');
    assert.equal(Number(replayData.residualTripId), Number(residualTripId));

    // Step C: Send request with SAME idempotencyKey but DIFFERENT payload -> 400 Bad Request
    const conflictRes = await fetch(`${baseUrl}/api/trips/${testTripId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sales1Token}` },
      body: JSON.stringify({
        confirmedOrderIds: [soIdA],
        transRegistration: '70-DIFFERENT', // Different truck plate
        pickupDueDate,
        idempotencyKey,
      }),
    });
    assert.equal(conflictRes.status, 400, 'Same idempotency key with different payload must be rejected');
    const conflictData = await conflictRes.json();
    assert.match(conflictData.message, /Idempotency key/);

  } finally {
    await runRemote(async () => {
      await assertTestDatabase();
      if (soIdA) await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: soIdA } }).catch(() => {});
      if (soIdB) await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: soIdB } }).catch(() => {});
      if (residualTripId) await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @id`, { id: { type: sql.Int, value: residualTripId } }).catch(() => {});
      if (testTripId) await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId = @id`, { id: { type: sql.Int, value: testTripId } }).catch(() => {});
    });
    await stopTestServer();
  }
});

test.after(async () => {
  await stopTestServer();
  for (const p of Object.values(pools)) {
    try { (await p.readerPool).close(); } catch (_) {}
    try { (await p.ownerPool).close(); } catch (_) {}
  }
});
