'use strict';

const { sql } = require('../db');

// Finance supplies one exact database, VAT group and chart-of-accounts code.
// Read WinSpeed's live mapping on the caller's transaction before native writes.
async function readApprovedSalesVat(q, { dbName, soid, docuType, setting = process.env.NATIVE_SALES_VAT_APPROVAL }) {
  const match = /^([a-zA-Z0-9_]+):([1-9]\d{0,9}):([a-zA-Z0-9][a-zA-Z0-9._/-]{0,63})$/.exec(setting?.trim() || '');
  if (!match || match[1].toLowerCase() !== dbName.toLowerCase() || Number(match[2]) > 2147483647) return null;

  const result = await q(`SELECT v.VATGroupID AS GroupId,a.AccID AS AccountId,RTRIM(a.AccCode) AS AccountCode
    FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.EMVATGroup v WITH(HOLDLOCK) ON v.VATGroupID=h.VATGroupID AND v.VatType=h.VatType
      AND CONVERT(decimal(8,4),v.VatRate)=CONVERT(decimal(8,4),h.VatRate)
    JOIN dbo.EMAcc a WITH(HOLDLOCK) ON a.AccID=v.AccID
    WHERE h.SOID=@soid AND h.DocuType=@docuType AND h.VatAmnt>0
      AND v.VATGroupID=@groupId AND RTRIM(a.AccCode)=@accountCode`, {
    soid: { type: sql.Int, value: soid },
    docuType: { type: sql.Int, value: docuType },
    groupId: { type: sql.Int, value: Number(match[2]) },
    accountCode: { type: sql.VarChar(64), value: match[3] },
  });
  return result.recordset?.length === 1 ? result.recordset[0] : null;
}

module.exports = { readApprovedSalesVat };
