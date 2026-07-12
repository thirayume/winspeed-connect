const { wfQuery } = require('../db');

async function main() {
  const docs = process.argv.slice(2);
  const docNos = docs.length ? docs : ['QU6907-00001', 'QU6907-00002', 'QC69-00002'];
  const placeholders = docNos.map((_, i) => `@d${i}`).join(',');
  const inputs = Object.fromEntries(docNos.map((docNo, i) => [`d${i}`, { type: require('../db').sql.NVarChar(30), value: docNo }]));

  const headerSql = `
    SELECT
      h.SOID, h.DocuNo, h.DocuType, h.DocuDate, h.CustID, h.CustName,
      h.ValidDays, h.ExpireDate, h.ShipDate, h.CreditDays, h.EmpID, h.SaleAreaID,
      h.NetAmnt, h.DocuStatus, h.AppvFlag, h.Appvid, h.RefSOID, h.RefNo, h.RefDate,
      h.FromFlag, h.QuotStatus, h.PkgStatus, h.Refeflag, h.clearflag,
      h.TransRegistration, h.Remark, h.StatusRemark, h.CheckAll
    FROM dbo.SOHD h WITH (NOLOCK)
    WHERE h.DocuNo IN (${placeholders})
    ORDER BY h.DocuNo;
  `;
  const header = await wfQuery(headerSql, inputs);
  console.log('SOHD');
  console.table(header.recordset || []);

  const detailSql = `
    SELECT
      d.SOID, hd.DocuNo AS HeaderDocuNo, d.RefSOID, d.ListNo,
      d.DocuType, d.Refno, d.RefListNo, d.GoodID, g.GoodCode,
      d.GoodName, d.GoodUnitID2, d.GoodQty2, d.GoodPrice2, d.GoodAmnt,
      d.RemaQty, d.GoodRemaQty1, d.GoodRemaQty2, d.CheckFlag,
      d.MasterQty, d.ChildQty
    FROM dbo.SODT d WITH (NOLOCK)
    LEFT JOIN dbo.SOHD hd WITH (NOLOCK) ON hd.SOID = d.SOID
    LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = d.GoodID
    WHERE d.SOID IN (SELECT SOID FROM dbo.SOHD WITH (NOLOCK) WHERE DocuNo IN (${placeholders}))
       OR d.RefSOID IN (SELECT SOID FROM dbo.SOHD WITH (NOLOCK) WHERE DocuNo IN (${placeholders}))
       OR d.Refno IN (${placeholders})
    ORDER BY d.SOID, d.ListNo;
  `;
  const detail = await wfQuery(detailSql, inputs);
  console.log('SODT');
  console.table(detail.recordset || []);

  const remarkSql = `
    SELECT r.SOID, h.DocuNo, r.ListNo, r.Remark
    FROM dbo.SOHDRemark r WITH (NOLOCK)
    INNER JOIN dbo.SOHD h WITH (NOLOCK) ON h.SOID = r.SOID
    WHERE h.DocuNo IN (${placeholders})
    ORDER BY h.DocuNo, r.ListNo;
  `;
  const remarks = await wfQuery(remarkSql, inputs);
  console.log('SOHDRemark');
  console.table(remarks.recordset || []);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
