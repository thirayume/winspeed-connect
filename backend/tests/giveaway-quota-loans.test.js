'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../services/giveaway-quota-loans');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin={sub:99,role:'ADMIN'},borrower={sub:2,role:'SALES'},lender={sub:1,role:'SALES'};
function fixture(){
 let state={budgets:[{Id:11,SalesUserId:1,GoodId:'500',PeriodYear:2569,Region:'SAME',BudgetQty:100,WithdrawnQty:0,OwnerActive:true},
   {Id:22,SalesUserId:2,GoodId:'500',PeriodYear:2569,Region:'SAME',BudgetQty:20,WithdrawnQty:0,OwnerActive:true}],loans:[],returns:[],audits:[]};
 let auditFails=false,tail=Promise.resolve();
 const q=async(text,raw={})=>{
  const p=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,v&&typeof v==='object'&&'value'in v?v.value:v]));
  const rows=recordset=>({recordset,rowsAffected:[recordset.length]});
  if(/DB_NAME\(\)/.test(text))return rows([{DatabaseName:'fixture'}]);
  if(/AS HasBorrow/.test(text))return rows([...new Set([p.effective,p.actor])].map(Id=>({Id,IsActive:1,MustChangePassword:0,HasBorrow:1,
   CanManage:[99,199].includes(Id)?1:0,HasAdmin:[99,199].includes(Id)?1:0,HasCLevel:0,HasManager:0,...state.principals?.[Id]})));
  if(/SELECT Id, EmpId, PositionCode FROM wf.AppUser/.test(text))return rows([{Id:p.id,PositionCode:null}]);
  if(/SELECT Id FROM wf.GiveawayBudget/.test(text))return rows(state.budgets.filter(r=>r.Id===p.id));
  if(/FROM wf.v_GiveawayBudgetStatus v/.test(text))return rows(state.budgets.filter(r=>[p.a,p.b].includes(r.Id)).map(r=>({...r,RemainingQty:r.BudgetQty-r.WithdrawnQty})));
  if(/SELECT SettingValue/.test(text))return rows([{SettingValue:'100'}]);
  if(/SELECT \* FROM wf.GiveawayQuotaRepayment/.test(text))return rows(state.returns.filter(r=>r.RequestId===p.requestId));
  if(/SELECT \* FROM wf.GiveawayQuotaLoan/.test(text))return rows(state.loans.filter(r=>p.requestId?r.RequestId===p.requestId:r.Id===p.id));
  if(/INSERT wf.GiveawayQuotaLoan/.test(text)){
   const row={Id:state.loans.length+1,RequestId:p.requestId,Fingerprint:p.fingerprint,LenderBudgetId:p.a,BorrowerBudgetId:p.b,
    LenderUserId:p.lender,BorrowerUserId:p.borrower,Quantity:Number(p.qty),ReturnedQty:0,Status:'PENDING',Revision:1};
   state.loans.push(row);return rows([{...row}]);
  }
  if(/UPDATE wf.GiveawayBudget/.test(text)){state.budgets.find(r=>r.Id===p.id).BudgetQty+=p.sign*Number(p.qty);return {rowsAffected:[1]};}
  if(/UPDATE wf.GiveawayQuotaLoan/.test(text)){
   const row=state.loans.find(r=>r.Id===p.id);if(!row||row.Revision!==p.revision)return {rowsAffected:[0]};
   row.Status=p.status;row.Revision++;if(p.returned!=null)row.ReturnedQty=Number(p.returned);return {rowsAffected:[1]};
  }
  if(/INSERT wf.GiveawayQuotaRepayment/.test(text)){state.returns.push({RequestId:p.requestId,Fingerprint:p.fingerprint,Quantity:Number(p.qty)});return {rowsAffected:[1]};}
  if(/INSERT wf.ChangeEvent/.test(text)){if(auditFails)throw Error('AUDIT_FAILED');state.audits.push(p);return {rowsAffected:[1]};}
  throw Error('Unexpected SQL '+text.slice(0,75));
 };
 const tx=fn=>{
  const result=tail.then(async()=>{const snapshot=structuredClone(state);try{return await fn(q);}catch(e){state=snapshot;throw e;}});
  tail=result.catch(()=>{});return result;
 };
 return {q,tx,get state(){return state;},failAudit(){auditFails=true;}};
}
const request=(f,n=1,quantity='10')=>f.tx(q=>service.requestLoan(q,borrower,{requestId:uuid(n),expectedDatabase:'fixture',lenderBudgetId:11,borrowerBudgetId:22,quantity,reason:'test'},
 {window:{businessDate:'2026-01-01'}}));
const approve=(f,id=1,revision=1)=>f.tx(q=>service.decideLoan(q,lender,{id,revision,expectedDatabase:'fixture',action:'approve',reason:'test'}));
const repay=(f,n,quantity)=>f.tx(q=>service.repayLoan(q,borrower,{id:1,requestId:uuid(n),expectedDatabase:'fixture',quantity,reason:'test return'}));

test('a same-region individual loan conserves total quota and partial/full repayment is idempotent',async()=>{
 const f=fixture();await request(f);await approve(f);
 assert.deepEqual(f.state.budgets.map(b=>b.BudgetQty),[90,30]);
 await repay(f,2,'4');assert.deepEqual(f.state.budgets.map(b=>b.BudgetQty),[94,26]);
 assert.equal((await repay(f,2,'4')).replayed,true);assert.equal(f.state.returns.length,1);
 await repay(f,3,'6');assert.deepEqual(f.state.budgets.map(b=>b.BudgetQty),[100,20]);
 assert.equal(f.state.loans[0].Status,'RETURNED');assert.equal(f.state.audits.length,4);
 await assert.rejects(repay(f,4,'1'),{code:'QUOTA_LOAN_RETURN_EXCEEDS_OUTSTANDING'});
});
test('two approvals serialize and cannot lend the same available quota twice',async()=>{
 const f=fixture();await request(f,1,'80');await request(f,2,'80');
 const results=await Promise.allSettled([approve(f,1),approve(f,2)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'QUOTA_LOAN_INSUFFICIENT');
 assert.deepEqual(f.state.budgets.map(b=>b.BudgetQty),[20,100]);
});
test('audit failure rolls back the quota transfer and decision',async()=>{
 const f=fixture();await request(f);f.failAudit();await assert.rejects(approve(f),/AUDIT_FAILED/);
 assert.deepEqual(f.state.budgets.map(b=>b.BudgetQty),[100,20]);assert.equal(f.state.loans[0].Status,'PENDING');
});
test('spent quota cannot be returned; a stale second approval cannot move quota',async()=>{
 const f=fixture();await request(f);await approve(f);await assert.rejects(approve(f),{code:'QUOTA_LOAN_STALE'});
 f.state.budgets[1].WithdrawnQty=30;await assert.rejects(repay(f,2,'1'),{code:'QUOTA_LOAN_RETURN_ALREADY_SPENT'});
 assert.deepEqual(f.state.budgets.map(b=>b.BudgetQty),[90,30]);
});
test('customer scope and both identities bind the request; changing database or replay payload is rejected',async()=>{
 const f=fixture();const body={requestId:uuid(1),expectedDatabase:'fixture',lenderBudgetId:11,borrowerBudgetId:22,quantity:'10',reason:'test'};
 await assert.rejects(f.tx(q=>service.requestLoan(q,{sub:3,role:'SALES'},body,{window:{businessDate:'2026-01-01'}})),{code:'QUOTA_LOAN_OUT_OF_SCOPE'});
 await request(f);await assert.rejects(request(f,1,'11'),{code:'QUOTA_LOAN_REQUEST_CONFLICT'});
 await assert.rejects(f.tx(q=>service.repayLoan(q,admin,{...body,id:1,expectedDatabase:'other'})),{code:'QUOTA_LOAN_DATABASE_CHANGED'});
 const impersonating={...borrower,actorSub:99,actorRole:'ADMIN',actorRoles:['ADMIN'],isImpersonating:true};
 const g=fixture();await g.tx(q=>service.requestLoan(q,impersonating,body,{window:{businessDate:'2026-01-01'}}));
 assert.equal(g.state.audits[0].actor,'99');assert.equal(g.state.audits[0].user,'2');
});
test('loan quantities preserve cents and reject rounding or exponential inputs',()=>{
 assert.equal(service.decimal(service.units('0.01')),'0.01');
 for(const v of ['0','-1','0.001','1e2','Infinity',null])assert.throws(()=>service.units(v),{code:'QUOTA_LOAN_QUANTITY_INVALID'});
});

test('mapped quota audit retains both primary and business actor/effective IDs',async()=>{
 const f=fixture();f.state.budgets[1].SalesUserId=22;
 const user={sub:2,role:'SALES',actorSub:99,actorRole:'ADMIN',actorRoles:['ADMIN'],isImpersonating:true,
  identityMapping:{primaryEffectiveUserId:2,primaryActorUserId:99,businessEffectiveUserId:22,businessActorUserId:199}};
 await f.tx(q=>service.requestLoan(q,user,{requestId:uuid(1),expectedDatabase:'fixture',lenderBudgetId:11,
  borrowerBudgetId:22,quantity:'10',reason:'fixture'},{window:{businessDate:'2026-01-01'}}));
 assert.deepEqual(JSON.parse(f.state.audits[0].after).identity,
  {businessUserId:22,businessActorId:199,primaryUserId:2,primaryActorId:99});
});

test('SQL concurrency rehearsal refuses unreviewed targets before loading a database driver',()=>{
 const {spawnSync}=require('node:child_process'),path=require('node:path');
 const script=path.join(__dirname,'../scripts/rehearse-giveaway-quota-concurrency.cjs');
 for(const flags of [
  {},{ALLOW_TEMPDB_QUOTA_REHEARSAL:'true',ONPREM_DB_NAME:'dbwins_worldfert9',ONPREM_TARGET_KIND:'prod'},
  {ALLOW_TEMPDB_QUOTA_REHEARSAL:'true',ONPREM_DB_NAME:'dbwins_worldfert2',ONPREM_TARGET_KIND:'uat'},
  {ONPREM_DB_NAME:'dbwins_worldfert9_uat',ONPREM_TARGET_KIND:'uat'},
 ]){
  const result=spawnSync(process.execPath,[script],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,...flags},encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/UAT_TEMPDB_OPT_IN_REQUIRED/);assert.doesNotMatch(result.stderr,/password|login failed/i);
 }
});

test('revoked permissions, disabled real actors and removed manager roles fail inside the transaction',async()=>{
 for(const override of [{HasBorrow:0},{IsActive:0},{MustChangePassword:1},{CanManage:0},{CanManage:1,HasAdmin:0,HasManager:1}]){
  const f=fixture();f.state.principals={99:override};
  await assert.rejects(f.tx(q=>service.requestLoan(q,{...borrower,actorSub:99,actorRole:'ADMIN',actorRoles:['ADMIN'],isImpersonating:true},
   {requestId:uuid(1),expectedDatabase:'fixture',lenderBudgetId:11,borrowerBudgetId:22,quantity:'10',reason:'fixture'},
   {window:{businessDate:'2026-01-01'}})),{code:'QUOTA_LOAN_FORBIDDEN'});
  assert.equal(f.state.loans.length,0);assert.equal(f.state.audits.length,0);
 }
});
