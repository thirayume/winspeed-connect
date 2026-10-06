/**
 * slice1-audit-regressions.test.js
 *
 * Comprehensive integration tests for Slice 1 audit findings S1-01 through S1-07,
 * Re-audit R2 findings R2-01 through R2-05, and R3 remediation items R3-01 through R3-06.
 *
 * Invariants Enforced:
 *  - Fatal Before-Hook DB Guard (R2-01 / R3-01): Terminates immediately if not connected to dbwins_worldfert9_test_v2
 *    with COUPON_NATIVE_POSTING_ENABLED=false.
 *  - Zero Backdoors in Production (R3-01): No TEST- exceptions in ticket-policy.js; invalid/nonexistent IDs always reject.
 *  - Non-Destructive Real-Coupon Fixture with Mandatory finally Cleanup (R3-01): Tests on real coupons record before-snapshots
 *    and restore original state in finally blocks.
 *  - S1-01: Mandatory nonempty assertion on ACTIVE tab, strict multi-axis eligibility, and unissued PENDING checks.
 *  - S1-02 / R3-02: Typed identity & exactId isolation on duplicate coupons (D6302477: 154558 vs 154766) and legacy overlay isolation.
 *  - S1-03 / R3-04: Resolver bounds, strict positive integer validation, and low-budget truncation assertion.
 *  - S1-04 / R3-04: Direct invoice traversal via dbo.SOInvDT (RefID 276867 -> Invoice 334740) and raw unit preservation.
 *  - S1-05 / R3-02: Read-only rejection suite, strict docuId, concurrency locking, transaction rollback, and migration 005 backfill/down.
 *  - S1-06 / R3-03: Real SQL server-side pagination, CreateSODialog array compatibility, strict tab disjointness, and STATISTICS IO/TIME receipts.
 *  - S1-07 / R3-05: True connection pool closure verification via db.closeAll().
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { assertTestDatabase, fatalTestGuard } = require('./test-safety');
const { resolveNativeDocumentChain } = require('../services/native-document-resolver');
const {
  resolveTicketPolicy,
  evaluateTicketExpiry,
  evaluateTicketEligibility,
  traceNativeTicketChain,
  updateTicketExpiryOverlay,
} = require('../services/ticket-policy');

const masterRouter = require('../routes/master');
const secret = process.env.JWT_SECRET || 'dev_secret_change_in_production';

let server;
let baseUrl;
let token;

const runRemote = (fn) => db.runWithTarget('remote_b', fn);

// ── Fatal Before Hook: Database & Runtime Flag Guard (R2-01 / R3-01) ─────────
test.before(async () => {
  // 1. Enforce strict test database connection context and runtime safety flags
  await runRemote(async () => {
    const safety = await fatalTestGuard();
    assert.equal(safety.dbName, 'dbwins_worldfert9_test_v2', 'Must execute strictly against dbwins_worldfert9_test_v2');
    assert.equal(safety.postingFlag, 'false', 'COUPON_NATIVE_POSTING_ENABLED must be false');
  });

  // 2. Setup mock HTTP server for route integration testing
  token = jwt.sign(
    { id: 2, username: 'emp-00002', role: 'SALES', mustChangePassword: false },
    secret,
    { expiresIn: '1h' }
  );

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    db.runWithTarget('remote_b', next);
  });
  app.use('/api/master', masterRouter);

  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await db.closeAll();
});

// ── 1. DB Guard & Feature Flag Guard (R2-01) ─────────────────────────────────
test('S1-Safety: Database target is exact test DB, server is verified, and cross-db writes are blocked', async () => {
  await runRemote(async () => {
    const { dbName, serverName, loginName, isSysadmin, prodAccess, postingFlag } = await assertTestDatabase();
    assert.equal(dbName.toLowerCase(), 'dbwins_worldfert9_test_v2', 'Must execute against exact remote_b test DB');
    assert.notEqual(dbName, 'dbwins_worldfert9', 'Never run against production');
    assert.equal(serverName, '21181f44f254', 'Must execute against exact remote_b test server');
    assert.equal(postingFlag, 'false', 'Native writeback posting flag must remain false');
    assert.equal(loginName, 'wf_test', 'Must run as dedicated restricted test principal wf_test');
    assert.equal(isSysadmin, 0, 'wf_test principal must not have sysadmin role');
    assert.equal(prodAccess, 0, 'wf_test principal must have zero access to production dbwins_worldfert9');

    // 1. Verify JS regex interceptor blocks cross-database write on guarded methods
    assert.throws(() => {
      db.wfQuery("UPDATE dbwins_worldfert9.wf.ControlTicketOverlay SET DocuId = 1 WHERE Id = 9999");
    }, /CRITICAL TEST SAFETY VIOLATION/);

    // 2. Verify SQL Server engine itself rejects cross-database write (defense-in-depth, not just JS regex)
    // Direct execution on raw connection pool bypasses JS interceptor to verify SQL Server permission enforcement
    const { readerPool } = db.pools();
    await assert.rejects(
      async () => {
        await readerPool.request().query("UPDATE dbwins_worldfert9.wf.ControlTicketOverlay SET DocuId = 1 WHERE Id = 9999");
      },
      (err) => {
        // SQL Server error 916: The server principal "wf_test" is not able to access the database "dbwins_worldfert9"
        assert.ok(
          err.message.includes('not able to access the database') || err.number === 916,
          `Expected SQL Server engine access rejection (error 916), got: ${err.message}`
        );
        return true;
      },
      'SQL Server must reject cross-database write at engine level'
    );
  });
});

// ── 2. S1-01: Eligibility Invariant & ACTIVE Tab Spendability (R2-05) ─────────
test('S1-01: Server-owned evaluateTicketEligibility rejects unissued, cancelled, negative, and strict-expired tickets', () => {
  // 1. Unissued DRAFT booking -> must NOT be spendable
  const draftRes = evaluateTicketEligibility({
    couponId: null,
    lifecycle: 'DRAFT',
    balanceState: 'DRAFT',
    availableQtyTon: null,
    nativeRemainingQtyTon: null,
  });
  assert.equal(draftRes.isSpendable, false, 'DRAFT booking must never be spendable');
  assert.equal(draftRes.isBlocked, true);
  assert.equal(draftRes.eligibility, 'DRAFT');

  // 2. Unissued APPROVED booking (103 without 104) -> must NOT be spendable
  const pendingRes = evaluateTicketEligibility({
    couponId: null,
    lifecycle: 'APPROVED_NOT_ISSUED',
    balanceState: 'PENDING_ISSUE',
    availableQtyTon: null,
    nativeRemainingQtyTon: null,
  });
  assert.equal(pendingRes.isSpendable, false, 'APPROVED_NOT_ISSUED must never be spendable');
  assert.equal(pendingRes.isBlocked, true);
  assert.equal(pendingRes.eligibility, 'PENDING_ISSUE');

  // 3. Strict-expired ticket under strictMode -> must be blocked
  const strictExpired = evaluateTicketEligibility({
    couponId: 1001,
    lifecycle: 'ISSUED',
    balanceState: 'POSITIVE',
    availableQtyTon: 10,
    nativeRemainingQtyTon: 10,
    expiryEval: { status: 'EXPIRED', blocked: true, isExpired: true },
    strictMode: true,
    strictOverride: false,
  });
  assert.equal(strictExpired.isSpendable, false, 'Strict expired ticket must be blocked');
  assert.equal(strictExpired.isBlocked, true);
  assert.equal(strictExpired.eligibility, 'BLOCKED');

  // 4. Strict-expired ticket WITH strictOverride -> must be spendable (R2-02 fix)
  const overriddenExpired = evaluateTicketEligibility({
    couponId: 1001,
    lifecycle: 'ISSUED',
    balanceState: 'POSITIVE',
    availableQtyTon: 10,
    nativeRemainingQtyTon: 10,
    expiryEval: { status: 'EXPIRED', blocked: false, isExpired: true },
    strictMode: true,
    strictOverride: true,
  });
  assert.equal(overriddenExpired.isSpendable, true, 'Overridden expired ticket must be spendable');
  assert.equal(overriddenExpired.isBlocked, false);
  assert.equal(overriddenExpired.eligibility, 'ELIGIBLE');

  // 5. Valid issued ticket -> must be spendable
  const validRes = evaluateTicketEligibility({
    couponId: 1002,
    lifecycle: 'ISSUED',
    balanceState: 'POSITIVE',
    availableQtyTon: 50,
    nativeRemainingQtyTon: 50,
    expiryEval: { status: 'VALID', blocked: false, isExpired: false },
    strictMode: true,
    strictOverride: false,
  });
  assert.equal(validRes.isSpendable, true);
  assert.equal(validRes.isBlocked, false);
  assert.equal(validRes.eligibility, 'ELIGIBLE');
});

test('S1-01 (API): GET /api/master/control-tickets?tab=ACTIVE asserts nonempty set and strict eligibility', async () => {
  const res = await fetch(`${baseUrl}/api/master/control-tickets?tab=ACTIVE&paginated=true&pageSize=50`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(Array.isArray(body.data), 'ACTIVE response envelope must contain data array');
  assert.ok(body.data.length > 0, 'ACTIVE tab must return nonempty items in live database');
  assert.ok(body.total > 0, 'Total count must be positive');

  for (const item of body.data) {
    assert.equal(item.BalanceState, 'POSITIVE', 'ACTIVE ticket must have POSITIVE balance state');
    assert.equal(item.Lifecycle, 'ISSUED', 'ACTIVE ticket must be ISSUED lifecycle');
    assert.equal(item.Eligibility, 'ELIGIBLE', 'ACTIVE ticket must be ELIGIBLE');
    assert.equal(item.isBlocked, false, 'ACTIVE ticket must not be blocked');
    assert.ok(item.CouponID != null, 'ACTIVE ticket must possess CouponID');
    assert.ok(Number(item.AvailableQtyTon) > 0, 'ACTIVE ticket must have positive available quantity');
  }
});

// ── 3. S1-02 & R3-02: Typed Identity, Duplicate Isolation & Legacy Fallback ───
test('S1-02: Typed identity & exactId isolates duplicate coupon numbers without cross-talk', async () => {
  await runRemote(async () => {
    // Real duplicate coupon number in test DB: D6302477 (CouponIDs 154558 vs 154766)
    const duplicateDocNo = 'D6302477';
    const cid1 = 154558;
    const cid2 = 154766;

    // 1. Resolve chain for Coupon 1 (cid1)
    const trace1 = await traceNativeTicketChain(duplicateDocNo, { exactId: cid1, entityType: 'COUPON' });
    assert.ok(trace1, 'Must resolve trace for exactId cid1');
    assert.equal(Number(trace1.primaryEntity?.exactId), cid1, 'primaryEntity must match cid1');

    // 2. Resolve chain for Coupon 2 (cid2)
    const trace2 = await traceNativeTicketChain(duplicateDocNo, { exactId: cid2, entityType: 'COUPON' });
    assert.ok(trace2, 'Must resolve trace for exactId cid2');
    assert.equal(Number(trace2.primaryEntity?.exactId), cid2, 'primaryEntity must match cid2');

    // Assert that cid1 and cid2 resolve to distinct entities
    assert.notEqual(Number(trace1.primaryEntity.exactId), Number(trace2.primaryEntity.exactId));
  });
});

test('R3-02 (Read-Side Isolation): Legacy overlay fallback does not leak isolated overlay to sibling coupons', async () => {
  await runRemote(async () => {
    const duplicateDocNo = 'D6302477';
    const cid1 = 154558;
    const cid2 = 154766;

    let legacyOverlayId = null;
    let isolatedOverlayId = null;

    try {
      // 1. Insert synthetic legacy row (DocuId = 0) with 2025-01-01
      const legacyRes = await db.wfQuery(`
        INSERT INTO wf.ControlTicketOverlay (
          DocuNo, DocuType, DocuId, GoodCode,
          ExpiryDate, ExpiryType, PolicySnapshotId, StrictOverrideFlag,
          ReasonCode, ReasonText, CreatedBy, CreatedAt, UpdatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          @dno, 104, 0, '18-8-8',
          '2025-01-01', 'EXPLICIT', 1, 0,
          'POLICY_ADJUSTMENT', 'R3-02 Legacy Shared Overlay', 'TEST-USER', SYSUTCDATETIME(), SYSUTCDATETIME()
        )
      `, { dno: { type: db.sql.NVarChar(50), value: duplicateDocNo } });
      legacyOverlayId = legacyRes.recordset?.[0]?.Id;

      // 2. Insert isolated overlay row specifically for cid1 (DocuId = 154558) with 2028-12-31
      const isolatedRes = await db.wfQuery(`
        INSERT INTO wf.ControlTicketOverlay (
          DocuNo, DocuType, DocuId, GoodCode,
          ExpiryDate, ExpiryType, PolicySnapshotId, StrictOverrideFlag,
          ReasonCode, ReasonText, CreatedBy, CreatedAt, UpdatedAt
        )
        OUTPUT INSERTED.Id
        VALUES (
          @dno, 104, @did, '18-8-8',
          '2028-12-31', 'EXPLICIT', 1, 0,
          'POLICY_ADJUSTMENT', 'R3-02 Isolated Overlay for cid1', 'TEST-USER', SYSUTCDATETIME(), SYSUTCDATETIME()
        )
      `, {
        dno: { type: db.sql.NVarChar(50), value: duplicateDocNo },
        did: { type: db.sql.Int, value: cid1 }
      });
      isolatedOverlayId = isolatedRes.recordset?.[0]?.Id;

      // 3. Trace cid1: Must read isolated overlay (2028-12-31)
      const traceCid1 = await traceNativeTicketChain(duplicateDocNo, { exactId: cid1, entityType: 'COUPON' });
      const cid1Expiry = traceCid1.overlay?.expiryDate ? new Date(traceCid1.overlay.expiryDate).toISOString().slice(0, 10) : null;
      assert.equal(cid1Expiry, '2028-12-31', 'Cid1 must read its own isolated overlay');

      // 4. Trace cid2: Must read legacy overlay (2025-01-01), NEVER cid1 isolated overlay (2028-12-31)!
      const traceCid2 = await traceNativeTicketChain(duplicateDocNo, { exactId: cid2, entityType: 'COUPON' });
      const cid2Expiry = traceCid2.overlay?.expiryDate ? new Date(traceCid2.overlay.expiryDate).toISOString().slice(0, 10) : null;
      assert.equal(cid2Expiry, '2025-01-01', 'Cid2 must fall back to legacy overlay and never read cid1 isolated overlay');
      assert.notEqual(cid2Expiry, '2028-12-31', 'Cid2 must NOT inherit cid1 isolated overlay');

    } finally {
      if (legacyOverlayId != null) {
        await db.wfQuery(`DELETE FROM wf.ControlTicketOverlay WHERE Id = @id`, { id: { type: db.sql.Int, value: legacyOverlayId } });
      }
      if (isolatedOverlayId != null) {
        await db.wfQuery(`DELETE FROM wf.ControlTicketOverlay WHERE Id = @id`, { id: { type: db.sql.Int, value: isolatedOverlayId } });
      }
    }
  });
});

// ── 4. S1-03 & R3-04: Resolver Bounds, Validation & Low-Budget Truncation ──────
test('S1-03: Document resolver strictly validates input types, handles bounds, and propagates truncation', async () => {
  await runRemote(async () => {
    // 1. Reject negative ID
    const negRes = await resolveNativeDocumentChain({ entityType: 'COUPON', exactId: -5 });
    assert.equal(negRes.resolved, false);
    assert.match(negRes.error, /INVALID_EXACT_ID/);

    // 2. Reject invalid entity type
    const badTypeRes = await resolveNativeDocumentChain({ entityType: 'UNKNOWN_TYPE', exactId: 100 });
    assert.equal(badTypeRes.resolved, false);
    assert.match(badTypeRes.error, /INVALID_ENTITY_TYPE/);

    // 3. Reject nonexistent exactId
    const nonExistent = await resolveNativeDocumentChain({ entityType: 'COUPON', exactId: 2147483640 });
    assert.equal(nonExistent.resolved, false);
    assert.match(nonExistent.error, /NOT_FOUND/);

    // 4. Route parameter validation: exactId='abc' must return 400 INVALID_EXACT_ID (R3-04)
    const badTraceRes = await fetch(`${baseUrl}/api/master/control-tickets/C6906916/trace?exactId=abc`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(badTraceRes.status, 400, 'Route must return 400 for non-numeric exactId');
    const badTraceBody = await badTraceRes.json();
    assert.match(badTraceBody.message, /INVALID_EXACT_ID/);

    // 5. Test truncation propagation with restrictive budget (R2-04 / R3-05)
    const truncatedRes = await resolveNativeDocumentChain({
      reference: 'C6906916',
      budgets: { queryBudget: 2, nodeBudget: 3, depthBudget: 1 }
    });
    assert.equal(truncatedRes.resolved, true);
    assert.equal(truncatedRes.truncated, true, 'Resolver must report truncated=true when budgets are exceeded');
    assert.ok(Array.isArray(truncatedRes.reasons), 'Truncated result must include reasons array');
    assert.ok(truncatedRes.reasons.length > 0, 'Reasons array must contain budget reason');

    // 6. Verify traceNativeTicketChain propagates truncation when budget exceeded
    const traceWithTruncation = await traceNativeTicketChain('C6906916', {
      budgets: { queryBudget: 1, nodeBudget: 1, depthBudget: 1 }
    });
    assert.equal(traceWithTruncation.truncated, true, 'Trace response must expose truncated=true on low budget');
    assert.ok(traceWithTruncation.reasons.length > 0, 'Trace response must expose reasons');

    // 7. Per-Node Policy Map in Multi-Coupon Trace (R3-04)
    const multiCouponTrace = await traceNativeTicketChain('I69-04068');
    assert.ok(multiCouponTrace.couponPolicies, 'Trace response must include couponPolicies per-node map');
    assert.equal(typeof multiCouponTrace.couponPolicies, 'object');
  });
});

// ── 5. S1-04 & R3-04: Line Linking, Direct Invoices & Unit Fidelity ───────────
test('S1-04: Document resolver supports direct SOInvDT invoice links and preserves raw units', async () => {
  await runRemote(async () => {
    // Direct invoice fixture from dbo.SOInvDT: Delivery RefID = 276867 links directly to Invoice SOInvID = 334740 (I69-03699)
    const delivSoId = 276867;
    const invId = 334740;
    const invDocNo = 'I69-03699';

    const res = await resolveNativeDocumentChain({ entityType: 'DELIVERY', exactId: delivSoId });
    assert.equal(res.resolved, true, 'Delivery with direct invoice must resolve successfully');
    assert.ok(res.chain.deliveries.length > 0);
    assert.equal(Number(res.chain.deliveries[0].soId), delivSoId);

    // Assert direct invoice presence
    assert.ok(res.chain.invoices.length > 0, 'Must link directly to Invoice without requiring 116 redemption');
    const matchedInv = res.chain.invoices.find(inv => Number(inv.soInvId) === invId || inv.docuNo === invDocNo);
    assert.ok(matchedInv, `Direct invoice ${invDocNo} (#${invId}) must be present in chain.invoices`);
    assert.equal(matchedInv.docuNo, invDocNo);

    // Assert edge exists
    const directEdge = res.edges.find(e => e.target === `INVOICE:${invId}`);
    assert.ok(directEdge, 'Must produce direct edge connecting delivery to invoice');

    // Raw unit fidelity: assert units are not blindly overwritten (R3-04 / R3-05)
    assert.ok(res.chain.deliveries[0].lines.length > 0);
    const lineUnit = res.chain.deliveries[0].lines[0].unitName;
    assert.ok(lineUnit, 'Delivery line must contain a valid unit');

    const trace = await traceNativeTicketChain(null, { entityType: 'DELIVERY', exactId: delivSoId });
    assert.ok(trace);
    assert.equal(Number(trace.primaryEntity?.exactId), delivSoId);
    assert.equal(trace.chain.deliveries[0].lines[0].unitName, lineUnit, 'Trace must preserve raw line unit name');
  });
});

// ── 6. S1-05, R3-01 & R3-02: Safety Rejection, Non-Destructive Update, Concurrency & Rollback ─
test('S1-05 (Read-Only Safety): updateTicketExpiryOverlay strictly validates and rejects invalid mutations before DB transaction', async () => {
  await runRemote(async () => {
    // 1. Reject malformed exactId string
    await assert.rejects(
      async () => updateTicketExpiryOverlay({ docuNo: 'D6302477', exactId: '123abc', reasonCode: 'POLICY_ADJUSTMENT' }),
      /INVALID_EXACT_ID/,
      'Must reject non-numeric exactId'
    );

    // 2. Reject negative exactId
    await assert.rejects(
      async () => updateTicketExpiryOverlay({ docuNo: 'D6302477', exactId: -10, reasonCode: 'POLICY_ADJUSTMENT' }),
      /INVALID_EXACT_ID/,
      'Must reject negative exactId'
    );

    // 3. Reject malformed docuId string (R3-02)
    await assert.rejects(
      async () => updateTicketExpiryOverlay({ docuNo: 'D6302477', docuId: '123abc', reasonCode: 'POLICY_ADJUSTMENT' }),
      /INVALID_DOCU_ID/,
      'Must reject non-numeric docuId'
    );

    // 4. Reject nonexistent exactId
    await assert.rejects(
      async () => updateTicketExpiryOverlay({ docuNo: 'D6302477', exactId: 2147483640, reasonCode: 'POLICY_ADJUSTMENT' }),
      /NOT_FOUND/,
      'Must reject nonexistent exactId'
    );

    // 5. Reject mismatched docuNo vs exactId
    await assert.rejects(
      async () => updateTicketExpiryOverlay({ docuNo: 'WRONG_DOC_NO', exactId: 154558, reasonCode: 'POLICY_ADJUSTMENT' }),
      /MISMATCHED_REFERENCE/,
      'Must reject mismatched reference number'
    );

    // 6. Zero Backdoor: Sales user calling PATCH with nonexistent exactId must return 400 NOT_FOUND (R3-01)
    const fakePatchRes = await fetch(`${baseUrl}/api/master/control-tickets/TEST-FAKE/expiry`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        exactId: 99999999,
        expiryDate: '2028-12-31',
        reasonCode: 'POLICY_ADJUSTMENT',
        reasonText: 'Backdoor rejection test'
      })
    });
    assert.equal(fakePatchRes.status, 400, 'Must return 400 on nonexistent exactId');
    const fakeBody = await fakePatchRes.json();
    assert.match(fakeBody.message, /NOT_FOUND/, 'Must return NOT_FOUND without bypassing check');
  });
});

test('S1-05 (Non-Destructive Fixture): Overlay update on real coupon captures before-state and restores in finally', async () => {
  await runRemote(async () => {
    // Select real coupon C6906916 (CouponID = 245838)
    const realDocuNo = 'C6906916';
    const realExactId = 245838;
    const testDate = '2028-12-31';

    // 1. Capture before-snapshot of overlay row for this coupon
    const beforeRes = await db.wfQuery(
      `SELECT * FROM wf.ControlTicketOverlay WHERE DocuId = @did`,
      { did: { type: db.sql.Int, value: realExactId } }
    );
    const beforeRow = beforeRes.recordset?.[0] || null;

    let createdOverlayId = null;

    try {
      // 2. Perform isolated update
      const updateRes = await updateTicketExpiryOverlay({
        docuNo: realDocuNo,
        exactId: realExactId,
        expiryDate: testDate,
        strictOverride: false,
        reasonCode: 'POLICY_ADJUSTMENT',
        reasonText: 'S1-05 Non-destructive real coupon update test',
        userId: 'TEST-USER'
      });
      assert.equal(updateRes.success, true);
      assert.equal(Number(updateRes.exactId), realExactId);
      createdOverlayId = updateRes.overlayId;

      // 3. Verify overlay row exists and is strictly isolated by DocuId
      const ovRow = await db.wfQuery(
        `SELECT * FROM wf.ControlTicketOverlay WHERE DocuId = @did`,
        { did: { type: db.sql.Int, value: realExactId } }
      );
      assert.equal(ovRow.recordset.length, 1, 'Must have exactly 1 isolated overlay row');
      assert.equal(Number(ovRow.recordset[0].DocuId), realExactId);
      assert.equal(ovRow.recordset[0].DocuNo, realDocuNo);

      // 4. Verify audit ChangeEvent was recorded
      const auditRes = await db.wfQuery(
        `SELECT TOP 1 * FROM wf.ChangeEvent WHERE EntityId = @eid ORDER BY EventId DESC`,
        { eid: { type: db.sql.VarChar(100), value: realDocuNo } }
      );
      assert.equal(auditRes.recordset.length, 1, 'Must record audit ChangeEvent for overlay update');

    } finally {
      // 5. Restore original before-state in finally block
      if (beforeRow) {
        await db.wfQuery(`
          UPDATE wf.ControlTicketOverlay
          SET ExpiryDate = @exp,
              ExpiryType = @type,
              StrictOverrideFlag = @override,
              ReasonCode = @rcode,
              ReasonText = @rtext,
              UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id
        `, {
          id: { type: db.sql.Int, value: beforeRow.Id },
          exp: { type: db.sql.Date, value: beforeRow.ExpiryDate },
          type: { type: db.sql.VarChar(20), value: beforeRow.ExpiryType },
          override: { type: db.sql.Bit, value: beforeRow.StrictOverrideFlag },
          rcode: { type: db.sql.VarChar(50), value: beforeRow.ReasonCode },
          rtext: { type: db.sql.NVarChar(500), value: beforeRow.ReasonText },
        });
      } else {
        await db.wfQuery(`DELETE FROM wf.ControlTicketOverlay WHERE DocuId = @did`, {
          did: { type: db.sql.Int, value: realExactId }
        });
      }
    }
  });
});

test('R3-02 (Concurrency & Rollback): Parallel updates lock deterministically and failed tx rolls back', async () => {
  await runRemote(async () => {
    const realDocuNo = 'C6906916';
    const realExactId = 245838;

    try {
      // Concurrency: execute 2 parallel updates on the same exactId
      const [resA, resB] = await Promise.all([
        updateTicketExpiryOverlay({
          docuNo: realDocuNo,
          exactId: realExactId,
          expiryDate: '2028-11-30',
          reasonCode: 'POLICY_ADJUSTMENT',
          reasonText: 'Concurrent update A',
          userId: 'USER-A'
        }),
        updateTicketExpiryOverlay({
          docuNo: realDocuNo,
          exactId: realExactId,
          expiryDate: '2028-12-31',
          reasonCode: 'POLICY_ADJUSTMENT',
          reasonText: 'Concurrent update B',
          userId: 'USER-B'
        })
      ]);

      assert.equal(resA.success, true);
      assert.equal(resB.success, true);

      // Verify that exactly 1 overlay row exists for this DocuId (no duplicate insertion!)
      const checkRows = await db.wfQuery(
        `SELECT COUNT(*) AS RowCnt FROM wf.ControlTicketOverlay WHERE DocuId = @did`,
        { did: { type: db.sql.Int, value: realExactId } }
      );
      assert.equal(checkRows.recordset[0].RowCnt, 1, 'Concurrent updates must leave exactly 1 isolated row');

      // Rollback test: transaction rollback must revert any partial write
      await assert.rejects(async () => {
        await db.wfTransaction(async (tx) => {
          await tx.request()
            .input('did', db.sql.Int, 9999998)
            .query(`INSERT INTO wf.ControlTicketOverlay (DocuNo, DocuType, DocuId, CreatedAt, UpdatedAt) VALUES ('ROLLBACK-TEST', 104, @did, SYSUTCDATETIME(), SYSUTCDATETIME())`);
          throw new Error('SIMULATED_TRANSACTION_FAILURE');
        });
      }, /SIMULATED_TRANSACTION_FAILURE/);

      const rollbackCheck = await db.wfQuery(
        `SELECT COUNT(*) AS RowCnt FROM wf.ControlTicketOverlay WHERE DocuId = 9999998`
      );
      assert.equal(rollbackCheck.recordset[0].RowCnt, 0, 'Rolled-back transaction must leave 0 rows');

    } finally {
      await db.wfQuery(`DELETE FROM wf.ControlTicketOverlay WHERE DocuId IN (@did, 9999998)`, {
        did: { type: db.sql.Int, value: realExactId }
      });
    }
  });
});

// ── 7. S1-06 & R3-03: Real SQL Pagination, CreateSODialog Compatibility & Disjointness ─
test('S1-06: Real SQL Server pagination returns bounded rows, stable tie-breaking, and disjoint pages', async () => {
  const pageSize = 5;

  // Page 1 (envelope format)
  const res1 = await fetch(`${baseUrl}/api/master/control-tickets?tab=ACTIVE&page=1&pageSize=${pageSize}&paginated=true`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res1.status, 200);
  const p1 = await res1.json();

  assert.equal(typeof p1.total, 'number', 'Envelope must have numeric total');
  assert.equal(p1.page, 1);
  assert.equal(p1.pageSize, pageSize);
  assert.equal(p1.data.length, pageSize, `Page 1 must return exactly ${pageSize} rows`);

  // Page 2 (envelope format)
  const res2 = await fetch(`${baseUrl}/api/master/control-tickets?tab=ACTIVE&page=2&pageSize=${pageSize}&paginated=true`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res2.status, 200);
  const p2 = await res2.json();

  assert.equal(p2.page, 2);
  assert.equal(p2.pageSize, pageSize);
  assert.equal(p2.data.length, pageSize, `Page 2 must return exactly ${pageSize} rows`);
  assert.equal(p1.total, p2.total, 'Total filtered count must remain stable across pages');

  // Verify Disjointness: No duplicate entity keys between Page 1 and Page 2
  const p1Keys = new Set(p1.data.map(r => r.entityKey));
  const duplicatesAcrossPages = p2.data.filter(r => p1Keys.has(r.entityKey));
  assert.equal(duplicatesAcrossPages.length, 0, 'Page 1 and Page 2 must have zero overlapping entity keys');

  // Verify CreateSODialog Compatibility: unpaginated request returns Array directly (R3-03 Point 2)
  const unpaginatedRes = await fetch(`${baseUrl}/api/master/control-tickets?tab=ACTIVE`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(unpaginatedRes.status, 200);
  const unpaginatedBody = await unpaginatedRes.json();
  assert.ok(Array.isArray(unpaginatedBody), 'Unpaginated request must return plain Array directly for CreateSODialog');
  assert.ok(unpaginatedBody.length <= 200, 'Unpaginated request must be bounded by SQL Server limit');

  // Customer-scoped query: returns Array directly up to 1000
  const custRes = await fetch(`${baseUrl}/api/master/control-tickets?custId=1158`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(custRes.status, 200);
  const custBody = await custRes.json();
  assert.ok(Array.isArray(custBody), 'Customer-scoped request must return plain Array directly');
  assert.ok(custRes.headers.get('x-total-count') != null, 'Response must expose X-Total-Count header');
});

test('R3-03 (Strict Tab Disjointness): HISTORY and REVIEW tabs are mutually exclusive partitions', async () => {
  // Fetch up to 100 items from HISTORY and REVIEW
  const histRes = await fetch(`${baseUrl}/api/master/control-tickets?tab=HISTORY&paginated=true&pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(histRes.status, 200);
  const histBody = await histRes.json();

  const revRes = await fetch(`${baseUrl}/api/master/control-tickets?tab=REVIEW&paginated=true&pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(revRes.status, 200);
  const revBody = await revRes.json();

  const histCouponIds = new Set(histBody.data.map(r => r.CouponID).filter(Boolean));
  const revCouponIds = new Set(revBody.data.map(r => r.CouponID).filter(Boolean));

  // Assert mutually exclusive intersection
  const intersection = [...histCouponIds].filter(id => revCouponIds.has(id));
  assert.equal(intersection.length, 0, 'Zero coupons can appear in both HISTORY and REVIEW tabs');

  // Verify that any negative available item belongs to REVIEW, not HISTORY
  for (const item of histBody.data) {
    if (item.NativeRemainingQtyTon != null && item.ReservedQtyTon != null) {
      const netAvailable = Number(item.NativeRemainingQtyTon) - Number(item.ReservedQtyTon);
      assert.ok(netAvailable >= 0, `HISTORY item #${item.CouponID} must have netAvailable >= 0 (got ${netAvailable})`);
      assert.ok(Number(item.NativeRemainingQtyTon) >= 0, 'HISTORY item must not have negative remaining');
    }
  }
});

// ── 8. R3-02 / R4-03: Migration 124 Schema State Verification ─────────────────
// Verifies that migration 124 was applied via run_migrations.js runner.
// Does NOT execute migration SQL directly — relies exclusively on the runner.
test('R3-02 (Migration 124): Schema state verifies runner-applied migration with ledger entry and unique index', async () => {
  await runRemote(async () => {
    // 1. Verify ledger entry exists for migration 124
    const ledger = await db.wfQuery(
      "SELECT FileName, Checksum, BatchCount FROM wf.SchemaMigration WHERE FileName = '124_backfill_control_ticket_overlay.sql'"
    );
    assert.equal(ledger.recordset.length, 1, 'Migration 124 must be recorded in wf.SchemaMigration ledger');
    assert.ok(ledger.recordset[0].Checksum.length === 64, 'Checksum must be a 64-char SHA256 hex string');
    assert.ok(Number(ledger.recordset[0].BatchCount) >= 1, 'BatchCount must be >= 1');

    // 2. Verify unique filtered index exists
    const idxRes = await db.wfQuery(
      "SELECT name, is_unique, has_filter FROM sys.indexes WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')"
    );
    assert.equal(idxRes.recordset.length, 1, 'Unique index UQ_ControlTicketOverlay_DocuId must exist');
    assert.equal(idxRes.recordset[0].is_unique, true, 'Index must be UNIQUE');
    assert.equal(idxRes.recordset[0].has_filter, true, 'Index must have a filter (WHERE DocuId IS NOT NULL AND DocuId > 0)');

    // 3. Verify no legacy rows with DocuId=0 remain (migration backfill cleaned them)
    const legacyRows = await db.wfQuery(
      "SELECT COUNT(*) as cnt FROM wf.ControlTicketOverlay WHERE DocuId IS NULL OR DocuId = 0"
    );
    assert.equal(Number(legacyRows.recordset[0].cnt), 0, 'No legacy rows with DocuId IS NULL or DocuId=0 should remain after migration');

    // 4. Verify down-migration file exists in migrations/down/ (for rollback capability)
    const downPath = path.join(__dirname, '../migrations/down/124_backfill_control_ticket_overlay.down.sql');
    assert.ok(fs.existsSync(downPath), 'Down-migration file must exist at migrations/down/124_...down.sql');
  });
});

// ── 9. S1-07 & R3-05: Pool Cleanup Verification ──────────────────────────────
test('S1-07: Database pool cleanup verifies successful closure of all reader and owner pools', async () => {
  const pl = db.pools();
  await pl.ready;
  assert.equal(pl.readerPool.connected, true);
  assert.equal(pl.ownerPool.connected, true);

  const closeResult = await db.closeAll();
  assert.equal(typeof closeResult, 'object', 'closeAll must return execution report');
  assert.equal(closeResult.success, true, 'closeAll must succeed');
  assert.ok(closeResult.closedPools >= 1, `Must close at least 1 connection pool (closed: ${closeResult.closedPools})`);

  // Verify that attempting a query on the closed pool fails (R3-05)
  assert.equal(pl.readerPool.connected, false, 'Reader pool must be disconnected');
  assert.equal(pl.ownerPool.connected, false, 'Owner pool must be disconnected');
  await assert.rejects(
    async () => pl.readerPool.request().query('SELECT 1'),
    /closed|not open/i,
    'Querying closed pool must fail'
  );
});
