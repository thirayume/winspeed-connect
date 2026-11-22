'use strict';
// Explicit API/WinSpeed rehearsal phases, isolated QA only. Private run state
// supplies users and document IDs; source contains no operational fixtures.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('node:assert/strict');
const qa=require('./native-v3-qa-profile.cjs');qa.assertQaProfile();
if(process.env.NATIVE_COUPON_BRIDGE_ENABLED!=='true')throw Error('QA_BRIDGE_PROFILE_REQUIRED');
const db=require('../db'),{input}=require('../services/native-document-source');
const run=process.env.QA_BRIDGE_RUN,phase=process.env.QA_BRIDGE_PHASE;
if(!/^R740V3-\d{8}-\d{2}$/.test(run||''))throw Error('QA_BRIDGE_RUN_REQUIRED');
const dir='/review-state/loop-'+run.toLowerCase(),f=JSON.parse(fs.readFileSync(path.join(dir,'fixtures.json'),'utf8')),
 loop=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8')),boot=JSON.parse(fs.readFileSync('/review-state/bootstrap.json','utf8')),
 file=path.join(dir,'bridge-native.json'),state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{checks:[],reservations:{}};
assert.equal(f.run,run);assert.equal(loop.run,run);assert.notEqual(loop.closed,true);
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2),{mode:0o600});
const check=(ok,name)=>{state.checks.push({phase,name,ok:Boolean(ok)});save();assert(ok,name);console.log('QA_BRIDGE_CHECK='+name+' PASS');};
const tokens={};
async function call(role,route,body,method=body?'POST':'GET'){
 if(!tokens[role]){const u=f.users[role],r=await fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.username,password:u.password})});
  const j=await r.json();assert.equal(r.status,200,'QA login '+role);tokens[role]=j.accessToken;assert(tokens[role]);assert.equal(Number(j.user.id),Number(u.id));}
 const r=await fetch('http://127.0.0.1:3000/api'+route,{method,headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 const data=await r.json();if(!r.ok)throw Object.assign(Error('QA_API_'+r.status+' '+(data.code||'NO_CODE')),{status:r.status,code:data.code});return data;
}
const bridge=(operation,body)=>call('manager','/native-documents/bridge/'+operation,body);
async function authorize(operationType,lines){
 const args={nativeId:state.original.nativeId,custId:boot.custId,operationType,lines,reason:'QA reviewed native WinSpeed '+operationType+' '+run};
 const preview=await bridge('inspect',args);check(preview.registered,'REGISTERED_CURRENT_PROOF_'+operationType);
 const permit=await bridge('publish',{...args,fingerprint:preview.fingerprint});state.permit=permit.permitId;state.operation=operationType;save();
 const employee=(await db.wfQuery(`SELECT e.EmpCode FROM wf.AppUser u JOIN dbo.EMEmp e ON CONVERT(varchar(30),e.EmpID)=u.EmpId WHERE u.Id=@u`,{u:input(db.sql.Int,f.users.manager.id)})).recordset[0];
 const facts={docNo:state.original.nativeNo,date:boot.today,recorderCode:employee.EmpCode,
  coupons:state.original.lines.map(l=>({coupon:l.CouponNo,quantity:operationType==='D'?'0':lines.find(x=>Number(x.couponId)===Number(l.CouponId))?.quantity})),operation:operationType};
 fs.writeFileSync(path.join(dir,'bridge-ui-facts.json'),JSON.stringify(facts,null,2),{mode:0o600});
 console.log('QA_NATIVE_UI_FACTS '+JSON.stringify(facts));
}
async function main(){
 await db.pools().ready;await qa.assertQaAccess(db.wfQuery);
 check(boot.database===require('../services/native-document-target').QA,'TARGET_QA_ONLY');
 if(phase==='cancel-loop-pending'){
  for(const c of Object.values(loop.cases))for(const command of Object.values(c.cutCommands||{})){
   const row=(await db.wfQuery('SELECT Status FROM wf.NativeDocumentRequest WHERE RequestId=@r',{r:input(db.sql.VarChar(36),command.requestId)})).recordset[0];
   if(['PENDING','APPROVED'].includes(row?.Status))await call('sales','/native-documents/116/'+boot.custId+'/cancel',
    {requestId:command.requestId,reason:'QA failed run retained as evidence; cancel only its unissued request'});
  }
 }else if(phase==='prepare'){
  const chosen=['I','K'].map(book=>({book,...loop.cases[book].delivery.lines[0]}));
  check(chosen.every(c=>c.CouponId>0)&&new Set(chosen.map(c=>c.CouponNo[0])).size===2,'FRESH_MIXED_C_D');
  state.expiresAt||=new Date(Date.now()+2*3600000).toISOString();save();
  for(const c of chosen)if(!state.reservations[c.CouponId]){
   const reservation=await call('sales','/coupons/reserve',{couponId:c.CouponId,carrierSoId:String(loop.cases[c.book].soid),
    carrierDocuNo:loop.cases[c.book].bookingNo,beneficiaryCustId:String(boot.custId),reservedQty:0.5,
    idempotencyKey:run+'-bridge-native-'+c.CouponId,expiresAt:state.expiresAt,goodUnit:'ตัน'});
   state.reservations[c.CouponId]=String(reservation.id);save();
  }
  if(!state.original){
   state.command||={requestId:crypto.randomUUID(),reason:run+' temporary mixed native bridge rehearsal',
    lines:chosen.map(c=>({couponId:c.CouponId,quantity:'0.1',settlements:[{reservationId:state.reservations[c.CouponId],quantity:'0.1'}]})),
    data:{docDate:boot.today,slipNo:String((await db.wfQuery("SELECT MAX(CONVERT(int,DocuNo)) AS N FROM dbo.WFRedemtionHD WHERE LEN(DocuNo)<=9 AND DocuNo NOT LIKE '%[^0-9]%'")).recordset[0].N+10),
     receiver:'QA native bridge recipient',plate:'QA-BRIDGE-TEST'}};save();
   const prefix='/native-documents/116/'+boot.custId;
   const preview=await call('sales',prefix+'/preview',state.command);
   state.command.fingerprint=preview.fingerprint;save();
   await call('sales',prefix+'/request',state.command);await call('manager',prefix+'/approve',state.command);
   state.original=await call('warehouse',prefix+'/apply',state.command);save();
   check(state.original.lines.length===2,'APP_ORIGINAL_MIXED_116');
  }
  await authorize('E',state.original.lines.map((l,i)=>({couponId:l.CouponId,quantity:i===0?'0.05':'0.1'})));
 }else if(phase==='withdraw'){
  const r={permitId:state.permit,reason:'QA withdraw unstarted lease before changing the reviewed native test plan'};
  const preview=await bridge('withdraw',r);assert(preview.reviewRequired);
  await bridge('withdraw',{...r,fingerprint:preview.fingerprint});
 }else if(phase==='refresh-edit'){
  const r={permitId:state.permit,reason:'QA renew unstarted edit lease after native UI preparation'};
  const preview=await bridge('withdraw',r);assert(preview.reviewRequired);
  await bridge('withdraw',{...r,fingerprint:preview.fingerprint});
  await authorize('E',state.original.lines.map((l,i)=>({couponId:l.CouponId,quantity:i===0?'0.05':'0.1'})));
 }else if(phase==='recover'){
  const r={permitId:state.permit,reason:'QA recover interrupted native save using the exact approved plan '+run};
  const preview=await bridge('recover',r);check(preview.reviewRequired,'FRESH_RECOVERY_PROOF');
  const result=await bridge('recover',{...r,fingerprint:preview.fingerprint});check(result.completed,'RECOVERY_EXPLICIT_REVIEWED_TX');
 }else if(phase==='restore'){
  await authorize('E',state.original.lines.map((l,i)=>({couponId:l.CouponId,quantity:'0.1',settlements:i===0?[{reservationId:state.reservations[l.CouponId],quantity:'0.05'}]:[]})));
 }else if(phase==='edit'){
  await authorize('E',state.original.lines.map((l,i)=>({couponId:l.CouponId,quantity:i===0?'0.05':'0.1'})));
 }else if(phase==='resave'){
  await authorize('E',state.original.lines.map(l=>({couponId:l.CouponId,quantity:'0.1'})));
 }else if(phase==='verify-release'){
  const permit=(await db.wfQuery('SELECT State,ReleasedAtUtc FROM wf.CouponBridgePermit WHERE PermitId=@p',{p:input(db.sql.VarChar(36),state.permit)})).recordset[0];
  check(permit.State==='COMPLETE'&&!permit.ReleasedAtUtc,'NATIVE_COMPLETED_NOT_SILENTLY_RELEASED_'+state.operation);
  const r={permitId:state.permit,reason:'QA physical WinSpeed save and balances reviewed '+run};
  const preview=await bridge('release',r);check(preview.reviewRequired,'FRESH_RELEASE_PROOF');
  const released=await bridge('release',{...r,fingerprint:preview.fingerprint});check(released.completed,'RELEASE_EXPLICIT_'+state.operation);
  if(state.operation==='D'){
   const balances=(await db.wfQuery(`SELECT c.RemaQty,r.ConsumedQty FROM wf.CouponReservation r JOIN dbo.WFCoupon c ON c.CouponID=r.CouponId
    WHERE r.Id IN(@a,@b)`,{a:input(db.sql.BigInt,Object.values(state.reservations)[0]),b:input(db.sql.BigInt,Object.values(state.reservations)[1])})).recordset;
   check(balances.length===2&&balances.every(b=>Number(b.RemaQty)===3&&Number(b.ConsumedQty)===0),'NATIVE_CANCEL_CONSERVES_PHYSICAL_AND_RESERVATIONS');
   for(const id of Object.values(state.reservations))await call('sales','/coupons/cancel',{reservationId:id,reason:'QA native rehearsal complete; release own unused reservation'});
  }
 }else if(phase==='cancel')await authorize('D',[]);
 else throw Error('QA_BRIDGE_PHASE_INVALID');
}
main().catch(e=>{console.error('QA_BRIDGE_LIVE_FAILED '+e.message);process.exitCode=1;}).finally(()=>db.closeAll());
