const { runWithTarget } = require('../backend/db');
const reports = require('../backend/routes/reports');

async function testGlReport() {
  await runWithTarget('remote_b', async () => {
    console.log('Testing gl-sales-journal run() on remote_b...');
    const t0 = Date.now();
    const rows = await reports.REPORTS['gl-sales-journal'].run({ days: 60 });
    const duration = Date.now() - t0;
    console.log(`GL report run() completed in ${duration} ms, total rows: ${rows.length}`);
    if (rows.length > 0) {
      console.log('Sample row 0:', rows[0]);
      console.log('Sample row 1:', rows[1]);
      const uniqueGlids = new Set(rows.map(r => r.GLID));
      console.log(`Unique GLIDs: ${uniqueGlids.size}`);
      const balanceStatuses = {};
      const postingStatuses = {};
      for (const r of rows) {
        balanceStatuses[r.BalanceStatus] = (balanceStatuses[r.BalanceStatus] || 0) + 1;
        postingStatuses[r.PostingStatus] = (postingStatuses[r.PostingStatus] || 0) + 1;
      }
      console.log('BalanceStatus distribution:', balanceStatuses);
      console.log('PostingStatus distribution:', postingStatuses);
    }
  });
}

testGlReport().catch(err => {
  console.error('GL report test failed:', err);
  process.exit(1);
});
