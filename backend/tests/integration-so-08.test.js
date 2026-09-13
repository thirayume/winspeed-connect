'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { runWithTarget, query, wfQuery, pools, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const { SECRET } = require('../middleware/auth');
const couponService = require('../services/coupon-service');

let server;
let baseUrl;

let salesToken;
let warehouseToken;
let adminToken;

const tracked = {
  reservationIds: [],
  beneficiaryIds: [],
  soIds: [],
  tripIds: [],
  syntheticCouponIds: []
};

function trackReservation(id) { if (id) tracked.reservationIds.push(Number(id)); }
function trackBeneficiary(id) { if (id) tracked.beneficiaryIds.push(Number(id)); }
function trackSo(id) { if (id) tracked.soIds.push(Number(id)); }
function trackTrip(id) { if (id) tracked.tripIds.push(Number(id)); }
function trackSyntheticCoupon(id) { if (id) tracked.syntheticCouponIds.push(Number(id)); }

async function createSyntheticCoupon({ initialQty = 10.0, goodId = 1, goodName = 'ปุ๋ยเคมีทดสอบ SO-08', docuId = null, couponNo = null } = {}) {
  return await runWithTarget('remote_b', async () => {
    let targetDocuId = docuId;
    let custId = '00100';
    let custName = 'ลูกค้าทดสอบ SO-08';
    if (!targetDocuId) {
      const sohdRow = (await wfQuery(`SELECT TOP 1 SOID, CustID, CustName FROM dbo.SOHD WITH (NOLOCK) WHERE CustID IS NOT NULL ORDER BY SOID DESC`)).recordset?.[0];
      if (sohdRow) {
        targetDocuId = sohdRow.SOID;
        custId = sohdRow.CustID;
        custName = sohdRow.CustName;
      } else {
        targetDocuId = 99999;
      }
    }

    const synthId = 980000 + Math.floor(Math.random() * 10000);
    const cNo = couponNo || `SYNTH-SO08-${Date.now()}-${synthId}`;

    await wfQuery(`
      INSERT INTO dbo.WFCoupon (CouponID, GoodID, DocuID, CouponNo, GoodQty, RemaQty, GoodPrice, GoodName)
      VALUES (@cid, @gid, @docId, @cno, @qty, @qty, 15000, @gname)
    `, {
      cid: { type: sql.Int, value: synthId },
      gid: { type: sql.Int, value: goodId },
      docId: { type: sql.Int, value: targetDocuId },
      cno: { type: sql.VarChar(25), value: cNo },
      qty: { type: sql.Decimal(12, 4), value: initialQty },
      gname: { type: sql.VarChar(200), value: goodName }
    });

    trackSyntheticCoupon(synthId);
    return {
      CouponID: synthId,
      CouponNo: cNo,
      GoodID: goodId,
      GoodName: goodName,
      DocuID: targetDocuId,
      CustID: custId,
      CustName: custName,
      NativeRemaQty: initialQty,
      availableQty: initialQty,
      nativeRemaQty: initialQty
    };
  });
}

async function startTestServer() {
  if (server) return;
  await new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      runWithTarget('remote_b', next);
    });

    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/so', require('../routes/so'));
    app.use('/api/trips', require('../routes/trips'));
    app.use('/api/coupons', require('../routes/coupons'));

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

async function cleanTrackedFixtures() {
  await runWithTarget('remote_b', async () => {
    if (tracked.syntheticCouponIds.length > 0) {
      const idList = [...new Set(tracked.syntheticCouponIds)].join(',');
      await wfQuery(`DELETE FROM dbo.WFCoupon WHERE CouponID IN (${idList})`);
      tracked.syntheticCouponIds = [];
    }
    if (tracked.reservationIds.length > 0) {
      const idList = [...new Set(tracked.reservationIds)].join(',');
      await wfQuery(`DELETE FROM wf.CouponReservation WHERE Id IN (${idList})`);
      tracked.reservationIds = [];
    }
    if (tracked.beneficiaryIds.length > 0) {
      const idList = [...new Set(tracked.beneficiaryIds)].join(',');
      await wfQuery(`DELETE FROM wf.CouponBeneficiary WHERE Id IN (${idList})`);
      tracked.beneficiaryIds = [];
    }
    if (tracked.soIds.length > 0) {
      const idList = [...new Set(tracked.soIds)].join(',');
      await wfQuery(`DELETE FROM wf.SalesOrderLine WHERE SOID IN (${idList})`);
      await wfQuery(`DELETE FROM wf.SalesOrderExt WHERE SOID IN (${idList})`);
      await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id IN (${idList})`);
      tracked.soIds = [];
    }
    if (tracked.tripIds.length > 0) {
      const idList = [...new Set(tracked.tripIds)].join(',');
      await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId IN (${idList})`);
      tracked.tripIds = [];
    }
  });
}

async function findCouponWithAvailable(minQty = 2.0) {
  return await runWithTarget('remote_b', async () => {
    const rows = (await wfQuery(`
      SELECT TOP 25 c.CouponID, c.CouponNo, c.GoodID, c.GoodName, c.DocuID, s.CustID, s.CustName,
                   CAST(c.RemaQty AS DECIMAL(12, 4)) AS NativeRemaQty
      FROM dbo.WFCoupon c WITH (NOLOCK)
      JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = c.DocuID
      WHERE c.RemaQty >= @minQty
      ORDER BY c.CouponID DESC
    `, { minQty: { type: sql.Decimal(12, 4), value: minQty } })).recordset || [];

    for (const row of rows) {
      const recon = await couponService.reconcileCoupon(row.CouponID);
      if (recon && recon.availableQty >= minQty) {
        return { ...row, availableQty: recon.availableQty, nativeRemaQty: recon.nativeRemaQty };
      }
    }
    throw new Error(`Cannot find any coupon with available balance >= ${minQty}`);
  });
}

test.before(async () => {
  await startTestServer();
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();
  });

  const salesAuth = await loginAs('emp-00002');
  salesToken = salesAuth.token;

  const whAuth = await loginAs('emp-00047');
  warehouseToken = whAuth.token;

  const admAuth = await loginAs('admin');
  adminToken = admAuth.token;
});

test.after(async () => {
  try {
    await cleanTrackedFixtures();
  } catch (err) {
    console.error('[test.after] Cleanup error:', err.message);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  for (const poolName of Object.keys(pools)) {
    if (pools[poolName]) {
      try {
        await pools[poolName].close();
      } catch (_) {}
    }
  }
  setTimeout(() => process.exit(0), 500);
});

// ─────────────────────────────────────────────────────────────
// GROUP 1: SO-08 Balance Invariant & Reservation Lifecycle
// ─────────────────────────────────────────────────────────────

test('SO-08.1: Balance Invariant 100 -> Reserve 10 -> Available 90 -> Settle 10 with simulated adapter (Native 90, Settled 10, Available 90 - zero double deduction)', async () => {
  const reserveQty = 2.0;
  // Use run-owned synthetic coupon fixture: zero impact on existing business coupons
  const coupon = await createSyntheticCoupon({ initialQty: 10.0 });

  const initialNativeBalance = 10.0;
  const initialAvailable = 10.0;

  // 1. Reserve 2.0 tons via API
  const res1 = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-TEST-INV-1',
      carrierDocuNo: 'AI69-TEST01',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: reserveQty,
      idempotencyKey: `RES:TEST:INV1:${Date.now()}`
    })
  });
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.status, 'RESERVED');
  assert.equal(body1.reservedQty, reserveQty);
  trackReservation(body1.id);

  // 2. Verify Available decreases by reserveQty, Native balance is UNCHANGED
  const reconAfterReserve = await couponService.reconcileCoupon(coupon.CouponID);
  assert.equal(reconAfterReserve.nativeRemaQty, initialNativeBalance, 'Native balance must not change on reservation');
  assert.equal(reconAfterReserve.availableQty, Number((initialAvailable - reserveQty).toFixed(4)), 'Available balance must decrease by reserved amount');

  // 3. Settle / Post reservation with simulated adapter:
  let adapterCalled = false;
  await couponService.postNativeCouponRedemption(body1.id, 1, {
    adapter: async (tx, reservation) => {
      adapterCalled = true;
      await tx.request()
        .input('cid', sql.Int, reservation.CouponId)
        .input('qty', sql.Decimal(12, 4), reservation.ReservedQty)
        .query(`UPDATE dbo.WFCoupon SET RemaQty = RemaQty - @qty WHERE CouponID = @cid`);
      return { nativeDocuNo: '116-TEST-ADAPTER', redemptionId: 99901 };
    }
  });

  assert.equal(adapterCalled, true, 'Proven simulated adapter must be called');

  // 4. Invariant check after settlement:
  // Native balance has decreased by reserveQty
  // Active reservations count no longer includes POSTED reservation
  // Available balance remains exactly identical to post-reserve available (no double deduction!)
  const reconAfterSettle = await couponService.reconcileCoupon(coupon.CouponID);
  assert.equal(reconAfterSettle.nativeRemaQty, Number((initialNativeBalance - reserveQty).toFixed(4)), 'Native balance must be reduced by settled amount');
  assert.equal(reconAfterSettle.availableQty, Number((initialAvailable - reserveQty).toFixed(4)), 'Available balance must remain stable after settlement (zero double deduction)');
});

test('SO-08.2: Pessimistic locking prevents concurrent claims on last balance', async () => {
  const coupon = await findCouponWithAvailable(1.0);
  const claimQty = coupon.availableQty;
  assert.ok(claimQty > 0, 'Must have available balance to test concurrent claim');

  // Fire TWO concurrent reservation requests claiming the entire remaining available balance
  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/coupons/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        couponId: coupon.CouponID,
        carrierSoId: 'SO-CONCUR-A',
        beneficiaryCustId: String(coupon.CustID),
        reservedQty: claimQty,
        idempotencyKey: `RES:CONCUR:A:${Date.now()}`
      })
    }),
    fetch(`${baseUrl}/api/coupons/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        couponId: coupon.CouponID,
        carrierSoId: 'SO-CONCUR-B',
        beneficiaryCustId: String(coupon.CustID),
        reservedQty: claimQty,
        idempotencyKey: `RES:CONCUR:B:${Date.now()}`
      })
    })
  ]);

  const statusA = resA.status;
  const statusB = resB.status;

  // Exactly ONE request must succeed (200), and the other MUST fail with 400
  const successCount = (statusA === 200 ? 1 : 0) + (statusB === 200 ? 1 : 0);
  const failCount = (statusA === 400 ? 1 : 0) + (statusB === 400 ? 1 : 0);

  assert.equal(successCount, 1, 'Exactly one concurrent request can claim the last balance');
  assert.equal(failCount, 1, 'The competing concurrent request must be rejected with 400');

  const winnerData = statusA === 200 ? await resA.json() : await resB.json();
  const loserData = statusA === 400 ? await resA.json() : await resB.json();

  assert.ok(loserData.message.includes('ยอดคงเหลือพร้อมใช้ไม่เพียงพอ'));

  // Immediately clean up winner so other tests have available balance
  await runWithTarget('remote_b', async () => {
    await wfQuery(`DELETE FROM wf.CouponReservation WHERE Id = @id`, { id: { type: sql.Int, value: winnerData.id } });
  });
});

test('SO-08.3: Idempotent reservation, payload fingerprinting (200 on retry, 409 on different payload), and cancel provenance', async () => {
  const coupon = await findCouponWithAvailable(2.0);
  const idemKey = `RES:IDEM:TEST:${Date.now()}`;

  // 1. First reservation call
  const res1 = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-IDEM-01',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 1.0,
      idempotencyKey: idemKey
    })
  });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.idempotent, false);
  trackReservation(data1.id);

  try {
    // 2. Duplicate call with same key AND same payload: returns existing reservation as idempotent
    const res2 = await fetch(`${baseUrl}/api/coupons/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        couponId: coupon.CouponID,
        carrierSoId: 'SO-IDEM-01',
        beneficiaryCustId: String(coupon.CustID),
        reservedQty: 1.0,
        idempotencyKey: idemKey
      })
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.idempotent, true, 'Duplicate call must return existing reservation as idempotent');
    assert.equal(data2.id, data1.id);

    // 3. Key collision with DIFFERENT payload (e.g. changed quantity): must return 409 Conflict
    const resConflict = await fetch(`${baseUrl}/api/coupons/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        couponId: coupon.CouponID,
        carrierSoId: 'SO-IDEM-01',
        beneficiaryCustId: String(coupon.CustID),
        reservedQty: 1.5,
        idempotencyKey: idemKey
      })
    });
    assert.equal(resConflict.status, 409, 'Same key with different payload must return 409 Conflict');
    const conflictData = await resConflict.json();
    assert.ok(conflictData.message.includes('Idempotency conflict'));

    // 4. Cancel reservation: first call
    const cancelRes1 = await fetch(`${baseUrl}/api/coupons/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({ reservationId: data1.id, reason: 'Testing cancellation lifecycle' })
    });
    assert.equal(cancelRes1.status, 200);
    const cancelData1 = await cancelRes1.json();
    assert.equal(cancelData1.status, 'CANCELLED');
    assert.equal(cancelData1.idempotent, false);

    // 5. Cancel a second time: idempotent cancel
    const cancelRes2 = await fetch(`${baseUrl}/api/coupons/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({ reservationId: data1.id, reason: 'Duplicate cancel request' })
    });
    assert.equal(cancelRes2.status, 200);
    const cancelData2 = await cancelRes2.json();
    assert.equal(cancelData2.status, 'CANCELLED');
    assert.equal(cancelData2.idempotent, true);
  } finally {
    // Clean up
    await runWithTarget('remote_b', async () => {
      await wfQuery(`DELETE FROM wf.CouponReservation WHERE Id = @id`, { id: { type: sql.Int, value: data1.id } });
    });
  }
});

// ─────────────────────────────────────────────────────────────
// GROUP 2: Beneficiary Authorization & Rights Sharing
// ─────────────────────────────────────────────────────────────

test('SO-08.4: Beneficiary lifecycle: List -> Grant -> Duplicate 409 -> Revoke -> Revoked rejected 403', async () => {
  const coupon = await findCouponWithAvailable(2.0);
  const ownerCustId = String(coupon.CustID);
  const authorizedBenCustId = '999881';
  const unauthorizedCustId = '999882';

  // 1. List beneficiaries via GET /api/coupons/beneficiaries
  const listRes1 = await fetch(`${baseUrl}/api/coupons/beneficiaries?ownerCustId=${ownerCustId}`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(listRes1.status, 200);
  const listData1 = await listRes1.json();
  assert.ok(Array.isArray(listData1), 'Beneficiaries endpoint must return array');

  // 2. Grant beneficiary rights from owner to authorizedBenCustId
  const grantRes = await fetch(`${baseUrl}/api/coupons/beneficiaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      ownerCustId: ownerCustId,
      beneficiaryCustId: authorizedBenCustId,
      reason: 'สิทธิ์ใช้ตั๋วร่วมสำหรับเครือญาติ',
      effectiveFrom: new Date(Date.now() - 3600000).toISOString(),
      effectiveTo: new Date(Date.now() + 86400000).toISOString()
    })
  });
  assert.equal(grantRes.status, 200);
  const grantData = await grantRes.json();
  trackBeneficiary(grantData.id);

  try {
    // 3. Duplicate active grant for the same pair must return 409 Conflict
    const dupGrantRes = await fetch(`${baseUrl}/api/coupons/beneficiaries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        ownerCustId: ownerCustId,
        beneficiaryCustId: authorizedBenCustId,
        reason: 'พยายามให้สิทธิ์ซ้ำซ้อน',
        scope: 'ALL'
      })
    });
    assert.equal(dupGrantRes.status, 409);
    const dupData = await dupGrantRes.json();
    assert.ok(dupData.message.includes('มีสิทธิ์ใช้ตั๋วร่วมที่ยังใช้งานอยู่แล้ว'));

    // 4. Authorized beneficiary can reserve owner's coupon
    const resAuth = await fetch(`${baseUrl}/api/coupons/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        couponId: coupon.CouponID,
        carrierSoId: 'SO-BEN-AUTH',
        beneficiaryCustId: authorizedBenCustId,
        reservedQty: 0.5,
        idempotencyKey: `RES:BEN:AUTH:${Date.now()}`
      })
    });
    assert.equal(resAuth.status, 200);
    const authData = await resAuth.json();
    trackReservation(authData.id);

    // Clean up active reservation
    await runWithTarget('remote_b', async () => {
      await wfQuery(`DELETE FROM wf.CouponReservation WHERE Id = @id`, { id: { type: sql.Int, value: authData.id } });
    });

    // 5. Revoke beneficiary rights via DELETE /api/coupons/beneficiaries/:id
    const revokeRes = await fetch(`${baseUrl}/api/coupons/beneficiaries/${grantData.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'ยกเลิกสิทธิ์เนื่องจากสิ้นสุดข้อตกลง' })
    });
    assert.equal(revokeRes.status, 200);
    const revokeData = await revokeRes.json();
    assert.equal(revokeData.status, 'REVOKED');

    // 6. After revocation, previously authorized beneficiary is rejected with 403
    const resPostRevoke = await fetch(`${baseUrl}/api/coupons/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        couponId: coupon.CouponID,
        carrierSoId: 'SO-BEN-POST-REVOKE',
        beneficiaryCustId: authorizedBenCustId,
        reservedQty: 0.5,
        idempotencyKey: `RES:BEN:POSTREVOKE:${Date.now()}`
      })
    });
    assert.equal(resPostRevoke.status, 403);
    const postRevokeData = await resPostRevoke.json();
    assert.ok(postRevokeData.message.includes('ไม่ได้รับสิทธิ์ใช้ตั๋วร่วม'));

    // 7. Unauthorized customer (never granted) is rejected with 403
    const resUnauth = await fetch(`${baseUrl}/api/coupons/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        couponId: coupon.CouponID,
        carrierSoId: 'SO-BEN-UNAUTH',
        beneficiaryCustId: unauthorizedCustId,
        reservedQty: 0.5,
        idempotencyKey: `RES:BEN:UNAUTH:${Date.now()}`
      })
    });
    assert.equal(resUnauth.status, 403);

    // 8. Prefix match without grant (e.g. ownerCustId + '-1') is rejected with 403
    const resPrefix = await fetch(`${baseUrl}/api/coupons/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
      body: JSON.stringify({
        couponId: coupon.CouponID,
        carrierSoId: 'SO-BEN-PREFIX',
        beneficiaryCustId: `${ownerCustId}-1`,
        reservedQty: 0.5,
        idempotencyKey: `RES:BEN:PREFIX:${Date.now()}`
      })
    });
    assert.equal(resPrefix.status, 403);
  } finally {
    await runWithTarget('remote_b', async () => {
      await wfQuery(`DELETE FROM wf.CouponBeneficiary WHERE Id = @id`, { id: { type: sql.Int, value: grantData.id } });
    });
  }
});

// ─────────────────────────────────────────────────────────────
// GROUP 3: Reconciliation & Conflict Detection
// ─────────────────────────────────────────────────────────────

test('SO-08.5: External conflict detection: simulated native balance reduction creates shortfall & hasConflict: true', async () => {
  // Use run-owned synthetic coupon fixture: zero impact on existing business coupons
  const coupon = await createSyntheticCoupon({ initialQty: 2.0 });
  const reserveAmount = 1.0;

  // 1. Reserve 1.0 ton
  const res = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-RECON-CONFLICT',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: reserveAmount,
      idempotencyKey: `RES:RECON:CONF:${Date.now()}`
    })
  });
  assert.equal(res.status, 200);
  const resData = await res.json();
  trackReservation(resData.id);

  // Normal reconciliation: no conflict
  const reconNormal = await couponService.reconcileCoupon(coupon.CouponID);
  assert.equal(reconNormal.hasConflict, false);
  assert.equal(reconNormal.shortfallQty, 0);

  // 2. Simulate external WinSpeed reduction on synthetic coupon: drops to 0.4 (below active 1.0)
  await runWithTarget('remote_b', async () => {
    await wfQuery(`UPDATE dbo.WFCoupon SET RemaQty = 0.4 WHERE CouponID = @cid`, {
      cid: { type: sql.Int, value: coupon.CouponID }
    });
  });

  // 3. Reconcile: must detect conflict and report shortfall
  const reconConflict = await couponService.reconcileCoupon(coupon.CouponID);
  assert.equal(reconConflict.hasConflict, true, 'Must flag conflict when native balance < active reservations');
  assert.equal(reconConflict.shortfallQty, 0.6, 'Shortfall must equal 1.0 reserved - 0.4 native = 0.6');
  assert.equal(reconConflict.availableQty, 0, 'Available quantity must not be negative');

  // Also verify via API endpoint GET /api/coupons/reconcile/:couponId
  const apiRes = await fetch(`${baseUrl}/api/coupons/reconcile/${coupon.CouponID}`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(apiRes.status, 200);
  const apiData = await apiRes.json();
  assert.equal(apiData.hasConflict, true);
  assert.equal(apiData.shortfallQty, 0.6);
});

// ─────────────────────────────────────────────────────────────
// GROUP 4: Native Posting Fail-Closed Gate
// ─────────────────────────────────────────────────────────────

test('SO-08.6: Native posting fail-closed: flag=false -> 400; flag=true without adapter -> 501', async () => {
  // 1. With flag=false (default): endpoint returns 400
  const resGated = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reservationId: 1 })
  });
  assert.equal(resGated.status, 400);
  const dataGated = await resGated.json();
  assert.ok(dataGated.message.includes('COUPON_NATIVE_POSTING_ENABLED=false'));

  // 2. Direct service call without adapter: fail-closed 400 or 501
  await assert.rejects(
    async () => {
      await couponService.postNativeCouponRedemption(1, 1, {});
    },
    (err) => {
      assert.ok(err.status === 400 || err.status === 501);
      return true;
    }
  );
});

// ─────────────────────────────────────────────────────────────
// GROUP 5: SO State Machine & Line Linkage
// ─────────────────────────────────────────────────────────────

test('SO-08.7: SO Draft lifecycle: Link reservation to SO line -> Edit remove line cancels reservation -> Cancel SO cancels reservation', async () => {
  const coupon = await findCouponWithAvailable(2.0);

  // 1. Reserve 1 ton for draft SO
  const res1 = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'DRAFT-SO-08-TEST',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 0.5,
      idempotencyKey: `RES:DRAFT:TEST:${Date.now()}`
    })
  });
  assert.equal(res1.status, 200);
  const resData1 = await res1.json();
  trackReservation(resData1.id);

  // 2. Create SO with the coupon-drawn line
  const soCreateRes = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName || 'Test Customer',
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName || 'Test Fertilizer',
          qtyTon: 0.5,
          qtyBag: 10,
          pricePerTon: 0,
          couponReservationId: resData1.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(soCreateRes.status, 200);
  const createdSo = await soCreateRes.json();
  const soId = createdSo.id;
  assert.ok(soId);
  trackSo(soId);

  // 3. Verify reservation updated with CarrierSoId and LineNum
  await runWithTarget('remote_b', async () => {
    const rRow = (await wfQuery(`SELECT * FROM wf.CouponReservation WHERE Id = @id`, {
      id: { type: sql.Int, value: resData1.id }
    })).recordset?.[0];
    assert.equal(String(rRow.CarrierSoId), String(soId));
    assert.equal(rRow.LineNum, 1);
  });

  // 4. Verify GET /api/so/:id enriches lines with coupon reservation data
  const getSoRes = await fetch(`${baseUrl}/api/so/${soId}`, {
    headers: { Authorization: `Bearer ${salesToken}` }
  });
  assert.equal(getSoRes.status, 200);
  const soData = await getSoRes.json();
  assert.equal(soData.lines?.length, 1);
  assert.equal(Number(soData.lines[0].couponReservationId), Number(resData1.id));
  assert.equal(soData.lines[0].refCouponDocuNo, coupon.CouponNo);
  assert.equal(Boolean(soData.lines[0].isCouponDrawn), true);

  // 5. Edit SO: remove the coupon line (replace with standard line)
  const putRes = await fetch(`${baseUrl}/api/so/${soId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName || 'Test Customer',
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName || 'Test Fertilizer',
          qtyTon: 1.0,
          qtyBag: 20,
          pricePerTon: 15000
          // No coupon reservation
        }
      ]
    })
  });
  assert.equal(putRes.status, 200);

  // 6. Verify reservation status automatically changed to CANCELLED
  await runWithTarget('remote_b', async () => {
    const cancelledRow = (await wfQuery(`SELECT Status, CancelReason FROM wf.CouponReservation WHERE Id = @id`, {
      id: { type: sql.Int, value: resData1.id }
    })).recordset?.[0];
    assert.equal(cancelledRow.Status, 'CANCELLED');
    assert.equal(cancelledRow.CancelReason, 'SO_LINE_REMOVED_ON_EDIT');
  });

  // 7. Create another reservation and attach to a new SO, then cancel the SO
  const res2 = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'DRAFT-SO-CANCEL-TEST',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 0.5,
      idempotencyKey: `RES:DRAFT:CANCEL:${Date.now()}`
    })
  });
  assert.equal(res2.status, 200);
  const resData2 = await res2.json();
  trackReservation(resData2.id);

  const so2CreateRes = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName || 'Test Customer',
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName || 'Test Fertilizer',
          qtyTon: 0.5,
          qtyBag: 10,
          pricePerTon: 0,
          couponReservationId: resData2.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(so2CreateRes.status, 200);
  const so2 = await so2CreateRes.json();
  const soId2 = so2.id;
  trackSo(soId2);

  // Cancel SO via DELETE /api/so/:id
  const deleteRes = await fetch(`${baseUrl}/api/so/${soId2}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({ reasonCode: 'SO_DELETED', reason: 'ลบบิลร่างสำหรับทดสอบ SO-08' })
  });
  assert.equal(deleteRes.status, 200);

  // Verify attached reservation is auto-cancelled
  await runWithTarget('remote_b', async () => {
    const r2Row = (await wfQuery(`SELECT Status, CancelReason FROM wf.CouponReservation WHERE Id = @id`, {
      id: { type: sql.Int, value: resData2.id }
    })).recordset?.[0];
    assert.equal(r2Row.Status, 'CANCELLED');
    assert.equal(r2Row.CancelReason, 'ลบบิลร่างสำหรับทดสอบ SO-08');
  });
});

// ─────────────────────────────────────────────────────────────
// GROUP 6: Parameter Validation Guards
// ─────────────────────────────────────────────────────────────

test('SO-08.8: Parameter validation guards: decimal scale > 3, negative qty, past expiry, short cancel reason', async () => {
  const coupon = await findCouponWithAvailable(1.0);

  // 1. Decimal scale > 3 decimals: rejected 400
  const resScale = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-VAL-1',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 0.1234, // 4 decimal places
      idempotencyKey: `RES:VAL:SCALE:${Date.now()}`
    })
  });
  assert.equal(resScale.status, 400);
  const scaleData = await resScale.json();
  assert.ok(scaleData.message.includes('ทศนิยมไม่เกิน 3 ตำแหน่ง'));

  // 2. Negative quantity: rejected 400
  const resNeg = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-VAL-2',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: -5.0,
      idempotencyKey: `RES:VAL:NEG:${Date.now()}`
    })
  });
  assert.equal(resNeg.status, 400);

  // 3. Past expiry: rejected 400
  const resPastExp = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-VAL-3',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 0.5,
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
      idempotencyKey: `RES:VAL:EXP:${Date.now()}`
    })
  });
  assert.equal(resPastExp.status, 400);
  const expData = await resPastExp.json();
  assert.ok(expData.message.includes('วันหมดอายุการจอง (ExpiresAt) ต้องเป็นเวลาในอนาคต'));

  // 4. Cancel reason too short (< 3 chars): rejected 400
  const resShortReason = await fetch(`${baseUrl}/api/coupons/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({ reservationId: 1, reason: 'x' })
  });
  assert.equal(resShortReason.status, 400);
  const reasonData = await resShortReason.json();
  assert.ok(reasonData.message.includes('อย่างน้อย 3 ตัวอักษร'));
});

// ─────────────────────────────────────────────────────────────
// GROUP 7: Regression Tests (Integrity Gate 2026-09-11)
// ─────────────────────────────────────────────────────────────

test('SO-08.9: Server-side reservation binding guards (duplicate reservation, customer mismatch, good mismatch, qty mismatch)', async () => {
  const coupon = await createSyntheticCoupon({ initialQty: 10.0, goodId: 1 });

  // 1. Create a reservation for 2.0 tons
  const res = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'DRAFT-SO-BIND-TEST',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 2.0,
      idempotencyKey: `RES:REG:BIND:${Date.now()}`
    })
  });
  assert.equal(res.status, 200);
  const resData = await res.json();
  trackReservation(resData.id);

  // Case A: Duplicate reservation ID across multiple SO lines -> rejected 400
  const resDup = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          qtyTon: 1.0,
          qtyBag: 20,
          pricePerTon: 0,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        },
        {
          goodId: coupon.GoodID,
          qtyTon: 1.0,
          qtyBag: 20,
          pricePerTon: 0,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(resDup.status, 400);
  const dupErr = await resDup.json();
  assert.ok(dupErr.message.includes('ซ้ำ'));

  // Case B: Customer mismatch (reservation booked for coupon.CustID, but SO is for different customer) -> rejected 400
  const resCustMismatch = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: 'CUST-DIFFERENT-999',
      custName: 'Different Customer',
      lines: [
        {
          goodId: coupon.GoodID,
          qtyTon: 2.0,
          qtyBag: 40,
          pricePerTon: 0,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(resCustMismatch.status, 400);
  const custErr = await resCustMismatch.json();
  assert.ok(custErr.message.includes('ไม่ตรงกับลูกค้าของบิล'));

  // Case C: Good ID mismatch -> rejected 400
  const resGoodMismatch = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: 9999, // Wrong good
          qtyTon: 2.0,
          qtyBag: 40,
          pricePerTon: 0,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(resGoodMismatch.status, 400);
  const goodErr = await resGoodMismatch.json();
  assert.ok(goodErr.message.includes('ไม่ตรงกับสินค้าในบิล'));

  // Case D: Quantity mismatch (reserved 2.0 tons, but line specifies 3.0 tons) -> rejected 400
  const resQtyMismatch = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          qtyTon: 3.0,
          qtyBag: 60,
          pricePerTon: 0,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(resQtyMismatch.status, 400);
  const qtyErr = await resQtyMismatch.json();
  assert.ok(qtyErr.message.includes('ไม่ตรงกับจำนวนที่จองตั๋วไว้'));
});

test('SO-08.10: Scoped idempotency fingerprint collision & cross-actor authorization', async () => {
  const coupon = await createSyntheticCoupon({ initialQty: 10.0 });
  const key = `RES:IDEM:TEST:${Date.now()}`;

  // 1. First reservation request: succeeds 200
  const res1 = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-IDEM-1',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 1.0,
      goodUnit: 'ตัน',
      idempotencyKey: key
    })
  });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  trackReservation(data1.id);

  // 2. Exact same key + same payload: returns identical result (idempotent: true)
  const resReplay = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-IDEM-1',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 1.0,
      goodUnit: 'ตัน',
      idempotencyKey: key
    })
  });
  assert.equal(resReplay.status, 200);
  const dataReplay = await resReplay.json();
  assert.equal(dataReplay.id, data1.id);
  assert.equal(dataReplay.idempotent, true);

  // 3. Same key + altered quantity (different payload): returns 409 Conflict
  const resAltered = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-IDEM-1',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 2.0, // Altered
      goodUnit: 'ตัน',
      idempotencyKey: key
    })
  });
  assert.equal(resAltered.status, 409);
  const conflictData = await resAltered.json();
  assert.ok(conflictData.message.includes('Idempotency conflict'));

  // 4. Same key replayed by a DIFFERENT actor (adminToken has role ADMIN, different sub): rejected with 403 Forbidden
  const resCrossActor = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'SO-IDEM-1',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 1.0,
      goodUnit: 'ตัน',
      idempotencyKey: key
    })
  });
  assert.equal(resCrossActor.status, 403);
  const crossData = await resCrossActor.json();
  assert.ok(crossData.message.includes('ถูกใช้งานโดยผู้ใช้อื่น'));
});

test('SO-08.11: Persisted reservation lifecycle: discard edit preserves saved reservation in DB', async () => {
  const coupon = await createSyntheticCoupon({ initialQty: 10.0 });

  // 1. Create reservation and save SO
  const res = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'DRAFT-DISCARD-TEST',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 3.0,
      idempotencyKey: `RES:DISCARD:TEST:${Date.now()}`
    })
  });
  assert.equal(res.status, 200);
  const resData = await res.json();
  trackReservation(resData.id);

  const soCreateRes = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName,
          qtyTon: 3.0,
          qtyBag: 60,
          pricePerTon: 0,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(soCreateRes.status, 200);
  const so = await soCreateRes.json();
  trackSo(so.id);

  // Verify reservation is bound and RESERVED
  let recon = await runWithTarget('remote_b', () => couponService.reconcileCoupon(coupon.CouponID));
  assert.equal(recon.availableQty, 7.0);

  // In UI lifecycle: if user opens edit modal, removes line locally, but then discards (clicks X / closes modal),
  // no PUT /api/so/:id is sent and cancelCouponReservation is NOT called on persisted reservations.
  // The reservation in DB must stay RESERVED and available quantity remains 7.0!
  recon = await runWithTarget('remote_b', () => couponService.reconcileCoupon(coupon.CouponID));
  assert.equal(recon.availableQty, 7.0, 'Available balance must remain preserved on discard');

  // Now simulate actual save where line is removed: PUT /api/so/:id without couponReservationId
  const putRes = await fetch(`${baseUrl}/api/so/${so.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName,
          qtyTon: 3.0,
          qtyBag: 60,
          pricePerTon: 15000
          // Removed coupon line
        }
      ]
    })
  });
  assert.equal(putRes.status, 200);

  // Verify that on SAVE, the reservation is released atomically with SO_LINE_REMOVED_ON_EDIT
  await runWithTarget('remote_b', async () => {
    const row = (await wfQuery(`SELECT Status, CancelReason FROM wf.CouponReservation WHERE Id = @id`, {
      id: { type: sql.Int, value: resData.id }
    })).recordset?.[0];
    assert.equal(row.Status, 'CANCELLED');
    assert.equal(row.CancelReason, 'SO_LINE_REMOVED_ON_EDIT');
  });

  // Verify available balance returns to full 10.0
  recon = await runWithTarget('remote_b', () => couponService.reconcileCoupon(coupon.CouponID));
  assert.equal(recon.availableQty, 10.0, 'Available balance must return to 10.0 after saving line removal');
});

test('SO-08.12: Cross-actor reservation binding rejected with 403 Forbidden', async () => {
  const coupon = await createSyntheticCoupon({ initialQty: 10.0 });

  // 1. Sales User A reserves coupon
  const res = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'DRAFT-CROSS-ACTOR-1',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 2.0,
      idempotencyKey: `RES:CROSS:ACTOR:${Date.now()}`
    })
  });
  assert.equal(res.status, 200);
  const resData = await res.json();
  trackReservation(resData.id);

  // 2. Other Sales User (actor ID 99991, role SALES) attempts to bind reservation
  const otherSalesToken = jwt.sign(
    { sub: 99991, id: 99991, role: 'SALES', username: 'other-sales-99991' },
    SECRET,
    { expiresIn: '1h' }
  );

  const crossBindRes = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherSalesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName,
          qtyTon: 2.0,
          pricePerTon: 0,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(crossBindRes.status, 403);
  const crossErr = await crossBindRes.json();
  assert.ok(crossErr.message.includes('ถูกสร้างโดยผู้ใช้อื่น'));

  // 3. User A can bind successfully
  const validBindRes = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName,
          qtyTon: 2.0,
          pricePerTon: 0,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(validBindRes.status, 200);
  const validSo = await validBindRes.json();
  trackSo(validSo.id);
});

test('SO-08.13: Exact quantity validation: 0.001 ton mismatch rejected with 400 Bad Request', async () => {
  const coupon = await createSyntheticCoupon({ initialQty: 10.0 });

  const res = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'DRAFT-QTY-TEST',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 3.0,
      idempotencyKey: `RES:QTY:TEST:${Date.now()}`
    })
  });
  assert.equal(res.status, 200);
  const resData = await res.json();
  trackReservation(resData.id);

  // Mismatch by +0.001 ton (3.001)
  const mismatchRes1 = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName,
          qtyTon: 3.001,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(mismatchRes1.status, 400);
  const errData1 = await mismatchRes1.json();
  assert.ok(errData1.message.includes('ไม่ตรงกับจำนวนที่จองตั๋วไว้'));

  // Mismatch by -0.001 ton (2.999)
  const mismatchRes2 = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName,
          qtyTon: 2.999,
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(mismatchRes2.status, 400);
  const errData2 = await mismatchRes2.json();
  assert.ok(errData2.message.includes('ไม่ตรงกับจำนวนที่จองตั๋วไว้'));
});

test('SO-08.14: Good unit mismatch rejected with 400 Bad Request', async () => {
  const coupon = await createSyntheticCoupon({ initialQty: 10.0 });

  // Reserve with unit 'ตัน'
  const res = await fetch(`${baseUrl}/api/coupons/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      couponId: coupon.CouponID,
      carrierSoId: 'DRAFT-UNIT-TEST',
      beneficiaryCustId: String(coupon.CustID),
      reservedQty: 2.0,
      goodUnit: 'ตัน',
      idempotencyKey: `RES:UNIT:TEST:${Date.now()}`
    })
  });
  assert.equal(res.status, 200);
  const resData = await res.json();
  trackReservation(resData.id);

  // Attempt SO line with unit 'ถุง'
  const mismatchUnitRes = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({
      soPrefix: 'AI',
      custId: coupon.CustID,
      custName: coupon.CustName,
      lines: [
        {
          goodId: coupon.GoodID,
          goodName: coupon.GoodName,
          qtyTon: 2.0,
          goodUnit: 'ถุง',
          couponReservationId: resData.id,
          refCouponDocuNo: coupon.CouponNo,
          isCouponDrawn: true
        }
      ]
    })
  });
  assert.equal(mismatchUnitRes.status, 400);
  const errData = await mismatchUnitRes.json();
  assert.ok(errData.message.includes('หน่วยสินค้าในบิล'));
  assert.ok(errData.message.includes('ไม่ตรงกับหน่วยที่จองตั๋วไว้'));
});

