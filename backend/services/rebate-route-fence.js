'use strict';

// Route-level entry to the Rebate reset fences. Every HTTP route that reads or
// changes a customer's Rebate balance goes through here, so a reset can stop
// them all and each one knows which balance source applies:
//
//   generation 0  -> the WinSpeed 104 lots (wf.v_RebateAccrualRemaining), as before any reset
//   generation >0 -> the verified shipment ledger (wf.RebateShipmentAccrual + reservations)
//
// On-prem requires an explicitly initialized coordinator and participant.
// Missing rows may indicate restore or corruption and must fail closed.
// Other targets (local development) have no reset coordinator: generation 0.
const { withRebateOperationFence } = require('./rebate-reset-fence');
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');

const UNFENCED = Object.freeze({ environment: null, generation: 0, resetId: null, lastResetAtUtc: null,
  manifestDigest: null, uninitialized: true, fenced: false });

function fail(code, status = 503) { throw Object.assign(new Error(code), { code, status }); }

/** True once the environment has been reset at least once: balances come from the shipment ledger. */
function isShipmentEpoch(epoch) {
  return Boolean(epoch) && Number.isSafeInteger(epoch.generation) && epoch.generation > 0;
}

async function withRebateRouteFence(operation, { db = require('../db'), env = process.env, fence = withRebateOperationFence } = {}) {
  if (typeof operation !== 'function') throw new TypeError('operation is required');
  // db.getTarget is always present on the real module; hermetic route tests replace db with a bare stub.
  const target = typeof db.getTarget === 'function' ? db.getTarget() : null;
  if (target !== 'onprem') return operation(UNFENCED);
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
  if (/^REBATE_RESET_/.test(String(code || ''))) return 'ระบบรีเบทยังไม่พร้อมใช้งานชั่วคราว กรุณาแจ้งผู้ดูแลระบบ';
  return null;
}

module.exports = { UNFENCED, isShipmentEpoch, withRebateRouteFence, routeParticipantFence, rebateFenceMessage };
