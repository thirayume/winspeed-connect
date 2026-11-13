'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { businessIds } = require('../services/business-identity');
const { runWithUser, currentActorId } = require('../services/request-context');
const { getVisibleScope, canViewSalesUser } = require('../services/visible-scope');

const mapping = { primaryEffectiveUserId: 8, primaryActorUserId: 17,
  businessEffectiveUserId: 34, businessActorUserId: 47 };
const user = { sub: 8, id: 8, actorSub: 17, role: 'SALES', identityMapping: mapping };

test('business ID helpers keep normal identity and translate both Access As parties', () => {
  assert.deepEqual(businessIds({ sub: 8, actorSub: 17 }), { effective: 8, actor: 17 });
  assert.deepEqual(businessIds(user), { effective: 34, actor: 47 });
  assert.equal(runWithUser(user, currentActorId), 47);
});

test('stale, missing or mismatched mapped IDs fail closed', () => {
  for (const change of [
    m => { m.primaryActorUserId = 8; }, m => { m.primaryEffectiveUserId = 34; },
    m => { m.businessEffectiveUserId = 0; }, m => { m.businessActorUserId = null; },
    m => { m.businessActorUserId = m.businessEffectiveUserId; },
  ]) {
    const changed = { ...mapping }; change(changed);
    assert.throws(() => businessIds({ ...user, identityMapping: changed }), { code: 'IDENTITY_BINDING_INVALID' });
  }
});

test('scope and own-sales checks use the target account, not a colliding primary ID', async () => {
  const calls = [];
  const query = async (_sql, inputs) => {
    calls.push(inputs.id.value);
    return { recordset: [{ Id: 34, EmpId: 'target-employee', PositionCode: null }] };
  };
  const scope = await getVisibleScope(user, query);
  assert.deepEqual(scope.userIds, [34]);
  assert.deepEqual(scope.empIds, ['target-employee']);
  assert.deepEqual(calls, [34]);
  assert.equal(await canViewSalesUser(user, 34, query), true);
  assert.equal(await canViewSalesUser(user, 8, query), false);
});
