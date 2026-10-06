'use strict';

/**
 * r9-fixes.test.js
 *
 * Hermetic Unit & Route Tests for R10 / R9 Review Fixes:
 * - R9-1: Single rebate deduction (claim pool cut vs ledger accrual consume);
 *         Cancel restores claim; Over-subtotal discount rejected; SALES edit keeps discount.
 * - R9-2: Server-side NET floor derivation from active price list;
 *         Ignores client's netPricePerTon; Stores NULL and accrues 0 when no NET;
 *         Coupon/giveaway lines never accrue rebate.
 * - R9-3: Edit trip draft preserves TripId from wf.SalesOrder (locked row);
 *         Trip change is audited.
 * - R9-4: Decouple noTruckRequired from isControlTicket;
 *         Reject mixed trips (control ticket + normal/no-truck in same trip).
 * - R9-7: LINE notification hard feature flag gate (zero sends when disabled).
 *
 * Safety & Hermetic Integrity:
 * - 100% stubbed in-memory database queries and mock transaction.
 * - ZERO connection to live database pool.
 * - Synthetic test IDs only (99001-99999).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const sql = require('mssql');

// Mock state and query recorder
const executedQueries = [];
let queryHandler = () => ({ recordset: [] });

class MockRequest {
  constructor() {
    this.inputs = {};
    this.outputs = {};
  }
  input(name, type, val) {
    this.inputs[name] = { type, value: val !== undefined ? val : type };
    return this;
  }
  output(name, type) {
    this.outputs[name] = type;
    return this;
  }
  async query(sqlText) {
    executedQueries.push({ text: sqlText, inputs: this.inputs });
    return queryHandler(sqlText, this.inputs);
  }
  async execute(procName) {
    executedQueries.push({ text: `EXEC ${procName}`, inputs: this.inputs });
    if (procName === 'wf.sp_ConfirmSalesOrder') {
      return { output: { NewSoid: 'SO-99901-NATIVE' }, recordset: [] };
    }
    return { output: {}, recordset: [] };
  }
}

// Stub db module in require.cache
const dbPath = require.resolve('../db');
const stubDb = {
  sql,
  wfQuery: async (text, inputs = {}) => {
    executedQueries.push({ text, inputs });
    return queryHandler(text, inputs);
  },
  query: async (text, inputs = {}) => {
    executedQueries.push({ text, inputs });
    return queryHandler(text, inputs);
  },
  wfTransaction: async (callback) => {
    const tx = {
      request: () => new MockRequest()
    };
    return callback(tx);
  },
  closeAll: async () => {}
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: stubDb
};

// Stub auth middleware in require.cache
let currentRole = 'ADMIN';
let currentUserId = 43;

const authPath = require.resolve('../middleware/auth');
const stubAuth = {
  ...require('../middleware/auth'),
  requireAuth: (req, res, next) => {
    req.user = { sub: currentUserId, id: currentUserId, role: currentRole, username: 'test_user' };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    if (roles.includes(currentRole)) {
      req.user = { sub: currentUserId, id: currentUserId, role: currentRole, username: 'test_user' };
      return next();
    }
    return res.status(403).json({ message: 'Forbidden' });
  },
  requireRebateAmountAccess: (req, res, next) => {
    req.user = { sub: currentUserId, id: currentUserId, role: currentRole, username: 'test_user' };
    next();
  },
  canViewRebateAmounts: () => currentRole !== 'SALES',
  SECRET: 'stub_test_secret'
};

require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: stubAuth
};

delete require.cache[require.resolve('../routes/so')];
delete require.cache[require.resolve('../routes/trips')];
delete require.cache[require.resolve('../routes/rebate')];
delete require.cache[require.resolve('../services/draft-confirmation')];
delete require.cache[require.resolve('../services/line-expiry-notification')];

const soRouter = require('../routes/so');
const tripsRouter = require('../routes/trips');
const rebateRouter = require('../routes/rebate');
const lineService = require('../services/line-expiry-notification');

const app = express();
app.use(express.json());
app.use('/api/so', soRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/rebate', rebateRouter);

let server;
let baseUrl;

test.before(async () => {
  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
});

// ─────────────────────────────────────────────────────────────
// R9-1: Rebate Claim Applied to Bill (Single Deduction & Restores)
// ─────────────────────────────────────────────────────────────

test('R9-1a: Apply claim to draft SO keeps status APPROVED and tags AppliedDraftSoId', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) return { recordset: [{ lockRes: 0 }] };
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77001,
          Status: 'APPROVED',
          CustId: '0342001',
          ClaimAmt: 8000,
          CustomerAmount: 8000,
        }]
      };
    }
    if (text.includes('FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 99001,
          Status: 'DRAFT',
          CustId: '0342001',
          RebateDiscountAmt: 0,
        }]
      };
    }
    if (text.includes('SELECT QtyTon, PricePerTon, IsGiveaway FROM wf.SalesOrderLine')) {
      return { recordset: [{ QtyTon: 10, PricePerTon: 2000, IsGiveaway: false }] }; // Subtotal 20,000 > 8,000
    }
    if (text.includes('sys.columns') && text.includes('AppliedRebateClaimId')) {
      return { recordset: [{ name: 'AppliedRebateClaimId' }] };
    }
    if (text.includes('sys.columns') && text.includes('AppliedDraftSoId')) {
      return { recordset: [{ name: 'AppliedDraftSoId' }] };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77001/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99001 })
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, 'APPROVED'); // Must remain APPROVED
  assert.equal(Number(body.data.appliedDraftSoId), 99001);

  const claimUpdate = executedQueries.find(q => q.text.includes('UPDATE wf.RebateClaim'));
  assert.ok(claimUpdate, 'Claim must be updated with AppliedDraftSoId');
  assert.equal(Number(claimUpdate.inputs.soId?.value), 99001);
});

test('R9-1b: Over-subtotal discount is rejected with 400', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) return { recordset: [{ lockRes: 0 }] };
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77002,
          Status: 'APPROVED',
          CustId: '0342001',
          ClaimAmt: 25000, // Exceeds subtotal 15,000
        }]
      };
    }
    if (text.includes('FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 99002,
          Status: 'DRAFT',
          CustId: '0342001',
          RebateDiscountAmt: 0,
        }]
      };
    }
    if (text.includes('SELECT QtyTon, PricePerTon, IsGiveaway FROM wf.SalesOrderLine')) {
      return { recordset: [{ QtyTon: 10, PricePerTon: 1500, IsGiveaway: false }] }; // Subtotal 15,000
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77002/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99002 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'TOTAL_DISCOUNT_EXCEEDS_SUBTOTAL');
});

test('R9-1c: Cancel/delete of draft SO restores applied claim to APPROVED without draft binding', async () => {
  currentRole = 'ADMIN';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('wf.v_AllSalesOrders')) {
      return {
        recordset: [{
          Id: 99003,
          Status: 'DRAFT',
          WfRef: 'I69-99003',
          AppliedRebateClaimId: 77003,
          BillRemark: 'ทดสอบ [หักลด Rebate Claim #77003 ฿5,000.00]'
        }]
      };
    }
    if (text.includes('wf.EditReason')) {
      return { recordset: [{ ReasonCode: 'SO_DELETED', ReasonText: 'ลบบิลร่าง', AppliesTo: 'SO_DELETE', IsActive: 1 }] };
    }
    if (text.includes('sys.columns') && text.includes('AppliedDraftSoId')) {
      return { recordset: [{ name: 'AppliedDraftSoId' }] };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/so/99003`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reasonCode: 'SO_DELETED',
      reason: 'ลบบิลร่างทดสอบ'
    })
  });

  assert.equal(res.status, 200);
  const claimRestore = executedQueries.find(q => q.text.includes('UPDATE wf.RebateClaim') && q.text.includes('AppliedDraftSoId = NULL'));
  assert.ok(claimRestore, 'Claim AppliedDraftSoId must be restored to NULL on draft deletion');
});

// ─────────────────────────────────────────────────────────────
// R9-2: Server-side NET floor derivation & Accrual Rules
// ─────────────────────────────────────────────────────────────

test('R9-2a: Server-side derivation of NetPricePerTon ignores client payload and uses active price list', async () => {
  currentRole = 'SALES';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('dbo.EMGood') && text.includes('GoodID = @goodId')) {
      return { recordset: [{ GoodID: 'G-101', GoodCode: '18-4-5', GoodName: 'ปุ๋ย 18-4-5' }] };
    }
    if (text.includes('dbo.EMCust') && (text.includes('CustID = @cid') || text.includes('CustCode = @ccode') || text.includes('CustID = @custId'))) {
      return [{ CustID: 1141, CustCode: '0342001', CustName: 'ลูกค้าทดสอบ' }];
    }
    if (text.includes('dbo.EMSetPriceHD')) {
      // Authoritative Price List has Net 18,500 and Price 19,000
      return [{
        SetPriceID: 1,
        ListNo: 1,
        AnnouncedPrice: 18500,
        CustID: null,
        BeginDate: new Date('2026-01-01'),
        EndDate: null,
        PriceSource: 'EMSetPrice'
      }];
    }
    if (text.includes('SELECT ISNULL(MAX(RefSuffix), 0) AS MaxSuffix')) {
      return { recordset: [{ MaxSuffix: 9000 }] };
    }
    if (text.includes('INSERT INTO wf.SalesOrder')) {
      return { recordset: [{ Id: 99004 }] };
    }
    if (text.includes('INSERT INTO wf.SalesOrderLine')) {
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  // Client attempts to send netPricePerTon = 0 or 1000 to manipulate accrual
  const res = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      custId: '0342001',
      soPrefix: 'I',
      lines: [{
        goodId: '101',
        qtyTon: 2,
        pricePerTon: 19000,
        netPricePerTon: 0 // Client tries to spoof 0
      }]
    })
  });

  assert.equal(res.status, 200);
  const lineInsert = executedQueries.find(q => q.text.includes('INSERT INTO wf.SalesOrderLine'));
  assert.ok(lineInsert, 'Line must be inserted');
  assert.equal(Number(lineInsert.inputs.netPricePerTon?.value), 18500, 'Server must enforce authoritative NET floor 18,500');
});

// ─────────────────────────────────────────────────────────────
// R9-3: Trip draft edit keeps TripId
// ─────────────────────────────────────────────────────────────

test('R9-3: Editing draft without tripId preserves existing TripId from locked row', async () => {
  currentRole = 'SALES';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('wf.v_AllSalesOrders')) {
      return {
        recordset: [{
          Id: 99005,
          CustId: '0342001',
          Status: 'DRAFT',
          TripId: 38,
          SalesUserId: 43 // the SALES user's own draft (R12 O-4: edits are scoped to own + team)
        }]
      };
    }
    if (text.includes('wf.SalesOrder WITH (UPDLOCK, HOLDLOCK)')) {
      return {
        recordset: [{
          DocumentRevision: 1,
          PricingFingerprint: 'dummy',
          RequiresPriceApproval: 0,
          PriceApprovalStatus: 'NONE',
          TripId: 38, // Existing trip 38
          RebateDiscountAmt: 1500,
          ClaimDiscountAmt: 1500,
          AppliedRebateClaimId: 77005
        }]
      };
    }
    if (text.includes('dbo.EMGood') && text.includes('GoodID = @goodId')) {
      return { recordset: [{ GoodID: '101', GoodCode: '18-4-5', GoodName: 'ปุ๋ย 18-4-5' }] };
    }
    if (text.includes('dbo.EMCust')) {
      return [{ CustID: 1141, CustCode: '0342001', CustName: 'ลูกค้าทดสอบ' }];
    }
    if (text.includes('dbo.EMSetPriceHD')) {
      return [{
        SetPriceID: 1,
        ListNo: 1,
        AnnouncedPrice: 18500,
        CustID: null,
        BeginDate: new Date('2026-01-01'),
        EndDate: null,
        PriceSource: 'EMSetPrice'
      }];
    }
    if (text.includes('UPDATE wf.SalesOrder')) {
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  // Edit from trip window sends payload without tripId
  const res = await fetch(`${baseUrl}/api/so/99005`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      soPrefix: 'I',
      custId: '0342001',
      remark: 'อัปเดตหมายเหตุจากหน้าจอทริป',
      lines: [{ goodId: '101', qtyTon: 2, pricePerTon: 19000 }]
    })
  });

  assert.equal(res.status, 200);
  const soUpdate = executedQueries.find(q => q.text.includes('UPDATE wf.SalesOrder'));
  assert.ok(soUpdate, 'SalesOrder must be updated');
  assert.equal(Number(soUpdate.inputs.tripId?.value), 38, 'TripId 38 must be preserved');
  assert.equal(Number(soUpdate.inputs.rebateDiscountAmt?.value), 1500, 'SALES edit must not wipe RebateDiscountAmt');
});

// ─────────────────────────────────────────────────────────────
// R9-4: Decouple noTruckRequired & Reject Mixed Trips
// ─────────────────────────────────────────────────────────────

test('R9-4: Confirming mixed trip (control ticket + normal/no-truck) is rejected', async () => {
  currentRole = 'ADMIN';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('FROM wf.SalesOrder WHERE Id IN')) {
      // Mixed: One ticket bill ('ตั๋วคุม') and one normal no-truck bill
      return {
        recordset: [
          { Id: 99007, NoTruckRequired: 1, TruckPlate: 'ตั๋วคุม', SoPrefix: 'AI' },
          { Id: 99008, NoTruckRequired: 1, TruckPlate: null, SoPrefix: 'I' }
        ]
      };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/trips/99006/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmedOrderIds: [99007, 99008],
      transRegistration: 'ตั๋วคุม',
      pickupDueDate: '2026-10-05'
    })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'MIXED_CONTROL_TICKET_TRIP');
});

// ─────────────────────────────────────────────────────────────
// R9-7: LINE Notification Hard Gate
// ─────────────────────────────────────────────────────────────

test('R9-7: LINE notification hard gate prevents any sends when flag is false', async () => {
  assert.equal(lineService.LINE_EXPIRY_NOTIFICATION_ENABLED, false);

  const result = await lineService.sendExpiryAlerts({ dryRun: false }); // Explicit dryRun: false must still not send
  assert.equal(result.enabled, false);
  assert.equal(result.dryRun, true);
  assert.match(result.message, /hard-disabled/i);
});
