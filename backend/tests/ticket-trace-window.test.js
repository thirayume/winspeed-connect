'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { traceWithinWindow } = require('../services/ticket-trace-window');

const start = '2026-01-01';
function recent() { return { chain: { bookings: [{ docuDate: '2026-01-01' }],
  deliveries: [{ docuDate: new Date('2026-03-01T00:00:00Z') }],
  coupons: [{ deliveryDocuDate: '2026-03-01' }],
  redemptions: [{ redemptionDate: '2026-03-02' }], invoices: [{ docuDate: '2026-03-03' }] } }; }

test('allows a complete trace only when every source is inside the window', () => {
  assert.equal(traceWithinWindow(recent(), start), true);
  for (const [group, field] of [['bookings', 'docuDate'], ['deliveries', 'docuDate'], ['coupons', 'deliveryDocuDate'], ['redemptions', 'redemptionDate'], ['invoices', 'docuDate']]) {
    const input = recent(); input.chain[group][0][field] = '2025-12-31';
    assert.equal(traceWithinWindow(input, start), false, group);
    input.chain[group][0][field] = null;
    assert.equal(traceWithinWindow(input, start), false, `${group}: unknown date`);
  }
});

test('hides unresolved, ambiguous, truncated and undated source chains', () => {
  assert.equal(traceWithinWindow({ chain: {} }, start), false);
  assert.equal(traceWithinWindow({ ...recent(), isAmbiguous: true }, start), false);
  assert.equal(traceWithinWindow({ ...recent(), truncated: true }, start), false);
  assert.equal(traceWithinWindow({ chain: { redemptions: [{ docuDate: '2026-01-02' }] } }, start), true);
});
