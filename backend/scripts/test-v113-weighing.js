const { query, runWithTarget } = require('../db');

runWithTarget('remote_b', async () => {
  const res = await query(`
    SELECT TOP 10 
      Id, WfRef, SoPrefix, CustId,
      ActualWeighInAt, ActualWeighOutAt, WeighStatus, WeighId, WeighEventCount
    FROM wf.v_AllSalesOrders 
    WHERE ActualWeighInAt IS NOT NULL OR WeighEventCount > 0
    ORDER BY Id DESC
  `);
  console.log('--- v_AllSalesOrders WEIGHING VIA TYPED SPID ---');
  console.table(res);
}).catch(console.error);
