'use strict';
// Enrich only the already date-filtered bookings. Keep pilot history intact.
// A row represents one delivery / physical cut / invoice segment; never assign
// one recorder or invoice to all tickets of a multi-line booking.
const {sql}=require('../db');
async function attachOperationalReport(rows,q){
 if(!rows.length)return rows;
 const schema=(await q(`SELECT
  CASE WHEN OBJECT_ID('wf.NativeDocumentReceipt','U') IS NOT NULL
   AND OBJECT_ID('wf.NativeDocumentRequest','U') IS NOT NULL
   AND OBJECT_ID('wf.NativeDocumentReceiptLine','U') IS NOT NULL THEN 1 ELSE 0 END AS Present,
   (SELECT COUNT(*) FROM wf.SchemaMigration WHERE FileName='263_native_document_operation_contract.sql') AS Ledger263`)).recordset?.[0];
 if(schema?.Present===0&&schema.Ledger263===0)return rows;
 if(schema?.Present!==1||schema.Ledger263!==1)throw Object.assign(Error('ND_REPORT_SCHEMA_UNAVAILABLE'),{status:503});
 const ids=[...new Set(rows.map(r=>Number(r.SOID)).filter(n=>Number.isSafeInteger(n)&&n>0))];
 const operational=new Map();
 for(let offset=0;offset<ids.length;offset+=300){
  const batch=ids.slice(offset,offset+300),params={},names=batch.map((n,i)=>{
   const key='booking'+i;params[key]={type:sql.Int,value:n};return '@'+key;
  }).join(',');
  const stages=(await q(`SELECT r.SourceId AS SOID,r.DocuType,r.NativeId,r.NativeNo,r.UserId,r.ActorUserId,
   CONVERT(varchar(16),DATEADD(hour,7,r.CreatedAtUtc),120) AS CreatedAt,
   a.UserId AS RequestUserId,a.ActorUserId AS RequestActorId,a.Status,
   a.ApprovedById,a.ApproverActorId
   FROM wf.NativeDocumentReceipt r JOIN wf.NativeDocumentRequest a ON a.RequestId=r.RequestId
   WHERE r.DocuType IN(119,104) AND r.SourceKind='SO' AND r.SourceId IN(${names})
   ORDER BY r.CreatedAtUtc,r.NativeId`,params)).recordset||[];
  const requests=(await q(`SELECT r.SourceId AS SOID,r.Status,r.ApprovedById,r.ApproverActorId
   FROM wf.NativeDocumentRequest r WHERE r.DocuType=104 AND r.SourceKind='SO' AND r.SourceId IN(${names})
   ORDER BY r.CreatedAtUtc,r.RequestId`,params)).recordset||[];
  for(const r of stages){
   if(!operational.has(r.SOID))operational.set(r.SOID,{ai:null,deliveries:[],credit:null,segments:[]});
   const s=operational.get(r.SOID);if(r.DocuType===119)s.ai=r;else s.deliveries.push(r);
  }
  for(const r of requests){
   if(!operational.has(r.SOID))operational.set(r.SOID,{ai:null,deliveries:[],credit:null,segments:[]});
   operational.get(r.SOID).credit=r;
  }
  const segments=(await q(`SELECT d.SourceId AS SOID,d.NativeId AS DeliveryId,dl.CouponNo,
   cut.NativeNo AS SlipNo,cut.UserId AS CutUserId,cut.ActorUserId AS CutActorId,
   CONVERT(varchar(16),DATEADD(hour,7,cut.CreatedAtUtc),120) AS CutAt,
   cr.Status AS CutStatus,cr.UserId AS RequestUserId,cr.ActorUserId AS RequestActorId,
   cr.ApprovedById,cr.ApproverActorId,er.EmpCode AS RecorderEmp,
   inv.NativeNo AS InvoiceNo,inv.UserId AS InvoiceUserId,inv.ActorUserId AS InvoiceActorId,
   CONVERT(varchar(10),ih.DocuDate,120) AS InvoiceDate
   FROM wf.NativeDocumentReceipt d
   JOIN wf.NativeDocumentReceiptLine dl ON dl.RequestId=d.RequestId AND dl.DocuType=104
   LEFT JOIN wf.NativeDocumentReceiptLine cl ON cl.CouponId=dl.CouponId AND cl.DocuType=116
   LEFT JOIN wf.NativeDocumentReceipt cut ON cut.RequestId=cl.RequestId AND cut.DocuType=116
   LEFT JOIN wf.NativeDocumentRequest cr ON cr.RequestId=cut.RequestId
   LEFT JOIN dbo.WFRedemtionHD ch ON ch.RedemtionID=cut.NativeId AND ch.DocuType=116
   LEFT JOIN dbo.EMEmp er ON er.EmpID=ch.SaveEmpID
   LEFT JOIN wf.NativeDocumentReceiptLine il ON il.SourceId=cut.NativeId AND il.SourceLineNo=cl.NativeLineNo AND il.DocuType=107
   LEFT JOIN wf.NativeDocumentReceipt inv ON inv.RequestId=il.RequestId AND inv.DocuType=107
   LEFT JOIN dbo.SOInvHD ih ON ih.SOInvID=inv.NativeId AND ih.DocuType=107
   WHERE d.DocuType=104 AND d.SourceKind='SO' AND d.SourceId IN(${names})
   ORDER BY d.SourceId,d.NativeId,cut.NativeId,inv.NativeId,dl.NativeLineNo`,params)).recordset||[];
  for(const r of segments)operational.get(r.SOID)?.segments.push(r);
 }
 const result=[];
 for(const row of rows){
  const stage=operational.get(row.SOID);
  if(!stage){result.push(row);continue;}
  // The legacy query can have multiple rows; emit the v3 chain only once.
  if(stage.emitted)continue;stage.emitted=true;
  const base={...row},ai=stage.ai,credit=stage.credit;
  if(ai)Object.assign(base,{AiNo:ai.NativeNo,AiUserId:ai.UserId,AiActorId:ai.ActorUserId,
   AiSelf:ai.UserId===row.ConfirmedById,AiAt:ai.CreatedAt});
  if(credit)Object.assign(base,{CreditState:credit.Status,CreditUserId:credit.ApprovedById,
   CreditActorId:credit.ApproverActorId,CreditSelf:false});
  if(!stage.deliveries.length){result.push(base);continue;}
  for(const d of stage.deliveries){
   const groups=new Map();
   for(const s of stage.segments.filter(s=>s.DeliveryId===d.NativeId)){
    const key=JSON.stringify([s.SlipNo,s.InvoiceNo]);
    if(!groups.has(key))groups.set(key,{...s,coupons:new Set()});
    groups.get(key).coupons.add(s.CouponNo);
   }
   if(!groups.size)groups.set('',{coupons:new Set()});
   for(const s of groups.values())result.push({...base,DeliveryNo:d.NativeNo,
    CreditState:d.Status,CreditUserId:d.ApprovedById,CreditActorId:d.ApproverActorId,
    CreditSelf:d.ApproverActorId!=null&&d.ApproverActorId===d.RequestActorId,
    DeliveryUserId:d.UserId,DeliveryActorId:d.ActorUserId,DeliveryAt:d.CreatedAt,
    CouponNo:[...s.coupons].filter(Boolean).join(', ')||null,
    SlipNo:s.SlipNo||null,SlipSource:s.SlipNo?'MANUAL':null,ExceptionRequired:s.SlipNo?true:null,
    RedemptionState:s.CutStatus||null,RedReqUserId:s.RequestUserId,RedReqActorId:s.RequestActorId,
    RedApprUserId:s.ApprovedById,RedApprActorId:s.ApproverActorId,
    RedSelf:s.ApprovedById!=null&&s.ApprovedById===s.RequestUserId,
    RecorderEmp:s.RecorderEmp||null,ApproverEmp:null,RedemptionAt:s.CutAt||null,
    InvoiceNo:s.InvoiceNo||null,InvoiceDate:s.InvoiceDate||null,
    InvoiceUserId:s.InvoiceUserId,InvoiceActorId:s.InvoiceActorId});
  }
 }
 return result;
}
module.exports={attachOperationalReport};
