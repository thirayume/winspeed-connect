'use strict';

/**
 * UAT full loop 2026-10-09 (FL13) & Owner decision 2026-11-25:
 * - Users from SALES upwards (SALES, COUNTER_SALES, APPROVER, ACCOUNTING, MANAGER, C_LEVEL, ADMIN)
 *   may confirm both new draft bills and unlocked WinSpeed bills directly without Counter-Sales re-check (FR-022).
 * - Non-sales operational roles (e.g. WAREHOUSE / WEIGHBRIDGE, even with custom so.confirm profile) still require VerifiedAt.
 * - Optional /verify still records VerifiedAt on wf.SalesOrderExt / wf.SalesOrder, and confirm clears it on lock.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const { capabilitiesFor, canConfirmWithoutCounterVerify } = require('../services/role-capabilities');

const ext = { 278000: { SOID: '278000', TripId: null, IsUnlocked: true, VerifiedAt: null, ConfirmedAt: '2026-10-06T00:00:00Z' } };
let warehouseCustomConfirm = false;
let controlTicketFixture=false;
const db = h.installDbStub(({ text, inputs }) => {
  if(text.includes('sp_getapplock'))return [{LockResult:0}];
  if(text.includes('SELECT Id, EmpId, PositionCode'))return [{Id:inputs.id,EmpId:null,PositionCode:Number(inputs.id)===64?'QA-MANAGER':null}];
  if(text.includes('SELECT PositionCode,ReportsTo,RecordScope,IsActive'))return [{PositionCode:'QA-MANAGER',RecordScope:'ORG',IsActive:1}];
  if(text.includes(';WITH tree AS'))return [{Id:64,EmpId:null},{Id:43,EmpId:null}];
  if (warehouseCustomConfirm && Number(inputs.id) === 91) {
    if (/SELECT Role,RoleCode,AuthVersion,MustChangePassword,IsActive FROM wf\.AppUser/.test(text)) {
      return [{ Role: 'WAREHOUSE', RoleCode: 'WH_CONFIRM', AuthVersion: 0, MustChangePassword: 0, IsActive: 1 }];
    }
    if (/FROM wf\.vUserRole u/.test(text)) {
      return [{ Code: 'WH_CONFIRM', BaseRole: 'WAREHOUSE', PermissionCode: 'so.confirm' }];
    }
  }
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) {
    if (Number(inputs.id) === 278000) return [{ Id: '278000', Status: 'DRAFT', SalesUserId: 43, WfRef: 'I69-04219', CustId: '1078' }];
    if (Number(inputs.id) === 21) return [{ Id: 21, Status: 'DRAFT', SalesUserId: 43, WfRef: 'I69-09021', CustId: '1078' }];
    return [];
  }
  if (/UPDATE wf\.SalesOrderExt SET VerifiedBy=@uid/.test(text)) {
    const row = ext[inputs.id];
    if (row && row.IsUnlocked) { row.VerifiedAt = new Date(); return { recordset: [], rowsAffected: [1] }; }
    return { recordset: [], rowsAffected: [0] };
  }
  if (/UPDATE wf\.SalesOrderExt\s+SET IsUnlocked = 0/.test(text)) {
    const row = ext[inputs.id];
    if (row) { row.IsUnlocked = false; row.VerifiedAt = null; }
    return { recordset: [], rowsAffected: [1] };
  }
  if (/UPDATE wf\.SalesOrder SET VerifiedBy=@uid/.test(text)) return { recordset: [], rowsAffected: [Number(inputs.id) === 21 ? 1 : 0] };
  if (/FROM wf\.SalesOrder WITH \(UPDLOCK,HOLDLOCK\)/.test(text) && Number(inputs.id) === 501) {
    return [{
      Id: 501,
      Status: 'DRAFT',
      SalesUserId: 43,
      VerifiedAt: null,
      TruckPlate: null,
      NoTruckRequired: 0,
      IsControlTicket: controlTicketFixture?1:0,
      SoPrefix: controlTicketFixture?'AI':'I',
      WfRef: 'I69-99901',
    }];
  }
  if (/FROM wf\.SalesOrderExt WHERE SOID=@id/.test(text)) return ext[inputs.id] ? [{ ...ext[inputs.id] }] : [];
  return [];
}, { activeUserIds: [...h.TEST_USERS, 91] });
const { confirmDraft } = require('../services/draft-confirmation');

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });

test('MANAGER holds so.create, so.edit and so.confirm; SALES and above bypass FR-022', () => {
  const mgrActions = capabilitiesFor('MANAGER').actions;
  for (const act of ['so.create', 'so.edit', 'so.confirm']) {
    assert.ok(mgrActions.includes(act), `MANAGER missing ${act}`);
  }
  for (const role of ['SALES', 'COUNTER_SALES', 'APPROVER', 'ACCOUNTING', 'MANAGER', 'C_LEVEL', 'ADMIN']) {
    assert.equal(canConfirmWithoutCounterVerify({ role }), true, role);
  }
  for (const role of ['WAREHOUSE', 'WEIGHBRIDGE', 'SEPARATION']) {
    assert.equal(canConfirmWithoutCounterVerify({ role }), false, role);
  }
  assert.equal(canConfirmWithoutCounterVerify({ roles: ['SALES', 'SEPARATION'] }), false);
});
test('direct SALES confirmation never grants ticket-sale rights, including borrowing an effective ADMIN',async()=>{
 controlTicketFixture=true;
 try{
  for(const user of [{sub:43,role:'SALES'},{sub:99,actorSub:43,role:'ADMIN',actorRole:'SALES',isImpersonating:true}]){
   db.calls.length=0;
   await assert.rejects(confirmDraft({tx:db.tx,draftId:501,user}),e=>e.status===403&&/Counter Sale/.test(e.message));
   assert.equal(db.calls.some(c=>/EXEC .*Confirm|sp_ConfirmSalesOrder/.test(c.text)),false);
  }
 }finally{controlTicketFixture=false;}
});

test('non-sales operational role still requires Counter-Sales verification before confirm', async () => {
  ext[278000] = { SOID: '278000', TripId: null, IsUnlocked: true, VerifiedAt: null, ConfirmedAt: '2026-10-06T00:00:00Z' };
  const denied = await app.call('PATCH', '/api/so/278000/confirm', {
    body: {},
    user: { sub: 91, role: 'WAREHOUSE' },
  });
  assert.equal(denied.status, 403);

  warehouseCustomConfirm = true;
  try {
    const r = await app.call('PATCH', '/api/so/278000/confirm', {
      body: {},
      user: { sub: 91, role: 'WAREHOUSE' },
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.message, /FR-022/);
  } finally {
    warehouseCustomConfirm = false;
  }
});

test('SALES, COUNTER_SALES, MANAGER and C_LEVEL confirm an unlocked WinSpeed bill directly without Counter-Sales check', async () => {
  for (const user of [
    { sub: 43, role: 'SALES' },
    { sub: 64, role: 'COUNTER_SALES' },
    { sub: 64, role: 'MANAGER' },
    { sub: 64, role: 'C_LEVEL' },
  ]) {
    ext[278000] = { SOID: '278000', TripId: null, IsUnlocked: true, VerifiedAt: null, ConfirmedAt: '2026-10-06T00:00:00Z' };
    const before = db.calls.length;
    const r = await app.call('PATCH', '/api/so/278000/confirm', { body: {}, user });
    assert.equal(r.status, 200, `${user.role}: ${JSON.stringify(r.body)}`);
    const lock = db.calls.slice(before).find(c => /UPDATE wf\.SalesOrderExt\s+SET IsUnlocked = 0/.test(c.text));
    assert.ok(lock, `${user.role} locked bill`);
    assert.match(lock.text, /VerifiedBy = NULL, VerifiedAt = NULL/);
  }
});

test('confirmDraft passes FR-022 for SALES and above when VerifiedAt is null, but blocks WAREHOUSE', async () => {
  const makeTx = () => ({
    request() {
      const inputs = {};
      return {
        input(k, _t, v) { inputs[k] = v; return this; },
        async query(sqlText) {
          if (/sp_getapplock/.test(sqlText)) return { recordset: [{ LockResult: 0 }] };
          if (/FROM wf\.SalesOrder WITH \(UPDLOCK,HOLDLOCK\)/.test(sqlText)) {
            return {
              recordset: [{
                Id: 501,
                Status: 'DRAFT',
                SalesUserId: 43,
                VerifiedAt: null,
                TruckPlate: null,
                NoTruckRequired: 0,
                IsControlTicket: 0,
                SoPrefix: 'I',
                WfRef: 'I69-99901',
              }],
            };
          }
          if (/FROM wf\.CouponNativeCutAuthorization/.test(sqlText)) return { recordset: [] };
          return { recordset: [], rowsAffected: [1] };
        },
      };
    },
  });

  await assert.rejects(
    () => confirmDraft({ tx: makeTx(), draftId: 501, user: { sub: 91, role: 'WAREHOUSE' }, ip: '127.0.0.1' }),
    /FR-022/,
  );
  for (const user of [
    { sub: 43, role: 'SALES' },
    { sub: 64, role: 'COUNTER_SALES' },
    { sub: 64, role: 'MANAGER' },
    { sub: 64, role: 'C_LEVEL' },
    { sub: 1, role: 'ADMIN' },
  ]) {
    // Passes FR-022 and reaches the next business check (missing truck plate)
    await assert.rejects(
      () => confirmDraft({ tx: makeTx(), draftId: 501, user, ip: '127.0.0.1' }),
      /ต้องระบุทะเบียนรถหรือไม่ใช้รถก่อนยืนยัน/,
      user.role,
    );
  }
});

test('the counter check of an unlocked WinSpeed bill is kept on the extension when used', async () => {
  ext[278000] = { SOID: '278000', TripId: null, IsUnlocked: true, VerifiedAt: null, ConfirmedAt: '2026-10-06T00:00:00Z' };
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/278000/verify', { user: { sub: 64, role: 'COUNTER_SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  assert.ok(calls.some(c => /UPDATE wf\.SalesOrderExt SET VerifiedBy=@uid/.test(c.text)));
  assert.ok(!calls.some(c => /UPDATE wf\.SalesOrder SET VerifiedBy/.test(c.text)), 'no draft update for a WinSpeed bill');
  assert.ok(ext[278000].VerifiedAt);
});

test('a draft is still checked on wf.SalesOrder when /verify is called', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/21/verify', { user: { sub: 64, role: 'COUNTER_SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(db.calls.slice(before).some(c => /UPDATE wf\.SalesOrder SET VerifiedBy=@uid/.test(c.text)));
});

test('the trip confirm keeps FR-022 fallback for non-exempt roles and locks IsUnlocked = 0', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/trips'), 'utf8');
  assert.match(src, /ต้องตรวจซ้ำ \(Counter-Sales\) ก่อนยืนยัน \(FR-022\)/);
  assert.match(src, /IsUnlocked = 0\s+WHERE SOID = @soid/);
});

test('a new trip limits WinSpeed members to unlinked bookings within the data window', () => {
  const src = require('fs').readFileSync(require.resolve('../routes/trips'), 'utf8');
  assert.match(src, /UPDATE e SET TripId=@tripId, UpdatedAt=SYSUTCDATETIME\(\)/);
  assert.match(src, /e\.SOID=@soid AND e\.TripId IS NULL AND h\.DocuDate>=@startDate/);
  assert.match(src, /\$\{nativeEffective\.sql\} AND \$\{nativeActor\.sql\}/);
});
