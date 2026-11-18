'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeConversionRequestScope } = require('../services/rebate-conversion-approval-scope');
const row = { ConversionId: 8, CustId: 7 };
test('scope applies to all reserved sources and passes through server-bound parameters', async () => {
  let captured;
  const q = async (sql, params) => { captured = { sql, params }; return { recordset: [{ Total: 2, Visible: 2 }] }; };
  const scope = { sql: 'SalesEmpId=@employee', inputs: { employee: 'E1' } };
  assert.equal(await authorizeConversionRequestScope(q, {}, row, { scopeFilter: async () => scope }), scope);
  assert.match(captured.sql, /SalesEmpId=@employee/); assert.equal(captured.params.employee, 'E1');
});
test('partial, missing and invalid scope fail closed', async () => {
  for (const counts of [{ Total: 2, Visible: 1 }, { Total: 0, Visible: null }, { Total: null, Visible: null }]) {
    await assert.rejects(authorizeConversionRequestScope(async () => ({ recordset: [counts] }), {}, row,
      { scopeFilter: async () => ({ sql: '1=1', inputs: {} }) }), { code: 'REBATE_CONVERSION_REQUEST_NOT_FOUND' });
  }
});
