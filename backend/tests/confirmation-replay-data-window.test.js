'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let replayRows = [];
const db = h.installDbStub(({ text, inputs }) => {
  if (/WHERE x\.SourceDraftId=@id/.test(text)) return replayRows;
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text)) return [{ Id: inputs.id, EmpId: null, PositionCode: null }];
  return [];
}, { activeUserIds: h.TEST_USERS, strictTypedInputs: true });
const { getConfirmationReplay } = require('../services/confirmation-replay');
const sales = { sub: 1, role: 'SALES', actorSub: 1, identityMapping: {
  primaryEffectiveUserId: 1, primaryActorUserId: 1, businessEffectiveUserId: 11, businessActorUserId: 11,
} };

test('mapped business identity controls replay ownership in the selected database', async () => {
  replayRows = [{ SOID: '900', WfRef: 'UAT', SalesUserId: 11, InDataWindow: 1 }];
  const result = await getConfirmationReplay({ params: { id: '22' }, user: sales });
  assert.equal(result.id, '900');
  assert.ok(db.calls.some(c => /SELECT Id, EmpId, PositionCode/.test(c.text) && c.inputs.id === 11));
  assert.ok(db.calls.some(c => /h\.SOID=CASE/.test(c.text) && /NOT LIKE '%\[\^0-9\]%'/.test(c.text)));
  replayRows = [{ SOID: '900', WfRef: 'UAT', SalesUserId: 12, InDataWindow: 1 }];
  await assert.rejects(getConfirmationReplay({ params: { id: '22' }, user: sales }), { status: 404 });
});

test('old, missing-native and ambiguous replays fail closed rather than creating a duplicate', async () => {
  for (const record of [{ InDataWindow: 0 }, { InDataWindow: null }]) {
    replayRows = [{ SOID: '900', ...record }];
    await assert.rejects(getConfirmationReplay({ params: { id: '22' }, user: sales }), { status: 404 });
  }
  replayRows = [{ SOID: '900', InDataWindow: 1 }, { SOID: '901', InDataWindow: 1 }];
  await assert.rejects(getConfirmationReplay({ params: { id: '22' }, user: sales }), { status: 409 });
});

test('Access As checks real actor and effective business scopes independently', async () => {
  replayRows = [{ SOID: '900', WfRef: 'UAT', SalesUserId: 11, InDataWindow: 1 }];
  const delegated = { ...sales, actorSub: 2, actorRole: 'SALES', actorRoles: ['SALES'], isImpersonating: true,
    identityMapping: { primaryEffectiveUserId: 1, primaryActorUserId: 2, businessEffectiveUserId: 11, businessActorUserId: 12 } };
  await assert.rejects(getConfirmationReplay({ params: { id: '22' }, user: delegated }), { status: 404 });
  const administrator = { ...delegated, actorRole: 'ADMIN', actorRoles: ['ADMIN'] };
  assert.equal((await getConfirmationReplay({ params: { id: '22' }, user: administrator })).id, '900');
});
