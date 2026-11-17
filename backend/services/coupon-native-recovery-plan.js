'use strict';

// Arithmetic only: this is not a proof, database writer, or authorization to
// reverse a WinSpeed cut. A future transaction must first verify immutable
// source/balance evidence and a durable, uniquely keyed reversal ledger while
// holding all relevant locks; it must verify the net native balance change
// made by WinSpeed and update reservation and audit atomically. The expected
// increase is evidence to check, not a command to credit the native balance a
// second time. No route calls this candidate helper.
const MAX_QTY = 999999999999n; // DECIMAL(12,4)
const MAX_BALANCE = 999999999999999999n; // DECIMAL(18,4)

function invalid(code) { throw Object.assign(new Error(code), { code }); }
function units(value, max) {
  // Strings are required so driver rounding or scientific notation cannot
  // silently change a quantity. Callers must preserve SQL decimal precision.
  if (typeof value !== 'string' || value.length > 24 || !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value))
    invalid('RECOVERY_QUANTITY_INVALID');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  if (amount > max) invalid('RECOVERY_QUANTITY_INVALID');
  return amount;
}
function decimal(amount) {
  return `${amount / 10000n}.${String(amount % 10000n).padStart(4, '0')}`;
}

function planNativeRecovery(input) {
  if (!input || !['RESERVED', 'CONSUMED'].includes(input.reservationStatus))
    invalid('RECOVERY_RESERVATION_STATE_INVALID');
  const settled = units(input.originalSettledQty, MAX_QTY);
  const returned = units(input.previouslyReturnedQty, MAX_QTY);
  const target = units(input.targetSettledQty, MAX_QTY);
  const reserved = units(input.reservedQty, MAX_QTY);
  const consumed = units(input.consumedQty, MAX_QTY);
  const before = units(input.evidenceBalanceBefore, MAX_BALANCE);
  const after = units(input.evidenceBalanceAfter, MAX_BALANCE);
  if (settled === 0n || reserved === 0n || settled > reserved || before < after || before - after !== settled || returned > settled ||
      consumed > reserved || (input.reservationStatus === 'CONSUMED' && consumed !== reserved) ||
      (input.reservationStatus === 'RESERVED' && consumed >= reserved))
    invalid('RECOVERY_EVIDENCE_INCONSISTENT');
  const current = settled - returned;
  if (consumed < current) invalid('RECOVERY_RESERVATION_INCONSISTENT');
  // Increasing the source quantity needs a new authorization, never a negative
  // reversal. An already-returned quantity cannot be returned a second time.
  if (target > current) invalid('RECOVERY_NEW_AUTHORIZATION_REQUIRED');
  const refund = current - target;
  const consumedAfter = consumed - refund;
  return {
    pendingReturnQty: decimal(refund),
    expectedNativeNetIncrease: decimal(refund),
    totalReturnedAfter: decimal(returned + refund),
    settledAfter: decimal(target),
    reservationConsumedAfter: decimal(consumedAfter),
    // Keep the returned amount reserved for controlled follow-up. It is not
    // made available to another bill by this calculation.
    reservationStatusAfter: consumedAfter === reserved ? 'CONSUMED' : 'RESERVED',
    requiresAtomicProof: true,
  };
}
module.exports = { planNativeRecovery };
