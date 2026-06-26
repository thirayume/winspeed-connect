const fs = require('fs');
const path = require('path');
const db = require('./db');

async function run() {
  try {
    await db.ownerReady;
    const pool = db.ownerPool;
    const target = db.getTarget();
    console.log(`Connected to DB (Target: ${target}).`);

    const schema3 = fs.readFileSync(path.join(__dirname, 'migrations', '003_schema_ext.sql'), 'utf-8');
    console.log("Running 003_schema_ext...");
    const batches = schema3.split(/^\s*GO\s*$/im).filter(b => b.trim());
    for (const batch of batches) {
      await pool.request().query(batch);
    }
    console.log("003_schema_ext applied.");

    const mdata = fs.readFileSync(path.join(__dirname, 'migrations', 'migration_2025_ext.sql'), 'utf-8');
    console.log("Running migration_2025_ext...");
    await pool.request().query(mdata);
    console.log("Ext data migration applied.");

    const view4 = fs.readFileSync(path.join(__dirname, 'migrations', '004_view_union.sql'), 'utf-8');
    console.log("Running 004_view_union...");
    const batches4 = view4.split(/^\s*GO\s*$/im).filter(b => b.trim());
    for (const batch of batches4) {
      await pool.request().query(batch);
    }
    console.log("004_view_union applied.");

    const sp5 = fs.readFileSync(path.join(__dirname, 'migrations', '005_sp_confirm_so.sql'), 'utf-8');
    console.log("Running 005_sp_confirm_so...");
    const batches5 = sp5.split(/^\s*GO\s*$/im).filter(b => b.trim());
    for (const batch of batches5) {
      await pool.request().query(batch);
    }
    console.log("005_sp_confirm_so applied.");

    const view6 = fs.readFileSync(path.join(__dirname, 'migrations', '006_customer_ext.sql'), 'utf-8');
    console.log("Running 006_customer_ext...");
    const batches6 = view6.split(/^\s*GO\s*$/im).filter(b => b.trim());
    for (const batch of batches6) {
      await pool.request().query(batch);
    }
    console.log("006_customer_ext applied.");

    process.exit(0);
  } catch (e) {
    console.error("Migration failed:", e);
    process.exit(1);
  }
}

run();
