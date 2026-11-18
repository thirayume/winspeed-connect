'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeConversionAction, nextConversionRequestStatus } = require('../services/rebate-conversion-approval-policy');
test('sales can request, manager or C-level can decide, permissions are assignable', () => {
  assert.equal(authorizeConversionAction({ sub: 1, role: 'SALES' }, 'REQUEST').effectivePrimaryId, 1);
  for (const role of ['MANAGER', 'C_LEVEL']) assert.equal(authorizeConversionAction({ sub: 2, role }, 'APPROVE').actorPrimaryId, 2);
  assert.throws(() => authorizeConversionAction({ sub: 1, role: 'SALES' }, 'APPROVE'), { code: 'REBATE_CONVERSION_PERMISSION_REQUIRED' });
  assert.throws(() => authorizeConversionAction({ sub: 2, role: 'MANAGER', permissions: [] }, 'APPROVE'), { code: 'REBATE_CONVERSION_PERMISSION_REQUIRED' });
  assert.equal(authorizeConversionAction({ sub: 1, role: 'SALES', permissions: ['rebate.conversion.approve'] }, 'APPROVE').actorPrimaryId, 1);
});
test('self approval is allowed when both capabilities are held', () => {
  const user = { sub: 7, roles: ['SALES', 'MANAGER'], role: 'SALES' };
  assert.equal(authorizeConversionAction(user, 'REQUEST').effectivePrimaryId, 7);
  assert.equal(authorizeConversionAction(user, 'APPROVE').effectivePrimaryId, 7);
});
test('Access As requires both identities to be authorized and preserves mapped audit identities', () => {
  const user = { sub: 1, role: 'MANAGER', actorSub: 2, actorRole: 'MANAGER', actorRoles: ['MANAGER'], isImpersonating: true,
    identityMapping: { primaryEffectiveUserId: 1, primaryActorUserId: 2, businessEffectiveUserId: 11, businessActorUserId: 22 } };
  assert.deepEqual(authorizeConversionAction(user, 'APPROVE'), { actorPrimaryId: 2, effectivePrimaryId: 1, actorBusinessId: 22, effectiveBusinessId: 11 });
  assert.throws(() => authorizeConversionAction({ ...user, actorPermissions: [] }, 'APPROVE'), { code: 'REBATE_CONVERSION_PERMISSION_REQUIRED' });
});
test('only pending requests can transition', () => {
  assert.equal(nextConversionRequestStatus('PENDING', 'APPROVE'), 'APPROVED');
  assert.equal(nextConversionRequestStatus('PENDING', 'REJECT'), 'REJECTED');
  assert.equal(nextConversionRequestStatus('PENDING', 'CANCEL'), 'CANCELLED');
  assert.throws(() => nextConversionRequestStatus('APPROVED', 'REJECT'), { code: 'REBATE_CONVERSION_TRANSITION_INVALID' });
});
