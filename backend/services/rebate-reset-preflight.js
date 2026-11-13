'use strict';

// Read-only building block. This does not start a reset and is not exposed by
// an API until the coordinator, global fence and evidence ledger are ready.
const { resolvePhysicalResetTargets } = require('./rebate-reset-targets');
const REQUIRED_OBJECTS = Object.freeze([
  'RebateClaim', 'RebateClaimLine', 'FertilizerTicket', 'RebateConversionSourceAllocation',
  'RebateConversionRequest', 'RebateResetParticipant', 'RebateShipmentEvidence',
  'RebateResetReceipt', 'RebateResetClaimCancellation', 'RebateShipmentAccrual', 'RebateShipmentReservation',
]);
const PRIMARY_OBJECTS = Object.freeze(['RebateResetCoordinator', 'RebateResetAttempt', 'RebateResetAttemptTarget']);
function fail(code) { throw Object.assign(new Error(code), { code, status: 503 }); }
const clean = value => String(value || '').trim().toLowerCase();

async function preflightResetTargets({ env = process.env, db = require('../db'), tupleResolver } = {}) {
  const targets = resolvePhysicalResetTargets(env, tupleResolver);
  const results = [];
  for (const target of targets) {
    const required = clean(target.name) === clean(env.ONPREM_DB_NAME) ? [...REQUIRED_OBJECTS, ...PRIMARY_OBJECTS] : REQUIRED_OBJECTS;
    const result = await db.runWithTarget('onprem', () => db.wfQuery(`SELECT DB_NAME() AS DatabaseName,
      CAST(@@SERVERNAME AS nvarchar(128)) AS ServerName,
      ${required.map(name => `CASE WHEN OBJECT_ID('wf.${name}','U') IS NULL THEN 0 ELSE 1 END AS [${name}]`).join(',\n      ')}`), target.name);
    const row = result.recordset?.[0];
    if (!row || clean(row.DatabaseName) !== clean(target.database) || clean(row.ServerName) !== clean(target.expectedServerName)) {
      fail('REBATE_RESET_TARGET_IDENTITY_MISMATCH');
    }
    const missing = required.filter(name => Number(row[name]) !== 1);
    results.push({ name: target.name, ready: missing.length === 0, missing });
  }
  return { ready: results.every(item => item.ready), targets: results };
}

module.exports = { preflightResetTargets, REQUIRED_OBJECTS, PRIMARY_OBJECTS };
