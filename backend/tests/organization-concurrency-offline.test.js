'use strict';
// Simulates transaction serialization; this is not a SQL Server lock test.
const test = require('node:test');
const assert = require('node:assert/strict');
let rows, audits, assigned, queue = Promise.resolve();
const sql = { Int: 'int', VarChar: n => `varchar(${n})`, NVarChar: n => `nvarchar(${n})`, MAX: 'max', ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' } };
const tx = { request() { const params = {}; return { input(key, _type, value) { params[key] = value; return this; }, async query(text) {
  if (/sp_getapplock/.test(text)) return { recordset: [{ LockResult: 0 }] };
  if (/SELECT \* FROM wf\.OrgPosition/.test(text)) return { recordset: structuredClone(rows) };
  if (/SELECT COUNT\(\*\) AS c FROM wf\.AppUser/.test(text)) return { recordset: [{ c: assigned }] };
  if (/UPDATE wf\.OrgPosition/.test(text)) { rows.find(r => r.PositionCode === params.code).ReportsTo = params.reportsTo; return { rowsAffected: [1] }; }
  if (/DELETE FROM wf\.OrgPosition/.test(text)) { rows = rows.filter(r => r.PositionCode !== params.code); return { rowsAffected: [1] }; }
  if (/INSERT INTO wf\.AdminChangeAudit/.test(text)) { audits.push(params); return { rowsAffected: [1] }; }
  throw Error(`unexpected query ${text}`);
} }; } };
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { sql, wfTransaction: async (fn, options) => {
  assert.equal(options.isolationLevel, 'serializable');
  const prior = queue; let release; queue = new Promise(resolve => { release = resolve; }); await prior;
  const before = structuredClone({ rows, audits });
  try { return await fn(tx); } catch (e) { rows = before.rows; audits = before.audits; throw e; } finally { release(); }
} } };
const { writeOrganizationChange } = require('../services/organization-audit-write');
const user = { sub: 1, actorSub: 1 };
const row = code => ({ PositionCode: code, PositionName: code, ReportsTo: null, OrgUnit: 'TEST', Tier: 1, IsActive: true });
const update = (code, parent, expected) => writeOrganizationChange({ statement: 'UPDATE wf.OrgPosition SET ReportsTo=@reportsTo WHERE PositionCode=@code',
  parameters: { code: { type: sql.VarChar(30), value: code }, reportsTo: { type: sql.VarChar(30), value: parent } },
  user, action: 'POSITION_UPDATE', target: code, expected, detail: {} });
test('two simultaneous opposite parent changes cannot produce a cycle', async () => {
  rows = [row('A'), row('B')]; audits = []; assigned = 0; queue = Promise.resolve();
  const [a, b] = await Promise.allSettled([update('A', 'B', row('A')), update('B', 'A', row('B'))]);
  assert.equal(a.status, 'fulfilled'); assert.equal(b.status, 'rejected'); assert.equal(b.reason.message, 'ORG_CYCLE');
  assert.equal(rows[0].ReportsTo, 'B'); assert.equal(rows[1].ReportsTo, null); assert.equal(audits.length, 1);
});
test('delete rechecks newly assigned users within the transaction', async () => {
  rows = [row('A')]; audits = []; assigned = 1; queue = Promise.resolve();
  await assert.rejects(writeOrganizationChange({ statement: 'DELETE FROM wf.OrgPosition WHERE PositionCode=@code',
    parameters: { code: { type: sql.VarChar(30), value: 'A' } }, user, action: 'POSITION_DELETE', target: 'A', expected: row('A'), detail: {} }), /ORG_POSITION_IN_USE/);
  assert.equal(rows.length, 1); assert.equal(audits.length, 0);
});
