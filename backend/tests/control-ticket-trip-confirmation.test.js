'use strict';

/**
 * control-ticket-trip-confirmation.test.js
 *
 * Real-route and logic tests for R5-1 / F-06 / R6-2 / R6-3:
 * 1. PATCH /api/so/99901/confirm (synthetic draft with TripId) -> 409 BILL_IN_ACTIVE_TRIP
 * 2. POST /api/trips/99902/confirm without truck plate on normal trip -> 400
 * 3. POST /api/trips/99902/confirm with mixed trip -> 400 MIXED_CONTROL_TICKET_TRIP
 * 4. POST /api/trips/99902/confirm with control ticket trip -> 200 with cleanTruckPlate = 'ตั๋วคุม' and native booking with TruckPlate = null
 *
 * Safety & Hermetic Integrity:
 * - Uses stubbed in-memory DB and stubbed auth middleware.
 * - ZERO connections to live database.
 * - ZERO tokens signed with live secret against live DB.
 * - ZERO references to protected datasets (IDs are synthetic: 99901, 99902, 99903).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

// Mock state and query recorder
const executedQueries = [];
let queryHandler = () => ({ recordset: [] });

// Mock Request class
class MockRequest {
  constructor(txOrConn) {
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
const originalDb = require('../db');
const stubSql = {
  ...originalDb.sql,
  Request: MockRequest
};

const stubDb = {
  ...originalDb,
  sql: stubSql,
  query: async (text, inputs = {}) => {
    executedQueries.push({ text, inputs });
    return queryHandler(text, inputs);
  },
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

// Stub auth middleware in require.cache
const authPath = require.resolve('../middleware/auth');
const stubAuth = {
  ...require('../middleware/auth'),
  requireAuth: (req, res, next) => {
    req.user = { sub: 43, id: 43, role: 'ADMIN', username: 'stub_admin' };
    next();
  },
  requireRole: (...roles) => (req, res, next) => {
    req.user = req.user || { sub: 43, id: 43, role: 'ADMIN', username: 'stub_admin' };
    next();
  },
  requireRebateAmountAccess: (req, res, next) => {
    req.user = req.user || { sub: 43, id: 43, role: 'ADMIN', username: 'stub_admin' };
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

// Clear routers and services from cache to ensure they pick up stubbed db & auth
delete require.cache[require.resolve('../routes/trips')];
delete require.cache[require.resolve('../routes/so')];
delete require.cache[require.resolve('../services/draft-confirmation')];
delete require.cache[require.resolve('../services/price-authority')];

const tripsRouter = require('../routes/trips');
const soRouter = require('../routes/so');

const app = express();
app.use(express.json());
app.use('/api/trips', tripsRouter);
app.use('/api/so', soRouter);

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
  // Restore original db in cache
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: originalDb
  };
  await originalDb.closeAll();
});

test('1. Real route PATCH /api/so/99901/confirm: Bill in active trip returns 409 BILL_IN_ACTIVE_TRIP', async () => {
  executedQueries.length = 0;
  queryHandler = (text, inputs) => {
    if (text.includes('FROM wf.SalesOrderExt WHERE SOID=@id')) {
      return {
        recordset: [{
          SOID: '99901',
          TripId: 99902,
          ConfirmedAt: null,
          IsUnlocked: 0
        }]
      };
    }
    if (text.includes('FROM wf.SalesTrip WHERE TripId = @tripId')) {
      return {
        recordset: [{
          TripId: 99902,
          TripCode: 'TRIP-99902',
          Status: 'DRAFT'
        }]
      };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/so/99901/confirm`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remark: 'Test single confirm on trip bill' })
  });

  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.code, 'BILL_IN_ACTIVE_TRIP');
  assert.match(body.message, /บิลนี้อยู่ในเที่ยวขนส่ง/);
  assert.match(body.message, /ไม่อนุญาตให้ยืนยันรายบิล/);
});

test('2. Real route POST /api/trips/99902/confirm: Normal trip missing plate returns 400', async () => {
  executedQueries.length = 0;
  queryHandler = (text, inputs) => {
    if (text.includes('FROM wf.SalesOrder WHERE Id IN')) {
      return {
        recordset: [{
          Id: 99903,
          NoTruckRequired: 0,
          TruckPlate: null,
          SoPrefix: 'I'
        }]
      };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/trips/99902/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmedOrderIds: [99903],
      transRegistration: '', // Missing truck plate
      pickupDueDate: '2026-10-05'
    })
  });

  const body = await res.json();
  assert.equal(res.status, 400);
  assert.match(body.message, /การยืนยันเที่ยวรถจำเป็นต้องระบุทะเบียนรถ/);
});

test('3. Real route POST /api/trips/99902/confirm: Mixed trip returns 400 MIXED_CONTROL_TICKET_TRIP', async () => {
  executedQueries.length = 0;
  queryHandler = (text, inputs) => {
    if (text.includes('FROM wf.SalesOrder WHERE Id IN')) {
      return {
        recordset: [
          { Id: 99901, NoTruckRequired: 1, TruckPlate: 'ตั๋วคุม', SoPrefix: 'AI' }, // Control ticket
          { Id: 99903, NoTruckRequired: 0, TruckPlate: 'กพ 70-9203', SoPrefix: 'I' } // Normal bill
        ]
      };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/trips/99902/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmedOrderIds: [99901, 99903],
      transRegistration: 'กพ 70-9203',
      pickupDueDate: '2026-10-05'
    })
  });

  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.code, 'MIXED_CONTROL_TICKET_TRIP');
  assert.match(body.message, /เที่ยวนี้มีทั้งตั๋วคุมและบิล/);
});

test('4. Real route POST /api/trips/99902/confirm: Control ticket trip confirms cleanly with cleanTruckPlate = "ตั๋วคุม" and native TruckPlate = null', async () => {
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('FROM wf.SalesOrder WHERE Id IN')) {
      return {
        recordset: [{
          Id: 99901,
          NoTruckRequired: 1,
          TruckPlate: 'ตั๋วคุม',
          SoPrefix: 'AI'
        }]
      };
    }
    if (text.includes('sp_getapplock')) {
      return { recordset: [{ LockResult: 0 }] };
    }
    if (text.includes('FROM wf.SalesTrip WITH (UPDLOCK, ROWLOCK) WHERE TripId = @id')) {
      return {
        recordset: [{
          TripId: 99902,
          TripCode: 'TRIP-99902',
          Status: 'DRAFT',
          CreatedBy: 43,
          DocumentRevision: 1
        }]
      };
    }
    if (text.includes('v_TripMember')) {
      return {
        recordset: [{
          TripId: 99902,
          MemberKind: 'DRAFT',
          MemberId: 99901,
          DocuNo: 'AI69010001',
          SoPrefix: 'AI',
          CustId: '0342001',
          CustName: 'ลูกค้าทดสอบ',
          Status: 'DRAFT',
          SalesUserId: 43
        }]
      };
    }
    if (text.includes('SalesOrder') && text.includes('WHERE Id')) {
      return {
        recordset: [{
          Id: 99901,
          TripId: 99902,
          Status: 'DRAFT',
          DocumentRevision: 1,
          SalesUserId: 43,
          VerifiedAt: new Date(),
          TruckPlate: 'ตั๋วคุม',
          SoPrefix: 'AI',
          NoTruckRequired: 1,
          RequiresPriceApproval: 0,
          PriceApprovalStatus: null,
          CustId: '0342001',
          WfRef: 'AI69010001',
          PickupDueType: 'DEFAULT'
        }]
      };
    }
    if (text.includes('FROM wf.PriceApproval')) {
      return { recordset: [] };
    }
    if (text.includes('FROM wf.QuotationSourceSO')) {
      return { recordset: [] };
    }
    if (text.includes('FROM wf.SalesOrderLine')) {
      return {
        recordset: [{
          Id: 1,
          SoId: 99901,
          LineNum: 1,
          GoodId: 101,
          QtyTon: 2.0,
          PricePerTon: 0,
          NetPricePerTon: 0,
          IsGiveaway: 0
        }]
      };
    }
    if (text.includes('FROM wf.CreditMaster')) {
      return { recordset: [{ CreditHold: 0 }] };
    }
    if (text.includes('FROM dbo.SOHD WHERE DocuType=103')) {
      return { recordset: [] };
    }
    if (text.includes('FROM wf.SalesTrip WHERE ParentTripId = @pid AND IsResidual = 1')) {
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  const res = await fetch(`${baseUrl}/api/trips/99902/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmedOrderIds: [99901]
      // No transRegistration supplied, no pickupDueDate supplied (valid for control ticket trip)
    })
  });

  const body = await res.json();
  assert.equal(res.status, 200);
  assert.match(body.message, /ยืนยันเที่ยวรถสำเร็จ/);
  assert.equal(body.tripId, 99902);
  assert.equal(body.confirmedOrderCount, 1);

  // Assert SQL and params:
  // 1. UPDATE wf.SalesTrip received cleanTruckPlate = 'ตั๋วคุม'
  const tripUpdateQuery = executedQueries.find(q => q.text.includes('UPDATE wf.SalesTrip') && q.text.includes('Status = \'CONFIRMED\''));
  assert.ok(tripUpdateQuery, 'Must execute UPDATE wf.SalesTrip to CONFIRMED');
  assert.equal(tripUpdateQuery.inputs.plate?.value, 'ตั๋วคุม', 'SalesTrip.TransRegistration must be set to "ตั๋วคุม"');

  // 2. confirmDraft preserves 'ตั๋วคุม' and NoTruckRequired = 1 for native booking
  const draftPlateUpdate = executedQueries.find(q => q.text.includes('UPDATE wf.SalesOrder SET') && q.text.includes('TruckPlate = @plate'));
  assert.ok(draftPlateUpdate, 'Must execute UPDATE wf.SalesOrder SET NoTruckRequired = 1, TruckPlate = @plate');
  assert.equal(draftPlateUpdate.inputs.plate?.value, 'ตั๋วคุม', 'Draft TruckPlate must be "ตั๋วคุม"');

  // 3. Sp_ConfirmSalesOrder was executed
  const spCall = executedQueries.find(q => q.text.includes('EXEC wf.sp_ConfirmSalesOrder'));
  assert.ok(spCall, 'Must execute wf.sp_ConfirmSalesOrder');
  assert.equal(spCall.inputs.SoId?.value, 99901);

  // 4. R9-8: Redundant UPDATE dbo.SOHD must NOT run
  const sohdUpdate = executedQueries.find(q => q.text.includes('UPDATE dbo.SOHD SET TransRegistration'));
  assert.equal(sohdUpdate, undefined, 'Redundant UPDATE dbo.SOHD must not execute (R9-8)');
});

test('5. Real route POST /api/so with exact CreateSODialog payload: stores NoTruckRequired=1, truckPlate="ตั๋วคุม", and persists ticket purchase intent', async () => {
  executedQueries.length = 0;

  // Exact JSON structure CreateSODialog sends:
  const payload = {
    custId: '0342001',
    soPrefix: 'AI',
    truckPlate: 'ตั๋วคุม',
    isControlTicket: true,
    noTruckRequired: true,
    lines: [
      {
        goodId: 101,
        qtyTon: 2.0,
        pricePerTon: 15000,
        netPricePerTon: 14000
      }
    ]
  };

  queryHandler = (text, inputs) => {
    if (text.includes('FROM wf.CreditMaster')) {
      return { recordset: [{ CreditHold: 0 }] };
    }
    if (text.includes('FROM wf.AppSetting')) {
      return { recordset: [] };
    }
    if (text.includes('INSERT INTO wf.SalesOrder')) {
      return { recordset: [{ Id: 99905, WfRef: 'AI69-09905' }] };
    }
    if (text.includes('INSERT INTO wf.PriceApproval')) {
      return { recordset: [{ Id: 88801 }] };
    }
    if (text.includes('INSERT INTO wf.SalesOrderLine')) {
      return { recordset: [{ Id: 1 }] };
    }
    if (text.includes('FROM wf.SalesOrderExt WHERE SOID')) {
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  const createRes = await fetch(`${baseUrl}/api/so`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const createBody = await createRes.json();
  assert.equal(createRes.status, 200);
  assert.equal(createBody.id, 99905);

  // Verify INSERT SQL had NoTruckRequired = 1 and TruckPlate = 'ตั๋วคุม'
  const insertQuery = executedQueries.find(q => q.text.includes('INSERT INTO wf.SalesOrder'));
  assert.ok(insertQuery, 'Must execute INSERT INTO wf.SalesOrder');
  assert.equal(insertQuery.inputs.noTruckRequired?.value, 1, 'noTruckRequired input must be 1');
  assert.equal(insertQuery.inputs.truckPlate?.value, 'ตั๋วคุม', 'truckPlate input must be "ตั๋วคุม"');
});

test('6. R10-5: No-truck trip ignores client transRegistration="ตั๋วคุม" and keeps cleanTruckPlate=null', async () => {
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('FROM wf.SalesOrder WHERE Id IN')) {
      return {
        recordset: [{
          Id: 99908,
          NoTruckRequired: 1, // No truck required, but NOT control ticket!
          TruckPlate: null,
          SoPrefix: 'I'
        }]
      };
    }
    if (text.includes('sp_getapplock')) {
      return { recordset: [{ LockResult: 0 }] };
    }
    if (text.includes('FROM wf.SalesTrip WITH (UPDLOCK, ROWLOCK) WHERE TripId = @id')) {
      return {
        recordset: [{
          TripId: 99909,
          TripCode: 'TRIP-99909',
          Status: 'DRAFT',
          CreatedBy: 43,
          DocumentRevision: 1
        }]
      };
    }
    if (text.includes('v_TripMember')) {
      return {
        recordset: [{
          TripId: 99909,
          MemberKind: 'DRAFT',
          MemberId: 99908,
          DocuNo: 'I69010008',
          SoPrefix: 'I',
          CustId: '0342001',
          CustName: 'ลูกค้าทดสอบ',
          Status: 'DRAFT',
          SalesUserId: 43
        }]
      };
    }
    if (text.includes('SalesOrder') && text.includes('WHERE Id')) {
      return {
        recordset: [{
          Id: 99908,
          TripId: 99909,
          Status: 'DRAFT',
          DocumentRevision: 1,
          SalesUserId: 43,
          VerifiedAt: new Date(),
          TruckPlate: null,
          SoPrefix: 'I',
          NoTruckRequired: 1,
          RequiresPriceApproval: 0,
          PriceApprovalStatus: null,
          CustId: '0342001',
          WfRef: 'I69010008',
          PickupDueType: 'DEFAULT'
        }]
      };
    }
    if (text.includes('FROM wf.PriceApproval')) return { recordset: [] };
    if (text.includes('FROM wf.QuotationSourceSO')) return { recordset: [] };
    if (text.includes('FROM wf.SalesOrderLine')) {
      return {
        recordset: [{
          Id: 1,
          SoId: 99908,
          LineNum: 1,
          GoodId: 101,
          GoodCode: '18-4-5',
          GoodName: 'ปุ๋ย 18-4-5',
          QtyTon: 2.0,
          PricePerTon: 15000,
          NetPricePerTon: 0,
          IsGiveaway: 0,
          GiveawayApprovalStatus: null
        }]
      };
    }
    if (text.includes('FROM wf.CreditMaster')) return { recordset: [{ CreditHold: 0 }] };
    if (text.includes('FROM dbo.SOHD WHERE DocuType=103')) return { recordset: [] };
    if (text.includes('UPDATE wf.SalesOrder')) return { recordset: [] };
    if (text.includes('UPDATE wf.SalesOrderExt')) return { recordset: [] };
    if (text.includes('UPDATE wf.SalesTrip')) return { recordset: [] };
    if (text.includes('UPDATE wf.CouponReservation')) return { recordset: [] };
    if (text.includes('SELECT 1 FROM sys.columns')) return { recordset: [] };
    return { recordset: [] };
  };

  // Client inadvertently passes transRegistration: 'ตั๋วคุม' for a no-truck trip
  const res = await fetch(`${baseUrl}/api/trips/99909/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmedOrderIds: [99908],
      transRegistration: 'ตั๋วคุม',
      pickupDueDate: '2026-10-05'
    })
  });

  const body = await res.json();
  assert.equal(res.status, 200);

  // Assert SQL and params:
  // UPDATE wf.SalesTrip received cleanTruckPlate = null (NOT 'ตั๋วคุม'!)
  const tripUpdateQuery = executedQueries.find(q => q.text.includes('UPDATE wf.SalesTrip') && q.text.includes('Status = \'CONFIRMED\''));
  assert.ok(tripUpdateQuery);
  assert.equal(tripUpdateQuery.inputs.plate?.value, null, 'No-truck trip must set SalesTrip.TransRegistration to null');

  // confirmDraft received cleanPlate = null and updated SalesOrder TruckPlate = null
  const draftPlateUpdate = executedQueries.find(q => q.text.includes('UPDATE wf.SalesOrder SET') && q.text.includes('TruckPlate = @plate'));
  assert.ok(draftPlateUpdate);
  assert.equal(draftPlateUpdate.inputs.plate?.value, null, 'No-truck draft TruckPlate must remain null');
});

