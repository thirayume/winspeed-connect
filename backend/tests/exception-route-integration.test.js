/**
 * exception-route-integration.test.js
 *
 * Route-level integration test verifying the HTTP export route
 * /api/reports/:type/export?format=xlsx against production Express router.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '../..');
const reportsRouter = require('../routes/reports');

const secret = process.env.JWT_SECRET || 'dev_secret_change_in_production';
const db = require('../db');
let server;
let baseUrl;
let token;

test.before(async () => {
  token = jwt.sign(
    { id: 2, username: 'emp-00002', role: 'SALES', mustChangePassword: false },
    secret,
    { expiresIn: '1h' }
  );

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    db.runWithTarget('remote_b', next);
  });
  app.use('/api/reports', reportsRouter);

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
  await Promise.allSettled([db.readerReady, db.ownerReady]);
  const pl = db.runWithTarget('remote_b', () => db.pools());
  await Promise.allSettled([
    db.readerPool.close(),
    db.ownerPool.close(),
    pl.readerPool.close(),
    pl.ownerPool.close()
  ]);
});

test.describe('Production Route Integration: /api/reports/:type/export', () => {
  test('ROUTE-01: Endpoint returns 200 with application/vnd.openxmlformats and valid workbook bytes', async () => {
    // Fetch export for so-sales-billing-projection
    const res = await fetch(`${baseUrl}/api/reports/so-sales-billing-projection/export?format=xlsx`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 200, 'HTTP status must be 200');
    assert.ok(
      res.headers.get('content-type').includes('openxmlformats'),
      'Must return openxmlformats Content-Type'
    );
    assert.ok(
      res.headers.get('content-disposition').includes('attachment'),
      'Must have attachment Content-Disposition'
    );

    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf[0], 0x50, 'Must be PK zip header 0');
    assert.equal(buf[1], 0x4B, 'Must be PK zip header 1');

    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets['Report'];
    assert.ok(sheet, 'Report sheet must exist');
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    assert.ok(aoa.length > 5, 'Must contain header and data rows');
  });
});
