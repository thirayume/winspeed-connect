const db = require('./db');
async function run() {
  try {
    const res = await db.query(`SELECT tr.name, m.definition FROM sys.triggers tr JOIN sys.sql_modules m ON tr.object_id = m.object_id WHERE parent_id = OBJECT_ID('dbo.SOHD')`);
    for (const row of res) {
      let def = row.definition;
      if (def.toLowerCase().includes('raiserror @errno @errmsg')) {
        def = def.replace(/raiserror @errno @errmsg/gi, 'RAISERROR (@errmsg, 16, 1)');
        def = def.replace(/CREATE trigger/i, 'ALTER trigger');
        await db.query(def);
        console.log('Trigger fixed:', row.name);
      }
    }
    console.log('All triggers fixed');
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
