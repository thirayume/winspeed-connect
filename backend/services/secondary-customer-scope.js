'use strict';

// Both customer master and customer-specific endpoints must use the same
// business-database identities. Never accept an owner ID from the request.
const { sql, wfQuery } = require('../db');
const { getVisibleScope, scopeFilter } = require('./visible-scope');
const { actorPerspective } = require('./business-identity');
const { readGlobalDataWindow } = require('./global-data-window-store');

async function secondaryCustomerPredicate(user) {
  if (!user?.identityMapping) return { sql: '1=1', inputs: {} };
  const actor = actorPerspective(user);
  const scopes = [await getVisibleScope(user), ...(actor === user ? [] : [await getVisibleScope(actor)])];
  const window = await readGlobalDataWindow();
  const inputs = { customerStartDate: { type: sql.Date, value: window.businessDate } };
  const conditions = [];
  for (const [index, scope] of scopes.entries()) {
    if (scope.all) continue;
    const assigned = scopeFilter(scope, { userCol: 'cx.SalespersonUserId', empCol: 'c.BillEmp', prefix: `customerScope${index}` });
    const sold = scopeFilter(scope, { userCol: 'salesExt.SalesUserId', empCol: 'salesBooking.EmpID', prefix: `customerBooking${index}` });
    conditions.push(`(${assigned.sql} OR EXISTS (SELECT 1 FROM dbo.SOHD salesBooking
      LEFT JOIN wf.SalesOrderExt salesExt ON salesExt.SOID=CONVERT(VARCHAR(50),salesBooking.SOID)
      WHERE salesBooking.CustID=c.CustID AND salesBooking.DocuType=103
        AND salesBooking.DocuDate >= @customerStartDate AND ${sold.sql}))`);
    Object.assign(inputs, assigned.inputs, sold.inputs);
  }
  return { sql: conditions.length ? conditions.map(c => `(${c})`).join(' AND ') : '1=1', inputs };
}

async function secondaryCustomerVisible(user, custId) {
  if (!user?.identityMapping) return true;
  const id = Number(custId);
  if (!/^\d+$/.test(String(custId)) || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return false;
  const predicate = await secondaryCustomerPredicate(user);
  const result = await wfQuery(`SELECT TOP 1 1 AS ok FROM dbo.EMCust c
    LEFT JOIN wf.CustomerExt cx ON cx.CustId=c.CustID
    WHERE c.CustID=@visibilityCustId AND ${predicate.sql}`,
  { ...predicate.inputs, visibilityCustId: { type: sql.Int, value: id } });
  return Boolean(result.recordset?.length);
}

module.exports = { secondaryCustomerPredicate, secondaryCustomerVisible };
