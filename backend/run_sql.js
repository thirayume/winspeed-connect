const fs = require('fs');
const { wfQuery } = require('./db');

async function run() {
  const sql = fs.readFileSync('update_view.sql', 'utf8');
  await wfQuery(sql);
  console.log('Successfully applied update_view.sql');
}
run().catch(console.error).finally(() => process.exit());
