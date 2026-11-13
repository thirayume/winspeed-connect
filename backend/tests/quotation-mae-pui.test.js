'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./helpers/route-harness.cjs');
const { toBangkokDateString } = require('../services/coupon-settlement-matcher');

let maePuiSettingValue = '3';
let lastQuoteLines = [];

const db = h.installDbStub(({ kind, text, inputs }) => {
  if (kind === 'proc') return { recordset: [], rowsAffected: [1] };
  if (/AS Visible FROM wf\.Quotation/.test(text)) return [88, 89].includes(Number(inputs.id)) ? [{ Visible: 1 }] : [];

  if (/FROM wf\.SystemSetting WHERE SettingKey = @k/.test(text)) {
    if (inputs?.k === 'QUOTATION_MAE_PUI_MAX_VALID_DAYS') {
      return [{ SettingValue: maePuiSettingValue }];
    }
    return [];
  }

  // Group classification lookup (inspectMaePuiGoods)
  if (/FROM dbo\.EMGood g WITH \(NOLOCK\)[\s\S]*LEFT JOIN dbo\.EMGoodGroup gg/.test(text)) {
    const requestedIds = Object.entries(inputs || {})
      .filter(([k]) => k.startsWith('gid'))
      .map(([, v]) => Number(v));
    const catalog = [
      { GoodID: 2001, GoodCode: 'U-460000', GoodName1: '46-0-0 ยูเรีย', GoodGroupID: 1004, GoodGroupName: 'แม่ปุ๋ย บรรจุกระสอบ' },
      { GoodID: 1114, GoodCode: '7-15151500BBCAR', GoodName1: '15-15-15 เชิงผสม ตรารถเกษตร', GoodGroupID: 1003, GoodGroupName: 'ปุ๋ยสูตร บรรจุกระสอบ' },
    ];
    return catalog.filter(c => requestedIds.includes(c.GoodID));
  }

  if (/OBJECT_ID\('wf\.sp_AdvanceDocuCounter', 'P'\)/.test(text)) return [{ HasProc: 1 }];
  if (/EXEC wf\.sp_AdvanceDocuCounter/.test(text)) return [{ Updated: 1, Location: 'EMRunBrch' }];
  if (/HasNativeTables/.test(text)) return [{ HasNativeTables: 1, HasLinkColumns: 1, HasConfirmColumns: 1 }];
  if (/HasPriceProcs/.test(text)) return [{ HasPriceProcs: 1 }];
  if (/AS HasProcs/.test(text)) return [{ HasProcs: 1 }];
  if (/COL_LENGTH\('wf\.QuotationLine', 'IsGiveaway'\)/.test(text)) return [{ HasColumn: 1 }];
  if (/OBJECT_ID\('wf\.QuotationSourceSO', 'U'\)/.test(text)) return [{ HasTable: 1 }];
  if (/AS NextSeq/.test(text)) return [{ NextSeq: 21 }];
  if (/INSERT INTO wf\.Quotation \(/.test(text)) return [{ Id: 88 }];
  if (/INSERT INTO wf\.QuotationLine/.test(text)) return { recordset: [], rowsAffected: [1] };

  if (/SELECT SalesUserId FROM wf\.Quotation WHERE Id=@id/.test(text)) {
    return [{ SalesUserId: 25 }];
  }
  if (/SELECT (\*|WinspeedQuoteSOID, WinspeedConfirmSOID) FROM wf\.Quotation WHERE Id=@id/.test(text)) {
    const id = Number(inputs?.id);
    if (id === 88) {
      return [{
        Id: 88, QuoteNo: 'QU6911-00021', CustId: '1141', CustName: 'ร้านทดสอบ',
        SalesUserId: 25, Status: 'SENT', ValidUntil: '2026-11-12',
        WinspeedQuoteSOID: 290088, WinspeedQuoteNo: 'QU6911-00021', WinspeedConfirmSOID: null,
      }];
    }
    if (id === 89) {
      return [{
        Id: 89, QuoteNo: 'QU6911-00022', CustId: '1141', CustName: 'ร้านทดสอบ',
        SalesUserId: 25, Status: 'SENT', ValidUntil: '2026-11-12',
        WinspeedQuoteSOID: 290089, WinspeedQuoteNo: 'QU6911-00022', WinspeedConfirmSOID: null,
      }];
    }
    return [];
  }
  if (/FROM wf\.Quotation q\s+LEFT JOIN wf\.AppUser u/.test(text)) {
    return [{
      Id: 88, QuoteNo: inputs?.no || 'QU6911-00021', CustId: '1141', CustName: 'ร้านทดสอบ',
      ValidUntil: toBangkokDateString(new Date()), Remark: null, SalesUserId: 25, SalesEmpId: '1004', WinspeedQuoteSOID: null,
    }];
  }
  if (/FROM wf\.QuotationSourceSO src\s+INNER JOIN wf\.SalesOrder/.test(text)) return [];
  if (/FROM wf\.QuotationLine[\s\S]*WHERE QuoteId=@id/.test(text)) {
    const id = Number(inputs?.id);
    if (id === 89) {
      return [{
        Id: 2, LineNum: 1, GoodId: '1114', GoodCode: '7-15151500BBCAR',
        GoodName: '15-15-15 เชิงผสม', QtyTon: 5, PricePerTon: 18500, NetPricePerTon: 18500, IsGiveaway: 0,
      }];
    }
    if (lastQuoteLines.length && id === 88) return lastQuoteLines;
    return [{
      Id: 1, LineNum: 1, GoodId: '2001', GoodCode: 'U-460000',
      GoodName: '46-0-0 ยูเรีย', QtyTon: 10, PricePerTon: 14500, NetPricePerTon: 14500, IsGiveaway: 0,
    }];
  }

  // Authoritative price lookup
  if (/FROM dbo\.EMCust WITH \(NOLOCK\)/.test(text)) {
    return [{ CustID: 1141, CustCode: '1141', CustName: 'ร้านทดสอบ' }];
  }
  if (/FROM dbo\.EMSetPriceHD hd WITH \(NOLOCK\)/.test(text)) {
    return [{ SetPriceID: 500, ListNo: 1, AnnouncedPrice: 15200, CustID: null, BeginDate: '2026-11-01', EndDate: null, PriceSource: 'EMSetPrice' }];
  }

  if (/FROM sys\.columns c WITH \(NOLOCK\)/.test(text)) {
    return ['CustID', 'CustName', 'SaleAreaID', 'CreditDays', 'VATGroupID', 'VatType', 'BillAddr1', 'BillAddr2', 'District', 'Amphur', 'Province', 'PostCode', 'Tel', 'Fax'].map(name => ({ name }));
  }
  if (/FROM dbo\.EMCust c WITH \(NOLOCK\)/.test(text)) {
    return [{ CustID: 1141, CustName: 'ร้านทดสอบ', SaleAreaID: 1061, CreditDays: 30, VATGroupID: 1000, VatType: '3', BillAddr1: '1', BillAddr2: '', District: 'ต.', Amphur: 'อ.', Province: 'จ.', PostCode: '10000', Tel: '02', Fax: '' }];
  }
  if (/AS BrchID,/.test(text)) return [{ BrchID: 1, VATGroupID: 1000, InveID: 1000, LocaID: 1000 }];
  if (/AS NextId/.test(text)) return [{ NextId: 290088 }];
  if (/AS IdValue FROM/.test(text)) return [{ IdValue: inputs.id }];
  if (/FROM dbo\.EMGood WITH \(NOLOCK\) WHERE GoodID=@goodId/.test(text)) {
    return [{ GoodID: Number(inputs.goodId), GoodName1: Number(inputs.goodId) === 2001 ? '46-0-0 ยูเรีย' : '15-15-15', MainGoodUnitID: 1002, VatType: '3' }];
  }
  if (/UPDATE wf\.Quotation/.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/UPDATE wf\.QuotationLine/.test(text)) return { recordset: [], rowsAffected: [1] };
  return [];
}, { activeUserIds: h.TEST_USERS });

const { clearSettingCache } = require('../services/policy-contract');

let app;
test.before(async () => {
  app = await h.startApp([['/api/quotation', '../../routes/quotation']]);
});
test.after(async () => {
  await app.close();
});

function addDays(baseStr, days) {
  const d = new Date(baseStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('POST /api/quotation: แม่ปุ๋ย defaults validity to 3 days and rejects > 3 days', async () => {
  maePuiSettingValue = '3';
  clearSettingCache();
  lastQuoteLines = [{ LineNum: 1, GoodId: '2001', GoodCode: 'U-460000', GoodName: '46-0-0 ยูเรีย', QtyTon: 10, PricePerTon: 14500, NetPricePerTon: 14500, IsGiveaway: 0 }];

  const today = toBangkokDateString(new Date());
  const expectedMax = addDays(today, 3);

  // Rejects +7 days
  const bad = await app.call('POST', '/api/quotation', {
    body: {
      custId: '1141',
      custName: 'ร้านทดสอบ',
      validDays: 7,
      lines: [{ goodId: '2001', goodCode: 'U-460000', goodName: '46-0-0 ยูเรีย', qtyTon: 10, pricePerTon: 14500, netPricePerTon: 14500 }],
    },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /แม่ปุ๋ย/);
  assert.match(bad.body.message, /3 วัน/);

  // Defaults to +3 days when validDays/validUntil omitted
  const beforeCalls = db.calls.length;
  const ok = await app.call('POST', '/api/quotation', {
    body: {
      custId: '1141',
      custName: 'ร้านทดสอบ',
      lines: [{ goodId: '2001', goodCode: 'U-460000', goodName: '46-0-0 ยูเรีย', qtyTon: 10, pricePerTon: 14500, netPricePerTon: 14500 }],
    },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const insertCall = db.calls.slice(beforeCalls).find(c => /INSERT INTO wf\.Quotation \(/.test(c.text));
  assert.equal(new Date(insertCall.inputs.vu).toISOString().slice(0, 10), expectedMax);
});

test('POST /api/quotation: honors configured App Setting QUOTATION_MAE_PUI_MAX_VALID_DAYS', async () => {
  maePuiSettingValue = '5';
  clearSettingCache();

  const okFive = await app.call('POST', '/api/quotation', {
    body: {
      custId: '1141',
      custName: 'ร้านทดสอบ',
      validDays: 5,
      lines: [{ goodId: '2001', goodCode: 'U-460000', goodName: '46-0-0 ยูเรีย', qtyTon: 10, pricePerTon: 14500, netPricePerTon: 14500 }],
    },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(okFive.status, 200, JSON.stringify(okFive.body));

  const badSix = await app.call('POST', '/api/quotation', {
    body: {
      custId: '1141',
      custName: 'ร้านทดสอบ',
      validDays: 6,
      lines: [{ goodId: '2001', goodCode: 'U-460000', goodName: '46-0-0 ยูเรีย', qtyTon: 10, pricePerTon: 14500, netPricePerTon: 14500 }],
    },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(badSix.status, 400);
  assert.match(badSix.body.message, /5 วัน/);

  maePuiSettingValue = '3';
  clearSettingCache();
});

test('GET /api/quotation/:id/extend-preview returns current announced prices & MaePui limits', async () => {
  maePuiSettingValue = '3';
  clearSettingCache();
  const r = await app.call('GET', '/api/quotation/88/extend-preview', {
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.hasMaePui, true);
  assert.equal(r.body.maxValidDays, 3);
  assert.equal(r.body.requiresPriceReview, true);
  assert.equal(r.body.lines[0].CurrentAnnouncedPrice, 15200);
  assert.equal(r.body.lines[0].PriceDiff, -700);
});

test('PATCH /api/quotation/:id/valid-until: enforces <=3 days, requires priceReviewed, and syncs reviewed prices', async () => {
  maePuiSettingValue = '3';
  clearSettingCache();

  // 1. Missing priceReviewed on MaePui quotation -> 400
  const noReview = await app.call('PATCH', '/api/quotation/88/valid-until', {
    body: { validDays: 3 },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(noReview.status, 400);
  assert.equal(noReview.body.code, 'MAE_PUI_PRICE_REVIEW_REQUIRED');

  // 2. Exceeding maxDays (> 3) even with priceReviewed: true -> 400
  const overDays = await app.call('PATCH', '/api/quotation/88/valid-until', {
    body: { validDays: 7, priceReviewed: true },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(overDays.status, 400);
  assert.equal(overDays.body.code, 'MAE_PUI_MAX_VALIDITY_EXCEEDED');

  // 3. Valid extend (+3 days) WITH priceReviewed: true and reviewed line price -> 200 + updates app & WinSpeed native prices
  const before = db.calls.length;
  const okExtend = await app.call('PATCH', '/api/quotation/88/valid-until', {
    body: {
      validDays: 3,
      priceReviewed: true,
      lines: [{ lineNum: 1, goodId: '2001', pricePerTon: 15200 }],
    },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(okExtend.status, 200, JSON.stringify(okExtend.body));
  assert.equal(okExtend.body.hasMaePui, true);
  assert.equal(okExtend.body.priceReviewed, true);
  assert.equal(okExtend.body.updatedPriceCount, 1);

  const calls = db.calls.slice(before);
  assert.ok(calls.find(c => /UPDATE wf\.QuotationLine SET PricePerTon=@pp/.test(c.text) && c.inputs.pp === 15200), 'updates QuotationLine price');
  const lineProc = calls.find(c => c.proc === 'wf.sp_QuotationUpdateNativeLinePrice');
  assert.ok(lineProc, 'updates native WinSpeed line price via stored procedure');
  assert.equal(lineProc.inputs.NewPrice, 15200);
  assert.ok(calls.find(c => c.proc === 'wf.sp_QuotationRecalcNativeTotal'), 'recalculates WinSpeed header total');
  assert.ok(calls.find(c => c.proc === 'wf.sp_QuotationSetNativeValidity'), 'updates WinSpeed validity date');

  // 4. Non-MaePui quotation (id=89, group 1003) still extends +15 without priceReviewed
  const normalExtend = await app.call('PATCH', '/api/quotation/89/valid-until', {
    body: { validDays: 15 },
    user: { sub: 25, role: 'MANAGER' },
  });
  assert.equal(normalExtend.status, 200, JSON.stringify(normalExtend.body));
});

test('Migration 184 seeds QUOTATION_MAE_PUI_MAX_VALID_DAYS and uses SQL 2008 R2 compatible procs', () => {
  const sqlText = fs.readFileSync(require.resolve('../migrations/184_quotation_mae_pui_max_valid_days.sql'), 'utf8');
  assert.match(sqlText, /QUOTATION_MAE_PUI_MAX_VALID_DAYS/);
  assert.match(sqlText, /wf\.sp_QuotationUpdateNativeLinePrice/);
  assert.match(sqlText, /wf\.sp_QuotationRecalcNativeTotal/);
  assert.doesNotMatch(sqlText, /CREATE\s+OR\s+ALTER/i);
  assert.doesNotMatch(sqlText, /\bTRY_CAST\b/i);
});
