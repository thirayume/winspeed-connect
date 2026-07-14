const { wfQuery } = require('./db');

async function check() {
  try {
    const r = await wfQuery(`
      SELECT COUNT(*) as c1 FROM dbo.SOHD WHERE TransRegistration = N'ตั๋วคุม'
    `);
    console.log("Count TransRegistration=ตั๋วคุม: ", r.recordset[0]);
    
    const r2 = await wfQuery(`
      SELECT TOP 5 SOID, DocuType, DocuNo, AppvDocuNo, DocuStatus, DocuDate 
      FROM dbo.SOHD 
      WHERE TransRegistration = N'ตั๋วคุม' 
      ORDER BY DocuDate DESC
    `);
    console.log("Recent tickets (TransRegistration=ตั๋วคุม): ", r2.recordset);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
check();
