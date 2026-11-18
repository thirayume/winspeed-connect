'use strict';
const { sharedRebateScopeFilter } = require('./rebate-shared-scope');
const { getVisibleScope } = require('./visible-scope');
function fail(code, status = 404) { throw Object.assign(new Error(code), { code, status }); }

// Both identities must be permitted to see every source owner. Resolve the
// scope and verify it again in the decision transaction; a previous preview
// is not authority to approve or release another team's balance.
async function authorizeConversionRequestScope(query, user, row, options = {}) {
  const conversionId = Number(row?.ConversionId), custId = Number(row?.CustId);
  if (typeof query !== 'function' || !Number.isSafeInteger(conversionId) || conversionId < 1 ||
      !Number.isSafeInteger(custId) || custId < 1) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND');
  const reader = options.scopeReader || (u => getVisibleScope(u, query));
  const scope = await (options.scopeFilter || sharedRebateScopeFilter)(user, reader);
  const result = await query(`SELECT COUNT_BIG(*) AS Total,
      SUM(CASE WHEN a.Id IS NOT NULL AND h.SOID IS NOT NULL AND ${scope.sql} THEN 1 ELSE 0 END) AS Visible
    FROM wf.RebateShipmentReservation r WITH(HOLDLOCK)
    LEFT JOIN wf.RebateShipmentAccrual a WITH(HOLDLOCK) ON a.Id=r.AccrualId AND a.CustId=@custId
    LEFT JOIN dbo.SOHD h WITH(HOLDLOCK) ON h.SOID=a.SourceSOID AND h.DocuType=104
    CROSS APPLY (SELECT h.EmpID AS SalesEmpId) owner
    WHERE r.ConversionId=@conversionId`, { ...scope.inputs, conversionId, custId });
  const total = Number(result.recordset?.[0]?.Total), visible = Number(result.recordset?.[0]?.Visible);
  if (!Number.isSafeInteger(total) || total < 1 || visible !== total) fail('REBATE_CONVERSION_REQUEST_NOT_FOUND');
  return scope;
}
module.exports = { authorizeConversionRequestScope };
