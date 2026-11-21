'use strict';
// Prints this stack's Rebate reset manifest digest (64 hex) from its own environment, nothing else.
// Used by docs/deploy/r740/host/Refresh-UAT.ps1 for docs/deploy/r740/sql/r740-uat-rebate-adopt.sql.
// Reads no database and no secret; the digest covers database and server names only.
const { resolvePhysicalResetTargets } = require('../services/rebate-reset-targets');
const { digestTargets } = require('../services/rebate-reset-fence');
try {
  process.stdout.write(digestTargets(resolvePhysicalResetTargets(process.env)) + '\n');
} catch (e) {
  process.stderr.write(String(e?.code || 'REBATE_MANIFEST_UNAVAILABLE') + '\n');
  process.exit(1);
}
