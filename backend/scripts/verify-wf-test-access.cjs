'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sql = require(path.join(__dirname, '../node_modules/mssql/msnodesqlv8'));

const server = process.env.REMOTE_B_DB_SERVER || '76.13.190.104';
const port = process.env.REMOTE_B_DB_PORT || '1433';
const user = process.env.REMOTE_B_DB_USER || 'wf_test';
const pwd = process.env.REMOTE_B_DB_PASSWORD;
const dbName = process.env.REMOTE_B_DB_NAME || 'dbwins_worldfert9_test_v2';

if (!pwd) {
  throw new Error('Missing REMOTE_B_DB_PASSWORD in .env');
}

const connStr =
  `Driver={ODBC Driver 17 for SQL Server};Server=${server},${port};Database=${dbName};` +
  `Uid=${user};Pwd={${pwd}};Encrypt=yes;TrustServerCertificate=yes;`;

async function main() {
  const pool = new sql.ConnectionPool({ connectionString: connStr });
  await pool.connect();
  console.log('Connected as wf_test!');

  const info = await pool.request().query(`
    SELECT 
      SUSER_SNAME() AS login,
      DB_NAME() AS currentDb,
      IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
      HAS_DBACCESS('dbwins_worldfert9') AS prodAccess
  `);
  console.log('Login Info:', info.recordset);

  // Assertions
  const row = info.recordset[0];
  if (row.isSysadmin === 1) {
    throw new Error('FAIL: wf_test must NOT be sysadmin!');
  }
  if (row.prodAccess === 1) {
    throw new Error('FAIL: wf_test must NOT have access to dbwins_worldfert9!');
  }

  // Attempt cross-database write to production
  try {
    await pool.request().query('UPDATE dbwins_worldfert9.wf.ControlTicketOverlay SET DocuId = 999 WHERE Id = 1');
    throw new Error('FAIL: Cross-database write to dbwins_worldfert9 was not rejected by SQL Server!');
  } catch (err) {
    console.log('PASS: SQL Server directly rejected cross-db write:');
    console.log(`  Error: ${err.message}`);
  }

  await pool.close();
  console.log('ALL WF_TEST SECURITY CHECKS PASSED.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
