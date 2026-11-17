'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(({text,inputs}) => {
  if (/WHERE h\.Id = @id/.test(text) && [6,7].includes(Number(inputs.id)))
    return [{ Id:Number(inputs.id), SourceDocumentVisible:Number(inputs.id)===7 ? 1 : 0,
      VerifiedSourceNumber:Number(inputs.id)===7 ? 'CURRENT-REF' : null }];
  if (/WHERE d\.WGHDId = @id/.test(text))
    return [{ GoodTon:1,GoodKasob:20,CouponNo:'OLD-TICKET',RefNo:inputs.sourceVisible && inputs.sourceNumber === 'CURRENT-REF' ? 'CURRENT-REF' : null }];
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/weighing', '../../routes/weighing']]); });
test.after(async () => { await app.close(); });
const user = { sub: 12, role: 'ACCOUNTING' };

test('weighing reports clamp requested history to the system start date', async () => {
  const before = db.calls.length;
  const response = await app.call('GET', '/api/weighing/by-date?from=2025-01-01&to=2026-01-02', { user });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.from, '2026-01-01');
  const call = db.calls.slice(before).find(c => /FROM dbo\.WGHD h/.test(c.text));
  assert.equal(call.inputs.from, '2026-01-01');
  assert.equal(call.inputs.to, '2026-01-02');
  assert.equal((await app.call('GET', '/api/weighing/by-date?from=2026-02-30', { user })).status, 400);
});

test('direct weighing lookup and sales candidates cannot bypass the date boundary', async () => {
  const before = db.calls.length;
  assert.equal((await app.call('GET', '/api/weighing/tickets/5', { user })).status, 404);
  assert.equal((await app.call('GET', '/api/weighing/for-so/5', { user })).status, 200);
  const calls = db.calls.slice(before).filter(c => /h\.DateReg >= @globalStartDate/.test(c.text));
  assert.equal(calls.length, 2);
  for (const c of calls) assert.equal(c.inputs.globalStartDate, '2026-01-01');
  const forSo = calls.find(c => /h\.SPID = @soid/.test(c.text));
  assert.match(forSo.text, /h\.WGType = 'SO'/);
  assert.match(forSo.text, /EXISTS \(SELECT 1 FROM dbo\.SOHD s WHERE s\.SOID=h\.SPID AND s\.DocuDate >= @globalStartDate\)/);
});

test('live, anomalies and coverage apply the same boundary, including detail counts', async () => {
  const before = db.calls.length;
  for (const route of ['/live', '/anomalies', '/coverage']) {
    assert.equal((await app.call('GET', `/api/weighing${route}`, { user })).status, 200);
  }
  const calls = db.calls.slice(before).filter(c => /@globalStartDate/.test(c.text));
  assert.equal(calls.length, 3);
  for (const c of calls) assert.equal(c.inputs.globalStartDate, '2026-01-01');
  assert.match(calls.find(c => /AS DetailRows/.test(c.text)).text, /JOIN dbo\.WGHD h ON h\.Id=d\.WGHDId WHERE h\.DateReg >= @globalStartDate/);
  assert.match(calls.find(c => /AS Issue/.test(c.text)).text, /WHERE h\.DateReg >= @globalStartDate AND \(/);
});

test('weighing keeps current quantities while hiding unverified or old source references', async () => {
  const before=db.calls.length;
  for (const route of ['/live','/tickets?from=2026-01-01&to=2026-01-02','/by-so?from=2026-01-01&to=2026-01-02'])
    assert.equal((await app.call('GET',`/api/weighing${route}`,{user})).status,200);
  const hidden=await app.call('GET','/api/weighing/tickets/6',{user});
  const visible=await app.call('GET','/api/weighing/tickets/7',{user});
  assert.equal(hidden.status,200);assert.equal(hidden.body.items[0].RefNo,null);
  assert.equal(hidden.body.items[0].CouponNo,'OLD-TICKET');assert.equal(hidden.body.totals.ton,1);
  assert.equal(visible.body.items[0].RefNo,'CURRENT-REF');
  assert.equal('VerifiedSourceNumber' in visible.body,false);
  const calls=db.calls.slice(before);
  const heads=calls.filter(c=>/WHERE h\.Id = @id/.test(c.text));
  assert.ok(heads.every(c=>/RTRIM\(h\.DocuNo\)=RTRIM\(CASE WHEN h\.WGType='SO' THEN so\.DocuNo WHEN h\.WGType='PO' THEN po\.DocuNo ELSE NULL END\)/.test(c.text)));
  const details=calls.filter(c=>/WHERE d\.WGHDId = @id/.test(c.text));
  assert.deepEqual(details.map(c=>c.inputs.sourceVisible),[false,true]);
  assert.deepEqual(details.map(c=>c.inputs.sourceNumber),[null,'CURRENT-REF']);
  assert.ok(details.every(c=>/CASE WHEN @sourceVisible=1 AND RTRIM\(d\.RefNo\)=RTRIM\(@sourceNumber\)\s+THEN d\.RefNo END AS RefNo/.test(c.text)));
  const sourceQueries=calls.filter(c=>/LEFT JOIN dbo\.POHD\s+po/.test(c.text));
  assert.equal(sourceQueries.length,4);
  assert.ok(sourceQueries.every(c=>/po\.DocuDate >= @globalStartDate/.test(c.text)));
  const bySo=calls.find(c=>/delivery\.DeliveryNoteCount/.test(c.text));
  assert.match(bySo.text,/CASE WHEN bk\.DocuDate >= @globalStartDate THEN bk\.SOID END AS SPID/);
});
