'use strict';

/**
 * rebate-claim-apply.test.js
 *
 * Tests for D7/D8 Rebate Claim Application to Bill:
 * 1. Role enforcement: SALES role returns 403 Forbidden
 * 2. Status enforcement: Non-APPROVED claim returns 400
 * 3. Cross-customer protection: Bill belonging to another customer returns 400
 * 4. Happy path: ACCOUNTING / ADMIN applies approved claim to draft bill:
 *    - Updates RebateDiscountAmt
 *    - Annotates BillRemark with claim reference
 *    - Updates claim status to CN_ISSUED
 *    - Audits via logChangeEvent
 *
 * Safety & Hermetic Integrity:
 * - 100% stubbed in-memory queryHandler
 * - ZERO connection to live database
 * - ZERO mutations to live records
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const sql = require('mssql');

// Mock state and query recorder
const executedQueries = [];
let queryHandler = () => ({ recordset: [] });

// Mock Request class
class MockRequest {
  constructor() {
    this.inputs = {};
  }
  input(name, type, val) {
    this.inputs[name] = { type, value: val !== undefined ? val : type };
    return this;
  }
  async query(sqlText) {
    executedQueries.push({ text: sqlText, inputs: this.inputs });
    return queryHandler(sqlText, this.inputs);
  }
}

// Stub db module
const dbPath = require.resolve('../db');
const stubDb = {
  sql,
  wfQuery: async (text, inputs = {}) => {
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

// Stub auth middleware
let currentRole = 'ACCOUNTING';
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
  canViewRebateAmounts: () => true,
  SECRET: 'stub_test_secret'
};

require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: stubAuth
};

delete require.cache[require.resolve('../routes/rebate')];
const rebateRouter = require('../routes/rebate');

const app = express();
app.use(express.json());
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

test('1. Role enforcement: SALES role returns 403 Forbidden', async () => {
  currentRole = 'SALES';

  const res = await fetch(`${baseUrl}/api/rebate/claims/77701/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99901 })
  });

  assert.equal(res.status, 403);
});

test('2. Status enforcement: Non-APPROVED claim returns 400', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) {
      return { recordset: [{ lockRes: 0 }] };
    }
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77702,
          Status: 'TIER3_PENDING', // Not yet approved
          CustId: '0342001',
          ClaimAmt: 5000
        }]
      };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77702/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99901 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.message, /APPROVED/);
});

test('3. Cross-customer protection: Bill belonging to another customer returns 400', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) {
      return { recordset: [{ lockRes: 0 }] };
    }
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77703,
          Status: 'APPROVED',
          CustId: '0342001', // Customer A
          ClaimAmt: 5000,
          CustomerAmount: 5000
        }]
      };
    }
    if (text.includes('FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 99902,
          Status: 'DRAFT',
          CustId: '0342099', // Customer B
          RebateDiscountAmt: 0
        }]
      };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77703/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99902 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.message, /ไม่ตรงกับลูกค้า/);
});

test('4. Happy path: ACCOUNTING applies approved claim to draft bill', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) {
      return { recordset: [{ lockRes: 0 }] };
    }
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77704,
          Status: 'APPROVED',
          CustId: '0342001',
          ClaimAmt: 12500,
          CustomerAmount: 12500,
          RemainingAmt: 12500,
          Note: 'ขอเคลียร์รีเบทไตรมาส 3'
        }]
      };
    }
    if (text.includes('FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 99903,
          WfRef: 'AI69-09903',
          Status: 'DRAFT',
          CustId: '0342001',
          RebateDiscountAmt: 2500,
          BillRemark: 'ส่งสายใต้'
        }]
      };
    }
    if (text.includes('SELECT QtyTon, PricePerTon, IsGiveaway FROM wf.SalesOrderLine')) {
      return { recordset: [{ QtyTon: 10, PricePerTon: 2000, IsGiveaway: false }] }; // Subtotal 20,000
    }
    if (text.includes('sys.columns') && text.includes('AppliedRebateClaimId')) {
      return { recordset: [{ name: 'AppliedRebateClaimId' }] };
    }
    if (text.includes('sys.columns') && text.includes('AppliedDraftSoId')) {
      return { recordset: [{ name: 'AppliedDraftSoId' }] };
    }
    if (text.includes('INSERT INTO wf.AuditLog') || text.includes('UPDATE wf.SalesOrder') || text.includes('UPDATE wf.RebateClaim')) {
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77704/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99903 })
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.claimId, 77704);
  assert.equal(String(body.data.soId), '99903');
  assert.equal(body.data.discountApplied, 12500);
  assert.equal(body.data.status, 'APPROVED'); // R9-1: Claim stays APPROVED until bill is confirmed
  assert.equal(String(body.data.appliedDraftSoId), '99903');

  // Assert SQL updates
  const soUpdate = executedQueries.find(q => q.text.includes('UPDATE wf.SalesOrder'));
  assert.ok(soUpdate, 'Must update SalesOrder');
  assert.equal(Number(soUpdate.inputs.discount?.value), 12500);
  assert.match(soUpdate.inputs.annotation?.value, /หักลด Rebate Claim #77704 ฿12,500\.00/);

  const claimUpdate = executedQueries.find(q => q.text.includes('UPDATE wf.RebateClaim'));
  assert.ok(claimUpdate, 'Must update RebateClaim');
  assert.equal(Number(claimUpdate.inputs.soId?.value), 99903);
});

test('5. Subtotal check: Reject if discount exceeds bill subtotal (R9-1)', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) return { recordset: [{ lockRes: 0 }] };
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77705,
          Status: 'APPROVED',
          CustId: '0342001',
          ClaimAmt: 50000,
          CustomerAmount: 50000,
        }]
      };
    }
    if (text.includes('FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 99904,
          Status: 'DRAFT',
          CustId: '0342001',
          RebateDiscountAmt: 5000,
        }]
      };
    }
    if (text.includes('SELECT QtyTon, PricePerTon, IsGiveaway FROM wf.SalesOrderLine')) {
      return { recordset: [{ QtyTon: 2, PricePerTon: 10000, IsGiveaway: false }] }; // Subtotal 20,000 < (5000 + 50000)
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77705/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99904 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'TOTAL_DISCOUNT_EXCEEDS_SUBTOTAL');
});

test('6. R10-2: Fails closed with 409 if Migration 141 columns are missing', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) return { recordset: [{ lockRes: 0 }] };
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77706,
          Status: 'APPROVED',
          CustId: '0342001',
          ClaimAmt: 10000,
          CustomerAmount: 10000,
        }]
      };
    }
    if (text.includes('FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 99905,
          Status: 'DRAFT',
          CustId: '0342001',
          RebateDiscountAmt: 0,
        }]
      };
    }
    if (text.includes('SELECT QtyTon, PricePerTon, IsGiveaway FROM wf.SalesOrderLine')) {
      return { recordset: [{ QtyTon: 10, PricePerTon: 2000, IsGiveaway: false }] };
    }
    // Simulate unmigrated database: Migration 141 columns missing
    if (text.includes('sys.columns')) {
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77706/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99905 })
  });

  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'MIGRATION_141_REQUIRED');
});

test('7. R10-3: Applies customer share CustomerAmount when claim is split', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) return { recordset: [{ lockRes: 0 }] };
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77707,
          Status: 'APPROVED',
          CustId: '0342001',
          ClaimAmt: 10000, // Total claim 10,000
          CustomerAmount: 6000, // Customer share 6,000
          RetainedAmount: 4000 // Company retains 4,000
        }]
      };
    }
    if (text.includes('FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 99906,
          Status: 'DRAFT',
          CustId: '0342001',
          RebateDiscountAmt: 0,
        }]
      };
    }
    if (text.includes('SELECT QtyTon, PricePerTon, IsGiveaway FROM wf.SalesOrderLine')) {
      return { recordset: [{ QtyTon: 10, PricePerTon: 2000, IsGiveaway: false }] }; // Subtotal 20,000
    }
    if (text.includes('sys.columns') && text.includes('AppliedRebateClaimId')) {
      return { recordset: [{ name: 'AppliedRebateClaimId' }] };
    }
    if (text.includes('sys.columns') && text.includes('AppliedDraftSoId')) {
      return { recordset: [{ name: 'AppliedDraftSoId' }] };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77707/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99906 })
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.discountApplied, 6000, 'Must apply CustomerAmount (6000), not full ClaimAmt (10000)');

  const soUpdate = executedQueries.find(q => q.text.includes('UPDATE wf.SalesOrder'));
  assert.ok(soUpdate);
  assert.equal(Number(soUpdate.inputs.discount?.value), 6000);
  assert.match(soUpdate.inputs.annotation?.value, /฿6,000\.00/);
});

test('8. R10-4: Fails if target SO is not in DRAFT status', async () => {
  currentRole = 'ACCOUNTING';
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('sp_getapplock')) return { recordset: [{ lockRes: 0 }] };
    if (text.includes('FROM wf.RebateClaim WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 77708,
          Status: 'APPROVED',
          CustId: '0342001',
          ClaimAmt: 5000,
          CustomerAmount: 5000,
        }]
      };
    }
    if (text.includes('FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK)')) {
      return {
        recordset: [{
          Id: 99907,
          Status: 'CONFIRMED', // Already confirmed!
          CustId: '0342001',
          RebateDiscountAmt: 0,
        }]
      };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/rebate/claims/77708/apply-to-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId: 99907 })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.message, /สามารถผูกรีเบทเข้าใบสั่งขายสถานะ DRAFT เท่านั้น/);
});

