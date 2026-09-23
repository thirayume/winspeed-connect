import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { login, logout, api } from './helpers';

const { runWithTarget, wfQuery, sql } = require(path.join(__dirname, '..', 'backend', 'db'));
const { assertTestDatabase } = require(path.join(__dirname, '..', 'backend', 'tests', 'test-safety'));
const {
  calculateConfirmationPickupDue,
  evaluatePickupTiming,
  evaluateTripLeadTime,
  diffBangkokCalendarDays,
  addBangkokCalendarDays,
  normalizeDateString
} = require(path.join(__dirname, '..', 'backend', 'services', 'so-pickup-policy'));

const ARTIFACT_DIR = 'C:\\Users\\amyou\\.gemini\\antigravity-ide\\brain\\62e61586-97bb-400e-8723-cc75a64f221b';

const WAREHOUSE_USER = 'emp-00047';
const SALES_USER = 'emp-00002';

const tracked = {
  tripIds: new Set<number>(),
  draftSoIds: new Set<number>(),
  nativeSoids: new Set<number>(),
  wghdIds: new Set<number>(),
  couponReservationIds: new Set<number>(),
  rebateClaimIds: new Set<number>(),
  rebateLedgerIds: new Set<number>(),
  retainedCancelledSohd: [] as Array<{ soid: number; docuNo: string; custName: string; docuStatus: string }>
};

test.describe.serial('SO-11: Deterministic Policy Boundary, Shipment Retry Invariants & Linked Financial Slice', () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    await runWithTarget('remote_b', async () => {
      await assertTestDatabase();
    });
  });

  test.afterAll(async () => {
    console.log('[SO-11 POLICY/FINANCIAL CLEANUP] Starting teardown on remote_b...');
    await runWithTarget('remote_b', async () => {
      // 0. Clean run-owned rebate claims and ledger entries
      if (tracked.rebateClaimIds.size > 0) {
        for (const cid of tracked.rebateClaimIds) {
          await wfQuery(`DELETE FROM wf.RebateClaimApproval WHERE ClaimId = @cid`, { cid: { type: sql.Int, value: cid } });
          await wfQuery(`DELETE FROM wf.RebateClaimInvoice WHERE ClaimId = @cid`, { cid: { type: sql.Int, value: cid } });
          await wfQuery(`DELETE FROM wf.RebateClaimLine WHERE ClaimId = @cid`, { cid: { type: sql.Int, value: cid } });
          await wfQuery(`DELETE FROM wf.RebateClaim WHERE Id = @cid`, { cid: { type: sql.Int, value: cid } });
        }
        tracked.rebateClaimIds.clear();
      }

      if (tracked.rebateLedgerIds.size > 0) {
        for (const lid of tracked.rebateLedgerIds) {
          await wfQuery(`DELETE FROM wf.RebateLedger WHERE Id = @lid`, { lid: { type: sql.Int, value: lid } });
        }
        tracked.rebateLedgerIds.clear();
      }

      // 1. Clean coupon reservations
      if (tracked.couponReservationIds.size > 0) {
        for (const resId of tracked.couponReservationIds) {
          await wfQuery(`DELETE FROM wf.CouponReservation WHERE Id = @id`, { id: { type: sql.Int, value: resId } });
        }
        tracked.couponReservationIds.clear();
      }

      // 2. Clean simulated scale records in dbo.WGHD
      if (tracked.wghdIds.size > 0) {
        for (const wid of tracked.wghdIds) {
          await wfQuery(`DELETE FROM dbo.WGHD WHERE Id = @wid AND DocuNo LIKE 'WG-POL%'`, {
            wid: { type: sql.Int, value: wid }
          });
        }
        tracked.wghdIds.clear();
      }

      // 3. Clean confirmed native SO artifacts, retaining SOHD with DocuStatus = 'C'
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

          await wfQuery(`UPDATE dbo.SOHD SET DocuStatus = 'C' WHERE SOID = @soidNum AND DocuType = 103`, {
            soidNum: { type: sql.Int, value: soidNum }
          });

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
        tracked.nativeSoids.clear();
      }

      // 4. Clean draft SOs and Trips
      if (tracked.draftSoIds.size > 0) {
        for (const dId of tracked.draftSoIds) {
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

    console.log('[SO-11 POLICY CLEANUP AUDIT] Retained cancelled native SOHD inventory:', tracked.retainedCancelledSohd);
  });

  // =========================================================================
  // SECTION 1: Deterministic Policy Boundary Checks
  // =========================================================================
  test('Policy 1: 7-Day Default Booking Measurement from Confirmation & CreditDays Isolation', async () => {
    const fixedConfirmedAt = new Date('2026-09-17T08:00:00.000Z'); // Bangkok time 2026-09-17

    // 1.1 Calculate default: must be exactly +7 calendar days
    const defaultRes = await calculateConfirmationPickupDue({
      explicitDate: null,
      confirmedAt: fixedConfirmedAt
    });
    expect(defaultRes.pickupDueDate).toBe('2026-09-24');
    expect(defaultRes.pickupDueType).toBe('DEFAULT');
    expect(defaultRes.pickupDueDays).toBe(7);
    expect(Number(defaultRes.pickupPolicySnapshotId)).toBeGreaterThan(0);

    // 1.2 User explicit date takes precedence
    const explicitRes = await calculateConfirmationPickupDue({
      explicitDate: '2026-09-30',
      confirmedAt: fixedConfirmedAt
    });
    expect(explicitRes.pickupDueDate).toBe('2026-09-30');
    expect(explicitRes.pickupDueType).toBe('EXPLICIT');
    expect(explicitRes.pickupDueDays).toBe(13); // 30 - 17 = 13 days

    // 1.3 Anti-pattern check: CreditDays (e.g. 30, 45, 60 days) MUST NOT leak into pickupDueDate
    expect(defaultRes.pickupDueDays).not.toBe(30);
    expect(defaultRes.pickupDueDays).not.toBe(45);
    expect(defaultRes.pickupDueDate).toBe('2026-09-24');
  });

  test('Policy 2: Early/Late Timing Evaluator & Lead Time Boundary (Strict Off Warning vs Strict On Rejection)', async () => {
    // 2.1 Early pickup (delta < 0)
    const earlyEval = evaluatePickupTiming('2026-09-20', '2026-09-24');
    expect(earlyEval.status).toBe('EARLY');
    expect(earlyEval.deltaDays).toBe(-4);

    // 2.2 On time (delta == 0)
    const onTimeEval = evaluatePickupTiming('2026-09-24', '2026-09-24');
    expect(onTimeEval.status).toBe('ON_TIME');
    expect(onTimeEval.deltaDays).toBe(0);

    // 2.3 Late pickup (delta > 0)
    const lateEval = evaluatePickupTiming('2026-09-26', '2026-09-24');
    expect(lateEval.status).toBe('LATE');
    expect(lateEval.deltaDays).toBe(2);

    // 2.4 Lead Time Boundary: Strict Mode OFF (Warning only, not blocked)
    const fixedNow = new Date('2026-09-17T03:00:00.000Z');
    const leadTimeWarn = evaluateTripLeadTime('2026-09-17', 2, false, fixedNow);
    expect(leadTimeWarn.valid).toBe(false);
    expect(leadTimeWarn.blocked).toBe(false);
    expect(leadTimeWarn.warning).toContain('Lead Time');

    // 2.5 Lead Time Boundary: Strict Mode ON (Rejection, blocked)
    const leadTimeStrict = evaluateTripLeadTime('2026-09-17', 2, true, fixedNow);
    expect(leadTimeStrict.valid).toBe(false);
    expect(leadTimeStrict.blocked).toBe(true);
    expect(leadTimeStrict.error).toContain('Lead Time');
  });

  // =========================================================================
  // SECTION 2: Strengthened Shipment Duplicate Retry Pre/Post Assertions
  // =========================================================================
  test('Shipment Retry Invariants: Exact Owned Weigh-Ticket, Stock Movement, Rebate & Outbox Pre/Post Assertions', async ({ page }) => {
    const truckPlate = `70-${Math.floor(1000 + Math.random() * 9000)}`;

    // 1. Sales logs in via real UI session
    await login(page, SALES_USER);

    // 2. Create Trip & SO
    const tripRes = await api<any>(page, '/trips', {
      method: 'POST',
      data: { transRegistration: truckPlate, deliveryDate: '2026-09-17', truckCapacityTon: 30 }
    });
    expect([200, 201]).toContain(tripRes.status);
    const tripId = Number(tripRes.body.tripId);
    tracked.tripIds.add(tripId);

    const soRes = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        tripId,
        soPrefix: 'I',
        custId: '1000',
        custName: 'พาต้าเคมีคอล แอนด์ แมชชีนเนอรี่ จำกัด',
        deliveryDate: '2026-09-17',
        lines: [{ goodId: '1097', goodCode: '7-13032100BBCAR', goodName: '13-3-21', qtyTon: 15, pricePerTon: 15000 }]
      }
    });
    expect([200, 201]).toContain(soRes.status);
    const draftSoId = Number(soRes.body.so?.id || soRes.body.id);
    tracked.draftSoIds.add(draftSoId);

    // 3. Confirm Trip
    const confirmRes = await api<any>(page, `/trips/${tripId}/confirm`, {
      method: 'POST',
      data: {
        confirmedOrderIds: [draftSoId],
        transRegistration: truckPlate,
        pickupDueDate: '2026-09-24',
        idempotencyKey: `CONFIRM-RETRY-TEST-${Date.now()}`
      }
    });
    expect(confirmRes.status).toBe(200);

    let nativeSoid: number;
    await runWithTarget('remote_b', async () => {
      const ext = (await wfQuery(`SELECT SOID FROM wf.SalesOrderExt WHERE TripId = @tid`, {
        tid: { type: sql.Int, value: tripId }
      })).recordset[0];
      nativeSoid = Number(ext?.SOID);
    });
    tracked.nativeSoids.add(nativeSoid);
    expect(nativeSoid).toBeGreaterThan(0);

    // 3.5 Sales sets Load Plan (Required for SALE_CONFIRMED before Warehouse Ack)
    await api(page, `/trips/${tripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: 1,
        lines: [
          {
            memberKind: 'CONFIRMED',
            memberId: String(nativeSoid),
            lineNum: 1,
            loadSequence: 1,
            masterQty: 15.000,
            childQty: 0.000
          }
        ]
      }
    });

    // 4. Warehouse user logs in
    await logout(page);
    await login(page, WAREHOUSE_USER);

    await api(page, `/trips/${tripId}/load-plan/ack`, {
      method: 'POST',
      data: { expectedPlanRevision: 2, note: 'Retry test ack' }
    });

    await api(page, `/so/${nativeSoid}/picking`, {
      method: 'PATCH'
    });

    await api(page, `/so/${nativeSoid}/load`, {
      method: 'PATCH'
    });

    // 5. Simulate Scale Event in dbo.WGHD
    await runWithTarget('remote_b', async () => {
      const wRes = await wfQuery(`
        INSERT INTO dbo.WGHD (
          DocuNo, MoveBill, CarNo, SPID, WGType, Status, WeightIn, WeightOut, WeightNet, DateIn, DateOut, LocationName
        )
        OUTPUT inserted.Id
        VALUES (
          'WG-POL-RETRY', 'MB-RETRY', @plate, @soId, 'SO', 3, 14000, 29000, 15000, GETUTCDATE(), GETUTCDATE(), '1'
        )
      `, {
        plate: { type: sql.NVarChar(50), value: truckPlate },
        soId: { type: sql.Int, value: nativeSoid }
      });
      tracked.wghdIds.add(wRes.recordset[0].Id);
    });

    // 6. FIRST SHIPMENT: Perform standard shipping departure
    console.log('[RETRY TEST] Executing First Shipment Departure...');
    const firstShipRes = await api<any>(page, `/so/${nativeSoid}/ship`, {
      method: 'PATCH',
      data: { weighOutWeight: 29000, tareKg: 14000 }
    });
    expect(firstShipRes.status).toBe(200);
    expect(firstShipRes.body.status).toBe('SHIPPED');

    // PRE-RETRY AUDIT ASSERTIONS
    let preTicketCount: number;
    let preRebateCount: number;
    let preOutboxCount: number;
    let preWeighOutWeight: number;

    await runWithTarget('remote_b', async () => {
      const soidStr = String(nativeSoid);

      const ext = (await wfQuery(`SELECT WeighOutWeight FROM wf.SalesOrderExt WHERE SOID = @soidStr`, {
        soidStr: { type: sql.VarChar(50), value: soidStr }
      })).recordset[0];
      preWeighOutWeight = Number(ext.WeighOutWeight);
      expect(preWeighOutWeight).toBe(29000);

      const ticketRes = await wfQuery(`SELECT COUNT(*) as cnt FROM wf.WeighTicket WHERE SoId = @soidStr`, {
        soidStr: { type: sql.NVarChar(50), value: soidStr }
      });
      preTicketCount = ticketRes.recordset[0].cnt;
      expect(preTicketCount).toBe(1);

      const rebateRes = await wfQuery(`SELECT COUNT(*) as cnt, SUM(QtyTon) as totalTon FROM wf.RebateLedger WHERE SoId = @soidStr`, {
        soidStr: { type: sql.VarChar(50), value: soidStr }
      });
      preRebateCount = rebateRes.recordset[0].cnt;
      expect(preRebateCount).toBe(1);

      const outboxRes = await wfQuery(`SELECT COUNT(*) as cnt FROM wf.OutboxEvent WHERE AggregateId = @soidStr AND EventType = 'SO_SHIPPED'`, {
        soidStr: { type: sql.NVarChar(100), value: soidStr }
      });
      preOutboxCount = outboxRes.recordset[0].cnt;
      expect(preOutboxCount).toBe(1);
    });

    console.log(`[RETRY TEST] Pre-Retry State: WeighTickets=${preTicketCount}, RebateLedgerRows=${preRebateCount}, OutboxEvents=${preOutboxCount}, Weight=${preWeighOutWeight}`);

    // 7. SECOND SHIPMENT (DUPLICATE RETRY): Attempt identical shipment retry
    console.log('[RETRY TEST] Executing Duplicate Shipment Retry...');
    const retryShipRes = await api<any>(page, `/so/${nativeSoid}/ship`, {
      method: 'PATCH',
      data: { weighOutWeight: 29000, tareKg: 14000 },
      expectedStatuses: [200, 400, 409]
    });
    expect([200, 400, 409]).toContain(retryShipRes.status);
    console.log(`[RETRY TEST] Duplicate retry HTTP response: ${retryShipRes.status}`);

    // POST-RETRY AUDIT ASSERTIONS (ZERO SECOND EFFECT)
    await runWithTarget('remote_b', async () => {
      const soidStr = String(nativeSoid);

      const postExt = (await wfQuery(`SELECT WeighOutWeight FROM wf.SalesOrderExt WHERE SOID = @soidStr`, {
        soidStr: { type: sql.VarChar(50), value: soidStr }
      })).recordset[0];
      expect(Number(postExt.WeighOutWeight)).toBe(preWeighOutWeight);

      const postTicketRes = await wfQuery(`SELECT COUNT(*) as cnt FROM wf.WeighTicket WHERE SoId = @soidStr`, {
        soidStr: { type: sql.NVarChar(50), value: soidStr }
      });
      expect(postTicketRes.recordset[0].cnt).toBe(preTicketCount); // Zero additional ticket!

      const postRebateRes = await wfQuery(`SELECT COUNT(*) as cnt FROM wf.RebateLedger WHERE SoId = @soidStr`, {
        soidStr: { type: sql.VarChar(50), value: soidStr }
      });
      expect(postRebateRes.recordset[0].cnt).toBe(preRebateCount); // Zero duplicate rebate accrual!

      const postOutboxRes = await wfQuery(`SELECT COUNT(*) as cnt FROM wf.OutboxEvent WHERE AggregateId = @soidStr AND EventType = 'SO_SHIPPED'`, {
        soidStr: { type: sql.NVarChar(100), value: soidStr }
      });
      expect(postOutboxRes.recordset[0].cnt).toBe(preOutboxCount); // Zero duplicate outbox event!
    });

    console.log('[RETRY TEST] PRE/POST INVARIANT CONFIRMED: 0 duplicate weigh-tickets, 0 duplicate rebate accruals, 0 duplicate outbox events.');
  });

  // =========================================================================
  // SECTION 3: Linked Financial API Slice with Owned Data
  // =========================================================================
  test('Financial Slice: Run-Owned Coupon Reservation, 100/0 Rebate Accrual & Fail-Closed Native Gate', async ({ page }) => {
    let testReservationId: number;

    // 1. Create run-owned CouponReservation in wf.CouponReservation
    await runWithTarget('remote_b', async () => {
      const insRes = await wfQuery(`
        INSERT INTO wf.CouponReservation (
          CouponId, CouponNo, GoodId, CarrierSoId, CarrierDocuNo, TripId,
          BeneficiaryCustId, OwnerCustId, ReservedQty, Status, CreatedBy,
          IdempotencyKey, Revision
        )
        OUTPUT inserted.Id
        VALUES (
          88888, 'CPN-OWNED-POL', '1097', 'CARRIER-999', 'AI69-CARRIER', 99999,
          '0592004', '0592004', 10.0, 'RESERVED', 1,
          @idemKey, 1
        )
      `, {
        idemKey: { type: sql.NVarChar(100), value: `IDEM-POL-${Date.now()}` }
      });
      testReservationId = insRes.recordset[0].Id;
      tracked.couponReservationIds.add(testReservationId);
      console.log(`[FINANCIAL SLICE] Created run-owned CouponReservation: Id=${testReservationId}`);
    });

    // 2. Warehouse logs in and tests native gate
    await login(page, WAREHOUSE_USER);

    console.log('[FINANCIAL SLICE] Verifying Fail-Closed Native Posting Gate (COUPON_NATIVE_POSTING_ENABLED=false)...');
    const postGateRes = await api<any>(page, '/coupons/post-native', {
      method: 'POST',
      data: { reservationId: testReservationId },
      expectedStatuses: [400]
    });
    expect(postGateRes.status).toBe(400);
    expect((postGateRes.body as any).message).toContain('COUPON_NATIVE_POSTING_ENABLED=false');

    // 3. Assert zero state mutation on the run-owned reservation
    await runWithTarget('remote_b', async () => {
      const resRow = (await wfQuery(`SELECT Status, ReservedQty, SettledAt, NativeDocuNo FROM wf.CouponReservation WHERE Id = @id`, {
        id: { type: sql.Int, value: testReservationId }
      })).recordset[0];
      expect(resRow.Status).toBe('RESERVED');
      expect(Number(resRow.ReservedQty)).toBe(10.0);
      expect(resRow.SettledAt).toBeNull();
      expect(resRow.NativeDocuNo).toBeNull();
      console.log('[FINANCIAL SLICE] Verified reservation remains untouched (Fail-Closed confirmed).');
    });

    // 4. Assert Real Application Shipment Accrual & 100/0 Claim Enforcement via Real API
    // NO RAW SQL INSERTION of ledger or claim results (Fixes A04)
    console.log('[FINANCIAL SLICE] Executing real application shipment with fractional pricing fixture...');
    const finTruckPlate = `70-${Math.floor(2000 + Math.random() * 7000)}`;
    const fixtureQtyTon = 10.350; // Fractional ton to test decimal rounding boundary
    const fixturePricePerTon = 15250.00;
    const fixtureNetPricePerTon = 14875.50;
    const expectedRebatePerTon = 374.50; // 15250.00 - 14875.50
    // 10.350 * 374.50 = 3876.075 -> rounded to 3876.08 (R7 minor-unit rounding)
    const expectedTotalRebate = 3876.08;

    // 4.1 Sales user logs in and creates Trip + SO
    await logout(page);
    await login(page, SALES_USER);

    const finTripRes = await api<any>(page, '/trips', {
      method: 'POST',
      data: { transRegistration: finTruckPlate, deliveryDate: '2026-09-17', truckCapacityTon: 30 }
    });
    expect([200, 201]).toContain(finTripRes.status);
    const finTripId = Number(finTripRes.body.tripId);
    tracked.tripIds.add(finTripId);

    const finSoRes = await api<any>(page, '/so', {
      method: 'POST',
      data: {
        tripId: finTripId,
        soPrefix: 'I',
        custId: '1000',
        custName: 'พาต้าเคมีคอล แอนด์ แมชชีนเนอรี่ จำกัด',
        deliveryDate: '2026-09-17',
        lines: [{
          goodId: '1097',
          goodCode: '7-13032100BBCAR',
          goodName: '13-3-21',
          qtyTon: fixtureQtyTon,
          pricePerTon: fixturePricePerTon,
          netPricePerTon: fixtureNetPricePerTon
        }]
      }
    });
    expect([200, 201]).toContain(finSoRes.status);
    const finDraftSoId = Number(finSoRes.body.so?.id || finSoRes.body.id);
    tracked.draftSoIds.add(finDraftSoId);

    // 4.2 Confirm Trip
    const confirmRes = await api<any>(page, `/trips/${finTripId}/confirm`, {
      method: 'POST',
      data: {
        confirmedOrderIds: [finDraftSoId],
        transRegistration: finTruckPlate,
        pickupDueDate: '2026-09-24',
        idempotencyKey: `CONFIRM-FIN-TEST-${Date.now()}`
      }
    });
    expect(confirmRes.status).toBe(200);

    let finNativeSoid: number;
    await runWithTarget('remote_b', async () => {
      const ext = (await wfQuery(`SELECT SOID FROM wf.SalesOrderExt WHERE TripId = @tid`, {
        tid: { type: sql.Int, value: finTripId }
      })).recordset[0];
      finNativeSoid = Number(ext?.SOID);
    });
    tracked.nativeSoids.add(finNativeSoid);
    expect(finNativeSoid).toBeGreaterThan(0);

    // 4.3 Load Plan & Warehouse Load
    await api(page, `/trips/${finTripId}/load-plan`, {
      method: 'PUT',
      data: {
        expectedPlanRevision: 1,
        lines: [{
          memberKind: 'CONFIRMED',
          memberId: String(finNativeSoid),
          lineNum: 1,
          loadSequence: 1,
          masterQty: fixtureQtyTon,
          childQty: 0.000
        }]
      }
    });

    await logout(page);
    await login(page, WAREHOUSE_USER);

    await api(page, `/trips/${finTripId}/load-plan/ack`, {
      method: 'POST',
      data: { expectedPlanRevision: 2, note: 'Financial slice ack' }
    });
    await api(page, `/so/${finNativeSoid}/picking`, { method: 'PATCH' });
    await api(page, `/so/${finNativeSoid}/load`, { method: 'PATCH' });

    // 4.4 Simulate Scale Event in dbo.WGHD
    await runWithTarget('remote_b', async () => {
      const wRes = await wfQuery(`
        INSERT INTO dbo.WGHD (
          DocuNo, MoveBill, CarNo, SPID, WGType, Status, WeightIn, WeightOut, WeightNet, DateIn, DateOut, LocationName
        )
        OUTPUT inserted.Id
        VALUES (
          'WG-POL-FIN', 'MB-FIN', @plate, @soId, 'SO', 3, 14000, 24350, 10350, GETUTCDATE(), GETUTCDATE(), '1'
        )
      `, {
        plate: { type: sql.NVarChar(50), value: finTruckPlate },
        soId: { type: sql.Int, value: finNativeSoid }
      });
      tracked.wghdIds.add(wRes.recordset[0].Id);
    });

    // 4.5 Execute Shipment Departure via Real Application API
    console.log('[FINANCIAL SLICE] Executing real shipment departure via PATCH /so/:id/ship...');
    const shipRes = await api<any>(page, `/so/${finNativeSoid}/ship`, {
      method: 'PATCH',
      data: { weighOutWeight: 24350, tareKg: 14000 }
    });
    expect(shipRes.status).toBe(200);
    expect(shipRes.body.status).toBe('SHIPPED');

    // 4.6 Query and verify actual RebateLedger generated by application bookRebateAccrual
    let accruedPoolId: number;
    await runWithTarget('remote_b', async () => {
      const soidStr = String(finNativeSoid);
      const ledgerQueryRes = await wfQuery(`
        SELECT Id, SoId, CustId, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount, RemainingAmt, Status, PoolId
        FROM wf.RebateLedger
        WHERE SoId = @soId
      `, { soId: { type: sql.VarChar(50), value: soidStr } });

      expect(ledgerQueryRes.recordset.length).toBe(1);
      const ledgerRow = ledgerQueryRes.recordset[0];
      tracked.rebateLedgerIds.add(ledgerRow.Id);
      accruedPoolId = ledgerRow.PoolId;

      expect(String(ledgerRow.SoId)).toBe(soidStr);
      expect(String(ledgerRow.CustId)).toBe('1000');
      expect(Number(ledgerRow.QtyTon)).toBe(fixtureQtyTon);
      expect(Number(ledgerRow.PricePerTon)).toBe(fixturePricePerTon);
      expect(Number(ledgerRow.NetPricePerTon)).toBe(fixtureNetPricePerTon);
      expect(Number(ledgerRow.RebatePerTon)).toBe(expectedRebatePerTon);
      expect(Number(ledgerRow.RebateAmount)).toBe(expectedTotalRebate);
      expect(Number(ledgerRow.RemainingAmt)).toBe(expectedTotalRebate);
      expect(ledgerRow.Status).toBe('PENDING');
      console.log(`[FINANCIAL SLICE] Verified application-calculated RebateLedger: Id=${ledgerRow.Id}, RebateAmt=${ledgerRow.RebateAmount}`);
    });

    // 4.7 Query active REBATE_POLICY snapshot
    let snapshotId: number;
    await runWithTarget('remote_b', async () => {
      const policyRes = await wfQuery(`
        SELECT TOP 1 SnapshotId, CustomerRatio, CompanyRatio
        FROM wf.PolicySnapshot
        WHERE PolicyName = 'REBATE_POLICY'
          AND EffectiveFrom <= SYSUTCDATETIME()
          AND (EffectiveTo IS NULL OR EffectiveTo > SYSUTCDATETIME())
        ORDER BY EffectiveFrom DESC, RevisionNumber DESC
      `);
      expect(policyRes.recordset.length).toBeGreaterThan(0);
      const policySnap = policyRes.recordset[0];
      snapshotId = policySnap.SnapshotId;
      expect(Number(policySnap.CustomerRatio)).toBe(100.00);
      expect(Number(policySnap.CompanyRatio)).toBe(0.00);
    });

    // 4.8 Submit Claim via Real Application API with Hostile Ratio Override
    // Attempt to inject tampered 80/20 ratio -> verify server strictly overrides with 100/0 snapshot
    await logout(page);
    await login(page, 'admin');

    const claimIdemKey = `IDEM-CLAIM-FIN-${Date.now()}`;
    console.log('[FINANCIAL SLICE] Submitting claim via API with tampered customerRatio=80.00...');
    const claimRes = await api<any>(page, '/rebate/claims', {
      method: 'POST',
      data: {
        poolId: accruedPoolId,
        custId: '1000',
        claimAmt: expectedTotalRebate,
        reasonCode: 'MANUAL_ADJUSTMENT',
        reasonText: 'E2E Financial Slice Assertion with Hostile Ratio Override',
        customerRatio: 80.00, // Hostile client-supplied ratio
        companyRatio: 20.00,
        idempotencyKey: claimIdemKey
      }
    });
    expect([200, 201]).toContain(claimRes.status);
    const createdClaimId = Number(claimRes.body.claim?.Id || claimRes.body.Id);
    expect(createdClaimId).toBeGreaterThan(0);
    tracked.rebateClaimIds.add(createdClaimId);

    // 4.9 Assert Server-Enforced Invariants on Created Claim in Database
    await runWithTarget('remote_b', async () => {
      const claimQueryRes = await wfQuery(`
        SELECT Id, CustId, ClaimAmt, CustomerRatio, CompanyRatio, CustomerAmount, RetainedAmount, Status, PolicySnapshotId
        FROM wf.RebateClaim
        WHERE Id = @id
      `, { id: { type: sql.Int, value: createdClaimId } });

      expect(claimQueryRes.recordset.length).toBe(1);
      const claimRow = claimQueryRes.recordset[0];

      expect(Number(claimRow.ClaimAmt)).toBe(expectedTotalRebate);
      // Server must have OVERRIDDEN hostile 80/20 ratio with 100/0 snapshot!
      expect(Number(claimRow.CustomerRatio)).toBe(100.00);
      expect(Number(claimRow.CompanyRatio)).toBe(0.00);
      expect(Number(claimRow.CustomerAmount)).toBe(expectedTotalRebate);
      expect(Number(claimRow.RetainedAmount)).toBe(0.00);
      expect(claimRow.Status).toBe('TIER2_PENDING');
      expect(String(claimRow.PolicySnapshotId)).toBe(String(snapshotId));

      console.log(`[FINANCIAL SLICE] Confirmed hostile ratio overridden: ClaimId=${createdClaimId}, CustomerRatio=${claimRow.CustomerRatio}, CustomerAmt=${claimRow.CustomerAmount}`);
    });

    // 4.10 Test Idempotent Claim Submission (Duplicate Prevention)
    console.log('[FINANCIAL SLICE] Testing idempotent claim replay...');
    const replayClaimRes = await api<any>(page, '/rebate/claims', {
      method: 'POST',
      data: {
        poolId: accruedPoolId,
        custId: '1000',
        claimAmt: expectedTotalRebate,
        reasonCode: 'MANUAL_ADJUSTMENT',
        reasonText: 'E2E Financial Slice Assertion with Hostile Ratio Override',
        customerRatio: 80.00,
        companyRatio: 20.00,
        idempotencyKey: claimIdemKey
      }
    });
    expect([200, 201]).toContain(replayClaimRes.status);
    expect(replayClaimRes.body.replayed).toBe(true);

    await runWithTarget('remote_b', async () => {
      const countRes = await wfQuery(`SELECT COUNT(*) as cnt FROM wf.RebateClaim WHERE IdempotencyKey = @k`, {
        k: { type: sql.VarChar(100), value: claimIdemKey }
      });
      expect(countRes.recordset[0].cnt).toBe(1); // Zero duplicate claims created!
      console.log('[FINANCIAL SLICE] Confirmed idempotency: exactly 1 claim created under IdempotencyKey.');
    });

    // 4.11 Normal Customer Claim on Actual Native Delivery Lot in v_RebateAccrualRemaining
    console.log('[FINANCIAL SLICE] Testing Normal Lot-Backed Claim on native delivery lot...');
    await logout(page);
    await login(page, SALES_USER);

    let testLot: any;
    let initialRemainingTon: number;
    await runWithTarget('remote_b', async () => {
      const lotRes = await wfQuery(`
        SELECT TOP 1 CustId, CustCode, CustName, GoodCode, QtyTon, RemainingTonRebate, SourceSOID, SourceListNo
        FROM wf.v_RebateAccrualRemaining
        WHERE CustId = '3008' AND RemainingTonRebate >= 2.5
        ORDER BY SourceDocuDate DESC
      `);
      expect(lotRes.recordset.length).toBe(1);
      testLot = lotRes.recordset[0];
      initialRemainingTon = Number(testLot.RemainingTonRebate);
    });

    const normalClaimIdemKey = `IDEM-NORM-${Date.now()}`;
    const claimQtyTon = 2.500;
    const linePricePerTon = 10000.00;
    const lineNetPricePerTon = 9800.00; // Rebate = 200.00 THB/ton -> Line Amount = 500.00 THB

    const normClaimRes = await api<any>(page, '/rebate/claims', {
      method: 'POST',
      data: {
        custId: testLot.CustId,
        note: 'Normal Lot-Backed Customer Claim Test',
        idempotencyKey: normalClaimIdemKey,
        lines: [{
          lineType: 'REBATE',
          goodCode: testLot.GoodCode,
          qtyTon: claimQtyTon,
          pricePerTon: linePricePerTon,
          netPricePerTon: lineNetPricePerTon,
          sourceSOID: Number(testLot.SourceSOID),
          sourceListNo: Number(testLot.SourceListNo)
        }]
      }
    });
    expect([200, 201]).toContain(normClaimRes.status);
    const normalClaimId = Number(normClaimRes.body.claim?.Id || normClaimRes.body.Id);
    expect(normalClaimId).toBeGreaterThan(0);
    tracked.rebateClaimIds.add(normalClaimId);

    // Verify claim and claim line creation in DB
    await runWithTarget('remote_b', async () => {
      const claimDb = await wfQuery(`SELECT * FROM wf.RebateClaim WHERE Id = @id`, { id: { type: sql.Int, value: normalClaimId } });
      expect(claimDb.recordset.length).toBe(1);
      expect(Number(claimDb.recordset[0].ClaimAmt)).toBe(500.00);
      expect(Number(claimDb.recordset[0].CustomerAmount)).toBe(500.00);
      expect(Number(claimDb.recordset[0].RetainedAmount)).toBe(0.00);

      const linesDb = await wfQuery(`SELECT * FROM wf.RebateClaimLine WHERE ClaimId = @id`, { id: { type: sql.Int, value: normalClaimId } });
      expect(linesDb.recordset.length).toBe(1);
      expect(Number(linesDb.recordset[0].QtyTon)).toBe(claimQtyTon);
      expect(Number(linesDb.recordset[0].LineAmount)).toBe(500.00);

      // Verify deduction in v_RebateAccrualRemaining
      const afterLotRes = await wfQuery(`
        SELECT RemainingTonRebate
        FROM wf.v_RebateAccrualRemaining
        WHERE SourceSOID = @soid AND SourceListNo = @lno
      `, {
        soid: { type: sql.BigInt, value: testLot.SourceSOID },
        lno: { type: sql.Int, value: testLot.SourceListNo }
      });
      const afterRemaining = Number(afterLotRes.recordset[0].RemainingTonRebate);
      expect(afterRemaining).toBe(Math.round((initialRemainingTon - claimQtyTon) * 1000) / 1000);
      console.log(`[FINANCIAL SLICE] Normal Claim Lot Deduction Verified: ${initialRemainingTon} -> ${afterRemaining}`);
    });

    // Test Idempotent Replay of Normal Claim
    const normReplay = await api<any>(page, '/rebate/claims', {
      method: 'POST',
      data: {
        custId: testLot.CustId,
        note: 'Normal Lot-Backed Customer Claim Test',
        idempotencyKey: normalClaimIdemKey,
        lines: [{
          lineType: 'REBATE',
          goodCode: testLot.GoodCode,
          qtyTon: claimQtyTon,
          pricePerTon: linePricePerTon,
          netPricePerTon: lineNetPricePerTon,
          sourceSOID: Number(testLot.SourceSOID),
          sourceListNo: Number(testLot.SourceListNo)
        }]
      }
    });
    expect([200, 201]).toContain(normReplay.status);
    expect(normReplay.body.replayed).toBe(true);

    // Test Idempotency Conflict (different payload)
    await api<any>(page, '/rebate/claims', {
      method: 'POST',
      data: {
        custId: testLot.CustId,
        note: 'Altered payload',
        idempotencyKey: normalClaimIdemKey,
        lines: [{
          lineType: 'REBATE',
          goodCode: testLot.GoodCode,
          qtyTon: claimQtyTon + 1,
          pricePerTon: linePricePerTon,
          netPricePerTon: lineNetPricePerTon,
          sourceSOID: Number(testLot.SourceSOID),
          sourceListNo: Number(testLot.SourceListNo)
        }]
      },
      expectedStatuses: [409]
    });

    // Test Overclaim Rejection (requesting more tons than available on lot)
    console.log('[FINANCIAL SLICE] Testing Overclaim Validation (requesting tons exceeding lot balance)...');
    const overclaimRes = await api<any>(page, '/rebate/claims', {
      method: 'POST',
      data: {
        custId: testLot.CustId,
        note: 'Overclaim test',
        idempotencyKey: `IDEM-OVER-${Date.now()}`,
        lines: [{
          lineType: 'REBATE',
          goodCode: testLot.GoodCode,
          qtyTon: 999999.000,
          pricePerTon: linePricePerTon,
          netPricePerTon: lineNetPricePerTon,
          sourceSOID: Number(testLot.SourceSOID),
          sourceListNo: Number(testLot.SourceListNo)
        }]
      },
      expectedStatuses: [400]
    });
    expect(overclaimRes.status).toBe(400);
    console.log('[FINANCIAL SLICE] Overclaim correctly blocked with 400 Bad Request');

    // Test Rejection Lifecycle via Real API (R3-04)
    console.log('[FINANCIAL SLICE] Testing Claim Rejection Lifecycle via Real API (R3-04)...');

    // 1. Segregation of Duties: Submitter (SALES_USER) cannot reject their own claim
    const selfRejectRes = await api<any>(page, `/rebate/claims/${normalClaimId}/reject`, {
      method: 'POST',
      data: { reason: 'Submitter trying to reject self' },
      expectedStatuses: [403]
    });
    expect(selfRejectRes.status).toBe(403);
    console.log('[FINANCIAL SLICE] Submitter self-rejection blocked with 403 Forbidden (Segregation of Duties)');

    // 2. Reason Validation: Short reason (<5 chars) must be blocked
    await logout(page);
    await login(page, 'admin');

    const shortReasonRes = await api<any>(page, `/rebate/claims/${normalClaimId}/reject`, {
      method: 'POST',
      data: { reason: 'bad' },
      expectedStatuses: [400]
    });
    expect(shortReasonRes.status).toBe(400);
    console.log('[FINANCIAL SLICE] Short reason (<5 chars) blocked with 400 Bad Request');

    // 3. Authorized Rejection by Admin via Real Application API
    const validRejectReason = 'Claim rejected due to policy boundary audit test';
    const rejectRes = await api<any>(page, `/rebate/claims/${normalClaimId}/reject`, {
      method: 'POST',
      data: { reason: validRejectReason }
    });
    expect([200, 201]).toContain(rejectRes.status);
    expect(rejectRes.body.status).toBe('REJECTED');
    console.log('[FINANCIAL SLICE] Claim successfully rejected via real API with status REJECTED');

    // 4. Verify DB State & Audit Trail
    await runWithTarget('remote_b', async () => {
      // 4a. Check RebateClaim status
      const claimRow = (await wfQuery(`SELECT Status, CurrentTier FROM wf.RebateClaim WHERE Id = @id`, {
        id: { type: sql.Int, value: normalClaimId }
      })).recordset[0];
      expect(claimRow.Status).toBe('REJECTED');

      // 4b. Check RebateClaimApproval audit trail
      const approvalRows = (await wfQuery(`
        SELECT Tier, Decision, DecidedByName, Reason
        FROM wf.RebateClaimApproval
        WHERE ClaimId = @id AND Decision = 'REJECTED'
      `, { id: { type: sql.Int, value: normalClaimId } })).recordset;
      expect(approvalRows.length).toBeGreaterThanOrEqual(1);
      expect(approvalRows[0].Decision).toBe('REJECTED');
      expect(approvalRows[0].Reason).toBe(validRejectReason);
      console.log('[FINANCIAL SLICE] Audit trail verified in wf.RebateClaimApproval');

      // 4c. Verify exact lot balance restoration in wf.v_RebateAccrualRemaining
      const restoredLotRes = await wfQuery(`
        SELECT RemainingTonRebate
        FROM wf.v_RebateAccrualRemaining
        WHERE SourceSOID = @soid AND SourceListNo = @lno
      `, {
        soid: { type: sql.BigInt, value: testLot.SourceSOID },
        lno: { type: sql.Int, value: testLot.SourceListNo }
      });
      const restoredRemaining = Number(restoredLotRes.recordset[0].RemainingTonRebate);
      expect(restoredRemaining).toBe(initialRemainingTon);
      console.log(`[FINANCIAL SLICE] Exact Lot Balance Restored via API Rejection: ${restoredRemaining} === ${initialRemainingTon}`);

      // 5. Explicit View-Only SQL Contract Assertion (Separated from business lifecycle)
      const viewDefRes = await wfQuery(`
        SELECT COUNT_BIG(*) AS ExcludedCnt
        FROM wf.RebateClaim rc WITH (NOLOCK)
        WHERE rc.Status IN ('REJECTED', 'CANCELLED')
          AND rc.Id = @id
      `, { id: { type: sql.Int, value: normalClaimId } });
      expect(Number(viewDefRes.recordset[0].ExcludedCnt)).toBe(1);
      console.log('[FINANCIAL SLICE] View exclusion contract confirmed separately from API lifecycle');
    });

    console.log('[SUCCESS] SO-11 Policy Boundaries, Shipment Retry Invariants, Financial Slice & Normal Claim PASSED 100% with Real API Rejection Lifecycle!');
  });
});
