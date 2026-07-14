const { wfQuery } = require('./db');
const sql = require('mssql');

async function run() {
  try {
    const r = await wfQuery(`SELECT EmpID, EmpName FROM dbo.EMEmp WHERE EmpName LIKE N'%EMP-0021.1%' OR EmpName LIKE N'%EMP-00021%'`);
    console.table(r.recordset);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
