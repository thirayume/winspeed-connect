'use strict';
// This diagnostic is intentionally pinned to localhost and only executes SELECT statements.
const lookup = String(process.argv[2] || '').trim();
if (!/^[A-Za-z0-9_/-]{1,25}$/.test(lookup)) {
  console.error('Usage: node backend/scripts/trace-so-path.js <booking-DocuNo-or-AI-number>');
  process.exit(2);
}
process.env.DB_MODE = 'local';
const fs = require('fs');
const path = require('path');
const { sql } = require('../db');
const { getReadPool, closePools } = require('./_db');
(async () => {
  const pool = await getReadPool('local');
  const text = fs.readFileSync(path.resolve(__dirname,'../../sql/maintenance/trace-so-path.sql'),'utf8');
  const result = await pool.request().input('Lookup',sql.VarChar(25),lookup).query(text);
  console.log(JSON.stringify(result.recordsets,null,2));
})().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => closePools('local'));
