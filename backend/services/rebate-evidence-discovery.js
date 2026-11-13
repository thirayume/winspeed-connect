'use strict';
// Bounded internal scanner. No scheduler calls this until the cursor storage,
// performance and restart/reconciliation contract have passed UAT.
function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
const safe=n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647;
function bkkInstant(value){
  if(value==null)return null;
  const s=String(value).trim().replace(' ','T');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(s))fail('REBATE_DISCOVERY_TIME_INVALID');
  const {isValidStartDate}=require('./data-window');
  const [h,m,sec]=s.slice(11,19).split(':').map(Number);
  if(!isValidStartDate(s.slice(0,10))||h>23||m>59||sec>59)fail('REBATE_DISCOVERY_TIME_INVALID');
  const n=Date.parse(s+'+07:00');if(!Number.isFinite(n))fail('REBATE_DISCOVERY_TIME_INVALID');
  return n;
}
async function discoverEvidencePage(query,{epoch,after={redemptionId:0,listNo:0},limit=50}={}){
  const reset=new Date(epoch?.lastResetAtUtc).getTime();
  if(typeof query!=='function'||!epoch?.lastResetAtUtc||!Number.isFinite(reset)||!safe(after.redemptionId)||!safe(after.listNo)||
      !Number.isSafeInteger(limit)||limit<1||limit>100)fail('REBATE_DISCOVERY_INPUT_INVALID',400);
  // First page through source keys, then inspect evidence; never assume that
  // WinSpeed's non-identity numeric key represents creation time.
  const rows=(await query(`SELECT x.RedemtionID,x.Listno,
      CONVERT(varchar(23),a.LatestAudit,121) AS LatestAudit,
      CONVERT(varchar(23),w.LatestWeighOut,121) AS LatestWeighOut
    FROM (SELECT TOP (@limit) h.RedemtionID,h.DocuNo,d.Listno
      FROM dbo.WFRedemtionHD h JOIN dbo.WFRedemtionDT d ON d.RedemtionID=h.RedemtionID
      WHERE h.DocuType=116 AND (h.RedemtionID>@afterId OR (h.RedemtionID=@afterId AND d.Listno>@afterLine))
      ORDER BY h.RedemtionID,d.Listno) x
    OUTER APPLY (SELECT MAX(s.audit_datetime) AS LatestAudit FROM dbo.SMAudit s
      WHERE s.audit_system=3 AND s.audit_screen=2098003052 AND s.audit_columnid=x.RedemtionID
        AND s.audit_docuno=x.DocuNo AND s.brchid=1 AND UPPER(RTRIM(s.audit_action)) IN ('I','INSERT')) a
    OUTER APPLY (SELECT MAX(t.DateOut) AS LatestWeighOut FROM dbo.WGHD t
      WHERE RTRIM(t.MoveBill)=RTRIM(x.DocuNo)) w
    ORDER BY x.RedemtionID,x.Listno`,{limit,afterId:after.redemptionId,afterLine:after.listNo})).recordset||[];
  if(rows.length>limit)fail('REBATE_DISCOVERY_INVALID');
  let prev={...after};const candidates=[];
  for(const row of rows){
    const redemptionId=Number(row.RedemtionID),listNo=Number(row.Listno);
    if(!safe(redemptionId)||redemptionId===0||!safe(listNo)||listNo===0||
       redemptionId<prev.redemptionId||(redemptionId===prev.redemptionId&&listNo<=prev.listNo))
      fail('REBATE_DISCOVERY_INVALID');
    prev={redemptionId,listNo};
    const audit=bkkInstant(row.LatestAudit),scale=bkkInstant(row.LatestWeighOut);
    // Unknown evidence must be held. Even a clear-looking candidate still
    // needs source, tonnage and physical proof before any accrual.
    if((audit!==null&&audit>reset)||(scale!==null&&scale>reset)||audit===null||scale===null)
      candidates.push({redemptionId,listNo,reason:audit===null||scale===null?'TIME_EVIDENCE_INCOMPLETE':'POST_RESET_CANDIDATE'});
  }
  return {scanned:rows.length,candidates,next:prev,cycleComplete:rows.length<limit};
}
// Stage under fresh per-record fences. A cursor must only advance after this
// entire page succeeds; replays are safe and a reset change aborts the page.
async function stageEvidencePage(page,epoch,{stage=require('./rebate-evidence-intake').stageShipmentEvidence}={}){
  if(!page||!Array.isArray(page.candidates)||page.candidates.length>100)fail('REBATE_DISCOVERY_INPUT_INVALID',400);
  const results=[];
  for(const c of page.candidates)results.push(await stage({redemptionId:c.redemptionId,listNo:c.listNo},{expectedEpoch:epoch}));
  return {staged:results.length,next:page.next,cycleComplete:page.cycleComplete};
}
module.exports={discoverEvidencePage,stageEvidencePage,bkkInstant};
