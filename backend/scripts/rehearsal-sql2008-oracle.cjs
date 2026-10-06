'use strict';
const { withSession, cli } = require('./rehearsal-session.cjs');
const { ORACLE_CONVERSION_FIXTURES, safeIntSql, safeBigIntSql, safeDecimalSql } = require('../services/sql-conversion-helpers');
const crypto = require('crypto');
function cases() {
  const result = [];
  for (const f of ORACLE_CONVERSION_FIXTURES) {
    if (f.expectedInt !== undefined) result.push({ input:f.input,type:'INT',expected:f.expectedInt == null ? null : String(f.expectedInt) });
    if (f.expectedBigInt !== undefined || f.expectedBigIntString !== undefined) result.push({ input:f.input,type:'BIGINT',expected:f.expectedBigIntString !== undefined ? f.expectedBigIntString : f.expectedBigInt == null ? null : String(f.expectedBigInt) });
    if (f.expectedDecimal !== undefined || f.expectedDecimalString !== undefined) {
      if (f.expectedDecimalString === undefined && f.expectedDecimal !== null) throw new Error('Decimal fixture needs lossless expected string');
      result.push({ input:f.input,type:`DECIMAL(${f.precision ?? 12},${f.scale ?? 2})`,precision:f.precision ?? 12,scale:f.scale ?? 2,expected:f.expectedDecimalString ?? null });
    }
  }
  return result;
}
async function main(options = {}) {
  const profile = options.profile || 'local_rehearsal';
  return withSession(options, profile, async pool => {
    const rows = [];
    const fixtures = cases();
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      const expr = f.input == null ? 'NULL' : "N'" + String(f.input).replace(/'/g,"''") + "'";
      const converted = profile === 'remote_b' ? `TRY_CAST(${expr} AS ${f.type})` :
        f.type === 'INT' ? safeIntSql(expr) : f.type === 'BIGINT' ? safeBigIntSql(expr) : safeDecimalSql(expr,f.precision,f.scale);
      const row = (await pool.request().query(`SELECT CONVERT(VARCHAR(80), ${converted}) AS ConvertedValStr /* oracle:${i} */`)).recordset?.[0];
      if (!row || (row.ConvertedValStr !== null && typeof row.ConvertedValStr !== 'string')) throw new Error('Lossless oracle transport required');
      rows.push({ id:i, type:f.type, actual:row.ConvertedValStr, expected:f.expected, matches:row.ConvertedValStr === f.expected });
    }
    const fixtureHash = crypto.createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
    return { success: rows.every(r=>r.matches), profile, fixtureHash, rows,
      status: rows.every(r=>r.matches) ? 'FIXTURE_VALUES_MATCH' : 'SEMANTIC_MISMATCH',
      pairedComparison: 'Compare both engine receipts with identical fixtureHash; a mismatch blocks acceptance.' };
  });
}
function compareOracleReceipts(a,b) {
  if (a.evidence !== 'ENGINE_EXECUTED' || b.evidence !== 'ENGINE_EXECUTED' || a.profile !== 'local_rehearsal' || b.profile !== 'remote_b' ||
      !a.fixtureHash || a.fixtureHash !== b.fixtureHash || !a.rows?.length || a.rows.length !== b.rows?.length) throw new Error('Invalid paired engine evidence');
  const differences = a.rows.filter((r,i) => r.id !== b.rows[i].id || r.actual !== b.rows[i].actual || !r.matches || !b.rows[i].matches);
  return { success: differences.length === 0, differences };
}
if (require.main === module) cli(async options => {
  const result = await main(options);
  if (!result.success) process.exitCode=1;
  return result;
});
module.exports = { main, cases, compareOracleReceipts };

