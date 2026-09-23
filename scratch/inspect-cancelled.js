const { query, sql, runWithTarget, closeAll } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    try {
      const cancelled = await query(`
        SELECT DocuType, COUNT(*) as cnt
        FROM dbo.SOHD
        WHERE DocuStatus = 'C'
        GROUP BY DocuType
      `);
      console.log('Cancelled SOHD by DocuType:');
      console.table(cancelled);
    } catch (err) {
      console.error('Error:', err);
    }
  });
  await closeAll();
}

main();
