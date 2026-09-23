const { runWithTarget, wfQuery } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    const res = await wfQuery(`
      SELECT OBJECT_DEFINITION(OBJECT_ID('wf.v_RebateAccrualLot')) AS def;
    `);
    console.log('=== wf.v_RebateAccrualLot DEFINITION ===');
    console.log(res.recordset[0]?.def || 'NOT FOUND');

    const sample = await wfQuery(`
      SELECT TOP 5 * FROM wf.v_RebateAccrualRemaining;
    `);
    console.log('\n=== SAMPLE ROWS (TOP 5) ===');
    console.log(sample.recordset);
  });
}

main().catch(console.error);
