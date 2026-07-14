require('dotenv').config({path:'backend/.env'});
const sql = require('mssql');
async function run() {
  const pool = await sql.connect(process.env.WINSPEED_DB_URL);
  const r = await pool.request().query(`SELECT EmpID, EmpName FROM dbo.EMEmp WHERE EmpName LIKE N'%Chakkrapong%' OR EmpName LIKE N'%จักรพงษ์%'`);
  console.table(r.recordset);
  pool.close();
}
run();
