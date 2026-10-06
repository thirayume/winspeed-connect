'use strict';

/**
 * integration-native-real-api.test.js
 *
 * Real Authenticated HTTP API Integration Regression Suite for Native 116 Writeback.
 * Addresses all findings in:
 * - docs/sale-app/qa/CODEX-NATIVE-INTEGRATION-REAUDIT-20260924.md (R1)
 * - docs/sale-app/qa/CODEX-NATIVE-SHARED-CONTEXT-R2-20260924.md (R2)
 * - docs/sale-app/qa/CODEX-NATIVE-UAT-R3-20260924.md (R3: R3-01 to R3-05)
 */

process.env.DB_MODE = 'remote_b';
process.env.ALLOW_TEST_NATIVE_WRITEBACK = 'true';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { runWithTarget, query, dboWrite, wfQuery, pools, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const { SECRET } = require('../middleware/auth');
const { reverseRedemptionDocument } = require('../services/redemption-native-adapter');

let server;
let baseUrl;
let warehouseToken;
let adminToken;
let managerToken;

// Keep RUN_ID and coupon/doc numbers strictly within WinSpeed schema limits (VARCHAR 25)
const RUN_ID = `U${Date.now().toString().slice(-6)}`;
const ownedCoupons = new Map(); // CouponID -> CouponNo
const ownedReservations = new Set(); // ReservationId
const ownedBeneficiaries = new Set(); // GrantId
const ownedNativeRedemptionIds = new Set(); // RedemtionID strictly created in dbo.WFRedemtionHD/DT
const ownedMirrorRecords = new Set(); // Set of { redemtionId, couponId }
const ownedWeighTickets = new Set(); // WeighTicket Id
const ownedAuditIds = new Set(); // audit_id
const ownedOverlayIds = new Set(); // OverlayId
const ownedScaleTickets = new Set(); // DocuNo in dbo.WGHD
const ownedTripIds = new Set(); // TripId in wf.SalesTrip
const ownedSalesOrderExt = new Set(); // SOID in wf.SalesOrderExt
let beforeImageCaptured = false;
let originalSettingExists = false;
let originalBlockExpiredValue = null; // can be string or null

async function restoreBlockExpiredSetting() {
  if (!beforeImageCaptured) return;
  if (!originalSettingExists) {
    await wfQuery(`DELETE FROM wf.SystemSetting WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`);
  } else if (originalBlockExpiredValue === null) {
    await wfQuery(`UPDATE wf.SystemSetting SET SettingValue = NULL WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`);
  } else {
    await wfQuery(`UPDATE wf.SystemSetting SET SettingValue = @val WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`, {
      val: { type: sql.VarChar(50), value: originalBlockExpiredValue },
    });
  }
}

async function wfQ(text, inputs = {}) {
  const res = await wfQuery(text, inputs);
  return res.recordset || [];
}

async function startServer() {
  if (server) return;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    runWithTarget('remote_b', next);
  });
  app.use('/api/coupons', require('../routes/coupons'));
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message, code: err.code });
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  warehouseToken = jwt.sign(
    { sub: 2, username: 'warehouse', role: 'WAREHOUSE', name: 'Warehouse Test' },
    SECRET,
    { expiresIn: '1h' }
  );

  adminToken = jwt.sign(
    { sub: 1, username: 'admin', role: 'ADMIN', name: 'Admin Test' },
    SECRET,
    { expiresIn: '1h' }
  );

  managerToken = jwt.sign(
    { sub: 3, username: 'manager', role: 'SALES_MANAGER', name: 'Sales Manager Test' },
    SECRET,
    { expiresIn: '1h' }
  );
}

async function cleanupOwnedEntities() {
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();

    // 1. Clean Native 116 records (ONLY native IDs specifically created by adapter writeback)
    if (ownedNativeRedemptionIds.size > 0) {
      const redList = Array.from(ownedNativeRedemptionIds).join(',');
      await wfQuery(`DELETE FROM wf.CouponRedemptionMirror WHERE RedemtionID IN (${redList})`);
      await query(`DELETE FROM dbo.WFRedemtionDT WHERE RedemtionID IN (${redList})`);
      await query(`DELETE FROM dbo.WFRedemtionHD WHERE RedemtionID IN (${redList})`);
    }

    // 1b. Clean Mirror records strictly by owned composite keys
    if (ownedMirrorRecords.size > 0) {
      for (const m of ownedMirrorRecords) {
        await wfQuery(`DELETE FROM wf.CouponRedemptionMirror WHERE RedemtionID = @rid AND CouponID = @cid`, {
          rid: { type: sql.Int, value: m.redemtionId },
          cid: { type: sql.Int, value: m.couponId },
        });
      }
    }

    // 1c. Clean WeighTickets strictly by owned IDs
    if (ownedWeighTickets.size > 0) {
      const wtList = Array.from(ownedWeighTickets).join(',');
      await wfQuery(`DELETE FROM wf.WeighTicket WHERE Id IN (${wtList})`);
    }

    if (ownedAuditIds.size > 0) {
      const auditList = Array.from(ownedAuditIds).join(',');
      await query(`DELETE FROM dbo.SMAudit WHERE audit_id IN (${auditList})`);
    }

    // 2. Clean scale tickets (dbo.WGHD)
    if (ownedScaleTickets.size > 0) {
      for (const dno of ownedScaleTickets) {
        await dboWrite(`DELETE FROM dbo.WGHD WHERE DocuNo = @dno`, {
          dno: { type: sql.NVarChar(50), value: dno },
        });
      }
    }

    // 3a. Clean owned SalesOrderExt first (to satisfy FK_SalesOrderExt_Trip)
    if (ownedSalesOrderExt.size > 0) {
      const soList = Array.from(ownedSalesOrderExt).map(x => `'${x}'`).join(',');
      await wfQuery(`DELETE FROM wf.SalesOrderExt WHERE SOID IN (${soList})`);
    }

    // 3b. Clean trips (wf.SalesTrip) - detach any remaining SOs before delete
    if (ownedTripIds.size > 0) {
      const tList = Array.from(ownedTripIds).join(',');
      await wfQuery(`UPDATE wf.SalesOrderExt SET TripId = NULL WHERE TripId IN (${tList})`);
      await wfQuery(`DELETE FROM wf.SalesTrip WHERE TripId IN (${tList})`);
    }

    // 4. Clean ChangeEvent audits
    if (ownedReservations.size > 0) {
      const rList = Array.from(ownedReservations).map(x => `'${x}'`).join(',');
      await wfQuery(`DELETE FROM wf.ChangeEvent WHERE EntityType = 'COUPON_POSTING' AND EntityId IN (${rList})`);
    }

    // 5. Clean reservations
    if (ownedReservations.size > 0) {
      const resList = Array.from(ownedReservations).join(',');
      await wfQuery(`DELETE FROM wf.CouponReservation WHERE Id IN (${resList})`);
    }

    // 6. Clean beneficiaries strictly by owned IDs (no broad prefix cleanup)
    if (ownedBeneficiaries.size > 0) {
      const benList = Array.from(ownedBeneficiaries).join(',');
      await wfQuery(`DELETE FROM wf.CouponBeneficiary WHERE Id IN (${benList})`);
    }

    // 7. Clean ControlTicketOverlay
    if (ownedOverlayIds.size > 0) {
      const oList = Array.from(ownedOverlayIds).join(',');
      await wfQuery(`DELETE FROM wf.ControlTicketOverlay WHERE Id IN (${oList})`);
    }

    // 8. Clean coupons with exact composite predicate
    for (const [cid, cno] of ownedCoupons.entries()) {
      await query(`DELETE FROM dbo.WFCoupon WHERE CouponID = @cid AND CouponNo = @cno`, {
        cid: { type: sql.Int, value: cid },
        cno: { type: sql.VarChar(25), value: cno },
      });
    }

    // Zero leftover verification
    for (const [cid] of ownedCoupons.entries()) {
      const check = await query(`SELECT COUNT(*) AS c FROM dbo.WFCoupon WHERE CouponID = @cid`, {
        cid: { type: sql.Int, value: cid },
      });
      assert.equal(check[0]?.c, 0, `Residual owned coupon ID ${cid} detected!`);
    }
  });
}

async function createOwnedCoupon(suffix, qty = 10, opts = {}) {
  return await runWithTarget('remote_b', async () => {
    const cno = `U-${suffix}-${RUN_ID}`.slice(0, 25);
    const idRes = await query(`SELECT ISNULL(MAX(CouponID), 0) + 1 AS NextID FROM dbo.WFCoupon WITH (UPDLOCK, HOLDLOCK)`);
    const cid = Number(idRes[0].NextID);
    const soid = opts.soid || 999999;

    await query(`
      INSERT INTO dbo.WFCoupon (
        CouponID, GoodID, InveID, LocaID, GoodUnitID, GoodPrice,
        DocuID, RefListno, Docutype, Listno, CouponNo, SONo,
        ContainQty, GoodQty, SackQty, RemaQty, GoodName
      ) VALUES (
        @cid, 1156, 1000, 1000, 1002, 15600.00,
        @soid, 1, '104', 1, @cno, 'SO-TEST-REAL-API',
        50, @qty, 200, @qty, '0-0-60 (เม็ด) TEST FIXTURE'
      )
    `, {
      cid: { type: sql.Int, value: cid },
      cno: { type: sql.VarChar(25), value: cno },
      qty: { type: sql.Decimal(12, 4), value: qty },
      soid: { type: sql.Int, value: soid },
    });

    ownedCoupons.set(cid, cno);
    return { cid, cno, qty, goodId: 1156, goodUnitId: 1002, soid };
  });
}

async function createOwnedScaleTicket(docuNo, carNo = '70-9999', soid = 999999, opts = {}) {
  return await runWithTarget('remote_b', async () => {
    const dno = String(docuNo).trim();
    let rawStatus = opts.status || 'IN';
    if (rawStatus === 'CANCEL' || rawStatus === 'CANCELLED') rawStatus = 'C';
    const status = String(rawStatus).slice(0, 2).toUpperCase();
    const weightIn = opts.weightIn !== undefined ? opts.weightIn : 15000;
    const dateIn = opts.dateIn !== undefined ? opts.dateIn : new Date();

    await dboWrite(`
      INSERT INTO dbo.WGHD (DocuNo, CarNo, WeightIn, DateIn, SPID, Status)
      VALUES (@dno, @cno, @win, @din, @spid, @status)
    `, {
      dno: { type: sql.NVarChar(50), value: dno },
      cno: { type: sql.NVarChar(50), value: carNo },
      win: { type: sql.Int, value: weightIn },
      din: { type: sql.DateTime, value: dateIn },
      spid: { type: sql.Int, value: soid },
      status: { type: sql.NVarChar(50), value: status },
    });

    ownedScaleTickets.add(dno);
    return { docuNo: dno, carNo, soid, status };
  });
}

async function createOwnedWeighTicket(movebill, truckPlate = '70-9999', soId = 999999, opts = {}) {
  return await runWithTarget('remote_b', async () => {
    const mb = String(movebill).trim();
    const plate = String(truckPlate).trim();
    const sid = Number(soId);
    const wfRef = opts.wfRef || null;
    const netKg = opts.netKg !== undefined ? opts.netKg : 15000;
    const grossKg = opts.grossKg !== undefined ? opts.grossKg : 25000;
    const tareKg = opts.tareKg !== undefined ? opts.tareKg : 10000;
    const status = opts.status || 'DONE';
    const win = opts.weighInAt !== undefined ? opts.weighInAt : new Date();

    const res = await wfQ(`
      INSERT INTO wf.WeighTicket (
        Movebill, TruckPlate, SoId, WfRef, NetKg, GrossKg, TareKg, Status, WeighInAt, CreatedAt
      ) OUTPUT INSERTED.Id VALUES (
        @mb, @plate, @so, @wfRef, @net, @gross, @tare, @status, @win, GETUTCDATE()
      )
    `, {
      mb: { type: sql.VarChar(50), value: mb },
      plate: { type: sql.VarChar(50), value: plate },
      so: { type: sql.Int, value: sid },
      wfRef: { type: sql.VarChar(50), value: wfRef },
      net: { type: sql.Decimal(12, 2), value: netKg },
      gross: { type: sql.Decimal(12, 2), value: grossKg },
      tare: { type: sql.Decimal(12, 2), value: tareKg },
      status: { type: sql.VarChar(50), value: status },
      win: { type: sql.DateTime2, value: win },
    });
    const id = res[0].Id;
    ownedWeighTickets.add(id);
    return { id, movebill: mb, truckPlate: plate, soId: sid };
  });
}

async function createOwnedTrip(truckPlate = '70-9999') {
  return await runWithTarget('remote_b', async () => {
    const tcode = `TRIP-${RUN_ID}-${Date.now().toString().slice(-4)}`;
    const res = await wfQ(`
      INSERT INTO wf.SalesTrip (TripCode, TruckCapacityTon, Status, TransRegistration, CreatedBy, CreatedAt)
      OUTPUT INSERTED.TripId, INSERTED.TripCode
      VALUES (@tcode, 30.0, 'SCHEDULED', @plate, 1, GETUTCDATE())
    `, {
      tcode: { type: sql.VarChar(50), value: tcode },
      plate: { type: sql.VarChar(50), value: truckPlate },
    });
    const tripId = res[0].TripId;
    ownedTripIds.add(tripId);
    return tripId;
  });
}

async function createOwnedTripWithCode(truckPlate = '70-9999') {
  return await runWithTarget('remote_b', async () => {
    const tcode = `TRIP-${RUN_ID}-${Date.now().toString().slice(-4)}`;
    const res = await wfQ(`
      INSERT INTO wf.SalesTrip (TripCode, TruckCapacityTon, Status, TransRegistration, CreatedBy, CreatedAt)
      OUTPUT INSERTED.TripId, INSERTED.TripCode
      VALUES (@tcode, 30.0, 'SCHEDULED', @plate, 1, GETUTCDATE())
    `, {
      tcode: { type: sql.VarChar(50), value: tcode },
      plate: { type: sql.VarChar(50), value: truckPlate },
    });
    const tripId = res[0].TripId;
    const tripCode = res[0].TripCode;
    ownedTripIds.add(tripId);
    return { tripId, tripCode };
  });
}

async function attachConfirmedSoToTrip(soId, tripId, wfRef = null) {
  return await runWithTarget('remote_b', async () => {
    const sid = String(soId);
    const ref = wfRef || `SO-${sid}`;
    await wfQ(`
      IF EXISTS (SELECT 1 FROM wf.SalesOrderExt WHERE SOID = @so)
        UPDATE wf.SalesOrderExt SET TripId = @tid, WfRef = COALESCE(WfRef, @ref) WHERE SOID = @so
      ELSE
        INSERT INTO wf.SalesOrderExt (SOID, SoPrefix, WfRef, TripId, CreatedAt, UpdatedAt, IsLoaded, RebateDiscountAmt, IsOwnTruck, NoTruckRequired, PSling, IsUnlocked)
        VALUES (@so, 'SO', @ref, @tid, GETUTCDATE(), GETUTCDATE(), 0, 0, 0, 0, 0, 0)
    `, {
      so: { type: sql.VarChar(50), value: sid },
      ref: { type: sql.VarChar(50), value: ref },
      tid: { type: sql.Int, value: tripId },
    });
    ownedSalesOrderExt.add(sid);
  });
}

async function createOwnedOverlay(cid, cno, opts = {}) {
  return await runWithTarget('remote_b', async () => {
    const res = await wfQ(`
      INSERT INTO wf.ControlTicketOverlay (
        DocuNo, DocuType, DocuId, ExpiryDate, ExpiryType, StrictOverrideFlag, ReasonCode, CreatedBy
      ) OUTPUT INSERTED.Id VALUES (
        @cno, 104, @cid, @exp, 'EXPLICIT', @strict, @rsn, 'TEST'
      )
    `, {
      cno: { type: sql.NVarChar(50), value: cno },
      cid: { type: sql.Int, value: cid },
      exp: { type: sql.Date, value: opts.expiryDate || null },
      strict: { type: sql.Bit, value: opts.strictOverride ? 1 : 0 },
      rsn: { type: sql.VarChar(50), value: opts.reasonCode || null },
    });
    const id = res[0].Id;
    ownedOverlayIds.add(id);
    return id;
  });
}

async function createOwnedReservation(cid, cno, qty = 2, opts = {}) {
  return await runWithTarget('remote_b', async () => {
    const ownerCustId = opts.ownerCustId || 'CUST-UAT-01';
    const beneficiaryCustId = opts.beneficiaryCustId || ownerCustId;
    const carrierDocuNo = opts.carrierDocuNo !== undefined ? (opts.carrierDocuNo ? String(opts.carrierDocuNo).slice(0, 25) : null) : null;
    const expiresAt = opts.expiresAt !== undefined ? opts.expiresAt : null;
    const carrierSoId = opts.carrierSoId !== undefined ? String(opts.carrierSoId) : (opts.soid ? String(opts.soid) : '999999');
    const tripId = opts.tripId !== undefined ? opts.tripId : null;
    const status = opts.status || 'RESERVED';
    const idemKey = `IDEM-${cno}-${Date.now()}`;

    const res = await wfQ(`
      INSERT INTO wf.CouponReservation (
        CouponId, CouponNo, GoodId, CarrierSoId, CarrierDocuNo, TripId,
        BeneficiaryCustId, OwnerCustId, ReservedQty, Status, ExpiresAt,
        CreatedBy, Revision, IdempotencyKey, CreatedAt, UpdatedAt
      ) OUTPUT INSERTED.Id VALUES (
        @cid, @cno, 1156, @soid, @cDoc, @tripId,
        @bCust, @oCust, @qty, @status, @expiresAt,
        1, 1, @idem, GETUTCDATE(), GETUTCDATE()
      )
    `, {
      cid: { type: sql.Int, value: cid },
      cno: { type: sql.VarChar(25), value: cno },
      soid: { type: sql.VarChar(50), value: carrierSoId },
      cDoc: { type: sql.VarChar(50), value: carrierDocuNo },
      tripId: { type: sql.Int, value: tripId },
      bCust: { type: sql.VarChar(50), value: beneficiaryCustId },
      oCust: { type: sql.VarChar(50), value: ownerCustId },
      qty: { type: sql.Decimal(12, 4), value: qty },
      status: { type: sql.VarChar(20), value: status },
      expiresAt: { type: sql.DateTime2, value: expiresAt },
      idem: { type: sql.NVarChar(120), value: idemKey },
    });

    const reservationId = res[0].Id;
    ownedReservations.add(reservationId);
    return { reservationId, carrierDocuNo, cid, cno, qty, carrierSoId, tripId };
  });
}

test.before(async () => {
  await startServer();
  // R6-02: Capture exact before-image (existence + nullable value) of CONTROL_TICKET_BLOCK_EXPIRED
  const settingRow = await wfQuery(`SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`);
  beforeImageCaptured = true;
  if (settingRow.recordset && settingRow.recordset.length > 0) {
    originalSettingExists = true;
    originalBlockExpiredValue = settingRow.recordset[0].SettingValue;
  } else {
    originalSettingExists = false;
    originalBlockExpiredValue = null;
  }
});

test.after(async () => {
  let cleanupError = null;
  let restoreError = null;
  let serverError = null;
  let poolError = null;

  try {
    await cleanupOwnedEntities();
  } catch (err) {
    cleanupError = err;
  } finally {
    // R6-02: Outer finally guarantees restoration runs independent of cleanup failure
    try {
      await restoreBlockExpiredSetting();
    } catch (err) {
      restoreError = err;
    }
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
    } catch (err) {
      serverError = err;
    }
    try {
      const { closeAll } = require('../db');
      await closeAll();
    } catch (err) {
      poolError = err;
    }
  }

  const errors = [cleanupError, restoreError, serverError, poolError].filter(Boolean);
  if (errors.length > 0) {
    const combinedMsg = errors.map(e => e.message || String(e)).join('; ');
    throw new Error(`Teardown encountered errors: ${combinedMsg}`);
  }
});

// ─────────────────────────────────────────────────────────────
// 1. Safety Guard & Baseline Verification
// ─────────────────────────────────────────────────────────────
test('UAT-01: Engine Target Safety & Principal Guard', async () => {
  const safety = await assertTestDatabase();
  assert.equal(safety.dbName, 'dbwins_worldfert9_test_v2');
  assert.equal(safety.serverName, '21181f44f254');
  assert.equal(safety.loginName, 'wf_test');
  assert.equal(safety.isSysadmin, 0);
  assert.equal(safety.prodAccess, 0);
});

// ─────────────────────────────────────────────────────────────
// 2. Feature Gate: Disabled Flag Zero Writes
// ─────────────────────────────────────────────────────────────
test('UAT-02: Disabled feature flag strictly rejects with 400 and zero writes', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'false';

  const coupon = await createOwnedCoupon('GATE', 10);
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2);

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo: `D-GT-${RUN_ID}`,
      carLicense: '70-1111',
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.message.includes('COUPON_NATIVE_POSTING_ENABLED=false'));

  // Assert reservation remains RESERVED
  const check = await wfQ(`SELECT Status FROM wf.CouponReservation WHERE Id = @id`, {
    id: { type: sql.Int, value: reservation.reservationId },
  });
  assert.equal(check[0]?.Status, 'RESERVED');
});

// ─────────────────────────────────────────────────────────────
// 3. Real HTTP API Dispatch with Physical Delivery Evidence
// ─────────────────────────────────────────────────────────────
test('UAT-03: Authenticated HTTP /api/coupons/post-native dispatches real native adapter', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('REAL', 10);
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 3, { carrierSoId: coupon.soid });
  const deliveryDocuNo = `DOC-${RUN_ID}-R`;

  // Seed authoritative physical scale evidence in dbo.WGHD
  await createOwnedScaleTicket(deliveryDocuNo, '70-9999', coupon.soid);

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '70-9999',
    }),
  });

  if (res.status !== 200) {
    console.error('UAT-03 FAILED with status', res.status, await res.json());
  }
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'POSTED');
  assert.equal(data.nativeDocuNo, deliveryDocuNo);
  assert.ok(data.nativeRedemptionId > 0);
  ownedNativeRedemptionIds.add(data.nativeRedemptionId);

  // Assert Native WinSpeed HD
  const hd = await query(`SELECT * FROM dbo.WFRedemtionHD WHERE RedemtionID = @rid`, {
    rid: { type: sql.Int, value: data.nativeRedemptionId },
  });
  assert.equal(hd.length, 1);
  assert.equal(Number(hd[0].DocuType), 116);
  assert.equal(hd[0].DocuStatus, 'N');
  assert.equal(hd[0].DocuNo, deliveryDocuNo);
  assert.equal(Number(hd[0].SumGoodQty), 3.0);

  // Assert Native WinSpeed DT
  const dt = await query(`SELECT * FROM dbo.WFRedemtionDT WHERE RedemtionID = @rid`, {
    rid: { type: sql.Int, value: data.nativeRedemptionId },
  });
  assert.equal(dt.length, 1);
  assert.equal(dt[0].PostInv, 'N');
  assert.equal(Number(dt[0].RemaQty), 10.0, 'Snapshot RemaQty must capture balance before deduction');
  assert.equal(Number(dt[0].GoodQty), 3.0);

  // Assert WFCoupon balance reduced accurately
  const cp = await query(`SELECT RemaQty FROM dbo.WFCoupon WHERE CouponID = @cid`, {
    cid: { type: sql.Int, value: coupon.cid },
  });
  assert.equal(Number(cp[0].RemaQty), 7.0);

  // Assert wf.CouponReservation transition
  const rCheck = await wfQ(`SELECT Status, NativeDocuNo, NativeRedemptionId FROM wf.CouponReservation WHERE Id = @id`, {
    id: { type: sql.Int, value: reservation.reservationId },
  });
  assert.equal(rCheck[0].Status, 'POSTED');
  assert.equal(rCheck[0].NativeDocuNo, deliveryDocuNo);
  assert.equal(rCheck[0].NativeRedemptionId, data.nativeRedemptionId);

  // Assert wf.CouponRedemptionMirror
  const mirror = await wfQ(`SELECT * FROM wf.CouponRedemptionMirror WHERE RedemtionID = @rid`, {
    rid: { type: sql.Int, value: data.nativeRedemptionId },
  });
  assert.equal(mirror.length, 1);
  assert.equal(mirror[0].Source, 'SALE_APP');
  assert.equal(mirror[0].Status, 'COMPLETED');
  assert.equal(Number(mirror[0].RedeemedTon), 3.0);

  // Assert dbo.SMAudit continuity
  const audit = await query(`SELECT audit_id FROM dbo.SMAudit WHERE audit_columnid = @rid AND audit_docuno = @dno AND audit_screen = 2098003052`, {
    rid: { type: sql.Int, value: data.nativeRedemptionId },
    dno: { type: sql.VarChar(50), value: deliveryDocuNo },
  });
  assert.equal(audit.length, 1);
  ownedAuditIds.add(audit[0].audit_id);

  // Assert dbo.EMRunBrch untouched
  const emrun = await query(`SELECT LastNo FROM dbo.EMRunBrch WHERE RunCode = 'redemption'`);
  assert.equal(emrun[0].LastNo, '69081762');
});

// ─────────────────────────────────────────────────────────────
// 4. Idempotency: Replay Succeeds, Conflicting Mutation Fails
// ─────────────────────────────────────────────────────────────
test('UAT-04: Idempotent replay returns existing document; conflicting document returns 409', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('IDEM', 10);
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, { carrierSoId: coupon.soid });
  const deliveryDocuNo = `DOC-${RUN_ID}-I`;

  await createOwnedScaleTicket(deliveryDocuNo, '70-2222', coupon.soid);

  // First call -> 200
  const firstRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '70-2222',
    }),
  });
  assert.equal(firstRes.status, 200);
  const firstData = await firstRes.json();
  ownedNativeRedemptionIds.add(firstData.nativeRedemptionId);

  // Second identical call -> 200 with idempotent: true
  const replayRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '70-2222',
    }),
  });
  assert.equal(replayRes.status, 200);
  const replayData = await replayRes.json();
  assert.equal(replayData.idempotent, true);
  assert.equal(replayData.nativeDocuNo, deliveryDocuNo);
  assert.equal(replayData.nativeRedemptionId, firstData.nativeRedemptionId);

  // Third call with conflicting delivery document -> 409 Conflict
  const conflictRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo: 'DOC-CONFLICT-DIF',
      carLicense: '70-2222',
    }),
  });
  assert.equal(conflictRes.status, 409);
  const conflictData = await conflictRes.json();
  assert.equal(conflictData.code, 'IDEMPOTENCY_CONFLICT');
});

// ─────────────────────────────────────────────────────────────
// 5. Posting-Time Expiry Revalidation
// ─────────────────────────────────────────────────────────────
test('UAT-05: Expired reservation rejected at posting time and transitioned to EXPIRED', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('EXPR', 10);
  const expiredTime = new Date(Date.now() - 3600000).toISOString();
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, {
    expiresAt: expiredTime,
    carrierSoId: coupon.soid,
  });

  const deliveryDocuNo = `DOC-${RUN_ID}-E`;
  await createOwnedScaleTicket(deliveryDocuNo, '70-3333', coupon.soid);

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '70-3333',
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'RESERVATION_EXPIRED');

  // Verify status in DB is EXPIRED
  const check = await wfQ(`SELECT Status FROM wf.CouponReservation WHERE Id = @id`, {
    id: { type: sql.Int, value: reservation.reservationId },
  });
  assert.equal(check[0]?.Status, 'EXPIRED');

  // Verify zero native deduction
  const cp = await query(`SELECT RemaQty FROM dbo.WFCoupon WHERE CouponID = @cid`, {
    cid: { type: sql.Int, value: coupon.cid },
  });
  assert.equal(Number(cp[0].RemaQty), 10.0);
});

// ─────────────────────────────────────────────────────────────
// 6. Revoked Beneficiary Grant After Reservation
// ─────────────────────────────────────────────────────────────
test('UAT-06: Revoked beneficiary grant before posting fails with 403 BENEFICIARY_REVOKED', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('BENREV', 10);
  const deliveryDocuNo = `DOC-${RUN_ID}-B`;
  await createOwnedScaleTicket(deliveryDocuNo, '70-4444', coupon.soid);
  
  const ownerCustId = `CUST-OWN-REV-${RUN_ID}`;
  const beneficiaryCustId = `CUST-BEN-REV-${RUN_ID}`;

  // Create active grant
  const grantRes = await wfQ(`
    INSERT INTO wf.CouponBeneficiary (
      OwnerCustId, BeneficiaryCustId, Scope, Status, Reason, CreatedBy, CreatedAt
    ) OUTPUT INSERTED.Id VALUES (
      @oCust, @bCust, 'ALL', 'ACTIVE', 'Initial Grant', 1, GETUTCDATE()
    )
  `, {
    oCust: { type: sql.VarChar(50), value: ownerCustId },
    bCust: { type: sql.VarChar(50), value: beneficiaryCustId },
  });
  const grantId = grantRes[0].Id;
  ownedBeneficiaries.add(grantId);

  // Reserve coupon for beneficiary
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, {
    ownerCustId,
    beneficiaryCustId,
    carrierSoId: coupon.soid,
  });

  // Now revoke grant before posting!
  await wfQuery(`UPDATE wf.CouponBeneficiary SET Status = 'REVOKED', RevokedAt = GETUTCDATE() WHERE Id = @gid`, {
    gid: { type: sql.Int, value: grantId },
  });

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '70-4444',
    }),
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, 'BENEFICIARY_REVOKED');

  // Verify zero native write
  const cp = await query(`SELECT RemaQty FROM dbo.WFCoupon WHERE CouponID = @cid`, {
    cid: { type: sql.Int, value: coupon.cid },
  });
  assert.equal(Number(cp[0].RemaQty), 10.0);
});

// ─────────────────────────────────────────────────────────────
// 7. OCC / Revision Conflict Check
// ─────────────────────────────────────────────────────────────
test('UAT-07: OCC Conflict with stale expectedRevision returns 409', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('OCC', 10);
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, { carrierSoId: coupon.soid });
  const deliveryDocuNo = `DOC-${RUN_ID}-O`;
  await createOwnedScaleTicket(deliveryDocuNo, '70-5555', coupon.soid);

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '70-5555',
      expectedRevision: 99, // Stale!
    }),
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.code, 'OCC_CONFLICT');
});

// ─────────────────────────────────────────────────────────────
// 8. Missing Vehicle Plate Rejected
// ─────────────────────────────────────────────────────────────
test('UAT-08: Missing vehicle plate rejected with 400 MISSING_CAR_LICENSE without fabricating "ไม่ระบุ"', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('NOPLATE', 10);
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, { carrierSoId: coupon.soid });
  const deliveryDocuNo = `DOC-${RUN_ID}-N`;

  // Scale ticket with 'ไม่ระบุ' as plate
  await createOwnedScaleTicket(deliveryDocuNo, 'ไม่ระบุ', coupon.soid);

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '',
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'MISSING_CAR_LICENSE');
});

// ─────────────────────────────────────────────────────────────
// 9. Same-Delivery Multi-Coupon Batch Posting
// ─────────────────────────────────────────────────────────────
test('UAT-09: Same-delivery multi-coupon batch creates single 116 header with multiple DT lines', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon1 = await createOwnedCoupon('BAT1', 10);
  const coupon2 = await createOwnedCoupon('BAT2', 10);
  const deliveryDocuNo = `DOC-${RUN_ID}-M`;

  await createOwnedScaleTicket(deliveryDocuNo, '70-7777', coupon1.soid);

  const res1 = await createOwnedReservation(coupon1.cid, coupon1.cno, 2, { carrierSoId: coupon1.soid });
  const res2 = await createOwnedReservation(coupon2.cid, coupon2.cno, 3, { carrierSoId: coupon1.soid });

  const res = await fetch(`${baseUrl}/api/coupons/post-native-delivery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      deliveryDocuNo,
      reservationIds: [res1.reservationId, res2.reservationId],
      carLicense: '70-7777',
    }),
  });

  if (res.status !== 200) {
    console.error('UAT-09 FAILED with status', res.status, await res.json());
  }
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.deliveryDocuNo, deliveryDocuNo);
  assert.ok(data.redemptionId > 0);
  ownedNativeRedemptionIds.add(data.redemptionId);

  // Assert exactly ONE WFRedemtionHD
  const hd = await query(`SELECT * FROM dbo.WFRedemtionHD WHERE RedemtionID = @rid`, {
    rid: { type: sql.Int, value: data.redemptionId },
  });
  assert.equal(hd.length, 1);
  assert.equal(Number(hd[0].SumGoodQty), 5.0);

  // Assert exactly TWO WFRedemtionDT lines
  const dt = await query(`SELECT * FROM dbo.WFRedemtionDT WHERE RedemtionID = @rid ORDER BY Listno`, {
    rid: { type: sql.Int, value: data.redemptionId },
  });
  assert.equal(dt.length, 2);
  assert.equal(Number(dt[0].Listno), 1);
  assert.equal(Number(dt[1].Listno), 2);

  // Assert both reservations transitioned to POSTED
  const r1 = await wfQ(`SELECT Status, NativeDocuNo FROM wf.CouponReservation WHERE Id = @id`, {
    id: { type: sql.Int, value: res1.reservationId },
  });
  const r2 = await wfQ(`SELECT Status, NativeDocuNo FROM wf.CouponReservation WHERE Id = @id`, {
    id: { type: sql.Int, value: res2.reservationId },
  });
  assert.equal(r1[0].Status, 'POSTED');
  assert.equal(r2[0].Status, 'POSTED');
  assert.equal(r1[0].NativeDocuNo, deliveryDocuNo);
  assert.equal(r2[0].NativeDocuNo, deliveryDocuNo);
});

// ─────────────────────────────────────────────────────────────
// 10. Reversal Remains Strictly BLOCKED_SPEC
// ─────────────────────────────────────────────────────────────
test('UAT-10: reverseRedemptionDocument remains strictly BLOCKED_SPEC (501)', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  await assert.rejects(
    async () => {
      await reverseRedemptionDocument();
    },
    (err) => {
      assert.equal(err.status, 501);
      assert.equal(err.code, 'BLOCKED_SPEC');
      return true;
    }
  );
});

// ─────────────────────────────────────────────────────────────
// 11. Legitimate Beneficiary Grant Posting Succeeds
// ─────────────────────────────────────────────────────────────
test('UAT-11: Legitimate Beneficiary Grant succeeds and records native 116 document', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('BENPOS', 10);
  const ownerCustId = `CUST-OWN-POS-${RUN_ID}`;
  const beneficiaryCustId = `CUST-BEN-POS-${RUN_ID}`;

  const grantRes = await wfQ(`
    INSERT INTO wf.CouponBeneficiary (
      OwnerCustId, BeneficiaryCustId, Scope, Status, Reason, CreatedBy, CreatedAt
    ) OUTPUT INSERTED.Id VALUES (
      @oCust, @bCust, 'ALL', 'ACTIVE', 'Legitimate Authorized Grant', 1, GETUTCDATE()
    )
  `, {
    oCust: { type: sql.VarChar(50), value: ownerCustId },
    bCust: { type: sql.VarChar(50), value: beneficiaryCustId },
  });
  const grantId = grantRes[0].Id;
  ownedBeneficiaries.add(grantId);

  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, {
    ownerCustId,
    beneficiaryCustId,
    carrierSoId: coupon.soid,
  });

  const deliveryDocuNo = `DOC-${RUN_ID}-BPOS`;
  await createOwnedScaleTicket(deliveryDocuNo, '70-8888', coupon.soid);

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '70-8888',
    }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'POSTED');
  assert.equal(data.nativeDocuNo, deliveryDocuNo);
  assert.ok(data.nativeRedemptionId > 0);
  ownedNativeRedemptionIds.add(data.nativeRedemptionId);

  const rCheck = await wfQ(`SELECT Status, NativeDocuNo FROM wf.CouponReservation WHERE Id = @id`, {
    id: { type: sql.Int, value: reservation.reservationId },
  });
  assert.equal(rCheck[0]?.Status, 'POSTED');
  assert.equal(rCheck[0]?.NativeDocuNo, deliveryDocuNo);
});

// ─────────────────────────────────────────────────────────────
// 12. Ticket Expiry Policy: Strict OFF vs Strict ON vs Pre-authorized Override
// ─────────────────────────────────────────────────────────────
test('UAT-12: Ticket Expiry Policy: Strict OFF allows with soft warning, Strict ON blocks, Strict Override allows', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  // Subcase A: Strict Mode OFF (default) -> Expired ticket succeeds with soft warning
  const couponA = await createOwnedCoupon('EXPOFF', 10);
  await createOwnedOverlay(couponA.cid, couponA.cno, { expiryDate: '2020-01-01', strictOverride: false });
  const resA = await createOwnedReservation(couponA.cid, couponA.cno, 2, { carrierSoId: couponA.soid });
  const docA = `DOC-${RUN_ID}-EOFF`;
  await createOwnedScaleTicket(docA, '70-1212', couponA.soid);

  const postResA = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: resA.reservationId,
      deliveryDocuNo: docA,
      carLicense: '70-1212',
    }),
  });

  assert.equal(postResA.status, 200);
  const dataA = await postResA.json();
  assert.equal(dataA.status, 'POSTED');
  assert.ok(dataA.warnings && dataA.warnings.length > 0, 'Must include soft expiry warning');
  ownedNativeRedemptionIds.add(dataA.nativeRedemptionId);

  try {
    // Subcase B: Server Policy Strict Mode ON -> Expired ticket blocked with 400 COUPON_EXPIRED
    await wfQuery(`UPDATE wf.SystemSetting SET SettingValue = 'true' WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`);

    const couponB = await createOwnedCoupon('EXPON', 10);
    await createOwnedOverlay(couponB.cid, couponB.cno, { expiryDate: '2020-01-01', strictOverride: false });
    const resB = await createOwnedReservation(couponB.cid, couponB.cno, 2, { carrierSoId: couponB.soid });
    const docB = `DOC-${RUN_ID}-EON`;
    await createOwnedScaleTicket(docB, '70-1313', couponB.soid);

    const postResB = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${warehouseToken}`,
      },
      body: JSON.stringify({
        reservationId: resB.reservationId,
        deliveryDocuNo: docB,
        carLicense: '70-1313',
      }),
    });

    assert.equal(postResB.status, 400);
    const dataB = await postResB.json();
    assert.equal(dataB.code, 'COUPON_EXPIRED');

    // Subcase C: Strict Mode ON + Pre-authorized Strict Override on overlay -> Allowed
    const couponC = await createOwnedCoupon('EXPOVR', 10);
    await createOwnedOverlay(couponC.cid, couponC.cno, { expiryDate: '2020-01-01', strictOverride: true });
    const resC = await createOwnedReservation(couponC.cid, couponC.cno, 2, { carrierSoId: couponC.soid });
    const docC = `DOC-${RUN_ID}-EOVR`;
    await createOwnedScaleTicket(docC, '70-1414', couponC.soid);

    const postResC = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${warehouseToken}`,
      },
      body: JSON.stringify({
        reservationId: resC.reservationId,
        deliveryDocuNo: docC,
        carLicense: '70-1414',
      }),
    });

    assert.equal(postResC.status, 200);
    const dataC = await postResC.json();
    assert.equal(dataC.status, 'POSTED');
    ownedNativeRedemptionIds.add(dataC.nativeRedemptionId);
  } finally {
    // R6-02: Restore server policy to exact captured before-image
    await restoreBlockExpiredSetting();
  }
});

// ─────────────────────────────────────────────────────────────
// 13. Cancelled Ticket Blocked with 400 COUPON_POLICY_BLOCKED
// ─────────────────────────────────────────────────────────────
test('UAT-13: Cancelled ticket rejected by policy with 400 COUPON_POLICY_BLOCKED and zero native write', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('CANCL', 10);
  await createOwnedOverlay(coupon.cid, coupon.cno, { reasonCode: 'CANCELLED' });
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, { carrierSoId: coupon.soid });
  const deliveryDocuNo = `DOC-${RUN_ID}-CNCL`;
  await createOwnedScaleTicket(deliveryDocuNo, '70-1515', coupon.soid);

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo,
      carLicense: '70-1515',
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'COUPON_POLICY_BLOCKED');

  const check = await wfQ(`SELECT Status FROM wf.CouponReservation WHERE Id = @id`, {
    id: { type: sql.Int, value: reservation.reservationId },
  });
  assert.equal(check[0]?.Status, 'RESERVED');
});

// ─────────────────────────────────────────────────────────────
// 14. Delivery Evidence Mismatch Check
// ─────────────────────────────────────────────────────────────
test('UAT-14: Delivery Evidence Mismatch: Unrelated scale ticket rejected with 400 DELIVERY_EVIDENCE_MISMATCH', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('MISMAT', 10, { soid: 111111 });
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, {
    carrierSoId: 111111,
  });

  const conflictingScaleDoc = `SHIP-EVID-B-${RUN_ID}`;
  // Seed scale ticket belonging to different SO (888888) with no trip match
  await createOwnedScaleTicket(conflictingScaleDoc, '70-1616', 888888);

  const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo: conflictingScaleDoc,
      carLicense: '70-1616',
    }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, 'DELIVERY_EVIDENCE_MISMATCH');

  const check = await wfQ(`SELECT Status FROM wf.CouponReservation WHERE Id = @id`, {
    id: { type: sql.Int, value: reservation.reservationId },
  });
  assert.equal(check[0]?.Status, 'RESERVED');
});

// ─────────────────────────────────────────────────────────────
// 15. Batch Parity: Stale Revisions, Revoked Beneficiary, Cancelled Ticket
// ─────────────────────────────────────────────────────────────
test('UAT-15: Batch Parity: Stale expectedRevisions, Revoked Beneficiary, and Cancelled Ticket atomically reject with zero native writes', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  // Case A: Batch with stale revision
  const deliveryDocuNoA = `DOC-${RUN_ID}-BPAR1`;
  const cA1 = await createOwnedCoupon('STA1', 10);
  const cA2 = await createOwnedCoupon('STA2', 10);
  await createOwnedScaleTicket(deliveryDocuNoA, '70-1717', cA1.soid);

  const rA1 = await createOwnedReservation(cA1.cid, cA1.cno, 1, { carrierSoId: cA1.soid });
  const rA2 = await createOwnedReservation(cA2.cid, cA2.cno, 1, { carrierSoId: cA1.soid });

  const resA = await fetch(`${baseUrl}/api/coupons/post-native-delivery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      deliveryDocuNo: deliveryDocuNoA,
      reservationIds: [rA1.reservationId, rA2.reservationId],
      expectedRevisions: {
        [rA1.reservationId]: 1,
        [rA2.reservationId]: 99, // Stale!
      },
      carLicense: '70-1717',
    }),
  });

  assert.equal(resA.status, 409);
  const dataA = await resA.json();
  assert.equal(dataA.code, 'OCC_CONFLICT');

  // Case B: Batch with revoked beneficiary in one item
  const deliveryDocuNoB = `DOC-${RUN_ID}-BPAR2`;
  const cB1 = await createOwnedCoupon('BREV1', 10);
  const cB2 = await createOwnedCoupon('BREV2', 10);
  await createOwnedScaleTicket(deliveryDocuNoB, '70-1717', cB1.soid);

  const grantBRes = await wfQ(`
    INSERT INTO wf.CouponBeneficiary (
      OwnerCustId, BeneficiaryCustId, Scope, Status, Reason, CreatedBy, CreatedAt
    ) OUTPUT INSERTED.Id VALUES (
      'OWN-B', 'BEN-B', 'ALL', 'REVOKED', 'Revoked Before Batch', 1, GETUTCDATE()
    )
  `);
  ownedBeneficiaries.add(grantBRes[0].Id);

  const rB1 = await createOwnedReservation(cB1.cid, cB1.cno, 1, { carrierSoId: cB1.soid });
  const rB2 = await createOwnedReservation(cB2.cid, cB2.cno, 1, {
    ownerCustId: 'OWN-B',
    beneficiaryCustId: 'BEN-B',
    carrierSoId: cB1.soid,
  });

  const resB = await fetch(`${baseUrl}/api/coupons/post-native-delivery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      deliveryDocuNo: deliveryDocuNoB,
      reservationIds: [rB1.reservationId, rB2.reservationId],
      carLicense: '70-1717',
    }),
  });

  assert.equal(resB.status, 403);
  const dataB = await resB.json();
  assert.equal(dataB.code, 'BENEFICIARY_REVOKED');

  // Case C: Batch with one cancelled ticket
  const deliveryDocuNoC = `DOC-${RUN_ID}-BPAR3`;
  const cC1 = await createOwnedCoupon('BCAN1', 10);
  const cC2 = await createOwnedCoupon('BCAN2', 10);
  await createOwnedScaleTicket(deliveryDocuNoC, '70-1717', cC1.soid);
  await createOwnedOverlay(cC2.cid, cC2.cno, { reasonCode: 'CANCELLED' });

  const rC1 = await createOwnedReservation(cC1.cid, cC1.cno, 1, { carrierSoId: cC1.soid });
  const rC2 = await createOwnedReservation(cC2.cid, cC2.cno, 1, { carrierSoId: cC1.soid });

  const resC = await fetch(`${baseUrl}/api/coupons/post-native-delivery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      deliveryDocuNo: deliveryDocuNoC,
      reservationIds: [rC1.reservationId, rC2.reservationId],
      carLicense: '70-1717',
    }),
  });

  assert.equal(resC.status, 400);
  const dataC = await resC.json();
  assert.equal(dataC.code, 'COUPON_POLICY_BLOCKED');
});

// ─────────────────────────────────────────────────────────────
// 16. Service Gate Enforces Strict Engine Allowlist (Fail-Closed on Null)
// ─────────────────────────────────────────────────────────────
test('UAT-16: assertServiceGate enforces strict exact server/database/principal tuple and blocks unauthorized engine contexts', async () => {
  const { assertServiceGate } = require('../services/redemption-native-adapter');
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  // 1. Unauthorized server name
  const mockTxBadServer = {
    request: () => ({
      query: async (sql) => {
        if (sql.includes('HAS_DBACCESS')) return { recordset: [{ prodAccess: 0 }] };
        return {
          recordset: [{
            srv: 'rogue-server-host',
            db: 'dbwins_worldfert9_test_v2',
            usr: 'wf_test',
            isSysadmin: 0,
          }],
        };
      },
    }),
  };

  await assert.rejects(
    async () => { await assertServiceGate(mockTxBadServer); },
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'UNAUTHORIZED_SERVER');
      return true;
    }
  );

  // 2. Production database context
  const mockTxProdDb = {
    request: () => ({
      query: async (sql) => {
        if (sql.includes('HAS_DBACCESS')) return { recordset: [{ prodAccess: 0 }] };
        return {
          recordset: [{
            srv: '21181f44f254',
            db: 'dbwins_worldfert9',
            usr: 'wf_test',
            isSysadmin: 0,
          }],
        };
      },
    }),
  };

  await assert.rejects(
    async () => { await assertServiceGate(mockTxProdDb); },
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'PRODUCTION_WRITE_BLOCKED');
      return true;
    }
  );

  // 3. Sysadmin privilege refusal
  const mockTxSysadmin = {
    request: () => ({
      query: async (sql) => {
        if (sql.includes('HAS_DBACCESS')) return { recordset: [{ prodAccess: 0 }] };
        return {
          recordset: [{
            srv: '21181f44f254',
            db: 'dbwins_worldfert9_test_v2',
            usr: 'sa',
            isSysadmin: 1,
          }],
        };
      },
    }),
  };

  await assert.rejects(
    async () => { await assertServiceGate(mockTxSysadmin); },
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'PRODUCTION_WRITE_BLOCKED');
      return true;
    }
  );

  // 4. R3-04: Null sysadmin permission result fails closed
  const mockTxNullSysadmin = {
    request: () => ({
      query: async (sql) => {
        if (sql.includes('HAS_DBACCESS')) return { recordset: [{ prodAccess: 0 }] };
        return {
          recordset: [{
            srv: '21181f44f254',
            db: 'dbwins_worldfert9_test_v2',
            usr: 'wf_test',
            isSysadmin: null, // Null permission!
          }],
        };
      },
    }),
  };

  await assert.rejects(
    async () => { await assertServiceGate(mockTxNullSysadmin); },
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'PRODUCTION_WRITE_BLOCKED');
      return true;
    }
  );

  // 5. R3-04: Null prodAccess permission result fails closed
  const mockTxNullProdAccess = {
    request: () => ({
      query: async (sql) => {
        if (sql.includes('HAS_DBACCESS')) return { recordset: [{ prodAccess: null }] }; // Null access!
        return {
          recordset: [{
            srv: '21181f44f254',
            db: 'dbwins_worldfert9_test_v2',
            usr: 'wf_test',
            isSysadmin: 0,
          }],
        };
      },
    }),
  };

  await assert.rejects(
    async () => { await assertServiceGate(mockTxNullProdAccess); },
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.code, 'PRODUCTION_ACCESS_DETECTED');
      return true;
    }
  );
});

// ─────────────────────────────────────────────────────────────
// 17. R3-01: Server-Owned Policy Enforcement & Warehouse Cannot Self-Approve
// ─────────────────────────────────────────────────────────────
test('UAT-17: R3-01 Server-Owned Policy: Warehouse cannot disable strict mode or self-approve; Admin override succeeds', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  try {
    // Enable server strict policy
    await wfQuery(`UPDATE wf.SystemSetting SET SettingValue = 'true' WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`);

    const coupon = await createOwnedCoupon('R3POL', 10);
    await createOwnedOverlay(coupon.cid, coupon.cno, { expiryDate: '2020-01-01', strictOverride: false });
    const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, { carrierSoId: coupon.soid });
    const deliveryDocuNo = `DOC-${RUN_ID}-R3POL`;
    await createOwnedScaleTicket(deliveryDocuNo, '70-9898', coupon.soid);

    // Case A: Warehouse passes strictMode: false in body -> STILL rejected with 400 COUPON_EXPIRED
    const resA = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${warehouseToken}`,
      },
      body: JSON.stringify({
        reservationId: reservation.reservationId,
        deliveryDocuNo,
        carLicense: '70-9898',
        strictMode: false, // Trying to disable server policy!
      }),
    });
    assert.equal(resA.status, 400);
    const dataA = await resA.json();
    assert.equal(dataA.code, 'COUPON_EXPIRED');

    // Case B: Warehouse attempts self-approval -> 403 CANNOT_SELF_APPROVE_OVERRIDE
    const resB = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${warehouseToken}`,
      },
      body: JSON.stringify({
        reservationId: reservation.reservationId,
        deliveryDocuNo,
        carLicense: '70-9898',
        strictOverride: true,
        overrideReason: 'Warehouse self-approval attempt',
      }),
    });
    assert.equal(resB.status, 403);
    const dataB = await resB.json();
    assert.equal(dataB.code, 'CANNOT_SELF_APPROVE_OVERRIDE');

    // Case C: Admin provides authorized override with reason -> 200 OK
    const resC = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        reservationId: reservation.reservationId,
        deliveryDocuNo,
        carLicense: '70-9898',
        overrideReason: 'Approved by Plant Director for urgent agricultural cycle',
        overrideApprovedBy: 1,
      }),
    });
    assert.equal(resC.status, 200);
    const dataC = await resC.json();
    assert.equal(dataC.status, 'POSTED');
    ownedNativeRedemptionIds.add(dataC.nativeRedemptionId);

    // R4-05 Case D: Spoofed approver ID on single post route -> 400 APPROVAL_ATTRIBUTION_MISMATCH
    const couponD = await createOwnedCoupon('R4SPOOF1', 10);
    await createOwnedOverlay(couponD.cid, couponD.cno, { expiryDate: '2020-01-01', strictOverride: false });
    const resD = await createOwnedReservation(couponD.cid, couponD.cno, 2, { carrierSoId: couponD.soid });
    const docD = `DOC-${RUN_ID}-SPF1`;
    await createOwnedScaleTicket(docD, '70-9898', couponD.soid);

    const resSpoofSingle = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`, // Authenticated as sub: 1
      },
      body: JSON.stringify({
        reservationId: resD.reservationId,
        deliveryDocuNo: docD,
        carLicense: '70-9898',
        overrideReason: 'Valid reason format but spoofed approver ID',
        overrideApprovedBy: 999, // Spoofing approver identity!
      }),
    });
    assert.equal(resSpoofSingle.status, 400);
    const dataSpoofSingle = await resSpoofSingle.json();
    assert.equal(dataSpoofSingle.code, 'APPROVAL_ATTRIBUTION_MISMATCH');

    // R4-05 Case E: Spoofed approver ID on batch delivery route -> 400 APPROVAL_ATTRIBUTION_MISMATCH
    const resSpoofBatch = await fetch(`${baseUrl}/api/coupons/post-native-delivery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`, // Authenticated as sub: 1
      },
      body: JSON.stringify({
        deliveryDocuNo: docD,
        reservationIds: [resD.reservationId],
        carLicense: '70-9898',
        overrideReason: 'Valid reason format but spoofed batch approver ID',
        overrideApprovedBy: 888, // Spoofing approver identity!
      }),
    });
    assert.equal(resSpoofBatch.status, 400);
    const dataSpoofBatch = await resSpoofBatch.json();
    assert.equal(dataSpoofBatch.code, 'APPROVAL_ATTRIBUTION_MISMATCH');
  } finally {
    // R6-02: Restore server policy to exact captured before-image
    await restoreBlockExpiredSetting();
  }
});

// ─────────────────────────────────────────────────────────────
// 18. R3-02: SO Identity Decoupled from Physical Scale Evidence
// ─────────────────────────────────────────────────────────────
test('UAT-18: R3-02 SO and Scale numbers DIFFER legitimately; invalid/absent scale evidence rejected', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  const coupon = await createOwnedCoupon('R3SCALE', 10, { soid: 777777 });
  // SO reference is 'SO-WORLD-7777'
  const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, {
    carrierSoId: 777777,
    carrierDocuNo: 'SO-WORLD-7777',
  });

  // Physical scale document is DIFFERENT from SO: 'WG-SCALE-9999'
  const scaleDocNo = `WG-SC-${RUN_ID}`;
  await createOwnedScaleTicket(scaleDocNo, '70-7878', 777777, { status: 'IN', weightIn: 18000 });

  // 1. Positive: SO reference differs from Scale ticket, but SPID and physical evidence match -> 200 OK!
  const resValid = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      deliveryDocuNo: scaleDocNo,
      carLicense: '70-7878',
    }),
  });
  assert.equal(resValid.status, 200);
  const dataValid = await resValid.json();
  assert.equal(dataValid.status, 'POSTED');
  ownedNativeRedemptionIds.add(dataValid.nativeRedemptionId);

  // 2. Negative: Non-existent scale document -> 400 DELIVERY_EVIDENCE_NOT_FOUND
  const coupon2 = await createOwnedCoupon('R3NOEVID', 10, { soid: 777778 });
  const res2 = await createOwnedReservation(coupon2.cid, coupon2.cno, 2, { carrierSoId: 777778 });

  const resNotFound = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: res2.reservationId,
      deliveryDocuNo: 'WG-NON-EXISTENT-999',
      carLicense: '70-7878',
    }),
  });
  assert.equal(resNotFound.status, 400);
  const dataNotFound = await resNotFound.json();
  assert.equal(dataNotFound.code, 'DELIVERY_EVIDENCE_NOT_FOUND');

  // 3. Negative: Cancelled scale ticket -> 400 DELIVERY_EVIDENCE_CANCELLED
  const cancelledScaleDoc = `WG-CN-${RUN_ID}`;
  await createOwnedScaleTicket(cancelledScaleDoc, '70-7878', 777778, { status: 'C' });

  const resCancelled = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: res2.reservationId,
      deliveryDocuNo: cancelledScaleDoc,
      carLicense: '70-7878',
    }),
  });
  assert.equal(resCancelled.status, 400);
  const dataCancelled = await resCancelled.json();
  assert.equal(dataCancelled.code, 'DELIVERY_EVIDENCE_CANCELLED');

  // 4. Negative: Conflicting plate supplied by user vs scale header -> 400 CAR_LICENSE_MISMATCH
  const activeScaleDoc = `WG-PL-${RUN_ID}`;
  await createOwnedScaleTicket(activeScaleDoc, '70-7878', 777778, { status: 'IN', weightIn: 16000 });

  const resPlateMismatch = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: res2.reservationId,
      deliveryDocuNo: activeScaleDoc,
      carLicense: '70-0000', // Contradicts scale ticket '70-7878'!
    }),
  });
  assert.equal(resPlateMismatch.status, 400);
  const dataPlateMismatch = await resPlateMismatch.json();
  assert.equal(dataPlateMismatch.code, 'CAR_LICENSE_MISMATCH');

  // R4-02 5. Negative: Same truck plate but different SO -> 400 DELIVERY_EVIDENCE_MISMATCH
  // Plate alone is corroboration, NOT relationship identity!
  const diffSoScaleDoc = `WG-DIFFSO-${RUN_ID}`;
  await createOwnedScaleTicket(diffSoScaleDoc, '70-7878', 888888, { status: 'IN', weightIn: 16000 }); // Same truck plate '70-7878', but different SO 888888 vs reservation SO 777778!

  const resDiffSo = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: res2.reservationId,
      deliveryDocuNo: diffSoScaleDoc,
      carLicense: '70-7878', // Truck plate matches, but SO does not!
    }),
  });
  assert.equal(resDiffSo.status, 400);
  const dataDiffSo = await resDiffSo.json();
  assert.equal(dataDiffSo.code, 'DELIVERY_EVIDENCE_MISMATCH');

  // R4-02 6. Negative: Duplicate DocuNo with conflicting SPID in dbo.WGHD -> 400 DELIVERY_EVIDENCE_AMBIGUOUS
  const ambigDoc = `WG-AMBIG-${RUN_ID}`;
  await createOwnedScaleTicket(ambigDoc, '70-1111', 777778, { status: 'IN', weightIn: 15000 });
  await dboWrite(`
    INSERT INTO dbo.WGHD (DocuNo, CarNo, WeightIn, DateIn, SPID, Status)
    VALUES (@dno, '70-2222', 16000, GETUTCDATE(), 888888, 'IN')
  `, {
    dno: { type: sql.NVarChar(50), value: ambigDoc },
  });

  const resAmbig = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: res2.reservationId,
      deliveryDocuNo: ambigDoc,
      carLicense: '70-1111',
    }),
  });
  assert.equal(resAmbig.status, 400);
  const dataAmbig = await resAmbig.json();
  assert.equal(dataAmbig.code, 'DELIVERY_EVIDENCE_AMBIGUOUS');

  // R4-02 7. Negative: Conflicting dbo.WGHD and wf.WeighTicket evidence -> 400 DELIVERY_EVIDENCE_CONFLICT
  const confDoc = `WG-CONF-${RUN_ID}`;
  await createOwnedScaleTicket(confDoc, '70-3333', 777778, { status: 'IN', weightIn: 15000 });
  await createOwnedWeighTicket(confDoc, '70-4444', 777778); // Conflicting truck plate '70-4444' vs '70-3333'!

  const resConflict = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: res2.reservationId,
      deliveryDocuNo: confDoc,
      carLicense: '70-3333',
    }),
  });
  assert.equal(resConflict.status, 400);
  const dataConflict = await resConflict.json();
  assert.equal(dataConflict.code, 'DELIVERY_EVIDENCE_CONFLICT');

  // R4-02 8. Negative: Unfinished weigh ticket in wf.WeighTicket -> 400 DELIVERY_EVIDENCE_INCOMPLETE
  const unfinDoc = `WT-UNFIN-${RUN_ID}`;
  await createOwnedWeighTicket(unfinDoc, '70-5555', 777778, {
    weighInAt: null,
    netKg: 0,
    grossKg: 0,
    tareKg: 0,
    status: 'WEIGH_IN',
  });

  const resUnfin = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: res2.reservationId,
      deliveryDocuNo: unfinDoc,
      carLicense: '70-5555',
    }),
  });
  assert.equal(resUnfin.status, 400);
  const dataUnfin = await resUnfin.json();
  assert.equal(dataUnfin.code, 'DELIVERY_EVIDENCE_INCOMPLETE');

  // R5-01 9. Negative: Coincident DocuNo string match without typed link (SPID null) -> 400 DELIVERY_EVIDENCE_MISMATCH
  const coincidentDoc = `DOC-${RUN_ID}-COINCIDENT`;
  const resCoincident = await createOwnedReservation(coupon.cid, coupon.cno, 1, {
    carrierSoId: 777777,
    carrierDocuNo: coincidentDoc,
  });
  // Scale ticket has no SPID (SPID is null), but happens to have same DocuNo string
  await dboWrite(`
    INSERT INTO dbo.WGHD (DocuNo, CarNo, WeightIn, DateIn, SPID, Status)
    VALUES (@dno, '70-7878', 12000, GETUTCDATE(), NULL, 'IN')
  `, {
    dno: { type: sql.NVarChar(50), value: coincidentDoc },
  });
  ownedScaleTickets.add(coincidentDoc);

  const postCoincidentRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: resCoincident.reservationId,
      deliveryDocuNo: coincidentDoc,
      carLicense: '70-7878',
    }),
  });
  assert.equal(postCoincidentRes.status, 400);
  const dataCoincident = await postCoincidentRes.json();
  assert.equal(dataCoincident.code, 'DELIVERY_EVIDENCE_MISMATCH', 'Coincident DocuNo text match alone must NOT authorize posting');

  // R5-01 10. Positive: Multi-Customer / Multi-SO on the same truck delivery trip!
  // Trip on truck '70-5566' carries SO A (Customer Alpha) and SO B (Customer Beta)
  const tripTruckPlate = '70-5566';
  const multiTripId = await createOwnedTrip(tripTruckPlate);

  const soIdA = 777781;
  const soIdB = 777782;
  ownedSalesOrderExt.add(String(soIdA));
  ownedSalesOrderExt.add(String(soIdB));

  await wfQuery(`
    IF NOT EXISTS (SELECT 1 FROM wf.SalesOrderExt WHERE SOID = CAST(@soA AS VARCHAR(50)))
      INSERT INTO wf.SalesOrderExt (SOID, SoPrefix, WfRef, TripId, CreatedAt, UpdatedAt, IsLoaded, RebateDiscountAmt, IsOwnTruck, NoTruckRequired, PSling, IsUnlocked)
      VALUES (CAST(@soA AS VARCHAR(50)), 'SO', 'SO-ALPHA-01', @tid, GETUTCDATE(), GETUTCDATE(), 0, 0, 0, 0, 0, 0)
    ELSE
      UPDATE wf.SalesOrderExt SET TripId = @tid, WfRef = 'SO-ALPHA-01' WHERE SOID = CAST(@soA AS VARCHAR(50));

    IF NOT EXISTS (SELECT 1 FROM wf.SalesOrderExt WHERE SOID = CAST(@soB AS VARCHAR(50)))
      INSERT INTO wf.SalesOrderExt (SOID, SoPrefix, WfRef, TripId, CreatedAt, UpdatedAt, IsLoaded, RebateDiscountAmt, IsOwnTruck, NoTruckRequired, PSling, IsUnlocked)
      VALUES (CAST(@soB AS VARCHAR(50)), 'SO', 'SO-BETA-02', @tid, GETUTCDATE(), GETUTCDATE(), 0, 0, 0, 0, 0, 0)
    ELSE
      UPDATE wf.SalesOrderExt SET TripId = @tid, WfRef = 'SO-BETA-02' WHERE SOID = CAST(@soB AS VARCHAR(50));
  `, {
    soA: { type: sql.Int, value: soIdA },
    soB: { type: sql.Int, value: soIdB },
    tid: { type: sql.Int, value: multiTripId },
  });

  const couponA = await createOwnedCoupon('R5CUSTA', 10, { soid: soIdA });
  const couponB = await createOwnedCoupon('R5CUSTB', 15, { soid: soIdB });

  const resTripA = await createOwnedReservation(couponA.cid, couponA.cno, 4, {
    ownerCustId: 'CUST-ALPHA',
    carrierSoId: soIdA,
    carrierDocuNo: 'SO-ALPHA-01',
    tripId: multiTripId,
  });
  const resTripB = await createOwnedReservation(couponB.cid, couponB.cno, 6, {
    ownerCustId: 'CUST-BETA',
    carrierSoId: soIdB,
    carrierDocuNo: 'SO-BETA-02',
    tripId: multiTripId,
  });

  // Scale ticket is generated for the truck/trip, with header referencing SO A (SPID: soIdA)
  const multiScaleDoc = `WG-MULTI-${RUN_ID}`;
  await createOwnedScaleTicket(multiScaleDoc, tripTruckPlate, soIdA, { status: 'IN', weightIn: 22000 });

  // Post Reservation A (direct SO match) -> 200 OK!
  const postTripARes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: resTripA.reservationId,
      docuNo: `RD-A-${RUN_ID}`,
      deliveryDocuNo: multiScaleDoc,
      carLicense: tripTruckPlate,
    }),
  });
  assert.equal(postTripARes.status, 200);
  const dataTripA = await postTripARes.json();
  assert.equal(dataTripA.status, 'POSTED');
  ownedNativeRedemptionIds.add(dataTripA.nativeRedemptionId);

  // Post Reservation B (second SO on same truck/trip!) -> 200 OK!
  const postTripBRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: resTripB.reservationId,
      docuNo: `RD-B-${RUN_ID}`,
      deliveryDocuNo: multiScaleDoc,
      carLicense: tripTruckPlate,
    }),
  });
  assert.equal(postTripBRes.status, 200);
  const dataTripB = await postTripBRes.json();
  assert.equal(dataTripB.status, 'POSTED');
  ownedNativeRedemptionIds.add(dataTripB.nativeRedemptionId);

  // R5-01 11. Negative: Unselected SO C (777783 not in trip) trying to use multiScaleDoc -> 400 DELIVERY_EVIDENCE_MISMATCH
  const couponC = await createOwnedCoupon('R5CUSTC', 10, { soid: 777783 });
  const resTripC = await createOwnedReservation(couponC.cid, couponC.cno, 2, {
    ownerCustId: 'CUST-GAMMA',
    carrierSoId: 777783,
    tripId: multiTripId, // Claims to be in tripId but is NOT in SalesOrderExt/v_TripMember!
  });
  const postTripCRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${warehouseToken}`,
    },
    body: JSON.stringify({
      reservationId: resTripC.reservationId,
      deliveryDocuNo: multiScaleDoc,
      carLicense: tripTruckPlate,
    }),
  });
  assert.equal(postTripCRes.status, 400);
  const dataTripC = await postTripCRes.json();
  assert.equal(dataTripC.code, 'DELIVERY_EVIDENCE_MISMATCH');

  // R6-01: Scenario 1 - Missing carrier identity on reservation -> 400 DELIVERY_EVIDENCE_MISMATCH
  const couponNoCarrier = await createOwnedCoupon('R6NOCAR', 5);
  const resNoCarrier = await createOwnedReservation(couponNoCarrier.cid, couponNoCarrier.cno, 1, {
    tripId: multiTripId,
  });
  await wfQuery(`UPDATE wf.CouponReservation SET CarrierSoId = '', CarrierDocuNo = '' WHERE Id = @id`, {
    id: { type: sql.Int, value: resNoCarrier.reservationId },
  });
  const postNoCarrierRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationId: resNoCarrier.reservationId,
      deliveryDocuNo: multiScaleDoc,
      carLicense: tripTruckPlate,
    }),
  });
  assert.equal(postNoCarrierRes.status, 400);
  const dataNoCarrier = await postNoCarrierRes.json();
  assert.equal(dataNoCarrier.code, 'DELIVERY_EVIDENCE_MISMATCH');

  // R6-01: Scenario 2 - Draft MemberId colliding with native SOID -> 400 DELIVERY_EVIDENCE_MISMATCH
  const draftSoRes = await wfQuery(`
    INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status, TripId, DeliveryDate, SalesUserId, CreatedAt, UpdatedAt)
    OUTPUT INSERTED.Id
    VALUES ('DRAFT-COLLIDE', 'I', 'CUST-DRAFT', 'Draft Customer', 'DRAFT', @tid, GETUTCDATE(), 1, GETUTCDATE(), GETUTCDATE())
  `, {
    tid: { type: sql.Int, value: multiTripId },
  });
  const draftSoId = draftSoRes.recordset[0].Id;
  const couponDraftCollide = await createOwnedCoupon('R6DFCOLL', 5, { soid: draftSoId });
  const resDraftCollide = await createOwnedReservation(couponDraftCollide.cid, couponDraftCollide.cno, 1, {
    carrierSoId: draftSoId,
    carrierDocuNo: 'SO-DRAFT-COLLIDE',
    tripId: multiTripId,
  });
  const postDraftCollideRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationId: resDraftCollide.reservationId,
      deliveryDocuNo: multiScaleDoc,
      carLicense: tripTruckPlate,
    }),
  });
  await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: draftSoId } });
  assert.equal(postDraftCollideRes.status, 400);
  const dataDraftCollide = await postDraftCollideRes.json();
  assert.equal(dataDraftCollide.code, 'DELIVERY_EVIDENCE_MISMATCH');

  // R6-01: Scenario 3 - Empty trip membership with direct SO match -> 400 DELIVERY_EVIDENCE_MISMATCH
  const emptyTripId = await createOwnedTrip('70-7788');
  const emptyTripScaleDoc = `WG-EMPTYTRIP-${RUN_ID}`;
  const soIdEmpty = 777790;
  await createOwnedScaleTicket(emptyTripScaleDoc, '70-7788', soIdEmpty, { status: 'IN', weightIn: 18000 });
  const couponEmptyTrip = await createOwnedCoupon('R6EMPTY', 5, { soid: soIdEmpty });
  const resEmptyTrip = await createOwnedReservation(couponEmptyTrip.cid, couponEmptyTrip.cno, 1, {
    carrierSoId: soIdEmpty,
    carrierDocuNo: 'SO-EMPTY',
    tripId: emptyTripId,
  });
  const postEmptyTripRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationId: resEmptyTrip.reservationId,
      deliveryDocuNo: emptyTripScaleDoc,
      carLicense: '70-7788',
    }),
  });
  assert.equal(postEmptyTripRes.status, 400);
  const dataEmptyTrip = await postEmptyTripRes.json();
  assert.equal(dataEmptyTrip.code, 'DELIVERY_EVIDENCE_MISMATCH');

  // Codex E-02 Regression: Conflicting CarrierSoId (777796) vs Scale SO (777795) with matching DocuNo ('SO-MATCH-DOC')
  // Single writeback test:
  const conflictScaleDoc = `WG-CARRIER-CONF-${RUN_ID}`;
  const soIdScale = 777795;
  const soIdConflict = 777796;
  const matchDocRef = `SO-CARRIER-MATCH-${RUN_ID}`;
  await createOwnedWeighTicket(conflictScaleDoc, '70-9999', soIdScale, { wfRef: matchDocRef, status: 'WEIGH_IN' });
  const couponConflict = await createOwnedCoupon('R6CONF', 5, { soid: soIdConflict });
  const resCarrierConflict = await createOwnedReservation(couponConflict.cid, couponConflict.cno, 1, {
    carrierSoId: soIdConflict,
    carrierDocuNo: matchDocRef, // Matches scale WfRef text, but typed ID differs!
    tripId: null,
  });

  const postConflictSingleRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationId: resCarrierConflict.reservationId,
      deliveryDocuNo: conflictScaleDoc,
      carLicense: '70-9999',
    }),
  });
  assert.equal(postConflictSingleRes.status, 400);
  const dataConflictSingle = await postConflictSingleRes.json();
  assert.equal(dataConflictSingle.code, 'DELIVERY_EVIDENCE_CONFLICT');

  // Batch writeback test:
  const postConflictBatchRes = await fetch(`${baseUrl}/api/coupons/post-native-delivery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationIds: [resCarrierConflict.reservationId],
      deliveryDocuNo: conflictScaleDoc,
      carLicense: '70-9999',
    }),
  });
  assert.equal(postConflictBatchRes.status, 400);
  const dataConflictBatch = await postConflictBatchRes.json();
  assert.equal(dataConflictBatch.code, 'DELIVERY_EVIDENCE_CONFLICT');

  // ───────────────────────────────────────────────────────────────────────────
  // Codex V2-02 Regression Tests: TripCode vs SO DocuNo Differentiation & Multi-SO
  // ───────────────────────────────────────────────────────────────────────────
  const tripV2 = await createOwnedTripWithCode('70-9999');
  const soIdTrip1 = 777797;
  const soIdTrip2 = 777798;
  await attachConfirmedSoToTrip(soIdTrip1, tripV2.tripId, `SO-TRIP-1-${RUN_ID}`);
  await attachConfirmedSoToTrip(soIdTrip2, tripV2.tripId, `SO-TRIP-2-${RUN_ID}`);

  // 1. Dual evidence: Scale document has BOTH dbo.WGHD and wf.WeighTicket referencing TripCode
  const tripScaleDoc = `WG-TRIP-PASS-${RUN_ID}`;
  await createOwnedScaleTicket(tripScaleDoc, '70-9999', soIdTrip1, { status: '1', weightIn: 15000 });
  await createOwnedWeighTicket(tripScaleDoc, '70-9999', soIdTrip1, {
    wfRef: tripV2.tripCode, // Authoritative TripCode reference in WeighTicket!
    status: 'DONE',
    tareKg: 10000,
    grossKg: 25000,
    netKg: 15000,
  });

  const couponTrip1 = await createOwnedCoupon('V2TRIP1', 5, { soid: soIdTrip1 });
  const resTrip1 = await createOwnedReservation(couponTrip1.cid, couponTrip1.cno, 1, {
    carrierSoId: soIdTrip1,
    carrierDocuNo: `SO-TRIP-1-${RUN_ID}`,
    tripId: tripV2.tripId,
  });

  // Positive Single TripCode writeback: Must be ACCEPTED (NOT rejected with DELIVERY_EVIDENCE_CONFLICT)
  const postTripSingleRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationId: resTrip1.reservationId,
      deliveryDocuNo: tripScaleDoc,
      carLicense: '70-9999',
    }),
  });
  assert.equal(postTripSingleRes.status, 200, 'Positive single TripCode scale reference must succeed');
  const dataTripSingle = await postTripSingleRes.json();
  assert.equal(dataTripSingle.status, 'POSTED');
  assert.ok(dataTripSingle.nativeDocuNo);

  // Positive Batch Multi-SO TripCode writeback (second SO on same trip)
  const tripBatchScaleDoc = `WG-TBATCH-PASS-${RUN_ID}`;
  await createOwnedScaleTicket(tripBatchScaleDoc, '70-9999', soIdTrip1, { status: '1', weightIn: 25000 });
  await createOwnedWeighTicket(tripBatchScaleDoc, '70-9999', soIdTrip1, {
    wfRef: tripV2.tripCode,
    status: 'DONE',
    tareKg: 10000,
    grossKg: 35000,
    netKg: 25000,
  });

  const couponTrip2 = await createOwnedCoupon('V2TRIP2', 5, { soid: soIdTrip2 });
  const resTrip2 = await createOwnedReservation(couponTrip2.cid, couponTrip2.cno, 1, {
    carrierSoId: soIdTrip2,
    carrierDocuNo: `SO-TRIP-2-${RUN_ID}`,
    tripId: tripV2.tripId,
  });

  const postTripBatchRes = await fetch(`${baseUrl}/api/coupons/post-native-delivery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationIds: [resTrip2.reservationId],
      deliveryDocuNo: tripBatchScaleDoc,
      carLicense: '70-9999',
    }),
  });
  assert.equal(postTripBatchRes.status, 200, 'Batch writeback with multi-SO TripCode scale reference must succeed');
  const dataTripBatch = await postTripBatchRes.json();
  assert.equal(dataTripBatch.success, true);

  // Negative: Reservation with internal contradiction in trip (CarrierSoId and CarrierDocuNo pointing to different members)
  const tripConflictScaleDoc = `WG-TCONF-${RUN_ID}`;
  await createOwnedScaleTicket(tripConflictScaleDoc, '70-9999', soIdTrip1, { status: '1', weightIn: 25000 });
  await createOwnedWeighTicket(tripConflictScaleDoc, '70-9999', soIdTrip1, {
    wfRef: tripV2.tripCode,
    status: 'DONE',
    tareKg: 10000,
    grossKg: 35000,
    netKg: 25000,
  });

  const couponTripConflict = await createOwnedCoupon('V2TRIPCONF', 5, { soid: soIdTrip1 });
  const resTripConflict = await createOwnedReservation(couponTripConflict.cid, couponTripConflict.cno, 1, {
    carrierSoId: soIdTrip1, // SO 1
    carrierDocuNo: `SO-TRIP-2-${RUN_ID}`, // DocuNo of SO 2 -> Contradiction!
    tripId: tripV2.tripId,
  });

  const postTripConflictRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationId: resTripConflict.reservationId,
      deliveryDocuNo: tripConflictScaleDoc,
      carLicense: '70-9999',
    }),
  });
  assert.equal(postTripConflictRes.status, 400);
  const dataTripConflict = await postTripConflictRes.json();
  assert.equal(dataTripConflict.code, 'DELIVERY_EVIDENCE_CONFLICT');

  // Negative: Reservation with SO not in trip -> 400 DELIVERY_EVIDENCE_MISMATCH
  const tripMismatchScaleDoc = `WG-TMIS-${RUN_ID}`;
  await createOwnedScaleTicket(tripMismatchScaleDoc, '70-9999', soIdTrip1, { status: '1', weightIn: 25000 });
  await createOwnedWeighTicket(tripMismatchScaleDoc, '70-9999', soIdTrip1, {
    wfRef: tripV2.tripCode,
    status: 'DONE',
    tareKg: 10000,
    grossKg: 35000,
    netKg: 25000,
  });

  const couponTripMismatch = await createOwnedCoupon('V2TRIPMIS', 5, { soid: 999992 });
  const resTripMismatch = await createOwnedReservation(couponTripMismatch.cid, couponTripMismatch.cno, 1, {
    carrierSoId: 999992,
    carrierDocuNo: `SO-UNRELATED-${RUN_ID}`,
    tripId: tripV2.tripId,
  });

  const postTripMismatchRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${warehouseToken}` },
    body: JSON.stringify({
      reservationId: resTripMismatch.reservationId,
      deliveryDocuNo: tripMismatchScaleDoc,
      carLicense: '70-9999',
    }),
  });
  assert.equal(postTripMismatchRes.status, 400);
  const dataTripMismatch = await postTripMismatchRes.json();
  assert.equal(dataTripMismatch.code, 'DELIVERY_EVIDENCE_MISMATCH');
});

// ─────────────────────────────────────────────────────────────
// 19. R3-05: Warning & Override Audit Evidence & UI Delivery
// ─────────────────────────────────────────────────────────────
test('UAT-19: R3-05 Policy warnings returned in API and persisted in wf.ChangeEvent', async () => {
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

  try {
    const coupon = await createOwnedCoupon('R3WARN', 10);
    await createOwnedOverlay(coupon.cid, coupon.cno, { expiryDate: '2020-01-01', strictOverride: false });
    const reservation = await createOwnedReservation(coupon.cid, coupon.cno, 2, { carrierSoId: coupon.soid });
    const deliveryDocuNo = `DOC-${RUN_ID}-WARN`;
    await createOwnedScaleTicket(deliveryDocuNo, '70-6666', coupon.soid);

    // 1. Post coupon with soft-expired date under default Strict OFF
    const res = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${warehouseToken}`,
      },
      body: JSON.stringify({
        reservationId: reservation.reservationId,
        deliveryDocuNo,
        carLicense: '70-6666',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'POSTED');
    assert.ok(Array.isArray(data.warnings), 'Must deliver warnings array');
    assert.ok(data.warnings.length > 0, 'Must contain expiry warning message');
    ownedNativeRedemptionIds.add(data.nativeRedemptionId);

    // 2. Assert audit evidence in wf.ChangeEvent
    const auditRows = await wfQ(`
      SELECT * FROM wf.ChangeEvent 
      WHERE EntityType = 'COUPON_POSTING' AND EntityId = @id
    `, {
      id: { type: sql.VarChar(50), value: String(reservation.reservationId) },
    });
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].ReasonCode, 'EXPIRY_WARNING');
    assert.ok(auditRows[0].ReasonText.includes('2020-01-01'));

    // 3. Assert idempotent replay delivers the same warning (R4-04)
    const replayRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${warehouseToken}`,
      },
      body: JSON.stringify({
        reservationId: reservation.reservationId,
        deliveryDocuNo,
        carLicense: '70-6666',
      }),
    });
    assert.equal(replayRes.status, 200);
    const replayData = await replayRes.json();
    assert.equal(replayData.idempotent, true);
    assert.ok(Array.isArray(replayData.warnings));
    assert.equal(replayData.warnings[0], data.warnings[0], 'R4-04: Replay must deliver exact original warnings');

    // R4-04: Even after policy settings change to strict, replay still returns original warnings and does not block
    await wfQuery(`UPDATE wf.SystemSetting SET SettingValue = 'true' WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`);
    const replayStrictRes = await fetch(`${baseUrl}/api/coupons/post-native`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${warehouseToken}`,
      },
      body: JSON.stringify({
        reservationId: reservation.reservationId,
        deliveryDocuNo,
        carLicense: '70-6666',
      }),
    });
    assert.equal(replayStrictRes.status, 200);
    const replayStrictData = await replayStrictRes.json();
    assert.equal(replayStrictData.idempotent, true);

    // Assert NO new audit rows created on replay
    const auditCount = await wfQ(`
      SELECT COUNT(*) AS c FROM wf.ChangeEvent 
      WHERE EntityType = 'COUPON_POSTING' AND EntityId = @id
    `, {
      id: { type: sql.VarChar(50), value: String(reservation.reservationId) },
    });
    assert.equal(auditCount[0].c, 1, 'R4-04: Replay must not create additional audit records');
  } finally {
    // R6-02: Restore server policy to exact captured before-image
    await restoreBlockExpiredSetting();
  }
});

// ─────────────────────────────────────────────────────────────
// 20. R5-03: Migration Acceptance Test on Actual Artifacts
// ─────────────────────────────────────────────────────────────
test('UAT-20: R5-03 Migration 130/131 acceptance test on actual migration files in isolated rollback fixture', async () => {
  await runWithTarget('remote_b', async () => {
    const { pools, sql } = require('../db');
    const { splitBatches } = require('../run_migrations');
    const pl = pools();
    await pl.ready;

    // 1. Read the EXACT immutable migration files from disk
    const sql130Path = path.join(__dirname, '../migrations/130_correct_mirror_provenance_strict_identity.sql');
    const sql131Path = path.join(__dirname, '../migrations/131_correct_mirror_provenance_native_uniqueness.sql');
    const sql132Path = path.join(__dirname, '../migrations/132_correct_mirror_provenance_native_identity.sql');
    const sql130 = fs.readFileSync(sql130Path, 'utf8');
    const sql131 = fs.readFileSync(sql131Path, 'utf8');
    const sql132 = fs.readFileSync(sql132Path, 'utf8');

    // 2. Open an isolated transaction on ownerPool for rollback safety (Zero shared-DB contamination)
    const tx = new sql.Transaction(pl.ownerPool);
    await tx.begin();

    try {
      const baseId = 980000 + Math.floor(Math.random() * 4000);
      const rExact = baseId + 10;
      const rLegacyValid = baseId + 11;
      const rNoRes = baseId + 12;
      const rMultiRes = baseId + 13;
      const rConfNative1 = baseId + 14;
      const rConfNative2 = baseId + 15;
      const rDupMirror1 = baseId + 16;
      const rDupMirror2 = baseId + 17;
      const rWrongNatMirror = baseId + 18;
      const rWrongNatHeader = baseId + 19;
      const canaryId = baseId + 99;

      const docExact = `DOC-${RUN_ID}-EXACT`;
      const docLegacy = `DOC-${RUN_ID}-LEGACY`;
      const docNoRes = `DOC-${RUN_ID}-NORES`;
      const docMultiRes = `DOC-${RUN_ID}-MULTRES`;
      const docConfNative = `DOC-${RUN_ID}-CONFNAT`;
      const docDupMirror = `DOC-${RUN_ID}-DUPMIR`;
      const docWrongNat = `DOC-${RUN_ID}-WRONGNAT`;
      const docCanary = `DOC-${RUN_ID}-CANARY`;

      const cid = 1156;

      // Seed Canary Row: MUST remain untouched
      await tx.request().query(`
        INSERT INTO wf.CouponRedemptionMirror (RedemtionID, CouponID, DocuNo, RedeemedTon, Source, Status, RedeemedAt)
        VALUES (${canaryId}, ${cid}, '${docCanary}', 9.9, 'CANARY_SRC', 'CANARY_STATUS', GETUTCDATE())
      `);

      // Seed Test Case 1: Exact Primary Key Link
      await tx.request().query(`
        INSERT INTO wf.CouponReservation (CouponId, CouponNo, GoodId, CarrierSoId, ReservedQty, BeneficiaryCustId, OwnerCustId, Status, NativeDocuNo, NativeRedemptionId, CreatedBy, Revision, IdempotencyKey)
        VALUES (${cid}, 'C-EXACT', 1156, '999999', 2.0, 'CUST-TEST', 'CUST-TEST', 'POSTED', '${docExact}', ${rExact}, 1, 1, 'IDEM-${docExact}');

        INSERT INTO wf.CouponRedemptionMirror (RedemtionID, CouponID, DocuNo, RedeemedTon, Source, Status, RedeemedAt)
        VALUES (${rExact}, ${cid}, '${docExact}', 2.0, 'UNKNOWN', 'UNKNOWN', GETUTCDATE());
      `);

      // Seed Test Case 2: Unambiguous 1:1 legacy fallback
      // Exactly 1 POSTED reservation (NativeRedemptionId IS NULL), 1 mirror row, 1 native WFRedemtionHD row
      await tx.request().query(`
        INSERT INTO wf.CouponReservation (CouponId, CouponNo, GoodId, CarrierSoId, ReservedQty, BeneficiaryCustId, OwnerCustId, Status, NativeDocuNo, NativeRedemptionId, CreatedBy, Revision, IdempotencyKey)
        VALUES (${cid}, 'C-LEGACY', 1156, '999999', 3.0, 'CUST-TEST', 'CUST-TEST', 'POSTED', '${docLegacy}', NULL, 1, 1, 'IDEM-${docLegacy}');

        INSERT INTO wf.CouponRedemptionMirror (RedemtionID, CouponID, DocuNo, RedeemedTon, Source, Status, RedeemedAt)
        VALUES (${rLegacyValid}, ${cid}, '${docLegacy}', 3.0, 'UNKNOWN', 'UNKNOWN', GETUTCDATE());

        INSERT INTO dbo.WFRedemtionHD (RedemtionID, DocuNo, DocuDate)
        VALUES (${rLegacyValid}, '${docLegacy}', GETUTCDATE());
      `);

      // Seed Test Case 3: 0 legacy reservations (Mirror has row, but 0 reservations exist)
      await tx.request().query(`
        INSERT INTO wf.CouponRedemptionMirror (RedemtionID, CouponID, DocuNo, RedeemedTon, Source, Status, RedeemedAt)
        VALUES (${rNoRes}, ${cid}, '${docNoRes}', 1.0, 'SALE_APP', 'COMPLETED', GETUTCDATE());
      `);

      // Seed Test Case 4: Multiple legacy reservations (2 POSTED reservations under same DocuNo) -> ambiguous!
      await tx.request().query(`
        INSERT INTO wf.CouponReservation (CouponId, CouponNo, GoodId, CarrierSoId, ReservedQty, BeneficiaryCustId, OwnerCustId, Status, NativeDocuNo, NativeRedemptionId, CreatedBy, Revision, IdempotencyKey)
        VALUES (${cid}, 'C-M1', 1156, '999999', 1.0, 'CUST-TEST', 'CUST-TEST', 'POSTED', '${docMultiRes}', NULL, 1, 1, 'IDEM-${docMultiRes}-1'),
               (${cid}, 'C-M2', 1156, '999999', 1.0, 'CUST-TEST', 'CUST-TEST', 'POSTED', '${docMultiRes}', NULL, 1, 1, 'IDEM-${docMultiRes}-2');

        INSERT INTO wf.CouponRedemptionMirror (RedemtionID, CouponID, DocuNo, RedeemedTon, Source, Status, RedeemedAt)
        VALUES (${rMultiRes}, ${cid}, '${docMultiRes}', 2.0, 'SALE_APP', 'COMPLETED', GETUTCDATE());

        INSERT INTO dbo.WFRedemtionHD (RedemtionID, DocuNo, DocuDate)
        VALUES (${rMultiRes}, '${docMultiRes}', GETUTCDATE());
      `);

      // Seed Test Case 5: Conflicting native WFRedemtionHD headers (2 distinct RedemtionIDs for same DocuNo in WinSpeed) -> ambiguous!
      await tx.request().query(`
        INSERT INTO wf.CouponReservation (CouponId, CouponNo, GoodId, CarrierSoId, ReservedQty, BeneficiaryCustId, OwnerCustId, Status, NativeDocuNo, NativeRedemptionId, CreatedBy, Revision, IdempotencyKey)
        VALUES (${cid}, 'C-CN1', 1156, '999999', 1.0, 'CUST-TEST', 'CUST-TEST', 'POSTED', '${docConfNative}', NULL, 1, 1, 'IDEM-${docConfNative}');

        INSERT INTO wf.CouponRedemptionMirror (RedemtionID, CouponID, DocuNo, RedeemedTon, Source, Status, RedeemedAt)
        VALUES (${rConfNative1}, ${cid}, '${docConfNative}', 1.0, 'SALE_APP', 'COMPLETED', GETUTCDATE());

        INSERT INTO dbo.WFRedemtionHD (RedemtionID, DocuNo, DocuDate)
        VALUES (${rConfNative1}, '${docConfNative}', GETUTCDATE()),
               (${rConfNative2}, '${docConfNative}', GETUTCDATE());
      `);

      // Seed Test Case 6: Duplicate DocuNo in mirror with different RedemtionID -> ambiguous!
      await tx.request().query(`
        INSERT INTO wf.CouponReservation (CouponId, CouponNo, GoodId, CarrierSoId, ReservedQty, BeneficiaryCustId, OwnerCustId, Status, NativeDocuNo, NativeRedemptionId, CreatedBy, Revision, IdempotencyKey)
        VALUES (${cid}, 'C-DM', 1156, '999999', 2.0, 'CUST-TEST', 'CUST-TEST', 'POSTED', '${docDupMirror}', NULL, 1, 1, 'IDEM-${docDupMirror}');

        INSERT INTO wf.CouponRedemptionMirror (RedemtionID, CouponID, DocuNo, RedeemedTon, Source, Status, RedeemedAt)
        VALUES (${rDupMirror1}, ${cid}, '${docDupMirror}', 2.0, 'SALE_APP', 'COMPLETED', GETUTCDATE()),
               (${rDupMirror2}, ${cid}, '${docDupMirror}', 2.0, 'SALE_APP', 'COMPLETED', GETUTCDATE());

        INSERT INTO dbo.WFRedemtionHD (RedemtionID, DocuNo, DocuDate)
        VALUES (${rDupMirror1}, '${docDupMirror}', GETUTCDATE());
      `);

      // Seed Test Case 7 (R6-03): Sole native header exists but has DIFFERENT RedemtionID (A != B)
      // Mirror claims RedemtionID A, but native table has RedemtionID B -> must NOT claim SALE_APP
      await tx.request().query(`
        INSERT INTO wf.CouponReservation (CouponId, CouponNo, GoodId, CarrierSoId, ReservedQty, BeneficiaryCustId, OwnerCustId, Status, NativeDocuNo, NativeRedemptionId, CreatedBy, Revision, IdempotencyKey)
        VALUES (${cid}, 'C-WN', 1156, '999999', 1.0, 'CUST-TEST', 'CUST-TEST', 'POSTED', '${docWrongNat}', NULL, 1, 1, 'IDEM-${docWrongNat}');

        INSERT INTO wf.CouponRedemptionMirror (RedemtionID, CouponID, DocuNo, RedeemedTon, Source, Status, RedeemedAt)
        VALUES (${rWrongNatMirror}, ${cid}, '${docWrongNat}', 1.0, 'SALE_APP', 'COMPLETED', GETUTCDATE());

        INSERT INTO dbo.WFRedemtionHD (RedemtionID, DocuNo, DocuDate)
        VALUES (${rWrongNatHeader}, '${docWrongNat}', GETUTCDATE());
      `);

      // 3. Execute the EXACT immutable migration files through splitBatches
      const batches130 = splitBatches(sql130);
      for (const b of batches130) {
        await tx.request().batch(b);
      }
      const batches131 = splitBatches(sql131);
      for (const b of batches131) {
        await tx.request().batch(b);
      }
      const batches132 = splitBatches(sql132);
      for (const b of batches132) {
        await tx.request().batch(b);
      }

      // 4. Assert outcomes
      // Case 1: Exact link -> authoritatively SALE_APP / POSTED
      const rowExact = (await tx.request().query(`
        SELECT Source, Status FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${rExact} AND CouponID = ${cid}
      `)).recordset?.[0];
      assert.equal(rowExact.Source, 'SALE_APP');
      assert.equal(rowExact.Status, 'POSTED');

      // Case 2: Unambiguous 1:1 legacy fallback -> SALE_APP / POSTED
      const rowLegacy = (await tx.request().query(`
        SELECT Source, Status FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${rLegacyValid} AND CouponID = ${cid}
      `)).recordset?.[0];
      assert.equal(rowLegacy.Source, 'SALE_APP');
      assert.equal(rowLegacy.Status, 'POSTED');

      // Case 3: 0 legacy reservations -> downgraded to UNKNOWN / UNKNOWN
      const rowNoRes = (await tx.request().query(`
        SELECT Source, Status FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${rNoRes} AND CouponID = ${cid}
      `)).recordset?.[0];
      assert.equal(rowNoRes.Source, 'UNKNOWN');
      assert.equal(rowNoRes.Status, 'UNKNOWN');

      // Case 4: Multiple legacy reservations -> ambiguous, must be UNKNOWN / UNKNOWN
      const rowMultiRes = (await tx.request().query(`
        SELECT Source, Status FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${rMultiRes} AND CouponID = ${cid}
      `)).recordset?.[0];
      assert.equal(rowMultiRes.Source, 'UNKNOWN', 'Multiple reservations under same DocuNo must remain UNKNOWN');
      assert.equal(rowMultiRes.Status, 'UNKNOWN');

      // Case 5: Conflicting native WFRedemtionHD headers -> ambiguous in WinSpeed ERP, must be UNKNOWN / UNKNOWN
      const rowConfNative = (await tx.request().query(`
        SELECT Source, Status FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${rConfNative1} AND CouponID = ${cid}
      `)).recordset?.[0];
      assert.equal(rowConfNative.Source, 'UNKNOWN', 'Conflicting native WFRedemtionHD headers must remain UNKNOWN');
      assert.equal(rowConfNative.Status, 'UNKNOWN');

      // Case 6: Duplicate DocuNo in Mirror -> ambiguous, must be UNKNOWN / UNKNOWN
      const rowDup1 = (await tx.request().query(`
        SELECT Source, Status FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${rDupMirror1} AND CouponID = ${cid}
      `)).recordset?.[0];
      assert.equal(rowDup1.Source, 'UNKNOWN');
      assert.equal(rowDup1.Status, 'UNKNOWN');

      // Case 7 (R6-03): Mismatched RedemtionID between mirror and sole native header (A != B) -> UNKNOWN / UNKNOWN
      const rowWrongNat = (await tx.request().query(`
        SELECT Source, Status FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${rWrongNatMirror} AND CouponID = ${cid}
      `)).recordset?.[0];
      assert.equal(rowWrongNat.Source, 'UNKNOWN', 'Mirror row with mismatched native RedemtionID must remain UNKNOWN');
      assert.equal(rowWrongNat.Status, 'UNKNOWN');

      // Canary assertion: Unrelated canary row must remain completely UNTOUCHED
      const rowCanary = (await tx.request().query(`
        SELECT Source, Status FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${canaryId} AND CouponID = ${cid}
      `)).recordset?.[0];
      assert.equal(rowCanary.Source, 'CANARY_SRC', 'Unrelated canary row Source must be untouched');
      assert.equal(rowCanary.Status, 'CANARY_STATUS', 'Unrelated canary row Status must be untouched');
    } finally {
      // 5. Roll back transaction completely - ZERO permanent mutations on shared database
      await tx.rollback();
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 21. R6-02: Teardown Safety & Restoration on Injected Failure
// ─────────────────────────────────────────────────────────────
test('UAT-21: R6-02 Teardown safety: Setting restoration succeeds in outer finally despite injected cleanup failure', async () => {
  await runWithTarget('remote_b', async () => {
    // 1. Verify before-image was captured
    assert.equal(beforeImageCaptured, true, 'Before-image must be captured in test.before');

    // 2. Temporarily mutate setting to an isolated test value
    const testMutatedValue = 'MUTATED_TEST_VAL';
    await wfQuery(`UPDATE wf.SystemSetting SET SettingValue = @val WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`, {
      val: { type: sql.VarChar(50), value: testMutatedValue },
    });

    const verifyMutated = (await wfQuery(`SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`)).recordset?.[0]?.SettingValue;
    assert.equal(verifyMutated, testMutatedValue);

    // 3. Simulate teardown execution where cleanup encounters an intentional error
    let injectedError = null;
    try {
      try {
        throw new Error('Simulated Cleanup Injected Failure (FK or trigger failure)');
      } finally {
        // Outer finally: Setting restoration runs unconditionally
        await restoreBlockExpiredSetting();
      }
    } catch (err) {
      injectedError = err;
    }

    // 4. Assert injected error was retained and reported (not swallowed)
    assert.ok(injectedError !== null, 'Injected cleanup error must not be swallowed');
    assert.match(injectedError.message, /Simulated Cleanup Injected Failure/);

    // 5. Assert setting was authoritatively restored to exact before-image despite the failure!
    const restoredRow = (await wfQuery(`SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = 'CONTROL_TICKET_BLOCK_EXPIRED'`)).recordset?.[0];
    if (originalSettingExists) {
      assert.equal(restoredRow?.SettingValue, originalBlockExpiredValue, 'Setting must match exact original before-image value');
    } else {
      assert.equal(restoredRow, undefined, 'Setting row must be deleted if it did not originally exist');
    }
  });
});

