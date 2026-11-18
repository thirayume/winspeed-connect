'use strict';

// Called inside both reset fences and the claim transaction. A replay must
// remain within the current data window, reset epoch and BOTH identities'
// source scope; never treat a key alone as permission to disclose a claim.
const { sharedRebateScopeFilter }=require('./rebate-shared-scope');
const { parseEvidenceInstant }=require('./rebate-evidence-policy');
function fail(code,status=409){throw Object.assign(new Error(code),{code,status});}
async function validateClaimReplay(query,user,claim,{epoch,dataWindow,custId,payloadHash}={},options={}){
  if(typeof query!=='function'||!claim||!Number.isSafeInteger(Number(claim.Id))||Number(claim.Id)<1||
      !claim.RequestPayloadHash||claim.RequestPayloadHash!==payloadHash||String(claim.CustId||'').trim()!==String(custId||'').trim())
    fail('REBATE_CLAIM_REPLAY_CONFLICT');
  let created,start;
  try{created=parseEvidenceInstant(claim.CreatedAt);start=parseEvidenceInstant(dataWindow?.utcInstant);}catch(_){fail('REBATE_CLAIM_REPLAY_OUTSIDE_WINDOW',404);}
  if(created<start)fail('REBATE_CLAIM_REPLAY_OUTSIDE_WINDOW',404);
  if(epoch?.generation>0){let reset;try{reset=parseEvidenceInstant(epoch.lastResetAtUtc);}catch(_){fail('REBATE_CLAIM_REPLAY_CONFLICT');}
    if(created<=reset)fail('REBATE_CLAIM_REPLAY_PREVIOUS_EPOCH');}
  const scope=await (options.scopeFilter||sharedRebateScopeFilter)(user,options.getScope);
  const row=(await query(`SELECT COUNT(*) AS TotalLines,SUM(CASE WHEN visible.ok IS NULL THEN 0 ELSE 1 END) AS VisibleLines
    FROM wf.RebateClaimLine cl
    OUTER APPLY (SELECT TOP 1 1 AS ok FROM wf.v_RebateAccrualLot l
      WHERE l.SourceSOID=cl.SourceSOID AND l.SourceListNo=cl.SourceListNo AND l.CustId=@cid AND ${scope.sql}) visible
    WHERE cl.ClaimId=@claimId`,
  {...scope.inputs,cid:String(custId),claimId:Number(claim.Id)})).recordset?.[0];
  const total=Number(row?.TotalLines),visible=Number(row?.VisibleLines);
  if(!Number.isSafeInteger(total)||total<1||visible!==total)fail('REBATE_CLAIM_REPLAY_OUT_OF_SCOPE',404);
  return true;
}
module.exports={validateClaimReplay};
