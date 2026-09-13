const { runWithTarget, query } = require('../backend/db');

runWithTarget('remote_b', async () => {
  try {
    const rows = await query(`
      SELECT * FROM dbo.EMSetPriceHD WHERE SetPriceID IN (2062, 2063)
    `);
    console.log('EMSetPriceHD 2062/2063:', rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
});
