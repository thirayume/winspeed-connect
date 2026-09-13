// Verification script for Hostinger Test live reports endpoint & RBAC
const BASE = process.env.API_BASE || 'https://api-test.thirayu.online/api';
const PW = process.env.E2E_PASSWORD || 'W0rldF3rt';

async function request(path, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { headers });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, data: json };
}

async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (res.status !== 200) {
    throw new Error(`Login failed for ${username}: ${JSON.stringify(data)}`);
  }
  return data.accessToken;
}

async function run() {
  console.log(`Connecting to ${BASE}...`);
  
  // 1. Log in with admin, manager, sales
  console.log('Testing authentication...');
  const adminToken = await login('admin', PW);
  console.log('✓ Admin login successful');
  const managerToken = await login('emp-00021', PW);
  console.log('✓ Manager (emp-00021) login successful');
  const salesToken = await login('emp-00002', PW);
  console.log('✓ Sales (emp-00002) login successful');

  // 2. Fetch reports types for Admin (should see all 23)
  console.log('\nTesting GET /reports/types...');
  const typesRes = await request('/reports/types', adminToken);
  if (typesRes.status !== 200) {
    console.error('Failed to get types:', typesRes.status, typesRes.data);
    process.exit(1);
  }
  const allTypes = typesRes.data;
  console.log(`✓ Admin sees ${allTypes.length} reports in catalog (Expected 23)`);
  if (allTypes.length !== 23) {
    throw new Error(`Expected 23 reports for admin, got ${allTypes.length}`);
  }

  // Fetch reports types for Sales (should only see reports they have access to)
  const salesTypesRes = await request('/reports/types', salesToken);
  const salesTypes = salesTypesRes.data;
  console.log(`✓ Sales sees ${salesTypes.length} reports in catalog (RBAC filtered)`);
  if (salesTypes.find(t => t.key === 'ar-aging-summary')) {
    throw new Error('Sales should NOT have ar-aging-summary in types catalog!');
  }
  if (!salesTypes.find(t => t.key === 'so-status')) {
    throw new Error('Sales should have so-status in types catalog!');
  }

  // 3. Inspect report details & column contracts across all 23 reports via Admin
  console.log('\nValidating column contracts across reports...');
  let totalColumns = 0;
  let identifierCols = 0;
  let quantityCols = 0;

  for (const item of allTypes) {
    const repRes = await request(`/reports/${item.key}`, adminToken);
    if (repRes.status !== 200) {
      throw new Error(`Failed to load report ${item.key}: HTTP ${repRes.status}`);
    }
    const report = repRes.data;
    if (!report.columns || !Array.isArray(report.columns) || report.columns.length === 0) {
      throw new Error(`Report ${item.key} missing columns array!`);
    }
    totalColumns += report.columns.length;
    for (const col of report.columns) {
      if (!col.type) throw new Error(`Column ${col.key} in ${item.key} missing type!`);
      if (col.type === 'identifier') identifierCols++;
      if (col.type === 'quantity') {
        quantityCols++;
        if (col.precision !== 3) throw new Error(`Quantity ${col.key} in ${item.key} precision is ${col.precision}, expected 3`);
      }
    }
  }
  console.log(`✓ Validated ${totalColumns} columns across all 23 reports (${identifierCols} identifiers, ${quantityCols} quantities with precision: 3)`);

  // 4. RBAC checks on individual report endpoints
  console.log('\nTesting RBAC on GET /reports/:type...');
  // Financial report 'ar-aging-summary' should be forbidden for pure sales
  const arSalesRes = await request('/reports/ar-aging-summary', salesToken);
  console.log(`✓ Sales accessing ar-aging-summary -> HTTP ${arSalesRes.status} (Expected 403)`);
  if (arSalesRes.status !== 403) {
    throw new Error(`Expected 403 for Sales on ar-aging-summary, got ${arSalesRes.status}`);
  }

  // Admin should be allowed on ar-aging-summary
  const arAdminRes = await request('/reports/ar-aging-summary', adminToken);
  console.log(`✓ Admin accessing ar-aging-summary -> HTTP ${arAdminRes.status} (Expected 200)`);
  if (arAdminRes.status !== 200) {
    throw new Error(`Expected 200 for Admin on ar-aging-summary, got ${arAdminRes.status}`);
  }

  // Sales should be allowed on customer-dispatch
  const dispatchSalesRes = await request('/reports/customer-dispatch', salesToken);
  console.log(`✓ Sales accessing customer-dispatch -> HTTP ${dispatchSalesRes.status} (Expected 200)`);
  if (dispatchSalesRes.status !== 200) {
    throw new Error(`Expected 200 for Sales on customer-dispatch, got ${dispatchSalesRes.status}`);
  }

  // Check columns metadata in customer-dispatch response
  if (dispatchSalesRes.data.columns) {
    const custCodeCol = dispatchSalesRes.data.columns.find(c => c.key === 'CustCode');
    console.log(`✓ customer-dispatch CustCode column metadata: type = ${custCodeCol?.type}`);
    if (custCodeCol?.type !== 'identifier') {
      throw new Error(`CustCode column type is ${custCodeCol?.type}, expected identifier`);
    }
  }

  // 5. Check XLSX export RBAC
  console.log('\nTesting RBAC on GET /reports/:type/export...');
  const expSalesAr = await request('/reports/ar-aging-summary/export', salesToken);
  console.log(`✓ Sales exporting ar-aging-summary to XLSX -> HTTP ${expSalesAr.status} (Expected 403)`);
  if (expSalesAr.status !== 403) {
    throw new Error(`Expected 403 for Sales exporting ar-aging-summary, got ${expSalesAr.status}`);
  }

  const expAdminAr = await request('/reports/ar-aging-summary/export', adminToken);
  console.log(`✓ Admin exporting ar-aging-summary to XLSX -> HTTP ${expAdminAr.status} (Expected 200)`);
  if (expAdminAr.status !== 200) {
    throw new Error(`Expected 200 for Admin exporting ar-aging-summary, got ${expAdminAr.status}`);
  }

  console.log('\n======================================================');
  console.log('ALL HOSTINGER TEST REPORTS & RBAC CHECKS PASSED 100%!');
  console.log('======================================================');
}

run().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
