require('dotenv').config();
const db = require('./db');
async function check() {
  await db.ownerReady;
  const result = await db.ownerPool.request().query("SELECT * FROM wf.AppUser WHERE Username = 'admin'");
  console.table(result.recordset);
  process.exit(0);
}
check().catch(console.error);
