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
 if(['overlap-app','overlap-app-replay','overlap-native','overlap-native-retry'].includes(phase)){
  const key=phase.startsWith('overlap-app')?'app':'native';state.overlap||={};
  const chosen=state.chosen[0];
  const body={couponId:chosen.CouponId,carrierSoId:String(loop.cases[chosen.book].soid),
   carrierDocuNo:loop.cases[chosen.book].bookingNo,beneficiaryCustId:String(boot.custId),reservedQty:0.25,
   idempotencyKey:run+'-bridge-overlap-'+key,expiresAt:state.expiresAt,goodUnit:'ตัน'};
  console.log('QA_OVERLAP_API_STARTED '+key);
  try{
   const r=await call('sales','/coupons/reserve',body);
   state.overlap[key]={id:String(r.id),status:200,idempotencyKey:body.idempotencyKey};save();
   if(phase==='overlap-app'){console.log('QA_OVERLAP_API_COMPLETE app status=200');return;}
   const again=await call('sales','/coupons/reserve',body);
   check(String(again.id)===String(r.id)&&again.idempotent===true,'OVERLAP_RESERVE_REPLAY_ONCE_'+key);
   const row=(await db.wfQuery(`SELECT COUNT(*) AS N FROM wf.CouponReservation WHERE IdempotencyKey=@k;
    SELECT COUNT(*) AS N FROM wf.ChangeEvent WHERE EntityType='COUPON_RESERVATION' AND EntityId=@id AND Action='RESERVE'`,
    {k:input(db.sql.NVarChar(120),body.idempotencyKey),id:input(db.sql.VarChar(50),String(r.id))})).recordsets;
   check(row[0][0].N===1&&row[1][0].N===1,'OVERLAP_RESERVATION_AND_AUDIT_SINGLE_'+key);
   console.log('QA_OVERLAP_API_COMPLETE '+key+' status=200');
  }catch(e){
   if(phase!=='overlap-native'||e.status!==409||e.code!=='COUPON_BRIDGE_REVIEW_REQUIRED')throw e;
   state.overlap[key]={status:e.status,code:e.code,idempotencyKey:body.idempotencyKey};save();
   check(true,'NATIVE_INCOMPLETE_OR_UNRELEASED_REJECTS_APP_RESERVATION');
   console.log('QA_OVERLAP_API_COMPLETE native status=409 held_for_review');
  }
 }else if(phase==='refresh-create'){
  const withdraw={permitId:state.permit,reason:'QA renew unstarted native creation before the real client overlap test'};
  const review=await bridge('withdraw',withdraw);assert(review.reviewRequired);
  await bridge('withdraw',{...withdraw,fingerprint:review.fingerprint});
  const prefix='/native-documents/116/'+boot.custId;
  await call('sales',prefix+'/cancel',{requestId:state.command.requestId,reason:'QA replace unstarted creation approval without changing the planned native document'});
  state.command.requestId=crypto.randomUUID();
  const preview=await call('sales',prefix+'/preview',state.command);state.command.fingerprint=preview.fingerprint;save();
  await call('sales',prefix+'/request',state.command);await call('manager',prefix+'/approve',state.command);
  const args={requestId:state.command.requestId,operationType:'C',reason:'QA reviewed native WinSpeed C '+run};
  const inspected=await bridge('inspect',args),permit=await bridge('publish',{...args,fingerprint:inspected.fingerprint});
  state.permit=permit.permitId;state.operation='C';save();
  console.log('QA_NATIVE_CREATE_APPROVAL_REFRESHED');
 }else if(phase==='cancel-loop-pending'){
  for(const c of Object.values(loop.cases))for(const command of Object.values(c.cutCommands||{})){
   const row=(await db.wfQuery('SELECT Status FROM wf.NativeDocumentRequest WHERE RequestId=@r',{r:input(db.sql.VarChar(36),command.requestId)})).recordset[0];
   if(['PENDING','APPROVED'].includes(row?.Status))await call('sales','/native-documents/116/'+boot.custId+'/cancel',
    {requestId:command.requestId,reason:'QA failed run retained as evidence; cancel only its unissued request'});
  }
 }else if(['prepare','prepare-native'].includes(phase)){
  const chosen=['I','K'].map(book=>({book,...loop.cases[book].delivery.lines[0]}));
  state.chosen=chosen;save();
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
   if(phase==='prepare-native'){
    const args={requestId:state.command.requestId,operationType:'C',reason:'QA reviewed native WinSpeed C '+run};
    const inspected=await bridge('inspect',args),permit=await bridge('publish',{...args,fingerprint:inspected.fingerprint});
    state.permit=permit.permitId;state.operation='C';save();
    const recorder=(await db.wfQuery(`SELECT u.EmpId,e.EmpCode FROM wf.AppUser u JOIN dbo.EMEmp e ON e.EmpID=CONVERT(int,u.EmpId)
     WHERE u.Id=@u`,{u:input(db.sql.Int,f.users.manager.id)})).recordset[0];
    const facts={...state.command.data,recorderEmpId:recorder.EmpId,recorderCode:recorder.EmpCode,
     coupons:chosen.map(c=>({coupon:c.CouponNo,quantity:'0.10'}))};
    fs.writeFileSync(path.join(dir,'bridge-ui-facts.json'),JSON.stringify(facts,null,2),{mode:0o600});
    console.log('QA_NATIVE_CREATE_UI_FACTS '+JSON.stringify(facts));return;
   }
   state.original=await call('warehouse',prefix+'/apply',state.command);save();
   check(state.original.lines.length===2,'APP_ORIGINAL_MIXED_116');
  }
  await authorize('E',state.original.lines.map((l,i)=>({couponId:l.CouponId,quantity:i===0?'0.05':'0.1'})));
 }else if(phase==='verify-create'){
  const p=(await db.wfQuery('SELECT State,NativeId,ReleasedAtUtc FROM wf.CouponBridgePermit WHERE PermitId=@p',{p:input(db.sql.VarChar(36),state.permit)})).recordset[0];
  check(p?.State==='COMPLETE'&&p.ReleasedAtUtc,'NATIVE_CREATE_COMPLETE_RELEASED');
  state.original={nativeId:p.NativeId,nativeNo:state.command.data.slipNo,lines:state.chosen.map(c=>({CouponId:c.CouponId,CouponNo:c.CouponNo}))};save();
  const rows=(await db.wfQuery(`SELECT c.RemaQty,d.GoodQty,r.ConsumedQty,
   (SELECT COUNT(*) FROM wf.CouponReservationSettlement s WHERE s.ReservationId=r.Id AND s.NativeRedemptionId=@n) AS Settlements
   FROM wf.CouponBridgeLine b JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId
   JOIN dbo.WFRedemtionDT d ON d.RedemtionID=@n AND d.CouponID=b.CouponId
   JOIN wf.CouponBridgeAllocation a ON a.PermitId=b.PermitId AND a.CouponId=b.CouponId
   JOIN wf.CouponReservation r ON r.Id=a.ReservationId WHERE b.PermitId=@p`,
   {p:input(db.sql.VarChar(36),state.permit),n:input(db.sql.Int,p.NativeId)})).recordset;
  check(rows.length===2&&rows.every(r=>Number(r.RemaQty)===2.9&&Number(r.GoodQty)===0.1&&Number(r.ConsumedQty)===0.1&&r.Settlements===1),'NATIVE_CREATE_EXACT_BALANCES_AND_SINGLE_SETTLEMENT');
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
  const verification=(await db.wfQuery(`SELECT
   (SELECT COUNT(*) FROM wf.CouponBridgeLine b LEFT JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId
    WHERE b.PermitId=@p AND(c.CouponID IS NULL OR c.RemaQty<>b.NativeBefore+b.BeforeQty-b.AfterQty)) AS BadBalances,
   (SELECT COUNT(*) FROM wf.ChangeEvent WHERE EntityType='COUPON_BRIDGE' AND EntityId=@p AND Action='COMPLETE') AS Audits,
   (SELECT COUNT(*) FROM wf.CouponBridgeAllocation a JOIN wf.CouponReservation r ON r.Id=a.ReservationId
    WHERE a.PermitId=@p AND r.ConsumedQty<>a.BeforeConsumed+(SELECT SUM(x.DeltaQty) FROM wf.CouponBridgeAllocation x WHERE x.PermitId=@p AND x.ReservationId=a.ReservationId)) AS BadConsumption`,
   {p:input(db.sql.VarChar(36),state.permit)})).recordset[0];
  check(verification.BadBalances===0&&verification.BadConsumption===0&&verification.Audits===1,'NATIVE_EXACT_BALANCES_CONSUMPTION_AND_ONE_AUDIT_'+state.operation);
  const r={permitId:state.permit,reason:'QA physical WinSpeed save and balances reviewed '+run};
  const preview=await bridge('release',r);check(preview.reviewRequired,'FRESH_RELEASE_PROOF');
  const released=await bridge('release',{...r,fingerprint:preview.fingerprint});check(released.completed,'RELEASE_EXPLICIT_'+state.operation);
  if(state.operation==='D'){
   const balances=(await db.wfQuery(`SELECT c.RemaQty,r.ConsumedQty FROM wf.CouponReservation r JOIN dbo.WFCoupon c ON c.CouponID=r.CouponId
    WHERE r.Id IN(@a,@b)`,{a:input(db.sql.BigInt,Object.values(state.reservations)[0]),b:input(db.sql.BigInt,Object.values(state.reservations)[1])})).recordset;
   check(balances.length===2&&balances.every(b=>Number(b.RemaQty)===3&&Number(b.ConsumedQty)===0),'NATIVE_CANCEL_CONSERVES_PHYSICAL_AND_RESERVATIONS');
   for(const id of Object.values(state.reservations))await call('sales','/coupons/cancel',{reservationId:id,reason:'QA native rehearsal complete; release own unused reservation'});
   for(const r of Object.values(state.overlap||{}))if(r.id)await call('sales','/coupons/cancel',{reservationId:r.id,reason:'QA overlap rehearsal complete; release own unused reservation'});
  }
 }else if(phase==='cancel')await authorize('D',[]);
 else throw Error('QA_BRIDGE_PHASE_INVALID');
}
main().catch(e=>{console.error('QA_BRIDGE_LIVE_FAILED '+e.message);process.exitCode=1;}).finally(()=>db.closeAll());
