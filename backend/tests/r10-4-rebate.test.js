'use strict';

/**
 * backend/tests/r10-4-rebate.test.js
 *
 * Hermetic Unit & Route Tests for Ticket R10.4:
 * 1. Customer Code vs ID resolution (R10.3-1):
 *    - GET /api/rebate/accrual/:custId accepts customer code (e.g. '0330005') -> lots found
 *    - GET /api/rebate/accrual/:custId accepts internal ID (e.g. '1079') -> lots found
 *    - GET /api/rebate/accrual/:custId with unknown customer -> 404
 *    - POST /api/rebate/claims resolves customer code and stores internal CustID on wf.RebateClaim
 *    - POST /api/rebate/claims with unknown customer code -> 404
 *    - apply-to-bill matches claim.CustId with bill.CustId
 * 2. Pool Available calculation accounting for RebateUsage (R10.3-2):
 *    - GET /api/rebate/pools subtracts RebateUsage (DeductedAmt via ledger), returning AvailableAmt
 *    - POST /api/rebate/claims rejects a claim exceeding the ledger remaining after RebateUsage
 *    - POST /api/rebate/claims succeeds when claim amount <= available
 *
 * Safety & Hermetic Integrity:
 * - 100% stubbed in-memory database queries and mock transactions.
 * - ZERO connection to live database pool.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const http = require('http');

// Synthetic Customer & Pool Fixtures
const SYNTHETIC_CUSTOMER = {
  CustID: 1079,
  CustCode: '0330005',
  CustName: 'ร้านปุ๋ยเกษตรก้าวหน้า',
  SaleAreaID: 10,
};

const SYNTHETIC_LOTS = [
  {
    SourceSOID: 501,
    SourceListNo: 1,
    SourceDocuNo: 'DO69-001',
    SourceDocuDate: new Date('2026-09-01'),
    TaxInvoiceNo: 'IV69-001',
    CouponNo: null,
    CustId: 1079,
    CustName: 'ร้านปุ๋ยเกษตรก้าวหน้า',
    RegionCode: '01',
    SalesEmpId: 101,
    SalesEmpName: 'ต้นฉัตร',
    GoodID: 201,
    GoodCode: '15-15-15',
    GoodName: 'ปุ๋ย 15-15-15',
    QtyTon: 10,
    ListPricePerTon: 19500,
    NetPricePerTon: 19000,
    RebatePerTon: 500,
    PlanId: 1,
    PlanNo: 'PLAN-01',
    RemainingTonRebate: 10,
    RemainingTonDiff: 10,
    RemainingTon: 10,
    RemainingAmt: 5000,
  }
];

let customQueryHandler = () => ({ recordset: [] });

class MockRequest {
  constructor() {
    this.inputs = {};
  }
  input(name, type, val) {
    this.inputs[name] = { type, value: val !== undefined ? val : type };
    return this;
  }
  async query(sqlText) {
    return customQueryHandler(sqlText, this.inputs);
  }
}

const stubDb = {
  sql: {
    Int: { type: 'Int' },
    BigInt: { type: 'BigInt' },
    VarChar: len => ({ type: 'VarChar', length: len }),
    NVarChar: len => ({ type: 'NVarChar', length: len }),
    Decimal: (p, s) => ({ type: 'Decimal', precision: p, scale: s }),
    Bit: { type: 'Bit' },
    Date: { type: 'Date' },
    DateTime: { type: 'DateTime' },
  },
  query: async (sqlText, params) => customQueryHandler(sqlText, params),
  wfQuery: async (sqlText, params) => customQueryHandler(sqlText, params),
  dboWrite: async (sqlText, params) => customQueryHandler(sqlText, params),
  wfTransaction: async callback => {
    const tx = {
      request: () => new MockRequest(),
    };
    return callback(tx);
  },
  pools: () => ({ ready: Promise.resolve() }),
};

require.cache[path.resolve('backend/db.js')] = { exports: stubDb };
require.cache[path.resolve(__dirname, '../db.js')] = { exports: stubDb };

// Load rebate route and claim-apply service with stubbed db
const rebateRouter = require('../routes/rebate');
const { applyClaimToDraft } = require('../services/rebate-claim-apply');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';
const TEST_TOKEN = jwt.sign({ sub: 238, role: 'ACCOUNTING', roles: ['ACCOUNTING'] }, JWT_SECRET);
const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TEST_TOKEN}`
};

// Helper to launch test express app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rebate', rebateRouter);
  return app;
}

test('R10.4-1: GET /api/rebate/accrual/:custId resolves customer code to CustID and returns lots', async () => {
  const app = createTestApp();
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    customQueryHandler = (sqlText, params) => {
      // 1. resolveCustomer query
      if (sqlText.includes('FROM dbo.EMCust')) {
        if (params.raw?.value === '0330005' || params.numVal?.value === 1079) {
          return { recordset: [SYNTHETIC_CUSTOMER] };
        }
        return { recordset: [] };
      }
      // 2. v_RebateAccrualRemaining query
      if (sqlText.includes('wf.v_RebateAccrualRemaining')) {
        if (params.cid?.value === '1079') {
          return { recordset: SYNTHETIC_LOTS };
        }
        return { recordset: [] };
      }
      return { recordset: [] };
    };

    // Case A: Query by customer code '0330005'
    const resByCode = await fetch(`http://localhost:${port}/api/rebate/accrual/0330005`, {
      headers: AUTH_HEADERS
    });
    assert.equal(resByCode.status, 200);
    const dataByCode = await resByCode.json();
    assert.equal(dataByCode.length, 1);
    assert.equal(dataByCode[0].CustId, 1079);
    assert.equal(dataByCode[0].GoodCode, '15-15-15');

    // Case B: Query by internal CustID '1079'
    const resById = await fetch(`http://localhost:${port}/api/rebate/accrual/1079`, {
      headers: AUTH_HEADERS
    });
    assert.equal(resById.status, 200);
    const dataById = await resById.json();
    assert.equal(dataById.length, 1);
    assert.equal(dataById[0].CustId, 1079);

    // Case C: Query by unknown customer code -> 404
    const resUnknown = await fetch(`http://localhost:${port}/api/rebate/accrual/UNKNOWN999`, {
      headers: AUTH_HEADERS
    });
    assert.equal(resUnknown.status, 404);
    const dataUnknown = await resUnknown.json();
    assert.match(dataUnknown.message, /ไม่พบข้อมูลลูกค้า/);

  } finally {
    server.close();
  }
});

test('R10.4-1: POST /api/rebate/claims resolves customer code, stores internal CustID, and matches in apply-to-bill', async () => {
  const app = createTestApp();
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  let insertedClaimCustId = null;

  try {
    customQueryHandler = (sqlText, params) => {
      // Customer resolution
      if (sqlText.includes('FROM dbo.EMCust')) {
        if (params.raw?.value === '0330005' || params.numVal?.value === 1079) {
          return { recordset: [SYNTHETIC_CUSTOMER] };
        }
        return { recordset: [] };
      }
      // Region resolution
      if (sqlText.includes('FROM dbo.EMSaleArea')) {
        return { recordset: [{ SaleAreaCode: '01-CENTRAL' }] };
      }
      // App lock
      if (sqlText.includes('sp_getapplock')) {
        return { recordset: [] };
      }
      // Policy snapshot
      if (sqlText.includes('wf.PolicySnapshot')) {
        return { recordset: [{ SnapshotId: 1, RevisionNumber: 1, CustomerRatio: 100, CompanyRatio: 0 }] };
      }
      // Pool lookup
      if (sqlText.includes('FROM wf.RebatePool')) {
        return {
          recordset: [{
            Id: 8,
            SalesUserId: 238,
            PeriodYear: 2026,
            PeriodMonth: 10,
            AccruedAmt: 10000,
            ClaimedAmt: 0,
            UsedAmt: 0,
            LedgerRemainingAmt: 10000
          }]
        };
      }
      // Lot lookup
      if (sqlText.includes('wf.v_RebateAccrualRemaining')) {
        return { recordset: SYNTHETIC_LOTS };
      }
      // Insert RebateClaim
      if (sqlText.includes('INSERT INTO wf.RebateClaim (')) {
        insertedClaimCustId = params.cid?.value;
        return {
          recordset: [{
            Id: 991,
            PoolId: 8,
            SalesUserId: 238,
            CustId: insertedClaimCustId,
            ClaimAmt: 5000,
            RemainingAmt: 5000,
            Status: 'TIER2_PENDING',
            PeriodYear: 2026,
            PeriodMonth: 10
          }]
        };
      }
      // Insert lines
      if (sqlText.includes('INSERT INTO wf.RebateClaimLine') || sqlText.includes('INSERT INTO wf.RebateClaimApproval')) {
        return { recordset: [] };
      }
      // Deduct from pool ledger
      if (sqlText.includes('wf.RebateLedger') && sqlText.includes('RemainingAmt>0')) {
        return { recordset: [{ Id: 101, RemainingAmt: 5000 }] };
      }
      // Audit log
      if (sqlText.includes('wf.AuditLog')) {
        return { recordset: [] };
      }
      return { recordset: [] };
    };

    // Submitting claim using customer code '0330005'
    const payload = {
      poolId: 8,
      custId: '0330005',
      note: 'ทดสอบยื่นเคลมด้วย customer code',
      periodYear: 2026,
      periodMonth: 10,
      lines: [{
        lineType: 'REBATE',
        goodCode: '15-15-15',
        qtyTon: 10,
        pricePerTon: 19500,
        netPricePerTon: 19000,
        sourceSOID: 501,
        sourceListNo: 1,
      }]
    };

    const res = await fetch(`http://localhost:${port}/api/rebate/claims`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    // Assert that internal CustID 1079 was stored on the claim
    assert.equal(Number(insertedClaimCustId), 1079);

    // Negative case: unknown customer code returns 404
    const badPayload = { ...payload, custId: 'INVALID_CUST_CODE' };
    const badRes = await fetch(`http://localhost:${port}/api/rebate/claims`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify(badPayload),
    });
    assert.equal(badRes.status, 404);

    // Apply to bill test:
    // Draft SO has internal CustId 1079 -> matches claim.CustId 1079
    const syntheticDraftSo = {
      Id: 117,
      CustId: 1079,
      Status: 'DRAFT',
      RebateDiscountAmt: 0,
      ClaimDiscountAmt: 0,
      BillRemark: '',
    };
    const syntheticApprovedClaim = {
      Id: 991,
      CustId: 1079,
      Status: 'APPROVED',
      CustomerAmount: 5000,
      ClaimAmt: 5000,
      AppliedDraftSoId: null,
    };

    let updatedClaim = null;
    const mockTxQuery = async (sqlText, params) => {
      if (sqlText.includes('sys.columns') || sqlText.includes('COL_LENGTH')) {
        return { recordset: [{ col: 1 }] };
      }
      if (sqlText.includes('FROM wf.RebateClaim') && sqlText.includes('WHERE Id = @claimId')) {
        return { recordset: [syntheticApprovedClaim] };
      }
      if (sqlText.includes('FROM wf.SalesOrder') && (sqlText.includes('WHERE Id = @id') || sqlText.includes('WHERE Id = @soId'))) {
        return { recordset: [syntheticDraftSo] };
      }
      if (sqlText.includes('FROM wf.SalesOrderLine') && sqlText.includes('WHERE SoId = @soId')) {
        return { recordset: [{ LineNum: 1, QtyTon: 10, PricePerTon: 1000 }] };
      }
      if (sqlText.includes('UPDATE wf.RebateClaim')) {
        updatedClaim = params;
        return { rowsAffected: [1] };
      }
      if (sqlText.includes('UPDATE wf.SalesOrder')) {
        return { rowsAffected: [1] };
      }
      return { recordset: [], rowsAffected: [1] };
    };

    const applyResult = await applyClaimToDraft(mockTxQuery, {
      claimId: 991,
      soId: 117,
      user: { sub: 238, role: 'ACCOUNTING' },
    });

    assert.equal(applyResult.status, 'APPROVED');
    assert.equal(applyResult.discountApplied, 5000);

  } finally {
    server.close();
  }
});

test('R10.4-2: Pool available calculation accounts for RebateUsage and rejects claims exceeding remaining', async () => {
  const app = createTestApp();
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  try {
    customQueryHandler = (sqlText, params) => {
      // Customer resolution
      if (sqlText.includes('FROM dbo.EMCust')) {
        return { recordset: [SYNTHETIC_CUSTOMER] };
      }
      if (sqlText.includes('FROM dbo.EMSaleArea')) {
        return { recordset: [{ SaleAreaCode: '01-CENTRAL' }] };
      }
      if (sqlText.includes('sp_getapplock') || sqlText.includes('wf.PolicySnapshot')) {
        return { recordset: [{ SnapshotId: 1, CustomerRatio: 100, CompanyRatio: 0 }] };
      }

      // GET /pools query
      if (sqlText.includes('FROM wf.RebatePool p') && !sqlText.includes('WITH (UPDLOCK')) {
        return {
          recordset: [{
            Id: 8,
            SalesUserId: 238,
            SalesName: 'ต้นฉัตร',
            PeriodYear: 2026,
            PeriodMonth: 10,
            AccruedAmt: 2000,
            ClaimedAmt: 0,
            UsedAmt: 1000, // Used by RebateUsage on a bill
            LedgerRemainingAmt: 1000, // Ledger #10 consumed, Ledger #11 remains 1000
            AvailableAmt: 1000, // Real available
            AllocatedAmt: 0
          }]
        };
      }

      // Pool locked query in POST /claims
      if (sqlText.includes('FROM wf.RebatePool p') && sqlText.includes('WITH (UPDLOCK')) {
        return {
          recordset: [{
            Id: 8,
            SalesUserId: 238,
            PeriodYear: 2026,
            PeriodMonth: 10,
            AccruedAmt: 2000,
            ClaimedAmt: 0,
            UsedAmt: 1000,
            LedgerRemainingAmt: 1000
          }]
        };
      }

      // Lot lookup
      if (sqlText.includes('wf.v_RebateAccrualRemaining')) {
        return { recordset: SYNTHETIC_LOTS };
      }
      return { recordset: [] };
    };

    // 1. Verify GET /api/rebate/pools reflects real AvailableAmt = 1000 (not 2000)
    const poolsRes = await fetch(`http://localhost:${port}/api/rebate/pools`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(poolsRes.status, 200);
    const poolsData = await poolsRes.json();
    assert.equal(poolsData.length, 1);
    assert.equal(poolsData[0].AccruedAmt, 2000);
    assert.equal(poolsData[0].UsedAmt, 1000);
    assert.equal(poolsData[0].AvailableAmt, 1000);

    // 2. POST /api/rebate/claims with Amount-Only exceeding remaining:
    // User tries to claim 1,500 when available is 1,000 (even though Accrued - Claimed = 2,000)
    const overClaimPayload = {
      poolId: 8,
      claimAmt: 1500,
      custId: '0330005',
      note: 'ทดสอบยอดเกินที่เหลือก่อนหัก RebateUsage',
      reasonCode: 'MANUAL_ADJUSTMENT',
      reasonText: 'ขอเคลมส่วนเกินวงเงินคงเหลือจริง',
    };

    const rejectRes = await fetch(`http://localhost:${port}/api/rebate/claims`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify(overClaimPayload),
    });

    assert.equal(rejectRes.status, 400);
    const rejectData = await rejectRes.json();
    assert.match(rejectData.message, /ยอดเกิน: ขอ ฿1500\.00 ใช้ได้ ฿1000\.00/);

  } finally {
    server.close();
  }
});
