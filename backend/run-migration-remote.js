const fs = require('fs');
const path = require('path');
const { wfQuery, runWithTarget, pools } = require('./db');

async function runMigration() {
  try {
    const sqlFile = path.join(__dirname, 'migrations', '049_giveaway_item_mapping.sql');
    let sqlContent = fs.readFileSync(sqlFile, 'utf8');
    
    const statements = sqlContent.split(/^GO/im);
    for (const stmt of statements) {
      const cleanStmt = stmt.trim();
      if (cleanStmt) {
        console.log('Executing:', cleanStmt.substring(0, 50) + '...');
        await wfQuery(cleanStmt);
      }
    }
    console.log('Migration completed successfully on remote.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

// Make sure remote pools are initialized before running
runWithTarget('remote', async () => {
  const pl = pools();
  await pl.ready;
  console.log('Connected to remote DB!');
  await runMigration();
});
