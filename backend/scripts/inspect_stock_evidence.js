'use strict';
const { runWithTarget, wfQuery, query } = require('../db');

async function main() {
  await runWithTarget('remote_b', async () => {
    console.log('--- wf.OperationalStock ---');
    const stock = await wfQuery('SELECT * FROM wf.OperationalStock');
    console.log(stock.recordset);

    console.log('--- EMGood columns ---');
    const goodCols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'EMGood'
    `);
    console.log(goodCols);

    console.log('--- SODT columns ---');
    const sodtCols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SODT'
    `);
    console.log(sodtCols ? sodtCols.map(c => c.COLUMN_NAME).join(', ') : 'null');

    console.log('--- Warehouse tables in dbo or wf ---');
    const whTables = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME LIKE '%ware%' OR TABLE_NAME LIKE '%wh%' OR TABLE_NAME LIKE '%loc%' OR TABLE_NAME LIKE '%stock%'
    `);
    console.log(whTables);

    console.log('--- DocuType in SOHD ---');
    const docTypes = await query(`
      SELECT DocuType, COUNT(*) as cnt
      FROM dbo.SOHD WITH(NOLOCK)
      GROUP BY DocuType
    `);
    console.log(docTypes);



    console.log('--- dbo.TMTruck columns ---');
    const tmTruckCols = await query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TMTruck'
    `);
    console.log(tmTruckCols ? tmTruckCols.map(c => c.COLUMN_NAME).join(', ') : 'null');

    console.log('--- dbo.TMTruck sample ---');
    const tmTruckSample = await query(`
      SELECT TOP 5 * FROM dbo.TMTruck
    `);
    console.log(tmTruckSample);

    console.log('--- wf.TruckType sample ---');
    const truckTypeSample = await wfQuery(`
      SELECT * FROM wf.TruckType
    `);
    console.log(truckTypeSample.recordset);




  });
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
