const { sql, wfQuery } = require('./db');
async function test() {
  const plate = '70-1087/88';
  const np = String(plate).replace(/\s/g, '');
  const cand = (await wfQuery(
    `SELECT TOP 3 Id FROM wf.v_AllSalesOrders
     WHERE Status IN ('CONFIRMED','PICKING','LOADED')
       AND REPLACE(ISNULL(TruckPlate,''),' ','') LIKE @p`,
    { p: { type: sql.NVarChar(80), value: `%${np}%` } })).recordset || [];
  console.log('cand:', cand);
  if (cand.length === 1) {
    console.log('id is:', cand[0].Id, 'typeof:', typeof cand[0].Id);
  }
}
test().catch(console.error);
