'use strict';

/**
 * real-schema-sql-verify.cjs
 *
 * Proves every new or changed SQL query from R4/R5 against the real database schema.
 * - SELECT queries run read-only.
 * - UPDATE/INSERT queries run inside transactions that are GUARANTEED to ROLLBACK.
 * - Verifies Q8 revoke logic with 1 attached and 1 unattached reservation.
 * - Leaves zero permanent database footprint.
 */

const assert = require('assert/strict');
const path = require('path');
const db = require(path.resolve('backend/db'));
const { sql } = db;

async function runRealSchemaVerification() {
  console.log('Connecting to database...');
  await db.pools().ready;
  
  const idInfo = (await db.wfQuery('SELECT @@SERVERNAME AS server, DB_NAME() AS db')).recordset[0];
  console.log(`Connected to ${idInfo.server} / ${idInfo.db}`);

  // ─────────────────────────────────────────────────────────────
  // 1. SELECT Checks (Read-Only)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 1. Validating SELECT queries against real schema ---');

  // 1.1 R13 SalesTrip Query (from routes/so.js:1947, 2030)
  const qR13 = `SELECT TripId, TripCode, Status FROM wf.SalesTrip WHERE TripId = @tripId`;
  const resR13 = await db.wfQuery(qR13, { tripId: { type: sql.Int, value: 32 } });
  assert.ok(Array.isArray(resR13.recordset), 'R13 query must return array');
  console.log('✓ R13 wf.SalesTrip query compiles and executes successfully:', resR13.recordset[0] || 'no row, schema valid');

  // 1.2 Q7 getSoLines enrichment Query (from routes/so.js:420)
  const qQ7 = `
    SELECT 
      cl.LineNum, cl.CouponReservationId, cl.RefCouponDocuNo, cl.IsCouponDrawn,
      cr.BeneficiaryCustId, cr.OwnerCustId,
      ben.CustCode AS BeneficiaryCustCode, ben.CustName AS BeneficiaryCustName,
      own.CustCode AS OwnerCustCode, own.CustName AS OwnerCustName
    FROM wf.SalesOrderLine cl WITH (NOLOCK)
    LEFT JOIN wf.CouponReservation cr WITH (NOLOCK) ON cr.Id = cl.CouponReservationId
    LEFT JOIN dbo.EMCust ben WITH (NOLOCK) ON ben.CustID = CASE WHEN ISNUMERIC(cr.BeneficiaryCustId) = 1 THEN CAST(cr.BeneficiaryCustId AS INT) END
    LEFT JOIN dbo.EMCust own WITH (NOLOCK) ON own.CustID = CASE WHEN ISNUMERIC(cr.OwnerCustId) = 1 THEN CAST(cr.OwnerCustId AS INT) END
    WHERE cl.SoId = @soId
  `;
  const resQ7 = await db.wfQuery(qQ7, { soId: { type: sql.Int, value: 278008 } });
  assert.ok(Array.isArray(resQ7.recordset), 'Q7 query must return array');
  console.log('✓ Q7 getSoLines query compiles and executes successfully (rows found:', resQ7.recordset.length, ')');

  // 1.3 Beneficiary validation queries (from coupon-service.js:607, 642, 660)
  const qBen1 = `SELECT COUNT(*) AS activeCount FROM wf.CouponBeneficiary WHERE BeneficiaryCustId = @own AND Status = 'ACTIVE'`;
  const resBen1 = await db.wfQuery(qBen1, { own: { type: sql.VarChar(50), value: '1141' } });
  assert.equal(typeof resBen1.recordset[0].activeCount, 'number');
  console.log('✓ Beneficiary check 1 (two-level rule) executed successfully');

  const qBen2 = `SELECT TOP 1 Id, BeneficiaryCustId, BeneficiaryCustCode, BeneficiaryCustName FROM wf.CouponBeneficiary WHERE BeneficiaryCustId = @ben AND OwnerCustId <> @own AND Status = 'ACTIVE'`;
  const resBen2 = await db.wfQuery(qBen2, { ben: { type: sql.VarChar(50), value: '16002' }, own: { type: sql.VarChar(50), value: '1141' } });
  console.log('✓ Beneficiary check 2 (one-root rule) executed successfully');

  // ─────────────────────────────────────────────────────────────
  // 2. Transactional Rollback Test: Q8 Revoke & Reservation Cancel
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Validating Q8 Revoke & Cancel inside rolled-back transaction ---');

  let testGrantId = null;
  let testUnattachedId = null;
  let testAttachedId = null;

  try {
    await db.wfTransaction(async (tx) => {
      const testOwner = '8888001';
      const testBen = '8888002';
      const testAdmin = 63;

      // 2.1 Insert temporary beneficiary grant
      const grantRes = await tx.request()
        .input('own', sql.VarChar(50), testOwner)
        .input('ben', sql.VarChar(50), testBen)
        .input('uid', sql.Int, testAdmin)
        .query(`
          INSERT INTO wf.CouponBeneficiary (
            OwnerCustId, BeneficiaryCustId, Scope, Status, Reason, CreatedBy, CreatedAt, UpdatedAt
          ) OUTPUT INSERTED.Id VALUES (
            @own, @ben, 'ALL', 'ACTIVE', 'Test grant in tx', @uid, GETUTCDATE(), GETUTCDATE()
          )
        `);
      testGrantId = grantRes.recordset[0].Id;
      assert.ok(testGrantId > 0, 'Temporary grant created');

      // 2.2 Insert temporary unattached reservation (RESERVED)
      const resUnattached = await tx.request()
        .input('own', sql.VarChar(50), testOwner)
        .input('ben', sql.VarChar(50), testBen)
        .input('uid', sql.Int, testAdmin)
        .query(`
          INSERT INTO wf.CouponReservation (
            CouponId, CouponNo, GoodId, LineNum, GoodUnit, CarrierSoId, CarrierDocuNo,
            OwnerCustId, BeneficiaryCustId, ReservedQty, Status,
            CreatedBy, CreatedAt, UpdatedAt, IdempotencyKey
          ) OUTPUT INSERTED.Id VALUES (
            246000, 'C6906917', 1114, 1, 'TON', '0', NULL,
            @own, @ben, 1.5, 'RESERVED',
            @uid, GETUTCDATE(), GETUTCDATE(), 'test-unattached-key'
          )
        `);
      testUnattachedId = resUnattached.recordset[0].Id;

      // 2.3 Insert temporary attached reservation (RESERVED)
      const resAttached = await tx.request()
        .input('own', sql.VarChar(50), testOwner)
        .input('ben', sql.VarChar(50), testBen)
        .input('uid', sql.Int, testAdmin)
        .query(`
          INSERT INTO wf.CouponReservation (
            CouponId, CouponNo, GoodId, LineNum, GoodUnit, CarrierSoId, CarrierDocuNo,
            OwnerCustId, BeneficiaryCustId, ReservedQty, Status,
            CreatedBy, CreatedAt, UpdatedAt, IdempotencyKey
          ) OUTPUT INSERTED.Id VALUES (
            246000, 'C6906917', 1114, 1, 'TON', '999999', 'I69-99999',
            @own, @ben, 2.0, 'RESERVED',
            @uid, GETUTCDATE(), GETUTCDATE(), 'test-attached-key'
          )
        `);
      testAttachedId = resAttached.recordset[0].Id;

      // 2.4 Insert temporary draft order and order line linking testAttachedId
      const draftRes = await tx.request()
        .input('ben', sql.VarChar(50), testBen)
        .input('uid', sql.Int, testAdmin)
        .query(`
          INSERT INTO wf.SalesOrder (
            WfRef, SoPrefix, CustId, CustName, Status, CreatedAt, UpdatedAt,
            RebateDiscountAmt, IsOwnTruck, NoTruckRequired, PSling,
            RequiresPriceApproval, PriceApprovalStatus, DocumentRevision
          ) OUTPUT INSERTED.Id VALUES (
            'WF-TEST-TMP-01', 'I', @ben, 'ลูกค้าทดสอบ', 'DRAFT', GETUTCDATE(), GETUTCDATE(),
            0, 0, 0, 0,
            0, 'NONE', 1
          )
        `);
      const draftId = draftRes.recordset[0].Id;

      await tx.request()
        .input('soId', sql.Int, draftId)
        .input('resId', sql.Int, testAttachedId)
        .query(`
          INSERT INTO wf.SalesOrderLine (
            SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag,
            PricePerTon, NetPricePerTon, IsGiveaway, RebateBooked, CreatedAt,
            IsControlTicketDrawn, IsCouponDrawn, CouponReservationId, RefCouponDocuNo
          ) VALUES (
            @soId, 1, 1114, '0342001', '15-15-15', 2.0, 40,
            0, 0, 0, 0, GETUTCDATE(),
            0, 1, @resId, 'C6906917'
          )
        `);

      console.log(`✓ Temporary test fixtures created in tx: Grant #${testGrantId}, Unattached Res #${testUnattachedId}, Attached Res #${testAttachedId} (linked to Draft #${draftId})`);

      // 2.5 Execute Q8 Revoke logic (CouponBeneficiary UPDATE)
      await tx.request()
        .input('id', sql.Int, testGrantId)
        .input('uid', sql.Int, testAdmin)
        .input('reason', sql.NVarChar(255), 'ทดสอบถอนสิทธิ์ real-schema')
        .query(`
          UPDATE wf.CouponBeneficiary
          SET Status = 'REVOKED',
              RevokedAt = GETUTCDATE(),
              RevokedBy = @uid,
              RevokeReason = @reason,
              UpdatedAt = GETUTCDATE()
          WHERE Id = @id
        `);

      // 2.6 Execute Q8 Unattached Reservation Cancellation UPDATE
      const unattachedCancel = await tx.request()
        .input('own', sql.VarChar(50), testOwner)
        .input('ben', sql.VarChar(50), testBen)
        .input('reason', sql.NVarChar(255), 'ถอนสิทธิ์ตั๋วร่วม')
        .input('uid', sql.Int, testAdmin)
        .query(`
          UPDATE wf.CouponReservation
          SET Status = 'CANCELLED',
              CancelledAt = GETUTCDATE(),
              CancelReason = @reason,
              CancelledBy = @uid,
              UpdatedAt = GETUTCDATE()
          WHERE OwnerCustId = @own
            AND BeneficiaryCustId = @ben
            AND Status = 'RESERVED'
            AND NOT EXISTS (
              SELECT 1
              FROM wf.SalesOrderLine sol WITH (NOLOCK)
              LEFT JOIN wf.SalesOrder so WITH (NOLOCK) ON so.Id = sol.SoId
              LEFT JOIN dbo.SOHD hd WITH (NOLOCK) ON hd.SOID = sol.SoId
              WHERE sol.CouponReservationId = wf.CouponReservation.Id
                AND (
                  (so.Id IS NOT NULL AND so.Status NOT IN ('CANCELLED', 'DELETED'))
                  OR (hd.SOID IS NOT NULL AND hd.DocuStatus NOT IN ('C', 'CANCELLED', 'REJECTED'))
                )
            )
        `);

      assert.equal(unattachedCancel.rowsAffected[0], 1, 'Exactly 1 unattached reservation must be updated to CANCELLED');

      // 2.7 Verify status of both reservations inside the transaction
      const resCheck = (await tx.request()
        .input('unattachedId', sql.Int, testUnattachedId)
        .input('attachedId', sql.Int, testAttachedId)
        .query(`
          SELECT Id, Status, CancelReason, CancelledBy FROM wf.CouponReservation
          WHERE Id IN (@unattachedId, @attachedId)
          ORDER BY Id
        `)).recordset;

      const unattachedRow = resCheck.find(r => r.Id === testUnattachedId);
      const attachedRow = resCheck.find(r => r.Id === testAttachedId);

      assert.equal(unattachedRow.Status, 'CANCELLED', 'Unattached reservation must be CANCELLED');
      assert.equal(unattachedRow.CancelReason, 'ถอนสิทธิ์ตั๋วร่วม', 'Unattached reservation CancelReason must be set');
      assert.equal(attachedRow.Status, 'RESERVED', 'Attached reservation must REMAIN RESERVED');
      assert.equal(attachedRow.CancelReason, null, 'Attached reservation CancelReason must be null');

      console.log('✓ Q8 assertions passed: unattached cancelled, attached preserved.');

      // ALWAYS ROLLBACK BY THROWING AN INTENDED ERROR
      throw new Error('INTENTIONAL_ROLLBACK');
    });
  } catch (err) {
    if (err.message !== 'INTENTIONAL_ROLLBACK') {
      throw err;
    }
    console.log('✓ Transaction ROLLED BACK completely via wfTransaction. Zero permanent changes committed to DB.');
  }

  // 2.8 Verify post-rollback that temporary IDs do NOT exist
  const verifyClean = await db.wfQuery(`
    SELECT
      (SELECT COUNT(*) FROM wf.CouponBeneficiary WHERE OwnerCustId = '8888001') AS grantCount,
      (SELECT COUNT(*) FROM wf.CouponReservation WHERE OwnerCustId = '8888001') AS resCount
  `);
  assert.equal(verifyClean.recordset[0].grantCount, 0, 'No temporary grants left');
  assert.equal(verifyClean.recordset[0].resCount, 0, 'No temporary reservations left');
  console.log('✓ Verified DB clean: zero test artifacts remain in database.');

  console.log('\n=== ALL REAL-SCHEMA SQL CHECKS PASSED ===\n');
}

runRealSchemaVerification().then(() => process.exit(0)).catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
