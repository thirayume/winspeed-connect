const db = require('./db.js');
db.wfQuery("SELECT TOP 5 Id, WfRef, SoPrefix, Status, DocuNo, CreatedAt FROM wf.SalesOrder ORDER BY Id DESC").then(r => {
  console.log(r);
  process.exit(0);
});
