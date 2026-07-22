const { wfQuery } = require('./db');

async function run() {
  try {
    const r = await wfQuery("SELECT Id, WfRef FROM wf.SalesOrder WHERE Remark LIKE 'UAT-%'");
    console.log(r.recordset);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
