const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');

const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'dbwins_worldfert9',
  options: { trustedConnection: true, trustServerCertificate: true },
  driver: 'msnodesqlv8'
};

async function run() {
  try {
    const pool = await sql.connect(config);
    console.log("Connected to DB.");

    const scripts = [
      'add_indexes.sql',
      'add_dbo_indexes.sql',
      'add_remaining_indexes.sql'
    ];

    for (const script of scripts) {
      const scriptPath = path.join(__dirname, '..', script);
      if (fs.existsSync(scriptPath)) {
        console.log(`Running ${script}...`);
        const content = fs.readFileSync(scriptPath, 'utf-8');
        const batches = content.split(/^\s*GO\s*$/im).filter(b => b.trim());
        for (const batch of batches) {
          try {
            await pool.request().query(batch);
          } catch (err) {
            console.error(`Error in batch from ${script}:`, err.message);
          }
        }
        console.log(`${script} applied.`);
      } else {
        console.log(`Script not found: ${scriptPath}`);
      }
    }

    process.exit(0);
  } catch (e) {
    console.error("Failed to run index scripts:", e);
    process.exit(1);
  }
}

run();
