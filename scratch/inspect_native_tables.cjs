const d = require('../backend/db');
(async () => {
  await d.runWithTarget('remote_b', async () => {
    const id = await d.query('SELECT DB_NAME() AS db, @@SERVERNAME AS srv');
    console.log('Target:', id[0]);
    if (id[0].db !== 'dbwins_worldfert9_test_v2') throw new Error('Wrong DB!');

    // Find tables with GL, Journal, Inv, etc.
    const tables = await d.query(`
      SELECT s.name AS schema_name, t.name AS table_name
      FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.name LIKE '%GL%' OR t.name LIKE '%Journal%' OR t.name LIKE '%Inv%' OR t.name LIKE '%AR%' OR t.name LIKE '%Book%'
      ORDER BY s.name, t.name
    `);
    console.log('Matching tables:', JSON.stringify(tables, null, 2));

    // Check SOInvHD columns
    const invCols = await d.query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SOInvHD'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('dbo.SOInvHD columns:', invCols.map(c => c.COLUMN_NAME).join(', '));
  });
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
}).finally(async () => {
  for (const p of Object.values(d.pools('remote_b'))) if (p && p.close) await p.close();
});
