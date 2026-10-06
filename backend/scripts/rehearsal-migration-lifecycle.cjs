'use strict';
const { cli } = require('./rehearsal-session.cjs');
const steps = {
  plan: ['./rehearsal-plan.cjs','runPlan'],
  baseline: ['./rehearsal-baseline.cjs','runBaseline'],
  compile: ['./rehearsal-compile.cjs','runCompile'],
  apply: ['./rehearsal-apply.cjs','runApply'],
  'verify-invariants': ['./rehearsal-verify-invariants.cjs','runVerifyInvariants'],
  'rollback-failure': ['./rehearsal-rollback-failure.cjs','runRollbackFailure'],
  concurrency: ['./rehearsal-concurrency.cjs','runConcurrency'],
  oracle: ['./rehearsal-sql2008-oracle.cjs','main'],
  'sql2022-regression': ['./rehearsal-sql2022-regression.cjs','runSql2022Regression']
};
async function main(options = {}) {
  const step = options.step || 'plan';
  if (!Object.hasOwn(steps, step)) throw new Error('Unknown step; all is intentionally disabled: operator checkpoints require discrete steps');
  const [file, fn] = steps[step];
  return { step, report: await require(file)[fn](options) };
}
if (require.main === module) cli(main);
module.exports = { main, steps };

