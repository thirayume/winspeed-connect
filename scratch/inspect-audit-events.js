const { query, wfQuery, runWithTarget, closeAll } = require('../backend/db');

async function main() {
  await runWithTarget('remote_b', async () => {
    try {
      console.log('--- Inspecting wf.ChangeEvent for CONTROL_TICKET or S1-05 ---');
      const res = await wfQuery(`
        SELECT TOP 20
          EventId, EntityType, EntityId, Action, ReasonCode, ReasonText,
          UserId, IpAddress, CreatedAt,
          CAST(BeforeJson AS NVARCHAR(MAX)) AS BeforeJson,
          CAST(AfterJson AS NVARCHAR(MAX)) AS AfterJson
        FROM wf.ChangeEvent
        WHERE EntityType = 'CONTROL_TICKET' OR ReasonText LIKE '%S1-05%' OR UserId = 'TEST-USER'
        ORDER BY EventId DESC
      `);
      console.log('Found audit events:', res.recordset.length);
      for (const row of res.recordset) {
        console.log({
          EventId: row.EventId,
          EntityId: row.EntityId,
          Action: row.Action,
          ReasonCode: row.ReasonCode,
          ReasonText: row.ReasonText,
          UserId: row.UserId,
          CreatedAt: row.CreatedAt,
          BeforeJson: row.BeforeJson,
          AfterJson: row.AfterJson,
        });
      }

      console.log('\n--- Inspecting current wf.ControlTicketOverlay rows ---');
      const ovRes = await wfQuery(`
        SELECT Id, DocuNo, DocuType, DocuId, GoodCode, ExpiryDate, ExpiryType, PolicySnapshotId, StrictOverrideFlag, ReasonCode, ReasonText, CreatedBy, CreatedAt, UpdatedAt
        FROM wf.ControlTicketOverlay
        ORDER BY Id DESC
      `);
      console.log('Total ControlTicketOverlay rows:', ovRes.recordset.length);
      console.table(ovRes.recordset);

    } catch (err) {
      console.error('Error:', err);
    }
  });
  await closeAll();
}

main();
