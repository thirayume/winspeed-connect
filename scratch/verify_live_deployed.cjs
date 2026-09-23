/**
 * verify_live_deployed.cjs
 *
 * Verifies live deployed backend on Hostinger TEST:
 * https://api-test.thirayu.online/api
 */

const https = require('https');
const assert = require('node:assert/strict');

const API_BASE = 'https://api-test.thirayu.online/api';

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log('=== VERIFYING LIVE HOSTINGER TEST DEPLOYMENT (ASSERTIVE PROBES) ===\n');

  // 1. Health check
  const health = await fetchJson(`${API_BASE}/health`);
  console.log('1. Health Check status:', health.status, health.data);
  assert.equal(health.status, 200, 'Health endpoint must return 200');

  // 2. Login as Accounting
  const loginAcc = await fetchJson(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_accounting', password: 'W0rldF3rt' })
  });
  console.log('2. Accounting Login Status:', loginAcc.status, 'User:', loginAcc.data?.user?.username, 'Role:', loginAcc.data?.user?.role);
  assert.equal(loginAcc.status, 200, 'Accounting login must succeed');
  const accToken = loginAcc.data?.accessToken || loginAcc.data?.token;
  assert.ok(accToken, 'Accounting access token must be present');

  // 3. Login as Warehouse
  const loginWh = await fetchJson(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'emp-00047', password: 'W0rldF3rt' })
  });
  console.log('3. Warehouse Login Status:', loginWh.status, 'Role:', loginWh.data?.user?.role);
  assert.equal(loginWh.status, 200, 'Warehouse login must succeed');
  const whToken = loginWh.data?.accessToken || loginWh.data?.token;
  assert.ok(whToken, 'Warehouse access token must be present');

  // 4. Recon Cases (Accounting)
  const reconCases = await fetchJson(`${API_BASE}/recon/cases?days=30`, {
    headers: { Authorization: `Bearer ${accToken}` }
  });
  console.log('4. Recon Cases Status:', reconCases.status, 'Count:', Array.isArray(reconCases.data) ? reconCases.data.length : 'not array');
  assert.equal(reconCases.status, 200, 'Recon cases must return 200');
  assert.ok(Array.isArray(reconCases.data), 'Recon cases must be an array');
  assert.ok(reconCases.data.length > 0, 'Recon cases should return data for 30 days');

  // Assert case invariants on all returned cases
  for (const c of reconCases.data) {
    assert.ok(['SHIPPED', 'NOT_SHIPPED', 'CANCELLED', 'UNKNOWN'].includes(c.fulfillmentStatus), `Invalid fulfillment: ${c.fulfillmentStatus}`);
    assert.ok(['INVOICE_FOUND', 'PARTIAL_INVOICED', 'NO_INVOICE', 'CANCELLED', 'CANDIDATE_INVOICE'].includes(c.invoiceStatus), `Invalid invoiceStatus: ${c.invoiceStatus}`);
    assert.ok(['VERIFIED_GL', 'UNPOSTED_GL', 'FLAGGED_BUT_NO_GL', 'INCONSISTENT', 'NO_GL', 'PARTIAL_GL'].includes(c.verifiedGlStatus), `Invalid GL status: ${c.verifiedGlStatus}`);
    assert.ok(['QUALIFIED', 'BLOCKED'].includes(c.operationalReadiness), `Invalid readiness: ${c.operationalReadiness}`);
    assert.equal(c.readyForPostInvoice, false, 'readyForPostInvoice must be false while native contract is unverified');
    if (c.verifiedGlStatus !== 'VERIFIED_GL') {
      assert.equal(c.glDocuDate, null, `glDocuDate must be null for unverified GL: ${c.soDocuNo || c.soId}`);
    }
  }

  // 5. Recon Summary
  const reconSummary = await fetchJson(`${API_BASE}/recon/summary?days=30`, {
    headers: { Authorization: `Bearer ${accToken}` }
  });
  console.log('5. Recon Summary Status:', reconSummary.status, reconSummary.data);
  assert.equal(reconSummary.status, 200, 'Recon summary must return 200');
  assert.ok(typeof reconSummary.data?.total === 'number', 'Summary total must be numeric');
  assert.equal(reconSummary.data?.readyForPostInvoice, 0, 'readyForPostInvoice summary count must be 0');

  // 6. GL Sales Journal (Accounting)
  const glReport = await fetchJson(`${API_BASE}/reports/gl-sales-journal?days=60`, {
    headers: { Authorization: `Bearer ${accToken}` }
  });
  console.log('6. GL Sales Journal Status:', glReport.status, 'Rows:', glReport.data?.rows?.length, 'Meta:', glReport.data?.meta);
  assert.equal(glReport.status, 200, 'GL sales journal must return 200');
  assert.equal(glReport.data?.type, 'gl-sales-journal');
  assert.ok(Array.isArray(glReport.data?.rows), 'GL journal rows must be array');
  assert.equal(glReport.data?.meta?.limit, 50, 'GL journal meta limit must be 50');

  // Verify journal double-entry balance (Dr = Cr within 0.01)
  const journals = {};
  for (const row of glReport.data?.rows || []) {
    const key = String(row.GLID || row.JournalNo);
    if (!journals[key]) journals[key] = [];
    journals[key].push(row);
  }
  for (const [jKey, lines] of Object.entries(journals)) {
    const sumDr = lines.reduce((s, l) => s + Number(l.Debit || 0), 0);
    const sumCr = lines.reduce((s, l) => s + Number(l.Credit || 0), 0);
    assert.ok(Math.abs(sumDr - sumCr) < 0.01, `Journal ${jKey} must be balanced: Dr=${sumDr}, Cr=${sumCr}`);
  }

  // 7. SO Sales Billing Projection
  const projReport = await fetchJson(`${API_BASE}/reports/so-sales-billing-projection`, {
    headers: { Authorization: `Bearer ${accToken}` }
  });
  console.log('7. SO Billing Projection Status:', projReport.status, 'Rows:', projReport.data?.rows?.length);
  assert.equal(projReport.status, 200, 'Billing projection must return 200');
  assert.equal(projReport.data?.type, 'so-sales-billing-projection');
  if (projReport.data?.rows?.length > 0) {
    const first = projReport.data.rows[0];
    assert.ok(first.DocuNo, 'Projection must have DocuNo');
    assert.ok(first.Note.includes('ไม่ใช่หลักฐาน GL'), 'Projection note must have non-GL disclaimer');
  }

  // 8. RBAC: Warehouse denied on recon cases (expected 403)
  const whRecon = await fetchJson(`${API_BASE}/recon/cases`, {
    headers: { Authorization: `Bearer ${whToken}` }
  });
  console.log('8. RBAC Recon Cases (Warehouse expected 403):', whRecon.status);
  assert.equal(whRecon.status, 403, 'Warehouse must be denied (403) on recon cases');

  // 9. RBAC: Warehouse denied on GL Sales Journal (expected 403)
  const whGL = await fetchJson(`${API_BASE}/reports/gl-sales-journal`, {
    headers: { Authorization: `Bearer ${whToken}` }
  });
  console.log('9. RBAC GL Sales Journal (Warehouse expected 403):', whGL.status);
  assert.equal(whGL.status, 403, 'Warehouse must be denied (403) on GL sales journal');

  // 10. RBAC: Warehouse denied on SO Sales Billing Projection (expected 403)
  const whProj = await fetchJson(`${API_BASE}/reports/so-sales-billing-projection`, {
    headers: { Authorization: `Bearer ${whToken}` }
  });
  console.log('10. RBAC Billing Projection (Warehouse expected 403):', whProj.status);
  assert.equal(whProj.status, 403, 'Warehouse must be denied (403) on billing projection');

  // 11. RBAC & Fail-Closed Gate: native posting disabled
  const accGate = await fetchJson(`${API_BASE}/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accToken}` },
    body: JSON.stringify({ reservationId: 999999 })
  });
  console.log('11a. Native Posting RBAC (Accounting expected 403):', accGate.status, accGate.data?.message);
  assert.equal(accGate.status, 403, 'Accounting must be denied 403 on post-native');

  const whGate = await fetchJson(`${API_BASE}/coupons/post-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${whToken}` },
    body: JSON.stringify({ reservationId: 999999 })
  });
  console.log('11b. Native Posting Gate Status (Warehouse expected 400):', whGate.status, whGate.data?.message);
  assert.equal(whGate.status, 400, 'Native posting gate must fail-closed (400)');
  assert.ok(whGate.data?.message?.includes('COUPON_NATIVE_POSTING_ENABLED=false'), 'Must enforce COUPON_NATIVE_POSTING_ENABLED=false');

  console.log('\n=== LIVE VERIFICATION PASSED: ALL 12 ASSERTIONS SUCCEEDED ===');
}

main().catch(err => {
  console.error('\n❌ LIVE VERIFICATION ASSERTION FAILED:', err);
  process.exit(1);
});
