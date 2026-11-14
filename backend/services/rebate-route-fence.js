'use strict';

// Route-level entry to the Rebate reset fences. Every HTTP route that reads or
// changes a customer's Rebate balance goes through here, so a reset can stop
// them all and each one knows which balance source applies:
//
//   generation 0  -> the WinSpeed 104 lots (wf.v_RebateAccrualRemaining), as before any reset
//   generation >0 -> the verified shipment ledger (wf.RebateShipmentAccrual + reservations)
//
// On-prem with the Rebate Pool switched on (REBATE_POOL_103_ENABLED=true) requires an
// explicitly initialized coordinator and participant. Missing rows may indicate
// restore or corruption and must fail closed.
//
// On-prem with the Rebate Pool switched off, no reset entry point is reachable
// (they all check the same switch), so the routes behave exactly as before the
// Pool existed: generation 0, unfenced. That is allowed only while the
// environment has never been reset; a database that carries a reset must not
// be served from the pre-reset balance just because the switch was turned off.
//
// Other targets (local development) have no reset coordinator: generation 0.
const { withRebateOperationFence } = require('./rebate-reset-fence');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');

const POOL_SWITCH = 'REBATE_POOL_103_ENABLED';
const UNFENCED = Object.freeze({ environment: null, generation: 0, resetId: null, lastResetAtUtc: null,
  manifestDigest: null, uninitialized: true, fenced: false });

function fail(code, status = 503) { throw Object.assign(new Error(code), { code, status }); }

/** True once the environment has been reset at least once: balances come from the shipment ledger. */
function isShipmentEpoch(epoch) {
  return Boolean(epoch) && Number.isSafeInteger(epoch.generation) && epoch.generation > 0;
}

function rebatePoolEnabled(env = process.env) { return env[POOL_SWITCH] === 'true'; }

// With the Pool switched off the pre-reset balance may be used only if this
// environment was never reset: no coordinator row, or one still at generation 0
// and READY. Reads the primary database, where the coordinator lives.
async function assertEnvironmentNeverReset({ db = require('../db'), env = process.env } = {}) {
  const kind = String(env.ONPREM_TARGET_KIND || 'uat').trim().toLowerCase();
  const primary = String(env.ONPREM_DB_NAME || '').trim();
  if (!['uat', 'production'].includes(kind) || !primary) fail('REBATE_RESET_ENVIRONMENT_INVALID');
  let row;
  try {
    row = (await db.runWithDb(primary, () => db.wfQuery(
      'SELECT TOP 1 Generation, Phase FROM wf.RebateResetCoordinator WHERE EnvironmentKind=@kind',
      { kind: { type: db.sql.VarChar(16), value: kind } }))).recordset?.[0];
  } catch (err) {
    // Before migration 197 there is no coordinator table, so no reset can have happened.
    if (/Invalid object name 'wf\.RebateResetCoordinator'/i.test(String(err?.message || ''))) return;
    throw err;
  }
  if (row && (Number(row.Generation) !== 0 || row.Phase !== 'READY')) fail('REBATE_POOL_DISABLED_AFTER_RESET');
}

async function withRebateRouteFence(operation, { db = require('../db'), env = process.env, fence = withRebateOperationFence,
  neverReset = assertEnvironmentNeverReset } = {}) {
  if (typeof operation !== 'function') throw new TypeError('operation is required');
  // db.getTarget is always present on the real module; hermetic route tests replace db with a bare stub.
  const target = typeof db.getTarget === 'function' ? db.getTarget() : null;
  if (target !== 'onprem') return operation(UNFENCED);
  if (!rebatePoolEnabled(env)) {
    await neverReset({ db, env });
    return operation(UNFENCED);
  }
  return fence(epoch => operation({ ...epoch, uninitialized: false, fenced: true }), { env, db });
}

// Call with a query bound to the business transaction, before any balance is
// read. The transaction must stay open until the mutation commits.
async function routeParticipantFence(query, epoch, { participantFence = acquireRebateParticipantFence } = {}) {
  if (typeof query !== 'function' || !epoch) fail('REBATE_RESET_PARTICIPANT_MISMATCH');
  if (epoch.fenced !== true) return epoch;
  if (epoch.uninitialized) fail('REBATE_RESET_PARTICIPANT_MISMATCH');
  await participantFence(query, epoch);
  return epoch;
}

// Thai message for the fence failures a user can meet; anything else stays generic.
function rebateFenceMessage(code) {
  if (code === 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED' || code === 'REBATE_RESET_PARTICIPANT_UNAVAILABLE') {
    return 'ระบบกำลังเริ่มยอดรีเบทใหม่ กรุณารอสักครู่แล้วลองอีกครั้ง';
  }
  if (code === 'REBATE_RESET_TARGET_NOT_ALLOWED') return 'ฐานข้อมูลที่เลือกอยู่ไม่อยู่ในชุดที่ใช้งานรีเบทได้';
  if (code === 'REBATE_POOL_DISABLED_AFTER_RESET') {
    return 'ฐานข้อมูลนี้เริ่มยอดรีเบทใหม่แล้ว แต่ระบบ Rebate Pool ถูกปิดอยู่ กรุณาแจ้งผู้ดูแลระบบ';
  }
  if (/^REBATE_RESET_/.test(String(code || ''))) return 'ระบบรีเบทยังไม่พร้อมใช้งานชั่วคราว กรุณาแจ้งผู้ดูแลระบบ';
  return null;
}

module.exports = { POOL_SWITCH, UNFENCED, isShipmentEpoch, rebatePoolEnabled, assertEnvironmentNeverReset,
  withRebateRouteFence, routeParticipantFence, rebateFenceMessage };
