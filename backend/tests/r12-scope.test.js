'use strict';

/**
 * R12 items 10–13 (O-4) — one scoping rule: own records + org-chart subordinates.
 *   SALES A cannot list or open SALES B's bill / trip / quotation / price approval;
 *   a team lead sees subordinates; a MANAGER on the org chart sees the team, one not yet
 *   placed sees all (and keeps reports);
 *   ACCOUNTING sees all; under Access As the scope follows the target.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

// Users: 10 lead (position SALES-LEAD), 11 & 12 report to the lead, 20 other salesperson,
// 30 manager without position, 31 manager placed above the lead, 40 accounting
const appUsers = {
  10: { Id: 10, EmpId: '7010', PositionCode: 'SALES-LEAD' },
  11: { Id: 11, EmpId: '7011', PositionCode: 'SALES-A' },
  12: { Id: 12, EmpId: '7012', PositionCode: 'SALES-B' },
  13: { Id: 13, EmpId: '7013', PositionCode: 'SALES-A' }, // shares SALES-A with user 11
  20: { Id: 20, EmpId: '7020', PositionCode: null },
  30: { Id: 30, EmpId: '7030', PositionCode: null },
  31: { Id: 31, EmpId: '7031', PositionCode: 'MGR-03' },
  40: { Id: 40, EmpId: '7040', PositionCode: null },
};
const reportsTo = { 'SALES-LEAD': 'MGR-03', 'SALES-A': 'SALES-LEAD', 'SALES-B': 'SALES-LEAD' };
// what the recursive CTE returns: the positions strictly below `pos`
const below = pos => Object.keys(reportsTo).filter(p => reportsTo[p] === pos).flatMap(p => [p, ...below(p)]);

const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser WHERE Id = @id/.test(text)) return appUsers[inputs.id] ? [appUsers[inputs.id]] : [];
  if (/;WITH tree AS/.test(text)) {
    const codes = below(inputs.pos);
    return Object.values(appUsers).filter(u => u.Id === inputs.id || codes.includes(u.PositionCode)).map(u => ({ Id: u.Id, EmpId: u.EmpId }));
  }
  // bill 500 owned by user 11 (draft), bill 600 owned by user 20
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) {
    if (inputs.id === 500) return [{ Id: 500, Status: 'DRAFT', SalesUserId: 11, ImportedDocuNo: null }];
    if (inputs.id === 600) return [{ Id: 600, Status: 'DRAFT', SalesUserId: 20, ImportedDocuNo: null }];
    // native 104 sales order whose DocuNo is also another salesperson's 103 booking
    if (inputs.id === 276865) return [{ Id: '276865', Status: 'SHIPPED', SalesUserId: null, ImportedDocuNo: 'I69-03697' }];
    return [];
  }
  // dbo.SOHD: SOID 276865 (104) belongs to EmpID 7020; SOID 275786 (103, same DocuNo) to EmpID 7011
  if (/FROM dbo\.SOHD WITH \(NOLOCK\)\s+WHERE SOID = @soid AND DocuNo = @no/.test(text)) {
    const docs = { 276865: '7020', 275786: '7011' };
    return docs[inputs.soid] && inputs.no === 'I69-03697' ? [{ EmpID: docs[inputs.soid] }] : [];
  }
  if (/SELECT \* FROM wf\.Quotation WHERE Id=@id/.test(text)) {
    if (inputs.id === 7) return [{ Id: 7, SalesUserId: 20, QuoteNo: 'QU6910-00007' }];
    return [];
  }
  if (/FROM wf\.SalesTrip st WHERE st\.TripId = @id/.test(text)) {
    // the route applies the scope in SQL: emulate "trip 53 is created by user 20 only"
    const allowed = Object.entries(inputs).some(([k, v]) => /^tc|^tm/.test(k) && Number(v) === 20);
    const all = !/tc0|tm0/.test(text) && !Object.keys(inputs).some(k => /^tc|^tm/.test(k));
    return (allowed || all) ? [{ TripId: 53, CreatedBy: 20 }] : [];
  }
  return [];
});

const { getVisibleScope, scopeFilter } = require('../services/visible-scope');

let app;
test.before(async () => {
  app = await h.startApp([['/api/so', '../../routes/so'], ['/api/quotation', '../../routes/quotation'], ['/api/trips', '../../routes/trips'], ['/api/edit-requests', '../../routes/edit-requests'], ['/api/reports', '../../routes/reports']]);
});
test.after(async () => { await app.close(); });

test('resolver: a team lead sees self + subordinates (org chart)', async () => {
  const s = await getVisibleScope({ sub: 10, role: 'SALES' });
  assert.equal(s.basis, 'ORG');
  assert.deepEqual(s.userIds.sort((a, b) => a - b), [10, 11, 12, 13]);
  assert.deepEqual(s.empIds.sort(), ['7010', '7011', '7012', '7013']);
});

test('resolver: the tree starts BELOW the user\'s position (peers on the same position stay apart)', async () => {
  const before = db.calls.length;
  await getVisibleScope({ sub: 11, role: 'SALES' });
  const cte = db.calls.slice(before).find(c => /;WITH tree AS/.test(c.text));
  assert.match(cte.text, /FROM wf\.OrgPosition WHERE ReportsTo = @pos AND PositionCode <> @pos/);
  assert.doesNotMatch(cte.text, /WHERE PositionCode = @pos\s/);
});

test('resolver: a salesperson without subordinates sees only own records, not a peer on the same position', async () => {
  const a = await getVisibleScope({ sub: 11, role: 'SALES' });
  assert.deepEqual(a.userIds, [11]);
  const peer = await getVisibleScope({ sub: 13, role: 'SALES' });
  assert.deepEqual(peer.userIds, [13]);
  const b = await getVisibleScope({ sub: 20, role: 'SALES' });
  assert.equal(b.basis, 'OWN'); assert.deepEqual(b.userIds, [20]);
});

test('resolver: MANAGER on the org chart sees its team; one not yet placed sees all', async () => {
  const placed = await getVisibleScope({ sub: 31, role: 'MANAGER' });
  assert.equal(placed.basis, 'ORG');
  assert.deepEqual(placed.userIds.sort((a, b) => a - b), [10, 11, 12, 13, 31]);
  const unplaced = await getVisibleScope({ sub: 30, role: 'MANAGER' });
  assert.equal(unplaced.all, true);
  assert.equal(unplaced.basis, 'MANAGER_UNMAPPED');
});

test('MANAGER on the org chart cannot open a bill outside its team', async () => {
  const outside = await app.call('GET', '/api/so/600', { user: { sub: 31, role: 'MANAGER' } });
  assert.equal(outside.status, 404);
  const team = await app.call('GET', '/api/so/500', { user: { sub: 31, role: 'MANAGER' } });
  assert.notEqual(team.status, 404);
});

test('resolver: ACCOUNTING (and ADMIN/C_LEVEL, operational roles) see all', async () => {
  for (const role of ['ACCOUNTING', 'ADMIN', 'C_LEVEL', 'WAREHOUSE', 'COUNTER_SALES', 'APPROVER', 'WEIGHBRIDGE']) {
    assert.equal((await getVisibleScope({ sub: 40, role })).all, true, role);
  }
  assert.equal(scopeFilter({ all: true }, { userCol: 'x' }).sql, '1=1');
  assert.equal(scopeFilter({ all: false, userIds: [], empIds: [] }, { userCol: 'x' }).sql, '1=0');
});

test('SALES A cannot open SALES B\'s bill (404); own bill opens', async () => {
  const other = await app.call('GET', '/api/so/600', { user: { sub: 11, role: 'SALES' } });
  assert.equal(other.status, 404);
  const own = await app.call('GET', '/api/so/500', { user: { sub: 11, role: 'SALES' } });
  assert.notEqual(own.status, 404);
});

test('team lead opens a subordinate\'s bill; ACCOUNTING opens any bill', async () => {
  const lead = await app.call('GET', '/api/so/500', { user: { sub: 10, role: 'SALES' } });
  assert.notEqual(lead.status, 404);
  const acc = await app.call('GET', '/api/so/600', { user: { sub: 40, role: 'ACCOUNTING' } });
  assert.notEqual(acc.status, 404);
});

test('SO list: scoped users get an owner filter in SQL; ACCOUNTING does not', async () => {
  let before = db.calls.length;
  await app.call('GET', '/api/so?limit=5', { user: { sub: 11, role: 'SALES' } });
  const scoped = db.calls.slice(before).find(c => /COUNT_BIG\(\*\) AS TotalCount/.test(c.text));
  assert.match(scoped.text, /q\.SalesUserId IN \(@scU0\)/);
  assert.equal(scoped.inputs.scU0, 11);
  before = db.calls.length;
  await app.call('GET', '/api/so?limit=5', { user: { sub: 40, role: 'ACCOUNTING' } });
  const all = db.calls.slice(before).find(c => /COUNT_BIG\(\*\) AS TotalCount/.test(c.text));
  assert.doesNotMatch(all.text, /SalesUserId IN/);
});

test('SALES A cannot open SALES B\'s quotation (404)', async () => {
  const r = await app.call('GET', '/api/quotation/7', { user: { sub: 11, role: 'SALES' } });
  assert.equal(r.status, 404);
});

test('SALES A cannot open SALES B\'s trip (404); the owner can', async () => {
  const r = await app.call('GET', '/api/trips/53', { user: { sub: 11, role: 'SALES' } });
  assert.equal(r.status, 404);
  const own = await app.call('GET', '/api/trips/53', { user: { sub: 20, role: 'SALES' } });
  assert.notEqual(own.status, 404);
});

test('price approvals list is limited to the requester / bill owner scope', async () => {
  const before = db.calls.length;
  await app.call('GET', '/api/edit-requests/price-approvals', { user: { sub: 11, role: 'SALES' } });
  const q = db.calls.slice(before).find(c => /FROM wf\.PriceApproval pa/.test(c.text));
  assert.match(q.text, /pa\.RequestedBy IN \(@prU0\) OR \(so\.SalesUserId IN \(@pbU0\)\)|\(pa\.RequestedBy IN \(@prU0\)\) OR \(so\.SalesUserId IN \(@pbU0\)\)/);
});

test('under Access As the scope follows the impersonated user', async () => {
  // ADMIN (actor 1) acting as SALES user 11 must not see user 20's bill
  const r = await app.call('GET', '/api/so/600', { user: { sub: 11, role: 'SALES', actorSub: 1, actorRole: 'ADMIN' } });
  assert.equal(r.status, 404);
});

test('reports: a team-scoped MANAGER or SALES is refused company-wide reports; unplaced MANAGER and ACCOUNTING may run them', async () => {
  const m = await app.call('GET', '/api/reports/so-status', { user: { sub: 31, role: 'MANAGER' } });
  assert.equal(m.status, 403);
  const types = await app.call('GET', '/api/reports/types', { user: { sub: 31, role: 'MANAGER' } });
  assert.deepEqual(types.body, []);
  const s = await app.call('GET', '/api/reports/types', { user: { sub: 20, role: 'SALES' } });
  assert.deepEqual(s.body, []);
  const unplaced = await app.call('GET', '/api/reports/types', { user: { sub: 30, role: 'MANAGER' } });
  assert.ok(unplaced.body.length > 0);
  const a = await app.call('GET', '/api/reports/types', { user: { sub: 40, role: 'ACCOUNTING' } });
  assert.ok(a.body.length > 0);
});

test('SR-6 (live finding): a native bill\'s owner comes from its own SOID, not from a DocuNo shared with a 103 booking', async () => {
  // 276865 is EmpID 7020's sales order; the 103 booking with the same DocuNo is 7011's
  const owner = await app.call('GET', '/api/so/276865', { user: { sub: 20, role: 'SALES' } });
  assert.notEqual(owner.status, 404);
  const other = await app.call('GET', '/api/so/276865', { user: { sub: 11, role: 'SALES' } });
  assert.equal(other.status, 404);
});
