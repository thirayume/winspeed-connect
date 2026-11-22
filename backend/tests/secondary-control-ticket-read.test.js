'use strict';
// Handler tests for the reviewed secondary-database reads of control tickets and
// effective prices. With an identity mapping the records must be inside the scope of the
// effective user AND of the real actor, and a customer filter needs a visible customer.
// Customer-filtered reads are now scope checked on the primary database too.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const mapped = () => ({ sub: 8, actorSub: 17, role: 'SALES', actorRole: 'SALES', isImpersonating: true,
  identityMapping: { primaryActorUserId: 17, primaryEffectiveUserId: 8, businessActorUserId: 47, businessEffectiveUserId: 34 } });
let user = mapped();
let visible = true;
let hasConsumedColumn = false;
let nativeHoldSchema;
let nativeRecoverySchema,recoveryRows=[];
let ticketRows=[], detailRows=[], sourceConflicts=[];
let failSourceCheck=false;

const auth = require.resolve('../middleware/auth');
require.cache[auth] = { id: auth, filename: auth, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = user; next(); },
  requireRole: () => (_req, _res, next) => next(),
  requireCapability: () => (_req, _res, next) => next(),
} };
const db = h.installDbStub(({ text, inputs }) => {
  if (text.includes('AS RecoveryExists')) return recoveryRows;
  if (text.includes('COUPON_SOURCE_CONFLICTS_V1')) {
    if(failSourceCheck) throw new Error('database unavailable');
    return sourceConflicts.map(ConflictCouponId=>({ConflictCouponId}));
  }
  if (/COL_LENGTH\('wf\.CouponReservation','ConsumedQty'\)/.test(text)) return [{ConsumedQtyColumn:hasConsumedColumn ? 9 : null,SettlementTable:hasConsumedColumn ? 123 : null}];
  if (/PagingCTE AS/.test(text)) return ticketRows;
  if (/c\.CouponID AS _couponId/.test(text)) return detailRows;
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text)) return [{ Id: Number(inputs.id), EmpId: Number(inputs.id) + 1000, PositionCode: null }];
  if (/WHERE c\.CustID=@visibilityCustId/.test(text)) return visible ? [{ ok: 1 }] : [];
  if (/SELECT Id, Status, EffectiveMonth/.test(text)) return [{Id:5,Status:'ACTIVE',EffectiveMonth:'2026-11',EffectiveFrom:'2026-11-01',EffectiveTo:'2026-11-30'}];
  return [];
}, {nativeHoldSchema:()=>nativeHoldSchema,nativeRecoverySchema:()=>nativeRecoverySchema});
const win = require.resolve('../services/global-data-window-store');
let failWindow = false;
require.cache[win].exports.readGlobalDataWindow = async () => {
  if (failWindow) throw new Error('missing window');
  return require('../services/data-window').boundaries('2026-01-01');
};

let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master'], ['/api/pricebook', '../../routes/pricebook']]); });
test.after(async () => app.close());
test.beforeEach(() => { user = mapped(); visible = true; hasConsumedColumn = false; nativeHoldSchema=null; nativeRecoverySchema=null; recoveryRows=[]; ticketRows=[]; detailRows=[]; sourceConflicts=[]; failSourceCheck=false; db.calls.length = 0; });

const ticketQuery = () => db.calls.find(c => /WFCoupon/.test(c.text) && /h104\.DocuDate/.test(c.text));

test('control ticket list stops before reading balances when recovery rows exist',async()=>{
  nativeRecoverySchema={...require('./helpers/coupon-bridge-metadata').absent,RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger232:0,EditHoldVisible:0,Ledger231:1,RecoveryVisible:1,RecoverySelect:1,SchemaSelect:1};
  recoveryRows=[{RecoveryExists:1}];
  const result=await app.call('GET','/api/master/control-tickets');
  assert.equal(result.status,409);assert.equal(result.body.code,'COUPON_RECOVERY_REVIEW_REQUIRED');assert.equal(ticketQuery(),undefined);
});

test('control ticket list stops a page with a changed settled source without exposing its balance',async()=>{
  hasConsumedColumn=true;
  ticketRows=[{CouponID:42,AvailableQtyTon:1,TotalFilteredCount:1}];
  sourceConflicts=[42];
  const result=await app.call('GET','/api/master/control-tickets?paginated=true');
  assert.equal(result.status,409);
  assert.equal(result.body.code,'COUPON_SETTLEMENT_SOURCE_CHANGED');
  assert.equal(JSON.stringify(result.body).includes('AvailableQtyTon'),false);
  const check=db.calls.find(c=>c.text.includes('COUPON_SOURCE_CONFLICTS_V1'));
  assert.equal(check.inputs.cid0,42);
  assert.doesNotMatch(check.text,/dataStart/i,'settlement evidence includes opening history');
});

test('control ticket list allows an unchanged page and fails closed when source check fails',async()=>{
  hasConsumedColumn=true;
  ticketRows=[{CouponID:42,AvailableQtyTon:1,TotalFilteredCount:1}];
  const ok=await app.call('GET','/api/master/control-tickets?paginated=true');
  assert.equal(ok.status,200);
  assert.equal(ok.body.data[0].AvailableQtyTon,1);
  failSourceCheck=true;
  const error=await app.call('GET','/api/master/control-tickets?paginated=true');
  assert.equal(error.status,503);
  assert.equal(error.body.code,'COUPON_SOURCE_HOLD_UNAVAILABLE');
  assert.equal(JSON.stringify(error.body).includes('AvailableQtyTon'),false);
});

test('scoped coupon detail does not reveal a changed source balance or an internal ID',async()=>{
  hasConsumedColumn=true;
  detailRows=[{_couponId:42,QtyTon:1,ListNo:1}];
  const path='/api/master/control-tickets/D123?entityType=COUPON&exactId=42';
  let result=await app.call('GET',path);
  assert.equal(result.status,200);
  assert.deepEqual(result.body,[{QtyTon:1,ListNo:1}]);
  const detail=db.calls.find(c=>/c\.CouponID AS _couponId/.test(c.text));
  assert.match(detail.text,/FROM dbo\.WFCoupon c WITH \(READCOMMITTEDLOCK\)\s+JOIN/);
  assert.match(detail.text,/lcpE0/);assert.match(detail.text,/lcpaE0/);
  sourceConflicts=[42];
  result=await app.call('GET',path);
  assert.equal(result.status,409);assert.equal(result.body.code,'COUPON_SETTLEMENT_SOURCE_CHANGED');
  assert.equal(JSON.stringify(result.body).includes('QtyTon'),false);
  sourceConflicts=[];failSourceCheck=true;
  result=await app.call('GET',path);
  assert.equal(result.status,503);assert.equal(result.body.code,'COUPON_SOURCE_HOLD_UNAVAILABLE');
  failSourceCheck=false;
  nativeRecoverySchema={...require('./helpers/coupon-bridge-metadata').absent,RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger232:0,EditHoldVisible:0,Ledger231:1,RecoveryVisible:1,RecoverySelect:1,SchemaSelect:1};
  recoveryRows=[{RecoveryExists:1}];
  result=await app.call('GET',path);
  assert.equal(result.status,409);assert.equal(result.body.code,'COUPON_RECOVERY_REVIEW_REQUIRED');
});

test('ticket balances account for partial settlement while older schemas stay conservative', async () => {
  hasConsumedColumn = true;
  assert.equal((await app.call('GET','/api/master/control-tickets')).status,200);
  assert.match(ticketQuery().text,/cr\.ReservedQty - ISNULL\(cr\.ConsumedQty,0\)/);
  hasConsumedColumn = false; db.calls.length = 0;
  assert.equal((await app.call('GET','/api/master/control-tickets')).status,200);
  assert.match(ticketQuery().text,/SUM\(cr\.ReservedQty\) AS TotalReserved/);
});

test('ticket balances retain expired active authorizations and partial schema is rejected', async () => {
  nativeHoldSchema={...require('./helpers/coupon-bridge-metadata').absent,NativeHoldSchemaState:'NATIVE_HOLD_SCHEMA_V1',Ledger220:1,HeaderVisible:1,LineVisible:1,HeaderSelect:1,LineSelect:1};
  assert.equal((await app.call('GET','/api/master/control-tickets')).status,200);
  assert.match(ticketQuery().text,/ahl\.ReservationId=cr\.Id AND ah\.State='ACTIVE'/);
  nativeHoldSchema={...nativeHoldSchema,LineVisible:0};db.calls.length=0;
  const result=await app.call('GET','/api/master/control-tickets');
  assert.equal(result.status,503);assert.equal(result.body.code,'COUPON_AUTH_HOLD_SCHEMA_UNAVAILABLE');
  assert.equal(ticketQuery(),undefined);
});

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

test('draw history enforces the configured start date and both identities on the primary database', async () => {
  user = { sub: 8, actorSub: 17, role: 'SALES', actorRole: 'SALES', isImpersonating: true };
  assert.equal((await app.call('GET', '/api/master/control-tickets/D123/draws?entityType=COUPON&exactId=42')).status, 200);
  const coupon = db.calls.find(c => /FROM dbo\.WFRedemtionDT rd/.test(c.text));
  assert.ok(coupon); assert.match(coupon.text, /rh\.DocuDate >= @dataStart/);
  assert.equal(coupon.inputs.dataStart, '2026-01-01');
  assert.equal(coupon.inputs.dcpE0, '1008'); assert.equal(coupon.inputs.dcpaE0, '1017');
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/master/control-tickets/CT-1/draws')).status, 200);
  const delivery = db.calls.find(c => /FROM dbo\.SOHD h2/.test(c.text));
  assert.ok(delivery); assert.match(delivery.text, /h2\.DocuDate >= @dataStart/);
  assert.equal(delivery.inputs.dataStart, '2026-01-01');
  assert.equal(delivery.inputs.ddvE0, '1008'); assert.equal(delivery.inputs.ddvaE0, '1017');
});

test('draw history fails closed if the start date cannot be read', async () => {
  failWindow = true;
  try {
    const r = await app.call('GET', '/api/master/control-tickets/D123/draws');
    assert.equal(r.status, 503); assert.equal(r.body.code, 'DATA_WINDOW_UNAVAILABLE');
    assert.equal(db.calls.some(c => /FROM dbo\.WFRedemtionDT rd/.test(c.text)), false);
  } finally { failWindow = false; }
});

test('ticket trace never returns source details from before the configured start', async () => {
  user = { sub: 8, actorSub: 8, role: 'ADMIN', actorRole: 'ADMIN', isImpersonating: false };
  const service = require('../services/ticket-policy');
  const original = service.traceNativeTicketChain;
  try {
    service.traceNativeTicketChain = async () => ({ chain: { bookings: [{ soId: 1, docuDate: '2025-12-31', docuNo: 'OLD-SECRET' }] } });
    const hidden = await app.call('GET', '/api/master/control-tickets/D123/trace');
    assert.equal(hidden.status, 409); assert.equal(hidden.body.code, 'TICKET_TRACE_BEFORE_DATA_START');
    assert.equal(JSON.stringify(hidden.body).includes('OLD-SECRET'), false);
    service.traceNativeTicketChain = async () => ({ chain: { bookings: [{ soId: 1, docuDate: '2026-01-01' }] } });
    assert.equal((await app.call('GET', '/api/master/control-tickets/D123/trace')).status, 200);
    failWindow = true;
    assert.equal((await app.call('GET', '/api/master/control-tickets/D123/trace')).status, 503);
  } finally { failWindow = false; service.traceNativeTicketChain = original; }
});

test('an invalid identity mapping fails closed', async () => {
  user.identityMapping.primaryActorUserId = 999;
  const r = await app.call('GET', '/api/master/control-tickets');
  assert.ok(r.status >= 400, `status ${r.status}`);
  assert.equal(ticketQuery(), undefined);
});

test('effective prices on a secondary database never show another customer\'s special price', async () => {
  const priceQuery = () => db.calls.find(c => /FROM wf\.PriceBookLine l/.test(c.text));
  visible = false;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective?custId=123')).status, 404);
  assert.equal(priceQuery(), undefined);
  visible = true; db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective?custId=123')).status, 200);
  assert.match(priceQuery().text, /sp\.CustId=@cust/);
  assert.equal(priceQuery().inputs.cust, '123');
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective')).status, 200);
  assert.match(priceQuery().text, /sp\.CustId=@cust/, 'without a customer only standard rows match');
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
    assert.match(q.text, /CASE WHEN h103\.DocuDate >= @ctDataStart THEN h103\.DocuNo END AS BookingDocuNo/);
    assert.match(q.text, /CASE WHEN h104\.DocuDate >= @ctDataStart THEN h104\.DocuNo END AS DeliveryDocuNo/);
    assert.match(q.text, /CASE WHEN h104\.DocuDate >= @ctDataStart THEN h104\.DocuDate END AS DocuDate/);
    assert.equal(q.inputs.ctDataStart, '2026-01-01');
  }
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/master/control-tickets?q=old')).status, 200);
  assert.match(ticketQuery().text, /h103\.DocuDate >= @ctDataStart AND \(h103\.DocuNo LIKE @q/);
  assert.match(ticketQuery().text, /h104\.DocuDate >= @ctDataStart AND h104\.DocuNo LIKE @q/);
  failWindow = true; db.calls.length = 0;
  try {
    const r = await app.call('GET', '/api/master/control-tickets');
    assert.equal(r.status, 503); assert.equal(r.body.code, 'DATA_WINDOW_UNAVAILABLE');
    assert.equal(ticketQuery(), undefined, 'nothing is read when the start date cannot be checked');
  } finally { failWindow = false; }
});

test('pending 103 and draft lists use the correct business and UTC window boundaries', async () => {
  assert.equal((await app.call('GET', '/api/master/control-tickets?tab=PENDING')).status, 200);
  const q = db.calls.find(c => /FROM dbo\.SOHD h WITH \(NOLOCK\)/.test(c.text) && /FROM wf\.SalesOrder so WITH \(NOLOCK\)/.test(c.text));
  assert.ok(q);
  assert.match(q.text, /h\.DocuDate >= @ctDataStart/);
  assert.match(q.text, /so\.CreatedAt >= @ctDataStartUtc/);
  assert.equal(q.inputs.ctDataStart, '2026-01-01');
  assert.equal(q.inputs.ctDataStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
});

test('ticket detail filters source documents but allows an old non-cancelled coupon balance', async () => {
  for (const [path, source, required] of [
    ['D123?entityType=COUPON&exactId=42', /FROM dbo\.WFCoupon c/, /issuer\.DocuDate >= @dataStart OR \(c\.RemaQty <> 0 AND ISNULL\(issuer\.DocuStatus, ''\) <> 'C'\)/],
    ['AI-1?entityType=DRAFT&exactId=42', /FROM wf\.SalesOrder h/, /h\.Status = 'DRAFT' AND h\.CreatedAt >= @dataStartUtc/],
    ['TEST?entityType=BOOKING&exactId=42', /FROM dbo\.SOHD h WITH \(NOLOCK\)/, /h\.DocuDate >= @dataStart/],
  ]) {
    db.calls.length = 0;
    assert.equal((await app.call('GET', '/api/master/control-tickets/' + path)).status, 200);
    const q = db.calls.find(c => source.test(c.text)); assert.ok(q, path); assert.match(q.text, required);
    if (q.inputs.dataStart) assert.equal(q.inputs.dataStart, '2026-01-01');
    if (q.inputs.dataStartUtc) assert.equal(q.inputs.dataStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  }
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/master/control-tickets/D123?exactId=42x')).status, 400);
  assert.equal(db.calls.some(c => /FROM dbo\.WFCoupon c/.test(c.text)), false);
  failWindow = true; db.calls.length = 0;
  try {
    assert.equal((await app.call('GET', '/api/master/control-tickets/D123')).status, 503);
    assert.equal(db.calls.some(c => /FROM dbo\.WFCoupon c/.test(c.text)), false);
  } finally { failWindow = false; }
});

test('on the primary database customer-filtered ticket reads check visibility', async () => {
  user = { sub: 8, actorSub: 17, role: 'SALES', actorRole: 'ADMIN', isImpersonating: true };
  assert.equal((await app.call('GET', '/api/master/control-tickets')).status, 200);
  const q = ticketQuery();
  assert.match(q.text, /IN \(@ctE0\)/); assert.doesNotMatch(q.text, /@ctaE0/);
  assert.equal(q.inputs.ctE0, '1008');
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/master/control-tickets?custId=123')).status, 200);
  assert.equal(db.calls.some(c => /@visibilityCustId/.test(c.text)), true);
  db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective')).status, 200);
  const price = db.calls.find(c => /FROM wf\.PriceBookLine l/.test(c.text));
  assert.match(price.text, /sp\.CustId=@cust/); assert.equal(price.inputs.cust, null);
  visible = false; db.calls.length = 0;
  assert.equal((await app.call('GET', '/api/pricebook/5/effective?custId=123')).status, 404);
  assert.equal(db.calls.some(c => /FROM wf\.PriceBookLine l/.test(c.text)), false);
});

test('unfiltered primary ticket list intersects actual actor scope during Access As', async () => {
  user = { sub:8, actorSub:17, role:'SALES', actorRole:'SALES', isImpersonating:true };
  assert.equal((await app.call('GET','/api/master/control-tickets')).status,200);
  const q=ticketQuery();assert.equal(q.inputs.ctE0,'1008');assert.equal(q.inputs.ctaE0,'1017');
  assert.match(q.text,/CAST\(h104\.EmpID AS VARCHAR\(20\)\) IN \(@ctaE0\)/);
});
