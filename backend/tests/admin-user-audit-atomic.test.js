'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let state,failAudit;
const db=h.installDbStub(({kind,text,inputs})=>{
  if(/SELECT Id, Username, DisplayName, Role, RoleCode/.test(text))return state.user?[{Id:2,Role:'SALES',IsActive:true,DisplayName:state.user}]:[];
  if(/INSERT INTO wf.AppUser/.test(text)){assert.equal(kind,'tx');state.user=inputs.d;return {recordset:[{Id:2,Role:inputs.r}],rowsAffected:[1]};}
  if(/UPDATE wf.AppUser/.test(text)){assert.equal(kind,'tx');state.user=inputs.dn||state.user;return {rowsAffected:[1]};}
  if(/DELETE FROM wf.AppUser/.test(text)){assert.equal(kind,'tx');state.user=null;return {rowsAffected:[1]};}
  if(/INSERT INTO wf.AdminChangeAudit/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAILED');state.audits.push(inputs);return {rowsAffected:[1]};}
  return [];
});
db.stub.wfTransaction=async fn=>{const prev=structuredClone(state);try{return await fn(db.tx);}catch(e){state=prev;throw e;}};
const policy=require('../services/role-policy-write');
policy.lockPolicy=async()=>{};policy.setMembership=async()=>{};policy.assertAdministrator=async()=>{};
const rebatePath=require.resolve('../services/rebate-doc-code');
require.cache[rebatePath]={id:rebatePath,filename:rebatePath,loaded:true,exports:{ensureRebateDocCode:async()=>{}}};
const router=require('../routes/auth');
async function call(method,body){
  const path=method==='post'?'/users':'/users/:id',layer=router.stack.find(x=>x.route?.path===path&&x.route.methods[method]);
  const req={body,user:{sub:1,id:1,role:'ADMIN'},params:{id:'2'}};
  const res={code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  await layer.route.stack.at(-1).handle(req,res);return res;
}
test('delete commits its audit and rolls deletion back when audit fails',async()=>{
  state={user:'Existing',audits:[]};failAudit=false;
  let r=await call('delete',{});assert.equal(r.code,200);assert.equal(state.user,null);assert.equal(state.audits[0].action,'USER_DELETE');
  state={user:'Existing',audits:[]};failAudit=true;const old=console.error;console.error=()=>{};
  try{r=await call('delete',{});assert.equal(r.code,500);assert.equal(state.user,'Existing');assert.deepEqual(state.audits,[]);}finally{console.error=old;}
});
for(const method of ['post','patch']){
  test(`${method} writes user and safe audit in one transaction`,async()=>{
    state={user:method==='patch'?'Before':null,audits:[]};failAudit=false;
    const body=method==='post'?{username:'fixture-user',displayName:'Private Name',password:'private-pass',role:'SALES'}:{displayName:'Private Name',phone:'private-phone'};
    const r=await call(method,body);assert.equal(r.code,200);assert.equal(state.user,'Private Name');assert.equal(state.audits.length,1);
    const audit=state.audits[0];assert.equal(audit.actor,1);assert.equal(audit.target,'2');assert.equal(audit.action,method==='post'?'USER_CREATE':'USER_UPDATE');
    assert.ok(!/Private Name|private-pass|private-phone|fixture-user/.test(JSON.stringify(audit)));
  });
  test(`${method} rolls back when user audit fails`,async()=>{
    state={user:method==='patch'?'Before':null,audits:[]};failAudit=true;
    const old=console.error;console.error=()=>{};
    try{const r=await call(method,method==='post'?{username:'fixture',displayName:'New',password:'pw',role:'SALES'}:{displayName:'New'});
      assert.equal(r.code,500);assert.equal(state.user,method==='patch'?'Before':null);assert.equal(state.audits.length,0);
    }finally{console.error=old;}
  });
}
