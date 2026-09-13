const { runWithTarget, wfQuery, sql } = require('../backend/db');
runWithTarget('remote_b', async () => {
  const existing = await wfQuery("SELECT * FROM wf.ReportTemplateAssignment WHERE ReportKey = 'customer-dispatch'");
  if (existing.recordset.length === 0) {
    console.log('Restoring customer-dispatch assignment to TemplateId: 2 from audited before-state...');
    await wfQuery(`
      INSERT INTO wf.ReportTemplateAssignment (ReportKey, TemplateId, Version, IsActive, UpdatedBy, UpdatedAt)
      VALUES ('customer-dispatch', 2, 1, 1, 'SYSTEM', SYSUTCDATETIME())
    `);
    console.log('Successfully restored customer-dispatch assignment.');
  } else {
    console.log('customer-dispatch assignment already exists:', existing.recordset[0]);
  }
  process.exit(0);
});
