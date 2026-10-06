const { runWithTarget, query, closeAll } = require('../db');

(async () => {
  try {
    await runWithTarget('remote_b', async () => {
      const v = await query(`
        SELECT OBJECT_DEFINITION(OBJECT_ID('wf.v_TripMember')) AS def
      `);
      console.log('wf.v_TripMember definition:', v[0]?.def);

      // Also check what tables exist for Cheque and AR Receipt in WinSpeed
      const tables = await query(`
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_NAME LIKE '%CQ%' OR TABLE_NAME LIKE '%Cheque%' OR TABLE_NAME LIKE '%AR%' OR TABLE_NAME LIKE '%Rcpt%'
        ORDER BY TABLE_NAME
      `);
      console.log('Tables matching CQ/Cheque/AR/Rcpt:', tables.map(t => t.TABLE_NAME));
    });

    await closeAll();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    await closeAll().catch(() => {});
    process.exit(1);
  }
})();
