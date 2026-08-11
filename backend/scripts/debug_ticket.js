const { query } = require('../db');

async function run() {
  try {
    const docuNo = 'I69-02473';
    console.log(`Debugging ticket: ${docuNo}`);
    
    // Get SOID
    const hd = await query(`SELECT SOID, DocuType, TransRegistration, DocuNo, CustName FROM dbo.SOHD WHERE DocuNo = '${docuNo}'`);
    console.log('SOHD:', hd);
    
    if (hd.length > 0) {
      const soid = hd[0].SOID;
      
      const dt = await query(`SELECT ListNo, GoodID, GoodQty2 FROM dbo.SODT WHERE SOID = ${soid}`);
      console.log('SODT:', dt);
      
      const ext = await query(`SELECT SOID, ListNo, IsGiveaway FROM wf.SalesOrderLineExt WHERE SOID = '${soid}'`);
      console.log('SalesOrderLineExt:', ext);
      
      const joined = await query(`
        SELECT dt.ListNo, dt.GoodQty2, sle.IsGiveaway 
        FROM dbo.SODT dt
        LEFT JOIN wf.SalesOrderLineExt sle ON CONVERT(VARCHAR(50), sle.SOID) = CONVERT(VARCHAR(50), dt.SOID) AND sle.ListNo = dt.ListNo
        WHERE dt.SOID = ${soid}
      `);
      console.log('Joined:', joined);
    }
    
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
