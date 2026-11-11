'use strict';

/**
 * pricelist-costlist.test.js — Verifies:
 *  1. Role separation (SEPARATION = 0, master.manage vs pricing.* vs cost.*)
 *  2. Confidential Costlist service (cost-authority.js): hard floor blocking, rebate-per-ton
 *     dilution protection, non-commercial line exemption, and ZERO leak of cost data / "ราคาทุน"
 *  3. Suspended ("งดขาย") Pricelist item enforcement (GOOD_SUSPENDED_ON_PRICELIST)
 *  4. Two-way WinSpeed Sync on Editable Pricelist (/api/pricebook): DRAFT & ACTIVE editing,
 *     header date sync, per-line upsert, SUSPENDED delete, Special Price sync + cost floor guard
 *  5. Confidential Costlist API (/api/costbook): 403 for non-cost roles, full access for cost roles
 *  6. Quotation & Price Approval cost floor guard + SO price-indicator neutral belowThreshold flags
 *  7. Pricelist & Costlist Reports (pricelist-report.js + /api/reports): -2..+2 contiguous window
 *     validation, weekly & monthly comparison, XLSX workbook generation, and costlist_sheet RBAC
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const h = require('./helpers/route-harness.cjs');

const LEAK_REGEX = /ราคาทุน|costprice|cost\s*price|costbook|\b15000\b|15,000|\b12000\b|12,000/i;

function assertNoCostLeak(payload, context = '') {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload || '');
  assert.ok(!LEAK_REGEX.test(text), `Confidential cost info leaked (${context}): ${text}`);
}

const activeCostBooks = [
  {
    Id: 10,
    Name: 'ต้นทุน พ.ย. 2569',
    EffectiveMonth: '2026-11',
    EffectiveFrom: '2026-11-01',
    EffectiveTo: '2026-11-30',
    Status: 'ACTIVE',
  },
];

const activeCostLines = [
  { CostBookId: 10, Id: 101, GoodId: '1094', GoodCode: '7-12044000BB', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร', GoodGroupId: 1001, GoodGroupName: 'ปุ๋ยสูตร', CostPrice: 15000, Unit: 'ตัน', Note: null },
  { CostBookId: 10, Id: 102, GoodId: '2001', GoodCode: '1-46000000BB', GoodName: '46-0-0 ยูเรีย', GoodGroupId: 1004, GoodGroupName: 'แม่ปุ๋ย', CostPrice: 12000, Unit: 'ตัน', Note: null },
];

const priceBooks = [
  {
    Id: 1,
    Name: 'ตารางราคา ก.ย. 2569',
    EffectiveMonth: '2026-09',
    EffectiveFrom: '2026-09-01',
    EffectiveTo: '2026-09-30',
    Status: 'ARCHIVED',
    SourceSetPriceIds: '501',
  },
  {
    Id: 2,
    Name: 'ตารางราคา ต.ค. 2569',
    EffectiveMonth: '2026-10',
    EffectiveFrom: '2026-10-01',
    EffectiveTo: '2026-10-31',
    Status: 'ARCHIVED',
    SourceSetPriceIds: '502',
  },
  {
    Id: 3,
    Name: 'ตารางราคา WinSpeed (SPL6911-00005)',
    EffectiveMonth: '2026-11',
    EffectiveFrom: '2026-11-01',
    EffectiveTo: '2026-11-15',
    Status: 'ACTIVE',
    SourceSetPriceIds: '503',
  },
  {
    Id: 4,
    Name: 'ตารางราคา พ.ย. 2569 (ครึ่งหลัง)',
    EffectiveMonth: '2026-11',
    EffectiveFrom: '2026-11-16',
    EffectiveTo: '2026-11-30',
    Status: 'APPROVED',
    SourceSetPriceIds: '504',
  },
  {
    Id: 5,
    Name: 'ตารางราคา ธ.ค. 2569',
    EffectiveMonth: '2026-12',
    EffectiveFrom: '2026-12-01',
    EffectiveTo: '2026-12-31',
    Status: 'DRAFT',
    SourceSetPriceIds: '505',
  },
];

let mutableBookLines = [
  { Id: 11, PriceBookId: 1, GoodId: '1094', GoodCode: '7-12044000BB', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร', GoodGroupId: 1001, GoodGroupName: 'ปุ๋ยสูตร', Unit: 'ตัน', Price: 16800, LineStatus: 'ACTIVE', Note: null, WinSpeedSetPriceId: 501, WinSpeedListNo: 1 },
  { Id: 12, PriceBookId: 2, GoodId: '1094', GoodCode: '7-12044000BB', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร', GoodGroupId: 1001, GoodGroupName: 'ปุ๋ยสูตร', Unit: 'ตัน', Price: 17000, LineStatus: 'ACTIVE', Note: null, WinSpeedSetPriceId: 502, WinSpeedListNo: 1 },
  { Id: 13, PriceBookId: 3, GoodId: '1094', GoodCode: '7-12044000BB', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร', GoodGroupId: 1001, GoodGroupName: 'ปุ๋ยสูตร', Unit: 'ตัน', Price: 17200, LineStatus: 'ACTIVE', Note: null, WinSpeedSetPriceId: 503, WinSpeedListNo: 1 },
  { Id: 14, PriceBookId: 3, GoodId: '2001', GoodCode: '1-46000000BB', GoodName: '46-0-0 ยูเรีย', GoodGroupId: 1004, GoodGroupName: 'แม่ปุ๋ย', Unit: 'ตัน', Price: 13500, LineStatus: 'DISCONTINUING', Note: 'ใกล้หมดสต็อก', WinSpeedSetPriceId: 503, WinSpeedListNo: 2 },
  { Id: 15, PriceBookId: 3, GoodId: '3001', GoodCode: '7-16080800BB', GoodName: '16-8-8 เชิงผสม', GoodGroupId: 1001, GoodGroupName: 'ปุ๋ยสูตร', Unit: 'ตัน', Price: null, LineStatus: 'SUSPENDED', Note: 'งดขายชั่วคราว', WinSpeedSetPriceId: 503, WinSpeedListNo: 3 },
  { Id: 16, PriceBookId: 4, GoodId: '1094', GoodCode: '7-12044000BB', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร', GoodGroupId: 1001, GoodGroupName: 'ปุ๋ยสูตร', Unit: 'ตัน', Price: 17300, LineStatus: 'ACTIVE', Note: null, WinSpeedSetPriceId: 504, WinSpeedListNo: 1 },
  { Id: 17, PriceBookId: 5, GoodId: '1094', GoodCode: '7-12044000BB', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร', GoodGroupId: 1001, GoodGroupName: 'ปุ๋ยสูตร', Unit: 'ตัน', Price: 17500, LineStatus: 'ACTIVE', Note: null, WinSpeedSetPriceId: 505, WinSpeedListNo: 1 },
];

const procCalls = [];

const db = h.installDbStub((call) => {
  const { kind, text, inputs, proc } = call;

  if (kind === 'proc') {
    procCalls.push({ proc, inputs: { ...inputs } });
    if (proc === 'wf.sp_PriceBookUpsertWinSpeedLine') {
      return { recordset: [], rowsAffected: [1], output: { ListNo: inputs.ListNo || 1 } };
    }
    if (proc === 'wf.sp_PriceBookUpsertSpecialWinSpeedPrice') {
      return { recordset: [], rowsAffected: [1], output: { SetPriceID: inputs.SetPriceID || 900 } };
    }
    if (proc === 'wf.sp_PriceBookCreateWinSpeedSet') {
      return { recordset: [], rowsAffected: [1], output: { NewSetPriceID: 600, DocuNo: 'WEB-20261111-0001' } };
    }
    return { recordset: [], rowsAffected: [1], output: {} };
  }

  // Schema & migration checks
  if (/COL_LENGTH\('wf\.PriceBook'/i.test(text)) {
    return [{ HasPb: 1, HasLine: 1, HasSp: 1, HasSpProc: 1 }];
  }
  if (/COL_LENGTH\('wf\.QuotationLine',\s*'IsGiveaway'\)/i.test(text)) {
    return [{ HasCol: 1 }];
  }
  if (/OBJECT_ID\('dbo\.SOHD'/i.test(text)) {
    return [{ HasNativeTables: 1, HasLinkColumns: 1 }];
  }
  if (/OBJECT_ID\('wf\.Quotation'/i.test(text) || /sys\.objects/i.test(text)) {
    return [{ cnt: 1, Id: 1, ok: 1 }];
  }
  if (/FROM wf\.SystemSettings/i.test(text)) {
    return [{ SettingValue: '3' }];
  }

  // User scope checks
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser WHERE Id = @id/i.test(text)) {
    return [{ Id: inputs.id, EmpId: null, PositionCode: null }];
  }

  // Master lookup
  if (/FROM dbo\.EMGoodGroup/i.test(text) || /FROM dbo\.EMGood\b/i.test(text)) {
    const gid = Number(inputs.gidInt ?? inputs.gid0 ?? inputs.gid ?? 0);
    const gcode = String(inputs.gcode ?? inputs.gc0 ?? '');
    if (gid === 1094 || gcode === '7-12044000BB') {
      return [{ GoodID: 1094, GoodCode: '7-12044000BB', GoodName1: '12-4-40 เชิงผสม ตรารถเกษตร', GoodGroupID: 1001, GoodGroupName: 'ปุ๋ยสูตร' }];
    }
    if (gid === 2001 || gcode === '1-46000000BB') {
      return [{ GoodID: 2001, GoodCode: '1-46000000BB', GoodName1: '46-0-0 ยูเรีย', GoodGroupID: 1004, GoodGroupName: 'แม่ปุ๋ย' }];
    }
    if (gid === 3001 || gcode === '7-16080800BB') {
      return [{ GoodID: 3001, GoodCode: '7-16080800BB', GoodName1: '16-8-8 เชิงผสม', GoodGroupID: 1001, GoodGroupName: 'ปุ๋ยสูตร' }];
    }
    return [];
  }
  if (/FROM dbo\.EMCust\b/i.test(text)) {
    return [{ CustID: 1078, CustCode: '0330005', CustName: 'ร้านทดสอบจำกัด' }];
  }

  // CostBook queries
  if (/FROM wf\.CostBookLine cbl/i.test(text) && /JOIN wf\.CostBook cb/i.test(text)) {
    const gid = String(inputs.goodId || '');
    const gcode = String(inputs.goodCode || '');
    return activeCostLines
      .filter(l => (gid && l.GoodId === gid) || (gcode && l.GoodCode === gcode))
      .map(l => ({ ...l, CostBookName: activeCostBooks[0].Name, EffectiveMonth: '2026-11', EffectiveFrom: '2026-11-01', EffectiveTo: '2026-11-30' }));
  }
  if (/FROM wf\.CostBook\b/i.test(text) && !/^\s*SELECT\s+l\./i.test(text)) {
    if (inputs.id) return activeCostBooks.filter(b => b.Id === Number(inputs.id));
    return activeCostBooks;
  }
  if (/FROM wf\.CostBookLine/i.test(text)) {
    if (/CostBookId IN/i.test(text)) {
      const bidSet = new Set(Object.entries(inputs).filter(([k]) => k.startsWith('bid')).map(([, v]) => Number(v)));
      return activeCostLines
        .filter(l => bidSet.size === 0 || bidSet.has(Number(l.CostBookId)))
        .map(l => ({ ...l, BookId: l.CostBookId, Remark: l.Note }));
    }
    return activeCostLines.filter(l => Number(l.CostBookId) === Number(inputs.id || 10));
  }

  // PriceBook queries
  if (/FROM wf\.PriceBookSpecialPrice/i.test(text)) {
    if (/INSERT INTO wf\.PriceBookSpecialPrice/i.test(text)) return [{ Id: 501 }];
    if (/UPDATE wf\.PriceBookSpecialPrice/i.test(text)) return { recordset: [], rowsAffected: [1] };
    if (/WHERE sp\.Id=@id/i.test(text) || /WHERE sp\.Id = @id/i.test(text)) {
      return [{
        Id: Number(inputs.id || 501),
        PriceBookId: 3,
        CustId: '1078',
        CustName: 'ร้านทดสอบจำกัด',
        GoodId: '1094',
        GoodName: '12-4-40 เชิงผสม ตรารถเกษตร',
        RequestedBy: 99,
        ApprovedPrice: Number(inputs.id) === 501 ? 15800 : null,
        BookStatus: 'ACTIVE',
        EffectiveMonth: '2026-11',
        EffectiveFrom: '2026-11-01',
        EffectiveTo: '2026-11-15',
        WinSpeedSetPriceId: null,
      }];
    }
    return [{
      Id: 501, PriceBookId: 3, CustId: '1078', CustName: 'ร้านทดสอบจำกัด',
      GoodId: '1094', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร',
      RequestedPrice: 15800, ApprovedPrice: 15800, Note: 'ขอราคาพิเศษ', ReasonText: 'ขอราคาพิเศษ', Status: 'APPROVED',
    }];
  }

  if (/FROM wf\.PriceBookLine/i.test(text)) {
    if (/LineStatus = 'SUSPENDED'/i.test(text)) {
      return mutableBookLines.filter(l => l.PriceBookId === 3 && l.LineStatus === 'SUSPENDED');
    }
    if (/WHERE Id=@lid AND PriceBookId=@id/i.test(text)) {
      return mutableBookLines.filter(l => l.Id === Number(inputs.lid) && l.PriceBookId === Number(inputs.id));
    }
    if (/WHERE PriceBookId = @id/i.test(text) || /WHERE PriceBookId=@id/i.test(text)) {
      return mutableBookLines.filter(l => l.PriceBookId === Number(inputs.id));
    }
    if (/PriceBookId IN/i.test(text)) {
      const bidSet = new Set(Object.entries(inputs).filter(([k]) => k.startsWith('bid')).map(([, v]) => Number(v)));
      return mutableBookLines
        .filter(l => bidSet.size === 0 || bidSet.has(Number(l.PriceBookId)))
        .map(l => ({ ...l, BookId: l.PriceBookId, Remark: l.Note }));
    }
    return mutableBookLines.filter(l => l.PriceBookId === 3);
  }
  if (/UPDATE wf\.PriceBookLine/i.test(text)) {
    const line = mutableBookLines.find(l => l.Id === Number(inputs.lid));
    if (line) {
      if ('p' in inputs) line.Price = inputs.p;
      if ('ls' in inputs) line.LineStatus = inputs.ls;
      if ('note' in inputs) line.Note = inputs.note;
    }
    return { recordset: [], rowsAffected: [1] };
  }

  if (/FROM wf\.PriceBook\b/i.test(text)) {
    if (inputs.id) return priceBooks.filter(b => b.Id === Number(inputs.id));
    return priceBooks;
  }
  if (/UPDATE wf\.PriceBook\b/i.test(text)) {
    return { recordset: [], rowsAffected: [1] };
  }

  // Price Approval queries (edit-requests.js)
  if (/FROM wf\.PriceApproval\b/i.test(text)) {
    return [{
      Id: 801, SoId: 700, GoodId: '1094', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร',
      QtyTon: 5, RequestedPrice: 14500, AnnouncedPrice: 17200,
      Status: 'PENDING', DocumentRevision: 1, RequestedBy: 99, SalesUserId: 99,
    }];
  }
  if (/FROM wf\.SalesOrder WHERE Id = @soId/i.test(text)) {
    return [{ DocumentRevision: 1, Status: 'DRAFT', DeliveryDate: '2026-11-12', RebateDiscountAmt: 0 }];
  }
  if (/FROM wf\.SalesOrderLine/i.test(text)) {
    return [{
      GoodId: '1094', GoodCode: '7-12044000BB', GoodName: '12-4-40 เชิงผสม ตรารถเกษตร',
      QtyTon: 5, PricePerTon: 14500, IsGiveaway: 0,
    }];
  }

  // Standard WinSpeed price indicator lookups (so.js / price-authority)
  if (/FROM dbo\.EMSetPriceDT/i.test(text)) {
    return [{ ListID: 1094, GoodPriceNet: 17200, CustID: null }];
  }

  // Misc mutations
  if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) {
    return { recordset: [{ Id: 1 }], rowsAffected: [1] };
  }

  return [];
}, { activeUserIds: [1, 2, 10, 11, 12, 25, 99] });

// Ensure require('../db').getPool() works for WinSpeed SP sync in tests
db.stub.getPool = async () => db.tx;

const {
  capabilitiesFor,
  ACTIONS,
  MENUS,
  hasPermission,
} = require('../services/role-capabilities');
const {
  NEUTRAL_PRICE_THRESHOLD_CODE,
  evaluateSellingPriceFloor,
  assertPricesAboveCost,
  assertPriceBookLinesSellable,
} = require('../services/cost-authority');
const {
  listSelectablePeriods,
  assertContiguousWindow,
  buildSheetReport,
  buildSheetWorkbook,
  formatThaiBeDate,
} = require('../services/pricelist-report');

let app;
test.before(async () => {
  app = await h.startApp([
    ['/api/costbook', '../../routes/costbook'],
    ['/api/pricebook', '../../routes/pricebook'],
    ['/api/so', '../../routes/so'],
    ['/api/quotation', '../../routes/quotation'],
    ['/api/edit-requests', '../../routes/edit-requests'],
    ['/api/reports', '../../routes/reports'],
  ]);
});

test.after(async () => {
  await app.close();
});

// ── 1. Role Separation ────────────────────────────────────────────────────────
test('Role separation: SEPARATION has 0 caps; ACCOUNTING/MANAGER get pricing+cost without master.manage', () => {
  const sep = capabilitiesFor('SEPARATION');
  assert.deepEqual(sep, { menus: [], actions: [] });

  assert.ok(ACTIONS['master.manage'].includes('C_LEVEL') && ACTIONS['master.manage'].includes('ADMIN'));
  assert.ok(!ACTIONS['master.manage'].includes('ACCOUNTING'));
  assert.ok(!ACTIONS['master.manage'].includes('MANAGER'));

  const mgr = capabilitiesFor('MANAGER');
  assert.ok(mgr.actions.includes('pricing.view'));
  assert.ok(mgr.actions.includes('pricing.manage'));
  assert.ok(mgr.actions.includes('cost.view'));
  assert.ok(mgr.actions.includes('cost.manage'));
  assert.ok(!mgr.actions.includes('master.manage'));

  const acc = capabilitiesFor('ACCOUNTING');
  assert.ok(acc.actions.includes('cost.view'));
  assert.ok(acc.actions.includes('cost.manage'));
  assert.ok(!acc.actions.includes('master.manage'));

  const sales = capabilitiesFor('SALES');
  assert.ok(!sales.actions.includes('cost.view'));
  assert.ok(!sales.actions.includes('cost.manage'));
  assert.ok(!sales.actions.includes('pricing.manage'));
  assert.ok(hasPermission({ role: 'ADMIN' }, 'cost.manage'));
  assert.ok(!hasPermission({ role: 'SEPARATION' }, 'cost.view'));
  assert.ok(Array.isArray(MENUS.master) && MENUS.master.includes('ACCOUNTING'));
});

// ── 2. Confidential Cost Floor Service ────────────────────────────────────────
test('Cost authority: blocks prices below CostPrice, catches rebate dilution, never leaks cost', async () => {
  // Strictly below CostPrice (15,000) -> blocked
  const lowEval = await evaluateSellingPriceFloor({
    lines: [{ goodId: '1094', goodCode: '7-12044000BB', goodName: '12-4-40 เชิงผสม', qtyTon: 2, pricePerTon: 14999 }],
    asOfDate: '2026-11-10',
  });
  assert.equal(lowEval.blocked, true);
  assert.equal(lowEval.violations.length, 1);
  assert.equal('costPrice' in lowEval.violations[0], false);
  assertNoCostLeak(lowEval, 'lowEval');
  assert.ok(lowEval.message.includes('ไม่อยู่ในเกณฑ์ที่บริษัทกำหนด'));

  // Rebate deduction diluting effective unit price below CostPrice -> blocked!
  // 2 tons * 15,200 = 30,400; rebateDiscountAmt = 600 => effective 14,900/ton < 15,000!
  const rebateEval = await evaluateSellingPriceFloor({
    lines: [{ goodId: '1094', goodCode: '7-12044000BB', goodName: '12-4-40 เชิงผสม', qtyTon: 2, pricePerTon: 15200 }],
    asOfDate: '2026-11-10',
    rebateDiscountAmt: 600,
  });
  assert.equal(rebateEval.blocked, true);
  assertNoCostLeak(rebateEval, 'rebateEval');

  // Non-commercial lines (giveaway / coupon drawn) at 0 baht -> exempt
  const freeEval = await evaluateSellingPriceFloor({
    lines: [
      { goodId: '1094', qtyTon: 1, pricePerTon: 0, isGiveaway: true },
      { goodId: '1094', qtyTon: 2, pricePerTon: 0, isCouponDrawn: true },
    ],
    asOfDate: '2026-11-10',
  });
  assert.equal(freeEval.blocked, false);

  // Equal to CostPrice (15,000) -> allowed
  const eqEval = await evaluateSellingPriceFloor({
    lines: [{ goodId: '1094', qtyTon: 2, pricePerTon: 15000 }],
    asOfDate: '2026-11-10',
  });
  assert.equal(eqEval.blocked, false);

  // assertPricesAboveCost throws 422 PRICE_BELOW_MIN_THRESHOLD with no leak
  await assert.rejects(
    () => assertPricesAboveCost({ lines: [{ goodId: '1094', qtyTon: 1, pricePerTon: 14000 }], asOfDate: '2026-11-10' }),
    (err) => {
      assert.equal(err.status, 422);
      assert.equal(err.code, NEUTRAL_PRICE_THRESHOLD_CODE);
      assertNoCostLeak(err.message, 'assertPricesAboveCost.message');
      assertNoCostLeak(err.details, 'assertPricesAboveCost.details');
      return true;
    }
  );
});

test('Cost authority: assertPriceBookLinesSellable blocks SUSPENDED ("งดขาย") items', async () => {
  await assert.rejects(
    () => assertPriceBookLinesSellable({
      lines: [{ goodId: '3001', goodCode: '7-16080800BB', goodName: '16-8-8 เชิงผสม', qtyTon: 1, pricePerTon: 17000 }],
      asOfDate: '2026-11-10',
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'GOOD_SUSPENDED_ON_PRICELIST');
      assert.ok(err.message.includes('งดขาย'));
      return true;
    }
  );
});

// ── 3. Costlist Route Security ────────────────────────────────────────────────
test('Costlist API: non-cost roles get 403; ACCOUNTING/MANAGER can inspect costbook', async () => {
  const salesList = await app.call('GET', '/api/costbook', { user: { sub: 10, role: 'SALES' } });
  assert.equal(salesList.status, 403);
  assert.equal(salesList.body.code, 'FORBIDDEN_COST_VIEW');

  const counterMap = await app.call('GET', '/api/costbook/active-map', { user: { sub: 11, role: 'COUNTER_SALES' } });
  assert.equal(counterMap.status, 403);

  const whCreate = await app.call('POST', '/api/costbook', { body: { name: 'x' }, user: { sub: 2, role: 'WAREHOUSE' } });
  assert.equal(whCreate.status, 403);

  const accList = await app.call('GET', '/api/costbook', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(accList.status, 200);
  assert.equal(accList.body.length, 1);

  const mgrMap = await app.call('GET', '/api/costbook/active-map', { user: { sub: 25, role: 'MANAGER' } });
  assert.equal(mgrMap.status, 200);
  assert.equal(mgrMap.body.items['1094'], 15000);
});

// ── 4. Editable Pricelist + Two-Way WinSpeed Sync ─────────────────────────────
test('PriceBook: editing ACTIVE line below Cost returns 422 neutral; above Cost syncs to WinSpeed SPs', async () => {
  procCalls.length = 0;

  // Below CostPrice (14,900 < 15,000) -> 422 neutral without leaking "ราคาทุน" / 15000
  const lowPatch = await app.call('PATCH', '/api/pricebook/3/lines/13', {
    body: { price: 14900, lineStatus: 'ACTIVE' },
    user: { sub: 12, role: 'ACCOUNTING' },
  });
  assert.equal(lowPatch.status, 422);
  assert.equal(lowPatch.body.code, NEUTRAL_PRICE_THRESHOLD_CODE);
  assertNoCostLeak(lowPatch.body, 'lowPatch');
  assert.equal(procCalls.length, 0);

  // Above CostPrice -> updates DB & runs WinSpeed sync SPs
  const okPatch = await app.call('PATCH', '/api/pricebook/3/lines/13', {
    body: { price: 17400, lineStatus: 'ACTIVE', note: 'ปรับราคาตลาด' },
    user: { sub: 12, role: 'ACCOUNTING' },
  });
  assert.equal(okPatch.status, 200);
  assert.equal(okPatch.body.winSpeedSynced, true);
  assert.ok(procCalls.some(c => c.proc === 'wf.sp_PriceBookSyncHeaderDatesToWinSpeed'));
  assert.ok(procCalls.some(c => c.proc === 'wf.sp_PriceBookUpsertWinSpeedLine' && Number(c.inputs.GoodPriceNet) === 17400));

  // Switching ACTIVE line to SUSPENDED removes it from WinSpeed
  procCalls.length = 0;
  const suspPatch = await app.call('PATCH', '/api/pricebook/3/lines/14', {
    body: { lineStatus: 'SUSPENDED' },
    user: { sub: 12, role: 'ACCOUNTING' },
  });
  assert.equal(suspPatch.status, 200);
  assert.ok(procCalls.some(c => c.proc === 'wf.sp_PriceBookDeleteWinSpeedLine' && Number(c.inputs.GoodID) === 2001));
  // Restore line 14 back to DISCONTINUING for downstream report test
  mutableBookLines.find(l => l.Id === 14).LineStatus = 'DISCONTINUING';
  mutableBookLines.find(l => l.Id === 14).Price = 13500;
});

test('PriceBook Special Price: blocks below Cost & syncs approved special price to WinSpeed', async () => {
  procCalls.length = 0;

  // Request below cost (14800 < 15000) -> 422 neutral
  const badReq = await app.call('POST', '/api/pricebook/3/special', {
    body: { custId: '1078', custName: 'ร้านทดสอบจำกัด', goodId: '1094', goodName: '12-4-40', requestedPrice: 14800 },
    user: { sub: 10, role: 'SALES' },
  });
  assert.equal(badReq.status, 422);
  assert.equal(badReq.body.code, NEUTRAL_PRICE_THRESHOLD_CODE);
  assertNoCostLeak(badReq.body, 'special-post');

  // Approve special price below cost -> 422 neutral
  const badApprove = await app.call('PATCH', '/api/pricebook/special/501', {
    body: { approvedPrice: 14900 },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(badApprove.status, 422);
  assertNoCostLeak(badApprove.body, 'special-approve-low');

  // Approve valid special price (15,800 >= 15,000) -> 200 & syncs WinSpeed special SP
  const okApprove = await app.call('PATCH', '/api/pricebook/special/501', {
    body: { approvedPrice: 15800 },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(okApprove.status, 200);
  assert.equal(okApprove.body.winSpeedSynced, true);
  assert.ok(procCalls.some(c => c.proc === 'wf.sp_PriceBookUpsertSpecialWinSpeedPrice' && Number(c.inputs.ApprovedPrice) === 15800));
});

// ── 5. Sales / Quotation / Edit Request Endpoints ─────────────────────────────
test('Sales price-indicator: returns boolean belowThreshold flags only with zero cost data', async () => {
  const ind = await app.call('POST', '/api/so/price-indicator', {
    body: {
      custId: '1078',
      deliveryDate: '2026-11-12',
      rebateDiscountAmt: 0,
      lines: [
        { key: 'row1', goodId: '1094', goodCode: '7-12044000BB', pricePerTon: 14500, qtyTon: 2 },
        { key: 'row2', goodId: '2001', goodCode: '1-46000000BB', pricePerTon: 13500, qtyTon: 1 },
      ],
    },
    user: { sub: 10, role: 'SALES' },
  });
  assert.equal(ind.status, 200);
  assert.equal(ind.body.belowThreshold, true);
  assert.equal(ind.body.lines.find(x => x.key === 'row1')?.belowThreshold, true);
  assert.equal(ind.body.lines.find(x => x.key === 'row2')?.belowThreshold, false);
  assertNoCostLeak(ind.body, 'price-indicator');
});

test('Quotation POST & PriceApproval approve: block SUSPENDED and below-cost neutrally', async () => {
  // Suspended ("งดขาย") item on quotation -> 400 GOOD_SUSPENDED_ON_PRICELIST
  const qSusp = await app.call('POST', '/api/quotation', {
    body: {
      custId: '1078',
      custName: 'ร้านทดสอบจำกัด',
      validDays: 7,
      lines: [{ goodId: '3001', goodCode: '7-16080800BB', goodName: '16-8-8 เชิงผสม', qtyTon: 2, pricePerTon: 17000 }],
    },
    user: { sub: 10, role: 'SALES' },
  });
  assert.equal(qSusp.status, 400);
  assert.equal(qSusp.body.code, 'GOOD_SUSPENDED_ON_PRICELIST');

  // Below-cost item on quotation -> 422 neutral
  const qLow = await app.call('POST', '/api/quotation', {
    body: {
      custId: '1078',
      custName: 'ร้านทดสอบจำกัด',
      validDays: 7,
      lines: [{ goodId: '1094', goodCode: '7-12044000BB', goodName: '12-4-40', qtyTon: 2, pricePerTon: 14500 }],
    },
    user: { sub: 10, role: 'SALES' },
  });
  assert.equal(qLow.status, 422);
  assert.equal(qLow.body.code, NEUTRAL_PRICE_THRESHOLD_CODE);
  assertNoCostLeak(qLow.body, 'quotation-low');

  // Approving a price-approval request that sits below Costlist -> 422 neutral
  const paLow = await app.call('PATCH', '/api/edit-requests/price-approvals/801/approve', {
    body: { note: 'ขออนุมัติพิเศษ' },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(paLow.status, 422);
  assert.equal(paLow.body.code, NEUTRAL_PRICE_THRESHOLD_CODE);
  assertNoCostLeak(paLow.body, 'price-approval-approve');
});

// ── 6. Reports: -2..+2 Contiguous Window + Sheet Layout + XLSX Export ─────────
test('Reports: -2..+2 contiguous window validation, BE dd/mm/yyyy format, Sheet layout & XLSX', async () => {
  assert.equal(formatThaiBeDate('2026-11-11'), '11/11/2569');
  assert.equal(formatThaiBeDate('2026-11-11T09:05:00+07:00', true), '11/11/2569 09:05');

  const periodsMeta = await listSelectablePeriods({ kind: 'pricelist', granularity: 'week' });
  assert.ok(periodsMeta.periods.some(p => p.offset === 0 && p.isCurrent));
  assert.ok(periodsMeta.periods.every(p => p.offset >= -2 && p.offset <= 2));

  // Valid contiguous window [-1, 0, 1]
  const validWin = assertContiguousWindow(periodsMeta.periods, { offsets: [-1, 0, 1] });
  assert.deepEqual(validWin.map(p => p.offset), [-1, 0, 1]);

  // Gap [-1, 1] -> rejected 400
  assert.throws(
    () => assertContiguousWindow(periodsMeta.periods, { offsets: [-1, 1] }),
    (e) => e.status === 400 && /ต่อเนื่อง/.test(e.message)
  );

  // Out-of-bounds [-3, -2, -1, 0] -> rejected 400
  assert.throws(
    () => assertContiguousWindow(periodsMeta.periods, { offsets: [-3, -2, -1, 0] }),
    (e) => e.status === 400
  );

  // Build current pricelist_sheet report & verify markers + signatures + special prices + workbook
  const sheetReport = await buildSheetReport({
    kind: 'pricelist',
    mode: 'current',
    granularity: 'week',
  });
  assert.equal(sheetReport.meta.kind, 'pricelist');
  assert.equal(sheetReport.meta.mode, 'current');
  const layout = sheetReport.meta.sheetLayout;
  const compoundSides = layout.compoundPairs.flatMap(p => [p.left, p.right]).filter(Boolean);
  const singleSides = layout.singlePairs.flatMap(p => [p.left, p.right]).filter(Boolean);
  assert.ok(compoundSides.some(x => x.goodName));
  assert.ok(singleSides.some(x => x.marker === '***'));
  assert.ok(compoundSides.some(x => x.marker === 'งดขาย'));
  assert.equal(layout.signatures.leftLabel, 'ฝ่ายขาย');
  assert.equal(layout.signatures.rightLabel, 'ผู้อนุมัติ');
  assert.equal(layout.specialPrices.length, 1);

  const wb = buildSheetWorkbook({ reportData: sheetReport });
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 500);
  const parsed = XLSX.read(buf, { type: 'buffer' });
  assert.ok(parsed.SheetNames.includes('Sheet1'));

  // Route RBAC: SALES gets 403 on costlist-periods and costlist_sheet
  const salesCostPeriods = await app.call('GET', '/api/reports/costlist-periods', { user: { sub: 10, role: 'SALES' } });
  assert.equal(salesCostPeriods.status, 403);

  const salesCostReport = await app.call('GET', '/api/reports/costlist_sheet?mode=current', { user: { sub: 10, role: 'SALES' } });
  assert.equal(salesCostReport.status, 403);

  const accCostPeriods = await app.call('GET', '/api/reports/costlist-periods?granularity=month', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(accCostPeriods.status, 200);

  const accCostCompare = await app.call('GET', '/api/reports/costlist_sheet?mode=compare&granularity=month&offsets=0', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(accCostCompare.status, 200);
  assert.equal(accCostCompare.body.type, 'costlist_sheet');
});
