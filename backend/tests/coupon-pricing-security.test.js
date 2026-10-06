'use strict';

/**
 * coupon-pricing-security.test.js
 *
 * Negative tests and security validation for coupon price approval bypass (R6 §1.2 / R5-2 / D1 / R7):
 * 1. Forged line with _couponReservationValidated: true without reservation -> stripped at boundary and requires approval.
 * 2. Real validateAndLockCouponReservations:
 *    - Customer mismatch throws 400.
 *    - Product mismatch throws 400.
 *    - Quantity mismatch throws 400.
 *    - Duplicate reservation ID throws 400.
 *    - Valid reservation returns validated line index set and forces price to ฿0.
 * 3. Validated reservation line skips price approval cleanly.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// Hermetic offline stub for db
const dbPath = require.resolve('../db');
const originalDb = require('../db');
const stubDb = {
  ...originalDb,
  query: async (text) => {
    if (text.includes('EMCust')) return [{ CustID: 1, CustCode: '0342001', CustName: 'Test' }];
    if (text.includes('EMSetPrice')) return [{ SetPriceID: 1, AnnouncedPrice: 15000, PriceSource: 'EMSetPrice' }];
    return [];
  },
  wfQuery: async () => []
};
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: stubDb
};
delete require.cache[require.resolve('../services/price-authority')];

const { evaluateLinePrice } = require('../services/price-authority');
const { validateAndLockCouponReservations } = require('../services/coupon-service');
const { stripPrivateLineFields } = require('../routes/so');

function createMockTx(reservationStore = {}) {
  return {
    request() {
      const inputs = {};
      return {
        input(name, type, val) {
          inputs[name] = val;
          return this;
        },
        async query(sqlText) {
          if (sqlText.includes('FROM wf.CouponReservation')) {
            const resId = inputs.resId;
            const row = reservationStore[resId];
            return { recordset: row ? [row] : [] };
          }
          return { recordset: [] };
        }
      };
    }
  };
}

test('1. Security: Forged _couponReservationValidated stripped at boundary and requires approval', async () => {
  const line = {
    goodId: '101',
    goodCode: 'FERT-01',
    qtyTon: 2.0,
    pricePerTon: 0,
    isCouponDrawn: true,
    refCouponDocuNo: 'CP-FORGED',
    _couponReservationValidated: true // Client forged marker
  };

  const lines = [line];
  // 1. Boundary sanitation strips all private markers
  stripPrivateLineFields(lines);
  assert.equal(lines[0]._couponReservationValidated, undefined, '_couponReservationValidated must be stripped');

  // 2. Real validator runs with no couponReservationId
  const mockTx = createMockTx({});
  const validatedIndexes = await validateAndLockCouponReservations(mockTx, lines, '0342001');
  assert.equal(validatedIndexes.has(0), false, 'Line must not be marked validated');

  // 3. Authority evaluation with server-side validation set
  const evalResult = await evaluateLinePrice(lines[0], '0342001', '2026-10-03', {
    isCouponValidated: validatedIndexes.has(0)
  });

  assert.equal(evalResult.requiresApproval, true, 'Forged coupon line must require price approval');
  assert.equal(Boolean(evalResult.isCouponDrawn), false);
});

test('2. Real validateAndLockCouponReservations: Customer mismatch throws 400', async () => {
  const mockTx = createMockTx({
    10: {
      Id: 10,
      CouponId: 246000,
      CouponNo: 'CP-246000',
      GoodId: 101,
      ReservedQty: 5.0,
      Status: 'RESERVED',
      BeneficiaryCustId: '0342999' // Different customer
    }
  });

  const lines = [{
    couponReservationId: 10,
    goodId: 101,
    qtyTon: 5.0,
    pricePerTon: 0
  }];

  await assert.rejects(
    async () => {
      await validateAndLockCouponReservations(mockTx, lines, '0342001');
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /ไม่ตรงกับลูกค้าของบิล/);
      return true;
    }
  );
});

test('3. Real validateAndLockCouponReservations: Product mismatch throws 400', async () => {
  const mockTx = createMockTx({
    11: {
      Id: 11,
      CouponId: 246000,
      CouponNo: 'CP-246000',
      GoodId: 999, // Product 999
      ReservedQty: 5.0,
      Status: 'RESERVED',
      BeneficiaryCustId: '0342001'
    }
  });

  const lines = [{
    couponReservationId: 11,
    goodId: 101, // Line is product 101
    qtyTon: 5.0,
    pricePerTon: 0
  }];

  await assert.rejects(
    async () => {
      await validateAndLockCouponReservations(mockTx, lines, '0342001');
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /ไม่ตรงกับสินค้าในบิล/);
      return true;
    }
  );
});

test('4. Real validateAndLockCouponReservations: Quantity mismatch throws 400', async () => {
  const mockTx = createMockTx({
    12: {
      Id: 12,
      CouponId: 246000,
      CouponNo: 'CP-246000',
      GoodId: 101,
      ReservedQty: 5.0,
      Status: 'RESERVED',
      BeneficiaryCustId: '0342001'
    }
  });

  const lines = [{
    couponReservationId: 12,
    goodId: 101,
    qtyTon: 4.5, // Line is 4.5 tons, reserved is 5.0 tons
    pricePerTon: 0
  }];

  await assert.rejects(
    async () => {
      await validateAndLockCouponReservations(mockTx, lines, '0342001');
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /ไม่ตรงกับจำนวนที่จองตั๋วไว้/);
      return true;
    }
  );
});

test('5. Real validateAndLockCouponReservations: Duplicate reservation ID throws 400', async () => {
  const mockTx = createMockTx({});
  const lines = [
    { couponReservationId: 15, goodId: 101, qtyTon: 2.0, pricePerTon: 0 },
    { couponReservationId: 15, goodId: 101, qtyTon: 2.0, pricePerTon: 0 }
  ];

  await assert.rejects(
    async () => {
      await validateAndLockCouponReservations(mockTx, lines, '0342001');
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /พบการใช้รหัสการจองตั๋วซ้ำ/);
      return true;
    }
  );
});

test('6. Valid reservation: Forces price to 0 and cleanly skips price approval', async () => {
  const mockTx = createMockTx({
    16: {
      Id: 16,
      CouponId: 246000,
      CouponNo: 'CP-246000',
      GoodId: 101,
      ReservedQty: 4.0,
      Status: 'RESERVED',
      BeneficiaryCustId: '0342001'
    }
  });

  const lines = [{
    couponReservationId: 16,
    goodId: 101,
    qtyTon: 4.0,
    pricePerTon: 15500.0, // Client tried submitting non-zero price
    netPricePerTon: 15500.0
  }];

  const validatedIndexes = await validateAndLockCouponReservations(mockTx, lines, '0342001');

  // Verify server-side set contains index 0
  assert.equal(validatedIndexes.has(0), true);

  // Verify price is forced to 0
  assert.equal(lines[0]._couponReservationValidated, true);
  assert.equal(lines[0].pricePerTon, 0);
  assert.equal(lines[0].netPricePerTon, 0);
  assert.equal(lines[0].isCouponDrawn, true);
  assert.equal(lines[0].refCouponDocuNo, 'CP-246000');

  // Downstream evaluateLinePrice must cleanly skip approval when isCouponValidated is true
  const evalResult = await evaluateLinePrice(lines[0], '0342001', '2026-10-03', {
    isCouponValidated: validatedIndexes.has(0)
  });
  assert.equal(evalResult.requiresApproval, false);
  assert.equal(evalResult.isCouponDrawn, true);
  assert.equal(evalResult.requestedPrice, 0);
  assert.equal(evalResult.announcedPrice, 0);
});

test.after(async () => {
  const { closeAll } = require('../db');
  await closeAll();
});
