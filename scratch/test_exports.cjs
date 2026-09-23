const https = require('https');
const assert = require('node:assert/strict');

const API_BASE = 'https://api-test.thirayu.online/api';

function fetchBinary(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        buffer: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function run() {
  console.log('=== VERIFYING LIVE REPORT EXPORTS (XLSX) ===');
  const login = await fetchJson(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_accounting', password: 'W0rldF3rt' })
  });
  const token = login.data?.accessToken || login.data?.token;

  // 1. gl-sales-journal export
  const glXlsx = await fetchBinary(`${API_BASE}/reports/gl-sales-journal/export?days=60&format=xlsx`, token);
  console.log('GL Journal XLSX Status:', glXlsx.status, 'Size:', glXlsx.buffer.length, 'Type:', glXlsx.headers['content-type']);
  assert.equal(glXlsx.status, 200);
  assert.ok(glXlsx.buffer.length > 1000, 'XLSX should be non-empty');
  assert.equal(glXlsx.buffer.slice(0, 4).toString('hex'), '504b0304', 'Must be valid PK zip/xlsx file');

  // 2. so-sales-billing-projection export
  const projXlsx = await fetchBinary(`${API_BASE}/reports/so-sales-billing-projection/export?format=xlsx`, token);
  console.log('Projection XLSX Status:', projXlsx.status, 'Size:', projXlsx.buffer.length, 'Type:', projXlsx.headers['content-type']);
  assert.equal(projXlsx.status, 200);
  assert.ok(projXlsx.buffer.length > 1000, 'XLSX should be non-empty');
  assert.equal(projXlsx.buffer.slice(0, 4).toString('hex'), '504b0304', 'Must be valid PK zip/xlsx file');

  console.log('=== ALL EXPORT ASSERTIONS PASSED ===');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
