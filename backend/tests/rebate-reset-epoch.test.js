'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { epoch } = require('../services/rebate-reset-epoch');
test('uninitialized epoch and committed reset epochs are distinguished', () => {
  assert.deepEqual(epoch({ generation: 0 }), { generation: 0, resetId: null, lastResetAtUtc: null });
  const e = epoch({ generation: 1, resetId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', lastResetAtUtc: new Date('2026-11-13T12:00:00Z') });
  assert.equal(e.resetId, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
});
test('missing or malformed reset identity and time fail closed', () => {
  for (const input of [{ generation: 0, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    { generation: 1 }, { generation: 1, resetId: 'bad', lastResetAtUtc: new Date() },
    { generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastResetAtUtc: 'invalid' },
    { generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastResetAtUtc: '2026-11-13T12:00:00' }]) {
    assert.throws(() => epoch(input), { code: 'REBATE_RESET_EPOCH_INVALID' });
  }
});
