const { sql, wfQuery } = require('./db');

async function test() {
  console.time('query');
  try {
    const r = await wfQuery(`
      WITH ActiveSO AS (
        SELECT * FROM wf.v_AllSalesOrders WHERE Status IN ('DRAFT', 'CONFIRMED', 'PICKING')
        UNION ALL
        SELECT * FROM wf.v_AllSalesOrders WHERE Status = 'SHIPPED' AND CreatedAt >= DATEADD(day, -3, GETDATE())
      )
      SELECT so.Id, so.WfRef, so.CustName, so.Status, so.TruckPlate, so.ControlTicketNo,
             so.ImportedDocuNo, so.CreatedAt, u.DisplayName AS SalesName,
             SUM(CASE WHEN l.IsGiveaway=0 THEN l.QtyTon ELSE 0 END) AS QtyTon,
             COUNT(l.SoId) AS LineCnt
      FROM ActiveSO so
      LEFT JOIN wf.AppUser u ON u.Id = so.SalesUserId
      LEFT JOIN wf.v_AllSalesOrderLines l ON l.SoId = so.Id
      GROUP BY so.Id, so.WfRef, so.CustName, so.Status, so.TruckPlate, so.ControlTicketNo,
               so.ImportedDocuNo, so.CreatedAt, u.DisplayName
      ORDER BY so.CreatedAt DESC
    `);
    console.log('Result count:', r.recordset.length);
  } catch (e) {
    console.error(e);
  }
  console.timeEnd('query');
  process.exit(0);
}
test();
