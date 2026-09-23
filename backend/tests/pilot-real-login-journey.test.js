/**
 * pilot-real-login-journey.test.js
 *
 * Real-login TEST journey verifying server-owned pilot assignment, token creation,
 * real report/export/recon access, password change flow, mutation denial, and
 * standard non-pilot workflow preservation.
 *
 * Adheres to CODEX-PILOT-RECOVERY-REAUDIT-20260920:
 * 1. Uses controlled TEST account (emp-00012) authenticated via real POST /api/auth/login.
 * 2. Validates server-signed JWT claims (role: 'REPORT_PILOT', isPilot: true).
 * 3. Uses server-issued token for real report GET/export and recon reads.
 * 4. Asserts explicit expected responses (not merely 'not 403').
 * 5. Proves mutation denial without header and with X-Reporting-Pilot: false.
 * 6. Verifies standard non-pilot account (emp-00045) remains outside pilot scope.
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

test.before(async () => {
  // Ensure DB connection is ready and assert target test database
  const { ready, readerPool } = pools();
  await ready;

  const targetCheck = await readerPool.request().query('SELECT DB_NAME() AS currentDb, @@SERVERNAME AS serverName');
  const currentDb = targetCheck.recordset[0]?.currentDb;
  const serverName = targetCheck.recordset[0]?.serverName;

  console.log(`\n======================================================================`);
  console.log(`[TEST INTEGRATION - LOCAL EXPRESS / TEST DB]`);
  console.log(`  Target SQL Host: [${serverName}]`);
  console.log(`  Target Database: [${currentDb}]`);
  console.log(`  Scope: Local Express integration with real auth/reports/recon routes.`);
  console.log(`         Not deployed browser acceptance.`);
  console.log(`======================================================================\n`);

  assert.ok(currentDb, 'Connected test database name must be resolved');
  assert.match(currentDb, /(test|dbwins_worldfert9)/i, `Database [${currentDb}] must be an authorized test target`);
  assert.notEqual(currentDb.toLowerCase(), 'master', 'Must not run integration tests against master DB');

  const app = express();
  app.use(express.json());

  // Mount global pilot boundary middleware (mirrors server.js)
  app.use(reportingPilotBoundary);

  // Mount production routers
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

test.describe('Real-Login Pilot Journey (Scope A)', () => {

  let pilotToken;
  let pilotUser;

  test('1. Real Login: Controlled account emp-00012 logs in and receives server-assigned pilot identity', async () => {
    // Configure server-assigned pilot identity for emp-00012
    process.env.REPORTING_PILOT_USERNAMES = 'emp-00012';

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'emp-00012',
        password: process.env.E2E_PASSWORD || 'W0rldF3rt',
      }),
    });

    assert.equal(loginRes.status, 200, 'Real login must succeed with 200');
    const loginData = await loginRes.json();
    assert.ok(loginData.accessToken, 'Must return accessToken');
    assert.ok(loginData.user, 'Must return user object');

    pilotToken = loginData.accessToken;
    pilotUser = loginData.user;

    // Verify client user object returned by server
    assert.equal(pilotUser.username, 'emp-00012');
    assert.equal(pilotUser.role, 'REPORT_PILOT', 'User role must be assigned REPORT_PILOT by server');
    assert.equal(pilotUser.isPilot, true, 'User isPilot claim must be true');

    // Verify decoded JWT token signature and claims
    const decoded = jwt.verify(pilotToken, SECRET);
    assert.equal(decoded.username, 'emp-00012');
    assert.equal(decoded.role, 'REPORT_PILOT', 'JWT token role must be REPORT_PILOT');
    assert.equal(decoded.isPilot, true, 'JWT token isPilot claim must be true');
    assert.equal(decoded.sub, 12, 'Subject must match user ID');
  });

  test('2. Real Report GET: Server-issued token can query so-sales-billing-projection', async () => {
    assert.ok(pilotToken, 'Must have active server-issued pilot token');
    const res = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'Report query must return 200');
    const data = await res.json();
    assert.equal(data.type, 'so-sales-billing-projection');
    assert.equal(typeof data.title, 'string');
    assert.ok(Array.isArray(data.columns), 'Columns array must be returned');
    assert.ok(Array.isArray(data.rows), 'Rows array must be returned');
    assert.ok(data.columns.some(c => c.key === 'AllocationStatus'), 'Must include AllocationStatus column');
    assert.ok(data.meta && typeof data.meta.returnedCount === 'number');
  });

  test('3. Real Report GET: Server-issued token can query gl-sales-journal', async () => {
    const res = await fetch(`${baseUrl}/api/reports/gl-sales-journal`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'GL journal query must return 200');
    const data = await res.json();
    assert.equal(data.type, 'gl-sales-journal');
    assert.ok(Array.isArray(data.columns));
    assert.ok(Array.isArray(data.rows));
  });

  test('4. Real Export: Server-issued token can export so-sales-billing-projection as XLSX', async () => {
    const res = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection/export`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'Export must return 200');
    const contentType = res.headers.get('content-type') || '';
    assert.ok(
      contentType.includes('spreadsheet') || contentType.includes('octet-stream') || contentType.includes('excel'),
      `Content-Type must be spreadsheet, got: ${contentType}`
    );

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    assert.ok(buffer.length > 1000, 'Exported workbook must be non-empty');
    // XLSX is a ZIP package starting with PK (0x50, 0x4B, 0x03, 0x04)
    assert.equal(buffer[0], 0x50, 'Must start with ZIP signature P');
    assert.equal(buffer[1], 0x4b, 'Must start with ZIP signature K');
  });

  test('5. Real Recon GET: Server-issued token can read recon cases', async () => {
    const res = await fetch(`${baseUrl}/api/recon/cases`, {
      headers: { 'Authorization': `Bearer ${pilotToken}` },
    });

    assert.equal(res.status, 200, 'Recon cases query must return 200');
    const data = await res.json();
    assert.ok(Array.isArray(data) || typeof data === 'object');
  });

  test('6. Real Password Flow: Server-issued token can access profile password update', async () => {
    const res = await fetch(`${baseUrl}/api/auth/profile/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
      },
      body: JSON.stringify({
        oldPassword: 'IntentionalWrongPassword123!',
        newPassword: 'IntentionalNewPassword123!',
      }),
    });

    // Explicit assertion: Must return 401 with 'รหัสผ่านเดิมไม่ถูกต้อง'
    // Proves request passed through pilot boundary into bcrypt verification in auth.js
    assert.equal(res.status, 401, 'Must reach auth handler and reject invalid old password');
    const data = await res.json();
    assert.equal(data.message, 'รหัสผ่านเดิมไม่ถูกต้อง');
  });

  test('7. Mutation Denial WITHOUT header: POST /api/recon/:soId/resolve is rejected with 403', async () => {
    const res = await fetch(`${baseUrl}/api/recon/999999/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
        // NO header sent
      },
      body: JSON.stringify({ docuNo: 'SO-PILOT-MUTATION', status: 'RESOLVED' }),
    });

    assert.equal(res.status, 403, 'Must return 403 Forbidden');
    const data = await res.json();
    assert.equal(data.code, 'REPORTING_PILOT_READ_ONLY');
    assert.match(data.message, /Reporting Pilot is strictly read-only/);
    assert.equal(data.method, 'POST');
    assert.equal(data.path, '/api/recon/999999/resolve');
  });

  test('8. Mutation Denial with X-Reporting-Pilot: false is STILL rejected with 403', async () => {
    const res = await fetch(`${baseUrl}/api/recon/999999/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pilotToken}`,
        'X-Reporting-Pilot': 'false', // Caller attempts to falsify pilot status
      },
      body: JSON.stringify({ docuNo: 'SO-PILOT-MUTATION-FALSE', status: 'RESOLVED' }),
    });

    assert.equal(res.status, 403, 'Must return 403 Forbidden');
    const data = await res.json();
    assert.equal(data.code, 'REPORTING_PILOT_READ_ONLY');
  });

  test('9. Mutation Denial for all business modules (SO, Trips, Coupons, Rebate)', async () => {
    const endpoints = [
      { method: 'POST', path: '/api/so', body: { custId: '1001', lines: [] } },
      { method: 'POST', path: '/api/trips', body: { tripDate: '2026-09-20' } },
      { method: 'POST', path: '/api/coupons', body: { couponCode: 'TEST2026' } },
      { method: 'POST', path: '/api/rebate/claims', body: { claimType: 'SPECIAL_ADJUST' } },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pilotToken}`,
        },
        body: JSON.stringify(ep.body),
      });

      assert.equal(res.status, 403, `Mutation ${ep.method} ${ep.path} must return 403`);
      const data = await res.json();
      assert.equal(data.code, 'REPORTING_PILOT_READ_ONLY');
    }
  });

  test('10. Non-Pilot Account Behavior: emp-00045 logs in as standard ACCOUNTING and is not blocked by boundary', async () => {
    // emp-00045 is NOT in REPORTING_PILOT_USERNAMES
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'emp-00045',
        password: process.env.E2E_PASSWORD || 'W0rldF3rt',
      }),
    });

    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.username, 'emp-00045');
    assert.equal(loginData.user.role, 'ACCOUNTING', 'Non-pilot user must retain native ACCOUNTING role');
    assert.equal(Boolean(loginData.user.isPilot), false, 'isPilot must be false for standard account');

    const normalToken = loginData.accessToken;
    const decoded = jwt.verify(normalToken, SECRET);
    assert.equal(decoded.role, 'ACCOUNTING');
    assert.equal(Boolean(decoded.isPilot), false);

    // 10a. Normal user can query report GET
    const repRes = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection`, {
      headers: { 'Authorization': `Bearer ${normalToken}` },
    });
    assert.equal(repRes.status, 200);

    // 10b. Normal user mutation reaches route handler (not blocked with REPORTING_PILOT_READ_ONLY)
    const mutRes = await fetch(`${baseUrl}/api/recon/999999/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${normalToken}`,
      },
      body: JSON.stringify({ docuNo: 'SO-ACC-MUTATION', status: 'RESOLVED' }),
    });

    const mutData = await mutRes.json();
    assert.notEqual(mutData.code, 'REPORTING_PILOT_READ_ONLY', 'Standard account must not be blocked by pilot boundary');
  });

});
