const { wfQuery, wfTransaction } = require('../db');

async function run() {
  try {
    console.log('--- Cleaning up RebateLedger from non-SHIPPED orders ---');
    await wfTransaction(async (tx) => {
      // 1. ลบ Ledger ที่เกิดจาก SO ที่ยังไม่ SHIPPED
      const r = await tx.request().query(`
        DELETE FROM wf.RebateLedger
        WHERE SOID IN (
          SELECT CAST(Id AS VARCHAR) FROM wf.v_AllSalesOrders WHERE Status != 'SHIPPED'
        )
      `);
      console.log(`Deleted ${r.rowsAffected[0]} phantom ledger entries.`);

      // 2. รีเซ็ต AccruedAmt ทั้งหมดเป็น 0 
      await tx.request().query(`UPDATE wf.RebatePool SET AccruedAmt = 0`);

      // 3. คำนวณ AccruedAmt ใหม่จาก Ledger ที่เหลืออยู่
      const r2 = await tx.request().query(`
        SELECT PoolId, ISNULL(SUM(RebateAmount), 0) AS Total
        FROM wf.RebateLedger
        WHERE ReversedFlag = 0
        GROUP BY PoolId
      `);
      
      const sums = r2.recordset;
      for (const row of sums) {
        if (row.Total > 0) {
          await tx.request()
            .input('poolId', require('../db').sql.Int, row.PoolId)
            .input('total', require('../db').sql.Decimal(12,2), row.Total)
            .query(`UPDATE wf.RebatePool SET AccruedAmt = @total WHERE Id = @poolId`);
        }
      }
      console.log(`Recalculated pools.`);
    });
    console.log('--- Done ---');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
}

run();
