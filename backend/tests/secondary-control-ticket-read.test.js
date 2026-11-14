'use strict';
// Handler tests for the reviewed secondary-database reads of control tickets and
// effective prices. With an identity mapping the records must be inside the scope of the
// effective user AND of the real actor, and a customer filter needs a visible customer.
// Without a mapping (primary database) the handlers keep their existing behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const mapped = () => ({ sub: 8, actorSub: 17, role: 'SALES', actorRole: 'SALES', isImpersonating: true,
  identityMapping: { primaryActorUserId: 17, primaryEffectiveUserId: 8, businessActorUserId: 47, businessEffectiveUserId: 34 } });
let user = mapped();
let visible = true;

const auth = require.resolve('../middleware/auth');
require.cache[auth] = { id: auth, filename: auth, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = user; next(); },
  requireRole: () => (_req, _res, next) => next(),
  requireCapability: () => (_req, _res, next) => next(),
} };
const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text)) return [{ Id: Number(inputs.id), EmpId: Number(inputs.id) + 1000, PositionCode: null }];
  if (/WHERE c\.CustID=@visibilityCustId/.test(text)) return visible ? [{ ok: 1 }] : [];
  return [];
});
const win = require.resolve('../services/global-data-window-store');
let failWindow = false;
require.cache[win].exports.readGlobalDataWindow = async () => {
  if (failWindow) throw new Error('missing window');
  return require('../services/data-window').boundaries('2026-01-01');
};

let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master'], ['/api/pricebook', '../../routes/pricebook']]); });
test.after(async () => app.close());
test.beforeEach(() => { user = mapped(); visible = true; db.calls.length = 0; });

const ticketQuery = () => db.calls.find(c => /WFCoupon/.test(c.text) && /h104\.DocuDate/.test(c.text));

test('control ticket list on a secondary database applies the scopes of both identities', async () => {
  const r = await app.call('GET', '/api/master/control-tickets');
  assert.equal(r.status, 200);
  const q = ticketQuery();
  assert.ok(q, 'the ticket query ran');
  assert.match(q.text, /CAST\(h104\.EmpID AS VARCHAR\(20\)\) IN \(@ctE0\)/);
  assert.match(q.text, /CAST\(h104\.EmpID AS VARCHAR\(20\)\) IN \(@ctaE0\)/);
  assert.equal(q.inputs.ctE0, '1034', 'effective user is the mapped business ID');
  assert.equal(q.inputs.ctaE0, '1047', 'real actor is the mapped business ID');
  // pending bookings and draft bills carry the same pair of filters
  assert.equal(q.inputs.cpE0, '1034'); assert.equal(q.inputs.cpaE0, '1047');
  assert.equal(q.inputs.cdU0, 34); assert.equal(q.inputs.cdaU0, 47);
});

test('a customer filter needs a customer both identities may see', async () => {
  visible = false;
  const denied = await app.call('GET', '/api/master/control-tickets?custId=123');
  assert.equal(denied.status, 404);
  assert.equal(ticketQuery(), undefined, 'no ticket query for a hidden customer');
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/master/control-tickets?custId=abc')).status, 404);
  visible = true; db.calls.length = 0;
  const ok = await app.call('GET', '/api/master/control-tickets?custId=123');
  assert.equal(ok.status, 200);
  const check = db.calls.find(c => /WHERE c\.CustID=@visibilityCustId/.test(c.text));
  assert.equal(check.inputs.visibilityCustId, 123);
  assert.equal(check.inputs.customerScope0U0, 34); assert.equal(check.inputs.customerScope1U0, 47);
  assert.match(ticketQuery().text, /h104\.CustID = @custId/);
});

test('ticket detail and draws apply both scopes; alerts stay empty unless both see everything', async () => {
  await app.call('GET', '/api/master/control-tickets/CT-1');
  const detail = db.calls.map(c => c.text).join('\n');
  assert.match(detail, /IN \(@lsoE0\)/); assert.match(detail, /IN \(@lsoaE0\)/);
  db.calls.length = 0;
  await app.call('GET', '/api/master/control-tickets/CT-1/draws');
  const draws = db.calls.map(c => c.text).join('\n');
  assert.match(draws, /IN \(@ddvE0\)/); assert.match(draws, /IN \(@ddvaE0\)/);
  db.calls.length = 0;
  const alerts = await app.call('GET', '/api/master/control-tickets/alerts');
  assert.equal(alerts.status, 200); assert.deepEqual(alerts.body, []);
  assert.equal(db.calls.some(c => /ControlTicketAlert/.test(c.text)), false, 'the alert table is not read for a limited scope');
  user = { ...mapped(), role: 'ADMIN', actorRole: 'ADMIN' }; db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/master/control-tickets/alerts')).status, 200);
  assert.equal(db.calls.some(c => /ControlTicketAlert/.test(c.text)), true);
});

test('an invalid identity mapping fails closed', async () => {
  user.identityMapping.primaryActorUserId = 999;
  const r = await app.call('GET', '/api/master/control-tickets');
  assert.ok(r.status >= 400, `status ${r.status}`);
  assert.equal(ticketQuery(), undefined);
});

test('effective prices on a secondary database never show another customer\'s special price', async () => {
  const priceQuery = () => db.calls.find(c => /FROM wf\.v_PriceBookEffective/.test(c.text));
  visible = false;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective?custId=123')).status, 404);
  assert.equal(priceQuery(), undefined);
  visible = true; db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective?custId=123')).status, 200);
  assert.doesNotMatch(priceQuery().text, /@cust IS NULL OR/);
  assert.equal(priceQuery().inputs.cust, '123');
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective')).status, 200);
  assert.doesNotMatch(priceQuery().text, /@cust IS NULL OR/, 'without a customer only standard rows match');
  assert.equal(priceQuery().inputs.cust, null);
});

test('tickets issued before the data start date stay only while they carry a balance', async () => {
  user = { sub: 8, actorSub: 8, role: 'SALES', actorRole: 'SALES', isImpersonating: false };
  for (const tab of ['', '?tab=HISTORY', '?tab=ALL', '?custId=123']) {
    db.calls.length = 0;
    assert.equal((await app.call('GET', `/api/master/control-tickets${tab}`)).status, 200, tab);
    const q = ticketQuery();
    assert.match(q.text, /ISNULL\(h104\.DocuDate, h103\.DocuDate\) >= @ctDataStart/);
    assert.match(q.text, /OR \(c\.RemaQty <> 0 AND ISNULL\(h104\.DocuStatus, ''\) <> 'C'\)/);
    assert.equal(q.inputs.ctDataStart, '2026-01-01');
  }
  failWindow = true; db.calls.length = 0;
  try {
    const r = await app.call('GET', '/api/master/control-tickets');
    assert.equal(r.status, 503); assert.equal(r.body.code, 'DATA_WINDOW_UNAVAILABLE');
    assert.equal(ticketQuery(), undefined, 'nothing is read when the start date cannot be checked');
  } finally { failWindow = false; }
});

test('on the primary database the handlers keep their existing single-scope behaviour', async () => {
  user = { sub: 8, actorSub: 17, role: 'SALES', actorRole: 'ADMIN', isImpersonating: true };
  assert.equal((await app.call('GET', '/api/master/control-tickets')).status, 200);
  const q = ticketQuery();
  assert.match(q.text, /IN \(@ctE0\)/); assert.doesNotMatch(q.text, /@ctaE0/);
  assert.equal(q.inputs.ctE0, '1008');
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/master/control-tickets?custId=123')).status, 200);
  assert.equal(db.calls.some(c => /@visibilityCustId/.test(c.text)), false);
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective')).status, 200);
  assert.match(db.calls.find(c => /FROM wf\.v_PriceBookEffective/.test(c.text)).text, /@cust IS NULL OR/);
});
