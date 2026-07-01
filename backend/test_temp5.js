const db = require('./db.js');
db.wfQuery("SELECT DISTINCT Status FROM wf.SalesOrder").then(r => {
  console.log(r.recordset);
  process.exit(0);
});
