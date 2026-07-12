const { sql, wfQuery } = require('./db');
async function run() {
  try {
    const p = await wfQuery(`SELECT * FROM wf.RebatePool`);
    console.log('Pools:', p.recordset);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
}
run();
