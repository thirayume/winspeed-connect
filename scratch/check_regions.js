const { runWithTarget, wfQuery, pools } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    const areas = await wfQuery('SELECT * FROM wf.UserSaleArea');
    console.log('UserSaleAreas:', areas.recordset);

    const custs = await wfQuery(`
      SELECT DISTINCT c.CustId, cu.CustName, cu.SaleAreaID
      FROM wf.v_RebateAccrualRemaining c
      LEFT JOIN dbo.EMCust cu ON cu.CustID = c.CustId
    `);
    console.log('Custs with accruals:', custs.recordset);
  });
  for (const k of Object.keys(pools)) await pools[k].close();
}

main().catch(console.error);
