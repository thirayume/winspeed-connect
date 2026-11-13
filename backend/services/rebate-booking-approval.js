'use strict';

// Transaction primitive for a reviewed 103 pricing decision. Not mounted as a
// route until the preview, booking gate and shipment ledger are integrated.
// The query must run inside the caller's transaction; user must come from the
// trusted authentication/identity-mapping middleware, never from request JSON.
const { hasPermission, hasRole } = require('./role-capabilities');
const { approvalIdentity } = require('./approval-identity');
const { businessIds, actorPerspective } = require('./business-identity');
const { getVisibleScope, inScope } = require('./visible-scope');
const { prepareRebateBookingDecisions } = require('./rebate-booking-decisions');

function fail(code, status=409) { throw Object.assign(new Error(code), {code,status}); }
const positive=n=>Number.isSafeInteger(n) && n>0 && n<=2147483647;

async function previewBookingPricing(query,{user,draftId,windowStartUtc}={},overrides={}) {
  if(typeof query!=='function' || !positive(draftId) || !(windowStartUtc instanceof Date) ||
     !Number.isFinite(windowStartUtc.getTime())) fail('REBATE_APPROVAL_INPUT_INVALID',400);
  const actor=actorPerspective(user),business=businessIds(user);
  if(![business.actor,business.effective].every(positive)) fail('IDENTITY_BINDING_INVALID',409);
  if(!hasPermission(user,'rebate.approve-over-limit') || !hasPermission(actor,'rebate.approve-over-limit'))
    fail('REBATE_APPROVAL_PERMISSION_REQUIRED',403);
  const row=(await query(`SELECT Id,Status,DocumentRevision,SalesUserId,CreatedAt,
      CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),23) AS SaleDate
    FROM wf.SalesOrder WITH(UPDLOCK,HOLDLOCK) WHERE Id=@draftId AND CreatedAt>=@windowStartUtc`,{draftId,windowStartUtc})).recordset?.[0];
  if(!row || row.Status!=='DRAFT' || !positive(Number(row.SalesUserId))) fail('REBATE_APPROVAL_DRAFT_NOT_FOUND',404);
  const scope=overrides.getVisibleScope || getVisibleScope;
  const effectiveScope=await scope(user,query),actorScope=await scope(actor,query);
  if(!inScope(effectiveScope,{userId:row.SalesUserId}) || !inScope(actorScope,{userId:row.SalesUserId}))
    fail('REBATE_APPROVAL_DRAFT_NOT_FOUND',404);
  const lines=(await query(`SELECT * FROM wf.SalesOrderLine WITH(UPDLOCK,HOLDLOCK)
    WHERE SoId=@draftId ORDER BY LineNum`,{draftId})).recordset || [];
  const decisions=await prepareRebateBookingDecisions(query,{draft:row,lines,saleDate:row.SaleDate});
  return {draftId,revision:Number(row.DocumentRevision),saleDate:row.SaleDate,lines:decisions.map(d=>({
    lineNo:d.lineNo,goodId:d.goodId,quantityTon:d.quantity,basePrice:d.source.basePrice,
    sellingPrice:d.sellingPrice,invoicePrice:d.calculation.invoiceUnitPrice,rebatePerTon:d.calculation.rebatePerTon,
    requiresManagerApproval:d.calculation.requiresManagerApproval,fingerprint:d.fingerprint}))};
}

async function reviewBookingPricing(query, {user,draftId,expectedRevision,expectedFingerprint,lineNo,reason,windowStartUtc}={}, overrides={}) {
  if(typeof query!=='function' || !positive(draftId) || !positive(expectedRevision) || !positive(lineNo) ||
     !/^[a-f0-9]{64}$/.test(String(expectedFingerprint||'')) || typeof reason!=='string' ||
     reason.trim().length<5 || reason.trim().length>500 || !(windowStartUtc instanceof Date) ||
     !Number.isFinite(windowStartUtc.getTime())) fail('REBATE_APPROVAL_INPUT_INVALID',400);
  const identity=approvalIdentity(user), actor=actorPerspective(user), business=businessIds(user);
  if(![business.actor,business.effective].every(positive)) fail('IDENTITY_BINDING_INVALID',409);
  if(!hasPermission(user,'rebate.approve-over-limit') || !hasPermission(actor,'rebate.approve-over-limit'))
    fail('REBATE_APPROVAL_PERMISSION_REQUIRED',403);
  const row=(await query(`SELECT Id,Status,DocumentRevision,SalesUserId,CreatedAt,
      CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),23) AS SaleDate
    FROM wf.SalesOrder WITH(UPDLOCK,HOLDLOCK) WHERE Id=@draftId AND CreatedAt>=@windowStartUtc`,{draftId,windowStartUtc})).recordset?.[0];
  if(!row || row.Status!=='DRAFT') fail('REBATE_APPROVAL_DRAFT_NOT_FOUND',404);
  if(!positive(Number(row.SalesUserId))) fail('REBATE_APPROVAL_DRAFT_NOT_FOUND',404);
  if(Number(row.DocumentRevision)!==expectedRevision) fail('REBATE_APPROVAL_STALE');
  const scope=overrides.getVisibleScope || getVisibleScope;
  const effectiveScope=await scope(user,query);
  const actorScope=await scope(actor,query);
  if(!inScope(effectiveScope,{userId:row.SalesUserId}) || !inScope(actorScope,{userId:row.SalesUserId}))
    fail('REBATE_APPROVAL_DRAFT_NOT_FOUND',404);
  // Preserve the existing price-approval policy: self-approval requires both
  // the acting and effective identities to be ADMIN or C_LEVEL.
  if([business.actor,business.effective].includes(Number(row.SalesUserId)) &&
      !(hasRole(user,'ADMIN','C_LEVEL') && hasRole(actor,'ADMIN','C_LEVEL'))) fail('REBATE_APPROVAL_SELF_FORBIDDEN',403);
  const lines=(await query(`SELECT * FROM wf.SalesOrderLine WITH(UPDLOCK,HOLDLOCK)
    WHERE SoId=@draftId ORDER BY LineNum`,{draftId})).recordset || [];
  const decisions=await prepareRebateBookingDecisions(query,{draft:row,lines,saleDate:row.SaleDate});
  const decision=decisions.find(d=>d.lineNo===lineNo);
  if(!decision || decision.fingerprint!==expectedFingerprint) fail('REBATE_APPROVAL_STALE');
  if(!decision.calculation.requiresManagerApproval) fail('REBATE_APPROVAL_NOT_REQUIRED');
  const existing=(await query(`SELECT Id,Decision,ActorPrimaryId,EffectivePrimaryId,ActorBusinessId,EffectiveBusinessId,Reason
    FROM wf.RebatePriceApprovalEvidence WITH(UPDLOCK,HOLDLOCK) WHERE DecisionFingerprint=@fingerprint`,
    {fingerprint:expectedFingerprint})).recordset || [];
  if(existing.length>1) fail('REBATE_APPROVAL_CONFLICT');
  if(existing.length===1) {
    const e=existing[0];
    if(!Number.isSafeInteger(Number(e.Id)) || Number(e.Id)<=0 || e.Decision!=='APPROVED' || Number(e.ActorPrimaryId)!==identity.actorId ||
       Number(e.EffectivePrimaryId)!==identity.effectiveId || Number(e.ActorBusinessId)!==business.actor ||
       Number(e.EffectiveBusinessId)!==business.effective || String(e.Reason).trim()!==reason.trim()) fail('REBATE_APPROVAL_CONFLICT');
    return {id:Number(e.Id),fingerprint:expectedFingerprint,saleDate:row.SaleDate,replayed:true};
  }
  const inserted=await query(`INSERT wf.RebatePriceApprovalEvidence
    (DecisionFingerprint,DraftId,[LineNo],DocumentRevision,Decision,ActorPrimaryId,EffectivePrimaryId,ActorBusinessId,EffectiveBusinessId,Reason)
    OUTPUT INSERTED.Id VALUES(@fingerprint,@draftId,@lineNo,@revision,'APPROVED',@actorPrimary,@effectivePrimary,@actorBusiness,@effectiveBusiness,@reason)`,
  {fingerprint:expectedFingerprint,draftId,lineNo,revision:expectedRevision,actorPrimary:identity.actorId,
    effectivePrimary:identity.effectiveId,actorBusiness:business.actor,effectiveBusiness:business.effective,reason:reason.trim()});
  const id=Number(inserted.recordset?.[0]?.Id);
  if(!Number.isSafeInteger(id) || id<=0) fail('REBATE_APPROVAL_CONFLICT');
  return {id,fingerprint:expectedFingerprint,saleDate:row.SaleDate,replayed:false};
}
module.exports={previewBookingPricing,reviewBookingPricing};
