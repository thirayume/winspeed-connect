'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { approveNativeEdit } = require('../services/coupon-native-edit-approval');

const actor = { sub: 4, actorSub: 9, role: 'MANAGER', actorRole: 'ADMIN', isImpersonating: true };
const dataWindow = { businessDate: '2026-01-01' };
const input = {
  actor, dataWindow, redemptionId: 51, operation: 'reduce', reason: 'ทดสอบลดจำนวนใบขน',
  items: [{ couponId: 41, qtyAfter: '0.05' }, { couponId: 42, qtyAfter: '0.10' }],
};

function fixture({ auditFailure = false, outOfScope = false, wrongDate = false, procedureError = '', snapshotState = 0 } = {}) {
  const writes = [];
  const deps = {
    currentActorId: () => 9,
    hasColumn: async () => true,
    assertNativeHoldPrimary: async () => {},
    assertBridge: async () => {},
    couponVisible: async (_user,id) => !outOfScope || id !== 42,
    reservationsVisible: async (_user,ids) => ids.length === 2,
    loadSnapshot: async () => ({
      docuNo: 'QA-OLD-116', docuDate: '2025-12-31',
      lines: [{ couponId: 41, qty: '0.1000', nativeBalance: '0.4500' },
        { couponId: 42, qty: '0.1000', nativeBalance: '0.4500' }],
    }),
    wfTransaction: async fn => {
      let pending = [];
      const tx = { request() {
        const inputs = {};
        return { input(key,_type,value) { inputs[key]=value;return this; }, async query(statement) {
          if (statement.includes('FROM wf.SystemSetting'))
            return { recordset: [{ SettingValue: wrongDate ? '2026-02-01' : '2026-01-01' }] };
          if (statement.includes('FROM wf.CouponReservationSettlement'))
            return { recordset: [{ CouponId:41, ReservationId: 11, AuthorizationLineId: '81', SettlementId: '91' },
              { CouponId:42, ReservationId: 12, AuthorizationLineId: '82', SettlementId: '92' }] };
          if (statement.includes('AS Enabled') && statement.includes('sp_SnapshotCouponNativeEdit'))
            return { recordset: [{ Enabled: snapshotState }] };
          if (statement.includes('EXEC wf.sp_ApproveCouponNativeEditLine') && procedureError && inputs.couponId === 42)
            throw new Error(procedureError);
          if (statement.includes('INSERT wf.ChangeEvent') && auditFailure) throw new Error('audit failed');
          pending.push({ statement, inputs });
          return { recordset: [] };
        }};
      }};
      const result = await fn(tx);
      writes.push(...pending);
      return result;
    },
  };
  return { deps, writes };
}

test('approval takes both identities from auth and preserves historical source without exposing it',async()=>{
  const { deps, writes } = fixture();
  const result = await approveNativeEdit(input,deps);
  assert.equal(result.lineCount,2);
  assert.equal(result.operation,'reduce');
  assert.equal(JSON.stringify(result).includes('QA-OLD-116'),false);
  assert.equal(writes.length,3);
  assert.equal(writes[0].inputs.effectiveUserId,4);
  assert.equal(writes[0].inputs.actorUserId,9);
  assert.equal(writes[0].inputs.docuDate,'2025-12-31');
  assert.deepEqual(writes.slice(0,2).map(row=>row.inputs.qtyAfter),[0.05,0.1]);
  assert.deepEqual(JSON.parse(writes[2].inputs.summary),{operation:'reduce',lineCount:2});
});

test('captures a native snapshot before auditing an approved reduction', async () => {
  const { deps, writes } = fixture({ snapshotState: 1 });
  await approveNativeEdit(input, deps);
  assert.match(writes[2].statement, /EXEC wf\.sp_SnapshotCouponNativeEdit/);
  assert.equal(writes[2].inputs.editId, writes[0].inputs.editId);
  assert.match(writes[3].statement, /INSERT wf\.ChangeEvent/);
});

test('cancel targets every original line and audit failure rolls back approval',async()=>{
  const payload={...input,operation:'cancel',items:undefined};
  let { deps,writes }=fixture();
  await approveNativeEdit(payload,deps);
  assert.deepEqual(writes.slice(0,2).map(row=>[row.inputs.operation,row.inputs.qtyAfter]),[['C',0],['C',0]]);
  ({deps,writes}=fixture({auditFailure:true}));
  await assert.rejects(approveNativeEdit(payload,deps),/audit failed/);
  assert.deepEqual(writes,[]);
});

test('a competing approval or changed source returns a conflict and rolls back all plan lines',async()=>{
  for (const code of ['COUPON_EDIT_APPROVAL_ALREADY_EXISTS', 'COUPON_EDIT_APPROVAL_SOURCE_CHANGED']) {
    const {deps,writes}=fixture({procedureError:code});
    await assert.rejects(approveNativeEdit(input,deps),{code,status:409});
    assert.deepEqual(writes,[]);
  }
});

test('out of scope, cutoff change, unauthorized actor, increases, and partial plans do not write',async()=>{
  for(const [payload, options, code] of [
    [input,{outOfScope:true},'COUPON_EDIT_APPROVAL_NOT_FOUND'],
    [input,{wrongDate:true},'DATA_WINDOW_CHANGED'],
    [{...input,actor:{...actor,actorRole:'SALES'}},{},'COUPON_NATIVE_AUTH_FORBIDDEN'],
    [{...input,items:[{couponId:41,qtyAfter:'0.05'}]},{},'COUPON_EDIT_APPROVAL_TARGETS_INVALID'],
    [{...input,items:[{couponId:41,qtyAfter:'0.12'},input.items[1]]},{},'COUPON_EDIT_APPROVAL_TARGETS_INVALID'],
  ]){
    const { deps,writes }=fixture(options);
    await assert.rejects(approveNativeEdit(payload,deps),{code});
    assert.deepEqual(writes,[]);
  }
});
