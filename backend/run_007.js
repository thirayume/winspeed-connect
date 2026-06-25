const db = require('./db');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const sqlString = fs.readFileSync(path.join(__dirname, 'migrations', '007_store_weigh_out.sql'), 'utf-8');
    const batches = sqlString.split(/^\s*GO\s*$/im).filter(b => b.trim());
    for (const batch of batches) {
      console.log('Executing batch...');
      await db.query(batch);
    }
    console.log('Migration 007 applied');
    process.exit(0);
  } catch(e) {
    console.error('Migration failed:', e);
    process.exit(1);
  }
}
run();
