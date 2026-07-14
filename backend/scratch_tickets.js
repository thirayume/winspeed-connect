const { wfQuery } = require('./db');

async function check() {
  try {
    const r = await wfQuery(`
      SELECT COUNT(*) as c1 FROM dbo.SOHD WHERE DocuType = 103 AND AppvDocuNo LIKE 'AI%'
    `);
    console.log("Count AI tickets: ", r.recordset[0]);
    
    const r2 = await wfQuery(`
      SELECT TOP 5 AppvDocuNo, DocuStatus, DocuDate FROM dbo.SOHD WHERE DocuType = 103 AND AppvDocuNo LIKE 'AI%' ORDER BY DocuDate DESC
    `);
    console.log("Recent AI tickets: ", r2.recordset);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
check();
