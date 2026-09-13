const { query, runWithTarget } = require('../db');

runWithTarget('remote_b', async () => {
  const dtCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'WFRedemtionDT'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('--- WFRedemtionDT COLUMNS ---');
  console.table(dtCols);

  const hdCols = await query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'WFRedemtionHD'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('--- WFRedemtionHD COLUMNS ---');
  console.table(hdCols);
}).catch(console.error);
