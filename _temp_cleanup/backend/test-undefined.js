const { wfQuery } = require('./db');
async function test() {
  const r = await wfQuery(`
    SELECT * FROM wf.SalesOrderExt WHERE SOID = 'undefined' OR CustId = 'undefined'
  `);
  console.log('Ext:', r.recordset);
  const r2 = await wfQuery(`
    SELECT * FROM wf.SalesOrder WHERE Id = 'undefined'
  `).catch(e => e.message);
  console.log('SO:', r2);
  const r3 = await wfQuery(`
    SELECT * FROM wf.OutboxEvent WHERE AggregateId = 'undefined'
  `);
  console.log('Outbox:', r3.recordset);
}
test();
