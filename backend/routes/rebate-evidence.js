'use strict';
// Mounted under the authenticated Rebate Pool router. Disabled until the
// complete pricing, intake and ticket workflows have passed UAT together.
const router = require('express').Router();
const db = require('../db');
const { requireCapability } = require('../middleware/auth');
const { transactionQuery } = require('../services/rebate-sql');
const { withRebateRouteFence, routeParticipantFence, isShipmentEpoch } = require('../services/rebate-route-fence');
const { sharedRebateScopeFilter } = require('../services/rebate-shared-scope');
const { readGlobalDataWindow } = require('../services/global-data-window-store');
const { assertEvidenceScope } = require('../services/rebate-evidence-scope');
const { stageShipmentEvidence } = require('../services/rebate-evidence-intake');
const { reviewShipmentEvidence } = require('../services/rebate-evidence-review');

function enabled(req,res,next) {
  if (process.env.REBATE_POOL_103_ENABLED !== 'true')
    return res.status(503).json({code:'REBATE_POOL_103_UNAVAILABLE',message:'คิวหลักฐาน Rebate ยังไม่เปิดใช้งาน'});
  next();
}
function safeError(res,error) {
  const status=Number.isInteger(error?.status) && error.status>=400 && error.status<600 ? error.status : 500;
  const code=typeof error?.code==='string' && /^REBATE_[A-Z0-9_]+$/.test(error.code) ? error.code : 'REBATE_EVIDENCE_ERROR';
  return res.status(status).json({code,message:'ไม่สามารถดำเนินการหลักฐาน Rebate ได้ กรุณาตรวจข้อมูลหรือแจ้งผู้ดูแล'});
}
router.use(requireCapability('rebate.evidence.verify'), enabled);

router.get('/',async (req,res)=>{
  try {
    const window=await readGlobalDataWindow();
    const scope=await sharedRebateScopeFilter(req.user);
    const rows=await withRebateRouteFence(epoch=>db.wfTransaction(async tx=>{
      const q=transactionQuery(tx,db.sql);
      await routeParticipantFence(q,epoch);
      if(!isShipmentEpoch(epoch)) throw Object.assign(Error('reset required'),{code:'REBATE_RESET_NOT_COMPLETED',status:409});
      const result=await q(`SELECT TOP (200) Id,RedemptionId,RedemptionListNo,Status,HoldReason,QuantityTon,Revision,
        SourceSOID,SourceListNo,GoodId,CreatedAtUtc,DocuNo,DocuDate,IsOpeningSource FROM (
        SELECT e.Id,
          CASE WHEN h.DocuDate>=CAST(@startDate AS date) THEN e.RedemptionId END AS RedemptionId,
          CASE WHEN h.DocuDate>=CAST(@startDate AS date) THEN e.RedemptionListNo END AS RedemptionListNo,
          e.Status,e.HoldReason,e.QuantityTon,e.Revision,
          CASE WHEN h.DocuDate>=CAST(@startDate AS date) THEN e.SourceSOID END AS SourceSOID,
          CASE WHEN h.DocuDate>=CAST(@startDate AS date) THEN e.SourceListNo END AS SourceListNo,
          CASE WHEN h.DocuDate>=CAST(@startDate AS date) THEN e.GoodId END AS GoodId,e.CreatedAtUtc,
          CASE WHEN h.DocuDate>=CAST(@startDate AS date) THEN h.DocuNo END AS DocuNo,
          CASE WHEN h.DocuDate>=CAST(@startDate AS date) THEN CONVERT(varchar(10),h.DocuDate,23) END AS DocuDate,
          CASE WHEN h.DocuDate<CAST(@startDate AS date) THEN 1 ELSE 0 END AS IsOpeningSource,s.EmpID AS SalesEmpId
        FROM wf.RebateShipmentEvidence e
        JOIN dbo.WFRedemtionHD h ON h.RedemtionID=e.RedemptionId AND h.DocuType=116
        LEFT JOIN dbo.SOHD s ON s.SOID=e.SourceSOID AND s.DocuType=104
        WHERE e.EnvironmentKind=@environment AND e.ResetId=@resetId AND e.Status='HELD'
      ) eligible WHERE ${scope.sql} ORDER BY Id DESC`,{
        environment:epoch.environment,resetId:epoch.resetId,startDate:window.businessDate,...scope.inputs});
      return result.recordset || [];
    }));
    return res.json({data:rows});
  } catch(e) {return safeError(res,e);}
});

router.post('/stage',async(req,res)=>{
  try {
    const window=await readGlobalDataWindow();
    const result=await stageShipmentEvidence({redemptionId:Number(req.body?.redemptionId),listNo:Number(req.body?.listNo)},{
      authorizeSource:(q,source)=>assertEvidenceScope(q,req.user,source,{startDate:window.businessDate})});
    return res.json(result);
  } catch(e) {return safeError(res,e);}
});

router.post('/:id/review',async(req,res)=>{
  try {
    const window=await readGlobalDataWindow();
    const result=await reviewShipmentEvidence(req.user,{id:Number(req.params.id),expectedRevision:Number(req.body?.expectedRevision),
      decision:req.body?.decision,occurredAtUtc:req.body?.occurredAtUtc,reason:req.body?.reason},{
      authorizeSource:(q,source)=>assertEvidenceScope(q,req.user,source,{startDate:window.businessDate})});
    return res.json(result);
  } catch(e) {return safeError(res,e);}
});
module.exports=router;
