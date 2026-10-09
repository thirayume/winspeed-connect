'use strict';

/**
 * UAT full loop 2026-10-09: a booking (103) gives way to its own sales order (104), linked by the 104's RefNo
 * (the approval number since 2022, the booking number before). 103 and 104 have separate counters, so a 104 can
 * share the number of an unrelated booking; matching by number hid open bookings of other customers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { nativeDedupSql } = require('../services/native-status');

test('a booking is hidden only by the 104 that refers to it', () => {
  const s = nativeDedupSql('hd');
  assert.match(s, /s\.RefNo = ISNULL\(b\.AppvDocuNo, b\.DocuNo\)/);
  assert.ok(!/\.DocuNo = hd\.DocuNo/.test(s), 'no match by document number');
});

test('a bill made in the app keeps its booking number; its 104 is the row left out', () => {
  const s = nativeDedupSql('hd');
  assert.match(s, /NOT EXISTS \(SELECT 1 FROM wf\.SalesOrderExt bx/);
  assert.match(s, /SELECT s\.SOID FROM wf\.SalesOrderExt x/);
  assert.match(s, /^hd\.SOID NOT IN \(/, 'one uncorrelated set (correlated forms timed out under a scope filter)');
});

test('the paper trail board uses the same link', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/papertrail'), 'utf8');
  assert.match(src, /\$\{nativeDedupSql\('hd'\)\}/);
  assert.match(src, /PARTITION BY hd\.DocuNo, hd\.DocuType/);
});
