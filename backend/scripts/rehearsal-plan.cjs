'use strict';
const runner = require('../run_migrations');
const { withSession, cli } = require('./rehearsal-session.cjs');
async function runPlan(options = {}) {
  const profile = options.profile || 'local_rehearsal';
  return withSession(options, profile, async pool => {
    const result = await runner.run({ plan: true, profile }, pool);
    if (!result.plan?.entries?.length || result.targetProfile !== profile) throw new Error('Missing plan evidence');
    return { success: true, plan: true, activeProfile: profile, totalPlanned: result.plan.entries.length,
      planFiles: result.plan.entries.map(e => e.file), excludedFiles: result.inventory.excludedFiles,
      excludedApplied: result.plan.excludedApplied,
      artifacts: result.plan.entries.map(e => ({ file: e.file, status: e.status, dialect: e.effective.dialect,
        executedFile: e.effective.executed.fileName, hash: e.checksum, batches: e.batchCount })) };
  });
}
if (require.main === module) cli(runPlan);
module.exports = { runPlan };

