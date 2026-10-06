'use strict';
const { withSession, cli } = require('./rehearsal-session.cjs');
async function runApply(options = {}) {
  let before;
  if (options.mode === 'live') {
    const fs = require('fs');
    if (typeof options.baseline !== 'string') throw new Error('Live apply requires a saved engine baseline');
    const receipt = JSON.parse(fs.readFileSync(options.baseline, 'utf8').replace(/^\uFEFF/, ''));
    if ((receipt.report?.evidence || receipt.evidence) !== 'ENGINE_EXECUTED') throw new Error('Mock baseline cannot authorize live apply');
    before = receipt.report?.baseline || receipt.baseline;
  }
  return withSession(options, 'local_rehearsal', async (pool, target) => {
    if (before) {
      const { snapshot, stable } = require('./rehearsal-baseline.cjs');
      const current = await snapshot(pool, target, options.backupSha256);
      const { capturedAt: _oldTime, ...oldState } = before;
      const { capturedAt: _newTime, ...newState } = current;
      if (stable(oldState) !== stable(newState)) throw new Error('Baseline changed before apply; stop and review');
    }
    const result = await require('../run_migrations').run({ plan: false, profile: 'local_rehearsal' }, pool);
    if (!Array.isArray(result.appliedList)) throw new Error('Missing apply evidence');
    return { success: true, applied: result.appliedList, totalApplied: result.appliedList.length, activeProfile: result.targetProfile };
  });
}
if (require.main === module) cli(runApply);
module.exports = { runApply };

