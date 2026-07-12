const db = require('./db');
async function run() {
  try {
    const q = await db.query(`SELECT tr.name, m.definition FROM sys.triggers tr JOIN sys.sql_modules m ON tr.object_id = m.object_id WHERE m.definition LIKE '%RAISERROR @errno%'`);
    for (const row of q) {
      let def = row.definition;
      def = def.replace(/raiserror @errno @errmsg/gi, 'RAISERROR (@errmsg, 16, 1)');
      def = def.replace(/CREATE trigger/i, 'ALTER trigger');
      await db.query(def);
      console.log('Fixed', row.name);
    }
    console.log('Done');
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
}
run();
