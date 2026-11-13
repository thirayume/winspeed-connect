'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

let currentUser;
let claim;
let previous;
let decision;
let audit;
let selectedDatabase = null;
let regionalUsers = new Set();
let plan;
let planPrevious;
let planConflict = false;
const types = { Int: 'Int', DateTime2: 'DateTime2', VarChar: () => 'VarChar', NVarChar: () => 'NVarChar', Decimal: () => 'Decimal' };
class Request {
  constructor() { this.args = {}; }
  input(name, type, value) { this.args[name] = value; return this; }
  async query(q) {
    if (q.includes('sp_getapplock')) return { recordset: [] };
    if (q.includes('SELECT * FROM wf.RebateClaim WITH')) return { recordset: [claim] };
    if (q.includes('SELECT TOP 1 DecidedBy, Tier')) return { recordset: previous ? [previous] : [] };
    if (q.includes('FROM wf.UserSaleArea')) return { recordset: regionalUsers.has(this.args.uid) ? [{}] : [] };
    if (q.includes('UPDATE wf.RebatePlan')) return { rowsAffected: [planConflict ? 0 : 1] };
    if (q.includes('INSERT INTO wf.RebatePlanApproval')) { decision = { ...this.args }; return { rowsAffected: [1] }; }
    if (q.includes('UPDATE wf.RebateClaim')) return { rowsAffected: [1] };
    if (q.includes('INSERT INTO wf.RebateClaimApproval')) { decision = { ...this.args }; return { rowsAffected: [1] }; }
    throw new Error(`Unexpected query: ${q}`);
  }
}
const root = path.resolve(__dirname, '..');
const install = (file, exports) => { require.cache[require.resolve(path.join(root, file))] = { exports }; };
install('db.js', {
  sql: types,
  wfQuery: async (q, params) => {
    if (q.includes('SELECT DisplayName, Username FROM wf.AppUser')) return { recordset: [{ DisplayName: `Actor ${params.id.value}` }] };
    if (q.includes('SELECT * FROM wf.RebatePlan WHERE')) return { recordset: plan ? [plan] : [] };
    if (q.includes('SELECT TOP 1 DecidedBy FROM wf.RebatePlanApproval')) return { recordset: planPrevious ? [planPrevious] : [] };
    if (q.includes('FROM wf.UserSaleArea')) return { recordset: regionalUsers.has(params.uid.value) ? [{}] : [] };
    throw new Error(`Unexpected lookup: ${q}`);
  },
  query: async () => ({ recordset: [] }),
  getDbName: () => selectedDatabase,
  wfTransaction: async fn => fn({ request: () => new Request() }),
});
install('middleware/auth.js', {
  requireAuth: (req, res, next) => { req.user = currentUser; next(); },
  requireRole: () => (req, res, next) => next(),
  requireRebatePageAccess: (req, res, next) => next(),
  hideRebateMoneyFromSales: (req, res, next) => next(),
  canViewAllRebateAmounts: () => true,
});
install('services/policy-contract.js', {
  getPolicySettings: async () => ({}),
  validateReasonCode: () => {},
  logChangeEvent: async (tx, event) => { audit = event; },
});
install('services/global-data-window-store.js', { readGlobalDataWindow: async () => ({
  businessDate: '2026-01-01', utcInstant: new Date('2025-12-31T17:00:00Z'),
}) });
const router = require('../routes/rebate');

test('claim approval uses union roles and records the actual Access As actor', async t => {
  const app = express();
  app.use(express.json());
  app.use('/api/rebate', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/rebate/claims/10/approve`;
  async function invoke(user, prior) {
    currentUser = user;
    claim = { Id: 10, Status: 'TIER3_PENDING', CurrentTier: 3, SalesUserId: 99 };
    previous = prior;
    decision = undefined; audit = undefined;
    const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return { status: r.status, body: await r.json() };
  }
  let result = await invoke({ sub: 8, role: 'SALES', roles: ['SALES', 'C_LEVEL'], displayName: 'Eight' });
  assert.equal(result.status, 200);
  assert.equal(decision.uid, 8);
  result = await invoke({ sub: 8, actorSub: 17, role: 'SALES', roles: ['C_LEVEL'], actorRoles: ['SALES', 'C_LEVEL'], isImpersonating: true });
  assert.equal(result.status, 200);
  assert.equal(decision.uid, 17);
  assert.equal(decision.uname, 'Actor 17');
  assert.equal(audit.userId, 8);
  assert.equal(JSON.parse(audit.afterJson).effectiveUserId, 8);
  result = await invoke({ sub: 8, actorSub: 17, roles: ['C_LEVEL'], actorRoles: ['SALES'], isImpersonating: true });
  assert.equal(result.status, 403);
  assert.equal(decision, undefined);
  result = await invoke({ sub: 8, actorSub: 17, roles: ['C_LEVEL'], actorRoles: ['C_LEVEL'], isImpersonating: true }, { DecidedBy: 17 });
  assert.equal(result.status, 403);
  assert.equal(decision, undefined);

  currentUser = { sub: 8, actorSub: 17, roles: ['C_LEVEL'], actorRoles: ['C_LEVEL'], isImpersonating: true };
  decision = undefined; audit = undefined;
  const reject = await fetch(base.replace('/approve', '/reject'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Review required' }),
  });
  assert.equal(reject.status, 200);
  assert.equal(decision.uid, 17);
  assert.equal(audit.userId, 8);
  assert.equal(audit.reasonText, 'Review required');
  const originalPrimary = process.env.ONPREM_DB_NAME;
  process.env.ONPREM_DB_NAME = 'primary';
  selectedDatabase = 'other';
  try {
    result = await invoke({ sub: 8, actorSub: 17, roles: ['C_LEVEL'], actorRoles: ['C_LEVEL'], isImpersonating: true });
    assert.equal(result.status, 409);
    assert.equal(decision, undefined);
  } finally {
    selectedDatabase = null;
    if (originalPrimary === undefined) delete process.env.ONPREM_DB_NAME;
    else process.env.ONPREM_DB_NAME = originalPrimary;
  }
  claim = { Id: 10, Status: 'TIER2_PENDING', CurrentTier: 2, SalesUserId: 99, RegionCode: '01' };
  currentUser = { sub: 8, actorSub: 17, roles: ['MANAGER'], actorRoles: ['MANAGER'], isImpersonating: true };
  regionalUsers = new Set([8]);
  decision = undefined;
  let regionalResponse = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(regionalResponse.status, 403);
  assert.equal(decision, undefined);
  regionalUsers.add(17);
  regionalResponse = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(regionalResponse.status, 200);
  assert.equal(decision.uid, 17);

  const planBase = `http://127.0.0.1:${server.address().port}/api/rebate/plans/5`;
  plan = { PlanId: 5, Status: 'TIER3_PENDING', CurrentTier: 3 };
  planPrevious = { DecidedBy: 99 };
  currentUser = { sub: 8, actorSub: 17, role: 'SALES', roles: ['SALES', 'C_LEVEL'], actorRoles: ['C_LEVEL'], isImpersonating: true };
  decision = undefined; audit = undefined;
  const decidePlan = suffix => fetch(`${planBase}/${suffix}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Review required' }) });
  let planResponse = await decidePlan('approve');
  assert.equal(planResponse.status, 200);
  assert.equal(decision.uid, 17);
  assert.equal(audit.userId, 8);
  assert.equal(audit.entityType, 'REBATE_PLAN');
  currentUser.actorRoles = ['SALES'];
  decision = undefined;
  planResponse = await decidePlan('approve');
  assert.equal(planResponse.status, 403);
  assert.equal(decision, undefined);
  currentUser.actorRoles = ['C_LEVEL'];
  planConflict = true;
  planResponse = await decidePlan('approve');
  assert.equal(planResponse.status, 409);
  assert.equal(decision, undefined);
  planConflict = false;
  planResponse = await decidePlan('reject');
  assert.equal(planResponse.status, 200);
  assert.equal(decision.uid, 17);
  assert.equal(audit.reasonText, 'Review required');
});
