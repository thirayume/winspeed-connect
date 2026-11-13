'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {prepareRebateBookingDecisions}=require('../services/rebate-booking-decisions');
const {reviewBookingPricing}=require('../services/rebate-booking-approval');

function fixture() {
  const state={inserted:[],date:'2026-11-13',revision:3,owner:99,existing:[],createdAt:new Date('2026-01-01T00:00:00Z')};
  const draft=()=>({Id:51,Status:'DRAFT',DocumentRevision:state.revision,SalesUserId:state.owner,SaleDate:state.date});
  const line={SoId:51,LineNum:1,GoodId:12,QtyTon:2,PricePerTon:9750,RebatePricingMode:'POOL'};
  const query=async(text,p)=>{
    if(/FROM wf\.SalesOrder WITH/.test(text)) {
      assert.match(text,/CreatedAt>=@windowStartUtc/);
      return {recordset:state.createdAt>=p.windowStartUtc?[draft()]:[]};
    }
    if(/FROM wf\.SalesOrderLine WITH/.test(text)) return {recordset:[line]};
    if(/FROM dbo\.EMSetPriceHD/.test(text)) return {recordset:[{SetPriceID:8,ListNo:1,GoodId:12,
      BeginDate:'2026-01-01',EndDate:'2026-12-31',BasePrice:10000,DatabaseName:'test_uat',ServerName:'test_server'}]};
    if(/SELECT Id,Decision,ActorPrimaryId/.test(text)) return {recordset:state.existing};
    if(/INSERT wf\.RebatePriceApprovalEvidence/.test(text)) {state.inserted.push(p);return {recordset:[{Id:7}]};}
    throw new Error('unexpected SQL');
  };
  const scope=async()=>({all:true,userIds:[],empIds:[]});
  const fingerprint=async()=>(await prepareRebateBookingDecisions(query,{draft:draft(),lines:[line],saleDate:state.date}))[0].fingerprint;
  return {state,draft,line,query,scope,fingerprint};
}
const manager={sub:1,role:'MANAGER'};
const payload=fp=>({user:manager,draftId:51,expectedRevision:3,lineNo:1,expectedFingerprint:fp,reason:'approved',windowStartUtc:new Date('2025-12-31T17:00:00Z')});

test('approval writes server-computed pricing evidence with both identity pairs',async()=>{
  const f=fixture(), fp=await f.fingerprint();
  const result=await reviewBookingPricing(f.query,payload(fp),{getVisibleScope:f.scope});
  assert.equal(result.id,7);assert.equal(result.saleDate,'2026-11-13');assert.equal(result.replayed,false);
  assert.deepEqual([f.state.inserted[0].actorPrimary,f.state.inserted[0].effectivePrimary,
    f.state.inserted[0].actorBusiness,f.state.inserted[0].effectiveBusiness],[1,1,1,1]);
});

test('changed revision, sale date, price or scope cannot be approved from a stale preview',async()=>{
  for(const change of ['revision','date','price','scope']) {
    const f=fixture(),fp=await f.fingerprint();
    if(change==='revision')f.state.revision++;
    if(change==='date')f.state.date='2026-11-14';
    if(change==='price')f.line.PricePerTon=9800;
    const scope=change==='scope'?async()=>({all:false,userIds:[],empIds:[]}):f.scope;
    await assert.rejects(reviewBookingPricing(f.query,payload(fp),{getVisibleScope:scope}),
      {code:change==='scope'?'REBATE_APPROVAL_DRAFT_NOT_FOUND':'REBATE_APPROVAL_STALE'});
    assert.equal(f.state.inserted.length,0);
  }
});

test('Access As requires permission and scope for both identities, with distinct mapped business IDs',async()=>{
  const f=fixture(),fp=await f.fingerprint();
  const user={sub:1,role:'MANAGER',actorSub:2,actorRole:'ADMIN',actorRoles:['ADMIN'],isImpersonating:true,
    identityMapping:{primaryEffectiveUserId:1,primaryActorUserId:2,businessEffectiveUserId:11,businessActorUserId:22}};
  const result=await reviewBookingPricing(f.query,{...payload(fp),user},{getVisibleScope:f.scope});
  assert.equal(result.id,7);
  assert.deepEqual([f.state.inserted[0].actorPrimary,f.state.inserted[0].effectivePrimary,
    f.state.inserted[0].actorBusiness,f.state.inserted[0].effectiveBusiness],[2,1,22,11]);
  const blocked={...user,actorPermissions:[]};
  await assert.rejects(reviewBookingPricing(f.query,{...payload(fp),user:blocked},{getVisibleScope:f.scope}),
    {code:'REBATE_APPROVAL_PERMISSION_REQUIRED'});
});

test('a manager cannot self-approve and conflicting previous evidence is not overwritten',async()=>{
  const f=fixture(),fp=await f.fingerprint();f.state.owner=1;
  await assert.rejects(reviewBookingPricing(f.query,payload(fp),{getVisibleScope:f.scope}),{code:'REBATE_APPROVAL_SELF_FORBIDDEN'});
  f.state.owner=99;f.state.existing=[{Id:8,Decision:'REJECTED'}];
  await assert.rejects(reviewBookingPricing(f.query,payload(fp),{getVisibleScope:f.scope}),{code:'REBATE_APPROVAL_CONFLICT'});
});

test('replay requires the same decision, reviewer identities and reason',async()=>{
  const f=fixture(),fp=await f.fingerprint();
  f.state.existing=[{Id:8,Decision:'APPROVED',ActorPrimaryId:1,EffectivePrimaryId:1,ActorBusinessId:1,EffectiveBusinessId:1,Reason:'approved'}];
  const result=await reviewBookingPricing(f.query,payload(fp),{getVisibleScope:f.scope});
  assert.equal(result.id,8);assert.equal(result.replayed,true);assert.equal(f.state.inserted.length,0);
  await assert.rejects(reviewBookingPricing(f.query,{...payload(fp),reason:'different reason'},{getVisibleScope:f.scope}),{code:'REBATE_APPROVAL_CONFLICT'});
});
test('approval rejects a draft before the trusted global boundary',async()=>{
  const f=fixture(),fp=await f.fingerprint();f.state.createdAt=new Date('2025-12-31T16:59:59Z');
  await assert.rejects(reviewBookingPricing(f.query,payload(fp),{getVisibleScope:f.scope}),{code:'REBATE_APPROVAL_DRAFT_NOT_FOUND'});
  assert.equal(f.state.inserted.length,0);
});
