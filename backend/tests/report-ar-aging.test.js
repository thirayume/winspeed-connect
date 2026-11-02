'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// UAT accounting case: the AR report must show a ticket's receivable once, the figure WinSpeed's aging and GL 112100 show
const { REPORTS, REPORT_ROLES } = require('../routes/reports').__testing;

const report = REPORTS['ar-aging-summary'];

test('the balance is what is unpaid on invoices, not bookings and sales orders', () => {
  assert.match(report.sql, /FROM dbo\.SOInvHD h/);
  assert.match(report.sql, /h\.RemaAmnt/);
  assert.doesNotMatch(report.sql, /dbo\.SOHD|dbo\.SODT/);
  assert.doesNotMatch(report.sql, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
});

test('a ticket is counted once: its 202 stays and its 107 goes', () => {
  assert.match(report.sql, /h\.Docutype IN \(107, 109, 110, 115, 201, 202\)/);
  assert.match(report.sql, /NOT \(h\.Docutype = 107 AND ISNULL\(h\.CouponFlag, 'N'\) = 'Y'\)/);
});

test('a credit note reduces the balance and old cancelled or replaced documents stay out', () => {
  assert.match(report.sql, /CASE h\.Docutype WHEN 109 THEN -1 ELSE 1 END \* h\.RemaAmnt/);
  assert.match(report.sql, /ISNULL\(h\.DocuStatus, 'N'\) <> 'C'/);
  assert.match(report.sql, /ISNULL\(h\.ReplaceFlag, 'N'\) <> 'Y'/);
});

test('customers show without a credit master row, and the buckets add up to the balance', () => {
  assert.match(report.sql, /LEFT JOIN wf\.CreditMaster cm/);
  assert.deepEqual(report.columns.filter(c => c.aggregation === 'sum').map(c => c.key),
    ['CreditLimit', 'OutstandingBal', 'NotDue', 'Overdue1_30', 'OverdueOver30']);
  for (const key of ['x.DaysLate <= 0', 'x.DaysLate BETWEEN 1 AND 30', 'x.DaysLate > 30']) assert.ok(report.sql.includes(key), key);
});

test('only accounting and management can open it', () => {
  assert.deepEqual(REPORT_ROLES['ar-aging-summary'], ['ACCOUNTING', 'MANAGER', 'ADMIN', 'C_LEVEL']);
});
