'use strict';

/**
 * coupon-settlement-auto.test.js
 *
 * Tests for PB-3 Automatic Settlement Engine, Concurrency Lock & Negative Balance Clamping:
 * 1. Concurrent settles on same coupon ID return early via _settlementLocks guard
 * 2. Overcut / negative balance clamps availableQty and adjustedAvailableQty at 0
 * 3. Overcut sets overcutNotice = 'รอตรวจการตัดตั๋ว'
 * 4. reconcileCoupon with { settle: false } executes read-only without calling settlement writes
 *
 * Safety & Hermetic Integrity:
 * - 100% stubbed in-memory queryHandler
 * - ZERO connection to live database (db.js is never loaded)
 * - ZERO mutations to live records
 */

const test = require('node:test');
const assert = require('node:assert/strict');
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

// Stub db module in require.cache BEFORE anything requires it
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

delete require.cache[require.resolve('../services/coupon-service')];
const couponService = require('../services/coupon-service');

test('1. PB-3 Concurrency Lock: Concurrent settle calls on same coupon ID return early', async () => {
  executedQueries.length = 0;

  let slowQueryResolve;
  const slowPromise = new Promise(resolve => {
    slowQueryResolve = resolve;
  });

  const customWfQuery = async (text, inputs) => {
    if (text.includes('COL_LENGTH')) {
      return { recordset: [{ hasConsumedQty: 8, hasTable: 12345 }] };
    }
    if (text.includes('FROM wf.CouponReservation cr')) {
      // Simulate delay in DB query to hold lock
      await slowPromise;
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  const customCheck139 = async () => true;

  // Start call 1 (will pause inside slowPromise)
  const call1Promise = couponService.settleCouponReservations(88801, null, {
    wfQuery: customWfQuery,
    checkMigration139: customCheck139
  });

  // Call 2 starts immediately while call 1 is running
  const call2Result = await couponService.settleCouponReservations(88801, null, {
    wfQuery: customWfQuery,
    checkMigration139: customCheck139
  });

  assert.equal(call2Result.settledCount, 0);
  assert.equal(call2Result.note, 'Settlement already in progress for coupon');

  // Let call 1 complete
  slowQueryResolve();
  const call1Result = await call1Promise;
  assert.equal(call1Result.settledCount, 0);
  assert.equal(call1Result.note, undefined);
});

test('2. PB-3 Negative Balance Clamping & Overcut Notice: Available qty clamped at 0 with notice', async () => {
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('COL_LENGTH')) {
      return { recordset: [{ hasConsumedQty: 8, hasTable: 12345 }] };
    }
    if (text.includes('FROM dbo.WFCoupon')) {
      return {
        recordset: [{
          CouponID: 88802,
          CouponNo: 'C-TEST-002',
          NativeRemaQty: 0.0 // 0 tons remaining in WinSpeed
        }]
      };
    }
    if (text.includes('FROM wf.CouponReservation')) {
      return {
        recordset: [{
          Id: 1,
          CouponId: 88802,
          CarrierSoId: '99901',
          CarrierDocuNo: 'AI69-09901',
          TripId: null,
          ReservedQty: 2.0, // 2 tons reserved in App
          ConsumedQty: 0.0,
          RemainingReservedQty: 2.0,
          CreatedAt: new Date(),
          TripPlate: null,
          ConfirmDate: new Date()
        }]
      };
    }
    if (text.includes('FROM dbo.WFRedemtionDT')) {
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  const summary = await couponService.reconcileCoupon(88802, { settle: false });

  assert.ok(summary);
  assert.equal(summary.couponId, 88802);
  assert.equal(summary.nativeRemaQty, 0.0);
  assert.equal(summary.activeReservedQty, 2.0);
  // Clamped at 0 (NOT -2)
  assert.equal(summary.availableQty, 0);
  assert.equal(summary.adjustedAvailableQty, 0);
  // Shortfall & overcut notice
  assert.equal(summary.hasShortfall, true);
  assert.equal(summary.shortfallQty, 2.0);
  assert.equal(summary.overcutNotice, 'รอตรวจการตัดตั๋ว');
});

test('3. §0 Read-Only Safe Execution: { settle: false } bypasses settlement writes', async () => {
  executedQueries.length = 0;

  queryHandler = (text, inputs) => {
    if (text.includes('COL_LENGTH')) {
      return { recordset: [{ hasConsumedQty: 8, hasTable: 12345 }] };
    }
    if (text.includes('FROM dbo.WFCoupon')) {
      return {
        recordset: [{
          CouponID: 88803,
          CouponNo: 'C-TEST-003',
          NativeRemaQty: 10.0
        }]
      };
    }
    if (text.includes('FROM wf.CouponReservation')) {
      return { recordset: [] };
    }
    if (text.includes('FROM dbo.WFRedemtionDT')) {
      return { recordset: [] };
    }
    return { recordset: [] };
  };

  const summary = await couponService.reconcileCoupon(88803, { settle: false });

  assert.ok(summary);
  assert.equal(summary.availableQty, 10.0);
  assert.equal(summary.overcutNotice, null);

  // Assert NO settlement writes occurred
  const settleWrites = executedQueries.filter(q => 
    q.text.includes('INSERT INTO wf.CouponReservationSettlement') ||
    q.text.includes('UPDATE wf.CouponReservation SET ConsumedQty')
  );
  assert.equal(settleWrites.length, 0, 'Must NOT execute any settlement writes when settle: false');
});
