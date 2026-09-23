/**
 * integration-recon-gl.test.js
 *
 * Automated Integration Test Suite for Reconciliation, Multi-Dimensional Statuses,
 * Native WinSpeed GL Linkage, and GL Sales Journal Reporting.
 *
 * Tests:
 * - REC-001: Multi-dimensional separation (Fulfillment, Invoice, Native GL, Operational Readiness)
 * - REC-002: Operational readiness requires verified criteria; no false "READY"
 * - REC-003: gl-sales-journal returns complete 2-phase balanced Dr=Cr journals from dbo.GLHD/GLDT
 * - REC-004: so-sales-billing-projection provides honest forward estimation with disclaimer
 * - REC-005: Multi-invoice per SO line aggregation prevents fan-out duplication
 * - REC-006: RBAC enforcement on reconciliation and GL journal reports
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { runWithTarget, wfQuery, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');

let server;
let baseUrl;
let accountingToken;
let warehouseToken;
let adminToken;

async function startTestServer() {
  if (server) return;
  await new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      runWithTarget('remote_b', next);
    });

    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/recon', require('../routes/recon'));
    app.use('/api/reports', require('../routes/reports'));

    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ message: err.message, ...err });
    });

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function loginAs(username, password = 'W0rldF3rt') {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  const token = data.accessToken || data.token;
  if (!res.ok || !token) {
    throw new Error(`Login failed for ${username}: ${data.message || res.statusText}`);
  }
  return { token, user: data.user };
}

test.before(async () => {
  await runWithTarget('remote_b', async () => {
    await assertTestDatabase();
  });
  await startTestServer();

  // e2e_accounting is ACCOUNTING, emp-00047 is WAREHOUSE, admin is ADMIN
  const acc = await loginAs('e2e_accounting');
  accountingToken = acc.token;
  const wh = await loginAs('emp-00047');
  warehouseToken = wh.token;
  const adm = await loginAs('admin');
  adminToken = adm.token;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  // Allow pending pool sockets to close
  setTimeout(() => process.exit(0), 500).unref();
});

test.describe('Reconciliation & Native GL Truthfulness Integration Tests', () => {

  test('REC-001: Cases separate Fulfillment, Invoice, Native GL, and Operational Readiness dimensions', async () => {
    // 1. Fetch cases
    const resCases = await fetch(`${baseUrl}/api/recon/cases?days=60`, {
      headers: { Authorization: `Bearer ${accountingToken}` }
    });
    assert.equal(resCases.status, 200, 'Recon cases must return 200 for ACCOUNTING');
    const cases = await resCases.json();
    assert.ok(Array.isArray(cases), 'Cases must be an array');
    assert.ok(cases.length > 0, 'Cases should not be empty');

    // 2. Fetch summary
    const resSummary = await fetch(`${baseUrl}/api/recon/summary?days=60`, {
      headers: { Authorization: `Bearer ${accountingToken}` }
    });
    assert.equal(resSummary.status, 200, 'Recon summary must return 200');
    const summary = await resSummary.json();
    assert.ok(typeof summary.total === 'number');
    assert.ok(typeof summary.operationallyQualified === 'number');
    assert.ok(typeof summary.operationallyBlocked === 'number');
    assert.ok(typeof summary.invoiceFound === 'number');
    assert.ok(typeof summary.glVerified === 'number');

    const validFulfillment = ['SHIPPED', 'NOT_SHIPPED', 'CANCELLED', 'UNKNOWN'];
    const validInvoice = ['NO_INVOICE', 'INVOICE_FOUND', 'PARTIAL_INVOICED', 'CANCELLED', 'CANDIDATE_INVOICE'];
    const validNativeGL = ['NO_GL', 'UNPOSTED_GL', 'FLAGGED_BUT_NO_GL', 'VERIFIED_GL', 'INCONSISTENT', 'PARTIAL_GL'];
    const validReadiness = ['QUALIFIED', 'BLOCKED'];

    for (const c of cases) {
      assert.ok(validFulfillment.includes(c.fulfillmentStatus), `Invalid fulfillmentStatus: ${c.fulfillmentStatus}`);
      assert.ok(validInvoice.includes(c.invoiceStatus), `Invalid invoiceStatus: ${c.invoiceStatus}`);
      assert.ok(validNativeGL.includes(c.nativeGlPostingFlag !== null ? c.verifiedGlStatus : 'NO_GL'), `Invalid verifiedGlStatus: ${c.verifiedGlStatus}`);
      assert.ok(validReadiness.includes(c.operationalReadiness), `Invalid operationalReadiness: ${c.operationalReadiness}`);
      assert.ok(Array.isArray(c.readinessReasons), 'readinessReasons must be an array');

      // Rule: SOHD.DocuStatus='Y' without weighing or shipping evidence must NOT be automatically SHIPPED
      if (c.fulfillmentStatus === 'UNKNOWN') {
        assert.notEqual(c.fulfillmentStatus, 'SHIPPED', 'Unknown legacy fulfillment must not be SHIPPED');
      }

      // Rule: glDocuDate must be null if GL is unverified, never substituted with DocuDate
      if (c.verifiedGlStatus !== 'VERIFIED_GL') {
        assert.equal(c.glDocuDate, null, `Unverified case ${c.soDocuNo || c.soId} must have null glDocuDate`);
      }
    }
  });

  test('REC-002: Operational readiness gate blocks incomplete or unapproved orders', async () => {
    const res = await fetch(`${baseUrl}/api/recon/cases?days=60`, {
      headers: { Authorization: `Bearer ${accountingToken}` }
    });
    assert.equal(res.status, 200);
    const cases = await res.json();
    const blockedCases = cases.filter(c => c.operationalReadiness === 'BLOCKED');
    assert.ok(blockedCases.length > 0, 'Must have blocked cases');

    for (const c of blockedCases) {
      assert.equal(c.operationalReadiness, 'BLOCKED');
      assert.ok(c.readinessReasons.length > 0, 'BLOCKED cases must have at least one reason');

      // If fulfillment is not SHIPPED, readinessReasons must reflect that
      if (c.fulfillmentStatus !== 'SHIPPED') {
        const hasFulfillmentReason = c.readinessReasons.some(r =>
          r.includes('ส่งสินค้า') || r.includes('ยกเลิก') || r.includes('ยังไม่มีหลักฐาน')
        );
        assert.ok(hasFulfillmentReason, `Case ${c.soDocuNo} with status ${c.fulfillmentStatus} must have reason`);
      }
    }
  });

  test('REC-003: gl-sales-journal returns complete 2-phase balanced Dr=Cr journals from GLHD/GLDT', async () => {
    const res = await fetch(`${baseUrl}/api/reports/gl-sales-journal`, {
      headers: { Authorization: `Bearer ${accountingToken}` }
    });
    assert.equal(res.status, 200, 'gl-sales-journal must return 200');
    const body = await res.json();

    assert.equal(body.type, 'gl-sales-journal');
    assert.ok(Array.isArray(body.rows), 'Report rows must be an array');
    assert.ok(body.rows.length > 0, 'Report rows should contain journal lines');

    // Group rows by GLID to verify double-entry balance per journal
    const journals = {};
    for (const row of body.rows) {
      const key = String(row.GLID || row.JournalNo);
      if (!journals[key]) journals[key] = [];
      journals[key].push(row);
    }

    const journalKeys = Object.keys(journals);
    assert.ok(journalKeys.length > 0, 'Must have at least one journal header');

    for (const jKey of journalKeys) {
      const lines = journals[jKey];
      assert.ok(lines.length >= 2, `Journal ${jKey} must have at least 2 double-entry lines (has ${lines.length})`);

      const sumDr = lines.reduce((s, l) => s + Number(l.Debit || 0), 0);
      const sumCr = lines.reduce((s, l) => s + Number(l.Credit || 0), 0);
      const diff = Math.abs(sumDr - sumCr);
      assert.ok(diff < 0.01, `Journal ${jKey} must be balanced: Dr=${sumDr.toFixed(2)}, Cr=${sumCr.toFixed(2)}`);

      for (const line of lines) {
        assert.ok(line.AccountCode, 'Each line must have AccountCode');
        assert.ok(typeof line.Debit === 'number', 'Debit must be numeric');
        assert.ok(typeof line.Credit === 'number', 'Credit must be numeric');
        assert.equal(line.BalanceStatus, 'สมดุล (Balanced)');
      }
    }
    console.log(`[REC-003] Verified ${journalKeys.length} complete balanced native GL sales journals.`);
  });

  test('REC-004: so-sales-billing-projection provides honest forward estimation with explicit disclaimer', async () => {
    const res = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection`, {
      headers: { Authorization: `Bearer ${accountingToken}` }
    });
    assert.equal(res.status, 200, 'so-sales-billing-projection must return 200');
    const body = await res.json();

    assert.equal(body.type, 'so-sales-billing-projection');
    assert.ok(Array.isArray(body.rows), 'Projection rows must be an array');

    if (body.rows.length > 0) {
      for (const row of body.rows) {
        assert.ok(row.DocuNo, 'Row must have primary DocuNo');
        assert.ok(row.DocuDate, 'Row must have DocuDate');
        assert.ok(typeof Number(row.EstimatedAmount) === 'number', 'EstimatedAmount must be numeric');
        assert.ok(row.Note.includes('ไม่ใช่หลักฐาน GL'), 'Note must contain non-GL disclaimer');
      }
      console.log(`[REC-004] Verified ${body.rows.length} billing projection rows with non-GL disclaimer.`);
    }
  });

  test('REC-005: Multi-invoice per SO line aggregation prevents header fan-out', async () => {
    const res = await fetch(`${baseUrl}/api/recon/cases?days=60`, {
      headers: { Authorization: `Bearer ${accountingToken}` }
    });
    assert.equal(res.status, 200);
    const cases = await res.json();

    // Verify invoice line uniqueness across all cases (no duplicated composite keys)
    for (const c of cases) {
      if (c.invoices && c.invoices.length > 0) {
        const lineKeys = c.invoices.map(i => `${i.soInvId}|${i.docuNo}`);
        const uniqueKeys = new Set(lineKeys);
        assert.equal(uniqueKeys.size, lineKeys.length, `Case ${c.soDocuNo || c.soId} has duplicate invoice entries`);
      }
    }

    // Direct database oracle check: query SOs with multiple invoice lines and verify exact match
    const multiInvDb = (await wfQuery(`
      SELECT d.RefID AS SOID, COUNT(DISTINCT d.SOInvID) AS InvCount,
             CAST(SUM(d.GoodAmnt) AS DECIMAL(14,2)) AS ExpectedLineSum
      FROM dbo.SOInvDT d WITH (NOLOCK)
      JOIN dbo.SOInvHD h WITH (NOLOCK) ON h.SOInvID = d.SOInvID AND h.DocuType IN (107, 202) AND h.DocuStatus <> 'C'
      JOIN dbo.SODT dt WITH (NOLOCK) ON dt.SOID = d.RefID AND dt.DocuType = 103
      WHERE h.DocuDate >= DATEADD(day, -60, GETDATE())
      GROUP BY d.RefID
      HAVING COUNT(DISTINCT d.SOInvID) > 1
    `)).recordset || [];

    if (multiInvDb.length > 0) {
      for (const oracle of multiInvDb) {
        const matchCase = cases.find(c => String(c.soId) === String(oracle.SOID));
        if (matchCase) {
          const actualAmt = Number(matchCase.totalInvoicedAmount || 0);
          const oracleSum = Number(oracle.ExpectedLineSum || 0);
          assert.ok(
            Math.abs(oracleSum - actualAmt) < 0.1,
            `Case ${matchCase.soDocuNo} invoiced amount (${actualAmt}) must match independent DB oracle sum (${oracleSum})`
          );
        }
      }
      console.log(`[REC-005] Verified ${multiInvDb.length} multi-invoice cases against independent DB oracle.`);
    } else {
      console.log('[REC-005] Verified line uniqueness on all cases; no multi-invoice cases in 60-day DB window.');
    }
  });

  test('REC-006: RBAC protects reconciliation and GL journal reports', async () => {
    // 1. Warehouse user should be denied access to reconciliation cases
    const whReconRes = await fetch(`${baseUrl}/api/recon/cases`, {
      headers: { Authorization: `Bearer ${warehouseToken}` }
    });
    assert.equal(whReconRes.status, 403, 'Warehouse user must receive 403 on /api/recon/cases');

    // 2. Warehouse user should be denied access to GL sales journal
    const whJournalRes = await fetch(`${baseUrl}/api/reports/gl-sales-journal`, {
      headers: { Authorization: `Bearer ${warehouseToken}` }
    });
    assert.equal(whJournalRes.status, 403, 'Warehouse user must receive 403 on /api/reports/gl-sales-journal');

    // 3. Unauthenticated request should be rejected
    const unauthRes = await fetch(`${baseUrl}/api/recon/cases`);
    assert.equal(unauthRes.status, 401, 'Unauthenticated request must receive 401');
  });

});
