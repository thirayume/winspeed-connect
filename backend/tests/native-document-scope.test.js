'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nativeChainInScope, nativeOwnerInScope } = require('../services/native-document-scope');

test('native writes require both real and effective ownership scope, using mapped business IDs',async()=>{
  const user={sub:5,role:'ACCOUNTING',actorSub:6,actorRole:'MANAGER',actorRoles:['MANAGER'],isImpersonating:true,
    identityMapping:{primaryEffectiveUserId:5,primaryActorUserId:6,businessEffectiveUserId:15,businessActorUserId:16}};
  const calls=[];
  const q=async(text,p)=>{calls.push(p);return {recordset:/WITH tree AS/.test(text)
    ?[{Id:16,EmpId:'1016'},{Id:17,EmpId:'1017'}]:[{Id:16,EmpId:'1016',PositionCode:'TEAM'}]};};
  assert.equal(await nativeOwnerInScope(user,{SalesUserId:17,EmpID:'1017'},q),true);
  assert.equal(await nativeOwnerInScope(user,{SalesUserId:18,EmpID:'1018'},q),false);
  assert.ok(calls.every(p=>p.id.value===16));
  assert.equal(await nativeOwnerInScope({...user,role:'SALES'},{SalesUserId:18,EmpID:'1018'},q),false);
  assert.equal(await nativeOwnerInScope(user,null,q),false);
});

const own = { all: false, userIds: [11], empIds: ['101'] };
const chain = () => ({ resolved: true, chain: { bookings: [{ soId: 501 }], deliveries: [{ soId: 502 }],
  coupons: [{ couponId: 600 }], redemptions: [{ redemtionId: 700 }], invoices: [{ soInvId: 800 }] } });
const rows = () => ['SO:501', 'SO:502', 'COUPON:600', 'REDEMPTION:700', 'INVOICE:800'].map(key => {
  const [SourceType, SourceID] = key.split(':');
  return { SourceType, SourceID: Number(SourceID), OwnerSOID: 501, EmpID: 101, SalesUserId: null };
});
const query = data => async () => ({ recordset: data });

test('all-record roles preserve the existing resolver result without an ownership query', async () => {
  assert.equal(await nativeChainInScope({ all: true }, { isAmbiguous: true }, () => { throw new Error('unexpected query'); }), true);
});
test('own and organization-team native sources are readable', async () => {
  assert.equal(await nativeChainInScope(own, chain(), query(rows())), true);
  const team = rows().map(r => ({ ...r, EmpID: 102 }));
  assert.equal(await nativeChainInScope({ ...own, empIds: ['101', '102'] }, chain(), query(team)), true);
});
test('an app-owned native source with no employee mapping remains readable', async () => {
  assert.equal(await nativeChainInScope(own, chain(), query(rows().map(r => ({ ...r, EmpID: null, SalesUserId: 11 })))), true);
});
test('every source is checked, including another owner on a combined invoice or redemption', async () => {
  for (const kind of ['SO', 'COUPON', 'REDEMPTION', 'INVOICE']) {
    const mixed = [...rows(), { SourceType: kind, SourceID: kind === 'SO' ? 501 : { COUPON: 600, REDEMPTION: 700, INVOICE: 800 }[kind],
      OwnerSOID: 901, EmpID: 999, SalesUserId: 99 }];
    assert.equal(await nativeChainInScope(own, chain(), query(mixed)), false, kind);
  }
});
test('missing, orphaned and unresolved source rows fail closed', async () => {
  assert.equal(await nativeChainInScope(own, chain(), query(rows().slice(1))), false);
  assert.equal(await nativeChainInScope(own, chain(), query(rows().map(r => ({ ...r, OwnerSOID: null })))), false);
  assert.equal(await nativeChainInScope(own, chain(), query([])), false);
  assert.equal(await nativeChainInScope(own, chain(), query(Array(1001).fill(rows()[0]))), false);
});
test('ambiguous, truncated, empty and invalid identities do not run an ownership query', async () => {
  const noQuery = () => { throw new Error('must not query'); };
  for (const result of [{ ...chain(), truncated: true }, { ...chain(), isAmbiguous: true }, { chain: {} },
    { chain: { bookings: [{ soId: '501 OR 1=1' }] } }, { chain: { bookings: [{ soId: 2147483648 }] } }]) {
    assert.equal(await nativeChainInScope(own, result, noQuery), false);
  }
});
test('a failed ownership lookup returns a sanitized unavailable error', async () => {
  await assert.rejects(nativeChainInScope(own, chain(), async () => { throw new Error('private database diagnostic'); }),
    e => e.status === 503 && e.message === 'Document scope could not be verified');
});
test('native IDs are bound as integer parameters and combined source queries retain line linkage', async () => {
  await nativeChainInScope(own, chain(), async (text, inputs) => {
    assert.match(text, /r\.SOListNo = d\.ListNo/);
    assert.match(text, /LEFT JOIN dbo\.WFRedemtionDT/);
    assert.equal(inputs.SO0.value, 501);
    assert.equal(inputs.INVOICE0.value, 800);
    assert.doesNotMatch(text, /IN \(501/);
    return { recordset: rows() };
  });
});
test('the ticket trace spells the 116 id redemptionId: a salesperson can open their own cut ticket', async () => {
  const flat = chain();
  flat.chain.redemptions = [{ redemptionId: 700 }];
  assert.equal(await nativeChainInScope(own, flat, query(rows())), true);
});
