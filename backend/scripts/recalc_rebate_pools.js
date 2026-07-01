const { sql, wfQuery, wfTransaction } = require('../db');

async function run() {
  try {
    console.log('--- Recalculating wf.RebatePool AccruedAmt from wf.RebateLedger ---');

    await wfTransaction(async (tx) => {
      // 1. Reset AccruedAmt to 0 for all pools
      await tx.request().query(`UPDATE wf.RebatePool SET AccruedAmt = 0`);
      
      // 2. Sum up RebateAmount from RebateLedger grouped by PoolId
      // Note: Only sum items that are not reversed
      const r = await tx.request().query(`
        SELECT PoolId, ISNULL(SUM(RebateAmount), 0) AS Total
        FROM wf.RebateLedger
        WHERE ReversedFlag = 0
        GROUP BY PoolId
      `);
      
      const sums = r.recordset;
      console.log(`Found ${sums.length} pools with active ledger entries.`);
      
      // 3. Update the RebatePool table with the correct sums
      let updatedCount = 0;
      for (const row of sums) {
        if (row.Total > 0) {
          await tx.request()
            .input('poolId', sql.Int, row.PoolId)
            .input('total', sql.Decimal(12,2), row.Total)
            .query(`UPDATE wf.RebatePool SET AccruedAmt = @total WHERE Id = @poolId`);
          updatedCount++;
        }
      }
      
      console.log(`Updated ${updatedCount} pools.`);
    });
    
    console.log('--- Done ---');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit();
  }
}

run();
