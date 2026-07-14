require('dotenv').config({path:'backend/.env'});
const sql = require('mssql');
async function run() {
  const pool = await sql.connect(process.env.WINSPEED_DB_URL);
  const r = await pool.request().query(`SELECT EmpID, EmpName FROM dbo.EMEmp WHERE EmpName LIKE N'%EMP-0021.1%' OR EmpName LIKE N'%EMP-00021%'`);
  console.table(r.recordset);
  pool.close();
}
run();
