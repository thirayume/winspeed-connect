'use strict';
// Deleting a trip and attaching a bill to it take the same row lock on the trip, so they
// cannot interleave. The fake database below models that lock: the UPDLOCK read waits
// until the other transaction has finished.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/route-harness.cjs');
h.installDbStub(() => []);
const { lockTripForMembership, deleteTripIfEmpty } = require('../services/trip-membership-lock');

function fakeDatabase({ status = 'OPEN', bills = 0,visible=true } = {}) {
  const db = { trip: { TripId: 7, Status: status }, bills, statements: [], lockOwner: null, waiters: [] };
  db.begin = () => {
    const tx = { id: Symbol('tx') };
    const run = async (text, inputs) => {
      db.statements.push(text);
      if(text.includes('SELECT Id, EmpId, PositionCode'))return {recordset:[{Id:Number(inputs.id),EmpId:null,PositionCode:null}]};
      if(text.includes('WHERE t.TripId=@membershipTripId'))return {recordset:visible?[{ok:1}]:[]};
      if (/FROM wf\.SalesTrip WITH \(UPDLOCK, HOLDLOCK\)/.test(text)) {
        while (db.lockOwner && db.lockOwner !== tx.id) await new Promise(resolve => db.waiters.push(resolve));
        db.lockOwner = tx.id;
        return { recordset: Number(inputs.tripLockId) === 7 && db.trip ? [{ ...db.trip }] : [] };
      }
      if (/SELECT COUNT\(\*\) AS Cnt/.test(text)) return { recordset: [{ Cnt: db.bills }] };
      if (/UPDATE wf\.SalesTrip SET Status = 'DELETED'/.test(text)) { const hit = db.trip.Status !== 'DELETED'; db.trip.Status = 'DELETED'; return { rowsAffected: [hit ? 1 : 0] }; }
      throw new Error('unexpected statement');
    };
    tx.request = () => { const inputs = {}; const r = { input: (k, _t, v) => { inputs[k] = v; return r; }, query: text => run(text, inputs) }; return r; };
    tx.end = () => { if (db.lockOwner === tx.id) { db.lockOwner = null; db.waiters.splice(0).forEach(w => w()); } };
    return tx;
  };
  return db;
}
const pause = () => new Promise(resolve => setImmediate(resolve));
async function addBill(db) {
  const tx = db.begin();
  try { await lockTripForMembership(tx, 7); await pause(); db.bills++; return 'added'; }
  catch (e) { return e.code; } finally { tx.end(); }
}
async function removeTrip(db) {
  const tx = db.begin();
  try { await pause(); const r = await deleteTripIfEmpty(tx, 7); return r.deleted ? 'deleted' : (r.found ? `kept(${r.activeBills})` : 'not found'); }
  finally { tx.end(); }
}

test('a bill and a delete racing for the same trip never leave a bill on a deleted trip', async () => {
  for (let round = 0; round < 40; round++) {
    const db = fakeDatabase();
    const jobs = round % 2 ? [addBill(db), removeTrip(db)] : [removeTrip(db), addBill(db)];
    const outcome = (await Promise.all(jobs)).sort().join(' + ');
    assert.ok(!(db.trip.Status === 'DELETED' && db.bills > 0), `round ${round}: ${outcome}`);
    assert.ok(['TRIP_DELETED + deleted', 'added + kept(1)'].includes(outcome), outcome);
  }
});

test('joining a missing, deleted or malformed trip is refused; no trip means no lock', async () => {
  const gone = fakeDatabase({ status: 'DELETED' });
  await assert.rejects(() => lockTripForMembership(gone.begin(), 7), e => e.status === 409 && e.code === 'TRIP_DELETED');
  const db = fakeDatabase();
  await assert.rejects(() => lockTripForMembership(db.begin(), 8), e => e.status === 409 && e.code === 'TRIP_NOT_FOUND');
  for (const bad of ['abc', -1, 0.5, 3000000000]) await assert.rejects(() => lockTripForMembership(db.begin(), bad), e => e.code === 'TRIP_NOT_FOUND');
  const before = db.statements.length;
  assert.equal(await lockTripForMembership(db.begin(), null), null);
  assert.equal(await lockTripForMembership(db.begin(), ''), null);
  assert.equal(db.statements.length, before, 'no query without a trip');
});
test('membership authorization uses the locked transaction and rejects a hidden or mixed trip before attaching a bill',async()=>{
 const hidden=fakeDatabase({visible:false}),tx=hidden.begin();
 try{await assert.rejects(lockTripForMembership(tx,7,{sub:43,role:'SALES'}),e=>e.status===404&&e.code==='TRIP_NOT_FOUND');assert.equal(hidden.bills,0);assert.equal(hidden.lockOwner,tx.id);}
 finally{tx.end();}
 const own=fakeDatabase(),ok=own.begin();try{await lockTripForMembership(ok,7,{sub:43,role:'SALES'});assert.ok(own.statements.some(s=>s.includes('outsideMember')&&s.includes('@tripStartUtc')));}finally{ok.end();}
});

test('delete keeps a trip that still has bills and counts them from committed rows', async () => {
  const db = fakeDatabase({ bills: 2 });
  const tx = db.begin();
  assert.deepEqual(await deleteTripIfEmpty(tx, 7), { deleted: false, found: true, activeBills: 2, previousStatus: 'OPEN' });
  assert.equal(db.trip.Status, 'OPEN');
  const count = db.statements.find(s => /SELECT COUNT\(\*\) AS Cnt/.test(s));
  assert.doesNotMatch(count, /wf\.SalesOrder so WITH \(NOLOCK\)|wf\.SalesOrderExt ext WITH \(NOLOCK\)/, 'app tables are read without NOLOCK');
  tx.end();
  const empty = fakeDatabase();
  const first = empty.begin();
  assert.deepEqual(await deleteTripIfEmpty(first, 7), { deleted: true, found: true, activeBills: 0, previousStatus: 'OPEN' });
  first.end();
  const second = empty.begin();
  assert.deepEqual(await deleteTripIfEmpty(second, 7), { deleted: false, found: false, activeBills: 0 });
  second.end();
});

test('the routes use the lock: bill create and edit join under it, both delete paths go through it', () => {
  const so = fs.readFileSync(path.join(__dirname, '../routes/so.js'), 'utf8');
  const trips = fs.readFileSync(path.join(__dirname, '../routes/trips.js'), 'utf8');
  const create = so.slice(so.indexOf("router.post('/', requireCapability('so.create')"), so.indexOf("router.put('/:id', requireCapability('so.edit')"));
  assert.ok(create.indexOf('lockTripForMembership(tx, tripToJoin,req.user)') > 0 && create.indexOf('lockTripForMembership(tx, tripToJoin,req.user)') < create.indexOf('INSERT INTO wf.SalesOrder'),
    'create takes the trip lock before the first insert');
  assert.match(so,/\[existingRow\.TripId,effectiveTripId\]/);
  assert.match(so,/lockTripForMembership\(tx,membershipTrip,req.user\)/);
  assert.match(so, /deleteTripIfEmpty\(tx, tid\)/);
  assert.doesNotMatch(so, /UPDATE wf\.SalesTrip SET Status = 'DELETED'/);
  const del = trips.slice(trips.indexOf("router.delete('/:id'"));
  const body = del.slice(0, del.indexOf('// ── Multi-customer'));
  assert.match(body, /wfTransaction\(async tx =>/); assert.match(body, /deleteTripIfEmpty\(tx, tripId,req\.user\)/); assert.match(body, /action: 'DELETE'/);
  assert.doesNotMatch(body, /UPDATE wf\.SalesTrip SET Status = 'DELETED'/);
});
