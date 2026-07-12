const { query } = require('./db');
async function test() {
  const h = await query("SELECT TOP 1 * FROM dbo.SOHDRemark");
  console.log("SOHDRemark:", Object.keys(h[0] || {}));
  const d = await query("SELECT TOP 1 * FROM dbo.SODTRemark");
  console.log("SODTRemark:", Object.keys(d[0] || {}));
  process.exit(0);
}
test().catch(console.error);
