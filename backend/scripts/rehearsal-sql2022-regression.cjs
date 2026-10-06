'use strict';
const runner = require('../run_migrations');
const { withSession, cli } = require('./rehearsal-session.cjs');
async function runSql2022Regression(options = {}) {
  return withSession(options, 'remote_b', async pool => {
    const result = await runner.run({ plan: true, profile: 'remote_b' }, pool);
    const entries = result.plan?.entries;
    if (!entries?.length) throw new Error('Empty SQL2022 plan evidence');
    if (entries.some(e => e.effective.dialect !== 'standard' || e.effective.executed.fileName !== e.file || e.effective.original.hash !== e.effective.executed.hash)) throw new Error('SQL2008 override leaked into SQL2022 plan');
    const rows = (await pool.request().query("SELECT s.name, CONVERT(VARCHAR(40), s.current_value) AS CurrentValue FROM sys.sequences s JOIN sys.schemas sc ON s.schema_id=sc.schema_id WHERE sc.name='wf' AND s.name IN ('WfRefSeq','QuoteRefSeq') ORDER BY s.name")).recordset;
    if (!rows || !['WfRefSeq', 'QuoteRefSeq'].every(n => rows.some(r => r.name === n))) throw new Error('Missing native sequence evidence');
    return { success: true, totalPlanned: entries.length, sql2008OverrideCount: 0, nativeSequences: rows,
      excludedFiles: result.inventory.excludedFiles, excludedApplied: result.plan.excludedApplied,
      status: 'STANDARD_PLAN_AND_SEQUENCE_METADATA_CHECKED', runtimeParity: 'NOT_RUN' };
  });
}
if (require.main === module) cli(runSql2022Regression);
module.exports = { runSql2022Regression };

