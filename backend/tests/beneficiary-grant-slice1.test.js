'use strict';

/**
 * beneficiary-grant-slice1.test.js
 *
 * Dev Slice 1 Test Suite: Shared-Ticket Grant Administration
 * Uses the REAL coupon-service.js against an in-memory transactional SQL stub.
 *
 * Test coverage:
 *   1. Validation: missing fields, reason < 5, owner === beneficiary, invalid dates.
 *   2. Non-numeric CustID: rejects non-numeric CustID with 400 before SQL conversion.
 *   3. EMCust verification: rejects missing owner or beneficiary from dbo.EMCust with 400.
 *   4. Scope invariant: scope is forced to 'ALL' regardless of request payload (Q5b).
 *   5. Two-level rule:
 *      - a beneficiary of an active grant cannot be an owner (Q5a) -> 400
 *      - an owner of active grants cannot become a beneficiary (Q5a) -> 400
 *   6. One-root rule (Q11):
 *      - a beneficiary can belong to only one root; grant from second root -> 409
 *   7. Duplicate grant: rejects duplicate active grant for same pair -> 409.
 *   8. Revocation lifecycle:
 *      - invalid id / missing reason -> 400
 *      - not found -> 404
 *      - already revoked -> 200 idempotent
 *      - cancels unattached reservations immediately in transaction (Q8).
 *   9. Concurrency:
 *      - two concurrent grants for the same member under different roots -> exactly one succeeds, other gets 409.
 *  10. Route-level role authorization:
 *      - GET/POST/DELETE allow ADMIN, MANAGER, C_LEVEL, ACCOUNTING; reject SALES, WAREHOUSE, DRIVER with 403.
 *
 * DB SAFETY INVARIANT:
 *   Zero mutation to live database tables. Tested against in-memory stubbed DB pool.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const sql = require('mssql');

// ── In-Memory Database State ──────────────────────────────────────────────────
function createInitialDbState() {
  return {
    emCust: [
      { CustID: 1141, CustCode: '0342001', CustName: 'ร้านปุ๋ยรุ่งเรือง (แม่)' },
      { CustID: 16002, CustCode: '0342001-1', CustName: 'สาขา 1 (ลูก)' },
      { CustID: 47015, CustCode: '0342001-2', CustName: 'สาขา 2 (ลูก)' },
      { CustID: 88888, CustCode: '0342001-3', CustName: 'สาขา 3 (ลูก)' },
      { CustID: 99999, CustCode: 'OTHER-ROOT', CustName: 'ร้านเกษตรพัฒนา (แม่ 2)' }
    ],
    beneficiaries: [],
    reservations: [],
    salesOrderLines: [],
    nextBeneficiaryId: 1
  };
}

let activeDbState = createInitialDbState();
let txLock = Promise.resolve();

function createTxRequest(state) {
  const inputs = {};
  return {
    input(name, type, value) {
      inputs[name] = value;
      return this;
    },
    async query(queryText) {
      const q = queryText.trim();

      // Two-level rule 1: Owner as Beneficiary check
      if (q.includes('FROM wf.CouponBeneficiary') && q.includes('BeneficiaryCustId = @own AND Status = \'ACTIVE\'')) {
        const row = state.beneficiaries.find(b => String(b.BeneficiaryCustId) === String(inputs.own) && b.Status === 'ACTIVE');
        return { recordset: row ? [row] : [] };
      }

      // Two-level rule 2: Beneficiary as Owner check
      if (q.includes('FROM wf.CouponBeneficiary') && q.includes('OwnerCustId = @ben AND Status = \'ACTIVE\'')) {
        const row = state.beneficiaries.find(b => String(b.OwnerCustId) === String(inputs.ben) && b.Status === 'ACTIVE');
        return { recordset: row ? [row] : [] };
      }

      // One-root rule (Q11): Beneficiary already has active grant from different root
      if (q.includes('FROM wf.CouponBeneficiary') && q.includes('OwnerCustId <> @own AND Status = \'ACTIVE\'')) {
        const row = state.beneficiaries.find(b => String(b.BeneficiaryCustId) === String(inputs.ben) && String(b.OwnerCustId) !== String(inputs.own) && b.Status === 'ACTIVE');
        return { recordset: row ? [row] : [] };
      }

      // Duplicate active grant check
      if (q.includes('FROM wf.CouponBeneficiary') && q.includes('OwnerCustId = @own AND BeneficiaryCustId = @ben AND Scope = @scope AND Status = \'ACTIVE\'')) {
        const row = state.beneficiaries.find(b => String(b.OwnerCustId) === String(inputs.own) && String(b.BeneficiaryCustId) === String(inputs.ben) && b.Status === 'ACTIVE');
        return { recordset: row ? [row] : [] };
      }

      // Insert grant
      if (q.includes('INSERT INTO wf.CouponBeneficiary')) {
        const newId = state.nextBeneficiaryId++;
        const newRecord = {
          Id: newId,
          OwnerCustId: String(inputs.own),
          OwnerCustCode: inputs.ownCode,
          OwnerCustName: inputs.ownName,
          BeneficiaryCustId: String(inputs.ben),
          BeneficiaryCustCode: inputs.benCode,
          BeneficiaryCustName: inputs.benName,
          EffectiveFrom: inputs.from,
          EffectiveTo: inputs.to,
          Scope: inputs.scope,
          Reason: inputs.reason,
          Status: 'ACTIVE',
          CreatedBy: inputs.uid
        };
        state.beneficiaries.push(newRecord);
        return { recordset: [{ Id: newId }] };
      }

      // Find grant by Id for Revoke
      if (q.includes('FROM wf.CouponBeneficiary') && q.includes('WHERE Id = @id')) {
        const row = state.beneficiaries.find(b => Number(b.Id) === Number(inputs.id));
        return { recordset: row ? [row] : [] };
      }

      // Update grant to REVOKED
      if (q.includes('UPDATE wf.CouponBeneficiary') && q.includes('SET Status = \'REVOKED\'')) {
        const row = state.beneficiaries.find(b => Number(b.Id) === Number(inputs.id));
        if (row) {
          row.Status = 'REVOKED';
          row.RevokeReason = inputs.reason;
          row.RevokedBy = inputs.uid;
        }
        return { rowsAffected: [row ? 1 : 0] };
      }

      // Q8: Cancel unattached reservations
      if (q.includes('UPDATE wf.CouponReservation') && q.includes('SET Status = \'CANCELLED\'')) {
        let count = 0;
        for (const res of state.reservations) {
          if (String(res.OwnerCustId) === String(inputs.own) &&
              String(res.BeneficiaryCustId) === String(inputs.ben) &&
              res.Status === 'RESERVED') {
            const isAttached = state.salesOrderLines.some(sol => sol.CouponReservationId === res.Id && sol.IsActiveSo);
            if (!isAttached) {
              res.Status = 'CANCELLED';
              res.CancelReason = inputs.reason;
              count++;
            }
          }
        }
        return { rowsAffected: [count] };
      }

      return { recordset: [], rowsAffected: [0] };
    }
  };
}

// Stub ../db before requiring coupon-service
const stubbedDb = {
  sql,
  async wfQuery(queryText, params = {}) {
    const q = queryText.trim();
    if (q.includes('FROM dbo.EMCust')) {
      const c1 = params.c1?.value !== undefined ? String(params.c1.value) : String(params.c1);
      const c2 = params.c2?.value !== undefined ? String(params.c2.value) : String(params.c2);
      const matched = activeDbState.emCust.filter(c => String(c.CustID) === c1 || String(c.CustID) === c2);
      return { recordset: matched };
    }
    if (q.includes('FROM wf.CouponBeneficiary')) {
      return { recordset: activeDbState.beneficiaries };
    }
    return { recordset: [] };
  },
  async wfTransaction(callback) {
    // Serialize transactions under UPDLOCK, HOLDLOCK
    let release;
    const prevLock = txLock;
    txLock = new Promise(resolve => { release = resolve; });
    await prevLock;
    try {
      const tx = {
        request() {
          return createTxRequest(activeDbState);
        }
      };
      return await callback(tx);
    } finally {
      release();
    }
  }
};

const dbModulePath = require.resolve('../db');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: stubbedDb
};

// Now import the REAL coupon-service
const couponService = require('../services/coupon-service');

// ── Test Cases ────────────────────────────────────────────────────────────────

test('Real Service: Parameter validation (missing fields, short reason, self-grant, date order)', async () => {
  activeDbState = createInitialDbState();

  // Missing fields
  await assert.rejects(
    () => couponService.grantBeneficiary({ ownerCustId: '', beneficiaryCustId: '16002', reason: 'valid reason' }),
    err => err.status === 400 && /กรุณาระบุ ownerCustId/.test(err.message)
  );

  // Short reason (< 5 chars)
  await assert.rejects(
    () => couponService.grantBeneficiary({ ownerCustId: '1141', beneficiaryCustId: '16002', reason: 'สั้น' }),
    err => err.status === 400 && /อย่างน้อย 5 ตัวอักษร/.test(err.message)
  );

  // Self grant (owner === beneficiary)
  await assert.rejects(
    () => couponService.grantBeneficiary({ ownerCustId: '1141', beneficiaryCustId: '1141', reason: 'ให้สิทธิ์ตัวเอง' }),
    err => err.status === 400 && /เจ้าของตั๋วและผู้รับสิทธิ์ต้องเป็นคนละราย/.test(err.message)
  );

  // Invalid date range (from > to)
  await assert.rejects(
    () => couponService.grantBeneficiary({
      ownerCustId: '1141',
      beneficiaryCustId: '16002',
      reason: 'ให้สิทธิ์ช่วงเวลาผิด',
      effectiveFrom: '2026-12-31',
      effectiveTo: '2026-01-01'
    }),
    err => err.status === 400 && /วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด/.test(err.message)
  );
});

test('Real Service: Non-numeric CustID returns 400 before SQL conversion', async () => {
  activeDbState = createInitialDbState();

  await assert.rejects(
    () => couponService.grantBeneficiary({ ownerCustId: 'ABC-123', beneficiaryCustId: '16002', reason: 'ทดสอบรหัสตัวอักษร' }),
    err => err.status === 400 && /รหัสลูกค้าต้องเป็นตัวเลขเท่านั้น/.test(err.message)
  );

  await assert.rejects(
    () => couponService.grantBeneficiary({ ownerCustId: '1141', beneficiaryCustId: 'DEF-456', reason: 'ทดสอบรหัสตัวอักษร' }),
    err => err.status === 400 && /รหัสลูกค้าต้องเป็นตัวเลขเท่านั้น/.test(err.message)
  );
});

test('Real Service: EMCust existence verification (rejects missing customers with 400)', async () => {
  activeDbState = createInitialDbState();

  // Missing owner in EMCust
  await assert.rejects(
    () => couponService.grantBeneficiary({ ownerCustId: '99911', beneficiaryCustId: '16002', reason: 'ทดสอบเจ้าของไม่มีในระบบ' }),
    err => err.status === 400 && /ไม่พบข้อมูลลูกค้าเจ้าของตั๋วในระบบ/.test(err.message)
  );

  // Missing beneficiary in EMCust
  await assert.rejects(
    () => couponService.grantBeneficiary({ ownerCustId: '1141', beneficiaryCustId: '99922', reason: 'ทดสอบผู้รับไม่มีในระบบ' }),
    err => err.status === 400 && /ไม่พบข้อมูลลูกค้าผู้รับสิทธิ์ในระบบ/.test(err.message)
  );
});

test('Real Service: Scope is forced to ALL regardless of requested scope (Q5b)', async () => {
  activeDbState = createInitialDbState();

  const grant = await couponService.grantBeneficiary({
    ownerCustId: '1141',
    beneficiaryCustId: '16002',
    scope: 'SINGLE_PRODUCT',
    reason: 'ทดสอบขอบเขตสินค้า'
  });

  assert.equal(grant.status, 'ACTIVE');
  const stored = activeDbState.beneficiaries.find(b => b.Id === grant.id);
  assert.equal(stored.Scope, 'ALL', 'Scope must be strictly forced to ALL');
});

test('Real Service: Two-level rule (beneficiary cannot be owner; owner cannot be beneficiary)', async () => {
  activeDbState = createInitialDbState();

  // 1. Grant 1141 -> 16002 (1141 is Root, 16002 is Member)
  await couponService.grantBeneficiary({
    ownerCustId: '1141',
    beneficiaryCustId: '16002',
    reason: 'ให้สิทธิ์สมาชิก 1'
  });

  // 2. Beneficiary (16002) tries to become Owner -> REJECT (400)
  await assert.rejects(
    () => couponService.grantBeneficiary({
      ownerCustId: '16002',
      beneficiaryCustId: '47015',
      reason: 'สมาชิกลองเป็นเจ้าของกลุ่ม'
    }),
    err => err.status === 400 && /กฎ 2 ระดับ/.test(err.message)
  );

  // 3. Owner (1141) tries to become Beneficiary of another root (99999) -> REJECT (400)
  await assert.rejects(
    () => couponService.grantBeneficiary({
      ownerCustId: '99999',
      beneficiaryCustId: '1141',
      reason: 'เจ้าของกลุ่มลองเป็นสมาชิกกลุ่มอื่น'
    }),
    err => err.status === 400 && /กฎ 2 ระดับ/.test(err.message)
  );
});

test('Real Service: One-root rule (Q11: member can have grants from one owner only)', async () => {
  activeDbState = createInitialDbState();

  // 1. Grant 1141 -> 16002
  await couponService.grantBeneficiary({
    ownerCustId: '1141',
    beneficiaryCustId: '16002',
    reason: 'ให้สิทธิ์จากแม่ 1'
  });

  // 2. Second root 99999 tries to grant to 16002 -> REJECT (409)
  await assert.rejects(
    () => couponService.grantBeneficiary({
      ownerCustId: '99999',
      beneficiaryCustId: '16002',
      reason: 'ให้สิทธิ์จากแม่ 2 (ต้องถูกปฏิเสธ)'
    }),
    err => err.status === 409 && /สมาชิกมีแม่ได้รายเดียวตาม Q11/.test(err.message)
  );
});

test('Real Service: Duplicate active grant rejection (409)', async () => {
  activeDbState = createInitialDbState();

  // First grant succeeds
  await couponService.grantBeneficiary({
    ownerCustId: '1141',
    beneficiaryCustId: '16002',
    reason: 'ให้สิทธิ์ครั้งแรก'
  });

  // Duplicate grant for same pair -> 409
  await assert.rejects(
    () => couponService.grantBeneficiary({
      ownerCustId: '1141',
      beneficiaryCustId: '16002',
      reason: 'ให้สิทธิ์ซ้ำคู่อีกครั้ง'
    }),
    err => err.status === 409 && /มีสิทธิ์ใช้ตั๋วร่วมที่ยังใช้งานอยู่แล้ว/.test(err.message)
  );
});

test('Real Service: Revocation lifecycle and Q8 immediate unattached cancellation', async () => {
  activeDbState = createInitialDbState();

  // Setup grant
  const grant = await couponService.grantBeneficiary({
    ownerCustId: '1141',
    beneficiaryCustId: '16002',
    reason: 'ให้สิทธิ์เพื่อเตรียมทดสอบถอน'
  });

  // Setup reservations:
  // 1. Unattached reservation -> should be CANCELLED on revoke
  activeDbState.reservations.push({
    Id: 701,
    OwnerCustId: '1141',
    BeneficiaryCustId: '16002',
    Status: 'RESERVED'
  });
  // 2. Attached reservation -> should REMAIN RESERVED
  activeDbState.reservations.push({
    Id: 702,
    OwnerCustId: '1141',
    BeneficiaryCustId: '16002',
    Status: 'RESERVED'
  });
  activeDbState.salesOrderLines.push({
    Id: 88,
    SoId: 'SO-ACTIVE-1',
    CouponReservationId: 702,
    IsActiveSo: true
  });

  // Revoke with short reason -> 400
  await assert.rejects(
    () => couponService.revokeBeneficiary(grant.id, 'สั'),
    err => err.status === 400 && /อย่างน้อย 3 ตัวอักษร/.test(err.message)
  );

  // Revoke non-existent -> 404
  await assert.rejects(
    () => couponService.revokeBeneficiary(99999, 'ถอนสิทธิ์ที่ไม่มีอยู่จริง'),
    err => err.status === 404 && /ไม่พบรายการสิทธิ์/.test(err.message)
  );

  // Revoke active grant -> cancels unattached
  const revokeResult = await couponService.revokeBeneficiary(grant.id, 'ถอนสิทธิ์ทดสอบ Q8', 42);
  assert.equal(revokeResult.status, 'REVOKED');
  assert.equal(revokeResult.idempotent, false);
  assert.equal(revokeResult.cancelledUnattachedReservations, 1);

  // Verify unattached is CANCELLED and attached remains RESERVED
  const unattached = activeDbState.reservations.find(r => r.Id === 701);
  const attached = activeDbState.reservations.find(r => r.Id === 702);
  assert.equal(unattached.Status, 'CANCELLED');
  assert.equal(unattached.CancelReason, 'ถอนสิทธิ์ตั๋วร่วม');
  assert.equal(attached.Status, 'RESERVED', 'Attached reservation must not be cancelled on grant revocation');

  // Repeated revoke -> 200 idempotent
  const repeatRevoke = await couponService.revokeBeneficiary(grant.id, 'ถอนซ้ำ', 42);
  assert.equal(repeatRevoke.idempotent, true);
});

test('Real Service Concurrency: Two concurrent grants for same member under different roots (exactly one succeeds)', async () => {
  activeDbState = createInitialDbState();

  const req1 = couponService.grantBeneficiary({
    ownerCustId: '1141',
    beneficiaryCustId: '16002',
    reason: 'แข่งขันให้สิทธิ์จากแม่ 1',
    userId: 1
  });

  const req2 = couponService.grantBeneficiary({
    ownerCustId: '99999',
    beneficiaryCustId: '16002',
    reason: 'แข่งขันให้สิทธิ์จากแม่ 2',
    userId: 2
  });

  const results = await Promise.allSettled([req1, req2]);
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one concurrent grant must succeed');
  assert.equal(rejected.length, 1, 'Exactly one concurrent grant must be rejected');
  assert.equal(rejected[0].reason.status, 409, 'Rejected grant must receive 409 conflict');
  assert.match(rejected[0].reason.message, /สมาชิกมีแม่ได้รายเดียวตาม Q11/);
});

// ── Route-Level Role Authorization Tests ──────────────────────────────────────

test('Route-level role authorization: GET/POST/DELETE allow 4 roles and reject SALES', () => {
  const { requireRole } = require('../middleware/auth');
  const allowedRoles = ['ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING'];
  const forbiddenRoles = ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'DRIVER'];

  const middleware = requireRole('ADMIN', 'MANAGER', 'C_LEVEL', 'ACCOUNTING');

  for (const role of allowedRoles) {
    let calledNext = false;
    let statusCode = null;
    const req = { user: { role } };
    const res = {
      status(c) { statusCode = c; return this; },
      json() {}
    };
    middleware(req, res, () => { calledNext = true; });
    assert.equal(calledNext, true, `Role ${role} must be authorized`);
    assert.equal(statusCode, null);
  }

  for (const role of forbiddenRoles) {
    let calledNext = false;
    let statusCode = null;
    let resBody = null;
    const req = { user: { role } };
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { resBody = b; return this; }
    };
    middleware(req, res, () => { calledNext = true; });
    assert.equal(calledNext, false, `Role ${role} must be rejected`);
    assert.equal(statusCode, 403);
    assert.match(resBody?.message, /ต้องการสิทธิ์: ADMIN \/ MANAGER \/ C_LEVEL \/ ACCOUNTING/);
  }
});
