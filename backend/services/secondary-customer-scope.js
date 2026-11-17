'use strict';

// Both customer master and customer-specific endpoints must use the same
// business-database identities. Never accept an owner ID from the request.
const { sql, wfQuery } = require('../db');
const { getVisibleScope, scopeFilter } = require('./visible-scope');
const { actorPerspective } = require('./business-identity');
const { readGlobalDataWindow } = require('./global-data-window-store');

async function customerPredicate(user) {
  const actor = actorPerspective(user);
  const scopes = [await getVisibleScope(user), ...(actor === user ? [] : [await getVisibleScope(actor)])];
  const window = await readGlobalDataWindow();
  const inputs = { customerStartDate: { type: sql.Date, value: window.businessDate } };
  const conditions = [];
  for (const [index, scope] of scopes.entries()) {
    if (scope.all) continue;
    const assigned = scopeFilter(scope, { userCol: 'cx.SalespersonUserId', empCol: 'c.BillEmp', prefix: `customerScope${index}` });
    const sold = scopeFilter(scope, { userCol: 'salesExt.SalesUserId', empCol: 'salesBooking.EmpID', prefix: `customerBooking${index}` });
    // The owner confirmed that customers without an assigned salesperson must
    // remain selectable. An invalid/inactive assigned owner is not unassigned.
    conditions.push(`((ISNULL(c.BillEmp,0)=0 AND ISNULL(cx.SalespersonUserId,0)=0) OR ${assigned.sql} OR EXISTS (SELECT 1 FROM dbo.SOHD salesBooking
      LEFT JOIN wf.SalesOrderExt salesExt ON salesExt.SOID=CONVERT(VARCHAR(50),salesBooking.SOID)
      WHERE salesBooking.CustID=c.CustID AND salesBooking.DocuType=103
        AND salesBooking.DocuDate >= @customerStartDate AND ${sold.sql}))`);
    Object.assign(inputs, assigned.inputs, sold.inputs);
  }
  return { sql: conditions.length ? conditions.map(c => `(${c})`).join(' AND ') : '1=1', inputs };
}

async function customerVisible(user, custId) {
  const id = Number(custId);
  if (!/^\d+$/.test(String(custId)) || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return false;
  const predicate = await customerPredicate(user);
  const result = await wfQuery(`SELECT TOP 1 1 AS ok FROM dbo.EMCust c
    LEFT JOIN wf.CustomerExt cx ON cx.CustId=c.CustID
    WHERE c.CustID=@visibilityCustId AND ${predicate.sql}`,
  { ...predicate.inputs, visibilityCustId: { type: sql.Int, value: id } });
  return Boolean(result.recordset?.length);
}

// Legacy callers that explicitly use the secondary-only helper retain their
// original primary-database behavior until individually migrated and tested.
async function secondaryCustomerPredicate(user) {
  return user?.identityMapping ? customerPredicate(user) : { sql: '1=1', inputs: {} };
}
async function secondaryCustomerVisible(user, custId) {
  return user?.identityMapping ? customerVisible(user, custId) : true;
}

module.exports = { customerPredicate, customerVisible, secondaryCustomerPredicate, secondaryCustomerVisible };
