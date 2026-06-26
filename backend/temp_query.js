const sql = require('mssql/msnodesqlv8');

const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'dbwins_worldfert9',
  driver: 'msnodesqlv8',
  options: {
    trustedConnection: true,
    trustServerCertificate: true
  }
};

async function run() {
  try {
    const pool = await sql.connect(config);
    const soRes = await pool.request().query(`SELECT TOP 1 Id FROM wf.SalesOrder`);
    let soId = null;
    if (soRes.recordset.length > 0) {
      soId = soRes.recordset[0].Id;
    } else {
      const insRes = await pool.request().query(`
        INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, SalesUserId, Status) 
        OUTPUT inserted.Id 
        VALUES ('TEST-REF', 'I', '7017', 'Test', 1, 'DRAFT')
      `);
      soId = insRes.recordset[0].Id;
    }

    let poolId = 1;
    const poolRes = await pool.request().query(`SELECT Id FROM wf.RebatePool WHERE SalesUserId = 1`);
    if (poolRes.recordset.length > 0) {
      poolId = poolRes.recordset[0].Id;
    } else {
      const insRes = await pool.request().query(`INSERT INTO wf.RebatePool (SalesUserId, PeriodYear, PeriodMonth) OUTPUT inserted.Id VALUES (1, 2024, 6)`);
      poolId = insRes.recordset[0].Id;
    }

    const customers = ['7017', '7151', '1203', '7034', '7019'];
    for (const custId of customers) {
      await pool.request().query(`
        INSERT INTO wf.RebateLedger 
        (PoolId, SoId, CustId, GoodId, GoodCode, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount, RemainingAmt, Status)
        VALUES 
        (${poolId}, ${soId}, '${custId}', '001', 'DUMMY-01', 10, 15000, 14000, 1000, 10000, 10000, 'PENDING')
      `);
    }
    console.log("Mock data inserted.");
    
    // Fetch result
    const result = await pool.request().query(`
      SELECT TOP 5
          c.CustID,
          c.CustName,
          (SELECT ISNULL(SUM(RemainingAmt), 0) FROM wf.RebateLedger WHERE CustId = c.CustID AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0) AS RebateBalance,
          (SELECT COUNT(*) FROM dbo.SOHD WHERE CustID = c.CustID AND DocuType = 103 AND DocuStatus = 'Y' AND AppvDocuNo LIKE 'AI%') AS TicketCount
      FROM dbo.EMCust c
      WHERE EXISTS (SELECT 1 FROM wf.RebateLedger WHERE CustId = c.CustID AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0)
    `);
    console.dir(result.recordset);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
