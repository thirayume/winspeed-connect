const db = require('./db.js');
db.wfQuery("SELECT TOP 5 Id, WfRef, SoPrefix, Status, ImportedDocuNo FROM wf.v_AllSalesOrders ORDER BY Id DESC").then(r => {
  console.log(r.recordset);
  process.exit(0);
});
