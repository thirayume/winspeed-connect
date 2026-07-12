require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function run() {
  await db.ownerReady;
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '000_logins.sql'), 'utf8');
  const batches = sql.split(/^\s*GO\s*$/im).filter(b => b.trim());
  for (const batch of batches) {
    console.log("Running batch:", batch.substring(0, 30).replace(/\n/g, ' '));
    try {
      await db.wfQuery(batch);
      console.log("Batch OK");
    } catch (e) {
      console.error("Batch Error:", e.message);
    }
  }
  console.log("000_logins done");
  process.exit(0);
}
run();
