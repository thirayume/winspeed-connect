const { wfQuery, query } = require('./db');

async function test() {
  const g = await wfQuery(`SELECT DISTINCT EmpCode, Region FROM wf.GiveawayBudget`);
  console.log("From GiveawayBudget:");
  console.table(g.recordset);
  
  const s = await query(`
    SELECT DISTINCT ce.EmpID, e.EmpCode, e.EmpName, a.SaleAreaName
    FROM dbo.EMCustMultiEmp ce
    JOIN dbo.EMEmp e ON e.EmpID = ce.EmpID
    JOIN dbo.EMCust c ON c.CustID = ce.CustID
    JOIN dbo.EMSaleArea a ON a.SaleAreaID = c.SaleAreaID
  `);
  console.log("From EMSaleArea (first 10):");
  console.table(s.recordset.slice(0, 10));

  process.exit(0);
}
test().catch(console.error);
