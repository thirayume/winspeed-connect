require('dotenv').config({ quiet: true });
const fs = require('fs');
const { wfQuery } = require('../db');
const rs = (r) => (Array.isArray(r) ? r : r.recordset || r);
(async () => {
  const t = fs.readFileSync('../sql/maintenance/trace-document.sql', 'utf8').replace(/^\uFEFF/, '');
  const out = await wfQuery(t);
  const sets = out.recordsets || [rs(out)];
  console.log('จำนวนชุดผลลัพธ์: ' + sets.length);
  sets.forEach((s, i) => {
    const label = s.length ? (s[0]['ส่วน'] || s[0]['ผล'] || '(ไม่มีป้าย)') : '(ว่าง)';
    console.log(`  [${i + 1}] ${String(label).slice(0, 52).padEnd(52)} ${s.length} แถว`);
  });
  process.exit(0);
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
