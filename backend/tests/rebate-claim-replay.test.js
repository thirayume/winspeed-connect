'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateClaimReplay}=require('../services/rebate-claim-replay');
function fixture(){
  const claim={Id:12,CustId:'9',RequestPayloadHash:'a'.repeat(64),CreatedAt:new Date('2026-11-13T13:00:00Z')};
  const epoch={generation:1,lastResetAtUtc:new Date('2026-11-13T12:00:00Z')},dataWindow={utcInstant:new Date('2025-12-31T17:00:00Z')};
  const user={sub:7,role:'SALES',roles:['SALES'],actorSub:8,actorRole:'ADMIN',actorRoles:['ADMIN'],isImpersonating:true,
    identityMapping:{primaryActorUserId:8,primaryEffectiveUserId:7,businessActorUserId:38,businessEffectiveUserId:37}};
  const state={total:2,visible:2,scopes:[],sql:null,params:null};
  const query=async(sql,params)=>{state.sql=sql;state.params=params;return {recordset:[{TotalLines:state.total,VisibleLines:state.visible}]};};
  const options={getScope:async u=>{state.scopes.push(u);return {all:true,userIds:[],empIds:[]};}};
  const args={epoch,dataWindow,custId:9,payloadHash:'a'.repeat(64)};
  return {claim,user,state,args,run:()=>validateClaimReplay(query,user,claim,args,options)};
}
test('replay requires all source lines in both actor and effective mapped scopes',async()=>{
  const f=fixture();assert.equal(await f.run(),true);
  assert.deepEqual(f.state.scopes.map(u=>[u.sub,u.identityMapping.businessEffectiveUserId]),[[7,37],[8,38]]);
  assert.match(f.state.sql,/SourceSOID=cl.SourceSOID/);assert.match(f.state.sql,/l.CustId=@cid/);
  assert.equal(f.state.params.claimId,12);
});
test('missing hash, wrong customer, previous epoch and old data window cannot replay',async()=>{
  for(const mutate of [f=>f.claim.RequestPayloadHash=null,f=>f.claim.CustId='10',
    f=>f.claim.CreatedAt=new Date('2026-11-13T12:00:00Z'),f=>f.args.dataWindow.utcInstant=new Date('2026-11-14T00:00:00Z')]){
    const f=fixture();mutate(f);await assert.rejects(f.run());assert.equal(f.state.sql,null);
  }
});
test('zero source lines or any line outside the shared scope fails closed',async()=>{
  for(const values of [[0,0],[2,1],[2,null]]){
    const f=fixture();[f.state.total,f.state.visible]=values;await assert.rejects(f.run(),{code:'REBATE_CLAIM_REPLAY_OUT_OF_SCOPE'});
  }
});
