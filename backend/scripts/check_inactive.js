const { query } = require('../db');

async function run() {
  try {
    const goods = await query(`SELECT GoodID, GoodCode, GoodName1 FROM dbo.EMGood WHERE GoodName1 LIKE N'%(%'`);
    console.log('Goods with parenthesis:', goods.map(g => g.GoodName1));
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
