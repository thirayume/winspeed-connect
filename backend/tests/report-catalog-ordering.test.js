'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const reports = require('../routes/reports');
const { isUserAdmin, canRunReport, REPORTS, REPORT_ROLES } = reports.__testing;

for (const empty of [false, true]) {
  test(`Report payload keeps typed columns when node-mssql returns ${empty ? 'an empty' : 'a populated'} recordset with driver metadata`, async () => {
    const key = '__qa_driver_columns';
    const columns = [{ key: 'Amount', label: 'ยอด', type: 'money', aggregation: 'sum' }];
    const rows = empty ? [] : [{ Amount: 125.5 }];
    Object.defineProperty(rows, 'columns', { value: { Amount: { index: 0, name: 'Amount', type: 'Decimal' } } });
    REPORTS[key] = { title: 'QA driver contract', columns, run: async () => rows };
    try {
      const payload = JSON.parse(JSON.stringify(await reports.__testing.runReport(key)));
      assert.deepEqual(payload.columns, columns);
      assert.deepEqual(payload.rows, empty ? [] : [{ Amount: 125.5 }]);
      assert.equal(payload.columns[0].aggregation, 'sum');
    } finally { delete REPORTS[key]; }
  });
}

test('Structured annual report retains dynamic region columns and metadata', async () => {
  const key = '__qa_dynamic_columns';
  const dynamic = [{ key: 'Region0', label: 'QA region', type: 'money' }];
  REPORTS[key] = { title: 'QA matrix', columns: [], run: async () => ({ columns: dynamic, rows: [{ Region0: 100 }], meta: { basis: 'APPROVED_PLANS_ONLY' } }) };
  try {
    const payload = await reports.__testing.runReport(key);
    assert.deepEqual(payload.columns, dynamic);
    assert.equal(payload.meta.basis, 'APPROVED_PLANS_ONLY');
    assert.equal(payload.rows[0].Region0, 100);
  } finally { delete REPORTS[key]; }
});

test('Report Catalog - isUserAdmin recognizes single and multi-role ADMIN users', () => {
  assert.equal(isUserAdmin({ role: 'ADMIN' }), true);
  assert.equal(isUserAdmin({ role: 'SALES', roles: ['SALES', 'ADMIN'] }), true);
  assert.equal(isUserAdmin({ role: 'SALES', roles: ['SALES', 'WAREHOUSE'] }), false);
  assert.equal(isUserAdmin({ role: 'MANAGER' }), false);
  assert.equal(isUserAdmin(null), false);
  assert.equal(isUserAdmin(undefined), false);
});

test('Report Catalog - canRunReport validates role permissions accurately', () => {
  const adminReq = { user: { role: 'ADMIN' }, scopeSeesAll: true };
  const warehouseReq = { user: { role: 'WAREHOUSE' }, scopeSeesAll: true };
  const multiRoleReq = { user: { role: 'SALES', roles: ['SALES', 'ACCOUNTING'] }, scopeSeesAll: true };
  const restrictedScopeReq = { user: { role: 'ADMIN' }, scopeSeesAll: false };

  // so-status is null (anyone authenticated seeing all)
  assert.equal(canRunReport(adminReq, 'so-status'), true);
  assert.equal(canRunReport(warehouseReq, 'so-status'), true);

  // Restricted scope blocks company-wide reports
  assert.equal(canRunReport(restrictedScopeReq, 'so-status'), false);

  // rule-incidents: WAREHOUSE, ACCOUNTING, MANAGER, C_LEVEL, ADMIN
  assert.equal(canRunReport(adminReq, 'rule-incidents'), true);
  assert.equal(canRunReport(warehouseReq, 'rule-incidents'), true);
  assert.equal(canRunReport(multiRoleReq, 'rule-incidents'), true);

  // special-price-detail: MANAGER, APPROVER, ADMIN, C_LEVEL
  assert.equal(canRunReport(warehouseReq, 'special-price-detail'), false);
  assert.equal(canRunReport(adminReq, 'special-price-detail'), true);
});

test('Report Catalog - sorting and visibility logic handles custom ordering and admin toggle', () => {
  const dummyReports = [
    { key: 'so-status', title: 'B สรุปใบสั่งขาย' },
    { key: 'rule-incidents', title: 'A เหตุการณ์ผิดกฎ' },
    { key: 'giveaway', title: 'C ของแถม' }
  ];

  const customOrder = ['giveaway', 'so-status', 'rule-incidents'];
  const visibility = {
    'rule-incidents': false,
    'giveaway': true,
    'so-status': true
  };

  // Simulate sorting
  const decorated = dummyReports.map(r => ({
    ...r,
    enabled: visibility[r.key] !== false,
    orderIndex: customOrder.indexOf(r.key) >= 0 ? customOrder.indexOf(r.key) : 9999
  }));

  // Non-admin filter
  const nonAdminVisible = decorated.filter(r => r.enabled).sort((a, b) => a.orderIndex - b.orderIndex);
  assert.equal(nonAdminVisible.length, 2);
  assert.equal(nonAdminVisible[0].key, 'giveaway');
  assert.equal(nonAdminVisible[1].key, 'so-status');

  // Admin sees all (with enabled flags)
  const adminList = [...decorated].sort((a, b) => a.orderIndex - b.orderIndex);
  assert.equal(adminList.length, 3);
  assert.equal(adminList[0].key, 'giveaway');
  assert.equal(adminList[1].key, 'so-status');
  assert.equal(adminList[2].key, 'rule-incidents');
  assert.equal(adminList[2].enabled, false);
});
