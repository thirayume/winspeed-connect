const { sql, wfQuery } = require('../db');

async function main() {
  const migration = await wfQuery(`
    SELECT FileName, BatchCount
    FROM wf.SchemaMigration WITH (NOLOCK)
    WHERE FileName = @fileName;
  `, {
    fileName: { type: sql.NVarChar(255), value: '044_winspeed_native_quotation_link.sql' },
  });

  const columns = await wfQuery(`
    SELECT name
    FROM sys.columns WITH (NOLOCK)
    WHERE object_id = OBJECT_ID('wf.Quotation')
      AND name IN (
        'WinspeedQuoteSOID',
        'WinspeedQuoteNo',
        'WinspeedQuoteSyncedAt',
        'WinspeedConfirmSOID',
        'WinspeedConfirmNo',
        'WinspeedConfirmSyncedAt'
      )
    ORDER BY name;
  `);

  const indexes = await wfQuery(`
    SELECT name
    FROM sys.indexes WITH (NOLOCK)
    WHERE object_id = OBJECT_ID('wf.Quotation')
      AND name IN (
        'UX_Quotation_WinspeedQuoteSOID',
        'UX_Quotation_WinspeedConfirmSOID',
        'IX_Quotation_WinspeedQuoteNo',
        'IX_Quotation_WinspeedConfirmNo'
      )
    ORDER BY name;
  `);

  const docs = await wfQuery(`
    SELECT DocuNo, DocuType, AppvFlag, DocuStatus, RefNo, FromFlag
    FROM dbo.SOHD WITH (NOLOCK)
    WHERE DocuNo IN (@quPending, @quApproved, @qcConfirmed)
    ORDER BY DocuNo;
  `, {
    quPending: { type: sql.NVarChar(30), value: 'QU6907-00001' },
    quApproved: { type: sql.NVarChar(30), value: 'QU6907-00002' },
    qcConfirmed: { type: sql.NVarChar(30), value: 'QC69-00002' },
  });

  console.log(JSON.stringify({
    migration: migration.recordset,
    columns: columns.recordset.map((row) => row.name),
    indexes: indexes.recordset.map((row) => row.name),
    sampleDocs: docs.recordset,
  }, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
