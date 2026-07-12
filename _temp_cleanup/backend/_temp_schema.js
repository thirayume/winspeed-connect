const { query, wfQuery } = require('./db');

async function checkSchema() {
  const t1 = await query(`SELECT TOP 1 * FROM dbo.EMCust`);
  console.log("EMCust keys:", Object.keys(t1[0] || {}).filter(k => k.toLowerCase().includes('credit')));

  const t2 = await query(`SELECT TOP 1 * FROM dbo.SOHD`);
  console.log("SOHD keys:", Object.keys(t2[0] || {}).filter(k => k.toLowerCase().includes('desc') || k.toLowerCase().includes('remark') || k.toLowerCase().includes('credit') || k.toLowerCase().includes('trans')));

  const t3 = await query(`SELECT TOP 1 * FROM dbo.SODT`);
  console.log("SODT keys:", Object.keys(t3[0] || {}).filter(k => k.toLowerCase().includes('desc') || k.toLowerCase().includes('remark')));

  const t4 = await wfQuery(`SELECT TOP 1 * FROM wf.SalesOrder`);
  console.log("wf.SalesOrder keys:", Object.keys(t4.recordset[0] || {}));

  const t5 = await wfQuery(`SELECT TOP 1 * FROM wf.SalesOrderLine`);
  console.log("wf.SalesOrderLine keys:", Object.keys(t5.recordset[0] || {}));

  process.exit(0);
}
checkSchema().catch(console.error);
