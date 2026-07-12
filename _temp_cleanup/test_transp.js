const { query } = require('./backend/db');
async function test() {
  try {
    const res = await query("SELECT TOP 5 TranspID, TranspName FROM dbo.EMTransp");
    console.log('EMTransp:', res);
  } catch (e) { console.error(e); }
  process.exit(0);
}
test();
