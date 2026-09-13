const { runWithTarget, wfQuery, pools } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    const cols = await wfQuery(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'wf' AND TABLE_NAME = 'RebateClaimApproval'
    `);
    console.log('RebateClaimApproval cols:', cols.recordset);
  });
  for (const k of Object.keys(pools)) await pools[k].close();
}

main().catch(console.error);
