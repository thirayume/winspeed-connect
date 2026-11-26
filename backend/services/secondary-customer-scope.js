'use strict';

// Both customer master and customer-specific endpoints must use the same
// business-database identities. Never accept an owner ID from the request.
const { sql, wfQuery } = require('../db');
const { getVisibleScope, scopeFilter } = require('./visible-scope');
const { actorPerspective } = require('./business-identity');
const { readGlobalDataWindow } = require('./global-data-window-store');

async function customerPredicate(user,options={}) {
  const actor = actorPerspective(user);
  const q = options.queryFn || wfQuery;
  const scopes = options.scopes || [await getVisibleScope(user,q), ...(actor === user ? [] : [await getVisibleScope(actor,q)])];
  const window = await readGlobalDataWindow();
  const inputs = { customerStartDate: { type: sql.Date, value: window.businessDate } };
  const conditions = [];
  for (const [index, scope] of scopes.entries()) {
    if (scope.all) continue;
    const assigned = scopeFilter(scope, { userCol: 'cx.SalespersonUserId', empCol: 'c.BillEmp', prefix: `customerScope${index}` });
    const sold = scopeFilter(scope, { userCol: 'salesExt.SalesUserId', empCol: 'salesBooking.EmpID', prefix: `customerBooking${index}` });
    // Unassigned customers belong to a territory, not every user's list.
    // Sales and promotion territories are separate and may cover the same province.
    const territory = scopeFilter(scope,{userCol:'territory.OwnerUserId',prefix:`customerTerritory${index}`});
    conditions.push(`(${assigned.sql} OR EXISTS (SELECT 1 FROM wf.SalesTerritory territory
      JOIN wf.SalesTerritoryProvince province ON province.TerritoryCode=territory.TerritoryCode
      WHERE territory.IsActive=1 AND ${territory.sql}
        AND province.Province=LTRIM(RTRIM(REPLACE(REPLACE(c.Province,N'จังหวัด',N''),N'จ.',N'')))) OR EXISTS (SELECT 1 FROM dbo.SOHD salesBooking
      LEFT JOIN wf.SalesOrderExt salesExt ON salesExt.SOID=CONVERT(VARCHAR(50),salesBooking.SOID)
      WHERE salesBooking.CustID=c.CustID AND salesBooking.DocuType=103
        AND salesBooking.DocuDate >= @customerStartDate AND ${sold.sql}))`);
    Object.assign(inputs, assigned.inputs, sold.inputs,territory.inputs);
  }
  return { sql: conditions.length ? conditions.map(c => `(${c})`).join(' AND ') : '1=1', inputs };
}

async function customerVisible(user, custId,options={}) {
  const id = Number(custId);
  if (!/^\d+$/.test(String(custId)) || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return false;
  const predicate = await customerPredicate(user,options);
  const result = await (options.queryFn||wfQuery)(`SELECT TOP 1 1 AS ok FROM dbo.EMCust c
    LEFT JOIN wf.CustomerExt cx ON cx.CustId=c.CustID
    WHERE c.CustID=@visibilityCustId AND ${predicate.sql}`,
  { ...predicate.inputs, visibilityCustId: { type: sql.Int, value: id } });
  return Boolean(result.recordset?.length);
}
// Drafts from older versions may carry CustCode. Resolve it without guessing
// when a numeric code collides with another customer's numeric ID.
async function customerReferenceVisible(user,reference,options={}){
 const ref=String(reference||'').trim();if(!ref||ref.length>25)return false;
 const parsed=/^\d+$/.test(ref)?Number(ref):null;
 const candidate=Number.isSafeInteger(parsed)&&parsed>0&&parsed<=2147483647?parsed:null;
 const q=options.queryFn||wfQuery;
 const rows=(await q(`SELECT TOP 2 CustID,CustCode FROM dbo.EMCust WITH(HOLDLOCK)
   WHERE CustID=@scopeCustomerId OR CustCode=@scopeCustomerCode ORDER BY CustID`,{scopeCustomerId:{type:sql.Int,value:candidate},scopeCustomerCode:{type:sql.VarChar(25),value:ref}})).recordset||[];
 if(new Set(rows.map(r=>String(r.CustID))).size>1)throw Object.assign(Error('รหัสลูกค้ากำกวม กรุณาตรวจสอบข้อมูลลูกค้า'),{status:409,code:'AMBIGUOUS_CUSTOMER_ID'});
 return rows.length===1&&customerVisible(user,rows[0].CustID,options);
}

module.exports = { customerPredicate, customerVisible, customerReferenceVisible };
