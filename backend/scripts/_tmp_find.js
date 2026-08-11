require('dotenv').config({ path: 'C:/MyWork/WorldFert/winspeed-frontend/backend/.env', quiet: true });
const { wfQuery, sql } = require('../db');
const rs = (r) => (Array.isArray(r) ? r : r.recordset || r);
const DOC = process.argv[2] || 'I69-02420';
const SCHEMA = process.argv[3] || 'dbo';

(async () => {
  // คอลัมน์ข้อความทุกคอลัมน์ใน schema นี้ (ตารางจริงเท่านั้น ไม่รวม view)
  const cols = rs(await wfQuery(`
    SELECT c.TABLE_NAME t, c.COLUMN_NAME n
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN INFORMATION_SCHEMA.TABLES tb
      ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_TYPE = 'BASE TABLE'
    WHERE c.TABLE_SCHEMA = @s
      AND c.DATA_TYPE IN ('char','varchar','nchar','nvarchar')
      AND (c.CHARACTER_MAXIMUM_LENGTH = -1 OR c.CHARACTER_MAXIMUM_LENGTH >= 8)
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    { s: { type: sql.NVarChar(20), value: SCHEMA } }));

  const byTable = {};
  for (const c of cols) (byTable[c.t] ||= []).push(c.n);

  const hits = [];
  for (const [t, ns] of Object.entries(byTable)) {
    const where = ns.map((n) => `[${n}] = @d`).join(' OR ');
    try {
      const r = rs(await wfQuery(
        `SELECT COUNT(*) c FROM [${SCHEMA}].[${t}] WITH (NOLOCK) WHERE ${where}`,
        { d: { type: sql.NVarChar(50), value: DOC } }));
      const n = Number(r[0].c);
      if (n > 0) {
        // หาว่าคอลัมน์ไหนที่ match เพื่อรายงานให้ชัด
        const which = [];
        for (const col of ns) {
          const q = rs(await wfQuery(
            `SELECT COUNT(*) c FROM [${SCHEMA}].[${t}] WITH (NOLOCK) WHERE [${col}] = @d`,
            { d: { type: sql.NVarChar(50), value: DOC } }));
          if (Number(q[0].c) > 0) which.push(`${col}=${q[0].c}`);
        }
        hits.push({ table: t, rows: n, cols: which.join(', ') });
      }
    } catch (e) { /* ตารางที่อ่านไม่ได้ ข้าม */ }
  }

  console.log(`\n=== ${SCHEMA} · ค้น "${DOC}" ในคอลัมน์ข้อความ ${cols.length} คอลัมน์ / ${Object.keys(byTable).length} ตาราง ===`);
  if (!hits.length) console.log('  ไม่พบ');
  for (const h of hits) console.log(`  ${h.table.padEnd(24)} ${String(h.rows).padStart(4)} แถว  (${h.cols})`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
