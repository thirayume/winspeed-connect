'use strict';
// Owner, 21 Nov 2026: one giveaway Set Zero covers every company database (on 20 Nov the second company
// needed a one-off SQL script). Nothing existing is changed: one log row and one change event per database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setZeroAllCompanies, previewSetZero, companyTargets } = require('../services/giveaway-set-zero');

const ENV = { DB_MODE: 'onprem', ONPREM_DB_NAME: 'dbwins_worldfert9' };
const TARGETS = [
  { name: 'dbwins_worldfert2', database: 'dbwins_worldfert2', expectedServerName: 'R740-SRV\\SQL2008' },
  { name: 'dbwins_worldfert9', database: 'dbwins_worldfert9', expectedServerName: 'R740-SRV\\SQL2008' },
];
const resolveTargets = () => TARGETS;
const ADMIN = { sub: 63, role: 'ADMIN', roles: ['ADMIN'] };
const ids = { dbwins_worldfert9: 63, dbwins_worldfert2: 47 };
const resolveIdentity = async ({ target }) => ({ businessActorId: ids[target.name], businessEffectiveId: ids[target.name] });

function fakeDb({ failInsertOn = null, schemaMissingOn = null, now = new Date('2026-12-31T17:00:00Z') } = {}) {
  const state = {};
  for (const t of TARGETS) state[t.name] = { log: [], events: 0, withdrawn: t.name === 'dbwins_worldfert9' ? 15998.5 : 120, writes: [] };
  let current = null;
  const answer = (text, inputs = {}) => {
    const s = state[current];
    if (/AS HasLog/.test(text)) return [{ DatabaseName: current, ServerName: 'R740-SRV\\SQL2008', HasLog: 1, HasRequestId: current === schemaMissingOn ? 0 : 1, HasView: 1 }];
    if (/COUNT\(\*\) AS Lines/.test(text)) return [{ Lines: 52, Withdrawn: s.withdrawn }];
    if (/SELECT TOP 1 ZeroAt FROM wf\.GiveawayZeroLog ORDER BY/.test(text)) return s.log.length ? [{ ZeroAt: s.log[s.log.length - 1].ZeroAt }] : [];
    if (/WHERE RequestId = @rid/.test(text)) return s.log.filter(r => r.RequestId === inputs.rid).map(r => ({ Id: r.Id, ZeroAt: r.ZeroAt }));
    if (/GETUTCDATE\(\) AS Now/.test(text)) return [{ Now: now }];
    if (/INSERT INTO wf\.GiveawayZeroLog/.test(text)) {
      if (current === failInsertOn) throw new Error('connection lost');
      const row = { Id: s.log.length + 1, ZeroAt: inputs.zeroAt, Note: inputs.note, ActorId: inputs.actor, RequestId: inputs.rid };
      s.log.push(row); s.writes.push(text); return [{ Id: row.Id }];
    }
    throw new Error('unexpected query: ' + text.slice(0, 60));
  };
  const db = {
    sql: { UniqueIdentifier: 'uid', DateTime2: 'dt2', Int: 'int', NVarChar: () => 'nvarchar' },
    runWithTarget: async (kind, fn, name) => { assert.equal(kind, 'onprem'); const prev = current; current = name; try { return await fn(); } finally { current = prev; } },
    wfQuery: async (text, inputs = {}) => ({ recordset: answer(text, Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value]))) }),
    wfTransaction: async fn => {
      const snapshot = JSON.stringify(state[current].log);
      const tx = { request() { const inputs = {}; return { input(k, _t, v) { inputs[k] = v; return this; }, query: async text => ({ recordset: answer(text, inputs) }) }; } };
      try { return await fn(tx); } catch (e) { state[current].log = JSON.parse(snapshot); throw e; }
    },
  };
  const logChangeEvent = async () => { state[current].events++; };
  return { db, state, logChangeEvent };
}

test('the primary database comes first and the list comes only from the reviewed manifest', () => {
  assert.deepEqual(companyTargets(ENV, resolveTargets).map(t => t.name), ['dbwins_worldfert9', 'dbwins_worldfert2']);
  assert.throws(() => companyTargets({ ...ENV, ONPREM_DB_NAME: 'dbwins_other' }, resolveTargets), e => e.code === 'GIVEAWAY_ZERO_PRIMARY_MISSING');
  assert.equal(companyTargets({ DB_MODE: 'local' }).length, 1);
});

test('one Set Zero writes one log row and one change event in every company database, same moment and request', async () => {
  const f = fakeDb();
  const r = await setZeroAllCompanies({ user: ADMIN, note: 'เริ่มรอบปี 2570' }, { env: ENV, db: f.db, resolveTargets, resolveIdentity, logChangeEvent: f.logChangeEvent });
  assert.deepEqual(r.databases.map(d => [d.database, d.replayed, d.before.withdrawn]), [['dbwins_worldfert9', false, 15998.5], ['dbwins_worldfert2', false, 120]]);
  for (const name of ['dbwins_worldfert9', 'dbwins_worldfert2']) {
    assert.equal(f.state[name].log.length, 1);
    assert.equal(f.state[name].events, 1);
    assert.equal(f.state[name].log[0].RequestId, r.requestId);
    assert.equal(new Date(f.state[name].log[0].ZeroAt).toISOString(), '2026-12-31T17:00:00.000Z');
    // the person as known in that database
    assert.equal(f.state[name].log[0].ActorId, ids[name]);
    // nothing but the log insert is written
    for (const w of f.state[name].writes) assert.doesNotMatch(w, /DELETE|UPDATE|dbo\./i);
  }
});

test('a retry after a partial failure finishes the rest and never adds a second row', async () => {
  const f = fakeDb({ failInsertOn: 'dbwins_worldfert2' });
  let err;
  await setZeroAllCompanies({ user: ADMIN, requestId: '11111111-2222-3333-4444-555555555555' },
    { env: ENV, db: f.db, resolveTargets, resolveIdentity, logChangeEvent: f.logChangeEvent }).catch(e => { err = e; });
  assert.equal(err.code, 'GIVEAWAY_ZERO_PARTIAL');
  assert.equal(err.requestId, '11111111-2222-3333-4444-555555555555');
  assert.deepEqual(err.completed.map(d => d.database), ['dbwins_worldfert9']);
  assert.equal(f.state.dbwins_worldfert9.log.length, 1);
  assert.equal(f.state.dbwins_worldfert2.log.length, 0);
  const firstMoment = f.state.dbwins_worldfert9.log[0].ZeroAt;
  // the connection is back; a later clock must not move the moment
  const g = { ...f };
  g.db.wfQuery = (orig => async (text, inputs) => /GETUTCDATE/.test(text) ? { recordset: [{ Now: new Date('2027-01-01T01:00:00Z') }] } : orig(text, inputs))(f.db.wfQuery);
  const failing = f.db.wfTransaction;
  const fixed = fakeDb();
  fixed.state.dbwins_worldfert9 = f.state.dbwins_worldfert9; fixed.state.dbwins_worldfert2 = f.state.dbwins_worldfert2;
  const r = await setZeroAllCompanies({ user: ADMIN, requestId: '11111111-2222-3333-4444-555555555555' },
    { env: ENV, db: fixed.db, resolveTargets, resolveIdentity, logChangeEvent: fixed.logChangeEvent });
  assert.ok(failing);
  assert.deepEqual(r.databases.map(d => [d.database, d.replayed]), [['dbwins_worldfert9', true], ['dbwins_worldfert2', false]]);
  assert.equal(f.state.dbwins_worldfert9.log.length, 1);
  assert.equal(f.state.dbwins_worldfert2.log.length, 1);
  assert.equal(new Date(f.state.dbwins_worldfert2.log[0].ZeroAt).getTime(), new Date(firstMoment).getTime(), 'same moment as the first run');
});

test('nothing is written anywhere when one database is not ready or the person is not bound to it', async () => {
  const f = fakeDb({ schemaMissingOn: 'dbwins_worldfert2' });
  await assert.rejects(setZeroAllCompanies({ user: ADMIN }, { env: ENV, db: f.db, resolveTargets, resolveIdentity, logChangeEvent: f.logChangeEvent }),
    e => e.code === 'GIVEAWAY_ZERO_SCHEMA_MISSING');
  assert.equal(f.state.dbwins_worldfert9.log.length, 0);
  const g = fakeDb();
  await assert.rejects(setZeroAllCompanies({ user: ADMIN }, { env: ENV, db: g.db, resolveTargets, logChangeEvent: g.logChangeEvent,
    resolveIdentity: async ({ target }) => { if (target.name === 'dbwins_worldfert2') throw new Error('no binding'); return { businessActorId: 63, businessEffectiveId: 63 }; } }),
  e => e.code === 'GIVEAWAY_ZERO_IDENTITY_UNAVAILABLE');
  assert.equal(g.state.dbwins_worldfert9.log.length, 0);
  assert.equal(g.state.dbwins_worldfert2.log.length, 0);
  await assert.rejects(setZeroAllCompanies({ user: ADMIN, requestId: 'not-a-uuid' }, { env: ENV, db: g.db, resolveTargets, resolveIdentity }),
    e => e.code === 'GIVEAWAY_ZERO_REQUEST_INVALID' && e.status === 400);
});

test('the preview reads every database and writes nothing', async () => {
  const f = fakeDb();
  const p = await previewSetZero({ env: ENV, db: f.db, resolveTargets });
  assert.equal(p.ready, true);
  assert.deepEqual(p.databases.map(d => [d.database, d.budgetLines, d.withdrawnCounted]), [['dbwins_worldfert9', 52, 15998.5], ['dbwins_worldfert2', 52, 120]]);
  assert.equal(f.state.dbwins_worldfert9.writes.length + f.state.dbwins_worldfert2.writes.length, 0);
});

test('migration 254 only adds the request id column and its rollback only drops it', () => {
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '254_giveaway_zero_request.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '254_giveaway_zero_request.down.sql'), 'utf8');
  assert.match(up, /^-- @transaction/);
  assert.match(up, /ALTER TABLE wf\.GiveawayZeroLog ADD RequestId UNIQUEIDENTIFIER NULL/);
  const code = up.replace(/^--.*$/gm, '');
  assert.doesNotMatch(code, /\bdbo\.|\bDELETE\b|\bUPDATE\b|\bDROP\b/i);
  assert.match(down, /ALTER TABLE wf\.GiveawayZeroLog DROP COLUMN RequestId/);
});
