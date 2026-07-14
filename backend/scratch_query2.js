const { wfQuery } = require('./db');
const sql = require('mssql');

async function run() {
  try {
    const r = await wfQuery(`SELECT EmpID, EmpName FROM dbo.EMEmp WHERE EmpName LIKE N'%Chakkrapong%' OR EmpName LIKE N'%จักรพงษ์%'`);
    console.table(r.recordset);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
