'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const state = { employees: [{ EmpID: 7001, EmpCode: 'EMP-T1', EmpName: 'Test One', EmpType: 'G', EmpStatus: '1', Listed: 1, IsEnabled: 1, ApprovalCount: 2, AppUserCount: 1 }] };
const db = h.installDbStub(call => {
  if (/FROM dbo\.EMEmp e\s+LEFT JOIN wf\.NativeApproverEmployee/.test(call.text)) return state.employees;
  if (/^SELECT EmpID FROM dbo\.EMEmp WHERE EmpID=@emp$/.test(call.text)) return call.inputs.emp === 7001 ? [{ EmpID: 7001 }] : [];
  if (/UPDATE wf\.NativeApproverEmployee/.test(call.text)) return { recordset: [], rowsAffected: [1, 1] };
  return [];
}, { activeUserIds: [11, 99] });

let app;
test.before(async () => { app = await h.startApp([['/api/master/native-approvers', '../../routes/native-approvers']]); });
test.after(async () => { await app.close(); });

const writes = () => db.calls.filter(c => /UPDATE wf\.NativeApproverEmployee/.test(c.text));

test('only ADMIN and C_LEVEL can read or change the approver list', async () => {
  for (const role of ['SALES', 'COUNTER_SALES', 'APPROVER', 'WAREHOUSE', 'ACCOUNTING', 'MANAGER']) {
    const user = { sub: 11, role }, before = writes().length;
    assert.equal((await app.call('GET', '/api/master/native-approvers', { user })).status, 403);
    assert.equal((await app.call('PUT', '/api/master/native-approvers/7001', { user, body: { enabled: false } })).status, 403);
    assert.equal(writes().length, before);
  }
  assert.equal((await app.call('GET', '/api/master/native-approvers')).status, 401);
});

test('the list shows every WinSpeed employee with its approver state', async () => {
  const r = await app.call('GET', '/api/master/native-approvers', { user: { sub: 11, role: 'ADMIN' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data[0], { empId: 7001, empCode: 'EMP-T1', empName: 'Test One', empType: 'G', empStatus: '1',
    listed: true, enabled: true, note: null, updatedAt: null, approvalCount: 2, appUserCount: 1 });
});

test('a change records the effective user and the real actor, and keeps history', async () => {
  const r = await app.call('PUT', '/api/master/native-approvers/7001', {
    user: { sub: 11, role: 'C_LEVEL', actorSub: 99, actorRole: 'ADMIN' }, body: { enabled: false, note: ' not an approver ' } });
  assert.equal(r.status, 200);
  assert.deepEqual({ empId: r.body.empId, enabled: r.body.enabled }, { empId: 7001, enabled: false });
  const call = writes().at(-1);
  assert.equal(call.kind, 'tx');
  assert.match(call.text, /INSERT INTO wf\.NativeApproverEmployeeHistory/);
  assert.doesNotMatch(call.text, /DELETE|dbo\./i);
  assert.equal(call.inputs.on, 0); assert.equal(call.inputs.note, 'not an approver');
  assert.equal(call.inputs.user, 11); assert.equal(call.inputs.actor, 99);
});

test('bad input and unknown employees are refused without writing', async () => {
  const user = { sub: 11, role: 'ADMIN' }, before = writes().length;
  for (const [path, body] of [['/abc', { enabled: true }], ['/0', { enabled: true }], ['/7001', { enabled: 'yes' }], ['/7001', { enabled: true, note: 'x'.repeat(256) }]])
    assert.equal((await app.call('PUT', '/api/master/native-approvers' + path, { user, body })).status, 400);
  assert.equal((await app.call('PUT', '/api/master/native-approvers/7002', { user, body: { enabled: true } })).status, 404);
  assert.equal(writes().length, before);
});
