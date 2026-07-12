const { wfQuery } = require('./db');
async function test() {
  const r = await wfQuery(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='WeighInbox'`);
  console.log(r.recordset);
}
test().catch(console.error);
