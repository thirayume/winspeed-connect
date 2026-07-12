const { sql, wfQuery } = require('./db');

async function test() {
  console.time('query');
  try {
    const r = await wfQuery(`
      SELECT so.*, u.DisplayName AS SalesName,
             COUNT(*) OVER() AS TotalCount
      FROM wf.v_AllSalesOrders so
      LEFT JOIN wf.AppUser u ON u.Id = so.SalesUserId
      WHERE so.Status = 'PICKING'
      ORDER BY so.CreatedAt DESC, so.Id DESC
      OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY
    `);
    console.log('Result count:', r.recordset.length);
  } catch (e) {
    console.error(e);
  }
  console.timeEnd('query');
  process.exit(0);
}
test();
