/**
 * audit-regression-a01-a07.test.js
 *
 * Deterministic regression tests reproducing audit findings A01-A06 from CODEX-AUDIT-REVIEW-20260919.md:
 * - A01: Candidate plate/date match or IGNORED resolution must NOT qualify operationalReadiness or set readyForPostInvoice=true.
 * - A02: Cancelled GL header (DocuStatus='C') or wrong FromFlag must NOT become VERIFIED_GL, and cancelled DocuDate must not be glDocuDate.
 * - A03: SODT 104 join must not fan-out invoice lines or assign lines across multiple source SOs; PARTIAL_INVOICED must be assigned when partial.
 * - A05: GL report must not silently fall back outside requested date range or lack limits.
 * - A06: Billing projection must not double-count 103+104, must use DocuNo, and must restrict RBAC.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Helper to evaluate recon buildCases in sandbox with mock DB
function createReconSandbox(mockWfQuery) {
  const reconSource = fs.readFileSync(path.resolve(__dirname, '../routes/recon.js'), 'utf8');
  const router = { use() {}, get() {}, post() {} };
  const sandbox = {
    module: { exports: {} },
    console,
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../db') return { sql: { Int: 0, DateTime: 0, VarChar: () => 0, Decimal: () => 0 }, wfQuery: mockWfQuery };
      if (name === '../middleware/auth') return { requireAuth() {}, requireRole() { return () => {}; } };
      if (name === '../services/native-gl-linkage') return require('../services/native-gl-linkage');
      throw new Error(`Unexpected require: ${name}`);
    }
  };
  vm.runInNewContext(reconSource + '\nmodule.exports.auditBuildCases = buildCases;', sandbox);
  return sandbox.module.exports.auditBuildCases;
}

test.describe('A01: Operational Readiness & Legacy Ready Invariants', () => {

  test('A01-1: CANDIDATE_MATCH must be BLOCKED and readyForPostInvoice must be false', async () => {
    const buildCases = createReconSandbox(async (q) => {
      if (q.includes('SELECT TOP 500')) {
        return {
          recordset: [{
            SoId: '101', WsDocuNo: 'SO-CAND-01', ShipDate: '2026-09-19', TruckPlate: '70-1234',
            DocuStatus: 'N', AppvFlag: 'Y', WeighOutWeight: 15000, NetKg: 15000,
            WeighTicketStatus: 'DONE', Movebill: null
          }]
        };
      }
      if (q.includes('SELECT RTRIM(w.CarNo)')) {
        // TruckScale matched by plate and date only (candidate)
        return {
          recordset: [{
            CarNo: '70-1234', DateOut: new Date('2026-09-19'), WeightNet: 15000, MoveBill: 'MB-OTHER'
          }]
        };
      }
      if (q.includes('SELECT RTRIM(w.MoveBill)')) return { recordset: [] };
      if (q.includes('FROM dbo.SOInvDT')) return { recordset: [] };
      if (q.includes('FROM wf.ReconResolution')) return { recordset: [] };
      return { recordset: [] };
    });

    const cases = await buildCases(7);
    assert.equal(cases.length, 1);
    const c = cases[0];

    assert.equal(c.weigh, 'CANDIDATE_MATCH', 'Should be detected as candidate match');
    assert.equal(c.operationalReadiness, 'BLOCKED', 'Candidate match must NOT be QUALIFIED');
    assert.ok(c.readinessReasons.some(r => r.includes('ทะเบียน') || r.includes('ยังไม่ได้รับ')), 'Must state candidate match reason');
    assert.equal(c.readyForPostInvoice, false, 'Candidate match must never set readyForPostInvoice=true');
    assert.equal(c.postInvoiceStatus, 'UNVERIFIED', 'postInvoiceStatus must be UNVERIFIED');
  });

  test('A01-2: Administrative resolution (IGNORED or RESOLVED) must not certify unverified physical weighing', async () => {
    const buildCases = createReconSandbox(async (q) => {
      if (q.includes('SELECT TOP 500')) {
        return {
          recordset: [{
            SoId: '102', WsDocuNo: 'SO-RES-02', ShipDate: '2026-09-19', TruckPlate: '70-5678',
            DocuStatus: 'N', AppvFlag: 'Y', WeighOutWeight: 15000, NetKg: 15000,
            WeighTicketStatus: 'DONE', Movebill: 'MB-NONE'
          }]
        };
      }
      if (q.includes('SELECT RTRIM(w.MoveBill)')) return { recordset: [] }; // Missing in TruckScale
      if (q.includes('SELECT RTRIM(w.CarNo)')) return { recordset: [] };
      if (q.includes('FROM wf.ReconResolution')) {
        // Admin marked IGNORE on weighing exception
        return { recordset: [{ SoId: '102', CheckType: 'WEIGH', Status: 'IGNORED', Note: 'Admin override' }] };
      }
      if (q.includes('FROM dbo.SOInvDT')) return { recordset: [] };
      return { recordset: [] };
    });

    const cases = await buildCases(7);
    assert.equal(cases.length, 1);
    const c = cases[0];

    assert.equal(c.weigh, 'TS_NOT_FOUND');
    // Administrative resolution must not falsify missing physical evidence into QUALIFIED
    assert.equal(c.operationalReadiness, 'BLOCKED', 'Missing weigh evidence must remain BLOCKED despite IGNORED resolution');
    assert.equal(c.readyForPostInvoice, false, 'Missing weigh evidence must NOT be readyForPostInvoice');
  });
});

test.describe('A02: Native GL Verification Invariants', () => {

  test('A02-1: Cancelled GL header (DocuStatus=C) or invalid FromFlag must NOT be VERIFIED_GL', async () => {
    const buildCases = createReconSandbox(async (q) => {
      if (q.includes('SELECT TOP 500')) {
        return {
          recordset: [{
            SoId: '201', WsDocuNo: 'SO-GL-01', ShipDate: '2026-09-19', TruckPlate: '70-9999',
            DocuStatus: 'N', AppvFlag: 'Y', WeighOutWeight: 15000, NetKg: 15000,
            WeighTicketStatus: 'DONE', Movebill: 'MB-201'
          }]
        };
      }
      if (q.includes('SELECT RTRIM(w.MoveBill)')) return { recordset: [{ MoveBill: 'MB-201', WeightNet: 15000 }] };
      if (q.includes('FROM dbo.SOInvDT')) {
        return {
          recordset: [{
            SoId: '201', SOInvID: 501, DocuNo: 'INV-201', DocuType: 107, DocuStatus: 'N',
            PostID: 701, PostGL: 'Y', PostGLDate: null, LineQtyTon: 15, LineAmnt: 150000,
            Provenance: 'PRIMARY_103_LINE'
          }]
        };
      }
      if (q.includes('FROM dbo.GLHD')) {
        // GLHD header has DocuStatus='C' (cancelled) and wrong FromFlag
        return {
          recordset: [{
            GLID: 991, JourID: '1001', DocuNo: 'INV-201', DocuDate: '2026-09-18',
            FromID: 701, FromFlag: 'WRONG_FLAG', TotaAmnt: 150000, DocuStatus: 'C',
            LineCount: 2, SumDebit: 150000, SumCredit: 150000
          }]
        };
      }
      if (q.includes('FROM wf.ReconResolution')) return { recordset: [] };
      return { recordset: [] };
    });

    const cases = await buildCases(7);
    assert.equal(cases.length, 1);
    const c = cases[0];

    assert.notEqual(c.verifiedGlStatus, 'VERIFIED_GL', 'Cancelled GL header must not produce VERIFIED_GL');
    assert.equal(c.glDocuDate, null, 'Cancelled GL header date must NOT be emitted as glDocuDate');
    assert.notEqual(c.overall, 'OK', 'Case with cancelled GL must not be OK');
  });
});

test.describe('A03: Delivery Join Fan-Out & Partial Invoice Invariants', () => {

  test('A03-1: Partial invoiced quantity must set invoiceStatus = PARTIAL_INVOICED', async () => {
    const buildCases = createReconSandbox(async (q) => {
      if (q.includes('SELECT TOP 500')) {
        return {
          recordset: [{
            SoId: '301', WsDocuNo: 'SO-PARTIAL-01', ShipDate: '2026-09-19', TruckPlate: '70-1111',
            DocuStatus: 'N', AppvFlag: 'Y', WeighOutWeight: 20000, NetKg: 20000,
            WeighTicketStatus: 'DONE', Movebill: 'MB-301',
            TotalOrderedQtyTon: 20.0 // Ordered 20 tons
          }]
        };
      }
      if (q.includes('SELECT RTRIM(w.MoveBill)')) return { recordset: [{ MoveBill: 'MB-301', WeightNet: 20000 }] };
      if (q.includes('FROM dbo.SOInvDT')) {
        // Only 10 tons invoiced out of 20 tons ordered
        return {
          recordset: [{
            SoId: '301', SOInvID: 601, DocuNo: 'INV-301', DocuType: 107, DocuStatus: 'N',
            PostID: 801, PostGL: 'N', PostGLDate: null, LineQtyTon: 10.0, LineAmnt: 100000,
            Provenance: 'PRIMARY_103_LINE'
          }]
        };
      }
      if (q.includes('FROM wf.ReconResolution')) return { recordset: [] };
      return { recordset: [] };
    });

    const cases = await buildCases(7);
    assert.equal(cases.length, 1);
    const c = cases[0];

    assert.equal(c.invoiceStatus, 'PARTIAL_INVOICED', 'When invoiced quantity < ordered quantity, invoiceStatus must be PARTIAL_INVOICED');
  });
});

test.describe('A05 & A06: Report Boundaries & RBAC', () => {

  test('A05-1: GL sales journal must not silently fall back outside requested date range', () => {
    const reportsSource = fs.readFileSync(path.resolve(__dirname, '../routes/reports.js'), 'utf8');
    assert.ok(!reportsSource.includes('SELECT TOP 50 gl.GLID, gl.DocuNo, CONVERT(VARCHAR(10), gl.DocuDate, 120) AS DocuDate,\n                 gl.JourID, ISNULL(jour.JourName, N\'รายวันขาย\') AS JourName,\n                 gl.DocuType, gl.FromID, gl.FromFlag, gl.DocuStatus, gl.TotaAmnt\n          FROM dbo.GLHD gl WITH (NOLOCK)\n          LEFT JOIN dbo.EMAccJour jour WITH (NOLOCK) ON jour.JourID = gl.JourID\n          WHERE gl.JourID = \'1001\'\n          ORDER BY gl.DocuDate DESC, gl.GLID DESC'),
      'Must NOT contain unconstrained historical fallback query');
    assert.ok(!reportsSource.includes('@d >= 365'), 'Must not remove date restriction when @d >= 365');
  });

  test('A06-1: Billing projection must restrict roles (deny WAREHOUSE)', () => {
    const reportsSource = fs.readFileSync(path.resolve(__dirname, '../routes/reports.js'), 'utf8');
    const roleMatch = reportsSource.match(/'so-sales-billing-projection':\s*([^,\n]+)/);
    assert.ok(roleMatch, 'so-sales-billing-projection must have role configuration');
    const roleDef = roleMatch[1].trim();
    assert.notEqual(roleDef, 'null', 'Billing projection must NOT be null (accessible to all authenticated users)');
    assert.ok(!roleDef.includes("'WAREHOUSE'"), 'Billing projection must not grant WAREHOUSE access to sales financial figures');
  });

  test('A06-2: Billing projection must project strictly DocuType=103 orders and deduct multi-path invoices (including via 104)', () => {
    const reportsSource = fs.readFileSync(path.resolve(__dirname, '../routes/reports.js'), 'utf8');
    const projMatch = reportsSource.match(/'so-sales-billing-projection':\s*\{[\s\S]*?sql:\s*`([\s\S]*?)`/);
    assert.ok(projMatch, 'Must find so-sales-billing-projection definition');
    const sql = projMatch[1];
    // Main projected table must be strictly DocuType 103 (never projecting 104 headers)
    assert.ok(sql.includes('h.DocuType = 103'), 'Billing projection must strictly project Sales Orders (DocuType = 103)');
    assert.ok(!sql.includes('h.DocuType IN (103, 104)'), 'Billing projection must not project 104 delivery orders as projected headers');
    // Must deduct invoices reached through delivery order 104 path (R2-03)
    assert.ok(sql.includes('hd104.DocuType = 104'), 'Billing projection must account for invoices reached via 104 delivery orders');
    assert.ok(sql.includes('OutstandingAmnt >= 0.01'), 'Billing projection must project outstanding unbilled balance down to 1 satang');
    assert.ok(sql.includes('DocuNo'), 'Billing projection must project primary DocuNo');
  });
});
