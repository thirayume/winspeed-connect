'use strict';
const { isValidStartDate } = require('./data-window');

// Trace responses contain IDs and raw source records at several levels, not
// just the visible chain. Refuse the whole trace if any source is old or its
// date cannot be established; the separate ticket/balance APIs still allow
// eligible carried-forward coupons to be used.
function dateOnly(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value);
  return match && isValidStartDate(match[1]) ? match[1] : null;
}

function traceWithinWindow(result, start) {
  if (!result || !result.chain || result.isAmbiguous || result.truncated || !dateOnly(start)) return false;
  const chain = result.chain;
  const groups = [
    [chain.bookings, 'docuDate'], [chain.deliveries, 'docuDate'],
    [chain.coupons, 'deliveryDocuDate'], [chain.redemptions, 'redemptionDate'],
    [chain.invoices, 'docuDate'],
  ];
  let found = false;
  for (const [rows, dateKey] of groups) {
    if (rows == null) continue;
    if (!Array.isArray(rows)) return false;
    for (const row of rows) {
      found = true;
      const date = dateOnly(row?.[dateKey] ?? (dateKey === 'redemptionDate' ? row?.docuDate : null));
      if (!date || date < start) return false;
    }
  }
  if (chain.booking) {
    found = true;
    const date = dateOnly(chain.booking.docuDate);
    if (!date || date < start) return false;
  }
  return found;
}

module.exports = { traceWithinWindow };
