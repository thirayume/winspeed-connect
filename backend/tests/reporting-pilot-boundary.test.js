/**
 * reporting-pilot-boundary.test.js
 *
 * Automated negative authorization and positive real-route integration tests
 * verifying the server-side Reporting Pilot boundary (Scope A).
 *
 * Adheres to CODEX-PILOT-BOUNDARY-AUDIT-20260920:
 * 1. Server-owned pilot identity: verified via server assignment, not client headers.
 * 2. Real routes: tests real report GETs, real exports, and real recon reads.
 * 3. Mutation denial: rejects mutations even if header is omitted or X-Reporting-Pilot: false.
 * 4. Required password/session operations permitted explicitly.
 * 5. Normal non-pilot TEST operations preserved.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { SECRET } = require('../middleware/auth');
const { reportingPilotBoundary } = require('../middleware/reporting-pilot');
const authRouter = require('../routes/auth');
const reportsRouter = require('../routes/reports');
const reconRouter = require('../routes/recon');
const soRouter = require('../routes/so');
const tripsRouter = require('../routes/trips');
const couponsRouter = require('../routes/coupons');
const rebateRouter = require('../routes/rebate');
const { pools } = require('../db');

let server;
let baseUrl;

function makeToken(role, id = 63, username = 'pilot_auditor', isPilot = false) {
  return jwt.sign(
    { sub: id, id, role, username, isPilot, mustChangePassword: false },
    SECRET,
    { expiresIn: '1h' }
  );
}

test.before(async () => {
  const { ready } = pools();
  await ready;

  const app = express();
  app.use(express.json());

  // Global pilot boundary middleware (matches server.js mounting)
  app.use(reportingPilotBoundary);

  // Mount real application routers
  app.use('/api/auth', authRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/recon', reconRouter);
  app.use('/api/so', soRouter);
  app.use('/api/trips', tripsRouter);
  app.use('/api/coupons', couponsRouter);
  app.use('/api/rebate', rebateRouter);

  await new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  try {
    const { readerPool, ownerPool } = pools();
    if (readerPool) await readerPool.close();
    if (ownerPool) await ownerPool.close();
  } catch {}
});

test.describe('Reporting Pilot Boundary & Real Routes (Scope A)', () => {

  test('1. Real GET: REPORT_PILOT can retrieve report types catalog', async () => {
    const pilotToken = makeToken('REPORT_PILOT');
    const res = await fetch(`${baseUrl}/api/reports/types`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'Catalog query must succeed with 200');
    const types = await res.json();
    assert.ok(Array.isArray(types), 'Types must be an array');
    const keys = types.map(t => t.key);
    assert.ok(keys.includes('gl-sales-journal'), 'Catalog must include gl-sales-journal for REPORT_PILOT');
    assert.ok(keys.includes('so-sales-billing-projection'), 'Catalog must include so-sales-billing-projection for REPORT_PILOT');
  });

  test('2. Real GET: REPORT_PILOT can read real so-sales-billing-projection report', async () => {
    const pilotToken = makeToken('REPORT_PILOT');
    const res = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'Real report GET must return 200');
    const data = await res.json();
    assert.equal(data.type, 'so-sales-billing-projection');
    assert.ok(Array.isArray(data.columns), 'Columns must be defined');
    assert.ok(Array.isArray(data.rows), 'Rows must be defined');
    assert.ok(data.meta && typeof data.meta.returnedCount === 'number');
  });

  test('3. Real GET: REPORT_PILOT can read real gl-sales-journal report', async () => {
    const pilotToken = makeToken('REPORT_PILOT');
    const res = await fetch(`${baseUrl}/api/reports/gl-sales-journal`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'Real GL report GET must return 200');
    const data = await res.json();
    assert.equal(data.type, 'gl-sales-journal');
    assert.ok(Array.isArray(data.columns));
    assert.ok(Array.isArray(data.rows));
  });

  test('4. Real Export: REPORT_PILOT can export so-sales-billing-projection', async () => {
    const pilotToken = makeToken('REPORT_PILOT');
    const res = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection/export`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'Export route must return 200');
    const contentType = res.headers.get('content-type') || '';
    assert.ok(
      contentType.includes('spreadsheet') || contentType.includes('octet-stream') || contentType.includes('excel'),
      `Export must return spreadsheet content-type, got: ${contentType}`
    );
  });

  test('5. Real GET: REPORT_PILOT can read real recon summary and cases', async () => {
    const pilotToken = makeToken('REPORT_PILOT');
    const res = await fetch(`${baseUrl}/api/recon/cases`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'Real recon cases GET must return 200');
    const data = await res.json();
    assert.ok(Array.isArray(data) || typeof data === 'object');
  });

  test('6. Password management: PUT /api/auth/profile/password is NOT blocked by pilot boundary', async () => {
    const pilotToken = makeToken('REPORT_PILOT');
    const res = await fetch(`${baseUrl}/api/auth/profile/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
      },
      body: JSON.stringify({ oldPassword: 'wrong-password', newPassword: 'new-password' }),
    });

    // We expect it NOT to be rejected by reportingPilotBoundary (which gives 403 REPORTING_PILOT_READ_ONLY)
    // It should proceed to auth route handler and return 401 (wrong old password) or 404
    assert.notEqual(res.status, 403, 'Must not be blocked by reportingPilotBoundary');
    const body = await res.json();
    assert.notEqual(body.code, 'REPORTING_PILOT_READ_ONLY', 'Password change must be permitted through pilot boundary');
  });

  test('7. Mutation denial WITHOUT header: POST /api/recon/:soId/resolve is rejected with 403', async () => {
    const pilotToken = makeToken('REPORT_PILOT');
    const res = await fetch(`${baseUrl}/api/recon/999999/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
        // Note: NO X-Reporting-Pilot header sent
      },
      body: JSON.stringify({ docuNo: 'SO-TEST-01', status: 'RESOLVED', note: 'Test mutation' }),
    });

    assert.equal(res.status, 403, 'Must return 403');
    const body = await res.json();
    assert.equal(body.code, 'REPORTING_PILOT_READ_ONLY');
    assert.match(body.message, /Reporting Pilot is strictly read-only/);
    assert.equal(body.path, '/api/recon/999999/resolve');
  });

  test('8. Mutation denial with X-Reporting-Pilot: false is STILL rejected with 403', async () => {
    // Client attempts to bypass server pilot assignment by explicitly passing false
    const pilotToken = makeToken('REPORT_PILOT');
    const res = await fetch(`${baseUrl}/api/recon/999999/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
        'X-Reporting-Pilot': 'false', // Caller-controlled falsification must have NO effect
      },
      body: JSON.stringify({ docuNo: 'SO-TEST-02', status: 'RESOLVED', note: 'Bypass probe' }),
    });

    assert.equal(res.status, 403, 'Server identity must override client header');
    const body = await res.json();
    assert.equal(body.code, 'REPORTING_PILOT_READ_ONLY');
  });

  test('9. Business mutations (SO, Trips, Coupons, Rebate) are strictly rejected with 403', async () => {
    const pilotToken = makeToken('REPORT_PILOT');
    const mutationRequests = [
      { method: 'POST', path: '/api/so', body: { custId: '1001', lines: [] } },
      { method: 'POST', path: '/api/trips', body: { tripDate: '2026-09-20' } },
      { method: 'POST', path: '/api/coupons', body: { couponCode: 'TEST2026' } },
      { method: 'POST', path: '/api/rebate/claims', body: { claimType: 'SPECIAL_ADJUST' } },
    ];

    for (const req of mutationRequests) {
      const res = await fetch(`${baseUrl}${req.path}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pilotToken}`,
        },
        body: JSON.stringify(req.body),
      });

      assert.equal(res.status, 403, `Mutation ${req.method} ${req.path} must return 403`);
      const body = await res.json();
      assert.equal(body.code, 'REPORTING_PILOT_READ_ONLY');
    }
  });

  test('10. Standard non-pilot workflow is preserved: ACCOUNTING token is not blocked by boundary', async () => {
    const accountingToken = makeToken('ACCOUNTING', 99, 'somchai_acc', false);
    
    // 10a: Normal report query works
    const resGet = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection`, {
      headers: { 'Authorization': `Bearer ${accountingToken}` },
    });
    assert.equal(resGet.status, 200);

    // 10b: Normal mutation reaches business logic handler (not blocked by reportingPilotBoundary)
    const resPost = await fetch(`${baseUrl}/api/recon/999999/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accountingToken}`,
      },
      body: JSON.stringify({ docuNo: 'SO-TEST-ACC', status: 'RESOLVED', note: 'Standard flow' }),
    });

    // The handler will execute (may fail on missing DB record 400/404/500, but NEVER 403 REPORTING_PILOT_READ_ONLY)
    const body = await resPost.json();
    assert.notEqual(body.code, 'REPORTING_PILOT_READ_ONLY', 'Accounting mutation must not be blocked by pilot boundary');
  });

  test('11. Server-owned pilot assignment: server configuration enforces pilot scope on designated usernames', async () => {
    // Verify server-side username assignment
    process.env.REPORTING_PILOT_USERNAMES = 'pilot_reviewer,pilot_auditor';
    const designatedUserToken = makeToken('ACCOUNTING', 77, 'pilot_reviewer', false);
    
    // Attempting mutation without any pilot header must be rejected because server assigned pilot scope
    const res = await fetch(`${baseUrl}/api/recon/999999/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${designatedUserToken}`,
      },
      body: JSON.stringify({ docuNo: 'SO-TEST-PILOT-USER', status: 'RESOLVED' }),
    });

    assert.equal(res.status, 403, 'Server configuration must enforce pilot read-only boundary on designated username');
    const body = await res.json();
    assert.equal(body.code, 'REPORTING_PILOT_READ_ONLY');
    delete process.env.REPORTING_PILOT_USERNAMES;
  });

});
