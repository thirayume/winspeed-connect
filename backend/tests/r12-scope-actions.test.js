'use strict';

/**
 * R12 O-4 — actions by id obey the same scope as lists and detail views.
 *   A scoped user (SALES, or a MANAGER placed on the org chart) acting on a record outside
 *   its own + team scope gets 404, the same answer the detail view gives. Roles that see all
 *   records, and a MANAGER not yet placed on the org chart, are not affected.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

// 10 lead over 11; 20 another salesperson; 30 manager not on the chart; 31 manager over the lead
const appUsers = {
  10: { Id: 10, EmpId: '7010', PositionCode: 'SALES-LEAD' },
  11: { Id: 11, EmpId: '7011', PositionCode: 'SALES-A' },
  20: { Id: 20, EmpId: '7020', PositionCode: null },
  30: { Id: 30, EmpId: '7030', PositionCode: null },
  31: { Id: 31, EmpId: '7031', PositionCode: 'MGR-03' },
};
// positions strictly below each position (what the recursive CTE returns)
const below = { 'MGR-03': ['SALES-LEAD', 'SALES-A'], 'SALES-LEAD': ['SALES-A'], 'SALES-A': [] };
const owners = { 500: 11, 600: 20 };

const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser WHERE Id = @id/.test(text)) return appUsers[inputs.id] ? [appUsers[inputs.id]] : [];
  if (/;WITH tree AS/.test(text)) {
    const codes = below[inputs.pos] || [];
    return Object.values(appUsers).filter(u => u.Id === inputs.id || codes.includes(u.PositionCode)).map(u => ({ Id: u.Id, EmpId: u.EmpId }));
  }
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) {
    return owners[inputs.id] ? [{ Id: inputs.id, Status: 'DRAFT', SalesUserId: owners[inputs.id], ImportedDocuNo: null }] : [];
  }
  if (/SELECT \* FROM wf\.UnlockRequest WHERE Id=@id/.test(text)) return inputs.id === 70 ? [{ Id: 70, SoId: '600', RequesterId: 20, Status: 'PENDING', ReqType: 'UNLOCK' }] : [];
  if (/AS HasColumns/.test(text)) return [{ HasColumns: 1 }];
  if (/SELECT @@ROWCOUNT AS Affected/.test(text)) return [{ Affected: 1 }];
  if (/SELECT SalesUserId FROM wf\.Quotation WHERE Id=@id/.test(text)) return inputs.id === 7 ? [{ SalesUserId: 20 }] : [];
  if (/FROM wf\.PriceApproval pa LEFT JOIN wf\.SalesOrder so/.test(text)) return inputs.id === 9 ? [{ RequestedBy: 20, SalesUserId: 20 }] : [];
  if (/FROM wf\.SalesTrip t WHERE t\.TripId = @tid/.test(text)) {
    // trip 53 belongs to user 20 only
    const ids = Object.entries(inputs).filter(([k]) => /^tc|^tm/.test(k)).map(([, v]) => Number(v));
    return inputs.tid === 53 && ids.includes(20) ? [{ ok: 1 }] : [];
  }
  return [];
});

let app;
test.before(async () => {
  app = await h.startApp([
    ['/api/so', '../../routes/so'], ['/api/quotation', '../../routes/quotation'], ['/api/trips', '../../routes/trips'],
    ['/api/edit-requests', '../../routes/edit-requests'], ['/api/giveaway', '../../routes/giveaway'],
  ]);
});
test.after(async () => { await app.close(); });

test('SALES cannot edit, cancel or confirm another salesperson\'s bill (404)', async () => {
  const sales = { sub: 11, role: 'SALES' };
  assert.equal((await app.call('PUT', '/api/so/600', { body: { lines: [] }, user: sales })).status, 404);
  assert.equal((await app.call('PATCH', '/api/so/600/cancel', { body: { reason: 'test reason' }, user: sales })).status, 404);
  assert.equal((await app.call('PATCH', '/api/so/600/confirm', { body: {}, user: sales })).status, 404);
  assert.equal((await app.call('GET', '/api/so/600/weigh-history', { user: sales })).status, 404);
});

test('the scope guard lets the owner through to the handler', async () => {
  const before = db.calls.length;
  const r = await app.call('GET', '/api/so/500/weigh-history', { user: { sub: 11, role: 'SALES' } });
  assert.notEqual(r.status, 404);
  assert.ok(db.calls.slice(before).some(c => /FROM wf\.WeighTicket WHERE SoId = @so/.test(c.text)));
});

test('a MANAGER on the org chart approves only its team\'s giveaways and bills', async () => {
  const mgr = { sub: 31, role: 'MANAGER' };
  assert.equal((await app.call('PATCH', '/api/so/600/giveaway-lines/1/approve', { body: {}, user: mgr })).status, 404);
  assert.equal((await app.call('PATCH', '/api/so/600/verify', { body: {}, user: mgr })).status, 404);
  const before = db.calls.length;
  await app.call('GET', '/api/so/giveaways/pending', { user: mgr });
  const q = db.calls.slice(before).find(c => /l\.IsGiveaway = 1 AND ISNULL\(l\.GiveawayApprovalStatus/.test(c.text));
  assert.ok(q, 'pending giveaways query ran');
  assert.match(q.text, /s\.SalesUserId IN \(/);
});

test('a MANAGER not yet on the org chart still sees and acts on every bill', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/600/giveaway-lines/1/approve', { body: {}, user: { sub: 30, role: 'MANAGER' } });
  assert.notEqual(r.status, 404);
  assert.ok(!db.calls.slice(before).some(c => /;WITH tree AS/.test(c.text)), 'no team lookup for an unplaced manager');
});

test('SALES cannot change another salesperson\'s quotation (404)', async () => {
  const r = await app.call('PATCH', '/api/quotation/7/status', { body: { status: 'CANCELLED' }, user: { sub: 11, role: 'SALES' } });
  assert.equal(r.status, 404);
});

test('a MANAGER on the org chart cannot approve a price request outside its team (404)', async () => {
  const r = await app.call('PATCH', '/api/edit-requests/price-approvals/9/approve', { body: {}, user: { sub: 31, role: 'MANAGER' } });
  assert.equal(r.status, 404);
});

test('SALES cannot change another salesperson\'s trip (404); the owner passes the guard', async () => {
  assert.equal((await app.call('PUT', '/api/trips/53', { body: {}, user: { sub: 11, role: 'SALES' } })).status, 404);
  assert.notEqual((await app.call('PUT', '/api/trips/53', { body: {}, user: { sub: 20, role: 'SALES' } })).status, 404);
});

test('giveaway quota of another salesperson: refused for SALES, allowed for the team lead and for counter sales', async () => {
  assert.equal((await app.call('GET', '/api/giveaway/my-quota?salesUserId=20', { user: { sub: 11, role: 'SALES' } })).status, 403);
  assert.equal((await app.call('GET', '/api/giveaway/my-quota?salesUserId=11', { user: { sub: 10, role: 'SALES' } })).status, 200);
  assert.equal((await app.call('GET', '/api/giveaway/my-quota?salesUserId=20', { user: { sub: 50, role: 'COUNTER_SALES' } })).status, 200);
  assert.equal((await app.call('GET', '/api/giveaway/my-quota', { user: { sub: 11, role: 'SALES' } })).status, 200);
});

test('a manager on the org chart cannot answer another team\'s unlock request (404)', async () => {
  const r = await app.call('PATCH', '/api/so/unlock-requests/70/resolve', { body: { approve: true, note: 'test' }, user: { sub: 31, role: 'MANAGER' } });
  assert.equal(r.status, 404);
  const all = await app.call('PATCH', '/api/so/unlock-requests/70/resolve', { body: { approve: false, note: 'test' }, user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(all.status, 200, JSON.stringify(all.body));
});
