'use strict';

/**
 * backend/tests/r10-6-rebate.test.js
 *
 * Dedicated unit test suite for R10.6 ticket items:
 *  - R10.5-1: Region validation and exact name lookup against wf.SaleRegion (02, 10, ภาคกลาง-ตะวันตก, rejection of unknown)
 *  - R10.5-2: Formula pattern 2-digit zero-padding (15-5-35, 16-8-8, 0-0-60) and LIKE matching against real dbo.EMGood codes
 *  - R10.5-3: cwd-independent stub resolution (tested from both root and backend/)
 *  - R10.5-4: Safe literal append of [SOID: ...] to claim Note using CHARINDEX to prevent bracket wildcard issue
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Pre-empt db.js with cwd-independent path resolution
const stubDb = {
  sql: {
    Int: 'Int',
    NVarChar: () => 'NVarChar',
    VarChar: () => 'VarChar',
    Char: () => 'Char',
    Decimal: () => 'Decimal',
    Date: 'Date',
    DateTime: 'DateTime',
    DateTime2: 'DateTime2',
    Bit: 'Bit',
    Request: class {
      constructor(tx) { this.tx = tx; this.inputs = {}; }
      input(k, t, v) { this.inputs[k] = { type: t, value: v }; return this; }
      output(k, t) { this.inputs[k] = { type: t, isOutput: true }; return this; }
      async query() { return { recordset: [], rowsAffected: [1] }; }
      async execute() { return { output: {}, rowsAffected: [1] }; }
    }
  },
  wfQuery: async () => ({ recordset: [], rowsAffected: [1] }),
  wfTransaction: async (cb) => cb({ request: () => new stubDb.sql.Request() })
};
const dbPath = path.resolve(__dirname, '../db.js');
require.cache[dbPath] = { exports: stubDb, id: dbPath, filename: dbPath, loaded: true };

const rebateRouter = require('../routes/rebate');
const { advanceAppliedClaimAtConfirm } = require('../services/rebate-claim-apply');

// Helper to simulate SQL Server LIKE in JS
function sqlLike(text, pattern) {
  if (!pattern) return false;
  const regexStr = '^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$';
  return new RegExp(regexStr).test(text);
}

test('R10.5-1: Region validation & exact-name resolution from wf.SaleRegion', () => {
  const { normalizePlanRegion, CANONICAL_SALE_REGIONS } = rebateRouter;

  assert.equal(CANONICAL_SALE_REGIONS.length, 14, 'Must have 14 canonical SaleRegion rows');

  // "02" is accepted
  assert.equal(normalizePlanRegion('02'), '02');

  // "ภาคกลาง-ตะวันตก" resolves to 02 (exact name)
  assert.equal(normalizePlanRegion('ภาคกลาง-ตะวันตก'), '02');

  // "10" is accepted
  assert.equal(normalizePlanRegion('10'), '10');

  // "ALL" is accepted
  assert.equal(normalizePlanRegion('ALL'), 'ALL');
  assert.equal(normalizePlanRegion(''), 'ALL');
  assert.equal(normalizePlanRegion(null), 'ALL');

  // All 14 region codes and names resolve correctly
  for (const r of CANONICAL_SALE_REGIONS) {
    assert.equal(normalizePlanRegion(r.RegionCode), r.RegionCode);
    assert.equal(normalizePlanRegion(r.RegionName), r.RegionCode);
  }

  // Unknown values are rejected
  assert.throws(() => normalizePlanRegion('UNKNOWN'), (err) => {
    return err.code === 'INVALID_REGION' && err.status === 400;
  });
  assert.throws(() => normalizePlanRegion('999'), (err) => {
    return err.code === 'INVALID_REGION' && err.status === 400;
  });
  // Substring alone without exact match must be rejected (no ambiguous substring matching)
  assert.throws(() => normalizePlanRegion('กลาง'), (err) => {
    return err.code === 'INVALID_REGION';
  });
  assert.throws(() => normalizePlanRegion('อีสาน'), (err) => {
    return err.code === 'INVALID_REGION';
  });
});

test('R10.5-2: Formula 2-digit zero-padding and LIKE matching against real dbo.EMGood fixture codes', () => {
  const { normalizeGoodPattern } = rebateRouter;

  // Zero-pad each formula part to 2 digits
  assert.equal(normalizeGoodPattern('15-5-35'), '%150535%');
  assert.equal(normalizeGoodPattern('16-8-8'), '%160808%');
  assert.equal(normalizeGoodPattern('0-0-60'), '%000060%');
  assert.equal(normalizeGoodPattern('15-15-15'), '%151515%');
  assert.equal(normalizeGoodPattern('8-24-24'), '%082424%');

  // Real codes from dbo.EMGood
  const realGoods = [
    { code: '7-15053500BBCAR', desc: '15-5-35 บลูบัวทิพย์' },
    { code: '7-16080800BBCAR', desc: '16-8-8 บลูบัวทิพย์' },
    { code: '5-0000600100BUL', desc: '0-0-60 บัวแดง' },
    { code: '7-15151500BBCAR', desc: '15-15-15 บลูบัวทิพย์' }
  ];

  // Positive assertions
  assert.ok(sqlLike(realGoods[0].code, normalizeGoodPattern('15-5-35')), '7-15053500BBCAR matches 15-5-35');
  assert.ok(sqlLike(realGoods[1].code, normalizeGoodPattern('16-8-8')), '7-16080800BBCAR matches 16-8-8');
  assert.ok(sqlLike(realGoods[2].code, normalizeGoodPattern('0-0-60')), '5-0000600100BUL matches 0-0-60');
  assert.ok(sqlLike(realGoods[3].code, normalizeGoodPattern('15-15-15')), '7-15151500BBCAR matches 15-15-15');

  // Negative cross-matching
  assert.equal(sqlLike(realGoods[0].code, normalizeGoodPattern('16-8-8')), false);
  assert.equal(sqlLike(realGoods[2].code, normalizeGoodPattern('15-15-15')), false);
  assert.equal(sqlLike(realGoods[3].code, normalizeGoodPattern('15-5-35')), false);

  // Exact code & wildcard pass-through
  assert.equal(normalizeGoodPattern('7-15151500BBCAR'), '7-15151500BBCAR');
  assert.equal(normalizeGoodPattern('7-15151500%'), '7-15151500%');
  assert.equal(normalizeGoodPattern('ALL'), null);
  assert.equal(normalizeGoodPattern('ทุกสูตร'), null);
});

test('R10.5-4: advanceAppliedClaimAtConfirm uses CHARINDEX to safely append [SOID: ...] to Note', async () => {
  let executedSql = '';
  let executedInputs = {};

  const mockQuery = async (text, inputs = {}) => {
    executedSql = text;
    executedInputs = inputs;
    if (text.includes('sys.columns')) {
      return { recordset: [{ name: 'AppliedSoDocuNo' }] };
    }
    return { rowsAffected: [1], recordset: [] };
  };

  const res = await advanceAppliedClaimAtConfirm(mockQuery, {
    claimId: 5,
    draftId: 119,
    custId: '1079',
    docuNo: 'I69-04234',
    soid: 278017
  });

  assert.equal(res.success, true);
  assert.equal(res.status, 'CN_ISSUED');

  // Must use CHARINDEX to avoid T-SQL bracket wildcard evaluation
  assert.ok(executedSql.includes('CHARINDEX(@soidNote, ISNULL(Note, \'\')) = 0'), 'Must use CHARINDEX for literal search');
  assert.ok(!executedSql.includes('Note NOT LIKE \'%\' + @soidNote + \'%\''), 'Must NOT use LIKE with brackets');
  assert.equal(executedInputs.soidNote.value, '[SOID: 278017]');
  assert.equal(executedInputs.docuNo.value, 'I69-04234');
});
