'use strict';
// Authenticated Rebate-on phases. Native documents and all IDs are private run
// fixtures; never seed a balance or bypass the evidence/approval/aging gates.
const fs=require('fs'),crypto=require('crypto');
module.exports=async function(ctx){
 const {call,query,check,save,state,sql,CUST_ID,RUN,deliveryDate}=ctx;
 if(!require('./native-v3-qa-profile.cjs').assertQaProfile().rebate)throw Error('QA_REBATE_PROFILE_REQUIRED');
 const reviewer=JSON.parse(fs.readFileSync('/review-state/bootstrap.json','utf8'));
 const login=await call('POST','/auth/login',{username:reviewer.username,password:reviewer.password});
 check(login.status===200&&login.data.user?.role==='ADMIN','REBATE_QA_REVIEWER_LOGIN');
 const admin=login.data.accessToken;
 state.rebate||={evidence:{}};const r=state.rebate;
 const cuts=Object.values(state.cases).flatMap(c=>c.cuts||[]);
 const unique=new Map(cuts.map(c=>[c.receipt.nativeId,c.receipt]));
 for(const cut of unique.values())for(const line of cut.lines){
  const key=cut.nativeId+':'+line.NativeLineNo;if(r.evidence[key]?.verified)continue;
  const staged=await call('POST','/rebate-pool/shipment-evidence/stage',{redemptionId:cut.nativeId,listNo:line.NativeLineNo},admin);
  check(staged.status===200,'REBATE_STAGE_'+key.replace(':','_'));
  r.evidence[key]||={id:staged.data.id};save();
  const stamp=(await query(`SELECT CONVERT(varchar(23),DATEADD(hour,-7,MIN(audit_datetime)),121)+'Z' AS Occurred
   FROM dbo.SMAudit WHERE audit_system=3 AND audit_screen=2098003052 AND audit_columnid=@id AND audit_action='INSERT'`,
   {id:{type:sql.Int,value:cut.nativeId}})).recordset[0]?.Occurred?.replace(' ','T');
  if(!stamp)throw Error('QA_NATIVE_SHIPMENT_TIME_UNPROVEN');
  if(staged.data.status==='HELD'){
   const approved=await call('POST','/rebate-pool/shipment-evidence/'+staged.data.id+'/review',{
    expectedRevision:staged.data.revision,decision:'VERIFY',occurredAtUtc:stamp,
    reason:RUN+' isolated simulated transport, native receipt and quantities checked; not a real shipment'},admin);
   check(approved.status===200&&approved.data.status==='MANUALLY_VERIFIED','REBATE_REVIEW_AND_ACCRUE_'+key.replace(':','_'));
  }else check(staged.data.status==='MANUALLY_VERIFIED','REBATE_EVIDENCE_REPLAY_VERIFIED');
  r.evidence[key].verified=true;save();
 }
 const sum=(await query(`SELECT COUNT(*) AS N,SUM(a.AmountBaht) AS Amount,SUM(a.QuantityTon) AS Ton
  FROM wf.RebateShipmentAccrual a JOIN wf.RebateResetParticipant p ON p.EnvironmentKind=a.EnvironmentKind AND p.ResetId=a.ResetId
  WHERE a.CustId=@cust AND a.BookingSOID IN(@i,@k)`,{cust:{type:sql.Int,value:CUST_ID},
  i:{type:sql.Int,value:state.cases.I.soid},k:{type:sql.Int,value:state.cases.K.soid}})).recordset[0];
 check(sum.N===10&&Number(sum.Ton)===12&&Number(sum.Amount)===2400,'REBATE_EXACT_12_TON_2400_BAHT_FROM_PHYSICAL_LINES');
 const year=Number(deliveryDate.slice(0,4));
 let prices=await call('GET','/rebate-pool/oct31-prices?year='+year,undefined,'manager');
 check(prices.status===200,'REBATE_STANDING_PRICES_READ');
 const good=state.cases.I.delivery.lines[0];
 let standing=(prices.data.items||[]).find(p=>Number(p.goodId??p.GoodId)===Number(good.GoodId??good.GoodID));
 // Native receipt lines carry source/coupon, so get the exact native product.
 const goodId=(await query('SELECT GoodID FROM dbo.WFCoupon WHERE CouponID=@c',{c:{type:sql.Int,value:good.CouponId}})).recordset[0].GoodID;
 standing=(prices.data.items||[]).find(p=>Number(p.goodId??p.GoodId)===Number(goodId));
 if(!standing){
  const snapshot=await call('POST','/rebate-pool/oct31-prices/snapshot',{standingYear:year},'manager');
  check(snapshot.status===201,'REBATE_STANDING_PRICE_FROM_WINSPEED');
  prices=await call('GET','/rebate-pool/oct31-prices?year='+year,undefined,'manager');
  standing=(prices.data.items||[]).find(p=>Number(p.goodId??p.GoodId)===Number(goodId));
 }
 check(!!standing,'REBATE_SAME_GOOD_HAS_CONFIRMED_STANDING_PRICE');
 if(!r.command){
  r.command={requestId:crypto.randomUUID(),expectedDatabase:reviewer.database,custId:CUST_ID,goodId:Number(goodId),
   standingYear:year,requestedTons:0.05,maturedOnly:false,note:RUN+' request one bag from verified shipment Rebate'};save();
 }
 if(!r.request){
  const request=await call('POST','/rebate-pool/conversion-requests',r.command,'sales');
  check(request.status===200&&request.data.status==='PENDING','REBATE_SALES_REQUEST_RESERVES_BALANCE');
  r.request=request.data;save();
  const replay=await call('POST','/rebate-pool/conversion-requests',r.command,'sales');
  check(replay.status===200&&replay.data.replayed,'REBATE_REQUEST_REPLAY_NO_DOUBLE_RESERVE');
 }
 if(!r.approval){
  const payload={expectedDatabase:reviewer.database,reason:RUN+' Manager reviewed verified shipment Rebate'};
  check((await call('POST','/rebate-pool/conversion-requests/'+r.request.id+'/approve',payload,'sales')).status===403,
   'REBATE_SALES_CANNOT_APPROVE_CONVERSION');
  const approved=await call('POST','/rebate-pool/conversion-requests/'+r.request.id+'/approve',payload,'manager');
  check(approved.status===200&&approved.data.status==='APPROVED','REBATE_MANAGER_ISSUES_ONE_TICKET');
  r.approval=approved.data;save();
 }
 const usable=await call('GET','/rebate-pool/tickets/usable?custId='+CUST_ID,undefined,'sales');
 check(usable.status===200,'REBATE_SALES_OWN_CUSTOMER_USABLE_TICKETS');
 r.goodId=Number(goodId);save();
};
