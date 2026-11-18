'use strict';

// A review result is informational only: it never proves a native transaction
// or authorizes release of any reservation.
const {sql,wfQuery,wfTransaction}=require('../db');
const {hasPermission}=require('./role-capabilities');
const {businessIds,actorPerspective}=require('./business-identity');
const {currentActorId,hasColumn}=require('./request-context');
const {DEFAULT_START_DATE,isValidStartDate}=require('./data-window');
const {KEY}=require('./global-data-window-store');
const {classifyNativeAuthorizationEvidence}=require('./coupon-native-review-classifier');

function problem(code,status=409){throw Object.assign(new Error(code),{code,status});}
function int(value,max=2147483647){const n=Number(value);return /^\d+$/.test(String(value))&&Number.isSafeInteger(n)&&n>0&&n<=max?n:null;}

async function assertNativeHoldPrimary(tx,connection=require('../db'),primary=process.env.ONPREM_DB_NAME) {
 const name=String(primary||'').trim();
 if(connection.DEFAULT_TARGET!=='onprem'||connection.getTarget()!=='onprem'||!name)
  problem('COUPON_NATIVE_REVIEW_PRIMARY_REQUIRED',403);
 const rows=(await tx.request().query('SELECT DB_NAME() AS DatabaseName'))?.recordset;
 if(!Array.isArray(rows)||rows.length!==1||String(rows[0].DatabaseName||'').trim().toLowerCase()!==name.toLowerCase())
  problem('COUPON_NATIVE_REVIEW_PRIMARY_REQUIRED',403);
}

async function listNativeCutReview({actor,dataWindow,afterId=0,limit=25},deps={}) {
 if(!actor||!hasPermission(actor,'coupon.settle')||!hasPermission(actorPerspective(actor),'coupon.settle'))problem('COUPON_NATIVE_REVIEW_FORBIDDEN',403);
 const ids=businessIds(actor),effective=int(actor.sub??actor.id),actual=int(actor.actorSub??actor.actorId??effective);
 if(!effective||!actual||!ids.effective||!ids.actor||ids.effective!==effective||ids.actor!==actual||
    (Boolean(actor.isImpersonating)!==(effective!==actual))||(deps.currentActorId||currentActorId)()!==actual)
  problem('COUPON_NATIVE_REVIEW_IDENTITY_INVALID',403);
 if(!await (deps.hasColumn||hasColumn)(deps.wfQuery||wfQuery,'wf.ChangeEvent','ActorUserId'))problem('COUPON_NATIVE_REVIEW_AUDIT_UNAVAILABLE',503);
 const cursor=Number(afterId),count=Number(limit);
 if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(count)||count<1||count>50||!isValidStartDate(dataWindow?.businessDate))
  problem('COUPON_NATIVE_REVIEW_INVALID',400);
 const transact=deps.wfTransaction||wfTransaction;
 return transact(async tx=>{
  await (deps.assertPrimaryDatabase||require('./coupon-manual-window-fence').assertPrimaryDatabase)(tx);
  const query=async(text,inputs={})=>{const req=tx.request();for(const [key,{type,value}] of Object.entries(inputs))req.input(key,type,value);return req.query(text);};
  const rows=async(text,inputs={})=>{const result=await query(text,inputs);if(!Array.isArray(result?.recordset))problem('COUPON_NATIVE_REVIEW_EVIDENCE_UNAVAILABLE',503);return result.recordset;};
  if(!await (deps.authorizationHoldsAvailable||require('./coupon-authorization-hold').authorizationHoldsAvailable)(query))
   problem('COUPON_NATIVE_REVIEW_SCHEMA_UNAVAILABLE',503);
  const evidenceAvailable=await (deps.nativeCutEvidenceAvailable||require('./coupon-native-cut-evidence').nativeCutEvidenceAvailable)(query);
  const {currentEdit}=await require('./coupon-recovery-readiness').resolveRecoverySupport(query);
  let completionAvailable=false;
  let releaseAvailable=false;
  let resumeAvailable=false;
  if(currentEdit){
   const schema=await rows(`SELECT
     (SELECT COUNT(*) FROM wf.SchemaMigration WITH (HOLDLOCK)
      WHERE FileName='233_coupon_native_edit_completion.sql') AS WriterMigration,
     CASE WHEN OBJECT_ID('wf.CouponNativeEditCompletion','U') IS NULL THEN 0 ELSE 1 END AS ReceiptVisible,
     HAS_PERMS_BY_NAME('wf.CouponNativeEditCompletion','OBJECT','SELECT') AS ReceiptSelect,
     CASE WHEN OBJECT_ID('wf.CouponEffectiveSettlement','V') IS NOT NULL
       AND OBJECT_ID('wf.sp_ReleaseCouponNativeEdit','P') IS NOT NULL
       AND HAS_PERMS_BY_NAME('wf.CouponNativeEditRelease','OBJECT','SELECT')=1
       AND EXISTS(SELECT 1 FROM wf.SchemaMigration WITH (HOLDLOCK)
         WHERE FileName='236_coupon_recovery_reviewed_release.sql') THEN 1 ELSE 0 END AS ReleaseAvailable,
     CASE WHEN OBJECT_ID('wf.sp_ResumeCouponNativeEdit','P') IS NOT NULL
       AND HAS_PERMS_BY_NAME('wf.CouponNativeEditSnapshot','OBJECT','SELECT')=1
       AND EXISTS(SELECT 1 FROM wf.SchemaMigration WITH (HOLDLOCK)
         WHERE FileName='240_coupon_native_edit_resume_set_options.sql') THEN 1 ELSE 0 END AS ResumeAvailable`);
   if(schema.length!==1)problem('COUPON_NATIVE_REVIEW_SCHEMA_UNAVAILABLE',503);
   const {WriterMigration,ReceiptVisible,ReceiptSelect}=schema[0];
   completionAvailable=WriterMigration===1 && ReceiptVisible===1 && ReceiptSelect===1;
   releaseAvailable=completionAvailable && schema[0].ReleaseAvailable===1;
   resumeAvailable=releaseAvailable && schema[0].ResumeAvailable===1;
   if(!completionAvailable && (WriterMigration!==0 || ReceiptVisible!==0))
    problem('COUPON_NATIVE_REVIEW_SCHEMA_UNAVAILABLE',503);
  }
  const settings=await rows('SELECT SettingValue FROM wf.SystemSetting WITH (UPDLOCK,HOLDLOCK) WHERE SettingKey=@key',
    {key:{type:sql.NVarChar(100),value:KEY}});
  if(settings.length>1)problem('COUPON_NATIVE_REVIEW_WINDOW_UNAVAILABLE',503);
  const current=settings[0]?.SettingValue==null||settings[0]?.SettingValue===''?DEFAULT_START_DATE:String(settings[0].SettingValue).trim();
  if(!isValidStartDate(current))problem('COUPON_NATIVE_REVIEW_WINDOW_UNAVAILABLE',503);
  if(current!==dataWindow.businessDate)problem('COUPON_NATIVE_REVIEW_WINDOW_CHANGED');
  const nowRows=await rows('SELECT GETUTCDATE() AS ServerNow');
  if(nowRows.length!==1||nowRows[0].ServerNow==null||!Number.isFinite(new Date(nowRows[0].ServerNow).getTime()))problem('COUPON_NATIVE_REVIEW_CLOCK_UNAVAILABLE',503);
  // Discovery reads committed rows only but is still untrusted: never return
  // it or use it to authorize access. READCOMMITTED releases discovery locks
  // before the coupon-first lock sequence even in this serializable transaction.
  // Lock all coupons and reservations in deterministic order before locking
  // authorization rows, matching the mutation path. Re-read every discovered
  // line under locks; an in-flight or changed discovery fails closed.
  const heads=await rows(`SELECT TOP (@limit) Id FROM wf.CouponNativeCutAuthorization WITH (READCOMMITTED)
    WHERE Id>@after AND State IN ('ACTIVE','USED','CANCELLED','EXPIRED') ORDER BY Id`,{
    limit:{type:sql.Int,value:count},after:{type:sql.BigInt,value:cursor}});
  const discovered=[];
  for(const head of heads){
   const aid=int(head.Id,Number.MAX_SAFE_INTEGER);
   if(!aid)problem('COUPON_NATIVE_REVIEW_DATA_INVALID',503);
   const inputs={aid:{type:sql.BigInt,value:aid}};
   const lines=await rows(`SELECT ReservationId,CouponId FROM wf.CouponNativeCutAuthorizationLine WITH (READCOMMITTED)
     WHERE AuthorizationId=@aid ORDER BY CouponId,ReservationId`,inputs);
   if(!lines.length||lines.length>100||lines.some(x=>!int(x.ReservationId)||!int(x.CouponId)))
    problem('COUPON_NATIVE_REVIEW_DISCOVERY_CHANGED');
   discovered.push({aid,lines});
  }
  const couponIds=[...new Set(discovered.flatMap(x=>x.lines.map(y=>Number(y.CouponId))))].sort((a,b)=>a-b);
  const reservationIds=[...new Set(discovered.flatMap(x=>x.lines.map(y=>Number(y.ReservationId))))].sort((a,b)=>a-b);
  for(const cid of couponIds){
   const found=await rows('SELECT CouponID FROM dbo.WFCoupon WITH (UPDLOCK,HOLDLOCK) WHERE CouponID=@cid',
    {cid:{type:sql.Int,value:cid}});
   if(found.length!==1)problem('COUPON_NATIVE_REVIEW_DISCOVERY_CHANGED');
  }
  for(const rid of reservationIds){
   const found=await rows('SELECT Id FROM wf.CouponReservation WITH (UPDLOCK,HOLDLOCK) WHERE Id=@rid',
    {rid:{type:sql.Int,value:rid}});
   if(found.length!==1)problem('COUPON_NATIVE_REVIEW_DISCOVERY_CHANGED');
  }
  const couponVisible=deps.couponVisible||require('./coupon-access-scope').couponVisible;
  const reservationsVisible=deps.reservationsVisible||require('./coupon-access-scope').reservationsVisible;
  const items=[],reviewFacts=new Map();
  for(const candidate of discovered){
   const aid=candidate.aid;
   const locked=await rows(`SELECT Id,DocuNo,State,ExpiresAt,CreatedAt FROM wf.CouponNativeCutAuthorization WITH (UPDLOCK,HOLDLOCK)
     WHERE Id=@aid`,{aid:{type:sql.BigInt,value:aid}});
   if(locked.length!==1||!['ACTIVE','USED','CANCELLED','EXPIRED'].includes(locked[0].State))
    problem('COUPON_NATIVE_REVIEW_DISCOVERY_CHANGED');
   const head=locked[0],doc=typeof head.DocuNo==='string'?head.DocuNo.trim():'';
   if(!aid||!doc||doc.length>25)problem('COUPON_NATIVE_REVIEW_DATA_INVALID',503);
   const inputs={aid:{type:sql.BigInt,value:aid},doc:{type:sql.VarChar(50),value:doc}};
   const lines=await rows(`SELECT ReservationId,CouponId,AuthorizedQty FROM wf.CouponNativeCutAuthorizationLine WITH (HOLDLOCK)
     WHERE AuthorizationId=@aid ORDER BY CouponId,ReservationId`,inputs);
   if(!lines.length||lines.length>100||lines.some(x=>!int(x.ReservationId)||!int(x.CouponId)))problem('COUPON_NATIVE_REVIEW_DATA_INVALID',503);
   const pairs=xs=>xs.map(x=>`${Number(x.CouponId)}:${Number(x.ReservationId)}`).sort().join('|');
   if(pairs(lines)!==pairs(candidate.lines))problem('COUPON_NATIVE_REVIEW_DISCOVERY_CHANGED');
   let visible=true;
   for(const line of lines)if(!await couponVisible(actor,Number(line.CouponId),query)){visible=false;break;}
   if(!visible||!await reservationsVisible(actor,lines.map(x=>Number(x.ReservationId)),query))continue;
   const pendingEdit=currentEdit ? (await rows(`SELECT TOP 1 CONVERT(varchar(36),eh.EditId) AS EditId,
     ${completionAvailable ? "CASE WHEN EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion c WITH (HOLDLOCK) WHERE c.EditId=eh.EditId) THEN 1 ELSE 0 END" : "0"} AS Completed,
     ${releaseAvailable ? "CASE WHEN EXISTS(SELECT 1 FROM wf.CouponNativeEditRelease x WITH (HOLDLOCK) WHERE x.EditId=eh.EditId) THEN 1 ELSE 0 END" : "0"} AS Released,
     ${resumeAvailable ? `CASE WHEN eh.PlannedOperation='E'
       AND EXISTS(SELECT 1 FROM wf.CouponNativeEditSnapshot s WITH (HOLDLOCK)
         WHERE s.EditId=eh.EditId AND s.NativeRedemptionId=eh.NativeRedemptionId)
       AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD h WITH (HOLDLOCK) WHERE h.RedemtionID=eh.NativeRedemptionId)
       AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK) WHERE d.RedemtionID=eh.NativeRedemptionId)
       THEN 1 ELSE 0 END` : "0"} AS Resumable
     FROM wf.CouponNativeEditHold eh WITH (HOLDLOCK)
     JOIN wf.CouponNativeCutAuthorizationLine al WITH (HOLDLOCK) ON al.Id=eh.AuthorizationLineId
     WHERE al.AuthorizationId=@aid ORDER BY Released,Completed,eh.CouponId`,inputs))[0] : null;
   if(pendingEdit){
    if(pendingEdit.Completed!==0 && pendingEdit.Completed!==1)problem('COUPON_NATIVE_REVIEW_EVIDENCE_UNAVAILABLE',503);
    const code=pendingEdit.Released===1 ? 'NATIVE_EDIT_RELEASED' :
      pendingEdit.Completed===1 ? 'NATIVE_EDIT_COMPLETED_REVIEW' : 'NATIVE_EDIT_INCOMPLETE';
    const item={authorizationId:aid,code,docuNo:null,sourceHidden:true};
    if(resumeAvailable&&pendingEdit.Resumable===1&&pendingEdit.Completed===0&&pendingEdit.Released===0&&
       /^[a-f\d-]{36}$/i.test(pendingEdit.EditId))item.resumeId=pendingEdit.EditId;
    if(pendingEdit.Completed===1){
     const totals=await rows(`SELECT COUNT(*) AS LineCount,
       CONVERT(varchar(32),SUM(ISNULL(r.RestoredQty,0))) AS RestoredQty,
       CONVERT(varchar(32),SUM(ISNULL(r.SettledAfter,s.SettledQty))) AS SettledAfter,
       CONVERT(varchar(32),SUM(CASE WHEN h.PlannedDocuDate<@cutoff
           THEN ISNULL(r.RestoredQty,0) ELSE CONVERT(decimal(12,4),0) END)) AS OpeningSourceRestored,
       SUM(CASE WHEN s.Id IS NULL OR h.PlannedDocuDate IS NULL OR h.PlannedBeforeQty IS NULL
          OR h.PlannedAfterQty IS NULL OR s.SettledQty<>h.PlannedBeforeQty
          OR (h.PlannedAfterQty<h.PlannedBeforeQty AND (r.Id IS NULL OR a.EventId IS NULL
              OR r.SettledBefore<>h.PlannedBeforeQty OR r.SettledAfter<>h.PlannedAfterQty
              OR a.Action<>'NATIVE_RECOVERY' OR a.UserId<>CONVERT(varchar(20),h.PlannedEffectiveUserId)
              OR ISNULL(a.ActorUserId,'')<>CONVERT(varchar(20),h.PlannedActorUserId)))
          OR (h.PlannedAfterQty=h.PlannedBeforeQty AND r.Id IS NOT NULL) THEN 1 ELSE 0 END) AS InvalidCount
       FROM wf.CouponNativeEditHold h WITH (HOLDLOCK)
       JOIN wf.CouponNativeCutAuthorizationLine al WITH (HOLDLOCK) ON al.Id=h.AuthorizationLineId
       JOIN wf.CouponNativeEditCompletion c WITH (HOLDLOCK) ON c.EditId=h.EditId
       LEFT JOIN wf.CouponReservationSettlement s WITH (HOLDLOCK)
         ON s.Id=h.PlannedSettlementId AND s.ReservationId=al.ReservationId AND s.CouponId=h.CouponId
       LEFT JOIN wf.CouponNativeRecovery r WITH (HOLDLOCK)
         ON r.SettlementId=s.Id AND r.AuthorizationLineId=al.Id
         AND r.RecoveryKey=CONVERT(varchar(36),h.EditId)+':'+CONVERT(varchar(20),s.Id)
       LEFT JOIN wf.ChangeEvent a WITH (HOLDLOCK) ON a.EventId=r.AuditEventId
       WHERE al.AuthorizationId=@aid`,{ aid:inputs.aid,cutoff:{type:sql.VarChar(10),value:current} });
     const amounts=totals[0];
     if(totals.length!==1||!Number.isInteger(amounts.LineCount)||amounts.LineCount<=0||amounts.InvalidCount!==0||
        ![amounts.RestoredQty,amounts.SettledAfter,amounts.OpeningSourceRestored].every(x=>/^\d{1,14}\.\d{4}$/.test(x)))
      problem('COUPON_NATIVE_REVIEW_EVIDENCE_UNAVAILABLE',503);
     item.recovery={restoredQty:amounts.RestoredQty,settledAfter:amounts.SettledAfter,
      openingSourceRestored:amounts.OpeningSourceRestored};
     if(releaseAvailable&&pendingEdit.Released===0&&/^[a-f\d-]{36}$/i.test(pendingEdit.EditId))
      item.releaseId=pendingEdit.EditId;
    }
    items.push(item);
    reviewFacts.set(aid,{
     authorizationState:head.State,
     authorizedLines:lines.length,
     ...(pendingEdit.Completed===1 ? {nativeEditCompleted:true} : {nativeEditPending:true}),
     businessDate:dataWindow.businessDate,
    });
    continue;
   }
   const docs=await rows(`SELECT TOP 2 RedemtionID,LTRIM(RTRIM(DocuNo)) AS DocuNo,DocuType,DocuStatus,
      CONVERT(varchar(10),DocuDate,120) AS DocuDate FROM dbo.WFRedemtionHD WITH (HOLDLOCK)
      WHERE LTRIM(RTRIM(DocuNo))=@doc ORDER BY RedemtionID`,inputs);
   for(const source of docs){
    const rid=int(source.RedemtionID);if(!rid)problem('COUPON_NATIVE_REVIEW_DATA_INVALID',503);
    source.lines=await rows('SELECT TOP 101 CouponID,GoodQty FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@rid ORDER BY CouponID',
      {rid:{type:sql.Int,value:rid}});
   }
   const settlement=await rows(`SELECT TOP 101 s.ReservationId,s.CouponId,s.NativeRedemptionId,s.NativeDocuNo,s.SettledQty
     FROM wf.CouponReservationSettlement s WITH (HOLDLOCK)
     JOIN wf.CouponNativeCutAuthorizationLine l WITH (HOLDLOCK) ON l.ReservationId=s.ReservationId
     WHERE l.AuthorizationId=@aid`,inputs);
   const evidence=evidenceAvailable?await rows(`SELECT TOP 101 e.EvidenceState,e.NativeRedemptionId
     FROM wf.CouponNativeCutEvidence e WITH (HOLDLOCK)
     JOIN wf.CouponNativeCutAuthorizationLine l WITH (HOLDLOCK) ON l.Id=e.AuthorizationLineId
     WHERE l.AuthorizationId=@aid`,inputs):[];
   // If a referenced header still exists under a different number, report a
   // mismatch without returning that header's number, date or other fields.
   // The references originate only from this already scope-checked item.
   const relatedIds=docs.length===0&&!evidence.some(x=>x.EvidenceState==='PREPARED')?[...new Set([...settlement,...evidence]
     .map(x=>int(x.NativeRedemptionId)).filter(Boolean))]:[];
   let relatedSourceFound=false;
   if(relatedIds.length){
    const relatedInputs={},params=relatedIds.map((value,i)=>{
      const key=`source${i}`;relatedInputs[key]={type:sql.Int,value};return `@${key}`;
    });
    const related=await rows(`SELECT TOP 1 1 AS RelatedSource FROM dbo.WFRedemtionHD WITH (HOLDLOCK)
      WHERE RedemtionID IN (${params.join(',')})`,relatedInputs);
    relatedSourceFound=related.length>0;
   }
   const audit=await rows(`SELECT TOP 1 1 AS Found FROM dbo.SMAudit WITH (HOLDLOCK)
     WHERE audit_docuno=@doc OR (audit_docuno LIKE ' %' AND LTRIM(RTRIM(audit_docuno))=@doc)`,inputs);
   const result=classifyNativeAuthorizationEvidence({authorization:head,lines,documents:docs,settlements:settlement,evidence,relatedSourceFound,
      auditObserved:audit.length>0,window:dataWindow,now:nowRows[0].ServerNow});
   if(result.requiresReview){
    const source=docs.length===1?docs[0]:null;
    const sourceCurrent=source&&isValidStartDate(source.DocuDate)&&source.DocuDate>=dataWindow.businessDate&&
      ['SETTLEMENT_LINK_INCOMPLETE','SETTLEMENT_LINK_INCONSISTENT','LINKED_REQUIRES_TRANSACTION_EVIDENCE'].includes(result.code);
    items.push({authorizationId:aid,code:result.code,docuNo:sourceCurrent?source.DocuNo:null,sourceHidden:!sourceCurrent});
    // The audit snapshot is intentionally aggregate-only: do not record old
    // source identifiers, documents or customer details under a cutoff.
    reviewFacts.set(aid,{
     authorizationState:head.State,authorizedLines:lines.length,sourceCountUpToTwo:docs.length,
     settlementCountUpTo101:settlement.length,preparedEvidence:evidence.filter(x=>x.EvidenceState==='PREPARED').length,
     appliedEvidence:evidence.filter(x=>x.EvidenceState==='APPLIED').length,evidenceCountUpTo101:evidence.length,
     nativeAuditObserved:audit.length>0,
     businessDate:dataWindow.businessDate,
    });
   }
  }
  // The optional internal callback runs only after the same scoped and locked
  // re-read used to build the queue. It cannot authorize a release or cut.
  if(deps.onLockedReview)await deps.onLockedReview({tx,items,heads,ids,reviewFacts});
  await (deps.logChangeEvent||require('./policy-contract').logChangeEvent)(tx,{entityType:'COUPON_NATIVE_REVIEW',
   entityId:'QUEUE',action:'READ',afterJson:{returned:items.length},reasonCode:'COUPON_NATIVE_REVIEW',userId:String(ids.effective)});
  // Only the route may encrypt this cursor; never return it directly to a client.
  return {items,scannedThrough:heads.length?Number(heads[heads.length-1].Id):cursor,scannedCount:heads.length};
 },{isolationLevel:sql.ISOLATION_LEVEL.SERIALIZABLE});
}

// Record a reviewer's decision to keep the existing hold. This is deliberately
// not a recovery/reversal: no financial or source rows are changed. Inspect the
// current scoped item under locks and atomically record both identities.
async function recordNativeReviewHold({actor,dataWindow,authorizationId,expectedCode,note},deps={}) {
 const aid=int(authorizationId,Number.MAX_SAFE_INTEGER);
 if(!aid||typeof expectedCode!=='string'||!/^[A-Z_]{3,64}$/.test(expectedCode)||
    typeof note!=='string'||note.trim().length<5||note.trim().length>300||/[\x00-\x1f\x7f]/.test(note))
  problem('COUPON_NATIVE_REVIEW_HOLD_INVALID',400);
 const cleanNote=note.trim();
 await listNativeCutReview({actor,dataWindow,afterId:aid-1,limit:1},{...deps,
  onLockedReview:async({tx,items,heads,ids,reviewFacts})=>{
   await (deps.assertHoldPrimary||assertNativeHoldPrimary)(tx);
   if(heads.length!==1||Number(heads[0].Id)!==aid||items.length!==1||items[0].authorizationId!==aid)
    problem('COUPON_NATIVE_REVIEW_NOT_FOUND',404);
   const item=items[0];
   if(item.code==='NATIVE_EDIT_RELEASED')problem('COUPON_NATIVE_REVIEW_ALREADY_RELEASED');
   if(item.code!==expectedCode)problem('COUPON_NATIVE_REVIEW_CHANGED');
   const facts=reviewFacts.get(aid);
   if(!facts)problem('COUPON_NATIVE_REVIEW_EVIDENCE_UNAVAILABLE',503);
   await (deps.logChangeEvent||require('./policy-contract').logChangeEvent)(tx,{
    entityType:'COUPON_NATIVE_REVIEW',entityId:String(aid),action:'HOLD_REVIEWED',
    beforeJson:{code:item.code,sourceHidden:item.sourceHidden,...facts},
    afterJson:{code:item.code,hold:'UNCHANGED'},reasonCode:'NATIVE_REVIEW_HOLD',reasonText:cleanNote,
    userId:String(ids.effective),
   });
  },
 });
 return {authorizationId:aid,code:expectedCode,hold:'UNCHANGED'};
}
module.exports={listNativeCutReview,recordNativeReviewHold,assertNativeHoldPrimary};
