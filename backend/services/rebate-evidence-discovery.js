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
// Which lines can hold a shipment made after the reset (owner, 17 Nov 2026: the
// queue must not fill with history from before the data-window start):
//   - a line dated on or after the data-window start (windowStart, YYYY-MM-DD);
//   - an older-dated line only when WinSpeed's create audit is after the reset,
//     which is how a back-dated document shows itself.
// A line whose create audit is at or before the reset already existed then, so
// it is not a post-reset shipment even when no weigh-out was recorded. A line
// with no create audit cannot prove its time and is held for review.
// On the UAT copy this held 297,540 of 300,541 lines before the change.
// RECOMPILE (UAT copy, 21 Nov 2026): a plan cached for another reset time or cursor
// position made the first page time out at 30 s every time, so the worker could never
// move its cursor. Compiled per page, the slowest page took about 2 s.
// Hybrid rule (owner, 21 Nov 2026): only a line whose booking (103) Sale-App issued is
// held; a booking made in WinSpeed keeps WinSpeed's own Rebate process.
const {SALE_APP_BOOKING_FOR_116_LINE}=require('./rebate-booking-origin');
async function discoverEvidencePage(query,{epoch,after={redemptionId:0,listNo:0},limit=50,windowStart}={}){
  const reset=new Date(epoch?.lastResetAtUtc).getTime();
  const {isValidStartDate}=require('./data-window');
  if(typeof query!=='function'||!epoch?.lastResetAtUtc||!Number.isFinite(reset)||!safe(after.redemptionId)||!safe(after.listNo)||
      !Number.isSafeInteger(limit)||limit<1||limit>100||!isValidStartDate(windowStart))fail('REBATE_DISCOVERY_INPUT_INVALID',400);
  // WinSpeed keeps audit and weigh-out times in Bangkok local time.
  const resetLocal=new Date(reset+7*3600000).toISOString().slice(0,23);
  // First page through source keys, then inspect evidence; never assume that
  // WinSpeed's non-identity numeric key represents creation time.
  const rows=(await query(`SELECT x.RedemtionID,x.Listno,
      CONVERT(varchar(23),a.LatestAudit,121) AS LatestAudit,
      CONVERT(varchar(23),w.LatestWeighOut,121) AS LatestWeighOut,
      CASE WHEN o.FromSaleApp=1 THEN 1 ELSE 0 END AS FromSaleApp
    FROM (SELECT TOP (@limit) h.RedemtionID,h.DocuNo,d.Listno
      FROM dbo.WFRedemtionHD h JOIN dbo.WFRedemtionDT d ON d.RedemtionID=h.RedemtionID
      WHERE h.DocuType=116 AND (h.RedemtionID>@afterId OR (h.RedemtionID=@afterId AND d.Listno>@afterLine))
        AND (h.DocuDate>=@windowStart OR EXISTS (SELECT 1 FROM dbo.SMAudit r
          WHERE r.audit_system=3 AND r.audit_screen=2098003052 AND r.audit_columnid=h.RedemtionID
            AND r.audit_docuno=h.DocuNo AND r.brchid=1 AND UPPER(RTRIM(r.audit_action)) IN ('I','INSERT')
            AND r.audit_datetime>@resetLocal))
      ORDER BY h.RedemtionID,d.Listno) x
    OUTER APPLY (SELECT MAX(s.audit_datetime) AS LatestAudit FROM dbo.SMAudit s
      WHERE s.audit_system=3 AND s.audit_screen=2098003052 AND s.audit_columnid=x.RedemtionID
        AND s.audit_docuno=x.DocuNo AND s.brchid=1 AND UPPER(RTRIM(s.audit_action)) IN ('I','INSERT')) a
    OUTER APPLY (SELECT MAX(t.DateOut) AS LatestWeighOut FROM dbo.WGHD t
      WHERE RTRIM(t.MoveBill)=RTRIM(x.DocuNo)) w
    OUTER APPLY (${SALE_APP_BOOKING_FOR_116_LINE.replace(/\bref\./g,'x.')}) o
    ORDER BY x.RedemtionID,x.Listno
    OPTION (RECOMPILE)`,{limit,afterId:after.redemptionId,afterLine:after.listNo,
      windowStart:windowStart.replace(/-/g,''),resetLocal})).recordset||[];
  if(rows.length>limit)fail('REBATE_DISCOVERY_INVALID');
  let prev={...after},notFromSaleApp=0;const candidates=[];
  for(const row of rows){
    const redemptionId=Number(row.RedemtionID),listNo=Number(row.Listno);
    if(!safe(redemptionId)||redemptionId===0||!safe(listNo)||listNo===0||
       redemptionId<prev.redemptionId||(redemptionId===prev.redemptionId&&listNo<=prev.listNo))
      fail('REBATE_DISCOVERY_INVALID');
    prev={redemptionId,listNo};
    // Hybrid rule: a shipment of a booking made in WinSpeed is not Sale-App's Rebate.
    if(Number(row.FromSaleApp)!==1){notFromSaleApp++;continue;}
    const audit=bkkInstant(row.LatestAudit),scale=bkkInstant(row.LatestWeighOut);
    // Unknown evidence must be held. Even a clear-looking candidate still
    // needs source, tonnage and physical proof before any accrual.
    const postReset=(audit!==null&&audit>reset)||(scale!==null&&scale>reset);
    if(postReset)candidates.push({redemptionId,listNo,reason:'POST_RESET_CANDIDATE'});
    else if(audit===null)candidates.push({redemptionId,listNo,reason:'TIME_EVIDENCE_INCOMPLETE'});
  }
  return {scanned:rows.length,candidates,notFromSaleApp,next:prev,cycleComplete:rows.length<limit};
}
// Stage under fresh per-record fences. A cursor must only advance after this
// entire page succeeds; replays are safe and a reset change aborts the page.
async function stageEvidencePage(page,epoch,{stage=require('./rebate-evidence-intake').stageShipmentEvidence}={}){
  if(!page||!Array.isArray(page.candidates)||page.candidates.length>100)fail('REBATE_DISCOVERY_INPUT_INVALID',400);
  const results=[];let skipped=0;
  for(const c of page.candidates){
    try{results.push(await stage({redemptionId:c.redemptionId,listNo:c.listNo},{expectedEpoch:epoch}));}
    catch(e){
      // The page query already skips WinSpeed bookings; the intake re-checks under lock.
      if(e?.code!=='REBATE_BOOKING_NOT_FROM_SALE_APP')throw e;
      skipped++;
    }
  }
  return {staged:results.length,skipped,next:page.next,cycleComplete:page.cycleComplete};
}
module.exports={discoverEvidencePage,stageEvidencePage,bkkInstant};
