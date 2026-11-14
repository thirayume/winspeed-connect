'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIncidentAcknowledger } = require('../services/incident-ack');

function setup({ failAudit = false, actorColumn = true, affected = 1 } = {}) {
  const state = { status: 'OPEN', events: [], calls: 0, inputs: {} };
  const sql = { Int: 'int', DateTime2: 'date', NVarChar: n => `nvarchar(${n})` };
  const tx = { request() { return { input(k, _type, value) { state.inputs[k] = value; return this; },
    async query(text) { assert.match(text, /Status = 'OPEN'.*OccurredAt >= @globalStartUtc/s);
      if (affected) state.status = 'ACK'; return { recordset: [{ Affected: affected }] }; } }; } };
  const ack = createIncidentAcknowledger({ sql, wfQuery: async () => {}, hasColumn: async () => actorColumn,
    wfTransaction: async fn => { state.calls++; const old = structuredClone(state); try { return await fn(tx); }
      catch (error) { Object.assign(state, old); throw error; } },
    logChangeEvent: async (actualTx, event) => { assert.equal(actualTx, tx); if (failAudit) throw Error('audit failed'); state.events.push(event); },
  });
  const args = { id: 8, note: 'reviewed', startUtc: new Date('2025-12-31T17:00:00Z'),
    user: { sub: 7, actorSub: 9, isImpersonating: true, identityMapping: {
      primaryEffectiveUserId: 7, primaryActorUserId: 9, businessEffectiveUserId: 17, businessActorUserId: 19,
    } } };
  return { state, ack, args };
}

test('incident ack and event commit together with the mapped effective identity', async () => {
  const { state, ack, args } = setup();
  assert.equal(await ack(args), true); assert.equal(state.status, 'ACK');
  assert.equal(state.inputs.by, 17); assert.equal(state.events[0].userId, '17');
  assert.equal(state.events[0].action, 'ACK'); assert.equal(state.events.length, 1);
});

test('incident ack rolls back when the audit fails', async () => {
  const { state, ack, args } = setup({ failAudit: true });
  await assert.rejects(ack(args), /audit failed/); assert.equal(state.status, 'OPEN'); assert.deepEqual(state.events, []);
});

test('an already acknowledged or cutoff-hidden incident is not audited again', async () => {
  const { state, ack, args } = setup({ affected: 0 });
  assert.equal(await ack(args), false); assert.equal(state.status, 'OPEN'); assert.deepEqual(state.events, []);
});

test('Access As fails closed when actor audit is unavailable', async () => {
  const { state, ack, args } = setup({ actorColumn: false });
  await assert.rejects(ack(args), error => error.status === 503); assert.equal(state.calls, 0);
});

test('invalid cross-database identity is rejected before a write', async () => {
  const { state, ack, args } = setup(); args.user.identityMapping.businessActorUserId = 0;
  await assert.rejects(ack(args), /IDENTITY_BINDING_INVALID/); assert.equal(state.calls, 0);
});
