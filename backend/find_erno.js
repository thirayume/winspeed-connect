const db = require('./db');
async function run() {
  try {
    const res = await db.query("SELECT OBJECT_NAME(object_id) AS obj_name, definition FROM sys.sql_modules WHERE definition LIKE '%@erno%'");
    console.dir(res.recordset, { depth: null });
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
