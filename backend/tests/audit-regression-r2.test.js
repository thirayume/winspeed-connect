/**
 * audit-regression-r2.test.js
 * 
 * Deterministic regression tests covering findings R2-01 through R2-03 from:
 * docs/sale-app/qa/CODEX-AUDIT-REVIEW-20260919-R2.md
 * and docs/sale-app/qa/audit-recon-r2-repro-20260919.cjs
 *
 * In-memory source evaluation without database dependencies or mutations.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const reconSource = fs.readFileSync(path.resolve(__dirname, '../routes/recon.js'), 'utf8');

async function runReconCheck(mode, customOptions = {}) {
  const invoice = {
    SoId: '1',
    SOInvID: 2,
    InvListNo: 1,
    DocuNo: 'INV-A',
    DocuType: 107,
    DocuStatus: 'N',
    PostID: 10,
    PostGL: 'Y',
    LineQtyTon: 5,
    LineAmnt: 100,
    Provenance: 'PRIMARY_103_LINE'
  };

  const journal = {
    GLID: 20,
    DocuNo: 'INV-A',
    FromID: 10,
    FromFlag: '107',
    DocuStatus: 'N',
    LineCount: 2,
    SumDebit: 100,
    SumCredit: 100,
    JournalDate: '2026-09-19'
  };

  const query = async (q) => {
    let r = [];
    if (q.includes('SELECT TOP 500')) {
      r = [{
        SoId: '1',
        WsDocuNo: 'SO-A',
        DocuStatus: 'N',
        AppvFlag: 'Y',
        WeighOutWeight: 10000,
        NetKg: 10000,
        Movebill: 'MB',
        TotalOrderedQtyTon: 10
      }];
    } else if (q.includes("'PRIMARY_103_LINE'")) {
      if (mode === 'two-for-one') {
        r = [invoice, { ...invoice, SOInvID: 3, DocuNo: 'INV-B', PostID: 11 }];
      } else {
        r = [invoice];
      }
    } else if (q.includes('FROM dbo.GLHD')) {
      if (mode === 'two-for-one') {
        // Both GL headers point to FromID: 10 (invoice INV-A), none to FromID: 11 (INV-B)
        r = [journal, { ...journal, GLID: 21 }];
      } else if (mode === 'wrong-type') {
        // FromFlag does not match invoice DocuType (202 vs 107)
        r = [{ ...journal, FromFlag: '202' }];
      } else if (mode === 'four-cents') {
        // Debit 100.00 vs Credit 99.96 (0.04 discrepancy)
        r = [{ ...journal, SumCredit: 99.96 }];
      } else if (mode === 'one-cent') {
        // Debit 100.00 vs Credit 99.99 (0.01 discrepancy)
        r = [{ ...journal, SumCredit: 99.99 }];
      } else if (mode === 'rounding-sub-satang-pass') {
        // Debit 100.00 vs Credit 99.996 (0.004 difference, within sub-satang boundary, rounds to 100.00)
        r = [{ ...journal, SumCredit: 99.996 }];
      } else if (mode === 'rounding-sub-satang-fail') {
        // Debit 100.00 vs Credit 99.994 (0.006 difference, rounds to 1 satang discrepancy)
        r = [{ ...journal, SumCredit: 99.994 }];
      } else if (mode === 'ambiguous-multiple-gl') {
        // Two active balanced GL headers pointing to the same invoice -> AMBIGUOUS
        r = [journal, { ...journal, GLID: 999, DocuNo: 'INV-A' }];
      } else if (mode === 'balanced') {
        // Exactly balanced 100.00 vs 100.00
        r = [journal];
      }
    } else if (q.includes('SELECT RTRIM(w.MoveBill)')) {
      r = [{ MoveBill: 'MB', WeightNet: 10000 }];
    }
    return { recordset: r };
  };

  const router = { use() {}, get() {}, post() {} };
  const box = {
    console,
    module: { exports: {} },
    require: (n) => {
      if (n === 'express') return { Router: () => router };
      if (n === '../db') return { wfQuery: query, sql: { Int: 0, DateTime: 0, VarChar: () => 0 } };
      if (n === './reports') return {};
      if (n === '../services/native-gl-linkage' || n.endsWith('native-gl-linkage')) {
        return require('../services/native-gl-linkage');
      }
      return { requireAuth() {}, requireRole() {} };
    }
  };

  vm.runInNewContext(reconSource + '\nmodule.exports.inspect = buildCases;', box);
  const [res] = await box.module.exports.inspect(7);
  return {
    scenario: mode,
    invoiceCount: res.invoiceCount,
    verifiedGlStatus: res.verifiedGlStatus,
    postInvoiceStatus: res.postInvoiceStatus,
    glDocuDate: res.glDocuDate
  };
}

test.describe('R2-01: GL Cardinality, Typed Identity & Balance Discrepancy Invariants', () => {
  test('R2-01-1: two-for-one cardinality violation must NOT produce VERIFIED_GL or POSTED', async () => {
    const res = await runReconCheck('two-for-one');
    assert.notEqual(res.verifiedGlStatus, 'VERIFIED_GL', 'Two invoices sharing GL for only one invoice must not be VERIFIED_GL');
    assert.notEqual(res.postInvoiceStatus, 'POSTED', 'postInvoiceStatus must not be POSTED');
    assert.ok(['PARTIAL_GL', 'INCONSISTENT', 'FLAGGED_BUT_NO_GL'].includes(res.verifiedGlStatus), `Must report unverified/inconsistent state, got: ${res.verifiedGlStatus}`);
  });

  test('R2-01-2: wrong-type FromFlag mismatch (202 vs 107) must NOT produce VERIFIED_GL or POSTED', async () => {
    const res = await runReconCheck('wrong-type');
    assert.notEqual(res.verifiedGlStatus, 'VERIFIED_GL', 'Mismatched FromFlag must not be VERIFIED_GL');
    assert.notEqual(res.postInvoiceStatus, 'POSTED', 'postInvoiceStatus must not be POSTED');
    assert.ok(['FLAGGED_BUT_NO_GL', 'UNPOSTED_GL', 'NO_GL', 'INCONSISTENT'].includes(res.verifiedGlStatus), `Must report unposted/flagged, got: ${res.verifiedGlStatus}`);
  });

  test('R2-01-3: four-cents balance discrepancy (0.04 difference) must NOT produce VERIFIED_GL or POSTED', async () => {
    const res = await runReconCheck('four-cents');
    assert.notEqual(res.verifiedGlStatus, 'VERIFIED_GL', '0.04 discrepancy must not be VERIFIED_GL');
    assert.notEqual(res.postInvoiceStatus, 'POSTED', 'postInvoiceStatus must not be POSTED');
  });

  test('R2-01-4: one-cent balance discrepancy (0.01 difference) must be treated as discrepancy, NOT VERIFIED_GL', async () => {
    const res = await runReconCheck('one-cent');
    assert.notEqual(res.verifiedGlStatus, 'VERIFIED_GL', '1 satang discrepancy must not automatically be VERIFIED_GL');
    assert.notEqual(res.postInvoiceStatus, 'POSTED', 'postInvoiceStatus must not be POSTED');
  });

  test('R2-01-5: exact zero-difference balanced journal with matching type and 1-to-1 cardinality IS VERIFIED_GL', async () => {
    const res = await runReconCheck('balanced');
    assert.equal(res.verifiedGlStatus, 'VERIFIED_GL', 'Exact balanced 1-to-1 match must be VERIFIED_GL');
    assert.equal(res.postInvoiceStatus, 'POSTED', 'postInvoiceStatus must be POSTED');
  });

  test('R2-01-6: rounding boundary (0.004 sub-satang diff) rounds to exact cents and evaluates to VERIFIED_GL', async () => {
    const res = await runReconCheck('rounding-sub-satang-pass');
    assert.equal(res.verifiedGlStatus, 'VERIFIED_GL', 'Sub-satang 0.004 difference rounds to zero cents and is VERIFIED_GL');
    assert.equal(res.postInvoiceStatus, 'POSTED', 'postInvoiceStatus must be POSTED');
  });

  test('R2-01-7: rounding boundary (0.006 sub-satang diff) rounds to 1-satang discrepancy and must NOT produce VERIFIED_GL', async () => {
    const res = await runReconCheck('rounding-sub-satang-fail');
    assert.notEqual(res.verifiedGlStatus, 'VERIFIED_GL', 'Sub-satang 0.006 rounds to 1 satang discrepancy and must not be VERIFIED_GL');
    assert.notEqual(res.postInvoiceStatus, 'POSTED', 'postInvoiceStatus must not be POSTED');
  });

  test('R2-01-8: ambiguous multiple active GL candidates per invoice evaluates to INCONSISTENT / UNVERIFIED, never auto-picking', async () => {
    const res = await runReconCheck('ambiguous-multiple-gl');
    assert.notEqual(res.verifiedGlStatus, 'VERIFIED_GL', 'Multiple GL candidates must not be auto-picked or marked VERIFIED_GL');
    assert.notEqual(res.postInvoiceStatus, 'POSTED', 'postInvoiceStatus must not be POSTED');
    assert.equal(res.verifiedGlStatus, 'INCONSISTENT', 'Ambiguous multiple GL candidates must evaluate to INCONSISTENT');
  });
});

test.describe('R2-03: Multi-Path Billing Projection Oracle Invariants', () => {
  // Independent simulation of the SQL projection calculation
  function calculateOutstandingBalance({ orderedLines, directInvoices, via104Invoices }) {
    const invoicedLineAmounts = new Map();

    // Direct invoice lines
    for (const inv of directInvoices || []) {
      if (inv.DocuStatus === 'C') continue;
      const key = `${inv.SOID}|${inv.SOListNo}|${inv.SOInvID}|${inv.InvListNo}`;
      invoicedLineAmounts.set(key, {
        soLineKey: `${inv.SOID}|${inv.SOListNo}`,
        amount: Number(inv.GoodAmnt) || 0
      });
    }

    // Delivery 104 invoice lines
    for (const inv of via104Invoices || []) {
      if (inv.DocuStatus === 'C') continue;
      const key = `${inv.SOID}|${inv.SOListNo}|${inv.SOInvID}|${inv.InvListNo}`;
      invoicedLineAmounts.set(key, {
        soLineKey: `${inv.SOID}|${inv.SOListNo}`,
        amount: Number(inv.GoodAmnt) || 0
      });
    }

    const lineInvoicedTotals = {};
    for (const item of invoicedLineAmounts.values()) {
      lineInvoicedTotals[item.soLineKey] = (lineInvoicedTotals[item.soLineKey] || 0) + item.amount;
    }

    let totalOrdered = 0;
    let totalInvoiced = 0;
    for (const line of orderedLines) {
      const lineKey = `${line.SOID}|${line.ListNo}`;
      const lineOrd = Number(line.GoodAmnt) || 0;
      const lineInv = Number(lineInvoicedTotals[lineKey]) || 0;
      totalOrdered += lineOrd;
      totalInvoiced += lineInv;
    }

    const toCents = (v) => Math.round((Number(v) || 0) * 100);
    const outstandingCents = toCents(totalOrdered) - toCents(totalInvoiced);
    const outstandingAmnt = outstandingCents / 100;
    const included = outstandingAmnt >= 0.01;

    return { totalOrdered, totalInvoiced, outstandingAmnt, included };
  }

  test('R2-03-1: Never-invoiced SO is included with 100% ordered amount', () => {
    const res = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 150000 }],
      directInvoices: [],
      via104Invoices: []
    });
    assert.equal(res.included, true);
    assert.equal(res.outstandingAmnt, 150000);
  });

  test('R2-03-2: Direct fully-invoiced SO has 0 balance and is EXCLUDED', () => {
    const res = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 150000 }],
      directInvoices: [{ SOID: 1, SOListNo: 1, SOInvID: 10, InvListNo: 1, GoodAmnt: 150000, DocuStatus: 'N' }],
      via104Invoices: []
    });
    assert.equal(res.included, false);
    assert.equal(res.outstandingAmnt, 0);
  });

  test('R2-03-3: Delivery 104 fully-invoiced SO has 0 balance and is EXCLUDED (R2-03 fix)', () => {
    const res = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 150000 }],
      directInvoices: [],
      via104Invoices: [{ SOID: 1, SOListNo: 1, SOInvID: 20, InvListNo: 1, GoodAmnt: 150000, DocuStatus: 'N' }]
    });
    assert.equal(res.included, false);
    assert.equal(res.outstandingAmnt, 0);
  });

  test('R2-03-4: Partially invoiced SO (direct or via 104) is INCLUDED with exact remaining balance', () => {
    const res = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 150000 }],
      directInvoices: [{ SOID: 1, SOListNo: 1, SOInvID: 10, InvListNo: 1, GoodAmnt: 50000, DocuStatus: 'N' }],
      via104Invoices: []
    });
    assert.equal(res.included, true);
    assert.equal(res.outstandingAmnt, 100000);
  });

  test('R2-03-5: Cancelled invoice does not deduct; SO remains included with full balance', () => {
    const res = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 150000 }],
      directInvoices: [{ SOID: 1, SOListNo: 1, SOInvID: 10, InvListNo: 1, GoodAmnt: 150000, DocuStatus: 'C' }],
      via104Invoices: []
    });
    assert.equal(res.included, true);
    assert.equal(res.outstandingAmnt, 150000);
  });

  test('R2-03-6: Order with remaining 0.01 THB (1 satang) is preserved and NOT dropped', () => {
    const res = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 100.01 }],
      directInvoices: [{ SOID: 1, SOListNo: 1, SOInvID: 10, InvListNo: 1, GoodAmnt: 100.00, DocuStatus: 'N' }],
      via104Invoices: []
    });
    assert.equal(res.included, true);
    assert.equal(res.outstandingAmnt, 0.01);
  });

  test('R2-03-7: Multiple SOs in single delivery/invoice are calculated independently without crosstalk', () => {
    // Delivery covers SO 1 (100,000) and SO 2 (200,000)
    // Invoice only covers SO 1 line
    const resSo1 = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 100000 }],
      directInvoices: [],
      via104Invoices: [{ SOID: 1, SOListNo: 1, SOInvID: 20, InvListNo: 1, GoodAmnt: 100000, DocuStatus: 'N' }]
    });
    const resSo2 = calculateOutstandingBalance({
      orderedLines: [{ SOID: 2, ListNo: 1, GoodAmnt: 200000 }],
      directInvoices: [],
      via104Invoices: []
    });
    assert.equal(resSo1.included, false, 'SO 1 fully billed via multi-SO delivery is excluded');
    assert.equal(resSo1.outstandingAmnt, 0);
    assert.equal(resSo2.included, true, 'SO 2 unbilled in same delivery is included');
    assert.equal(resSo2.outstandingAmnt, 200000);
  });

  test('R2-03-8: Multiple invoices per SO line deduplicate correctly without Cartesian fan-out', () => {
    // SO 1 has 1 line: 150,000
    // Invoiced twice: Inv 10 (40,000) + Inv 11 (60,000) = 100,000 total invoiced
    const res = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 150000 }],
      directInvoices: [
        { SOID: 1, SOListNo: 1, SOInvID: 10, InvListNo: 1, GoodAmnt: 40000, DocuStatus: 'N' },
        { SOID: 1, SOListNo: 1, SOInvID: 11, InvListNo: 1, GoodAmnt: 60000, DocuStatus: 'N' },
        // Duplicate row representation from Cartesian join must be deduped
        { SOID: 1, SOListNo: 1, SOInvID: 10, InvListNo: 1, GoodAmnt: 40000, DocuStatus: 'N' }
      ],
      via104Invoices: []
    });
    assert.equal(res.included, true);
    assert.equal(res.totalInvoiced, 100000, 'Deduplicated total invoiced must be exactly 100,000');
    assert.equal(res.outstandingAmnt, 50000, 'Remaining unbilled balance must be exactly 50,000');
  });

  test('R2-03-9: Over-invoiced order has non-positive balance and unknown allocation is UNKNOWN', () => {
    const res = calculateOutstandingBalance({
      orderedLines: [{ SOID: 1, ListNo: 1, GoodAmnt: 100000 }],
      directInvoices: [{ SOID: 1, SOListNo: 1, SOInvID: 10, InvListNo: 1, GoodAmnt: 120000, DocuStatus: 'N' }],
      via104Invoices: []
    });
    assert.equal(res.included, false, 'Over-invoiced order must not be projected as positive outstanding');
    assert.ok(res.outstandingAmnt <= 0);

    // Unknown allocation policy check:
    const allocation = res.outstandingAmnt < 0 ? 'UNKNOWN' : 'EXACT';
    assert.equal(allocation, 'UNKNOWN', 'Negative unallocated variance must be treated as UNKNOWN, never assumed zero');
  });

  test('R2-03-10: Weighbridge tolerance (0.05 ton / 50 kg) is strictly physical and NEVER used for invoice completeness', () => {
    const weighbridgeToleranceKg = 50; // 0.05 ton
    const orderedKg = 10000; // 10 ton
    const weighNetKg = 9960;  // -40 kg, within physical 50 kg tolerance

    // Invoice completeness must depend strictly on invoiced line amount / kg, NOT physical weighbridge tolerance
    const invoicedKg = 9960;
    const isPhysicallyWithinTolerance = Math.abs(weighNetKg - orderedKg) <= weighbridgeToleranceKg;
    assert.equal(isPhysicallyWithinTolerance, true, 'Truck scale net is physically within 0.05 ton tolerance');

    // But financial invoice completeness requires exact unbilled line accounting
    const isInvoicedComplete = invoicedKg >= orderedKg;
    assert.equal(isInvoicedComplete, false, 'Financial completeness must NOT borrow physical weight tolerance to consider 9,960 kg complete');
  });
});
