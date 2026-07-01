const { wfQuery } = require('./db');
const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

async function test() {
  const r = await wfQuery(`
      SELECT so.*, u.DisplayName AS SalesName,
             COUNT(*) OVER() AS TotalCount
      FROM wf.v_AllSalesOrders so
      LEFT JOIN wf.AppUser u ON u.Id = so.SalesUserId
      ORDER BY so.CreatedAt DESC, so.Id DESC
      OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY
  `);
  const orders = camelizeRows(r.recordset);
  console.log(orders.map(o => o.id));
}
test().catch(console.error);
