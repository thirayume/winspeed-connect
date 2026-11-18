'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../db');
let database = 'primary';
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getTarget: () => 'onprem', getDbName: () => database } };
const { hasColumn, runWithUser, currentActorId } = require('../services/request-context');

test('audit schema cache separates databases with different migration states', async () => {
  let queries = 0;
  const query = async () => { queries++; return { recordset: [{ HasCol: database === 'primary' ? 1 : 0 }] }; };
  assert.equal(await hasColumn(query, 'wf.ChangeEvent', 'ActorUserId'), true);
  database = 'secondary';
  assert.equal(await hasColumn(query, 'wf.ChangeEvent', 'ActorUserId'), false);
  database = 'primary';
  assert.equal(await hasColumn(query, 'wf.ChangeEvent', 'ActorUserId'), true);
  assert.equal(queries, 2);
  assert.equal(runWithUser({ sub: 8, actorSub: 17 }, () => currentActorId()), 17);
});
