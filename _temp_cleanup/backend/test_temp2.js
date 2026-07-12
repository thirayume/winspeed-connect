const db = require('./db.js');
db.wfQuery("SELECT Id, WfRef, SoPrefix, Status, DocuNo, ImportedDocuNo FROM wf.v_AllSalesOrders WHERE WfRef LIKE '%53352%' OR DocuNo LIKE '%53352%' OR ImportedDocuNo LIKE '%53352%'").then(r => {
  console.log(r.recordset);
  process.exit(0);
});
