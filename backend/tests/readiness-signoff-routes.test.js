
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/route-harness.cjs');

const base = '/api/readiness-signoff';
const code = 'WINSPEED_INVOICE_BOOK';
const endpoint = base + '/' + code;
const admin = { sub: 11, role: 'ADMIN', username: 'test-admin' };
const draft = {
  status: 'IN_REVIEW',
  procedureText: '  เปิด Post Invoice  ',
  evidenceReference: '',
  reviewer: '',
  reviewDate: '',
  expectedRevision: 0,
  expectedDatabase: 'dbwins_worldfert9_uat',
};
let rows = [];
const db = harness.installDbStub(({ text, inputs }) => {
  if (text.startsWith('INSERT INTO wf.ReadinessSignoff')) {
    const latest = rows.find(row => row.TopicCode === inputs.topic);
    if (inputs.database !== 'dbwins_worldfert9_uat' || inputs.revision !== (latest?.Revision ?? 0)) return [];
    const saved = {
      TopicCode: inputs.topic,
      Revision: inputs.revision + 1,
      Status: inputs.status,
      ProcedureText: inputs.procedure,
      EvidenceReference: inputs.evidence,
      Reviewer: inputs.reviewer,
      ReviewDate: inputs.reviewDate,
      SavedByUserId: inputs.actorId,
      SavedByUsername: inputs.actorName,
      SavedAt: '2026-11-05T07:08:09.000Z',
    };
    rows.unshift(saved);
    return [saved];
  }
  if (text.startsWith('WITH Ranked AS')) {
    const latest = [...new Map([...rows].reverse().map(row => [row.TopicCode, row])).values()];
    return (latest.length ? latest : [{}]).map(row => ({ ...row, DatabaseName: 'dbwins_worldfert9_uat' }));
  }
  if (text.startsWith('SELECT TOP (21)')) {
    return rows.filter(row => row.TopicCode === inputs.topic && (!inputs.before || row.Revision < inputs.before)).slice(0, 21);
  }
  return [];
}, { activeUserIds: [11, 99] });

let app;
test.before(async () => { app = await harness.startApp([[base, '../../routes/readiness-signoff']]); });
test.beforeEach(() => { rows = []; db.calls.length = 0; });
test.after(async () => { await app.close(); });

test('only an actual admin can view or write a sign-off', async () => {
  assert.equal((await app.call('GET', base)).status, 401);
  for (const user of [{ sub: 11, role: 'ACCOUNTING' }, { ...admin, actorSub: 99 }]) {
    assert.equal((await app.call('GET', base, { user })).status, 403);
    assert.equal((await app.call('PUT', endpoint, { user, body: draft })).status, 403);
  }
  assert.equal(db.calls.filter(call => /wf\.ReadinessSignoff/.test(call.text)).length, 0);
});

test('current list includes all topics and a missing record is unconfirmed', async () => {
  const list = await app.call('GET', base, { user: admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.database, 'dbwins_worldfert9_uat');
  assert.equal(list.body.topics.length, 6);
  assert.ok(list.body.topics.every(topic => topic.current === null));
  assert.equal((await app.call('PUT', base + '/UNKNOWN', { user: admin, body: draft })).status, 404);
});

test('confirmation requires procedure, evidence, named reviewer and a valid review date', async () => {
  for (const body of [
    { ...draft, status: 'CONFIRMED' },
    { ...draft, reviewDate: '2026-02-30' },
    { ...draft, status: 'DONE' },
    { ...draft, evidenceReference: 'x'.repeat(501) },
    { ...draft, expectedRevision: '0' },
  ]) {
    assert.equal((await app.call('PUT', endpoint, { user: admin, body })).status, 400);
  }
  assert.equal(rows.length, 0);
});

test('a new revision stores the authenticated user, rejects stale updates and preserves history', async () => {
  const first = await app.call('PUT', endpoint, { user: admin, body: { ...draft, savedByUsername: 'fake' } });
  assert.equal(first.status, 200);
  assert.equal(first.body.Revision, 1);
  assert.equal(first.body.ProcedureText, 'เปิด Post Invoice');
  assert.equal(first.body.SavedByUsername, admin.username);

  assert.equal((await app.call('PUT', endpoint, { user: admin, body: { ...draft, expectedRevision: 1, expectedDatabase: 'dbwins_worldfert9' } })).status, 409);
  const confirmed = { ...draft, status: 'CONFIRMED', reviewer: 'บัญชี', reviewDate: '2026-11-05', evidenceReference: 'J69-QA / N69-QA', expectedRevision: 1 };
  const concurrent = await Promise.all([1, 2].map(() => app.call('PUT', endpoint, { user: admin, body: confirmed })));
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
  const list = await app.call('GET', base, { user: admin });
  assert.equal(list.body.topics.find(topic => topic.code === code).current.Revision, 2);
  const history = await app.call('GET', endpoint + '/history', { user: admin });
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.items.map(row => row.Status), ['CONFIRMED', 'IN_REVIEW']);
  assert.equal(history.body.nextBefore, null);

  const writes = db.calls.filter(call => /INSERT INTO wf\.ReadinessSignoff/.test(call.text));
  assert.ok(writes.every(call => call.kind === 'wfQuery' && /UPDLOCK, HOLDLOCK/.test(call.text) && !/dbo\./.test(call.text)));
});

test('history has a stable cursor for older revisions', async () => {
  rows = Array.from({ length: 22 }, (_, index) => ({ TopicCode: code, Revision: 22 - index }));
  const page = await app.call('GET', endpoint + '/history', { user: admin });
  assert.equal(page.body.items.length, 20);
  assert.equal(page.body.nextBefore, 3);
  const next = await app.call('GET', endpoint + '/history?before=3', { user: admin });
  assert.deepEqual(next.body.items.map(row => row.Revision), [2, 1]);
  assert.equal(next.body.nextBefore, null);
  assert.equal((await app.call('GET', endpoint + '/history?before=0', { user: admin })).status, 400);
});
