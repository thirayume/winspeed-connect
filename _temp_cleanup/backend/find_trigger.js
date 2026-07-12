const db = require('./db');
async function run() {
  try {
    const res = await db.query(`SELECT tr.name, m.definition FROM sys.triggers tr JOIN sys.sql_modules m ON tr.object_id = m.object_id WHERE parent_id = OBJECT_ID('dbo.SOHD')`);
    console.dir(res, { depth: null });
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
