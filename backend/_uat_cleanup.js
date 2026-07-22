const { wfQuery } = require('./db');

async function run() {
  try {
    console.log('Running migration...');
    await wfQuery("ALTER TABLE wf.SalesOrder DROP CONSTRAINT IF EXISTS chk_SO_Status;");
    await wfQuery("ALTER TABLE wf.SalesOrder ADD CONSTRAINT chk_SO_Status CHECK ([Status] IN ('DRAFT', 'CONFIRMED', 'PICKING', 'LOADED', 'SHIPPED', 'IMPORTED', 'CANCELLED', 'QUOTATION'));");
    
    console.log('Running cleanup...');
    const tables = ['wf.SalesOrderAudit', 'wf.WeighTicket', 'wf.SalesOrderLineExt', 'wf.SalesOrderExt', 'wf.SalesOrderLine'];
    for (const t of tables) {
      await wfQuery(`DELETE FROM ${t}`);
    }

    await wfQuery(`DELETE FROM dbo.SODT WHERE SOID IN (SELECT SOID FROM dbo.SOHD WHERE Remark LIKE 'UAT-%')`);
    await wfQuery(`DELETE FROM dbo.SOHDRemark WHERE SOID IN (SELECT SOID FROM dbo.SOHD WHERE Remark LIKE 'UAT-%')`);
    await wfQuery(`DELETE FROM dbo.SOHD WHERE Remark LIKE 'UAT-%'`);
    
    // For quotations
    await wfQuery(`DELETE FROM wf.QuotationSourceSO`);
    await wfQuery(`DELETE FROM wf.QuotationLine`);
    await wfQuery(`DELETE FROM wf.Quotation`);

    await wfQuery(`DELETE FROM wf.SalesOrder`);
    // Reset sequence
    try { await wfQuery(`DBCC CHECKIDENT ('wf.SalesOrder', RESEED, 90000)`); } catch(e){}
    
    console.log('Cleaned up successfully');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
