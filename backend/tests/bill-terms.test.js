'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { billTermsText } = require('../services/bill-terms');

// same text as the WinSpeed booking form (dr_so_confirmorder_wf): a slot of dashes means "not chosen"
test('billing terms follow the WinSpeed booking form', () => {
  assert.equal(billTermsText({ BillState: 'N' }), '');
  assert.equal(billTermsText({}), '');
  assert.equal(billTermsText({ BillState: '1' }), 'วางบิลทุกวัน');
  assert.equal(billTermsText({ BillState: '2', BillDay: 'MON------THU------SUN' }), 'ทุกวัน จันทร์ พฤหัส อาทิตย์');
  assert.equal(billTermsText({ BillState: '3', BillDate: '01' + '--'.repeat(13) + '15' + '--'.repeat(16) }), 'ทุกวันที่ 1 15');
  assert.equal(billTermsText({ BillState: '4', BillWeek: '--02----05' }), 'ทุกสัปดาห์ที่ 2 5');
  assert.equal(billTermsText({ BillState: '5', BillDay: '---TUE---------------', BillWeek: '01--------' }), 'ทุกวัน อังคาร ของสัปดาห์ที่ 1');
});
