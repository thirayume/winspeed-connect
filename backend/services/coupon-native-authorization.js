'use strict';

// Internal candidate only. No HTTP route and no native trigger consume this yet.
// Issuance must not be presented as permission to cut until the complete linked
// guard, cancellation workflow, native identity and UAT acceptance are proven.
const {sql,wfQuery,wfTransaction}=require('../db');
const {hasPermission}=require('./role-capabilities');
const {businessIds,actorPerspective}=require('./business-identity');
const {currentActorId,hasColumn}=require('./request-context');
const {isValidStartDate,DEFAULT_START_DATE}=require('./data-window');
const {KEY}=require('./global-data-window-store');
const {assertPrimaryDatabase}=require('./coupon-manual-window-fence');
const {logChangeEvent}=require('./policy-contract');

function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
function id(value){const n=Number(value);return /^\d+$/.test(String(value))&&Number.isSafeInteger(n)&&n>0&&n<=2147483647?n:null;}
function units(value){if(value==null||value==='')return null;const n=Number(value),u=Math.round(n*10000);return Number.isFinite(n)&&n>0&&Number.isSafeInteger(u)&&u<=999999999999&&u/10000===n?u:null;}

// There is no production native 116 consumer or approved recovery workflow.
// A PREPARED producer and enabled-looking guards alone are not readiness.
// Keep issuance closed until a complete verified bridge replaces this gate.
async function requireCompletedNativeBridge(){fail('COUPON_NATIVE_BRIDGE_UNAVAILABLE',503);}

// Native audit is evidence of an attempt, not evidence of a committed document.
// Any matching event requires manual review, including events before cutoff or
// for a document since deleted. Absence does not prove a document never existed.
async function assertNoNativeDocumentAudit(query,doc) {
  let rows;
  try {
    // audit_docuno is varchar(50) and indexed on the rehearsed WinSpeed schema.
    // Preserve index seeks for ordinary values, while conservatively including
    // historical values with leading spaces. Input is validated ASCII.
    rows=(await query(`SELECT TOP 1 1 AS Found FROM dbo.SMAudit
      WHERE audit_docuno=@doc OR (audit_docuno LIKE ' %' AND LTRIM(RTRIM(audit_docuno))=@doc)`,
      {doc:{type:sql.VarChar(50),value:doc}})).recordset;
  } catch (_) { fail('COUPON_NATIVE_AUTH_EVIDENCE_UNAVAILABLE',503); }
  if(!Array.isArray(rows))fail('COUPON_NATIVE_AUTH_EVIDENCE_UNAVAILABLE',503);
  if(rows.length)fail('COUPON_NATIVE_AUTH_SOURCE_REVIEW_REQUIRED');
}

async function requireAuthorizationActor(actor,deps) {
  if(!actor||!hasPermission(actor,'coupon.settle')||!hasPermission(actorPerspective(actor),'coupon.settle'))fail('COUPON_NATIVE_AUTH_FORBIDDEN',403);
  const identities=businessIds(actor),primaryEffective=id(actor.sub ?? actor.id),primaryActor=id(actor.actorSub ?? actor.actorId ?? primaryEffective);
  if(!primaryEffective||!primaryActor||!identities.effective||!identities.actor||
     identities.effective!==primaryEffective||identities.actor!==primaryActor||
     (Boolean(actor.isImpersonating)!==(primaryEffective!==primaryActor))||
     (deps.currentActorId||currentActorId)()!==identities.actor)fail('COUPON_NATIVE_AUTH_IDENTITY_INVALID',403);
  if(!await (deps.hasColumn||hasColumn)(deps.wfQuery||wfQuery,'wf.ChangeEvent','ActorUserId'))fail('COUPON_NATIVE_AUTH_AUDIT_UNAVAILABLE',503);
  return identities;
}

async function createNativeCutAuthorization({actor,docuNo,expiresAt,reason,items,dataWindow},deps={}) {
  const identities=await requireAuthorizationActor(actor,deps);
  const number=typeof docuNo==='string'?docuNo.trim():'';
  const expires=new Date(expiresAt);
  if(!number||number.length>25||/[^\x20-\x7e]/.test(number)||!Number.isFinite(expires.getTime())||
     typeof reason!=='string'||reason.trim().length<10||reason.length>500||!isValidStartDate(dataWindow?.businessDate)||
     !Array.isArray(items)||!items.length||items.length>100)fail('COUPON_NATIVE_AUTH_INVALID',400);
  const lines=items.map(x=>({couponId:id(x?.couponId),reservationId:id(x?.reservationId),qtyUnits:units(x?.qty)}));
  if(lines.some(x=>!x.couponId||!x.reservationId||!x.qtyUnits)||new Set(lines.map(x=>x.couponId)).size!==lines.length||
     new Set(lines.map(x=>x.reservationId)).size!==lines.length)fail('COUPON_NATIVE_AUTH_LINES_INVALID',400);
  lines.sort((a,b)=>a.couponId-b.couponId);
  const transact=deps.wfTransaction||wfTransaction;
  return transact(async tx=>{
    await (deps.assertPrimaryDatabase||assertPrimaryDatabase)(tx);
    await (deps.assertNativeBridgeReady||requireCompletedNativeBridge)(tx);
    const query=async(text,inputs={})=>{const req=tx.request();for(const [k,{type,value}] of Object.entries(inputs))req.input(k,type,value);return req.query(text);};
    const settings=(await query('SELECT SettingValue FROM wf.SystemSetting WITH (UPDLOCK,HOLDLOCK) WHERE SettingKey=@key',{key:{type:sql.NVarChar(100),value:KEY}})).recordset||[];
    if(settings.length>1)fail('COUPON_NATIVE_AUTH_WINDOW_UNAVAILABLE',503);
    const current=settings[0]?.SettingValue==null||settings[0]?.SettingValue===''?DEFAULT_START_DATE:String(settings[0].SettingValue).trim();
    if(!isValidStartDate(current))fail('COUPON_NATIVE_AUTH_WINDOW_UNAVAILABLE',503);
    if(current!==dataWindow.businessDate)fail('COUPON_NATIVE_AUTH_WINDOW_CHANGED');
    const couponVisible=deps.couponVisible||require('./coupon-access-scope').couponVisible;
    const reservationsVisible=deps.reservationsVisible||require('./coupon-access-scope').reservationsVisible;
    const coupons=deps.couponService||require('./coupon-service');
    for(const line of lines){
      const rows=(await query('SELECT CouponID FROM dbo.WFCoupon WITH (UPDLOCK,HOLDLOCK) WHERE CouponID=@cid',{cid:{type:sql.Int,value:line.couponId}})).recordset||[];
      if(rows.length!==1)fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
    }
    for(const line of lines){
      const rows=(await query(`SELECT Id FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK)
        WHERE Id=@rid AND CouponId=@cid AND Status='RESERVED' AND ReservedQty-ISNULL(ConsumedQty,0)>=@qty
          AND @expires>GETUTCDATE() AND (ExpiresAt IS NULL OR ExpiresAt>=@expires)`,{
        rid:{type:sql.Int,value:line.reservationId},cid:{type:sql.Int,value:line.couponId},
        qty:{type:sql.Decimal(12,4),value:line.qtyUnits/10000},expires:{type:sql.DateTime2,value:expires}})).recordset||[];
      if(rows.length!==1)fail('COUPON_NATIVE_AUTH_RESERVATION_CHANGED');
      if(!await couponVisible(actor,line.couponId,query))fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
      await coupons.assertControlTicketUnexpired(tx,line.couponId);
      await coupons.assertCouponReservationCoverage(tx,line.couponId);
    }
    if(!await reservationsVisible(actor,lines.map(x=>x.reservationId),query))fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
    const existing=(await query(`SELECT TOP 1 1 AS Found FROM dbo.WFRedemtionHD WITH (UPDLOCK,HOLDLOCK)
      WHERE LTRIM(RTRIM(DocuNo))=@doc`,{doc:{type:sql.NVarChar(25),value:number}})).recordset||[];
    if(existing.length)fail('COUPON_NATIVE_AUTH_DOCUMENT_EXISTS');
    await assertNoNativeDocumentAudit(query,number);
    const active=(await query(`SELECT TOP 1 1 AS Found FROM wf.CouponNativeActiveDocument WITH (UPDLOCK,HOLDLOCK)
      WHERE DocuNo=@doc`,{doc:{type:sql.NVarChar(25),value:number}})).recordset||[];
    if(active.length)fail('COUPON_NATIVE_AUTH_DOCUMENT_IN_USE');
    const holdService=require('./coupon-authorization-hold');
    // Resolve the selected database's schema once for this transaction; all
    // lines use the same evidence-aware policy under the held ledger locks.
    const holdPolicy=await (deps.resolveHoldPolicy||holdService.resolveHoldPolicy)(query);
    for(const line of lines){
      const used=(await query(`SELECT TOP 1 1 AS Found FROM wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK)
        JOIN wf.CouponNativeCutAuthorization h WITH (UPDLOCK,HOLDLOCK) ON h.Id=l.AuthorizationId
        WHERE l.ReservationId=@rid AND h.State='ACTIVE'`,{rid:{type:sql.Int,value:line.reservationId}})).recordset||[];
      if(used.length)fail('COUPON_NATIVE_AUTH_RESERVATION_IN_USE');
      // A closed authorization can still hold durable PREPARED/APPLIED native
      // evidence. Coverage retains its quantity but does not by itself forbid
      // issuing another authorization against that same reservation. Recheck
      // the evidence-aware hold while coupon and reservation locks are held.
      await (deps.assertNoActiveAuthorization||holdService.assertNoActiveAuthorization)(tx,line.reservationId,holdPolicy);
    }
    const inserted=(await query(`INSERT wf.CouponNativeCutAuthorization(DocuNo,ExpiresAt,EffectiveUserId,ActorUserId,Reason)
      OUTPUT INSERTED.Id VALUES(@doc,@expires,@effective,@actor,@reason)`,{
      doc:{type:sql.NVarChar(25),value:number},expires:{type:sql.DateTime2,value:expires},
      effective:{type:sql.Int,value:identities.effective},actor:{type:sql.Int,value:identities.actor},reason:{type:sql.NVarChar(500),value:reason.trim()}})).recordset||[];
    const authId=Number(inserted[0]?.Id);if(inserted.length!==1||!Number.isSafeInteger(authId)||authId<=0)fail('COUPON_NATIVE_AUTH_INSERT_FAILED',503);
    await query('INSERT wf.CouponNativeActiveDocument(DocuNo,AuthorizationId) VALUES(@doc,@id)',{doc:{type:sql.NVarChar(25),value:number},id:{type:sql.BigInt,value:authId}});
    for(const line of lines)await query('INSERT wf.CouponNativeCutAuthorizationLine(AuthorizationId,ReservationId,CouponId,AuthorizedQty) VALUES(@id,@rid,@cid,@qty)',{
      id:{type:sql.BigInt,value:authId},rid:{type:sql.Int,value:line.reservationId},cid:{type:sql.Int,value:line.couponId},qty:{type:sql.Decimal(12,4),value:line.qtyUnits/10000}});
    await (deps.logChangeEvent||logChangeEvent)(tx,{entityType:'COUPON_NATIVE_AUTH',entityId:String(authId),action:'AUTHORIZE',
      afterJson:{docuNo:number,expiresAt:expires.toISOString(),lines:lines.map(x=>({couponId:x.couponId,reservationId:x.reservationId,qty:x.qtyUnits/10000}))},
      reasonCode:'COUPON_NATIVE_AUTH',reasonText:reason.trim(),userId:String(identities.effective)});
    return {id:authId,docuNo:number,expiresAt:expires.toISOString(),lineCount:lines.length};
  },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
}

// Internal reviewed release: closing the authorization does not cancel the
// underlying reservation or adjust native balances. Existing native documents
// are held for reconciliation, including documents with ambiguous ownership.
async function closeNativeCutAuthorization({actor,authorizationId,reason,mode='cancel'},deps={}) {
  const identities=await requireAuthorizationActor(actor,deps);
  const aid=Number(authorizationId);
  if(!/^\d+$/.test(String(authorizationId))||!Number.isSafeInteger(aid)||aid<=0||
     !['cancel','expire'].includes(mode)||typeof reason!=='string'||reason.trim().length<10||reason.length>500)
    fail('COUPON_NATIVE_AUTH_CLOSE_INVALID',400);
  const transact=deps.wfTransaction||wfTransaction;
  return transact(async tx=>{
    await (deps.assertPrimaryDatabase||assertPrimaryDatabase)(tx);
    const query=async(text,inputs={})=>{const req=tx.request();for(const [k,{type,value}] of Object.entries(inputs))req.input(k,type,value);return req.query(text);};
    const authInput={id:{type:sql.BigInt,value:aid}};
    const initial=(await query(`SELECT l.CouponId,l.ReservationId FROM wf.CouponNativeCutAuthorizationLine l WITH (NOLOCK)
      WHERE l.AuthorizationId=@id ORDER BY l.CouponId,l.ReservationId`,authInput)).recordset||[];
    if(!initial.length||initial.length>100)fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
    const lines=initial.map(x=>({couponId:id(x.CouponId),reservationId:id(x.ReservationId)}));
    if(lines.some(x=>!x.couponId||!x.reservationId)||new Set(lines.map(x=>x.couponId)).size!==lines.length||
       new Set(lines.map(x=>x.reservationId)).size!==lines.length)fail('COUPON_NATIVE_AUTH_CORRUPT');
    for(const line of lines){
      const rows=(await query('SELECT CouponID FROM dbo.WFCoupon WITH (UPDLOCK,HOLDLOCK) WHERE CouponID=@cid',{cid:{type:sql.Int,value:line.couponId}})).recordset||[];
      if(rows.length!==1)fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
    }
    for(const line of lines){
      const rows=(await query('SELECT Id FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK) WHERE Id=@rid AND CouponId=@cid',{
        rid:{type:sql.Int,value:line.reservationId},cid:{type:sql.Int,value:line.couponId}})).recordset||[];
      if(rows.length!==1)fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
    }
    const couponVisible=deps.couponVisible||require('./coupon-access-scope').couponVisible;
    const reservationsVisible=deps.reservationsVisible||require('./coupon-access-scope').reservationsVisible;
    for(const line of lines)if(!await couponVisible(actor,line.couponId,query))fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
    if(!await reservationsVisible(actor,lines.map(x=>x.reservationId),query))fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
    const fresh=(await query(`SELECT l.CouponId,l.ReservationId FROM wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK)
      WHERE l.AuthorizationId=@id ORDER BY l.CouponId,l.ReservationId`,authInput)).recordset||[];
    if(fresh.length!==lines.length||fresh.some((x,i)=>id(x.CouponId)!==lines[i].couponId||id(x.ReservationId)!==lines[i].reservationId))
      fail('COUPON_NATIVE_AUTH_CHANGED');
    const heads=(await query(`SELECT DocuNo,State,CASE WHEN ExpiresAt<=GETUTCDATE() THEN 1 ELSE 0 END AS IsExpired
      FROM wf.CouponNativeCutAuthorization WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id`,authInput)).recordset||[];
    if(heads.length!==1)fail('COUPON_NATIVE_AUTH_NOT_FOUND',404);
    const head=heads[0],target=mode==='expire'?'EXPIRED':'CANCELLED';
    const evidenceAvailable=await (deps.nativeCutEvidenceAvailable||require('./coupon-native-cut-evidence').nativeCutEvidenceAvailable)(query);
    if(evidenceAvailable){
      const evidence=(await query(`SELECT TOP 1 1 AS Found FROM wf.CouponNativeCutEvidence e WITH (UPDLOCK,HOLDLOCK)
        JOIN wf.CouponNativeCutAuthorizationLine l WITH (UPDLOCK,HOLDLOCK) ON l.Id=e.AuthorizationLineId
        WHERE l.AuthorizationId=@id`,authInput)).recordset;
      if(!Array.isArray(evidence))fail('COUPON_NATIVE_AUTH_EVIDENCE_UNAVAILABLE',503);
      if(evidence.length)fail('COUPON_NATIVE_AUTH_SOURCE_REVIEW_REQUIRED');
    }
    if(head.State===target)return {id:aid,status:target,idempotent:true};
    if(head.State!=='ACTIVE')fail('COUPON_NATIVE_AUTH_ALREADY_CLOSED');
    if(mode==='expire'&&Number(head.IsExpired)!==1)fail('COUPON_NATIVE_AUTH_NOT_EXPIRED');
    const doc=typeof head.DocuNo==='string'?head.DocuNo.trim():'';
    if(!doc||doc.length>25)fail('COUPON_NATIVE_AUTH_CORRUPT');
    const source=(await query(`SELECT TOP 1 1 AS Found FROM dbo.WFRedemtionHD WITH (UPDLOCK,HOLDLOCK)
      WHERE LTRIM(RTRIM(DocuNo))=@doc`,{doc:{type:sql.NVarChar(25),value:doc}})).recordset||[];
    if(source.length)fail('COUPON_NATIVE_AUTH_SOURCE_REVIEW_REQUIRED');
    await assertNoNativeDocumentAudit(query,doc);
    const removed=await query('DELETE FROM wf.CouponNativeActiveDocument WHERE DocuNo=@doc AND AuthorizationId=@id',{
      doc:{type:sql.NVarChar(25),value:doc},...authInput});
    if(Number(removed.rowsAffected?.[0])!==1)fail('COUPON_NATIVE_AUTH_CHANGED');
    const updated=await query(`UPDATE wf.CouponNativeCutAuthorization SET State=@state,ClosedAt=GETUTCDATE(),
      ClosedBy=@effective,ClosedActorId=@actor,CloseReason=@reason WHERE Id=@id AND State='ACTIVE'`,{
      ...authInput,state:{type:sql.VarChar(16),value:target},effective:{type:sql.Int,value:identities.effective},
      actor:{type:sql.Int,value:identities.actor},reason:{type:sql.NVarChar(500),value:reason.trim()}});
    if(Number(updated.rowsAffected?.[0])!==1)fail('COUPON_NATIVE_AUTH_CHANGED');
    await (deps.logChangeEvent||logChangeEvent)(tx,{entityType:'COUPON_NATIVE_AUTH',entityId:String(aid),action:target,
      beforeJson:{state:'ACTIVE'},afterJson:{state:target},reasonCode:'COUPON_NATIVE_AUTH_CLOSE',reasonText:reason.trim(),userId:String(identities.effective)});
    return {id:aid,status:target,idempotent:false};
  },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
}
module.exports={createNativeCutAuthorization,closeNativeCutAuthorization,requireAuthorizationActor};
