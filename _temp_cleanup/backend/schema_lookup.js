const sql = require('mssql/msnodesqlv8');
const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'dbwins_demo',
  options: {
    trustedConnection: true,
  },
  driver: 'msnodesqlv8'
};

async function test() {
    try {
        const pool = await sql.connect(config);
        
        console.log("=== EMGood columns ===");
        const cols = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EMGood'");
        console.log(cols.recordset.map(c => c.COLUMN_NAME).slice(0, 15));

        console.log("=== EMGood data ===");
        const good = await pool.request().query('SELECT TOP 3 GoodID, GoodName1, MainGoodUnitID FROM EMGood');
        console.log(good.recordset);

        pool.close();
    } catch(e) {
        console.error(e);
    }
}
test();
