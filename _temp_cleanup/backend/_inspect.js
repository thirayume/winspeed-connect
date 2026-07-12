const { wfQuery } = require('./db');
async function test() {
  const users = await wfQuery(`SELECT Id, Username, DisplayName, EmpId, IsActive FROM wf.AppUser WHERE IsActive = 0`);
  console.table(users.recordset);
  process.exit(0);
}
test().catch(console.error);
