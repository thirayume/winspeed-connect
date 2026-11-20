'use strict';
// Owner decisions of 20 Nov 2026: 116 ShipDate policy, following a deleted/re-posted 107, booking approvers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/route-harness.cjs');
h.installDbStub(() => []);
const { followInvoices } = require('../services/invoice-107-followup');
const { capabilitiesFor } = require('../services/role-capabilities');
const { POLICY_DEFINITIONS } = require('../services/policy-contract');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8');

test('116 ShipDate: setting 0/1/2, default warn; only BLOCK keeps the old refusal; a late cut is recorded', () => {
  const up = read('252_native_116_shipdate_policy.sql');
  assert.match(up, /^-- @transaction/);
  assert.match(up, /NATIVE_116_SHIPDATE_POLICY', '1'/);
  assert.match(up, /AND h\.DocuDate<=@Today AND \(h\.ShipDate>=@Today OR @ShipPolicy<>2\);/);
  assert.doesNotMatch(up, /AND h\.DocuDate<=@Today AND h\.ShipDate>=@Today;/);
  assert.match(up, /IF @ShipPolicy=1 AND @ShipDate<@Today[\s\S]*'TICKET_CUT_AFTER_SHIPDATE'/);
  assert.match(up, /wf\.fn_IsInitialNativeUatTarget\(\)<>1/, 'the writer still refuses Production');
  const down = read('down/252_native_116_shipdate_policy.down.sql');
  assert.match(down, /AND h\.DocuDate<=@Today AND h\.ShipDate>=@Today;/);
  const d = POLICY_DEFINITIONS.NATIVE_116_SHIPDATE_POLICY;
  assert.deepEqual([d.type, d.min, d.max, d.default], ['INT', 0, 2, 1]);
});

test('107 follow-up: a ticket cut follows WinSpeed\'s invoice and a deleted one is recorded', async () => {
  const updates = [], incidents = [];
  const query = async (text, inputs) => {
    if (/FROM wf\.CouponRedemptionMirror m/.test(text)) return { recordset: [
      { RedemtionID: 1, CouponID: 10, OldId: 500, OldNo: 'J-OLD', NewId: 501, NewNo: 'J-NEW', OldGone: 1 },
      { RedemtionID: 2, CouponID: 11, OldId: 600, OldNo: 'N-OLD', NewId: null, NewNo: null, OldGone: 1 },
      { RedemtionID: 3, CouponID: 12, OldId: null, OldNo: null, NewId: 700, NewNo: 'J-FIRST', OldGone: 0 },
    ] };
    updates.push(inputs); return { recordset: [] };
  };
  const res = await followInvoices({ query, recordIncident: async i => incidents.push(i) });
  assert.equal(res.checked, 3);
  assert.deepEqual(updates.map(u => [u.rid.value, u.newId.value, u.newNo.value]), [[1, 501, 'J-NEW'], [2, null, null], [3, 700, 'J-FIRST']]);
  assert.deepEqual(incidents.map(i => i.type), ['INVOICE_107_REPLACED', 'INVOICE_107_REPLACED'], 'a first 107 is not an incident');
  assert.match(incidents[0].detail, /J-OLD.*ออกใหม่เป็น J-NEW/);
  assert.match(incidents[1].detail, /ยังไม่ออกใหม่/);
  const types = require('../services/rule-incidents').INCIDENT_TYPES;
  assert.equal(types.INVOICE_107_REPLACED.severity, 'INFO');
  assert.equal(types.TICKET_CUT_AFTER_SHIPDATE.severity, 'WARN');
});

test('booking approval belongs to the desk, accounting and management, not to SALES', () => {
  const saved = process.env.NATIVE_BOOKING_AI_ENABLED;
  process.env.NATIVE_BOOKING_AI_ENABLED = 'true';
  try {
    for (const role of ['COUNTER_SALES', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN']) assert.ok(capabilitiesFor(role).actions.includes('so.approve-native'), role);
    for (const role of ['SALES', 'WAREHOUSE', 'WEIGHBRIDGE', 'APPROVER']) assert.ok(!capabilitiesFor(role).actions.includes('so.approve-native'), role);
  } finally { if (saved === undefined) delete process.env.NATIVE_BOOKING_AI_ENABLED; else process.env.NATIVE_BOOKING_AI_ENABLED = saved; }
});
