const sql = require('mssql/msnodesqlv8');
const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'dbwins_demo',
  options: {
    trustedConnection: true,
    enableArithAbort: true,
  },
  driver: 'msnodesqlv8'
};

async function test() {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query(`
            SELECT TOP 5 
                S.SOID, S.DocuNo, S.CustID, S.NetAmnt, 
                C.CustName,
                S.AppvFlag, S.PkgStatus, S.clearflag
            FROM SOHD S
            LEFT JOIN EMCust C ON S.CustID = C.CustID
            ORDER BY S.DocuDate DESC
        `);
        console.log(JSON.stringify(result.recordset, null, 2));
        pool.close();
    } catch(e) {
        console.error(e);
    }
}
test();
