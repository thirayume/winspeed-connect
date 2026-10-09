'use strict';

/**
 * Owner 2026-10-09: every salesperson and sales manager gets a rebate requester code automatically (RB<code><yy>-<seq>).
 * History first, one series per person by the largest counts; then two letters from the name, never a code WINSpeed
 * has used, so nobody continues another person's numbering.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const appUsers = [
  { Id: 43, Username: 'emp-00042', DisplayName: 'พนักงาน ก', Role: 'SALES', EmpId: '7004', RebateDocCode: null, IsActive: true },
  { Id: 41, Username: 'emp-00041', DisplayName: 'พนักงาน ข', Role: 'SALES', EmpId: '7002', RebateDocCode: null, IsActive: true },
  { Id: 2, Username: 'emp-00002', DisplayName: 'เกศินี  ดวงดี', Role: 'SALES', EmpId: '1001', RebateDocCode: null, IsActive: true },
];
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.AppUser WHERE IsActive = 1 AND Role IN/.test(text)) return appUsers.filter(u => u.IsActive);
  if (/FROM dbo\.SOInvHD h WITH \(NOLOCK\)\s+JOIN CustEmp/.test(text)) {
    return [{ SeriesCode: 'S', EmpId: '7004', DocCount: 360 }, { SeriesCode: 'T', EmpId: '7004', DocCount: 362 },
      { SeriesCode: 'S', EmpId: '7002', DocCount: 312 }, { SeriesCode: 'T', EmpId: '7002', DocCount: 211 }];
  }
  if (/SELECT DISTINCT SUBSTRING\(DocuNo, 3/.test(text)) return [{ Code: 'S' }, { Code: 'T' }, { Code: 'KD' }];
  if (/SELECT RebateDocCode FROM wf\.AppUser WHERE RebateDocCode IS NOT NULL/.test(text)) {
    return appUsers.filter(u => u.RebateDocCode).map(u => ({ RebateDocCode: u.RebateDocCode }));
  }
  if (/UPDATE wf\.AppUser SET RebateDocCode = @c WHERE Id = @id AND RebateDocCode IS NULL/.test(text)) {
    const u = appUsers.find(x => x.Id === inputs.id);
    if (u && !u.RebateDocCode) { u.RebateDocCode = inputs.c; return { recordset: [], rowsAffected: [1] }; }
    return { recordset: [], rowsAffected: [0] };
  }
  if (/SELECT Id, Role, IsActive, RebateDocCode FROM wf\.AppUser WHERE Id = @id/.test(text)) return appUsers.filter(u => u.Id === inputs.id);
  if (/SELECT Username, DisplayName, RebateDocCode FROM wf\.AppUser WHERE Id = @id/.test(text)) return appUsers.filter(u => u.Id === inputs.id);
  if (/FROM\s+CandidateDocs/.test(text)) return inputs.p === 'RBT69-%' ? [{ DocuNo: 'RBT69-110', Seq: 110 }] : [];
  return [];
});
const { planRebateDocCodes, nameCodes } = require('../services/rebate-doc-code');

let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate']]); });
test.after(async () => { await app.close(); });

test('names give two letters: first name + surname, or the first two consonants', () => {
  assert.equal(nameCodes('เกศินี  ดวงดี')[0], 'KD');
  assert.equal(nameCodes('รุ่งโรจน์')[0], 'RN');
  assert.equal(nameCodes('Chakkrapong')[0], 'CH');
  assert.deepEqual(nameCodes(''), []);
});

test('history goes one series per person, largest counts first', () => {
  const plan = planRebateDocCodes({
    users: appUsers.map(u => ({ ...u, RebateDocCode: null })),
    evidence: [{ SeriesCode: 'S', EmpId: '7004', DocCount: 360 }, { SeriesCode: 'T', EmpId: '7004', DocCount: 362 },
      { SeriesCode: 'S', EmpId: '7002', DocCount: 312 }, { SeriesCode: 'T', EmpId: '7002', DocCount: 211 }],
    reserved: ['S', 'T', 'KD'],
  });
  const by = Object.fromEntries(plan.map(p => [p.userId, p]));
  assert.equal(by[43].code, 'T'); assert.equal(by[43].source, 'HISTORY');
  assert.equal(by[41].code, 'S');
  assert.notEqual(by[2].code, 'KD', 'a code WINSpeed has used is never given by name');
  assert.equal(by[2].code, 'KS'); assert.equal(by[2].source, 'NAME');
});

test('a held code is never given twice, and thin history does not count', () => {
  const plan = planRebateDocCodes({
    users: [{ Id: 9, DisplayName: 'สมใจ  พูนสุข', EmpId: '1008', RebateDocCode: null }],
    evidence: [{ SeriesCode: 'V', EmpId: '1008', DocCount: 5 }],
    existing: ['SP'],
  });
  assert.equal(plan[0].source, 'NAME');
  assert.notEqual(plan[0].code, 'SP');
});

test('the admin button gives every waiting user a code', async () => {
  const r = await app.call('POST', '/api/rebate/doc-codes/auto-assign', { user: { sub: 63, role: 'ADMIN' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.assigned, 3);
  assert.deepEqual(appUsers.map(u => u.RebateDocCode), ['T', 'S', 'KS']);
});

test('only an admin or C-level runs it', async () => {
  const r = await app.call('POST', '/api/rebate/doc-codes/auto-assign', { user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 403);
});

test('a salesperson without a code gets one on first use and the next RB number follows WINSpeed', async () => {
  appUsers[0].RebateDocCode = null;
  const r = await app.call('GET', '/api/rebate/next-rb-no?userId=43&beYear=69', { user: { sub: 63, role: 'ADMIN' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.docCode, 'T');
  assert.equal(r.body.suggested, 'RBT69-111');
  assert.ok(db.calls.some(c => /UPDATE wf\.AppUser SET RebateDocCode/.test(c.text)));
});
