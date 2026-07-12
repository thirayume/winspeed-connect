const fs = require('fs');
const { pools } = require('./backend/db');
async function test() {
  try {
    const pl = pools();
    await pl.ready;
    const sqlScript = fs.readFileSync('backend/migrations/039_so_transp_id.sql', 'utf8');
    const statements = sqlScript.split('GO').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      if (stmt.startsWith('--')) continue; // Very basic check
      console.log('Running:', stmt.substring(0, 50) + '...');
      await pl.ownerPool.request().batch(stmt);
    }
    console.log('Migration completed successfully.');
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
test();
