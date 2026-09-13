const { runWithTarget, wfQuery } = require('../backend/db');
runWithTarget('remote_b', async () => {
  const r = await wfQuery(`
    SELECT TOP 10 EventId, EntityType, EntityId, Action, BeforeJson, AfterJson, ReasonText, CreatedAt
    FROM wf.ChangeEvent
    WHERE EntityType = 'REPORT_ASSIGNMENT'
    ORDER BY EventId DESC
  `);
  console.log(JSON.stringify(r.recordset, null, 2));
  process.exit(0);
});
