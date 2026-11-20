'use strict';
// Giveaway Set Zero (owner, 20 Nov 2026; migration 253): ADMIN only, typed confirmation, logged, history kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/route-harness.cjs');

const db = h.installDbStub(({ text }) => {
  if (/FROM wf\.v_GiveawayBudgetStatus/.test(text) && /COUNT\(\*\) AS Lines/.test(text)) return [{ Lines: 52, Withdrawn: 15998.5 }];
  if (/INSERT INTO wf\.GiveawayZeroLog/.test(text)) return [{ Id: 1, ZeroAt: new Date('2026-12-31T17:00:00Z') }];
  if (/FROM wf\.GiveawayZeroLog z/.test(text)) return [{ Id: 1, ZeroAt: '2026-12-31T17:00:00Z', Note: 'x', ActorId: 1, ActorName: 'admin' }];
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/giveaway', '../../routes/giveaway']]); });
test.after(async () => { await app.close(); });

test('only ADMIN may Set Zero, and only with the typed confirmation', async () => {
  const before = db.calls.length;
  assert.equal((await app.call('POST', '/api/giveaway/set-zero', { user: { sub: 12, role: 'ACCOUNTING' }, body: { confirm: 'SET ZERO' } })).status, 403);
  assert.equal((await app.call('POST', '/api/giveaway/set-zero', { user: { sub: 1, role: 'ADMIN' }, body: { confirm: 'set zero' } })).status, 400);
  assert.ok(!db.calls.slice(before).some(c => /INSERT INTO wf\.GiveawayZeroLog/.test(c.text)));
});

test('a Set Zero writes one log row and a change event in one transaction and reports the count it reset', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/giveaway/set-zero', { user: { sub: 1, role: 'ADMIN' }, body: { confirm: 'SET ZERO', note: 'เริ่มรอบปี 2570' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.before.withdrawn, 15998.5);
  const calls = db.calls.slice(before);
  assert.equal(calls.filter(c => /INSERT INTO wf\.GiveawayZeroLog/.test(c.text)).length, 1);
  assert.ok(calls.some(c => /ChangeEvent/.test(c.text)));
  assert.ok(!calls.some(c => /DELETE|UPDATE wf\.GiveawayWithdrawal|UPDATE wf\.GiveawayBudget/i.test(c.text)), 'nothing is deleted or rewritten');
  assert.equal((await app.call('GET', '/api/giveaway/zero-log', { user: { sub: 12, role: 'ACCOUNTING' } })).status, 200);
});

test('migration 253 counts from the latest Set Zero, keeps history and rolls back to 249\'s view', () => {
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '253_giveaway_set_zero.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '253_giveaway_set_zero.down.sql'), 'utf8');
  assert.match(up, /^-- @transaction/);
  assert.match(up, /w\.CreatedAt >= ISNULL\(\(SELECT MAX\(z\.ZeroAt\) FROM wf\.GiveawayZeroLog z\)/);
  assert.match(up, /wf\.GiveawayGoodAlias ga/, 'aliased older goods still count');
  assert.doesNotMatch(up.replace(/^--.*$/gm, ''), /\bDELETE\b/i);
  assert.doesNotMatch(down, /GiveawayZeroLog z\)/);
  assert.match(down, /DROP TABLE wf\.GiveawayZeroLog/);
});
